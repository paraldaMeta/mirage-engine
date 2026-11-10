// Mirage original code. What an immersive-ar session offers beyond the hit test: anchors (the placed world stays on
// its table when the tracking's origin drifts), detected planes, light estimation (the room's light on the model)
// and a DOM overlay; and a shadows-only ground so the model's shadow falls on the real table.
// ---------------------------------------------------------------------------
// createXR(play, { arFeatures: { anchors: true, planes: 'shadow', light: true, shadowGround: true, domOverlay: el } })
// low level (what createXR does):
//   const arx = createXRAR(world, { anchors: true, planes: 'debug', light: true });
//   navigator.xr.requestSession('immersive-ar', arx.sessionInit({ optionalFeatures: ['hit-test'] }));
//   arx.start(session, rig);            // rig: the Object3D that stands for the reference space
//   arx.frame(xrFrame, referenceSpace, rigYaw);   // every frame, before drawing
//   const a = await arx.anchor(hitTestResult);    // a.object: a Group in the rig that follows the anchor
//   arx.end();
// ---------------------------------------------------------------------------
// Every one of these is an optional feature: a browser that lacks it gives a session without it, and the matching
// part here stays idle (arx.state() says which are live). NOT TESTED ON HARDWARE: exercised only against the
// emulated session of packages/tools/src/xr-shim.js.
// ponytail: the spherical harmonics are used as the device gives them, in the reference space: when the model is
// turned (the right stick) the ambient light does not turn with it (the main light's direction does). No depth
// sensing (real objects do not occlude the model), no mesh detection, no image tracking, no persistent anchors.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _v = new THREE.Vector3();

/** A ground that shows only the shadows cast on it (and nothing where there is none): three's shadow shader without
 *  its clipping and fog chunks, so the play's clip planes at the edge of the world do not cut the shadow off. */
export function shadowGround({ size = 4, opacity = 0.4 } = {}) {
  const lib = THREE.ShaderLib.shadow, strip = (s) => s.replace(/#include <(clipping_planes|fog)_\w+>/g, '');
  const mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: strip(lib.vertexShader), fragmentShader: strip(lib.fragmentShader),
    lights: true, transparent: true, depthWrite: false, toneMapped: false });
  mat.uniforms.opacity.value = opacity; mat.uniforms.color.value.set(0x000000);
  mat.userData.mirageXR = true;   // xr.js: leave the shader alone
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat);
  mesh.receiveShadow = true; mesh.name = 'xr-shadow-ground'; mesh.userData.collide = false; mesh.renderOrder = -1;
  return mesh;
}

