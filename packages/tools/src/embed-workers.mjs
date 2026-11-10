// Mirage original code. The single-file packager's worker step, done on the syntax tree instead of with regular
// expressions over minified text (package.mjs used to replace any quoted text that ended with the worker's file
// name, and went on silently when a reference had a shape it did not expect).
//   import { embedWorkers, htmlSafe } from './embed-workers.mjs';
//   const { js, pre, embedded } = embedWorkers(bundle, [{ name: 'simplify-abc.js', src }], parseAst);
//   page = `<script type="module">${pre}${htmlSafe(js, parseAst)}</script>`
// What it does, and refuses:
//   - a reference is a string literal (or a template without ${}) whose path ends in exactly the worker's file name
//     ('w.js' is not a reference to 'my-w.js'; '?query' and '#hash' are ignored). It becomes a variable holding a
//     Blob URL of the worker's source.
//   - `new Worker(<reference>, { type: 'module', ... })` loses `type: 'module'`: a page opened from file:// cannot
//     start a module worker from a Blob. The other options (name) stay.
//   - REFUSED, with the reason: a worker with import / export / import.meta (it cannot run classic); a worker that
//     refers to another built file; a Worker started on a reference with options that are not a plain object;
//     a worker's file name left anywhere in the bundle after the rewrite (a reference built at run time, or inside a
//     template with ${}); a worker no reference was found for.
//   - nothing is evaluated: the bundle and the workers are only parsed.
// htmlSafe(js) makes a script safe to put inside <script>: in every string, template and regular-expression literal
// `</script`, `<script` and `<!--` are written with \x3C (the same value; without it `<!--` followed by `<script`
// makes the HTML parser swallow the closing tag and the page is blank); in code, where the `<` is an operator, a
// space goes after it (the old `<\/script` replace broke `a</script/.test(b)`).
// `parse` is Vite's parseAst (an ESTree with start / end): passed in so this file imports nothing.

const walk = (node, fn, parent = null) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, fn, parent); return; }
  if (typeof node.type === 'string') { if (fn(node, parent) === false) return; parent = node; }
  for (const k in node) if (k !== 'type' && k !== 'start' && k !== 'end') walk(node[k], fn, parent);
};
/** the text of a string literal or of a template without substitutions; null for anything else */
const textOf = (n) => (n.type === 'Literal' && typeof n.value === 'string' ? n.value
  : n.type === 'TemplateLiteral' && n.expressions.length === 0 && n.quasis.length === 1 ? n.quasis[0].value.cooked : null);
