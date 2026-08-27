/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./index.html"],
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
        // Redesign Phase A — semantic design-system tokens. These alias the
        // same CSS variables as the brand-name colors above (see index.css's
        // "Design-system semantic tokens" block); they exist so new
        // components can be written against role names (surface/primary/
        // accent/...) instead of brand names, without introducing a second
        // color source of truth.
        shBg:            'var(--sh-bg)',
        shSurface:       'var(--sh-surface)',
        shSurfaceRaised: 'var(--sh-surface-raised)',
        shBorder:        'var(--sh-border)',
        shPrimary:       'var(--sh-primary)',
        shSecondary:     'var(--sh-secondary)',
        shAccent:        'var(--sh-accent)',
        shDanger:        'var(--sh-danger)',
        shText:          'var(--sh-text)',
        shTextMuted:     'var(--sh-text-muted)',
      },
      fontFamily: {
        // Same trick: --sh-font is set at runtime by ThemeProvider.
        sans: ['var(--sh-font, Inter)', 'ui-sans-serif', 'system-ui'],
      },
      boxShadow: {
        sh: 'var(--sh-shadow)',
        shGlow: 'var(--sh-glow)',
      },
    },
  },
  plugins: [],
};
