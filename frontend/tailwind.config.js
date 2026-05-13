/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        shGreen: '#8cc63f',
        shBlue: '#00a9e0',
        shOrange: '#f26522',
        bgBase: '#0f172a',
        bgPanel: '#1e293b',
        bgHeader: '#020617',
        bgHover: '#334155',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
  plugins: [],
};
