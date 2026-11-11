// Mirage original code.
// ---------------------------------------------------------------------------
// The editor's local server: the project's own page (through Vite, so its imports resolve exactly as in `vite dev`)
// with the editor's client injected, plus four small endpoints under /__editor/.
//
//   const ed = await startEditor({ root: 'examples/hello-courtyard', port: 5190, write: false });
//   ed.url  ->  http://127.0.0.1:5190/        ed.layer()  ed.close()
//
// This process can write a file, so it is deliberately narrow:
//   - it listens on 127.0.0.1 and nowhere else (there is no host option);
//   - every request must carry a Host that is this server on a loopback name (a DNS-rebinding page has another),
//     and an Origin, when the browser sends one, that is this server too;
//   - POSTs need the per-run token the injected page holds, and a JSON body under 4 MB;
//   - the one file it writes is fixed when it starts (plan.edits.json, or --layer), must lie inside the project
//     directory after symlinks are resolved, and is only written with `write: true` (--write). Without it a save is
//     kept in memory: reloads see it, the disk does not. No request names a path to write;
//   - the asset listing walks the project directory only, follows no symlinks and skips dot folders, node_modules
//     and build output. Files themselves are served by Vite under its own fs.strict rules, after a check here that
//     the path, with links resolved, is still inside the workspace.
// GET  /__editor/state    { name, write, layerFile, layer }
// GET  /__editor/assets   { models, textures, audio }: project-relative URLs
// POST /__editor/save     { layer } -> { ok, where: 'disk' | 'memory', bytes, hash }
// POST /__editor/lint     { plan, report?, errors? } -> { diagnostics } (the MG codes of docs/diagnostics.md)
// `?editor=0` on the page URL serves the project without the editor: what a visitor of the project gets.
// ---------------------------------------------------------------------------
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, realpathSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join, sep, dirname, basename, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLayer, serializeLayer, emptyLayer, planHash } from './layer.js';

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 4 << 20;
const KINDS = { models: ['.glb', '.gltf'], textures: ['.webp', '.png', '.jpg', '.jpeg', '.ktx2'], audio: ['.wav', '.ogg', '.mp3', '.m4a'] };
const SKIP = new Set(['node_modules', 'dist', 'out', 'release', 'deploy']);

/** true when `file` is `root` or inside it (both already resolved; no ".." can survive resolve()). */
export const inside = (root, file) => file === root || file.startsWith(root.endsWith(sep) ? root : root + sep);

/** The file the editor may write: inside the project after symlinks, a .json, never anything else. Throws otherwise. */
export function layerPath(root, layerFile = 'plan.edits.json') {
  if (typeof layerFile !== 'string' || !layerFile || layerFile.includes('\0')) throw new Error('editor: bad layer file name');
  const real = realpathSync(resolve(root)), file = resolve(real, layerFile);
  if (extname(file) !== '.json') throw new Error('editor: the layer file must be a .json file');
  if (!inside(real, file) || file === real) throw new Error('editor: the layer file must be inside the project directory');
  // the folder it lands in may be a symlink out of the project: resolve what exists of it
  let dir = dirname(file);
  while (!existsSync(dir)) dir = dirname(dir);
  if (!inside(real, realpathSync(dir))) throw new Error('editor: the layer file must be inside the project directory');
  if (existsSync(file) && !inside(real, realpathSync(file))) throw new Error('editor: the layer file is a link out of the project directory');
  return file;
}

/** Host and Origin of a request against this server's port: null when fine, else the reason. */
export function requestProblem(req, port) {
  const host = String(req.headers.host || '').toLowerCase();
  const ok = (h) => LOOPBACK.some((n) => h === n + ':' + port || (port === 80 && h === n));
  if (!ok(host)) return 'host';
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let o; try { o = new URL(origin); } catch { return 'origin'; }
    if (o.protocol !== 'http:' || !ok(o.host.toLowerCase() || '')) return 'origin';
  }
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) return 'method';
  return null;
}

