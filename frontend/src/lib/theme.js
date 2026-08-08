// ThemeProvider — fetches the admin's global appearance settings (unauthed),
// fetches per-user text-size preference (when logged in), and applies them as
// CSS variables + an html font-size. The unified Sit Happens UI uses these
// variables everywhere, so changing the brand does not require a rebuild.
//
// Card appearance intentionally has ONE control (`interface_style`) instead of
// the retired per-card theme matrix. Semantic meaning still comes from the
// normal brand/status colors; this setting only changes chrome intensity.

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

function applyBranding(b) {
  const root = document.documentElement;
  const get = (k) => b[k] || DEFAULT_BRANDING[k];

  root.style.setProperty("--sh-green",  get("brand_primary"));
  root.style.setProperty("--sh-blue",   get("brand_accent"));
  root.style.setProperty("--sh-orange", get("brand_warning"));
  const fam = b.brand_font_family || DEFAULT_BRANDING.brand_font_family;
  root.style.setProperty("--sh-font", fam === "System" ? "system-ui" : `'${fam}'`);

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

  // One app-wide card chrome setting. Border/glow color follows the current
  // brand accent, so the UI remains coherent when the brand palette changes.
  const styleId = INTERFACE_STYLES[b.interface_style] ? b.interface_style : "standard";
  const style = INTERFACE_STYLES[styleId];
  const accent = get("brand_accent");
  const accentRgb = hexToRgb(accent);
  root.setAttribute("data-interface-style", styleId);
  root.style.setProperty("--card-border-color", accent);
  root.style.setProperty("--card-border-rgba", `rgba(${accentRgb}, ${style.borderOpacity})`);
  root.style.setProperty("--card-border-width", `${style.borderWidth}px`);
  root.style.setProperty("--card-glow-color", accent);
  root.style.setProperty("--card-glow-rgba", `rgba(${accentRgb}, ${style.glowOpacity})`);
  root.style.setProperty("--card-glow-blur", `${style.glowBlur}px`);
  root.style.setProperty("--card-inner-highlight-color", "#FFFFFF");
  root.style.setProperty("--card-inner-highlight-rgba", `rgba(255, 255, 255, ${style.innerOpacity})`);

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
