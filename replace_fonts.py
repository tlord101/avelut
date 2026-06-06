import re

html_path = 'index.html'
css_path = 'tailwind.config.js'

with open(html_path, 'r', encoding='utf-8') as f:
    html_content = f.read()

# Replace Lora with Plus Jakarta Sans and Nunito
# First, update the google fonts link
old_font_link = '<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet">'
new_font_link = '<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&family=Nunito:ital,wght@0,200..1000;1,200..1000&display=swap" rel="stylesheet">'
html_content = html_content.replace(old_font_link, new_font_link)
html_content = html_content.replace('<!-- Google Fonts: Lora (Trustworthy Serif) -->', '<!-- Google Fonts: Plus Jakarta Sans & Nunito -->')

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html_content)


with open(css_path, 'r', encoding='utf-8') as f:
    css_content = f.read()

# Make sure tailwind.config.js is configured properly if needed
# Actually, the user has styles.css:10 font-family: 'Lora', Georgia, ui-serif, serif;
