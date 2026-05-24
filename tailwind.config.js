/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'emerald': {
          DEFAULT: '#10B981',
          hover: '#059669',
        },
        'mint': '#D1FAE5',
        'off-white': '#F9FAFB',
        'charcoal': '#111827',
      }
    },
  },
  plugins: [],
}
