const fs = require('fs');

let config = fs.readFileSync('tailwind.config.js', 'utf8');

// Replace sans font
config = config.replace(/sans:\s*\['Lora',\s*'Georgia',\s*'ui-serif',\s*'serif'\],/g, "sans: ['Nunito', 'ui-sans-serif', 'system-ui', 'sans-serif'],");
// Replace serif font (used as headings, let's use Plus Jakarta Sans)
config = config.replace(/serif:\s*\['Lora',\s*'Georgia',\s*'ui-serif',\s*'serif'\],/g, "serif: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],");

fs.writeFileSync('tailwind.config.js', config, 'utf8');
