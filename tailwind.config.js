/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#121110',
        panel: '#1A1917',
        line: '#2D2B28',
        paper: '#EDE8DF',
        muted: '#9A948A',
        porch: '#F2B84B',
        calm: '#6CC497',
        watch: '#EB9550',
        alarm: '#EF5A4C',
      },
      fontFamily: {
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'ui-serif', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
