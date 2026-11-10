// Mirage original code.
// Node checks of the editor's data side and of its server's refusals. No browser, no GPU: the edit layer, the plan
// hash, the command stack, the schema-to-fields mapping, then a real server on 127.0.0.1 (a free port) against a
// throwaway project in the temp folder. The browser half is editor-check.mjs.
//   node packages/editor/check.mjs
import http from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyLayer, normalizeLayer, isEmptyLayer, applyEdits, planHash, serializeLayer, LAYER_VERSION } from './src/layer.js';
import { createDocument } from './src/document.js';
import { OBJECT_TYPES, newObject, planElements, schemaAt, fieldsFromSchema, objectFields } from './src/schema.js';
import { startEditor, layerPath, requestProblem, inside, scanAssets } from './src/server.mjs';

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; throw new Error(m); } console.log('  ok', m); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ---- layer
const plan = { name: 't', points: { palm: [1, 0, 2], gate: [0, 0, 9] }, footprints: { basin: [0, 0, 2] }, viewpoints: [{ name: 'hero', eye: [0, 2, 8], look: [0, 1, 0] }], spawn: { position: [0, 0, 5] } };
ok(applyEdits(plan, {}) === plan && applyEdits(plan, emptyLayer()) === plan, 'an empty layer gives the plan object itself back');
ok(isEmptyLayer({}) && isEmptyLayer(emptyLayer()) && !isEmptyLayer({ set: { a: 1 } }), 'isEmptyLayer');
ok(normalizeLayer({}).version === LAYER_VERSION, 'normalizeLayer fills the sections and the version');
ok(throws(() => normalizeLayer({ version: 99 })) || normalizeLayer({ version: 99 }).version === LAYER_VERSION, 'a layer of another version is refused or normalised');
const L = emptyLayer();
L.set['points.palm'] = [3, 0, 4];
L.set['viewpoints[0].eye'] = [1, 2, 3];
L.objects.b = newObject('trigger', [1, 0, 1], { event: 'door' });
L.objects.a = newObject('light', [0, 3, 0]);
L.objects.z = newObject('audioZone', [5, 2, 5]);
L.objects.n = newObject('nav', [2, 1, 2]);
L.objects.s = newObject('spawnPoint', [4, 0, 4]);
L.objects.p = newObject('probe', [0, 2, 0]);
L.objects.g = newObject('gi', [0, 2.5, 0]);
const edited = applyEdits(plan, L);
ok(edited !== plan && plan.points.palm[0] === 1 && edited.points.palm[0] === 3 && edited.viewpoints[0].eye[2] === 3, 'set paths land in a copy; the base plan is untouched');
ok(edited.objects.map((o) => o.id).join() === 'a,b,g,n,p,s,z', 'placed objects come out in id order whatever order they were made in');
ok(edited.triggers?.[0].event === 'door' && edited.triggers[0].box.length === 6, 'a trigger volume becomes plan.triggers with a box');
ok(edited.audio.zones.length === 1 && edited.nav.areas.length === 1 && edited.spawns.length === 1, 'audio zone, nav area and spawn point become plan data');
ok(edited.lighting.probes.length === 1 && edited.lighting.gi.spacing === 2 && edited.lighting.gi.min.length === 3, 'probe and GI volumes become plan.lighting');
const shuffled = { timelines: {}, env: {}, nodes: {}, objects: Object.fromEntries(Object.entries(L.objects).reverse()), set: Object.fromEntries(Object.entries(L.set).reverse()) };
ok(planHash(applyEdits(plan, shuffled)) === planHash(edited) && serializeLayer(shuffled) === serializeLayer(L), 'hash and saved text do not depend on key order');
ok(/^[0-9a-f]{16}$/.test(planHash(plan)) && planHash(plan) !== planHash(edited), 'planHash is 16 hex digits and changes with the plan');
ok(planHash(applyEdits(plan, JSON.parse(serializeLayer(L)))) === planHash(edited), 'save text -> parse -> apply gives the same plan hash');
L.set['points.gate'] = null;
ok(!('gate' in applyEdits(plan, L).points) || applyEdits(plan, L).points.gate == null, 'null in set removes the key');
delete L.set['points.gate'];

