// Test-machine-only WebGL probe, using the same launcher as the acceptance scenes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './chrome.mjs';
import { assertHardwareGpu } from './hardware-gpu.mjs';

const output = path.resolve(process.argv[2]);
const result = { status: 'running', started: new Date().toISOString() };
let browser;
try {
  browser = await launch({ w: 64, h: 64 });
  const session = await browser.target().createCDPSession();
  const { gpu } = await session.send('SystemInfo.getInfo');
  result.devices = gpu.devices;
  result.featureStatus = gpu.featureStatus;
  result.browser = await browser.version();
  const page = await browser.newPage();
  result.webgl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debug) throw new Error('Cannot read the actual WebGL renderer');
    gl.clearColor(32 / 255, 128 / 255, 192 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), pixel: [...pixel], error: gl.getError() };
  });
  assertHardwareGpu(result.webgl.renderer);
  assert.deepEqual(result.webgl.pixel, [32, 128, 192, 255], 'GPU readback failed');
  assert.equal(result.webgl.error, 0, 'WebGL reported an error');
  // Chrome 156 reports one 'webgl' entry and no 'webgl2'; the WebGL2 context above is the real proof it works
  const accel = gpu.featureStatus.webgl2 ?? gpu.featureStatus.webgl;
  assert.ok(/^enabled/.test(accel || ''), `Chrome reports WebGL hardware acceleration disabled (${accel})`);
  result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  result.finished = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  if (browser) await browser.close();
}
