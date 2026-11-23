/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        editor: {
          bg: '#0F1117',
          surface: '#1A1D27',
          card: '#222634',
          border: '#2E3446',
          accent: '#6366F1',
          accentHover: '#4F46E5',
          amber: '#F59E0B',
          green: '#10B981',
          red: '#EF4444',
          text: '#F3F4F6',
          muted: '#9CA3AF'
        }
      }
    },
  },
  plugins: [],
}
