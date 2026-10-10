// ThemeProvider — fetches the admin's global appearance settings (unauthed),
// fetches per-user text-size preference (when logged in), and applies them as
// CSS variables + an html font-size. The unified Sit Happens UI uses these
// variables everywhere, so changing the brand does not require a rebuild.
//
// Card appearance intentionally has ONE control (`interface_style`) instead of
// the retired per-card theme matrix. Semantic meaning still comes from the
// normal brand/status colors; this setting only changes chrome intensity.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, API_BASE } from "./api";

const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

// Which portal shell a component is currently rendering inside — "client_portal"
// or "staff_portal", matching the keys ThemePresetIn.enabled_targets uses.
// The ONLY current consumer is NeonEdge.jsx's Card Frame gating: every other
// asset slot is gated in pure CSS via ancestor/attribute selectors (e.g.
// html[data-theme-target-client-portal="true"] [data-testid="client-portal"]),
// but NeonEdge is a single shared "card" primitive used identically by both
// portals with no DOM-ancestor marker of its own to select on, so there's no
// CSS-only way to ask "which portal is this instance in." Portal.jsx, App.js's
// AdminShell, and EmployeePortal.jsx each provide their own value at their
// root; a NeonEdge rendered outside either (tests, Storybook-style isolation)
// sees null and falls back to "enabled," matching this feature's original,
// un-gated behavior rather than silently hiding frames everywhere.
const PortalSurfaceCtx = createContext(null);
export const usePortalSurface = () => useContext(PortalSurfaceCtx);
export const PortalSurfaceProvider = PortalSurfaceCtx.Provider;

const FONT_SIZES = { S: "16px", M: "18.5px", L: "21px", XL: "24px" };
export const TEXT_SIZE_OPTIONS = [
  { value: "S",  label: "Small" },
  { value: "M",  label: "Medium" },
  { value: "L",  label: "Large" },
  { value: "XL", label: "Extra Large" },
];
export const FONT_OPTIONS = [
  { value: "Inter",   label: "Inter (default)" },
  { value: "Nunito",  label: "Nunito (rounded)" },
  { value: "Poppins", label: "Poppins (bold)" },
  { value: "Roboto",  label: "Roboto (classic)" },
  { value: "System",  label: "System UI" },
];
// Theme Studio — the big headline/title typeface (page titles, the sidebar
// wordmark, hero headlines — everything styled with the .sh-display class),
// independent of FONT_OPTIONS above (the body typeface). Curated to fonts
// that stay legible bold/uppercase at large sizes — no fully script/cursive
// faces, which the app's all-caps display style would mangle.
export const DISPLAY_FONT_OPTIONS = [
  { value: "Bowlby One SC", label: "Bowlby One SC (default)" },
  { value: "Black Ops One", label: "Black Ops One (stencil)" },
  { value: "Anton",         label: "Anton (condensed bold)" },
  { value: "Creepster",     label: "Creepster (spooky)" },
  { value: "Bungee",        label: "Bungee (playful block)" },
  { value: "Monoton",       label: "Monoton (retro neon)" },
  { value: "Staatliches",   label: "Staatliches (clean condensed)" },
  { value: "Fredoka",       label: "Fredoka (rounded friendly)" },
];

const DEFAULT_BRANDING = {
  brand_primary: "#8cc63f",
  brand_accent:  "#00a9e0",
  brand_warning: "#f26522",
  brand_font_family: "Inter",
  brand_display_font_family: "Bowlby One SC",
  brand_footer_text: "Sit Happens",
  brand_footer_url: "",
  interface_style: "standard",
  theme_bg_base:              "#060c2e",
  theme_bg_panel:             "#0c143e",
  theme_bg_header:            "#03061a",
  theme_bg_hover:             "#1a225a",
  theme_text_primary:         "#e2e8f0",
  theme_text_muted:           "#94a3b8",
  theme_text_display:         "#ffffff",
  theme_btn_primary_bg:       "#8cc63f",
  theme_btn_primary_fg:       "#03061a",
  theme_btn_secondary_border: "#1a225a",
  theme_btn_secondary_fg:     "#e2e8f0",
  theme_btn_danger_bg:        "#ef4444",
  theme_btn_danger_fg:        "#ffffff",
  theme_input_bg:             "#060c2e",
  theme_input_border:         "#1a225a",
  theme_input_focus:          "#8cc63f",
  theme_calendar_active:      "#8cc63f",
  theme_table_hover:          "#1a225a",
  theme_row_border:           "#1a225a",
  theme_glow_color:           "#00a9e0",
};