/** Project-relative URLs of the files an editor can place, by kind. */
export function scanAssets(root, { limit = 5000 } = {}) {
  const out = { models: [], textures: [], audio: [] };
  let seen = 0;
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let list; try { list = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.isSymbolicLink() || ++seen > limit) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, depth + 1); continue; }
      const ext = extname(e.name).toLowerCase(), kind = Object.keys(KINDS).find((k) => KINDS[k].includes(ext));
      if (kind) out[kind].push({ url: relative(root, p).split(sep).join('/').replace(/^public\//, ''), bytes: statSync(p).size });   // public/ is served at the root
    }
  };
  walk(root, 0);
  return out;
}

function readBody(req) {
  return new Promise((done, fail) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return fail(Object.assign(new Error('expected application/json'), { status: 415 }));
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { fail(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { done(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { fail(Object.assign(new Error('bad JSON'), { status: 400 })); } });
    req.on('error', fail);
  });
}

// Vite's dev client opens a hot-reload socket; this server has none on purpose (one port, plain HTTP, every request
// checked), and the editor reloads the page itself. What modules import from the client is small, so it is served
// from here: style injection for imported CSS, and a hot context that never fires.
const VITE_CLIENT = `const sheets = new Map();
export function updateStyle(id, css) { let s = sheets.get(id); if (!s) { s = document.createElement('style'); s.setAttribute('data-vite-dev-id', id); document.head.appendChild(s); sheets.set(id, s); } s.textContent = css; }
export function removeStyle(id) { sheets.get(id)?.remove(); sheets.delete(id); }
const hot = { data: {}, accept() {}, acceptExports() {}, dispose() {}, prune() {}, invalidate() { location.reload(); }, on() {}, off() {}, send() {} };
export const createHotContext = () => hot;
export const injectQuery = (url) => url;
export class ErrorOverlay {}
`;

/**
 * Start the editor for one project directory (it needs an index.html that Vite can serve).
 * { root, port = 5190 (0 = any free one), write = false, layerFile = 'plan.edits.json', log = console }
 */
export async function startEditor({ root, port = 5190, write = false, layerFile = 'plan.edits.json', log = console } = {}) {
  if (!root) throw new Error('editor: no project directory');
  root = realpathSync(resolve(root));
  if (!statSync(root).isDirectory() || !existsSync(join(root, 'index.html'))) throw new Error('editor: ' + root + ' has no index.html');
  const file = layerPath(root, layerFile), token = randomBytes(24).toString('hex');
  let layer = existsSync(file) ? normalizeLayer(JSON.parse(readFileSync(file, 'utf8'))) : emptyLayer();
  let where = 'disk', name = basename(root);
  try { name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name || name; } catch { /* a folder without a package.json */ }

  const { createServer: createVite, searchForWorkspaceRoot } = await import('vite');
  const client = join(HERE, 'client', 'main.js');
  const allow = [realpathSync(searchForWorkspaceRoot(root)), realpathSync(dirname(HERE))];
  // Vite checks the path as written; a link inside the project that points out of it would pass. Resolve it first.
  const linkedOut = (pathname) => {
    let rel; try { rel = decodeURIComponent(pathname); } catch { return true; }
    if (rel.includes('\0')) return true;
    if (rel.startsWith('/@fs/')) { const f = resolve(rel.slice(4)); return existsSync(f) && !allow.some((a) => inside(a, realpathSync(f))); }
    if (rel.startsWith('/@')) return false;   // Vite's own virtual ids
    for (const base of [root, join(root, 'public')]) {
      const f = resolve(base, '.' + (rel.startsWith('/') ? rel : '/' + rel));
      if (!inside(base, f)) return true;
      if (existsSync(f)) { const real = realpathSync(f); if (!allow.some((a) => inside(a, real))) return true; }
    }
    return false;
  };
  const boot = () => ({ token, write, name, layerFile: relative(root, file).split(sep).join('/'), layer });
  const vite = await createVite({
    root, clearScreen: false, logLevel: 'warn', appType: 'mpa',
    cacheDir: join(root, 'node_modules', '.vite-editor'),   // not the project's own dev cache
    server: { middlewareMode: true, hmr: false, ws: false, fs: { strict: true, allow } },
    optimizeDeps: { include: ['three', 'three/addons/controls/TransformControls.js'] },
    plugins: [{
      name: 'mirage-editor',
      transformIndexHtml: {
        order: 'pre',
        handler(html, ctx) {
          if (new URL(ctx.originalUrl || '/', 'http://x').searchParams.get('editor') === '0') return html;
          // "<" escaped: the layer is data from disk and must not be able to close the script element
          const json = JSON.stringify(boot()).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));
          return [
            { tag: 'script', children: 'globalThis.__MIRAGE_EDITOR__ = ' + json + ';', injectTo: 'head-prepend' },
            { tag: 'script', attrs: { type: 'module', src: '/@fs/' + client.split(sep).join('/').replace(/^\//, '') }, injectTo: 'body' },
          ];
        },
      },
    }],
  });

  const send = (res, status, body) => { const s = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(s); };
  const tokenOk = (req) => { const t = Buffer.from(String(req.headers['x-mirage-editor-token'] || '')), w = Buffer.from(token); return t.length === w.length && timingSafeEqual(t, w); };
  let diagnostics = null;

  async function api(req, res, path) {
    if (req.method === 'GET' && path === 'state') return send(res, 200, { name, write, layerFile: boot().layerFile, layer, where });
    if (req.method === 'GET' && path === 'assets') return send(res, 200, scanAssets(root));
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
    if (!tokenOk(req)) return send(res, 403, { error: 'token' });
    const body = await readBody(req);
    if (path === 'save') {
      const next = normalizeLayer(body.layer), text = serializeLayer(next);
      if (write) {
        const target = layerPath(root, layerFile);   // checked again: the folder may have changed since start
        mkdirSync(dirname(target), { recursive: true });
        const tmp = target + '.' + process.pid + '.tmp';
        writeFileSync(tmp, text); renameSync(tmp, target);
        for (const m of vite.moduleGraph.getModulesByFile(target) || []) vite.moduleGraph.invalidateModule(m);
      }
      layer = next; where = write ? 'disk' : 'memory';
      return send(res, 200, { ok: true, where, bytes: Buffer.byteLength(text), file: boot().layerFile });
    }
    if (path === 'lint') {
      diagnostics ??= await Promise.all([import('@mirage/tools/src/diagnostics.mjs'), import('@mirage/world/plan-validation')]);
      const [D, P] = diagnostics, plan = body.plan, out = [];
      if (plan && typeof plan === 'object') {
        const issues = P.planIssues(plan);
        out.push(...D.fromPlanIssues(issues));
        if (!issues.length) out.push(...D.lintPlan(plan));
        if (body.report) out.push(...D.fromBuildReport(body.report, plan, Array.isArray(body.errors) ? body.errors : []));
      }
      return send(res, 200, { diagnostics: D.sortDiagnostics(out), hash: plan ? planHash(plan) : null });
    }
    return send(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    const bad = requestProblem(req, server.address().port);
    if (bad) return send(res, bad === 'method' ? 405 : 403, { error: bad });
    let url; try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return send(res, 400, { error: 'url' }); }
    if (url.pathname.startsWith('/__editor/')) return api(req, res, url.pathname.slice('/__editor/'.length)).catch((e) => send(res, e.status || 400, { error: String(e.message || e) }));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (linkedOut(url.pathname)) return send(res, 403, { error: 'path' });
    if (url.pathname === '/@vite/client') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(VITE_CLIENT); }
    vite.middlewares(req, res, () => send(res, 404, { error: 'not found' }));
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  const at = server.address().port, url = 'http://127.0.0.1:' + at + '/';
  log.log?.(`[editor] ${name}: ${url}  (${write ? 'saves to ' + relative(process.cwd(), file) : 'read-only: saves stay in memory, start with --write to write ' + basename(file)})`);
  return {
    url, port: at, root, token, file, write,
    layer: () => layer,
    async close() { await new Promise((done) => { server.closeAllConnections?.(); server.close(done); }); await vite.close(); },
  };
}
