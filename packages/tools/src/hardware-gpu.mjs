// Shared hardware requirement for preflight and scene evidence.
export function assertHardwareGpu(renderer) {
  if (typeof renderer !== 'string' || !renderer.trim() || /^(unknown|\?|WebKit WebGL)$/i.test(renderer.trim())) {
    throw new Error('Missing hardware GPU identity');
  }
  if (/swiftshader|llvmpipe|softpipe|software|lavapipe|basic render|microsoft.*warp/i.test(renderer)) {
    throw new Error('Software renderer cannot certify the hardware budget: ' + renderer);
  }
}
