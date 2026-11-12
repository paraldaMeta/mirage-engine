# A labelled contact sheet of stills: python3 scripts/sheet.py out.png cols "label=path" ["label=path" ...]
# (the report sheets in out/nizwa-light: Nizwa's stills, read from its repository's own out/, beside ours)
import sys
from PIL import Image, ImageDraw

out, cols, items = sys.argv[1], int(sys.argv[2]), [a.split('=', 1) for a in sys.argv[3:]]
tw, th, lab, pad = 640, 400, 22, 8
rows = (len(items) + cols - 1) // cols
sheet = Image.new('RGB', (pad + cols * (tw + pad), pad + rows * (th + lab + pad)), (13, 15, 18))
d = ImageDraw.Draw(sheet)
for i, (label, path) in enumerate(items):
    x, y = pad + (i % cols) * (tw + pad), pad + (i // cols) * (th + lab + pad)
    im = Image.open(path).convert('RGB')
    s = min(tw / im.width, th / im.height); im = im.resize((int(im.width * s), int(im.height * s)))
    sheet.paste(im, (x + (tw - im.width) // 2, y + (th - im.height) // 2))
    d.text((x + 2, y + th + 5), label, fill=(207, 216, 227))
sheet.save(out)
print(out)
