import os
from PIL import Image

def generate_icons(source_icon_path, res_dir):
    icon_sizes = {
        'mdpi': 48,
        'hdpi': 72,
        'xhdpi': 96,
        'xxhdpi': 144,
        'xxxhdpi': 192
    }
    
    img = Image.open(source_icon_path).convert("RGBA")
    
    for density, size in icon_sizes.items():
        # Add 20% padding around the content
        content_size = int(size * 0.75) 
        padding = (size - content_size) // 2
        
        resized_content = img.resize((content_size, content_size), Image.Resampling.LANCZOS)
        
        # Create a blank transparent canvas
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(resized_content, (padding, padding), resized_content)
        
        out_dir = os.path.join(res_dir, f'mipmap-{density}')
        os.makedirs(out_dir, exist_ok=True)
        
        # Save standard and round launcher icons
        canvas.save(os.path.join(out_dir, 'ic_launcher.png'))
        canvas.save(os.path.join(out_dir, 'ic_launcher_round.png'))
        canvas.save(os.path.join(out_dir, 'ic_launcher_foreground.png'))
        print(f"Generated icon for {density} ({size}x{size})")

if __name__ == "__main__":
    icon_path = "../assets/icon.png"
    res_dir = "../android/app/src/main/res"
    
    current_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(current_dir)
    
    print("Generating icons...")
    generate_icons(icon_path, res_dir)
    print("Done!")
