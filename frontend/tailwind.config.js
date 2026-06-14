/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        // Brand colors are driven by CSS variables so the admin's Brand & Theme
        // settings can recolor the whole app at runtime. Defaults match the
        // historical Sit Happens palette.
        shGreen:  'var(--sh-green,  #8cc63f)',
        shBlue:   'var(--sh-blue,   #00a9e0)',
        shOrange: 'var(--sh-orange, #f26522)',
        // Sprint 110dd — Deep midnight navy palette matching the public
        // sithappensohiodogtraining.com site.
        bgBase:   '#060c2e',
        bgPanel:  '#0c143e',
        bgHeader: '#03061a',
        bgHover:  '#1a225a',
      },
      fontFamily: {
        // Same trick: --sh-font is set at runtime by ThemeProvider.
        sans: ['var(--sh-font, Inter)', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
  plugins: [],
};