const INTERFACE_STYLES = {
  subtle:   { borderOpacity: 0.40, borderWidth: 1, glowOpacity: 0.08, glowBlur: 8,  innerOpacity: 0.04 },
  standard: { borderOpacity: 0.75, borderWidth: 2, glowOpacity: 0.25, glowBlur: 14, innerOpacity: 0.08 },
  bold:     { borderOpacity: 0.95, borderWidth: 2, glowOpacity: 0.42, glowBlur: 22, innerOpacity: 0.11 },
};

function hexToRgb(hex) {
  const h = (hex || "").replace("#", "").trim();
  if (h.length !== 6) return "0, 169, 224";
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// The paint-splatter decorations (body/sidebar/hero corner bursts, etc. —
// see index.css's "Brand splatter utility system") are real designer PNG
// raster art with the Classic palette's lime/blue/orange baked into the
// pixels, not CSS colors — a theme switch can't just repoint a variable.
// A hue-rotate CSS filter shifts the whole baked-in palette together
// (keeping the "mixed paint splash" character) toward whatever hue the
// active theme's primary color actually is, computed from the hex itself
// so this works for every theme — built-in or a custom/imported one —
// without hardcoding a rotation per theme.
const SPLATTER_BASELINE_HUE = 90; // the lime green baked into the real PNGs
function hexToHueDeg(hex) {
  const h = (hex || "").replace("#", "").trim();
  if (h.length !== 6) return SPLATTER_BASELINE_HUE;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return SPLATTER_BASELINE_HUE; // grayscale — no usable hue, fall back
  let hue;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return hue;
}

// Theme Studio asset slots — see backend THEME_ASSET_SLOTS. Each maps to a
// CSS custom property consumed by whichever screen renders that slot (login
// background, sidebar accent, etc. — wired up surface-by-surface in a later
// stage). The size names here come from the shop image pipeline Theme
// Studio uploads reuse (thumb/card/pdp/zoom); `original` is the one
// exception, for the animation slot, which is never resized so a GIF/WEBP
// keeps its animation frames intact.
// `scrim` marks the slots that are full backgrounds sitting directly behind
// real UI (text, header actions, stat numbers) — these get a dark layer
// painted on top of the image, via themeAssetLayeredValue below, so
// legibility never depends on how bright the admin's own upload is.
// "directional" darkens the left (title/eyebrow text) and right (header
// actions / avatar menu) zones harder than the middle, for banners with
// real content at both edges; "flat" dims evenly, for centered content
// (stat tiles). Small accents/badges/illustrations (corner sticker, login
// accent, empty-state art, etc.) are left unscrimmed — they're decorative
// elements in their own right, not backgrounds text needs to sit on top of.
export const THEME_ASSET_SLOT_CONFIG = {
  heroBackground:          { cssVar: "--theme-asset-hero-background",           size: "pdp",      scrim: "directional" },
  sidebarAccentTop:        { cssVar: "--theme-asset-sidebar-accent-top",        size: "card" },
  sidebarAccentBottom:     { cssVar: "--theme-asset-sidebar-accent-bottom",     size: "card" },
  sectionHeaderBackground: { cssVar: "--theme-asset-section-header-background", size: "card",      scrim: "directional" },
  dashboardCardOverlay:    { cssVar: "--theme-asset-dashboard-card-overlay",    size: "card",      scrim: "flat" },
  eventBanner:             { cssVar: "--theme-asset-event-banner",              size: "pdp",       scrim: "directional" },
  loginBackground:         { cssVar: "--theme-asset-login-background",          size: "pdp",       scrim: "flat" },
  loginAccent:             { cssVar: "--theme-asset-login-accent",              size: "card" },
  cornerSticker:           { cssVar: "--theme-asset-corner-sticker",            size: "card" },
  announcementAccent:      { cssVar: "--theme-asset-announcement-accent",       size: "card" },
  emptyStateIllustration:  { cssVar: "--theme-asset-empty-state-illustration",  size: "card" },
  ambientAnimation:        { cssVar: "--theme-asset-ambient-animation",         size: "original" },
  // A 9-slice border-image frame around every NeonEdge card (NeonEdge.jsx) —
  // stat tiles, action cards, panels, in both portals. No scrim (it's a
  // border, not a background behind text) and no per-surface targeting
  // (card chrome has always been one app-wide control via interface_style,
  // never split by client/staff portal — this matches that precedent).
  cardFrame:               { cssVar: "--theme-asset-card-frame",               size: "card" },
};

// Exported so Theme Studio's live-preview pane can resolve the exact same
// URLs for a DRAFT (unsaved) theme without duplicating this logic.
export function themeAssetUrl(assetId, size) {
  return `${API_BASE}/theme-assets/${encodeURIComponent(assetId)}/${size}`;
}

// The value a slot's CSS var should actually hold: "none" when nothing's
// uploaded (so a theme with no hero image shows no gradient either — the
// scrim is conditional on there being a real photo to protect text FROM,
// never applied on its own), otherwise the plain image url for an
// unscrimmed slot, or "scrim-gradient, image-url" for a scrimmed one. Baked
// in here, once, in JS — rather than composed in CSS via var(a), var(b,
// none) — specifically because CSS can't conditionally drop a layer based
// on whether ANOTHER var resolved to "none"; the scrim would otherwise
// paint unconditionally even on a theme with no image for that slot at all.
export function themeAssetLayeredValue(slot, assetId, size) {
  if (!assetId) return "none";
  const url = `url("${themeAssetUrl(assetId, size)}")`;
  const scrim = THEME_ASSET_SLOT_CONFIG[slot]?.scrim;
  if (scrim === "directional") return `var(--theme-decoration-scrim-directional), ${url}`;
  if (scrim === "flat") return `var(--theme-decoration-scrim-flat), ${url}`;
  return url;
}

function applyBranding(b) {
  const root = document.documentElement;
  const get = (k) => b[k] || DEFAULT_BRANDING[k];

  root.style.setProperty("--sh-green",  get("brand_primary"));
  root.style.setProperty("--sh-blue",   get("brand_accent"));
  root.style.setProperty("--sh-orange", get("brand_warning"));
  // Comma-separated "R, G, B" triples — for the handful of index.css rules
  // (e.g. the card-poster system's --card-accent) that use the
  // rgb(var(--x) / alpha) relative-color syntax instead of a plain hex var,
  // so they can't just swap to color-mix() like most other fixes here.
  root.style.setProperty("--sh-green-rgb",  hexToRgb(get("brand_primary")));
  root.style.setProperty("--sh-blue-rgb",   hexToRgb(get("brand_accent")));
  root.style.setProperty("--sh-orange-rgb", hexToRgb(get("brand_warning")));
  const fam = b.brand_font_family || DEFAULT_BRANDING.brand_font_family;
  root.style.setProperty("--sh-font", fam === "System" ? "system-ui" : `'${fam}'`);
  // Display/headline typeface (page titles, wordmarks, hero text — the
  // .sh-display class) — separate control from the body font above, so a
  // theme can pair a bold seasonal display face with a plain, legible body
  // font. Impact/sans-serif as the universal last resort, same as the
  // hardcoded --sh-display default in index.css.
  const displayFam = b.brand_display_font_family || DEFAULT_BRANDING.brand_display_font_family;
  root.style.setProperty("--sh-display", `'${displayFam}', Impact, sans-serif`);

  root.style.setProperty("--bg-base",   get("theme_bg_base"));
  root.style.setProperty("--bg-panel",  get("theme_bg_panel"));
  root.style.setProperty("--bg-header", get("theme_bg_header"));
  root.style.setProperty("--bg-hover",  get("theme_bg_hover"));
  root.style.setProperty("--text-primary", get("theme_text_primary"));
  root.style.setProperty("--text-muted",   get("theme_text_muted"));
  root.style.setProperty("--text-display", get("theme_text_display"));
  root.style.setProperty("--btn-primary-bg",       get("theme_btn_primary_bg"));
  root.style.setProperty("--btn-primary-fg",       get("theme_btn_primary_fg"));
  root.style.setProperty("--btn-secondary-border", get("theme_btn_secondary_border"));
  root.style.setProperty("--btn-secondary-fg",     get("theme_btn_secondary_fg"));
  root.style.setProperty("--btn-danger-bg",        get("theme_btn_danger_bg"));
  root.style.setProperty("--btn-danger-fg",        get("theme_btn_danger_fg"));
  root.style.setProperty("--input-bg",             get("theme_input_bg"));
  root.style.setProperty("--input-border",         get("theme_input_border"));
  root.style.setProperty("--input-focus",          get("theme_input_focus"));
  root.style.setProperty("--calendar-active",      get("theme_calendar_active"));
  root.style.setProperty("--table-hover",          get("theme_table_hover"));
  root.style.setProperty("--row-border",           get("theme_row_border"));

  // Splatter PNG recolor — see hexToHueDeg's comment above.
  const splatterHue = hexToHueDeg(get("brand_primary"));
  const splatterRotate = Math.round(splatterHue - SPLATTER_BASELINE_HUE);
  root.style.setProperty("--splatter-filter", splatterRotate === 0 ? "none" : `hue-rotate(${splatterRotate}deg) saturate(1.15)`);

  // One app-wide card chrome setting. Border follows the current brand
  // accent; glow has its own field (Theme Studio's 4th quick-palette
  // swatch) so a theme can glow a different color than its accent/link
  // color — it defaults to the same accent value when unset, so every
  // theme saved before this field existed renders identically to before.
  const styleId = INTERFACE_STYLES[b.interface_style] ? b.interface_style : "standard";
  const style = INTERFACE_STYLES[styleId];
  const accent = get("brand_accent");
  const accentRgb = hexToRgb(accent);
  const glow = b.theme_glow_color || accent;
  const glowRgb = hexToRgb(glow);
  root.setAttribute("data-interface-style", styleId);
  root.style.setProperty("--card-border-color", accent);
  root.style.setProperty("--card-border-rgba", `rgba(${accentRgb}, ${style.borderOpacity})`);
  root.style.setProperty("--card-border-width", `${style.borderWidth}px`);
  root.style.setProperty("--card-glow-color", glow);
  root.style.setProperty("--card-glow-rgba", `rgba(${glowRgb}, ${style.glowOpacity})`);
  root.style.setProperty("--card-glow-blur", `${style.glowBlur}px`);
  root.style.setProperty("--card-inner-highlight-color", "#FFFFFF");
  root.style.setProperty("--card-inner-highlight-rgba", `rgba(255, 255, 255, ${style.innerOpacity})`);

  // Theme Studio asset slots — one CSS var per slot, "none" when the active
  // theme hasn't uploaded anything for it, so every consumer can write a
  // single `background-image: var(--theme-asset-x, none)` with no per-theme
  // branching. Which surfaces actually render them is decided elsewhere
  // (data-theme-target-* below); this just makes the pictures addressable.
  const assets = b.assets || {};
  for (const [slot, { cssVar, size }] of Object.entries(THEME_ASSET_SLOT_CONFIG)) {
    root.style.setProperty(cssVar, themeAssetLayeredValue(slot, assets[slot], size));
  }

  // Per-surface opt-in (Client Portal / Staff Portal / Login), theme
  // intensity, and whether this theme's GIF/WEBP animation slot should
  // play — exposed as data-* attributes so any surface's CSS or components
  // can key off them once wired up, without re-reading /branding directly.
  const targets = { client_portal: true, staff_portal: true, login: true, ...(b.enabled_targets || {}) };
  root.setAttribute("data-theme-target-client-portal", String(!!targets.client_portal));
  root.setAttribute("data-theme-target-staff-portal", String(!!targets.staff_portal));
  root.setAttribute("data-theme-target-login", String(!!targets.login));
  root.setAttribute("data-theme-intensity", b.theme_intensity || "standard");
  root.setAttribute("data-theme-animation", b.theme_animation_enabled === false ? "off" : "on");

  // Admin-controlled UI knobs. data-* attributes drive formatters/CSS without
  // creating additional visual theme systems.
  root.setAttribute("data-splatter", b.splatter_intensity || "medium");
  root.setAttribute("data-case",     b.letter_case_preference || "upper");
  root.setAttribute("data-tfmt",     b.time_format || "12h");
  root.setAttribute("data-dfmt",     b.date_format || "us");
  root.setAttribute("data-wkstart",  b.week_starts_on || "sunday");
  try {
    window.__shUi = {
      time_format: b.time_format || "12h",
      date_format: b.date_format || "us",
      letter_case_preference: b.letter_case_preference || "upper",
      week_starts_on: b.week_starts_on || "sunday",
      show_prices_in_portal: b.show_prices_in_portal !== false,
      pwa_tagline: b.pwa_tagline || "",
      primary_cta_copy: b.primary_cta_copy || "Book Now",
    };
  } catch { /* SSR safety */ }
}

function applyTextSize(size) {
  document.documentElement.style.fontSize = FONT_SIZES[size] || FONT_SIZES.M;
  try { localStorage.setItem("sh_text_size", size); } catch { /* private mode */ }
}

export function ThemeProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [prefs, setPrefs] = useState({ text_size: localStorage.getItem("sh_text_size") || "M" });

  // 1. Apply the cached text-size immediately so there's no flicker on reload.
  useEffect(() => { applyTextSize(prefs.text_size); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Fetch brand colors (no auth) — works on Login screen too.
  // Sprint 110di-20-fix — exposed `reloadBranding` so Settings panels that
  // mutate branding-adjacent settings (dashboard_widgets, feature_visibility,
  // client_portal_controls) can push the latest values into context without
  // a hard refresh.
  const reloadBranding = useCallback(async () => {
    try {
      const { data } = await api.get("/branding");
      setBranding(data);
      applyBranding(data);
    } catch { /* offline-tolerant */ }
  }, []);
  useEffect(() => {
    let cancelled = false;
    api.get("/branding")
      .then(({ data }) => { if (!cancelled) { setBranding(data); applyBranding(data); } })
      .catch(() => applyBranding(DEFAULT_BRANDING));
    return () => { cancelled = true; };
  }, []);

  // 3. Once a user is logged in, fetch their personal text-size preference.
  //    We watch localStorage for a token change (login event) and re-poll.
  const loadUserPrefs = useCallback(async () => {
    if (!localStorage.getItem("sh_token")) return;
    try {
      const { data } = await api.get("/me/preferences");
      const ts = data?.text_size || "M";
      setPrefs({ text_size: ts });
      applyTextSize(ts);
    } catch { /* probably not logged in yet */ }
  }, []);

  useEffect(() => {
    loadUserPrefs();
    const onStorage = (e) => { if (e.key === "sh_token") loadUserPrefs(); };
    window.addEventListener("storage", onStorage);
    // also re-poll when window focuses (covers login in this tab)
    const onFocus = () => loadUserPrefs();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadUserPrefs]);

  const savePrefs = async (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (patch.text_size) applyTextSize(patch.text_size);
    try { await api.put("/me/preferences", patch); } catch { /* offline-tolerant */ }
  };

  const saveBranding = async (patch) => {
    const next = { ...branding, ...patch };
    setBranding(next);
    applyBranding(next);
    await api.put("/settings", patch); // admin-only — backend enforces it
  };

  return (
    <ThemeCtx.Provider value={{ branding, prefs, savePrefs, saveBranding, reloadBranding, reloadUserPrefs: loadUserPrefs }}>
      {children}
    </ThemeCtx.Provider>
  );
}

// Sprint 110di-17 — Feature Visibility. Convenience hook for any screen
// that needs to gate render based on the admin's feature toggles. Defaults
// to TRUE if the key is unknown or the branding hasn't loaded yet so the
// app never accidentally hides itself on first paint.
export const FEATURE_KEYS = [
  "daycare", "boarding", "training", "grooming", "photography",
  "retail", "rewards", "trivia", "homework", "staff_portal",
  "client_messaging", "payment_plans", "manual_payments", "waitlist",
];

export function useFeature(key) {
  const { branding } = useTheme();
  const fv = branding?.feature_visibility;
  if (!fv) return true;
  if (!(key in fv)) return true;
  return fv[key] !== false;
}

/**
 * <FeatureGate name="photography"> ... </FeatureGate>
 * Renders children only when the feature is enabled. Supports `fallback`
 * for empty-state replacement.
 */
export function FeatureGate({ name, children, fallback = null }) {
  const enabled = useFeature(name);
  return enabled ? children : fallback;
}
