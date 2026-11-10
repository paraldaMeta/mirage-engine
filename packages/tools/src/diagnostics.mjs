// Mirage original code. One shape for everything the tools find wrong, so an agent reads one list:
//
//   { code: 'MG304', severity: 'error' | 'warning' | 'info', target, message, fix, at? }
//
//   code      stable (never renumbered; docs/diagnostics.md is the table an agent looks a code up in)
//   target    what it is about: a plan field ('viewpoints[1].look'), a module ('crate'), an object
//             ('walls/wall-n'), a scenario step ('step 3 "wall-blocks"'), a file
//   message   what is wrong, with the measured numbers
//   fix       one concrete action: a field and a value to try, a file to edit, an object to move
//   at        optional [x, y, z] (or [x, z]) in world metres where it happens
//
// This module is plain node (no browser): the code table, the constructor, and the converters from what the tools
// already produce (plan issues, the world build report, playtest step rows, console errors) to diagnostics.
// The page-side probes that measure the numbers live in world-checks.mjs.

/** The code table. severity is the default; a diagnostic may lower it (a load-time estimate) or raise it (a failed
 *  expectation). fix is the generic action, replaced by a concrete one wherever the numbers are known. */
export const CODES = {
  // ---- MG1xx the site plan (mirage-validate-plan, definePlan, the loader)
  MG100: { severity: 'error', title: 'plan could not be loaded', fix: 'Fix the syntax or the import in the plan file; it must `export default` a plain object (or be JSON).' },
  MG101: { severity: 'error', title: 'required plan field missing', fix: 'Add the field named in target to plan.js (name and bounds are required; a view needs eye and look).' },
  MG102: { severity: 'error', title: 'plan field has the wrong type', fix: 'Give the field in target the type the message names (arrays of numbers for coordinates).' },
  MG103: { severity: 'error', title: 'plan number out of range', fix: 'Use a finite number above the minimum the message names (radii and widths > 0).' },
  MG104: { severity: 'error', title: 'wrong number of coordinates', fix: 'Coordinates are [x, z] on the ground, [x, y, z] in space, rects [x0, z0, x1, z1]: fix the count in target.' },
  MG105: { severity: 'error', title: 'plan value not allowed', fix: 'Use one of the values the message lists (mode: walk | fly | game | orbit; units: m).' },
  MG106: { severity: 'error', title: 'shape needs exactly one of rect, circle, poly', fix: 'Give the shape in target exactly one of rect: [x0, z0, x1, z1], circle: [x, z, r] or poly: [[x, z], ...].' },
  MG107: { severity: 'error', title: 'rectangle corners out of order', fix: 'Swap the corners in target so x1 > x0 and z1 > z0 ([x0, z0, x1, z1], west-north to east-south).' },
  MG108: { severity: 'error', title: 'walk height range empty', fix: 'Set plan.walk.yMax above plan.walk.yMin (default yMin -1, yMax 12).' },
  MG109: { severity: 'error', title: 'empty plan string', fix: 'Give the field in target a non-empty string.' },
  MG110: { severity: 'error', title: 'spawn outside plan.bounds', fix: 'Move plan.spawn.eye inside plan.bounds (the walk grid has no floor outside it), or grow plan.bounds.' },
  MG111: { severity: 'error', title: 'view looks at its own eye', fix: 'Give the view in target a look point different from its eye (look is a point, not a direction).' },
  MG112: { severity: 'warning', title: 'spawn feet outside the walk height range', fix: 'Set plan.spawn.eye[1] to the floor height + 1.62, or widen plan.walk.yMin / yMax to include that floor.' },
  // ---- MG2xx modules and anchors (the world build report)
  MG201: { severity: 'error', title: 'module threw in build', fix: 'Open the module file (modules/<name>.js), read the error and its stack in the console, fix the line; the rest of the world built without it.' },
  MG202: { severity: 'error', title: 'module threw in finalize', fix: 'Fix finalize(ctx) in the module file; check every anchor it reads exists (ctx.anchors[key] may be undefined).' },
  MG203: { severity: 'error', title: 'required anchors missing', fix: 'Add a module that offers the anchors (anchors: { key: [...] }) before this one, or move the key from consumes.required to consumes.optional.' },
  MG204: { severity: 'error', title: 'module definition invalid', fix: 'A module is { name, build(ctx) } with a unique name; anchors, ambientVolumes and consumes must have the documented shapes.' },
  MG206: { severity: 'warning', title: 'wall opening reaches the top of its wall', fix: "An opening's height is where its arch springs and the arch defaults to 'round' (+ width / 2): give the opening arch: 'flat', or lower its height so the arch stays under the wall top (the message has the numbers)." },
  MG205: { severity: 'info', title: 'module built no triangles', fix: 'If the module should be visible, check it adds meshes to ctx.root (not to the scene) and that they have geometry.' },
  // ---- MG3xx walking and collision (walk grid, walker, playtest steps)
  MG301: { severity: 'error', title: 'walker stuck', fix: 'Widen the opening (>= 0.62 m), lower the step (<= 0.4 m) or raise the ceiling (>= 1.8 m) at the stuck point, or route walkTo around the obstacle.' },
  MG302: { severity: 'error', title: 'walk timed out', fix: 'The walker was still moving: add "run": true or a longer "timeout" to the step, or shorten the route.' },
  MG303: { severity: 'error', title: 'walker fell', fix: 'Make the floor a closed solid (a box, not a plane), keep userData.collide on, and its height inside plan.walk.yMin..yMax.' },
  MG304: { severity: 'error', title: 'walked through a barrier', fix: 'Make the barrier solid for the walk grid: closed geometry at least 0.125 m thick, or ctx.collider(proxy) at least 0.2 m thick; never userData.collide = false.' },
  MG305: { severity: 'error', title: 'stopped short of the expected point', fix: 'Something blocks before the expected point: move it, open a gap of >= 0.62 m, or change the expectation if the stop is right.' },
  MG306: { severity: 'error', title: 'ended higher than expected', fix: 'The walker climbed onto something (a step <= 0.4 m counts as walkable): raise it above 0.4 m or move it off the route.' },
  MG307: { severity: 'error', title: 'not on the ground', fix: 'Put the eye 1.62 m above a floor that is solid in the walk grid (closed geometry inside plan.walk range).' },
  MG310: { severity: 'error', title: 'eye or body inside a solid', fix: 'Move the view out of the solid: the message gives a free spot nearby to use as eye.' },
  MG311: { severity: 'error', title: 'no floor under the view', fix: 'Put the eye over a floor inside plan.bounds and plan.walk (or give the view mode: "fly").' },
  MG312: { severity: 'warning', title: 'spawn above the floor', fix: 'Set the eye height to floor + 1.62 so the walker does not drop on load.' },
  MG320: { severity: 'warning', title: 'object floating above the ground', fix: 'Lower the object onto the floor under it (its bottom at the floor height), or give it support; mark deliberate ones userData.float = true.' },
  // ---- MG4xx what the frame shows (see, viewpoints, frame statistics, flicker)
  MG401: { severity: 'error', title: 'see: out of frame', fix: 'Turn the view to the object: set look (of the viewpoint or the step\'s place) to its centre, given in the message.' },
  MG402: { severity: 'error', title: 'see: hidden', fix: 'Move the eye so the occluder named in the message is not in between, or move the occluder.' },
  MG403: { severity: 'error', title: 'see: too small', fix: 'Move the eye closer to the object (the message gives a distance), or lower the expected share.' },
  MG404: { severity: 'error', title: 'see: no object of that name', fix: 'Name the mesh (mesh.name or b.finish({ name })) or use a name that exists; the message lists the names in the scene. A module that failed has no objects.' },
  MG410: { severity: 'warning', title: 'viewpoint sees nothing', fix: 'Point look at the world: the view shows only sky or void.' },
  MG411: { severity: 'warning', title: 'viewpoint blocked', fix: 'One surface fills the view: move the eye back from it or out of it.' },
  MG412: { severity: 'warning', title: 'viewpoint misses its subject', fix: 'Aim the view at its subject (the object it is named after, or its see: [...] list): set look to the centre given in the message.' },
  MG440: { severity: 'warning', title: 'black frame', fix: 'Check the light: plan.render.post.exposure (default 0.4), plan.render.time (sun below the horizon), and that the camera is not inside a mesh.' },
  MG442: { severity: 'warning', title: 'interior nearly black', fix: 'The eye is inside a module\'s ambientVolumes box, which dims the sky light, and the room has no light of its own: add a lamp or an emissive surface, raise the volume\'s factor (0.5 - 0.7), or open a window.' },
  MG441: { severity: 'warning', title: 'overexposed frame', fix: 'Lower plan.render.post.exposure or emissive / lamp strengths; check for a mesh with a huge emissive right in front of the camera.' },
  MG450: { severity: 'warning', title: 'coplanar surfaces (z-fighting)', fix: 'Raise the upper surface 1-2 cm (y += 0.01) or remove one of the two; coplanar faces flicker.' },
  MG451: { severity: 'error', title: 'flicker over the limit', fix: 'Open the step\'s -worst-diff.png (bright = what flickered): offset coplanar faces 1-2 cm, coarsen sub-pixel high-contrast detail, exclude animations.' },
  MG452: { severity: 'info', title: 'flicker spike', fix: 'One frame flickers far more than the rest: look at the step\'s -worst.png at the position given (a thin post crossing a low sun is accepted).' },
  MG460: { severity: 'error', title: 'still differs from its baseline', fix: 'Open the diff image (baseline | now, the worst cell boxed): if the change is meant, refresh the baseline (delete the file, rerun); otherwise undo what moved in that cell.' },
  MG461: { severity: 'error', title: 'still not reproducible', fix: 'The same view drew different pixels after another view or a reload: look for Math.random / Date.now / performance.now in a module or ctx.onUpdate, state kept between frames (a counter, an eased value), or a texture that loads late; seed it (ctx.rng) or reset it in play.place().' },
  // ---- MG5xx performance budgets (plan.budget)
  MG501: { severity: 'error', title: 'frame time over budget', fix: 'A time is not a cause: read the runs and the spread in the message (over 25 %: measure again on a quiet machine), then compare calls and triangles with plan.budget; shadows, lamps, post effects and resolution cost time without triangles. Or raise plan.budget.frameMs if the target allows.' },
  MG502: { severity: 'error', title: 'p95 frame time over budget', fix: 'Spikes: something rebuilds or compiles while walking; prepare materials at load, avoid per-frame allocations.' },
  MG503: { severity: 'error', title: 'draw calls over budget', fix: 'Merge meshes per material (b.finish) or instance repeated objects in the module named in the message.' },
  MG504: { severity: 'error', title: 'triangles over budget', fix: 'Lower the detail of the heaviest module named in the message (segments, lathe steps, terrain resolution), or instance it.' },
  // ---- MG6xx console and runtime
  MG601: { severity: 'error', title: 'console error', fix: 'Read the error text; fix the file and line it names. Errors from a module say which module.' },
  MG602: { severity: 'error', title: 'uncaught exception in the page', fix: 'Fix the code that threw (the stack names the file and line); main.js must not throw before window.__READY = true.' },
  MG603: { severity: 'error', title: 'page never became ready', fix: 'The page threw or hung before window.__READY = true: read the console errors in the message, fix main.js or the import that fails.' },
  MG604: { severity: 'error', title: 'scenario step failed', fix: 'Read the message; fix the step (its fields) or the world it ran against.' },
  // ---- MG7xx game state (games built on @mirage/game)
  MG701: { severity: 'error', title: 'expectation failed', fix: 'Compare the value with the expectation; fix the world or the scenario step.' },
  MG702: { severity: 'error', title: 'no interaction prompt', fix: 'Walk within reach (2.4 m) of the entity and lookAt it by id before expecting near / prompt.' },
  MG703: { severity: 'error', title: 'game flag not set', fix: 'Check the interaction ran (tap "KeyE" while near) and that its handler sets the flag; a toggle can flip back after a second press.' },
  MG704: { severity: 'error', title: 'inventory item missing', fix: 'Check the pick-up interaction ran and gives the item id the step expects.' },
  MG705: { severity: 'error', title: 'no such game entity', fix: 'Use an entity id that the game defines (lookAt: "<id>").' },
  MG710: { severity: 'error', title: 'text contrast below WCAG AA', fix: 'Give the text a backdrop: a panel behind it (background with alpha >= 0.8, like .mg-prompt) or a darker / lighter text colour; WCAG AA needs 4.5:1 (3:1 for text >= 24 px, or >= 18.7 px bold).' },
};

