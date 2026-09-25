import sys, glob
from PIL import Image, ImageDraw
src = sys.argv[2] if len(sys.argv) > 2 else 'out/stills'
dst = sys.argv[3] if len(sys.argv) > 3 else 'out/sheet'
per = int(sys.argv[1]) if len(sys.argv) > 1 else 16
files = sorted(glob.glob(src + '/*.jpg')); cols = 4; tw, th = 480, 270
for s in range(0, len(files), per):
    chunk = files[s:s+per]; rows = (len(chunk)+cols-1)//cols
    sh = Image.new('RGB', (cols*tw, rows*(th+22)), (30,30,30)); d = ImageDraw.Draw(sh)
    for i, f in enumerate(chunk):
        im = Image.open(f).resize((tw, th)); x = (i % cols)*tw; y = (i//cols)*(th+22)
        sh.paste(im, (x, y+22)); d.text((x+6, y+4), f.split('/')[-1], fill=(255,220,120))
    sh.save(f'{dst}_{s//per:02d}.jpg', quality=85)
