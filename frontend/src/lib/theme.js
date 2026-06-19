// ThemeProvider — fetches admin's global Brand & Theme settings (unauthed),
// fetches per-user text-size preference (when logged in), and applies them as
// CSS variables + an html font-size. All Tailwind brand colors (bg-shGreen,
// text-shBlue, etc.) and the body font are wired to these vars so the whole
// app recolors instantly without rebuilds.
//
// Usage:
//   <ThemeProvider><App/></ThemeProvider>
//   const { branding, prefs, savePrefs, saveBranding } = useTheme();
//
// Text size scale (controls html font-size — all rem-based Tailwind sizes follow):
//   S=16px  M=18.5px (default)  L=21px  XL=24px

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";

const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

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
const DEFAULT_BRANDING = {
  brand_primary: "#8cc63f",
  brand_accent:  "#00a9e0",
  brand_warning: "#f26522",
  brand_font_family: "Inter",
  brand_footer_text: "Sit Happens",
  brand_footer_url: "",
  grad_hero_color:    "#8cc63f",
  grad_info_color:    "#00a9e0",
  grad_warning_color: "#f59e0b",
  grad_danger_color:  "#ef4444",
  grad_success_color: "#8cc63f",
  // Sprint 110di-8 — expanded theme controls. All five groups (backgrounds,
  // text, buttons, forms, calendar/table) live under the same global
  // settings doc and apply via CSS vars on <html>.
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
  // Sprint 110di-13 — Card chrome lives entirely under `card_type_themes`.
  // The Default Card type drives the global panel border/glow/highlight via
  // the mirror block in applyBranding() below.
};

// Sprint 110di-12/13 — Card Type Themes. Mirrors the backend
// `_card_type_theme_defaults()`. Inner highlight rolled into each type so
// the Default Card is the single source of truth for global panel chrome.
const CT_BASE = { border_opacity: 0.75, border_width: 2, glow_opacity: 0.25, glow_blur: 14, inner_highlight_color: "#FFFFFF", inner_highlight_opacity: 0.08, heading: "", text: "" };
export const DEFAULT_CARD_TYPES = {
  default:  { bg: "#05090D", border: "#008CFF", glow: "#008CFF", accent: "#008CFF", ...CT_BASE },
  info:     { bg: "#05090D", border: "#008CFF", glow: "#008CFF", accent: "#00C8FF", ...CT_BASE },
  stats:    { bg: "#05090D", border: "#1B4D7A", glow: "#008CFF", accent: "#9BCB00", ...CT_BASE },
  success:  { bg: "#071006", border: "#9BCB00", glow: "#9BCB00", accent: "#9BCB00", ...CT_BASE },
  warning:  { bg: "#130B02", border: "#F26500", glow: "#F26500", accent: "#F26500", ...CT_BASE },
  danger:   { bg: "#170407", border: "#FF3B5C", glow: "#FF3B5C", accent: "#FF3B5C", ...CT_BASE },
  payment:  { bg: "#09080D", border: "#F26500", glow: "#F26500", accent: "#9BCB00", ...CT_BASE },
  training: { bg: "#070914", border: "#A855F7", glow: "#A855F7", accent: "#A855F7", ...CT_BASE },
  booking:  { bg: "#050B14", border: "#008CFF", glow: "#008CFF", accent: "#00C8FF", ...CT_BASE },
  profile:  { bg: "#080C16", border: "#9BCB00", glow: "#008CFF", accent: "#9BCB00", ...CT_BASE },
};

