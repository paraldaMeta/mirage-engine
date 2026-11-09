import * as THREE from 'three';

/** One level water surface. The outline is a simple XZ polygon, flow is [x,z] metres per second. */
export function addWater(ctx, { outline, level = 0, flow = [0.22, 0.06], ripple = 0.045, color = 0x326d68, opacity = 0.83 }) {
  if (!Array.isArray(outline) || outline.length < 3 ||
      !Array.from(outline).every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
    throw new RangeError('water.outline needs at least three finite [x,z] points');
  }
  if (!Array.isArray(flow) || flow.length !== 2 || !Number.isFinite(flow[0]) || !Number.isFinite(flow[1])) throw new RangeError('water.flow must be [vx,vz]');
  if (!Number.isFinite(level) || !Number.isFinite(ripple) || ripple < 0 || !(Number.isFinite(opacity) && opacity > 0 && opacity <= 1)) {
    throw new RangeError('water needs a finite level, non-negative ripple strength and opacity in (0,1]');
  }
  const contour = outline.map(([x, z]) => new THREE.Vector2(x, -z));
  if (THREE.ShapeUtils.area(contour) === 0) throw new RangeError('water.outline has zero area');
  const geometry = new THREE.ShapeGeometry(new THREE.Shape(contour)).rotateX(-Math.PI / 2);
  const material = ctx.mat.phys({ color, roughness: 0.13, ior: 1.333, metalness: 0, transparent: opacity < 1,
    opacity, depthWrite: opacity === 1 }, {
    uniforms: { mgWaterFlow: { value: new THREE.Vector2(...flow) }, mgWaterRipple: { value: ripple } },
    fragmentDecl: 'uniform vec2 mgWaterFlow; uniform float mgWaterRipple;',
    normal: `{
      vec2 p = mgWorldPos.xz - mgWaterFlow * uTime;
      float h = mgFbm2(p * vec2(1.5, 2.4), 3) + 0.24 * sin(p.x * 6.1 + p.y * 4.2);
      normal = mgBump(normal, h, mgWaterRipple / (1.0 + 0.06 * length(mgWorldPos - cameraPosition)));
    }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water'; mesh.position.y = level;
  mesh.receiveShadow = true; mesh.userData.collide = false;
  ctx.root.add(mesh);
  return mesh;
}
