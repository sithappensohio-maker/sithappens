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
};

function applyBranding(b) {
  const root = document.documentElement;
  root.style.setProperty("--sh-green",  b.brand_primary  || DEFAULT_BRANDING.brand_primary);
  root.style.setProperty("--sh-blue",   b.brand_accent   || DEFAULT_BRANDING.brand_accent);
  root.style.setProperty("--sh-orange", b.brand_warning  || DEFAULT_BRANDING.brand_warning);
  const fam = b.brand_font_family || DEFAULT_BRANDING.brand_font_family;
  root.style.setProperty("--sh-font", fam === "System" ? "system-ui" : `'${fam}'`);
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