// Convert "#RRGGBB" → "r, g, b" string for CSS rgba() composition.
function hexToRgb(hex) {
  const h = (hex || "").replace("#", "").trim();
  if (h.length !== 6) return "140, 198, 63";
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function applyBranding(b) {
  const root = document.documentElement;
  const get = (k) => b[k] || DEFAULT_BRANDING[k];
  root.style.setProperty("--sh-green",  get("brand_primary"));

// Clamp a 0-1 value with a graceful fallback when undefined / NaN.
function clamp01(v, fallback) {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, 0), 1);
}

  root.style.setProperty("--sh-blue",   get("brand_accent"));
  root.style.setProperty("--sh-orange", get("brand_warning"));
  const fam = b.brand_font_family || DEFAULT_BRANDING.brand_font_family;
  root.style.setProperty("--sh-font", fam === "System" ? "system-ui" : `'${fam}'`);
  // Gradient colors → expose both hex (for borders) and rgb (for rgba() in gradient stops)
  root.style.setProperty("--grad-hero",       get("grad_hero_color"));
  root.style.setProperty("--grad-info",       get("grad_info_color"));
  root.style.setProperty("--grad-warning",    get("grad_warning_color"));
  root.style.setProperty("--grad-danger",     get("grad_danger_color"));
  root.style.setProperty("--grad-success",    get("grad_success_color"));
  root.style.setProperty("--grad-hero-rgb",    hexToRgb(get("grad_hero_color")));
  root.style.setProperty("--grad-info-rgb",    hexToRgb(get("grad_info_color")));
  root.style.setProperty("--grad-warning-rgb", hexToRgb(get("grad_warning_color")));
  root.style.setProperty("--grad-danger-rgb",  hexToRgb(get("grad_danger_color")));
  root.style.setProperty("--grad-success-rgb", hexToRgb(get("grad_success_color")));
  // Sprint 110di-8 — expanded theme surfaces. CSS vars consumed directly by
  // Tailwind utilities (bgBase/bgPanel/bgHeader/bgHover) and `index.css`
  // global selectors (forms, calendar, tables, buttons).
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
  // Sprint 110di-13 — Card chrome variables (--card-border-*, --card-glow-*,
  // --card-inner-highlight-*) are written exclusively by the Default Card
  // Type Theme block further down. Legacy top-level `card_border_*` /
  // `card_glow_*` / `card_inner_highlight_*` settings are no longer used.

  // Sprint 110di-12 — Card Type Themes. Each type writes a small block of
  // CSS vars consumed by the matching `.card-{type}` class in index.css.
  // Default-fallback chain: explicit setting → DEFAULT_CARD_TYPES → black.
  const types = (b.card_type_themes && typeof b.card_type_themes === "object")
    ? b.card_type_themes
    : DEFAULT_CARD_TYPES;
  Object.keys(DEFAULT_CARD_TYPES).forEach((id) => {
    const t = { ...DEFAULT_CARD_TYPES[id], ...(types[id] || {}) };
    const bRgb = hexToRgb(t.border);
    const gRgb = hexToRgb(t.glow);
    const ihRgb = hexToRgb(t.inner_highlight_color || "#FFFFFF");
    const bAlpha = clamp01(t.border_opacity, 0.75);
    const gAlpha = clamp01(t.glow_opacity, 0.25);
    const ihAlpha = clamp01(t.inner_highlight_opacity, 0.08);
    const bWidth = Math.max(0, parseFloat(t.border_width ?? 2));
    const gBlur  = Math.max(0, parseFloat(t.glow_blur ?? 14));
    root.style.setProperty(`--ct-${id}-bg`,         t.bg);
    root.style.setProperty(`--ct-${id}-border`,     t.border);
    root.style.setProperty(`--ct-${id}-border-rgba`, `rgba(${bRgb}, ${bAlpha})`);
    root.style.setProperty(`--ct-${id}-border-w`,   `${bWidth}px`);
    root.style.setProperty(`--ct-${id}-glow`,       t.glow);
    root.style.setProperty(`--ct-${id}-glow-rgba`,  `rgba(${gRgb}, ${gAlpha})`);
    root.style.setProperty(`--ct-${id}-glow-blur`,  `${gBlur}px`);
    root.style.setProperty(`--ct-${id}-accent`,     t.accent);
    root.style.setProperty(`--ct-${id}-inner-highlight-rgba`, `rgba(${ihRgb}, ${ihAlpha})`);
    if (t.heading) root.style.setProperty(`--ct-${id}-heading`, t.heading);
    if (t.text)    root.style.setProperty(`--ct-${id}-text`,    t.text);
    // Sprint 110di-13 — Mirror the DEFAULT type to the legacy global card
    // variables so `.bg-bgPanel::after` (and any code still reading
    // `--card-border-rgba` / `--card-glow-rgba` / `--card-inner-highlight-rgba`)
    // also picks up the unified Default Card values. Single source of truth.
    if (id === "default") {
      root.style.setProperty("--card-border-color",   t.border);
      root.style.setProperty("--card-border-rgba",    `rgba(${bRgb}, ${bAlpha})`);
      root.style.setProperty("--card-border-width",   `${bWidth}px`);
      root.style.setProperty("--card-glow-color",     t.glow);
      root.style.setProperty("--card-glow-rgba",      `rgba(${gRgb}, ${gAlpha})`);
      root.style.setProperty("--card-glow-blur",      `${gBlur}px`);
      root.style.setProperty("--card-inner-highlight-color", t.inner_highlight_color || "#FFFFFF");
      root.style.setProperty("--card-inner-highlight-rgba",  `rgba(${ihRgb}, ${ihAlpha})`);
    }
  });
  // Sprint 110dm — admin-controlled UI knobs. data-* attributes drive CSS
  // selectors (splatter intensity, letter case, time/date format, week start).
  root.setAttribute("data-splatter", b.splatter_intensity || "medium");
  root.setAttribute("data-case",     b.letter_case_preference || "upper");
  root.setAttribute("data-tfmt",     b.time_format || "12h");
  root.setAttribute("data-dfmt",     b.date_format || "us");
  root.setAttribute("data-wkstart",  b.week_starts_on || "sunday");
  // Persist for the lightweight format helpers in lib/format.js
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
    <ThemeCtx.Provider value={{ branding, prefs, savePrefs, saveBranding, reloadUserPrefs: loadUserPrefs }}>
      {children}
    </ThemeCtx.Provider>
  );
}
