"""Contact sheet of rendered stills: python3 tools/sheet.py <brand> <format> <f,f,...> <out.png> [cols]"""
import sys
from PIL import Image, ImageDraw
b, fmt, frames, out = sys.argv[1:5]; cols = int(sys.argv[5]) if len(sys.argv) > 5 else 4
fs = [f"out/stills/{b}_{fmt}_f{int(n):03d}.png" for n in frames.split(",")]
w = 480; h = 270 if fmt == "16x9" else 480
can = Image.new("RGB", (cols * (w + 4), ((len(fs) + cols - 1) // cols) * (h + 4)), "black"); d = ImageDraw.Draw(can)
for i, f in enumerate(fs):
    x, y = (i % cols) * (w + 4), (i // cols) * (h + 4)
    can.paste(Image.open(f).convert("RGB").resize((w, h), Image.LANCZOS), (x, y)); d.text((x + 5, y + 3), f[-8:-4], fill="red")
can.save(out)