export function createXRAR(world, opts = {}) {
  const o = { anchors: true, planes: false, light: false, domOverlay: null, shadowGround: false, envKeep: 0.15, lightGain: 1, sunGain: 1, ...opts };
  const { scene } = world;
  const group = new THREE.Group(); group.name = 'xr-ar';
  const anchors = [], planes = new Map();
  const light = { valid: false, direction: new THREE.Vector3(0, 1, 0), intensity: new THREE.Color(1, 1, 1), probe: new THREE.LightProbe(), xr: null, pending: false };
  let session = null, saved = null, planeMat = null, overlayOff = null;
  const stop = (e) => e.preventDefault();   // a tap on the overlay is not a "select" in the world

  function planeMaterial() {
    if (planeMat) return planeMat;
    if (o.planes === 'shadow') { const g = shadowGround({ size: 1 }); planeMat = g.material; g.geometry.dispose(); }
    else { planeMat = new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }); planeMat.userData.mirageXR = true; }
    return planeMat;
  }
  // an XRPlane's polygon (its own space, y = 0, a closed loop) as a triangle fan
  function planeGeometry(poly, geo) {
    const n = poly.length > 1 && poly[0].x === poly[poly.length - 1].x && poly[0].z === poly[poly.length - 1].z ? poly.length - 1 : poly.length;
    const pos = new Float32Array(n * 3), idx = [];
    for (let i = 0; i < n; i++) { pos[i * 3] = poly[i].x; pos[i * 3 + 1] = poly[i].y || 0; pos[i * 3 + 2] = poly[i].z; }
    for (let i = 1; i < n - 1; i++) idx.push(0, i + 1, i);   // facing +y for a counter-clockwise loop seen from above
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
    return geo;
  }

  function stepAnchors(frame, space) {
    const tracked = frame.trackedAnchors;
    for (const a of anchors) {
      const pose = (!tracked || tracked.has(a.anchor)) && frame.getPose(a.anchor.anchorSpace, space);
      a.tracked = !!pose;
      if (pose) { a.object.matrix.fromArray(pose.transform.matrix); a.object.matrix.decompose(a.object.position, a.object.quaternion, a.object.scale); }
    }
  }
  function stepPlanes(frame, space) {
    const set = frame.detectedPlanes;
    if (!set) return;
    for (const [pl, e] of planes) if (!set.has(pl)) { group.remove(e.mesh); e.mesh.geometry.dispose(); planes.delete(pl); }
    set.forEach((pl) => {
      let e = planes.get(pl);
      if (!e) {
        e = { mesh: new THREE.Mesh(new THREE.BufferGeometry(), planeMaterial()), changed: -1, orientation: pl.orientation || '' };
        e.mesh.matrixAutoUpdate = false; e.mesh.userData.collide = false; e.mesh.receiveShadow = o.planes === 'shadow'; e.mesh.name = 'xr-plane';
        e.mesh.visible = o.planes !== 'shadow' || e.orientation !== 'vertical';
        planes.set(pl, e); group.add(e.mesh);
      }
      if (e.changed !== pl.lastChangedTime) { e.changed = pl.lastChangedTime; planeGeometry(pl.polygon, e.mesh.geometry); }
      const pose = frame.getPose(pl.planeSpace, space);
      if (pose) e.mesh.matrix.fromArray(pose.transform.matrix);
    });
  }
  // the room's light: the main light's direction and colour on the world's sun (so the shadow falls the right way),
  // the ambient as a light probe in place of most of the world's own image-based light
  function stepLight(frame, yaw) {
    if (!light.xr) return;
    const est = frame.getLightEstimate && frame.getLightEstimate(light.xr);
    if (!est) return;
    const d = est.primaryLightDirection, c = est.primaryLightIntensity;
    light.direction.set(d.x, d.y, d.z).normalize();
    light.intensity.setRGB(c.x, c.y, c.z);
    light.probe.sh.fromArray(est.sphericalHarmonicsCoefficients);
    light.probe.intensity = o.lightGain;
    if (!light.valid) { light.valid = true; scene.environmentIntensity = saved.env * o.envKeep; group.add(light.probe); }
    const k = Math.max(c.x, c.y, c.z, 1e-6), sun = world.sun;
    _v.copy(light.direction).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    if (_v.y < 0.05) { _v.y = 0.05; _v.normalize(); }   // a light from below would put the shadow on the ceiling
    world.keyDir.copy(_v); world.G.uKeyDir.value.copy(_v);
    sun.color.setRGB(c.x / k, c.y / k, c.z / k); sun.intensity = k * o.sunGain;
  }

  const api = {
    group, anchors, planes, light, options: o,
    /** the session's init with this module's optional features (and the DOM overlay) added to `init` */
    sessionInit(init = {}) {
      const f = new Set(init.optionalFeatures || []);
      if (o.anchors) f.add('anchors');
      if (o.planes) f.add('plane-detection');
      if (o.light) f.add('light-estimation');
      const out = { ...init, optionalFeatures: [...f] };
      if (o.domOverlay) { out.optionalFeatures.push('dom-overlay'); out.domOverlay = { root: o.domOverlay }; }
      return out;
    },
    start(s, rig) {
      session = s;
      saved = { env: scene.environmentIntensity, key: world.keyDir.clone(), color: world.sun.color.clone(), sun: world.sun.intensity };
      rig.add(group);
      light.valid = false; light.xr = null;
      if (o.light && s.requestLightProbe && !light.pending) {
        light.pending = true;
        s.requestLightProbe().then((p) => { light.pending = false; if (session === s) light.xr = p; }, () => { light.pending = false; });
      }
      if (o.domOverlay && o.domOverlay.addEventListener) { o.domOverlay.addEventListener('beforexrselect', stop); overlayOff = () => o.domOverlay.removeEventListener('beforexrselect', stop); }
    },
    frame(frame, space, yaw = 0) {
      if (!session) return;
      if (anchors.length) stepAnchors(frame, space);
      if (o.planes) stepPlanes(frame, space);
      if (o.light) stepLight(frame, yaw);
    },
    /** An anchor from a hit test result (or from { pose: XRRigidTransform, space, frame }). Resolves to { anchor,
     *  object (a Group in the reference space: add what should stay there), tracked, delete() }; rejects where the
     *  session has no anchors. */
    anchor(from) {
      if (!session || !from) return Promise.reject(new Error('no AR session'));
      const p = typeof from.createAnchor === 'function' ? from.createAnchor() : from.frame && from.frame.createAnchor ? from.frame.createAnchor(from.pose, from.space) : null;
      if (!p) return Promise.reject(new Error('anchors are not available in this session'));
      const s = session;
      return p.then((anchor) => {
        const a = { anchor, object: new THREE.Group(), tracked: false, delete() { const i = anchors.indexOf(a); if (i >= 0) anchors.splice(i, 1); group.remove(a.object); if (anchor.delete) anchor.delete(); } };
        a.object.name = 'xr-anchor';
        if (session !== s) { if (anchor.delete) anchor.delete(); throw new Error('the session ended'); }
        anchors.push(a); group.add(a.object);
        return a;
      });
    },
    end() {
      if (!session) return;
      session = null;
      for (const a of anchors.splice(0)) group.remove(a.object);
      for (const e of planes.values()) { group.remove(e.mesh); e.mesh.geometry.dispose(); }
      planes.clear();
      group.remove(light.probe); group.removeFromParent();
      if (overlayOff) { overlayOff(); overlayOff = null; }
      if (saved) {
        scene.environmentIntensity = saved.env;
        if (light.valid) { world.keyDir.copy(saved.key); world.G.uKeyDir.value.copy(saved.key); world.sun.color.copy(saved.color); world.sun.intensity = saved.sun; }
      }
      light.valid = false; light.xr = null; saved = null;
    },
    dispose() { api.end(); if (planeMat) planeMat.dispose(); },
    /** a plain snapshot: which features are live in this session */
    state: () => ({ anchors: anchors.length, tracked: anchors.filter((a) => a.tracked).length, planes: planes.size,
      light: light.valid ? { direction: light.direction.toArray().map((v) => +v.toFixed(3)), intensity: light.intensity.toArray().map((v) => +v.toFixed(3)) } : null,
      overlay: session && session.domOverlayState ? session.domOverlayState.type : null, blend: session ? session.environmentBlendMode || null : null }),
  };
  return api;
}