export const SEVERITIES = ['error', 'warning', 'info'];

/** A diagnostic. Unknown codes throw (a typo must not slip into a report). */
export function diag(code, { target = '', message, fix, at, severity } = {}) {
  const c = CODES[code];
  if (!c) throw new Error('unknown diagnostic code ' + code);
  const d = { code, severity: severity || c.severity, target: String(target), message: String(message || c.title), fix: String(fix || c.fix) };
  if (at) d.at = at.map((v) => +(+v).toFixed(2));
  return d;
}

/** Errors first, then warnings, then info, each in the order found (load-time causes before the step failures they
 *  cause); duplicates (same code, target, message) dropped. */
export function sortDiagnostics(list) {
  const seen = new Set();
  return list.filter((d) => { const k = d.code + '|' + d.target + '|' + d.message; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((d, i) => [d, i]).sort(([a, i], [b, j]) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || i - j).map(([d]) => d);
}

/** One line for a terminal. */
export const formatDiagnostic = (d) => `${d.code} ${d.severity} ${d.target ? d.target + ': ' : ''}${d.message}${d.at ? ` (at ${d.at.join(', ')})` : ''}\n    fix: ${d.fix}`;

/** The report.md section. */
export function markdownDiagnostics(list) {
  if (!list.length) return '## Diagnostics\n\nNone.\n';
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return '## Diagnostics\n\nRead these first; every row has a fix. Codes: docs/diagnostics.md.\n\n| code | severity | target | problem | fix |\n|---|---|---|---|---|\n' +
    list.map((d) => `| ${d.code} | ${d.severity === 'error' ? '**error**' : d.severity} | ${esc(d.target)} | ${esc(d.message)}${d.at ? ` (at ${d.at.join(', ')})` : ''} | ${esc(d.fix)} |`).join('\n') + '\n';
}

const fmt = (v) => (typeof v === 'number' ? +v.toFixed(2) : v);
const xyz = (p) => p.map((v) => fmt(v)).join(', ');

// ---------------------------------------------------------------------------------------------------- plan
const PLAN_RULES = { required: 'MG101', type: 'MG102', finite: 'MG103', range: 'MG103', size: 'MG104', enum: 'MG105', const: 'MG105', oneOf: 'MG106', order: 'MG107', walk: 'MG108', empty: 'MG109' };

/** planIssues(plan) (from @mirage/world/plan-validation) -> diagnostics. */
export function fromPlanIssues(issues) {
  // a LIST of spots under plan.points (points: { lamps: [[x, y, z], ...] }) fails once per entry with "expected
  // number": said once per name, with what to write instead ("Set points.lamps[0] so it is number" helped nobody)
  const listed = new Set(issues.map((i) => i.rule === 'type' && /^points\.[^.[\]]+\[\d+\]$/.test(i.path) && /expected number/.test(i.message) ? i.path.replace(/\[\d+\]$/, '') : null).filter(Boolean));
  const said = new Set();
  return issues.map((i) => {
    const code = PLAN_RULES[i.rule] || 'MG102';
    const name = i.path.replace(/\[\d+\]$/, '');
    if (listed.has(name)) {
      if (said.has(name)) return null;
      said.add(name);
      const key = name.slice('points.'.length);
      return diag('MG102', { target: name, message: `${name}: a list of spots, where plan.points takes one [x, y, z] per name`,
        fix: `Name each spot (points: { ${key}A: [x, y, z], ${key}B: [x, y, z] }), or move the list out of points to a key of your own (plan.${key} = [[x, y, z], ...]): the plan keeps extra top-level keys and a module reads them from ctx.plan.` });
    }
    if (code === 'MG104' && /^points\.[^.[\]]+$/.test(i.path)) return diag(code, { target: i.path, message: `${i.path}: ${i.message}`, fix: `Give ${i.path} three numbers, [x, y, z] with y the height (ground spots are [x, 0, z]; [x, z] pairs belong to paths and shapes).` });
    let fix;
    if (code === 'MG101') fix = `Add ${i.path} to plan.js.`;
    else if (code === 'MG107') fix = `Make ${i.path} larger than the corner before it: rects are [x0, z0, x1, z1] with x1 > x0, z1 > z0.`;
    else if (code === 'MG104' || code === 'MG102' || code === 'MG105' || code === 'MG103') fix = `Set ${i.path} so it ${i.message.replace(/^expected/, 'is')}.`;
    return diag(code, { target: i.path, message: `${i.path}: ${i.message}`, fix });
  }).filter(Boolean);
}

/** Checks of a valid plan that need no geometry: where the spawn and the views are. */
export function lintPlan(plan) {
  const out = [];
  if (!plan || !Array.isArray(plan.bounds)) return out;
  const [x0, z0, x1, z1] = plan.bounds, inside = (e) => e[0] >= x0 && e[0] <= x1 && e[2] >= z0 && e[2] <= z1;
  const walk = { yMin: -1, yMax: 12, ...(plan.walk || {}) };
  const views = [...(plan.spawn ? [['spawn', plan.spawn]] : []), ...(plan.viewpoints || []).map((v, i) => [`viewpoints[${i}]`, v])];
  if (plan.gameView) views.push(['gameView', plan.gameView]);
  for (const [path, v] of views) {
    if (!v || !Array.isArray(v.eye) || !Array.isArray(v.look)) continue;
    if (v.eye.every((c, k) => Math.abs(c - v.look[k]) < 1e-6)) {
      out.push(diag('MG111', { target: path, message: `${path}${v.name ? ` "${v.name}"` : ''}: eye and look are the same point [${xyz(v.eye)}], so the view has no direction`, fix: `Set ${path}.look to the point it should face, e.g. [${xyz([v.eye[0], v.eye[1], v.eye[2] - 10])}] (10 m north).`, at: v.eye }));
    }
  }
  const s = plan.spawn;
  if (s && Array.isArray(s.eye)) {
    if (!inside(s.eye)) {
      const cx = Math.min(Math.max(s.eye[0], x0 + 1), x1 - 1), cz = Math.min(Math.max(s.eye[2], z0 + 1), z1 - 1);
      out.push(diag('MG110', { target: 'spawn.eye', message: `spawn.eye [${xyz(s.eye)}] is outside plan.bounds [${plan.bounds.join(', ')}]: there is no floor to stand on`, fix: `Set spawn.eye to [${xyz([cx, s.eye[1], cz])}] (inside the bounds) or grow plan.bounds to include it.`, at: s.eye }));
    }
    const feet = s.eye[1] - 1.62;
    if ((s.mode || 'walk') === 'walk' && (feet < walk.yMin || feet > walk.yMax)) {
      out.push(diag('MG112', { target: 'spawn.eye[1]', message: `spawn feet at y ${fmt(feet)} are outside plan.walk ${walk.yMin}..${walk.yMax}: the walk grid has no floors there`, fix: `Set plan.walk.${feet < walk.yMin ? 'yMin' : 'yMax'} to ${feet < walk.yMin ? Math.floor(feet - 1) : Math.ceil(feet + 2)}, or spawn.eye[1] to a floor height + 1.62.`, at: s.eye }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- build
/** The first source location in an error text or stack, as the world's own path when it can tell
 *  ("modules/crate.js:12"), else the URL path; null when there is none. */
export function srcLoc(text) {
  const all = [...String(text || '').matchAll(/((?:https?:\/\/[^/\s)]+)?\/[^\s():]+\.m?js):(\d+)(?::\d+)?/g)];
  const own = all.find((m) => !/\/(node_modules|packages)\//.test(m[1])) || all[0];
  if (!own) return null;
  const p = own[1].replace(/^https?:\/\/[^/]+/, ''), i = p.lastIndexOf('/modules/');
  return (i >= 0 ? p.slice(i + 1) : /\/(main|plan|game)\.js$/.test(p) ? p.split('/').pop() : p) + ':' + own[2];
}

/** The world build report's failed modules -> diagnostics (built.report from buildWorld). errors: the console
 *  errors, whose "[world] module ... failed" lines carry the stack (a file and line for the fix). */
export function fromBuildReport(report, plan, errors = []) {
  if (!report) return [];
  const out = [];
  for (const f of report.failed || []) {
    const line = errors.find((e) => e.includes(`module "${f.name}" failed in ${f.phase}`));
    const loc = line && srcLoc(line), file = loc ? loc.replace(/:(\d+)$/, ' line $1') : `modules/${f.name}.js`;
    const invalid = /needs a name and build|already called|consumes|must be an array|ambientVolumes\[|anchors\./.test(f.error);
    if (f.phase === 'consumes') {
      const keys = (f.error.match(/missing required anchors: (.*)$/) || [])[1] || '';
      out.push(diag('MG203', { target: f.name, message: `module "${f.name}" needs anchors nobody offers: ${keys}; its finalize was skipped`, fix: `Add a module that returns anchors { ${keys.split(', ')[0] || 'key'}: [{ pos: [x, y, z] }] } before "${f.name}", or move ${keys} to consumes.optional in ${file}.` }));
    } else if (invalid) {
      out.push(diag('MG204', { target: f.name, message: `module "${f.name}" (${f.phase}): ${f.error}`, fix: /already called/.test(f.error) ? `Rename one of the two modules called "${f.name}" (names must be unique).` : /needs a name and build/.test(f.error) ? `Export { name: '${f.name}', build(ctx) { ... } } from ${file} and list it in modules/index.js.` : `Fix the shape named in the error in ${file}.` }));
    } else {
      out.push(diag(f.phase === 'finalize' ? 'MG202' : 'MG201', { target: f.name, message: `module "${f.name}" threw in ${f.phase} and was skipped: ${f.error}`, fix: `Fix ${f.phase}(ctx) in ${file}: ${hintForError(f.error, plan)}` }));
    }
  }
  for (const m of report.modules || []) if (m.ok && m.tris === 0 && !(m.anchors && Object.keys(m.anchors).length)) {
    out.push(diag('MG205', { target: m.name, message: `module "${m.name}" built no visible triangles` }));
  }
  return out;
}

/** A hint from the text of a JS error (the common ones a module throws). */
export function hintForError(msg, plan) {
  let m;
  if ((m = msg.match(/Cannot read propert(?:y|ies) of (undefined|null) \(reading '([^']+)'\)/))) {
    const planKeys = plan ? Object.keys(plan).filter((k) => plan[k] && typeof plan[k] === 'object').join(', ') : '';
    return `something is ${m[1]} where the code reads .${m[2]}: check every plan field and anchor it reads exists${planKeys ? ` (plan has: ${planKeys})` : ''}.`;
  }
  if ((m = msg.match(/(\w+) is not defined/))) return `${m[1]} is not defined: import it or declare it.`;
  if ((m = msg.match(/(\S+) is not a function/))) return `${m[1]} is not a function: check the name and the import.`;
  return 'read the error and its stack (the console line starting with [world] module).';
}

// ---------------------------------------------------------------------------------------------------- console
/** Console errors / page errors (chrome.mjs open()) -> diagnostics. World module failures are covered by MG2xx. */
/** Console warnings that carry a diagnostic code ("[mirage/geom] MG206 wall: ...") become that diagnostic: the text
 *  up to the first ". " that follows a colon-led explanation is the message, the rest is the fix. */
export function fromWarnings(warnings = []) {
  const out = [], seen = new Set();
  for (const w of warnings) {
    const m = /\[mirage\/([\w-]+)\] (MG\d{3}) ([\s\S]*)/.exec(String(w));
    if (!m || !CODES[m[2]] || seen.has(m[0])) continue;
    seen.add(m[0]);
    const cut = m[3].lastIndexOf('. ') + 1, message = (cut > 0 ? m[3].slice(0, cut) : m[3]).trim(), fix = cut > 0 ? m[3].slice(cut).trim() : '';
    out.push(diag(m[2], { target: m[1], message, ...(fix ? { fix } : {}) }));
  }
  return out;
}
export function fromConsole(errors = [], { allowed = 0, stacks = [] } = {}) {
  const out = [];
  const real = errors.filter((e) => !/\[world\] module "[^"]+" failed in/.test(e));
  let k = 0;
  for (const e of real.slice(0, 10)) {
    const page = e.startsWith('pageerror:');
    const loc = srcLoc(e) || (page ? srcLoc(stacks[k++]) : null);
    out.push(diag(page ? 'MG602' : 'MG601', { target: loc || 'console', message: e.slice(0, 400),
      severity: errors.length <= allowed ? 'warning' : undefined,
      fix: loc ? `Fix ${loc.replace(/:(\d+)$/, ' line $1')}: ${hintForError(e)}` : `${hintForError(e)}` }));
  }
  if (real.length > 10) out.push(diag('MG601', { target: 'console', message: `${real.length - 10} more console errors (report.json errors)` }));
  return out;
}

// ---------------------------------------------------------------------------------------------------- steps
/** Parse "<op> <operand> [tol]". */
export function parseExpect(expr) {
  const [op, ...rest] = String(expr).trim().split(/\s+/);
  const a = rest[0], n = a === 'true' ? true : a === 'false' ? false : a === 'null' ? null : isNaN(+a) ? rest.join(' ') : +a;
  return { op, n, tol: +rest[1] || 0.05 };
}

/** Which way a failed x / z expectation went wrong: 'through' (moved past the expected stop: no collision),
 *  'short' (stopped before it: blocked early) or null (cannot tell). */
export function axisVerdict(expr, start, end) {
  const { op, n, tol } = parseExpect(expr);
  if (typeof n !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  const travel = end - start;
  if (op === '<' || op === '<=') return start < n ? 'through' : travel < 0 ? 'short' : 'short';
  if (op === '>' || op === '>=') return start > n ? 'through' : 'short';
  if (op === '~') {
    if (Math.abs(end - n) <= tol) return null;
    if ((n - start) * (end - n) > 0) return 'through';   // went past n in the direction it was heading
    return 'short';
  }
  return null;
}

const stepName = (idx, s) => `step ${idx + 1}${s.name ? ` "${s.name}"` : ''}`;

/** Diagnostics of one playtest step row (playtest.mjs) plus the probes the runner measured for it in the page:
 *  ctx = { idx, step (the scenario step), plan, probe: { stuck?, through?, short?, see: { name: { center, eye, dist } } }, build } */
export function fromStep(row, ctx) {
  const { idx, step: s = {}, plan, probe = {} } = ctx, target = stepName(idx, s), out = [];
  const pos = row.to || [];
  const viewField = s.viewpoint !== undefined ? `plan.viewpoints[${s.viewpoint}].look` : s.place ? `the step's place.look` : 'a lookAt before the check';
  // the step's own error
  if (row.err) {
    let m;
    if ((m = row.err.match(/walkTo: stuck at ([-\d., ]+) on the way to ([-\d.]+), ([-\d.]+)/))) {
      const at = m[1].split(',').map(Number), p = probe.stuck || {};
      out.push(diag('MG301', { target, message: `stuck at [${xyz(at)}] on the way to [${m[2]}, ${m[3]}]${p.why ? ': ' + p.why : ''}`, fix: p.fix, at }));
    } else if ((m = row.err.match(/walkTo: timed out at ([-\d., ]+) on the way to ([-\d.]+), ([-\d.]+)/))) {
      out.push(diag('MG302', { target, message: row.err, fix: `Add "run": true or "timeout": ${Math.round(((s.timeout || 30000) * 2) / 1000) * 1000} to ${target}, or split the route.`, at: m[1].split(',').map(Number) }));
    } else if ((m = row.err.match(/see: nothing visible is called "([^"]+)"\. Names in the scene: (.*)$/))) {
      out.push(diag('MG404', { target: `see.${m[1]}`, message: `${target}: nothing visible is called "${m[1]}"`, fix: `Name the object "${m[1]}" in its module (mesh.name = '${m[1]}' or b.finish({ name: '${m[1]}' })), or see one of: ${m[2].split(', ').slice(0, 12).join(', ')}. If its module failed (MG201) fix that first.` }));
    } else if ((m = row.err.match(/lookAt: no entity (\S+)/))) {
      out.push(diag('MG705', { target, message: row.err }));
    } else out.push(diag('MG604', { target, message: row.err }));
  }
  for (const c of row.checks || []) {
    if (c.ok) continue;
    const k = c.k, base = `${target}: expected ${k} ${c.e}, got ${JSON.stringify(c.v)}`;
    if (k.startsWith('see.')) {
      const name = k.slice(4), w = c.why || '', p = (probe.see || {})[name] || {};
      const center = p.center ? `[${xyz(p.center)}]` : null;
      if (/^out of frame/.test(w)) out.push(diag('MG401', { target, message: `${name} is out of frame (${base})`, at: p.center, fix: center ? `Turn the view to it: set ${viewField} to ${center} (the centre of ${name}).` : undefined }));
      else if (/hidden/.test(w)) {
        const occ = (w.match(/by (.*)$/) || [])[1] || 'another object';
        out.push(diag('MG402', { target, message: `${name} is ${w}`, at: p.center, fix: `Move the eye so ${occ.split(',')[0].replace(/ [\d.]+ %$/, '')} is not between it and ${name}${center ? ` (${name} is at ${center})` : ''}${p.freeEye ? `; a clear eye: [${xyz(p.freeEye)}]` : ''}, or move the occluder (its module file).` }));
      } else if (/too small/.test(w)) {
        const fix = p.closer ? `Move the eye to [${xyz(p.closer)}] (closer to ${name}, now ${fmt(p.dist)} m away), or lower the expected share.` : undefined;
        out.push(diag('MG403', { target, message: `${name}: ${w}`, at: p.center, fix }));
      } else out.push(diag('MG701', { target, message: base + (w ? ': ' + w : '') }));
      continue;
    }
    if (k === 'x' || k === 'z') {
      const ax = k === 'x' ? 0 : 2, v = axisVerdict(c.e, row.from?.[ax], pos[ax]);
      if (v === 'through') { const p = probe.through || {}; out.push(diag('MG304', { target, message: `${base}: the walker went past the expected stop${p.why ? '; ' + p.why : ''}`, fix: p.fix, at: p.at || pos })); }
      else { const p = probe.stuck || {}; out.push(diag('MG305', { target, message: `${base}: it stopped before the expected point${p.why ? '; ' + p.why : ''}`, fix: p.fix, at: pos })); }
      continue;
    }
    if (k === 'dist') { const p = probe.stuck || {}; out.push(diag('MG305', { target, message: base + (p.why ? '; ' + p.why : ''), fix: p.fix, at: pos })); continue; }
    if (k === 'y' || k === 'maxY') {
      const { n } = parseExpect(c.e);
      if (typeof n === 'number' && c.v < n - 0.3) out.push(diag('MG303', { target, message: `${base}: the walker fell ${fmt(n - c.v)} m below the expected height`, at: pos, fix: probe.fell?.fix }));
      else if (typeof n === 'number' && c.v > n + 0.02 && k === 'y') out.push(diag('MG306', { target, message: base, at: pos, fix: probe.short?.fix }));
      else out.push(diag('MG701', { target, message: base, at: pos }));
      continue;
    }
    if (k === 'onGround') { out.push(diag('MG307', { target, message: base, at: pos })); continue; }
    if (k === 'flicker' || k === 'flickerMax' || k === 'meanAbsDiff') {
      out.push(diag('MG451', { target, message: `${base}; worst at [${(row.metrics.flickerMaxAt || []).join(', ')}] (${row.metrics.flickerWorst || 'no image'})`, at: row.metrics.flickerMaxAt, fix: `Open ${String(row.metrics.flickerWorst || '').replace(/\.png$/, '-diff.png') || 'the -worst-diff.png'} (bright = flicker). Coplanar faces: raise one 1-2 cm; thin high-contrast detail: coarsen it.` }));
      continue;
    }
    const PERF = { frameMs: 'MG501', p95Ms: 'MG502', calls: 'MG503', triangles: 'MG504' };
    if (k === 'frameMs' || k === 'p95Ms') { const t = timingWords(row.metrics, plan, ctx.heavy); out.push(diag(PERF[k], { target, message: base + t.message, fix: t.fix })); continue; }
    if (PERF[k]) { out.push(diag(PERF[k], { target, message: base, fix: ctx.heavy ? `${CODES[PERF[k]].fix.split(':')[0]}: ${ctx.heavy}.` : undefined })); continue; }
    if (k === 'luma' || k === 'dark') { out.push(diag('MG440', { target, message: base, severity: 'error', fix: ctx.lightFix })); continue; }
    if (k === 'clipped') { out.push(diag('MG441', { target, message: base, severity: 'error' })); continue; }
    if (k === 'near' || k === 'prompt') { out.push(diag('MG702', { target, message: base })); continue; }
    if (k.startsWith('flags.')) { out.push(diag('MG703', { target, message: base })); continue; }
    if (k.startsWith('inventory')) { out.push(diag('MG704', { target, message: base })); continue; }
    if (k === 'errors') continue;   // the console errors themselves are listed (MG601)
    out.push(diag('MG701', { target, message: base }));
  }
  // a stuck / timed-out walk already says why it stopped
  if (out.some((d) => d.code === 'MG301' || d.code === 'MG302')) out.splice(0, out.length, ...out.filter((d) => d.code !== 'MG305'));
  linkCauses(out, s, idx, ctx.loadDiags || []);
  // frame statistics of the step's screenshot (warnings even without an expectation)
  const hasLumaCheck = (row.checks || []).some((c) => !c.ok && (c.k === 'luma' || c.k === 'dark' || c.k === 'clipped'));
  if (!hasLumaCheck && row.frame) {
    if (row.frame.dark > 0.98 || row.frame.luma < 4) out.push(diag('MG440', { target, message: `${target}: the screenshot is black (${Math.round(row.frame.dark * 100)} % of pixels near black, mean luma ${row.frame.luma})`, fix: ctx.lightFix }));
    else {
      // not black, but an interior with almost no light: the eye is inside a module's ambientVolumes box (sky light
      // times its factor) and the frame is nearly black. The documented factor 0.35 does this in a room without a lamp.
      const vol = row.to && insideVolume([row.to[0], row.to[1] + 1.62, row.to[2]], ctx.volumes);
      if (vol && row.frame.luma < DIM_LUMA) out.push(diag('MG442', { target, at: row.to, message: `${target}: the view inside ${vol.from ? `modules/${vol.from}.js's` : 'an'} ambient volume is nearly black (mean luma ${row.frame.luma} of 255, ${Math.round(row.frame.dark * 100)} % of pixels near black)`,
        fix: `ambientVolumes multiplies the sky light by factor (here ${vol.factor ?? 0.3}) inside the box, and nothing else lights this room. Add a lamp or an emissive surface inside, raise factor (0.5 - 0.7 reads as a shaded room), or open a window to the sun; plan.render.post.exposure would brighten the outdoors too.` }));
    }
    if (row.frame.clipped > 0.35) out.push(diag('MG441', { target, message: `${target}: the screenshot is overexposed (${Math.round(row.frame.clipped * 100)} % of pixels near white)` }));
  }
  if (row.metrics && row.metrics.flickerMax > 15 && row.metrics.flickerMax > 4 * row.metrics.flicker && !out.some((d) => d.code === 'MG451')) {
    out.push(diag('MG452', { target, message: `${target}: one frame flickers ${row.metrics.flickerMax} (mean ${row.metrics.flicker}) at [${(row.metrics.flickerMaxAt || []).join(', ')}]`, at: row.metrics.flickerMaxAt }));
  }
  // budgets measured by a perf step, even without an expectation
  const b = plan && plan.budget;
  if (b && row.metrics) {
    const over = (k, code, unit) => {
      if (!(b[k] && row.metrics[k] > b[k]) || out.some((d) => d.code === code)) return;
      const t = k === 'frameMs' ? timingWords(row.metrics, plan, ctx.heavy) : null;
      out.push(diag(code, { target, severity: 'warning', message: `${target}: ${k} ${row.metrics[k]}${unit} is over plan.budget.${k} ${b[k]}${unit}${t ? t.message : ''}`, fix: t ? t.fix : ctx.heavy ? `${CODES[code].fix.split(':')[0]}: ${ctx.heavy}.` : undefined }));
    };
    over('frameMs', 'MG501', ' ms'); over('calls', 'MG503', ''); over('triangles', 'MG504', '');
  }
  return out;
}

/** A step failure caused by a load-time finding gets that finding's fix: a step at a viewpoint (or the first step,
 *  at the spawn) whose eye is inside a solid; a `see` subject that z-fights with what "hides" it. */
export function linkCauses(out, s, idx, load) {
  const view = s.viewpoint !== undefined ? `viewpoints[${s.viewpoint}]` : !s.place && (idx === 0 || s.atSpawn) ? 'spawn' : null;
  const eye = view && load.find((d) => (d.code === 'MG310' || d.code === 'MG311') && d.target === view + '.eye');
  for (const d of out) {
    if (eye && /^MG3|^MG4/.test(d.code)) { d.message += ` (caused by ${eye.code}: ${view}.eye is ${eye.code === 'MG310' ? 'inside a solid' : 'over no floor'})`; d.fix = eye.fix; continue; }
    if (d.code === 'MG402') {
      const z = load.find((l) => l.code === 'MG450' && l.target.split(' / ').some((t) => d.message.includes(t.split('/')[0] + ' ') || d.message.startsWith(t.split('/')[0])));
      if (z) { d.message += ` (it is coplanar with what hides it: ${z.code} ${z.target})`; d.fix = z.fix; }
    }
  }
}

/** the ambient volume ({ min, max, factor, from }) the point is in, or null */
// 40 of 255: between what was measured in a 6 x 5 m room with a door at midday, factor 0.35 (25 - 33 with no lamp,
// 55 - 76 with one) and a lit interior at dusk (snow-hut's stove view, 75). A mood darker than that is a warning to read.
export const DIM_LUMA = 40;
export function insideVolume(p, volumes) {
  for (const v of volumes || []) if (v && v.min && v.max && [0, 1, 2].every((k) => p[k] >= v.min[k] && p[k] <= v.max[k])) return v;
  return null;
}
/** What a slow perf step can honestly say. A time is not a cause: the runs and their spread say how far to trust it
 *  (over SPREAD_SOFT the machine was busy), and triangles are blamed only when the step's triangles or calls are over
 *  plan.budget; otherwise the largest module is named as the largest, not as the reason. */
export const SPREAD_SOFT = 0.25;
export function timingWords(metrics = {}, plan, heavy = '') {
  const runs = metrics.frameMsRuns || [], spread = metrics.frameMsSpread, b = (plan && plan.budget) || {};
  const noisy = runs.length > 1 && spread > SPREAD_SOFT;
  const message = runs.length > 1 ? ` (median of ${runs.length} runs: ${runs.join(', ')} ms; spread ${Math.round(100 * spread)} %${noisy ? ', the runs disagree' : ''})` : '';
  const overTris = b.triangles && metrics.triangles > b.triangles, overCalls = b.calls && metrics.calls > b.calls;
  const counts = metrics.triangles != null ? `this view draws ${metrics.calls} calls and ${(metrics.triangles / 1000).toFixed(1)} k triangles` : '';
  const parts = [];
  if (noisy) parts.push(`The runs differ by more than ${Math.round(100 * SPREAD_SOFT)} %: another process had the CPU or GPU. Close what is running and measure again before changing the scene`);
  if (overTris || overCalls) parts.push(`${counts}, over plan.budget (${[overTris && `triangles ${b.triangles}`, overCalls && `calls ${b.calls}`].filter(Boolean).join(', ')}): start there${heavy ? ` (${heavy})` : ''}`);
  else parts.push(`The time says the frame is slow, not why${counts ? `: ${counts}${b.triangles || b.calls ? ', inside plan.budget' : ''}` : ''}. Shadows, lamps, post effects and the pixel count cost time without adding a triangle: turn them down one at a time and measure${heavy ? `. Largest by triangles, not necessarily the cause: ${heavy}` : ''}`);
  return { message, fix: parts.join('. ') + '.', noisy };
}
/** The modules with the most triangles, as words: "modules/props.js builds 81 % (412.0 k) of 509.3 k triangles". */
export function heaviest(build) {
  if (!build || !build.modules) return '';
  const total = build.modules.reduce((s, m) => s + (m.tris || 0), 0);
  if (!total) return '';
  const top = [...build.modules].sort((a, b) => b.tris - a.tris).slice(0, 2).filter((m) => m.tris);
  return top.map((m) => `modules/${m.name}.js builds ${Math.round((100 * m.tris) / total)} % (${(m.tris / 1000).toFixed(1)} k) of ${(total / 1000).toFixed(1)} k triangles`).join('; ');
}

/** Load-time budget check from the build report: module triangles vs plan.budget.triangles. */
export function budgetAtLoad(build, plan) {
  const b = plan && plan.budget;
  if (!b || !b.triangles || !build || !build.modules) return [];
  const total = build.modules.reduce((s, m) => s + (m.tris || 0), 0);
  if (total <= b.triangles) return [];
  const top = [...build.modules].sort((a, c) => c.tris - a.tris)[0];
  const cut = Math.ceil(((total - b.triangles) / top.tris) * 100);
  return [diag('MG504', { target: top.name, severity: 'warning', message: `the modules build ${(total / 1000).toFixed(1)} k triangles, over plan.budget.triangles ${(b.triangles / 1000).toFixed(1)} k; ${heaviest(build)}`,
    fix: `Lower the detail in modules/${top.name}.js by at least ${Math.min(cut, 100)} % of its triangles (fewer segments / instances), or raise plan.budget.triangles if the target allows.` })];
}

/** Words for the light when a frame is black, from the page's light state (world-checks.mjs lightState). */
export function lightFix(light) {
  if (!light) return undefined;
  const parts = [];
  if (light.postExposure !== undefined && light.postExposure < 0.05) parts.push(`world.post.exposure is ${light.postExposure} (default 0.4): set plan.render.post.exposure to 0.4 or remove it`);
  if (light.sunElevation !== undefined && light.sunElevation < -4 && !(light.lamp > 0.2)) parts.push(`the sun is ${fmt(light.sunElevation)}° below the horizon: set plan.render.time to 'golden' or a daytime { day, time }, or add lamps`);
  if (light.autoExposure !== undefined && light.autoExposure < 0.02) parts.push(`the auto exposure is ${light.autoExposure}`);
  return parts.length ? parts.join('; ') + '.' : 'The light looks normal: check whether the camera is inside a mesh (MG310) or a black material fills the view.';
}

// ---------------------------------------------------------------------------------------------------- page probes
const mod = (l) => String(l).split('/')[0];

/** Plan fields that look like the width of an opening and are too narrow for the walker: ["plan.yard.gate = 0.4"]. */
export function narrowPlanFields(plan, near, below = 0.62) {
  const out = [];
  const walk = (o, at, depth) => {
    if (!o || typeof o !== 'object' || depth > 3) return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'paths' || k === 'regions' || k === 'footprints' || k === 'points') continue;   // a path's width is not an opening
      const named = /gate|door|opening|gap|passage|entrance|arch/i.test(k);
      if (typeof v === 'number' && (named || /width/i.test(k)) && v > 0 && v < below) out.push([`${at}.${k} = ${v}`, named ? 0 : 1, Math.abs(v - (near ?? v))]);
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${at}.${k}`, depth + 1);
    }
  };
  walk(plan, 'plan', 0);
  return out.sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([f]) => f);
}

/** probeInPage({ kind: 'stuck' }) -> { why, fix } */
export function stuckWords(p, plan) {
  if (!p) return {};
  const hit = p.hit ? `${p.hit[0]} ${p.hit[1]} m ahead` : null;
  const sideMods = [...new Set((p.sides || []).map(mod))], file = p.hit ? `modules/${mod(p.hit[0])}.js` : sideMods.length ? sideMods.map((m) => `modules/${m}.js`).join(' / ') : 'the module that builds it';
  if (p.self) return { why: `the walker itself is inside a solid at [${p.self.join(', ')}]${p.selfIn ? ` (${p.selfIn})` : ''}`, fix: `Start the walker outside ${p.selfIn || 'the solid'}: move the spawn / the step's place / the viewpoint eye out of it.` };
  const dims = (b) => `${+(b[3] - b[0]).toFixed(2)} x ${+(b[4] - b[1]).toFixed(2)} x ${+(b[5] - b[2]).toFixed(2)} m (x, y, z)`;
  const mid = (b) => `[${+((b[0] + b[3]) / 2).toFixed(2)}, ${+((b[1] + b[4]) / 2).toFixed(2)}, ${+((b[2] + b[5]) / 2).toFixed(2)}]`;
  if (p.hitCollider && p.hitBox) {
    // an invisible collision proxy is what blocks: when it does not line up with the visible meshes of its module, say so
    const v = p.visibleBox, b = p.hitBox;
    const off = v && (Math.abs((b[3] - b[0]) - (v[3] - v[0])) > 0.5 || Math.abs((b[5] - b[2]) - (v[5] - v[2])) > 0.5 || Math.hypot((b[0] + b[3] - v[0] - v[3]) / 2, (b[2] + b[5] - v[2] - v[5]) / 2) > 0.5);
    return { why: `blocked by the collision proxy of ${mod(p.hit[0])} (ctx.collider: invisible), ${p.hit[1]} m ahead: a box ${dims(b)} around ${mid(b)}${off ? `; the visible ${mod(p.hit[0])} it stands in for is ${dims(v)} around ${mid(v)}: the proxy does not line up with it` : ''}`,
      fix: off ? `Make that proxy in ${file} match the visible ${mod(p.hit[0])}: BoxGeometry(${Math.max(+(v[3] - v[0]).toFixed(2), 0.2)}, ${+(v[4] - v[1]).toFixed(2)}, ${Math.max(+(v[5] - v[2]).toFixed(2), 0.2)}) centred at ${mid(v)} (BoxGeometry takes x, y, z sizes; a rotation turns it about y). Do not add a second proxy: this one would still block.`
        : `Move or shrink that proxy in ${file} if the route should pass, or route around it.` };
  }
  if (p.rise !== undefined && p.rise >= 0.9 && p.hit && p.hitBox) {
    // too tall to be a step: an object standing on the route (often something meant to be overhead, built too low)
    const b = p.hitBox;
    return { why: `blocked by ${p.hit[0]}, ${p.hit[1]} m ahead: a solid ${dims(b)} from y ${b[1]} to y ${b[4]}, standing on the route (too tall for a step)`,
      fix: `Move ${p.hit[0]} off the route in ${file}; if it belongs overhead (a lintel, a beam, a sign), its bottom must be at least 1.9 m above the floor (now y ${b[1]}).` };
  }
  if (p.width !== undefined && p.width < 0.62) {
    const fields = narrowPlanFields(plan, p.width), between = (p.sides || []).length ? ` between ${p.sides.join(' and ')}` : '';
    return { why: `the opening ahead${between} is about ${p.width} m wide at [${p.widthAt.join(', ')}]; the walker is 0.56 m wide (radius 0.28) and needs >= 0.62 m${hit ? ` (beside it: ${hit})` : ''}`,
      fix: fields.length ? `Set ${fields[0].split(' = ')[0]} (now ${fields[0].split(' = ')[1]}) to at least 0.8, or route around the opening.` : `Widen the opening at [${p.widthAt.join(', ')}] to at least 0.8 m in ${file}, or route around it.` };
  }
  if (p.rise !== undefined) return { why: `a step of ${p.rise} m at [${p.riseAt.join(', ')}]${hit ? ` (${hit})` : ''}; the walker climbs at most 0.4 m`, fix: `Lower that step to <= 0.4 m or add an intermediate step / ramp at [${p.riseAt.join(', ')}] in ${file}.` };
  if (p.headroom !== undefined) return { why: `head room ${p.headroom} m at [${p.headAt.join(', ')}]${hit ? ` under ${p.hit[0]}` : ''}; the walker needs 1.8 m`, fix: `Raise the ceiling at [${p.headAt.join(', ')}] to at least 1.9 m above the floor in ${file}.` };
  if (p.hit) return { why: `blocked by ${hit}`, fix: `Move ${p.hit[0]} off the route in ${file}, or add a walkTo waypoint that goes around it.` };
  return { why: 'nothing measurable ahead (a corner of the walk grid?)', fix: 'Add a walkTo waypoint before the stuck point, or check the walk grid with snap.mjs.' };
}

/** probeInPage({ kind: 'through' }) -> { why, fix, at } */
export function throughWords(p) {
  if (!p) return {};
  if (p.crossed && p.crossed.length) {
    const c = p.crossed[0], [x0, y0, z0, x1, y1, z1] = c.box, file = `modules/${mod(c.label)}.js`;
    const lx = +(x1 - x0).toFixed(2), lz = +(z1 - z0).toFixed(2), h = +(y1 - y0).toFixed(2);
    const proxy = `ctx.collider(new THREE.Mesh(new THREE.BoxGeometry(${Math.max(lx, 0.2)}, ${Math.max(h, 1)}, ${Math.max(lz, 0.2)}))) positioned at [${+((x0 + x1) / 2).toFixed(2)}, ${+((y0 + y1) / 2).toFixed(2)}, ${+((z0 + z1) / 2).toFixed(2)}]`;
    const has = c.proxies && c.proxies.length ? c.proxies[0] : null;
    if (has) return { why: `it passed through ${c.label}: ${c.why}; ${file} already has a collision proxy, a box ${+(has[3] - has[0]).toFixed(2)} x ${+(has[4] - has[1]).toFixed(2)} x ${+(has[5] - has[2]).toFixed(2)} m (x, y, z) around [${+((has[0] + has[3]) / 2).toFixed(2)}, ${+((has[1] + has[4]) / 2).toFixed(2)}, ${+((has[2] + has[5]) / 2).toFixed(2)}], but it does not cover this crossing`,
      fix: `Correct that proxy in ${file} to ${proxy.replace(/^ctx\.collider\(new THREE\.Mesh\(new THREE\.BoxGeometry/, 'BoxGeometry').replace(/\)\)\) positioned/, ') positioned')} (BoxGeometry takes x, y, z sizes) instead of adding a second one: a wrong proxy also blocks where nothing is.`, at: c.at };
    const fix = /collide = false/.test(c.why) ? `Remove userData.collide = false from ${c.label} in ${file}, or add ${proxy}.`
      : /transparent/.test(c.why) ? `Add ${proxy} in ${file} (glass and water need a collision proxy).`
      : `Add ${proxy} in ${file} (a proxy at least 0.2 m thick that the walk grid sees).`;
    return { why: `it passed through ${c.label}: ${c.why}`, fix, at: c.at };
  }
  if (p.gap) {
    const { left, right, axis, at } = p.gap;
    const span = left && right ? `between ${left[0]} (ends at ${axis} ${left[1]}) and ${right[0]} (starts at ${axis} ${right[1]})` : left ? `past the end of ${left[0]} (ends at ${axis} ${left[1]})` : right ? `before the start of ${right[0]} (starts at ${axis} ${right[1]})` : 'with no barrier anywhere near';
    const file = left ? `modules/${mod(left[0])}.js` : right ? `modules/${mod(right[0])}.js` : 'the module that should build the barrier';
    return { why: `there is no geometry where it crossed [${at.join(', ')}]: a gap ${span}`, fix: left && right ? `Close the gap from ${axis} ${left[1]} to ${right[1]} in ${file} (the segments should meet), or move the expectation if the opening is meant.` : `Build the barrier across [${at.join(', ')}] in ${file}.`, at };
  }
  return {};
}

/** worldChecksInPage findings -> diagnostics. */
export function fromWorldChecks(f) {
  if (!f) return [];
  const out = [];
  for (const e of f.eyes || []) {
    const t = `${e.path}${e.name && e.path !== 'spawn' ? ` "${e.name}"` : ''}`, free = e.free ? `[${xyz(e.free)}]` : null;
    if (e.state === 'inside') out.push(diag('MG310', { target: `${e.path}.eye`, at: e.eye, message: `${t}: the ${e.mode === 'walk' || e.mode === 'game' ? 'body' : 'eye'} at [${xyz(e.eye)}] is inside a solid${e.inside ? ` (${e.inside})` : ''}; floors in that column: ${(e.floors || []).join(', ')}`, fix: free ? (e.freeFitsOnly ? `Move ${e.path}.eye out of ${e.inside || 'the solid'}. The nearest spot where it fits is ${free}, but from there it does not ${e.mode === 'walk' || e.mode === 'game' ? 'see its look point or cannot walk toward it' : 'see its look point'}: choose a spot in the open, or move ${e.inside || 'the solid'}.` : `Set ${e.path}.eye to ${free}, and keep its look: the nearest spot that is free, sees its look point${e.mode === 'walk' || e.mode === 'game' ? ' and has 1.5 m to walk toward it' : ''}.`) : `Move ${e.path}.eye out of ${e.inside || 'the solid'}.` }));
    else if (e.state === 'head') out.push(diag('MG310', { target: `${e.path}.eye`, at: e.eye, message: `${t}: the head is inside a solid: ceiling at y ${e.ceil} under the eye at ${fmt(e.eye[1])} (floor ${e.floor})${e.inside ? ` (${e.inside})` : ''}`, fix: free ? `Set ${e.path}.eye to ${free}.` : `Move ${e.path}.eye where there is 1.8 m of head room.` }));
    else if (e.state === 'nofloor') out.push(diag('MG311', { target: `${e.path}.eye`, at: e.eye, message: `${t}: no floor under [${xyz(e.eye)}] in the walk grid (a hole, or the floor is not solid / outside plan.walk)` }));
    else if (e.state === 'outside') out.push(diag(e.path === 'spawn' ? 'MG110' : 'MG311', { target: `${e.path}.eye`, at: e.eye, message: `${t}: [${xyz(e.eye)}] is outside plan.bounds`, severity: e.path === 'spawn' ? 'error' : 'warning' }));
    else if (e.state === 'floating' && e.path === 'spawn') out.push(diag('MG312', { target: 'spawn.eye[1]', at: e.eye, message: `spawn: the feet are ${e.drop} m above the floor at y ${e.floor}; the walker drops on load`, fix: `Set spawn.eye[1] to ${fmt(e.floor + 1.62)} (floor ${e.floor} + 1.62).` }));
  }
  for (const o of f.floating || []) {
    out.push(diag('MG320', { target: o.label, at: o.center, message: `${o.label} floats ${o.gap} m above the floor under it (its bottom at y ${o.bottom}, the floor at y ${o.floor})`, fix: `Lower ${o.label} by ${o.gap} m in modules/${o.module}.js (its bottom to y ${o.floor}), or mark it userData.float = true if it is meant to hover.` }));
  }
  for (const z of f.zfight || []) {
    out.push(diag('MG450', { target: `${z.a} / ${z.b}`, at: z.at, message: `${z.a} and ${z.b} have coplanar upward faces at y ${z.y}: they z-fight (flicker) where they overlap`, fix: `Raise ${z.a} by 0.01 m (to y ${+(z.y + 0.01).toFixed(3)}) in modules/${z.moduleA}.js, or cut it out of ${z.b}.` }));
  }
  for (const v of f.views || []) {
    const t = `${v.path}${v.path !== 'spawn' ? ` "${v.name}"` : ''}`;
    if (v.empty > 0.97) { out.push(diag('MG410', { target: `${v.path}.look`, message: `${t}: ${Math.round(v.empty * 100)} % of the view is sky or void` })); continue; }
    if (v.top && v.top[1] > 0.9 && v.ahead && v.ahead[1] < 1.0) out.push(diag('MG411', { target: `${v.path}.eye`, message: `${t}: ${v.top[0]} fills ${Math.round(v.top[1] * 100)} % of the view, ${v.ahead[1]} m in front of the eye`, fix: `Move ${v.path}.eye back from ${v.top[0]} (at least 2 m), or turn its look away from it.` }));
    const names = Object.keys(v.shares || {});
    if (names.length) {
      const missing = names.filter((n) => !(v.shares[n] > 0.001));
      const target = (v.subjects ? missing : missing.length === names.length ? names : []).sort((a, b) => (b === v.name) - (a === v.name));
      if (target.length) {
        const c = v.centres[target[0]];
        out.push(diag('MG412', { target: `${v.path}.look`, message: v.subjects ? `${t}: its see list is not in view: ${target.join(', ')}` : `${t}: the view is named after ${names.join(', ')} but does not show it`, fix: c ? `Set ${v.path}.look to [${xyz(c)}] (the centre of ${target[0]}).` : undefined, at: c || undefined }));
      }
    }
  }
  return out;
}
