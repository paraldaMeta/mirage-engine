# The share of pixels whose hue is magenta / pink (hue 285..345 deg, saturation over 0.12, value over 0.15) per
# image, and a map of them (pink pixels in their colour, the rest dark grey) next to the image.
#   python3 scripts/castmap.py out/dir/a.png [b.png ...] [--map out/dir]
import sys, colorsys, os
from PIL import Image

args = sys.argv[1:]
mapdir = None
if '--map' in args:
    i = args.index('--map'); mapdir = args[i + 1]; del args[i:i + 2]
for f in args:
    im = Image.open(f).convert('RGB'); w, h = im.size
    small = im.resize((w // 4, h // 4)); px = list(small.getdata())
    out = Image.new('RGB', small.size); op = []
    n = 0
    for (r, g, b) in px:
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        pink = 285 / 360 <= hh <= 345 / 360 and s > 0.12 and v > 0.15
        n += pink
        y = int(0.2126 * r + 0.7152 * g + 0.0722 * b) // 3
        op.append((r, g, b) if pink else (y, y, y))
    out.putdata(op)
    print(f'{os.path.basename(f)}: magenta/pink pixels {100 * n / len(px):.2f} %')
    if mapdir:
        os.makedirs(mapdir, exist_ok=True)
        s2 = Image.new('RGB', (small.size[0] * 2, small.size[1])); s2.paste(small, (0, 0)); s2.paste(out, (small.size[0], 0))
        s2.save(os.path.join(mapdir, 'pink-' + os.path.basename(f)))
