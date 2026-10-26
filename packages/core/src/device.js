// Mirage — adapted from the author's own project.
// ---------------------------------------------------------------------------
// Device profile: phones and tablets get no scene MSAA (tile GPUs, and MSAA of half-float targets is not
// always there); the sub-frame accumulation does the anti-aliasing. `force: true` reproduces it on a desktop.
// ponytail: user-agent sniffing; add a measured GPU tier when a slow desktop shows up.
// ---------------------------------------------------------------------------
export function deviceProfile(renderer, { force = false } = {}) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  const touch = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (nav.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const mobile = force || touch;
  const maxSamples = renderer?.capabilities?.maxSamples || 0;
  return { mobile, msaa: mobile || maxSamples < 4 ? 0 : 4 };
}

export const QUALITY_LEVELS = ['low', 'medium', 'high'];
export const QUALITY_KEY = 'mirage:quality';
const WEAK_GPU = /SwiftShader|llvmpipe|softpipe|Software|Basic Render|Intel|Mali|Adreno|PowerVR/i;

/** The quality a page should start with: the saved choice (play's HUD), else 'medium', 'low' on a battery
 *  (a laptop / tablet that reports one), a phone, or a software / integrated GPU. -> { quality, why, gpu } */
export async function pickQuality({ storage = globalThis.localStorage, nav = globalThis.navigator || {} } = {}) {
  try { const s = storage && storage.getItem(QUALITY_KEY); if (QUALITY_LEVELS.includes(s)) return { quality: s, why: 'saved', gpu: '' }; } catch { /* no storage */ }
  const why = [];
  // a desktop reports charging, level 1, chargingTime 0; anything else has a battery
  // ponytail: a laptop on its charger at 100 % looks like a desktop (the Battery API cannot tell them apart)
  try {
    const b = nav.getBattery && await Promise.race([nav.getBattery(), new Promise((r) => setTimeout(r, 300))]);
    if (b && !(b.charging && b.level === 1 && b.chargingTime === 0)) why.push(b.charging ? 'laptop' : 'battery');
  } catch { /* no Battery API (Safari, Firefox) */ }
  const ua = nav.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (nav.maxTouchPoints > 1 && /Macintosh/.test(ua))) why.push('mobile');   // an iPad says Macintosh
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : '';
    if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* no WebGL here */ }
  if (WEAK_GPU.test(gpu)) why.push('gpu');
  return { quality: why.length ? 'low' : 'medium', why: why.join(', ') || 'default', gpu };
}
