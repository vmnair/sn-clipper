#!/usr/bin/env python3
import os
from PIL import Image, ImageDraw

ICON_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "icon")
os.makedirs(ICON_DIR, exist_ok=True)

SIZE = 2048  # 2x supersampling for ultra-crisp 1024x1024 e-ink output
OUT_SIZE = (1024, 1024)
BLACK = (0, 0, 0, 255)
CLEAR = (0, 0, 0, 0)
WHITE = (255, 255, 255, 255)

def save_icon(img, filename):
    downscaled = img.resize(OUT_SIZE, Image.Resampling.LANCZOS)
    out_path = os.path.join(ICON_DIR, filename)
    downscaled.save(out_path, "PNG")
    print(f"Saved {out_path} ({OUT_SIZE[0]}x{OUT_SIZE[1]})")

# 1. Main Clipper Icon: Viewfinder Brackets with Text Selection Highlight Bars (Matching clip_region)
def create_main_icon():
    img = Image.new("RGBA", (SIZE, SIZE), CLEAR)
    draw = ImageDraw.Draw(img)
    
    bw = 160  # bracket thickness
    arm = 380  # arm length
    
    # 4 Corner Viewfinder Brackets
    draw.rectangle([240, 240, 240 + arm, 240 + bw], fill=BLACK)
    draw.rectangle([240, 240, 240 + bw, 240 + arm], fill=BLACK)
    draw.rectangle([1808 - arm, 240, 1808, 240 + bw], fill=BLACK)
    draw.rectangle([1808 - bw, 240, 1808, 240 + arm], fill=BLACK)
    draw.rectangle([240, 1808 - bw, 240 + arm, 1808], fill=BLACK)
    draw.rectangle([240, 1808 - arm, 240 + bw, 1808], fill=BLACK)
    draw.rectangle([1808 - arm, 1808 - bw, 1808, 1808], fill=BLACK)
    draw.rectangle([1808 - bw, 1808 - arm, 1808, 1808], fill=BLACK)
    
    # Inside: 3 Bold Geometric Highlight Lines (Represents Text Excerpts & Clippings)
    draw.rectangle([520, 660, 1528, 660 + 160], fill=BLACK)
    draw.rectangle([520, 944, 1528, 944 + 160], fill=BLACK)
    draw.rectangle([520, 1228, 1200, 1228 + 160], fill=BLACK)
    
    save_icon(img, "icon.png")

# 2. Clip Region Button Icon: bold marquee / crop viewfinder with corner brackets & crosshair
def create_region_icon():
    img = Image.new("RGBA", (SIZE, SIZE), CLEAR)
    draw = ImageDraw.Draw(img)
    
    bw = 160  # bracket thickness
    arm = 480  # arm length
    
    # Top-Left Bracket
    draw.rectangle([240, 240, 240 + arm, 240 + bw], fill=BLACK)
    draw.rectangle([240, 240, 240 + bw, 240 + arm], fill=BLACK)
    
    # Top-Right Bracket
    draw.rectangle([1808 - arm, 240, 1808, 240 + bw], fill=BLACK)
    draw.rectangle([1808 - bw, 240, 1808, 240 + arm], fill=BLACK)
    
    # Bottom-Left Bracket
    draw.rectangle([240, 1808 - bw, 240 + arm, 1808], fill=BLACK)
    draw.rectangle([240, 1808 - arm, 240 + bw, 1808], fill=BLACK)
    
    # Bottom-Right Bracket
    draw.rectangle([1808 - arm, 1808 - bw, 1808, 1808], fill=BLACK)
    draw.rectangle([1808 - bw, 1808 - arm, 1808, 1808], fill=BLACK)
    
    # Center crop crosshair / focal point
    c = SIZE // 2
    cw = 120
    cr = 200
    draw.rectangle([c - cw//2, c - cr, c + cw//2, c + cr], fill=BLACK)
    draw.rectangle([c - cr, c - cw//2, c + cr, c + cw//2], fill=BLACK)
    
    save_icon(img, "clip_region.png")

# 3. Close Icon: bold high-contrast 'X'
def create_close_icon():
    img = Image.new("RGBA", (SIZE, SIZE), CLEAR)
    draw = ImageDraw.Draw(img)
    
    stroke = 200  # bold stroke width
    p = 380       # padding from bounds
    
    draw.line([(p, p), (SIZE - p, SIZE - p)], fill=BLACK, width=stroke)
    draw.line([(SIZE - p, p), (p, SIZE - p)], fill=BLACK, width=stroke)
    
    # Cap the line ends smoothly
    r = stroke // 2
    for pt in [(p, p), (SIZE - p, SIZE - p), (SIZE - p, p), (p, SIZE - p)]:
        draw.ellipse([pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r], fill=BLACK)
    
    save_icon(img, "close.png")

if __name__ == "__main__":
    create_main_icon()
    create_region_icon()
    create_close_icon()
    print("Project icons successfully generated!")
