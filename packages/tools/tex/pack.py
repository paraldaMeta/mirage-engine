# Mirage texture packer. Adapted from the author's own earlier texture tools (fetch.py + pack.py), slimmed.
# Fetches CC0 PBR sets from Poly Haven (official API, 1k JPG) and packs each into the two-texture layout that
# @mirage/core's textures.js reads:
#   <name>_c.webp  albedo (sRGB), ambient occlusion folded in at 50 %
#   <name>_n.webp  R, G = tangent-space normal x, y (OpenGL, +Y up); B = height 0..1 (stretched, slightly blurred)
# and writes manifest.json (tile size, linear mean albedo, roughness statistics, source and licence per set).
#
# usage: python3 -P pack.py SPEC.json RAWDIR OUTDIR
#   SPEC.json: { "<name>": { "polyhaven": "<asset id>", "tile": <metres per repeat> }, ... }
#   RAWDIR: downloads land here (keep it outside the repo); OUTDIR: the project's texture folder
# ponytail: Poly Haven only and 1k only; add ambientCG / other resolutions when a project needs them.
import json, os, sys, subprocess, tempfile
import numpy as np
from PIL import Image

SPEC, RAW, OUT = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp(prefix='mirage-tex-')
RES = 1024
get = lambda url: subprocess.run(['curl', '-sfL', '-m', '300', url], check=True, capture_output=True).stdout

def fetch(name, aid):
    d = os.path.join(RAW, name); os.makedirs(d, exist_ok=True)
    files = json.loads(get(f'https://api.polyhaven.com/files/{aid}'))
    info = json.loads(get(f'https://api.polyhaven.com/info/{aid}'))
    for key, fn in (('Diffuse', 'color'), ('nor_gl', 'normal'), ('Rough', 'rough'), ('AO', 'ao'), ('Displacement', 'height')):
        p = os.path.join(d, fn + '.jpg')
        if key in files and not os.path.exists(p): open(p, 'wb').write(get(files[key]['1k']['jpg']['url']))
    return d, dict(site='Poly Haven', id=aid, url=f'https://polyhaven.com/a/{aid}', authors=list(info.get('authors', {}).keys()), licence='CC0 1.0')

def load(path, mode):
    im = Image.open(path).convert(mode)
    return np.asarray(im.resize((RES, RES), Image.LANCZOS) if im.size != (RES, RES) else im, dtype=np.float32) / 255.0

def webp(arr, out, q):
    png = os.path.join(TMP, os.path.basename(out) + '.png')
    Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8)).save(png)
    subprocess.run(['cwebp', '-quiet', '-q', str(q), '-m', '6', '-sharp_yuv', png, '-o', out], check=True)

def blur(a, r=1):   # small box blur with wrap-around (the height only steers blends: softer = smaller file)
    s = np.zeros_like(a)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1): s += np.roll(np.roll(a, dy, 0), dx, 1)
    return s / (2 * r + 1) ** 2

lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
mp = os.path.join(OUT, 'manifest.json')
man = json.load(open(mp)) if os.path.exists(mp) else {}
sets = man.setdefault('sets', {})
for name, s in SPEC.items():
    d, src = fetch(name, s['polyhaven'])
    col = load(os.path.join(d, 'color.jpg'), 'RGB')
    if os.path.exists(os.path.join(d, 'ao.jpg')): col = col * (0.5 + 0.5 * load(os.path.join(d, 'ao.jpg'), 'L'))[..., None]
    webp(col, os.path.join(OUT, name + '_c.webp'), 82)
    nrm = load(os.path.join(d, 'normal.jpg'), 'RGB')
    h = load(os.path.join(d, 'height.jpg'), 'L')
    lo, hi = np.percentile(h, [0.5, 99.5]); h = np.clip((h - lo) / max(hi - lo, 1e-4), 0, 1)
    webp(np.dstack([nrm[..., 0], nrm[..., 1], blur(h)]), os.path.join(OUT, name + '_n.webp'), 78)
    r = load(os.path.join(d, 'rough.jpg'), 'L')
    hv = h - h.mean()
    sets[name] = dict(tile=s['tile'], mean=[round(float(v), 4) for v in lin(col).reshape(-1, 3).mean(0)],
                      hMean=round(float(h.mean()), 3), rough=round(float(r.mean()), 3),
                      roughSlope=round(float((hv * (r - r.mean())).mean() / max((hv * hv).mean(), 1e-6)), 3),
                      files={'c': name + '_c.webp', 'n': name + '_n.webp'}, src=src)
    print(name, *(os.path.getsize(os.path.join(OUT, f)) // 1024 for f in sets[name]['files'].values()), 'KB', flush=True)
json.dump(man, open(mp, 'w'), indent=1)
