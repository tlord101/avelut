import sys
from PIL import Image

def crop_transparent(image_path, output_path):
    try:
        img = Image.open(image_path)
        img = img.convert("RGBA")
        bbox = img.getbbox()
        if bbox:
            cropped = img.crop(bbox)
            cropped.save(output_path)
            print("Successfully cropped image.")
        else:
            print("Image is entirely transparent or could not get bbox.")
    except Exception as e:
        print(f"Error processing image: {e}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python crop.py <input> <output>")
        sys.exit(1)
    crop_transparent(sys.argv[1], sys.argv[2])
