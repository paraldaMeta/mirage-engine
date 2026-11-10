// Mirage original code. The playtest scenario vocabulary in one place: what playtest.mjs reads, so the runner can
// say when a scenario names something it does not know, and agent/check.mjs can fail a skill that teaches a field,
// a value or a flag the tools do not have (the skills drift from the code otherwise).

/** scenario-level fields */
export const SCENARIO_FIELDS = ['title', 'query', 'w', 'h', 'errors', 'steps', 'checks', 'baseline', 'ssim', 'phone'];
/** step fields, in the order they run (name and expect apply to all) */
export const STEP_FIELDS = ['name', 'place', 'mode', 'viewpoint', 'walkTo', 'run', 'tol', 'timeout', 'lookAt', 'tap', 'keys', 'ms',
  'flicker', 'perf', 'expect', 'see', 'contrast', 'shot', 'baseline'];
/** keys inside a step's objects (place, flicker, perf, contrast) */
export const NESTED_FIELDS = ['eye', 'look', 'mode', 'path', 'speed', 'frames', 'y', 'root'];
/** what "expect" can name (a dotted name is checked by its first part: flags.lit, inventory.length, see.rail) */
export const EXPECT_VALUES = ['x', 'y', 'z', 'maxY', 'dist', 'onGround', 'blocked', 'mode', 'fps', 'errors', 'warnings', 'pos', 'eye', 'yaw',
  'near', 'prompt', 'inventory', 'paused', 'flags', 'flicker', 'flickerMax', 'flickerMaxAt', 'meanAbsDiff', 'frameMs', 'p95Ms', 'calls',
  'triangles', 'luma', 'dark', 'clipped', 'see', 'contrast', 'contrastFails', 'baseline'];

/** The fields of a scenario the runner does not know: ['steps[2].lookat', ...] */
export function unknownFields(sc) {
  const out = [];
  for (const k of Object.keys(sc || {})) if (!SCENARIO_FIELDS.includes(k)) out.push(k);
  for (const [i, s] of (sc?.steps || []).entries()) {
    for (const k of Object.keys(s || {})) if (!STEP_FIELDS.includes(k)) out.push(`steps[${i}].${k}`);
    for (const k of Object.keys(s?.expect || {})) if (!EXPECT_VALUES.includes(k.split('.')[0])) out.push(`steps[${i}].expect.${k}`);
  }
  return out;
}