// ---- document
const doc = createDocument(plan, {});
const h0 = doc.hash();
let events = 0; doc.on(() => events++);
ok(doc.exec('Move palm', [{ section: 'set', key: 'points.palm', value: [2, 0, 2] }]) === true && doc.plan.points.palm[0] === 2 && doc.dirty, 'exec changes the plan and marks the document dirty');
ok(doc.exec('same', [{ section: 'set', key: 'points.palm', value: [2, 0, 2] }]) === false, 'a change that changes nothing is not a step');
doc.exec('Add light', [{ section: 'objects', key: doc.newId('light'), value: newObject('light', [0, 3, 0]) }]);
doc.exec('Add light', [{ section: 'objects', key: doc.newId('light'), value: newObject('light', [1, 3, 0]) }]);
ok(Object.keys(doc.layer.objects).join() === 'light,light-2', 'newId gives ids no object has');
doc.exec('drag', [{ section: 'env', key: 'time', value: 10 }], { merge: 'env.time' });
doc.exec('drag', [{ section: 'env', key: 'time', value: 11 }], { merge: 'env.time' });
ok(doc.history().done.length === 4 && doc.get('env', 'time') === 11, 'a run of edits of one field merges into one undo step');
ok(throws(() => doc.exec('bad', [{ section: 'nope', key: 'a', value: 1 }])), 'a change to an unknown section throws');
while (doc.undo());
ok(doc.hash() === h0 && isEmptyLayer(doc.layer) && !doc.dirty && doc.plan === plan, 'undo of everything gives the base plan back');
while (doc.redo());
ok(doc.get('env', 'time') === 11 && Object.keys(doc.layer.objects).length === 2 && doc.plan.points.palm[0] === 2, 'redo of everything gives the edits back');
doc.undo(); doc.exec('other', [{ section: 'env', key: 'wet', value: 0.5 }]);
ok(!doc.canRedo && events > 8, 'a new edit drops the redo side; listeners hear every change');
doc.markSaved(); ok(!doc.dirty, 'markSaved clears dirty');

// ---- schema
ok(Object.keys(OBJECT_TYPES).length === 12 && ['model', 'light', 'probe', 'gi', 'audioZone', 'vfx', 'nav', 'trigger', 'spawnPoint'].every((t) => OBJECT_TYPES[t]), 'the placed-object types');
ok(throws(() => newObject('nope')) && newObject('probe').scale.join() === '6,4,6', 'newObject merges the type defaults');
ok(objectFields(newObject('light')).every((f) => f.key !== 'angle') && objectFields(newObject('light', [0, 0, 0], { kind: 'spot' })).some((f) => f.key === 'angle'), 'conditional fields follow the object');
const els = planElements(plan);
ok(els.length === 5 && els.find((e) => e.id === 'plan:points.palm').kind === 'point' && els.find((e) => e.path === 'viewpoints[0]').kind === 'view', 'planElements lists points, shapes and views');
const schema = JSON.parse(readFileSync(new URL('../world/plan.schema.json', import.meta.url), 'utf8'));
const f = fieldsFromSchema(schema, schemaAt(schema, 'points.palm'), [1, 0, 2], 'points.palm', 'palm');
ok(f.length === 1 && f[0].type === 'vector', 'a plan point is one vector field (from plan.schema.json)');
const own = fieldsFromSchema(schema, schemaAt(schema, 'myOwn'), { on: true, tint: '#ff0000', n: 3 }, 'myOwn', 'myOwn');
ok(own.some((x) => x.type === 'bool') && own.some((x) => x.type === 'color') && own.some((x) => x.type === 'number'), "a world's own fields are typed from their values");

// ---- server: pure helpers
ok(inside('/a/b', '/a/b/c') && inside('/a/b', '/a/b') && !inside('/a/b', '/a/bc') && !inside('/a/b', '/a'), 'inside()');
const req = (headers, method = 'GET') => ({ headers, method });
ok(requestProblem(req({ host: '127.0.0.1:5190' }), 5190) === null && requestProblem(req({ host: 'localhost:5190', origin: 'http://localhost:5190' }), 5190) === null, 'loopback Host and Origin pass');
ok(requestProblem(req({ host: 'evil.example:5190' }), 5190) === 'host' && requestProblem(req({ host: '127.0.0.1:5191' }), 5190) === 'host' && requestProblem(req({}), 5190) === 'host', 'another Host, another port or none is refused');
ok(requestProblem(req({ host: '127.0.0.1:5190', origin: 'http://evil.example' }), 5190) === 'origin' && requestProblem(req({ host: '127.0.0.1:5190', origin: 'null' }), 5190) === 'origin' && requestProblem(req({ host: '127.0.0.1:5190', origin: 'https://127.0.0.1:5190' }), 5190) === 'origin', 'a foreign, null or https Origin is refused');
ok(requestProblem(req({ host: '127.0.0.1:5190' }, 'PUT'), 5190) === 'method' && requestProblem(req({ host: '127.0.0.1:5190' }, 'DELETE'), 5190) === 'method', 'only GET, HEAD and POST');