/** does this text name the file? exact file name after the last '/', query and hash ignored */
export const refersTo = (text, name) => {
  if (typeof text !== 'string') return false;
  const p = text.replace(/[?#].*$/, '');
  return p === name || p.endsWith('/' + name);
};
// `<` before script, /script or !-- written as \x3C; a `<` that already carries a backslash (`\<` in a regex) loses it
const escLt = (raw) => raw.replace(/(\\*)<(?=\/script|script|!--)/gi, (_, b) => (b.length % 2 ? b.slice(1) : b) + '\\x3C');
const applyEdits = (src, edits) => {
  edits.sort((a, b) => b.start - a.start);
  for (let i = 1; i < edits.length; i++) if (edits[i].end > edits[i - 1].start) throw new Error('internal: overlapping edits');
  for (const e of edits) src = src.slice(0, e.start) + e.text + src.slice(e.end);
  return src;
};

/** the reason a worker's source cannot run as a classic worker, or null */
export function classicProblem(src, parse) {
  let ast;
  try { ast = parse(src); } catch (e) { return 'does not parse: ' + String(e.message).split('\n')[0]; }
  let why = null;
  walk(ast, (n) => {
    if (why) return false;
    if (/^(Import|Export)\w*Declaration$/.test(n.type)) why = `has a top-level ${n.type === 'ImportDeclaration' ? 'import' : 'export'}`;
    else if (n.type === 'MetaProperty' && n.meta?.name === 'import') why = 'uses import.meta';
    return undefined;
  });
  return why;
}

/** rewrite the bundle's references to its workers; throws with the reason when it cannot be done safely */
export function embedWorkers(js, workers, parse, { otherFiles = [] } = {}) {
  if (!workers.length) return { js, pre: '', embedded: [] };
  for (const w of workers) {
    const why = classicProblem(w.src, parse);
    if (why) throw new Error(`worker ${w.name} ${why}; it cannot run as a classic worker`);
    const other = [...workers.map((x) => x.name), ...otherFiles].find((f) => f !== w.name && w.src.includes(f));
    if (other) throw new Error(`worker ${w.name} refers to ${other}, another built file: it would be missing from the single file`);
  }
  const ast = parse(js), edits = [], found = new Map(workers.map((w) => [w.name, 0]));
  const varOf = new Map(workers.map((w, i) => [w.name, `__W${i}`]));
  const which = (n) => { const t = textOf(n); return t == null ? null : workers.find((w) => refersTo(t, w.name)) || null; };
  const taken = new Set();   // literal nodes already handled through their `new Worker(...)`
  const hasRef = (node) => { let hit = null; walk(node, (n) => { if (!hit && which(n)) hit = n; return hit ? false : undefined; }); return hit; };
  walk(ast, (n) => {
    if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && /^(Shared)?Worker$/.test(n.callee.name) && n.arguments.length) {
      const lit = hasRef(n.arguments[0]);
      if (!lit) return undefined;
      const opt = n.arguments[1];
      if (opt) {
        if (opt.type !== 'ObjectExpression' || opt.properties.some((p) => p.type !== 'Property' || p.computed))
          throw new Error(`worker ${which(lit).name} is started with options the packager cannot read (${js.slice(opt.start, Math.min(opt.end, opt.start + 60))}); pass a plain { type: 'module' } object`);
        const props = opt.properties, i = props.findIndex((p) => (p.key.name ?? p.key.value) === 'type');
        if (i >= 0) {
          const v = textOf(props[i].value);
          if (v === null) throw new Error(`worker ${which(lit).name}: its "type" option is not a string literal`);
          // drop the property with one neighbouring comma: { type: 'module', name } -> { name }
          if (v === 'module') edits.push(props.length === 1 ? { start: n.arguments[0].end, end: opt.end, text: '' }
            : i < props.length - 1 ? { start: props[i].start, end: props[i + 1].start, text: '' } : { start: props[i - 1].end, end: props[i].end, text: '' });
        }
      }
    }
    const w = which(n);
    if (w && !taken.has(n)) { taken.add(n); found.set(w.name, found.get(w.name) + 1); edits.push({ start: n.start, end: n.end, text: varOf.get(w.name) }); return false; }
    return undefined;
  });
  for (const w of workers) if (!found.get(w.name)) throw new Error(`could not find a reference to worker ${w.name} in the bundle (it is built from parts at run time?)`);
  const out = applyEdits(js, edits);
  try { parse(out); } catch (e) { throw new Error('internal: the rewritten bundle does not parse: ' + String(e.message).split('\n')[0]); }
  for (const w of workers) if (out.includes(w.name)) throw new Error(`a reference to worker ${w.name} is left in the bundle in a form the packager cannot rewrite (a template with \${}, or a longer string)`);
  for (const v of varOf.values()) if (new RegExp(`(?<![\\w$])${v.replace(/\$/g, '\\$')}(?![\\w$])`).test(js)) throw new Error(`the bundle already uses the name ${v}`);
  // worker sources sit in string literals: JSON.stringify, with the HTML-sensitive sequences written as \x3C
  const lit = (s) => escLt(JSON.stringify(s));
  const pre = workers.map((w) => `const ${varOf.get(w.name)}=URL.createObjectURL(new Blob([${lit(w.src)}],{type:"text/javascript"}));\n`).join('');
  return { js: out, pre, embedded: workers.map((w) => ({ name: w.name, references: found.get(w.name), bytes: w.src.length })) };
}

/** a script's text made safe to sit inside <script>...</script> (see the head of this file) */
export function htmlSafe(js, parse) {
  if (!/<(\/script|script|!--)/i.test(js)) return js;
  const edits = [];
  walk(parse(js), (n) => {
    const literal = (n.type === 'Literal' && (typeof n.value === 'string' || n.regex)) || n.type === 'TemplateElement';
    if (!literal) return undefined;
    const raw = js.slice(n.start, n.end), safe = escLt(raw);
    if (safe !== raw) edits.push({ start: n.start, end: n.end, text: safe });
    return false;
  });
  // what is left is code (`a</script/.test(b)`: less-than, then a regular expression) or a comment: a space after
  // the `<` changes neither, and takes the sequence away
  return applyEdits(js, edits).replace(/<(?=\/script|script|!--)/gi, '< ');
}

/** would the HTML parser find the end of this inline script? (false: `<!--` then `<script` without `-->` hides it) */
export function scriptCloses(js) {
  let state = 0;   // 0 data, 1 escaped (after <!--), 2 double escaped (after <script inside it)
  const re = /<!--|-->|<\/script[\s/>]|<script[\s/>]/gi;
  for (let m; (m = re.exec(js));) {
    const t = m[0].toLowerCase();
    if (t === '<!--') { if (state === 0) state = 1; }
    else if (t === '-->') state = 0;
    else if (t.startsWith('</script')) { if (state === 2) state = 1; else return false; }   // a closing tag inside the text ends the script early
    else if (state === 1) state = 2;
  }
  return state !== 2;
}
