// Theme Gallery — Settings → Brand & Appearance.
//
// Sits above BrandPanel: BrandPanel edits whichever theme preset is
// currently live (it only ever reads/writes `ctx.branding`/`PUT /settings`
// and needs zero changes of its own), while this component manages the
// library of saved presets around that one live slot — switch instantly,
// duplicate as a starting point, export/import as JSON, or delete.
//
// "Live" here means app-wide: colors are plain CSS variables set on
// <html> by ThemeProvider (lib/theme.js) from a single `GET /branding`
// call, and both the admin shell and the client-facing Portal screens
// read the SAME variables (see BrandPanel's own "Brand Colors" section,
// which already calls this out: "...across the admin app, client portal,
// Online School, and public pages."). So activating a theme here re-skins
// the client portal too — there's no separate portal theme to keep in
// sync, and nothing else in this file needs to special-case it.
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../lib/theme";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import { useConfirm } from "../lib/useConfirm";

// Every color/font/interface field a preset carries. Kept local (rather
// than re-derived from BrandPanel) so this file has no dependency on
// BrandPanel's internals — only on the backend contract both share.
const THEME_FIELD_KEYS = [
  "brand_primary", "brand_accent", "brand_warning", "brand_font_family",
  "brand_footer_text", "brand_footer_url", "interface_style",
  "theme_bg_base", "theme_bg_panel", "theme_bg_header", "theme_bg_hover",
  "theme_text_primary", "theme_text_muted", "theme_text_display",
  "theme_btn_primary_bg", "theme_btn_primary_fg",
  "theme_btn_secondary_border", "theme_btn_secondary_fg",
  "theme_btn_danger_bg", "theme_btn_danger_fg",
  "theme_input_bg", "theme_input_border", "theme_input_focus",
  "theme_calendar_active", "theme_table_hover", "theme_row_border",
];

function fieldsOf(obj) {
  const out = {};
  THEME_FIELD_KEYS.forEach((k) => { out[k] = obj?.[k]; });
  return out;
}

