// Mirage original code. The materials of the home and office props (@miragekit/assets, props-home): eleven slots,
// each a lit material that reads a vertex colour, so one material serves a red sofa and a grey one (tint() sets the
// colour; values are linear RGB). The screen slot is unlit and draws a desktop into a canvas (no image files).
//   const M = homeMaterials(ctx);   // { wood, fabric, leather, metal, chrome, plastic, ceramic, glass, paper, leaf, screen }
import * as THREE from 'three';

const FONT = 'system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif';

/** a canvas of a desktop: a dark wallpaper, a window with lines of code, a taskbar (for monitors, laptops, TVs) */
function screenTexture() {
  if (typeof document === 'undefined') return null;
  const W = 512, H = 320, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, '#1d3557'); gr.addColorStop(1, '#0b1220'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f1f1f1'; g.fillRect(40, 30, 300, 210); g.fillStyle = '#d0d0d0'; g.fillRect(40, 30, 300, 18);
  for (const [x, col] of [[48, '#ff5f57'], [62, '#febc2e'], [76, '#28c840']]) { g.fillStyle = col; g.beginPath(); g.arc(x, 39, 4, 0, 7); g.fill(); }
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 60; y < 230; y += 11) { let x = 52 + Math.floor(r() * 3) * 12; while (x < 320 && r() > 0.12) { const w = 12 + r() * 46; g.fillStyle = ['#7c3aed', '#0e7490', '#b45309', '#334155', '#be123c'][Math.floor(r() * 5)]; g.fillRect(x, y, w, 6); x += w + 6; } }
  g.fillStyle = '#2a9d8f'; g.fillRect(360, 60, 120, 80); g.fillStyle = '#e9c46a'; g.fillRect(360, 150, 120, 60);
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, H - 26, W, 26);
  g.fillStyle = '#fff'; g.font = `600 13px ${FONT}`; g.fillText('09:41', W - 52, H - 9);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** The slots, made once per ctx (cached on ctx.shared.home). */
export function homeMaterials(ctx) {
  if (ctx.shared?.home) return ctx.shared.home;
  const { mat } = ctx, P = mat.PROC, vc = { vertexColors: true, color: 0xffffff };
  // a fine weave on fabric: the albedo and the roughness move with a small noise, a faint bump
  const weave = { fragmentDecl: 'float hmW;', albedo: '{ hmW = mgFbm3(mgWorldPos * 140.0, 2); diffuseColor.rgb *= 0.86 + 0.24 * hmW; }', normal: 'normal = mgBump(normal, hmW, 0.0006);' };
  const grain = { fragmentDecl: 'float hmG;', albedo: '{ hmG = mgFbm3(mgWorldPos * 38.0, 3); diffuseColor.rgb *= 0.9 + 0.18 * hmG; }', roughness: 'roughnessFactor = clamp(roughnessFactor + 0.1 * (hmG - 0.5), 0.05, 1.0);' };
  const M = {
    wood: mat.std({ ...vc, roughness: 0.55 }, P.wood('vec3(0.42, 0.28, 0.17)', 'x')),
    fabric: mat.std({ ...vc, roughness: 0.95 }, weave),
    leather: mat.std({ ...vc, roughness: 0.45 }, grain),
    metal: mat.std({ ...vc, metalness: 1, roughness: 0.45 }),
    chrome: mat.std({ ...vc, metalness: 1, roughness: 0.12 }),
    plastic: mat.std({ ...vc, roughness: 0.4 }),
    ceramic: mat.std({ ...vc, roughness: 0.12 }),
    glass: mat.phys({ color: new THREE.Color(0.9, 0.95, 0.95), roughness: 0.03, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false }),
    paper: mat.std({ ...vc, roughness: 0.92 }),
    leaf: mat.std({ ...vc, roughness: 0.6, side: THREE.DoubleSide }),
    screen: new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: false }),
  };
  for (const [k, m] of Object.entries(M)) m.name = 'home-' + k;
  if (ctx.shared) ctx.shared.home = M;
  return M;
}
