/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b2a2e', mint: '#d9ece6', panel: '#f3f8f6', line: '#8fb5ac',
        teal: { DEFAULT: '#1f7a6d', dark: '#145a50' }, alarm: '#b4412f', amber: '#a86a00',
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
        display: ['Georgia', '"Times New Roman"', 'serif'],
      },
    },
  },
  plugins: [],
}
