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
