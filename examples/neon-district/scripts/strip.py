# A labelled 8-frame strip, or a contact sheet of strips (the melee check's pictures):
#   python3 scripts/strip.py out.png "label" frame0.png ... frame7.png
#   python3 scripts/strip.py --sheet sheet.png strip.png ... [ending.png]
import sys
from PIL import Image, ImageDraw

if sys.argv[1] == '--sheet':
    out, items = sys.argv[2], [Image.open(p).convert('RGB') for p in sys.argv[3:]]
    w = 2400
    items = [im.resize((w, int(im.height * w / im.width))) if im.width != w else im for im in items]
    sheet = Image.new('RGB', (w, sum(im.height + 6 for im in items)), (13, 15, 18))
    y = 0
    for im in items: sheet.paste(im, (0, y)); y += im.height + 6
    sheet.save(out); print(out)
else:
    out, label, frames = sys.argv[1], sys.argv[2], [Image.open(p).convert('RGB') for p in sys.argv[3:]]
    tw = 400; th = int(frames[0].height * tw / frames[0].width); lab = 26
    strip = Image.new('RGB', (tw * len(frames), th + lab), (13, 15, 18))
    d = ImageDraw.Draw(strip)
    for i, f in enumerate(frames):
        strip.paste(f.resize((tw, th)), (i * tw, lab))
        d.text((i * tw + 6, lab + 4), str(i + 1), fill=(255, 255, 255))
    d.text((8, 7), label, fill=(207, 216, 227))
    strip.save(out)
