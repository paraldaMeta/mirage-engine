// Mirage original code.
// ---------------------------------------------------------------------------
// @mirage/editor: a visual editor that runs in the browser against a live Mirage world.
//
//   npx mirage-editor examples/hello-courtyard --write      # the editor itself (bin/mirage-editor.mjs, server.mjs)
//
//   import { editable } from '@mirage/editor/runtime';      // the three lines a project adds (runtime.js)
//   import { startEditor } from '@mirage/editor/server';    // the dev server, from a script (Node)
//   import { applyEdits, planHash, createDocument } from '@mirage/editor';   // the data side, no DOM
//
// This entry is the data model and the runtime half; the client (src/client) is loaded by the server into the
// project's page and is not an API.
// ---------------------------------------------------------------------------
export { LAYER_VERSION, emptyLayer, normalizeLayer, isEmptyLayer, applyEdits, planHash, serializeLayer } from './layer.js';
export { createDocument } from './document.js';
export { OBJECT_TYPES, newObject, planElements, schemaAt, fieldsFromSchema } from './schema.js';
export { editable, createPlaced, applyNodes, applyEnv, createTimelines, createTriggers } from './runtime.js';
