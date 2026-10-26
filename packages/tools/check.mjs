// Checks of the shared browser helpers in the local headless Chrome: node packages/tools/check.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, serve, open } from "./src/chrome.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirage-tools-check-"));
const page = (body) => `<!doctype html><link rel="icon" href="data:,"><script>${body}; window.__READY = true;</script>`;
fs.writeFileSync(path.join(dir, "warn.html"), page("console.warn(\"a driver warning\")"));
fs.writeFileSync(path.join(dir, "error.html"), page("console.error(\"a real error\")"));
fs.writeFileSync(path.join(dir, "throw.html"), page("setTimeout(() => { throw new Error(\"boom\"); })"));
const srv = await serve(dir), b = await launch({ w: 320, h: 200 });
try {
  // a warning is reported, not counted as an error (Firefox prints WebGL and autoplay warnings; A2)
  let r = await open(b, srv.url + "warn.html");
  assert.deepEqual([r.errors.length, r.warnings.length], [0, 1], "a warning is a warning: " + JSON.stringify(r.errors));
  r = await open(b, srv.url + "error.html");
  assert.deepEqual([r.errors.length, r.warnings.length], [1, 0], "a console error is an error");
  r = await open(b, srv.url + "throw.html");
  await new Promise((res) => setTimeout(res, 200));
  assert.ok(r.errors.some((e) => e.includes("boom")), "an uncaught exception is an error");
  console.log("tools check: ok");
} finally { await b.close(); srv.close(); fs.rmSync(dir, { recursive: true }); }
