/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0F172A',
        panel: '#1E293B',
        line: '#334155',
        calm: '#22C55E',
        watch: '#F59E0B',
        alarm: '#EF4444',
      },
    },
  },
  plugins: [],
}