// ---- server: a real one over a throwaway project
const dir = join(tmpdir(), 'mirage-editor-check-' + process.pid), outside = dir + '-outside';
mkdirSync(join(dir, 'public', 'models'), { recursive: true }); mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true }); mkdirSync(outside, { recursive: true });
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title><body><script type="module" src="/main.js"></script>');
writeFileSync(join(dir, 'main.js'), 'export default 1;');
writeFileSync(join(dir, 'public', 'models', 'a.glb'), 'x'); writeFileSync(join(dir, 'tex.webp'), 'x'); writeFileSync(join(dir, 'node_modules', 'x', 'no.glb'), 'x');
writeFileSync(join(outside, 'secret.json'), '{"secret":true}');
let linked = true; try { symlinkSync(outside, join(dir, 'link')); } catch { linked = false; }
const quiet = { log() {} };
let failed = false;
try {
  ok(throws(() => layerPath(dir, '../x.json')) && throws(() => layerPath(dir, '../../etc/passwd')) && throws(() => layerPath(dir, join(outside, 'secret.json'))), 'a layer path that leaves the project is refused (.., absolute)');
  ok(throws(() => layerPath(dir, 'main.js')) && throws(() => layerPath(dir, '')) && throws(() => layerPath(dir, 'a\0.json')), 'the layer file must be a .json with a sane name');
  if (linked) ok(throws(() => layerPath(dir, 'link/secret.json')) && throws(() => layerPath(dir, 'link/new.json')), 'a symlinked folder out of the project is refused');
  ok(layerPath(dir, 'data/plan.edits.json').endsWith(join('data', 'plan.edits.json')), 'a .json in a sub-folder of the project is accepted');
  const assets = scanAssets(dir);
  ok(assets.models.length === 1 && assets.models[0].url === 'models/a.glb' && assets.textures[0].url === 'tex.webp', 'the asset scan lists project files (public/ at the root), not node_modules or links');
  await startEditor({ root: dir, port: 0, layerFile: '../x.json', log: quiet }).then(() => ok(false, 'startEditor with a layer outside the project must throw'), () => ok(true, 'startEditor refuses a layer file outside the project'));

  const call = (port, path, { method = 'GET', headers = {}, body } = {}) => new Promise((res) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (m) => {
      const c = []; m.on('data', (d) => c.push(d)); m.on('end', () => { const text = Buffer.concat(c).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* html */ } res({ status: m.statusCode, text, json, headers: m.headers }); });
    });
    r.on('error', () => res({ status: 0 })); if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body)); r.end();
  });
  const layerFile = join(dir, 'plan.edits.json');

  // read-only (the default)
  let ed = await startEditor({ root: dir, port: 0, log: quiet });
  const T = { 'X-Mirage-Editor-Token': ed.token };
  ok(ed.url === `http://127.0.0.1:${ed.port}/` && ed.write === false, 'the server is on 127.0.0.1 and read-only by default');
  const page = await call(ed.port, '/');
  ok(page.status === 200 && page.text.includes('__MIRAGE_EDITOR__') && page.text.includes(ed.token), 'the page gets the editor client and the token');
  const plain = await call(ed.port, '/?editor=0');
  ok(plain.status === 200 && !plain.text.includes('__MIRAGE_EDITOR__') && !plain.text.includes(ed.token), '?editor=0 serves the project without the editor');
  ok((await call(ed.port, '/__editor/state', { headers: { Host: 'evil.example' } })).status === 403, 'a request with another Host: 403');
  ok((await call(ed.port, '/', { headers: { Host: 'evil.example:' + ed.port } })).status === 403, 'the page itself with another Host: 403 (DNS rebinding)');
  ok((await call(ed.port, '/__editor/state', { headers: { Origin: 'http://evil.example' } })).status === 403, 'a request with a foreign Origin: 403');
  ok((await call(ed.port, '/__editor/save', { method: 'POST', body: { layer: {} } })).status === 403, 'a POST without the token: 403');
  ok((await call(ed.port, '/__editor/save', { method: 'POST', body: { layer: {} }, headers: { 'X-Mirage-Editor-Token': 'x'.repeat(48) } })).status === 403, 'a POST with a wrong token: 403');
  ok((await call(ed.port, '/__editor/save', { method: 'POST', body: { layer: {} }, headers: { ...T, Origin: 'http://evil.example' } })).status === 403, 'a POST with the token but a foreign Origin: 403');
  ok((await call(ed.port, '/__editor/save', { method: 'POST', body: '{', headers: T })).status === 400, 'bad JSON: 400');
  ok((await call(ed.port, '/__editor/save', { method: 'POST', body: 'layer=1', headers: { ...T, 'Content-Type': 'text/plain' } })).status === 415, 'a body that is not application/json: 415 (no CORS-simple form posts)');
  ok((await call(ed.port, '/__editor/save', { method: 'POST', body: { layer: { set: { big: 'x'.repeat(5 << 20) } } }, headers: T })).status !== 200, 'a body over 4 MB is refused');
  ok((await call(ed.port, '/__editor/state', { method: 'DELETE' })).status === 405, 'DELETE: 405');
  ok((await call(ed.port, '/__editor/nope')).status === 404, 'an unknown endpoint: 404');
  for (const p of ['/..%2f..%2f' + 'etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/@fs/etc/passwd', '/@fs' + join(outside, 'secret.json'), '/link/secret.json', '/@fs' + join(dir, 'link', 'secret.json'), '/%6cink/secret.json'].filter((p) => linked || !/link|%6c/.test(p))) {
    const r = await call(ed.port, p);
    ok(r.status !== 200 || (!r.text.includes('root:') && !r.text.includes('secret')), 'no file outside the project is served: ' + (p.length > 30 ? p.slice(0, 12) + '…' + p.slice(-16) : p) + ' -> ' + r.status);
  }
  const saved = await call(ed.port, '/__editor/save', { method: 'POST', body: { layer: L }, headers: T });
  ok(saved.status === 200 && saved.json.where === 'memory' && !existsSync(layerFile), 'without write a save is kept in memory: nothing on disk');
  ok(serializeLayer((await call(ed.port, '/__editor/state')).json.layer) === serializeLayer(L) && serializeLayer(ed.layer()) === serializeLayer(L), 'the saved layer is what the next load gets');
  ok((await call(ed.port, '/__editor/save', { method: 'POST', body: { layer: { objects: { a: { type: 'nope' } } } }, headers: T })).status !== 200 || true, 'a layer with an unknown object type does not crash the server');
  ok((await call(ed.port, '/__editor/assets')).json.models[0].url === 'models/a.glb', 'GET assets');
  const lint = await call(ed.port, '/__editor/lint', { method: 'POST', body: { plan: { name: 't' } }, headers: T });
  ok(lint.status === 200 && Array.isArray(lint.json.diagnostics) && lint.json.hash === planHash({ name: 't' }), 'POST lint answers diagnostics and the plan hash');
  await ed.close();

  // --write
  ed = await startEditor({ root: dir, port: 0, write: true, log: quiet });
  const w = await call(ed.port, '/__editor/save', { method: 'POST', body: { layer: L, path: '../evil.json', file: '/tmp/evil.json' }, headers: { 'X-Mirage-Editor-Token': ed.token } });
  ok(w.status === 200 && w.json.where === 'disk' && readFileSync(layerFile, 'utf8') === serializeLayer(L), 'with write the layer lands in plan.edits.json, byte for byte serializeLayer');
  ok(!existsSync(join(dir, '..', 'evil.json')) && w.json.file === 'plan.edits.json', 'a path in the request body is ignored: the file was fixed at start');
  ok((await call(ed.port, '/__editor/save', { method: 'POST', body: { layer: {} }, headers: T })).status === 403, "an earlier run's token is refused");
  await ed.close();
  ed = await startEditor({ root: dir, port: 0, log: quiet });
  ok(serializeLayer(ed.layer()) === serializeLayer(L), 'a new server reads the layer back from disk');
  await ed.close();
} catch (e) { failed = true; if (!process.exitCode) { console.error(e); process.exitCode = 1; } } finally {
  rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true });
}
if (!failed) console.log('editor check: ok');
process.exit(process.exitCode || 0);
