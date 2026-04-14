/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './crew/index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        'safe': { raw: '(min-height: 0px)' },
      },
    },
  },
  plugins: [],
}