function slugify(name) {
  return (name || "theme").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "theme";
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const swatchKeys = ["brand_primary", "brand_accent", "brand_warning", "theme_bg_panel"];

export default function ThemeGallery() {
  const ctx = useTheme();
  const confirm = useConfirm();
  const branding = ctx?.branding;

  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null); // theme id currently activating
  // The one inline "name this theme" panel open at a time — either the
  // "+ New Theme" section or a specific card's "Duplicate" action.
  const [panel, setPanel] = useState(null); // null | { type: "new" } | { type: "duplicate", theme }
  const [panelName, setPanelName] = useState("");
  const [panelSaving, setPanelSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  const load = async () => {
    try {
      const { data } = await api.get("/settings/themes");
      setThemes(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't load saved themes.");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/settings/themes");
        if (!cancelled) setThemes(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) toast.error(formatErr(e.response?.data?.detail) || "Couldn't load saved themes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ctx) return null;

  const activeTheme = themes.find((t) => t.id === branding?.active_theme_id) || null;

  const closePanel = () => { setPanel(null); setPanelName(""); };

  const activate = async (t) => {
    setBusyId(t.id);
    try {
      await api.post(`/settings/themes/${t.id}/activate`);
      await ctx.reloadBranding();
      await load();
      toast.success(`"${t.name}" is now live — including the client portal.`);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't switch themes.");
    } finally {
      setBusyId(null);
    }
  };

  const submitPanel = async () => {
    if (!panel) return;
    const name = panelName.trim();
    if (!name) { toast.error("Give the theme a name first."); return; }
    const source = panel.type === "duplicate" ? panel.theme : (activeTheme || branding);
    setPanelSaving(true);
    try {
      const { data: created } = await api.post("/settings/themes", { name, ...fieldsOf(source) });
      await api.post(`/settings/themes/${created.id}/activate`);
      await ctx.reloadBranding();
      await load();
      closePanel();
      toast.success(`"${name}" created and activated.`);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't create that theme.");
    } finally {
      setPanelSaving(false);
    }
  };

  const exportTheme = (t) => {
    downloadJson(`sit-happens-theme-${slugify(t.name)}.json`, { name: t.name, ...fieldsOf(t) });
  };

  const deleteTheme = async (t) => {
    const ok = await confirm({
      title: `Delete "${t.name}"?`,
      body: "This saved theme is removed for good. It can't be undone.",
      confirmText: "Delete Theme",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/settings/themes/${t.id}`);
      await load();
      toast.success(`"${t.name}" deleted.`);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't delete that theme.");
    }
  };

  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file again later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result || ""));
      } catch {
        toast.error("That doesn't look like a valid theme file.");
        return;
      }
      if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) {
        toast.error("That doesn't look like a valid theme file.");
        return;
      }
      setImporting(true);
      try {
        await api.post("/settings/themes", parsed);
        await load();
        toast.success(`"${parsed.name}" imported — find it below to activate it.`);
      } catch (e2) {
        toast.error(formatErr(e2.response?.data?.detail) || "Couldn't import that theme.");
      } finally {
        setImporting(false);
      }
    };
    reader.onerror = () => toast.error("That doesn't look like a valid theme file.");
    reader.readAsText(file);
  };

  const inlineNameField = (testidPrefix) => (
    <div className="mt-3 pt-3 border-t border-shBorder space-y-2">
      <input
        type="text"
        autoFocus
        value={panelName}
        onChange={(e) => setPanelName(e.target.value)}
        placeholder="Theme name"
        data-testid={`${testidPrefix}-name`}
        className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded px-2 py-2 text-sm text-shText"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submitPanel}
          disabled={panelSaving}
          data-testid={`${testidPrefix}-confirm`}
          className="min-h-9 px-4 rounded bg-shPrimary text-bgHeader font-black text-[12px] uppercase tracking-widest disabled:opacity-50"
        >
          {panelSaving ? "Creating…" : "Create & Activate"}
        </button>
        <button
          type="button"
          onClick={closePanel}
          disabled={panelSaving}
          data-testid={`${testidPrefix}-cancel`}
          className="min-h-9 px-4 rounded border border-shBorder text-shTextMuted font-black text-[12px] uppercase tracking-widest"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="theme-gallery">
      <div>
        <h3 className="text-xs font-black text-shSecondary uppercase tracking-widest">Saved Themes</h3>
        <p className="text-[13px] text-shTextMuted mt-1">
          Switch the whole app's look instantly, or create your own.
        </p>
      </div>

      {loading ? (
        <div className="text-shTextMuted text-sm py-8 text-center" data-testid="theme-gallery-loading">
          <i className="fas fa-spinner fa-spin mr-2" />Loading themes…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="theme-gallery-grid">
            {themes.map((t) => {
              const isActive = t.id === branding?.active_theme_id;
              const canDelete = !t.built_in && !isActive;
              const duplicateOpen = panel?.type === "duplicate" && panel.theme.id === t.id;
              return (
                <div
                  key={t.id}
                  data-testid={`theme-card-${t.id}`}
                  className={`bg-[var(--sh-card-base)] border rounded-xl p-4 space-y-3 ${isActive ? "border-shPrimary/60" : "border-shBorder"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[15px] font-black text-shText truncate">{t.name}</p>
                      <div className="flex items-center gap-1.5 mt-2">
                        {swatchKeys.map((k) => (
                          <span
                            key={k}
                            className="w-5 h-5 rounded-full border border-shBorder/60 shrink-0"
                            style={{ background: t[k] }}
                          />
                        ))}
                      </div>
                    </div>
                    {isActive && (
                      <span
                        className="shrink-0 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border bg-shPrimary/15 text-shPrimary border-shPrimary/40"
                        data-testid={`theme-active-badge-${t.id}`}
                      >
                        <i className="fas fa-circle-check mr-1" />Active
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => activate(t)}
                        disabled={busyId === t.id}
                        data-testid={`theme-activate-${t.id}`}
                        className="min-h-9 px-3 rounded bg-shPrimary text-bgHeader font-black text-[11px] uppercase tracking-widest disabled:opacity-50"
                      >
                        {busyId === t.id ? "Activating…" : "Use This Theme"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setPanel({ type: "duplicate", theme: t }); setPanelName(`${t.name} (Copy)`); }}
                      data-testid={`theme-duplicate-${t.id}`}
                      className="min-h-9 px-3 rounded border border-shBorder text-shText font-black text-[11px] uppercase tracking-widest hover:border-shSecondary/50"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => exportTheme(t)}
                      data-testid={`theme-export-${t.id}`}
                      className="min-h-9 px-3 rounded border border-shBorder text-shText font-black text-[11px] uppercase tracking-widest hover:border-shSecondary/50"
                    >
                      Export
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => deleteTheme(t)}
                        data-testid={`theme-delete-${t.id}`}
                        className="min-h-9 px-3 rounded border border-red-500/40 text-red-400 font-black text-[11px] uppercase tracking-widest hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {duplicateOpen && inlineNameField(`theme-duplicate-inline-${t.id}`)}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-start gap-3 pt-3 border-t border-shBorder">
            <div className="min-w-[220px]">
              <button
                type="button"
                onClick={() => { setPanel({ type: "new" }); setPanelName("New Theme"); }}
                data-testid="theme-new-btn"
                className="min-h-11 px-4 rounded-lg border border-shBorder text-shText font-black text-[12px] uppercase tracking-widest hover:border-shPrimary/50"
              >
                <i className="fas fa-plus mr-1.5" />New Theme
              </button>
              {panel?.type === "new" && inlineNameField("theme-new-inline")}
            </div>

            <div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                data-testid="theme-import-btn"
                className="min-h-11 px-4 rounded-lg border border-shBorder text-shText font-black text-[12px] uppercase tracking-widest hover:border-shSecondary/50 disabled:opacity-50"
              >
                <i className="fas fa-upload mr-1.5" />{importing ? "Importing…" : "Import Theme"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                data-testid="theme-import-input"
                className="hidden"
                onChange={onImportFile}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
