import os
from PIL import Image

def resize_icon(input_path, base_out_dir):
    sizes = {
        'mdpi': 24,
        'hdpi': 36,
        'xhdpi': 48,
        'xxhdpi': 72,
        'xxxhdpi': 96
    }
    
    img = Image.open(input_path)
    
    for density, size in sizes.items():
        # notification icons usually need some minimal padding, but the user wants it to fill the circle
        # We will resize exactly to the target size
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        out_dir = os.path.join(base_out_dir, f'drawable-{density}')
        if not os.path.exists(out_dir):
            os.makedirs(out_dir)
        
        out_path = os.path.join(out_dir, 'ic_stat_name.png')
        resized.save(out_path)
        print(f"Saved {out_path} at size {size}x{size}")

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("Usage: python resize.py <input> <android_res_dir>")
        sys.exit(1)
    resize_icon(sys.argv[1], sys.argv[2])
