# usage: python3 tools/sheet.py <dir> <out_prefix> [per_sheet] [cell_w]
import sys, glob
from PIL import Image
d, outp = sys.argv[1], sys.argv[2]
per = int(sys.argv[3]) if len(sys.argv) > 3 else 4
cw = int(sys.argv[4]) if len(sys.argv) > 4 else 960
fs = sorted(glob.glob(d + '/*.png'))
for s in range(0, len(fs), per):
    group = fs[s:s + per]
    ims = [Image.open(f) for f in group]
    w0, h0 = ims[0].size
    ch = int(cw * h0 / w0)
    cols = 2 if w0 > h0 else 4
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cw * cols, ch * rows))
    for i, im in enumerate(ims):
        sheet.paste(im.resize((cw, ch), Image.LANCZOS), ((i % cols) * cw, (i // cols) * ch))
    sheet.save(f'{outp}_{s // per:02d}.jpg', quality=88)
    print(f'{outp}_{s // per:02d}.jpg', [f.split('/')[-1] for f in group])
