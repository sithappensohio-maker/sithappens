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
        // Sprint 110di-8 — background swatches now also reference CSS vars so
        // the admin's Brand & Theme settings can recolor every panel/header/
        // hover surface at runtime (no rebuild). Defaults stay the same deep
        // midnight navy palette from Sprint 110dd.
        bgBase:   'var(--bg-base,   #060c2e)',
        bgPanel:  'var(--bg-panel,  #0c143e)',
        bgHeader: 'var(--bg-header, #03061a)',
        bgHover:  'var(--bg-hover,  #1a225a)',
      },
      fontFamily: {
        // Same trick: --sh-font is set at runtime by ThemeProvider.
        sans: ['var(--sh-font, Inter)', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
  plugins: [],
};
