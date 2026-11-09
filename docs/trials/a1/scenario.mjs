import assert from 'node:assert/strict';

// The published handoff describes the participant's layout. Actions, timing and assertions belong to the proctor.
export function scenario({ route, railEye, railLook, switchId, signalFlag, signalLook, signalAnchor }) {
  const point = (p, n) => Array.isArray(p) && p.length === n && p.every(Number.isFinite);
  assert.ok(Array.isArray(route) && route.length >= 3 && route.every(p => point(p, 2)), 'route requires at least three XZ points');
  for (const p of [railEye, railLook, signalLook]) assert.ok(point(p, 3), 'eye/look coordinates must be XYZ');
  assert.ok(typeof switchId === 'string' && switchId.trim() && typeof signalAnchor === 'string' && signalAnchor.trim());
  assert.ok(typeof signalFlag === 'string' && /^[A-Za-z_]\w*$/.test(signalFlag));
  const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  assert.ok(route.slice(1).every((p,i) => distance(p,route[i]) > 0), 'consecutive route points must differ');
  const start = route[0], door = route.at(-2), desk = route.at(-1);
  assert.ok(route.slice(1).reduce((sum, p, i) => sum + distance(route[i], p), 0) >= 12 && distance(start, desk) >= 8, 'route too short');
  assert.ok(distance(door, desk) >= 1.5, 'exterior observation point must be distinct from the switch');
  assert.ok(Math.hypot(railEye[0] - railLook[0], railEye[2] - railLook[2]) >= 2, 'barrier sightline too short');
  const flag = 'flags.' + signalFlag;
  const at = (p, tolerance = 0.5) => ({ x: '~ ' + p[0] + ' ' + tolerance, z: '~ ' + p[1] + ' ' + tolerance, onGround: '== true' });
  return {
    title: 'A1 independent replay', w: 1440, h: 900, query: 'start=1&mode=walk&quality=medium&hud=0&grain=0',
    steps: [
      { name: 'spawn', ms: 350, expect: { ...at(start, 0.65), [flag]: '== false', errors: '== 0' } },
      { name: 'exterior-off', walkTo: route.slice(1, -1), tol: 0.28, lookAt: signalLook, expect: { ...at(door), [flag]: '== false' } },
      { name: 'panel-off', walkTo: [desk], tol: 0.28, lookAt: switchId, expect: { ...at(desk), near: '== ' + switchId, [flag]: '== false' } },
      { name: 'panel-on', tap: 'KeyE', ms: 700, expect: { [flag]: '== true', paused: '== false' } },
      { name: 'exterior-on', walkTo: [door], tol: 0.28, lookAt: signalLook, expect: { ...at(door), [flag]: '== true' } },
      { name: 'solid-rail', place: { eye: railEye, look: railLook, mode: 'walk' }, keys: ['KeyW'], ms: 2200,
        expect: { dist: '< 1.35', onGround: '== true', [flag]: '== true' } },
      { name: 'route-shimmer', flicker: { path: route, frames: 180 }, expect: { flicker: '< 8' } },
      { name: 'frame-cost', place: { eye: railEye, look: railLook, mode: 'walk' }, keys: ['KeyW'], perf: { frames: 90 },
        expect: { frameMs: '<= 16.7', p95Ms: '> 0', calls: '> 0', triangles: '> 0', errors: '== 0' } },
      ...[0, 1, 2].map(viewpoint => ({ name: 'view-' + viewpoint, viewpoint })),
    ],
  };
}
