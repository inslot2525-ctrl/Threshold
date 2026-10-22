/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#09090F',
        panel: '#14141D',
        line: '#2A2A3A',
        calm: '#6EE7B7',
        watch: '#FDBA74',
        alarm: '#FB7185',
        lilac: '#C4B5FD',
        lime: '#D9F99D',
        grape: '#8B5CF6',
      },
      fontFamily: {
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-body)', 'ui-sans-serif', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
