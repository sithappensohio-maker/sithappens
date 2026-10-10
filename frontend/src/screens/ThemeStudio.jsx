// Theme Studio — Admin → Theme Studio. The full visual editor for a saved
// theme preset: upload seasonal/holiday artwork into the 12 asset slots,
// pick the 4 quick-palette colors, preview it live across three surfaces,
// and choose when/where it deploys — all on top of the Stage 1 backend
// (theme_presets' extended fields + the /theme-assets endpoints).
//
// Relationship to ThemeGallery.jsx (Settings → Brand & Appearance): that
// panel remains the quick switch/duplicate/export/import list. This screen
// is the full editor for ONE theme at a time — it reads/writes the exact
// same `theme_presets` documents, so either surface sees the other's
// changes immediately (nothing is duplicated or kept in sync by hand).
import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useTheme } from "../lib/theme";
import { toast } from "sonner";
import { useConfirm } from "../lib/useConfirm";
import PageHero from "../components/PageHero";
import ThemeAssetSlot from "../components/theme-studio/ThemeAssetSlot";
import ThemeDeploymentSettings from "../components/theme-studio/ThemeDeploymentSettings";
import ThemeLivePreviewPane from "../components/theme-studio/ThemeLivePreviewPane";

const ASSET_SLOTS = [
  { key: "heroBackground", label: "Hero Background Image", hint: "1920 × 600px · JPG, PNG", accept: "image/jpeg,image/png,image/webp", previewSize: "pdp" },
  { key: "sidebarAccentTop", label: "Sidebar Accent (Top)", hint: "400 × 400px · PNG, transparent", accept: "image/png,image/webp", previewSize: "card" },
  { key: "sidebarAccentBottom", label: "Sidebar Accent (Bottom)", hint: "400 × 400px · PNG, transparent", accept: "image/png,image/webp", previewSize: "card" },
  { key: "sectionHeaderBackground", label: "Section Header Background", hint: "1600 × 300px · JPG, PNG", accept: "image/jpeg,image/png,image/webp", previewSize: "card" },
  { key: "dashboardCardOverlay", label: "Dashboard Card Overlay", hint: "600 × 400px · PNG, transparent", accept: "image/png,image/webp", previewSize: "card" },
  { key: "eventBanner", label: "Event Banner Image", hint: "1200 × 400px · JPG, PNG", accept: "image/jpeg,image/png,image/webp", previewSize: "pdp" },
  { key: "loginBackground", label: "Login Background", hint: "1920 × 1080px · JPG, PNG", accept: "image/jpeg,image/png,image/webp", previewSize: "pdp" },
  { key: "loginAccent", label: "Login Screen Accent", hint: "800 × 800px · PNG, transparent", accept: "image/png,image/webp", previewSize: "card" },
  { key: "cornerSticker", label: "Small Corner Sticker", hint: "200 × 200px · PNG, transparent", accept: "image/png,image/webp", previewSize: "card" },
  { key: "announcementAccent", label: "Announcement Accent", hint: "400 × 400px · PNG, transparent", accept: "image/png,image/webp", previewSize: "thumb" },
  { key: "emptyStateIllustration", label: "Empty State Illustration", hint: "600 × 600px · PNG, transparent", accept: "image/png,image/webp", previewSize: "card" },
  { key: "ambientAnimation", label: "Optional GIF / Animation", hint: "400 × 400px · GIF, WEBP (max 5MB)", accept: "image/gif,image/webp", previewSize: "original", isAnimation: true },
];

const QUICK_PALETTE_FIELDS = [
  { key: "brand_primary", label: "Primary Color", sub: "main actions and success" },
  { key: "brand_accent", label: "Secondary Color", sub: "current state, links, information" },
  { key: "theme_glow_color", label: "Glow Color", sub: "card borders and highlight glow" },
  { key: "theme_text_display", label: "Text Accent", sub: "headlines and display text" },
];

const SWATCH_KEYS = QUICK_PALETTE_FIELDS.map((f) => f.key);

function ColorField({ label, sub, value, onChange, testid }) {
  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-3">
      <label className="text-[12px] font-black text-shText uppercase tracking-widest">{label}</label>
      {sub && <p className="text-[11px] text-shTextMuted mt-0.5">{sub}</p>}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`${testid}-picker`}
          className="w-12 h-10 rounded cursor-pointer bg-transparent border border-shBorder"
        />
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`${testid}-hex`}
          placeholder="#8cc63f"
          className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded px-2 py-1.5 text-sm text-shText font-mono"
        />
      </div>
    </div>
  );
}

function cloneTheme(t) {
  return { ...t, assets: { ...(t.assets || {}) }, enabled_targets: { ...(t.enabled_targets || {}) } };
}

export default function ThemeStudio() {
  const ctx = useTheme();
  const confirm = useConfirm();
  const branding = ctx?.branding;

  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [savedTheme, setSavedTheme] = useState(null); // last-known-saved copy of the theme being edited
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [newPanelOpen, setNewPanelOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const selectForEditing = (theme) => {
    setEditingId(theme.id);
    setSavedTheme(cloneTheme(theme));
    setDraft(cloneTheme(theme));
  };

  const load = async (selectId) => {
    setLoading(true);
    try {
      const { data } = await api.get("/settings/themes");
      const list = Array.isArray(data) ? data : [];
      setThemes(list);
      const pick = (selectId && list.find((t) => t.id === selectId))
        || list.find((t) => t.id === branding?.active_theme_id)
        || list[0];
      if (pick) selectForEditing(pick);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't load themes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ctx) return null;

  const dirty = !!(draft && savedTheme && JSON.stringify(draft) !== JSON.stringify(savedTheme));

  const trySelect = async (theme) => {
    if (theme.id === editingId) return;
    if (dirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        body: `You have unsaved edits to "${savedTheme?.name}". Switching themes will discard them.`,
        confirmText: "Discard & Switch",
        tone: "danger",
      });
      if (!ok) return;
    }
    selectForEditing(theme);
  };

  const updateDraft = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const updateAssets = (patch) => setDraft((d) => ({ ...d, assets: { ...d.assets, ...patch } }));
  const updateTargets = (patch) => setDraft((d) => ({ ...d, enabled_targets: { ...d.enabled_targets, ...patch } }));

  const save = async () => {
    if (!draft || !editingId) return;
    setSaving(true);
    try {
      const payload = {
        brand_primary: draft.brand_primary,
        brand_accent: draft.brand_accent,
        theme_glow_color: draft.theme_glow_color,
        theme_text_display: draft.theme_text_display,
        assets: draft.assets,
        enabled_targets: draft.enabled_targets,
        start_date: draft.start_date,
        end_date: draft.end_date,
        intensity: draft.intensity,
        animation_enabled: draft.animation_enabled,
      };
      const { data: updated } = await api.put(`/settings/themes/${editingId}`, payload);

      // Only NOW — after the save that moved the reference — is it safe to
      // drop whatever asset a slot pointed at before, same rule ShopManager
      // uses for a replaced product photo: never delete the old one until
      // the parent record that referenced it has itself been saved.
      for (const slot of ASSET_SLOTS) {
        const before = savedTheme?.assets?.[slot.key] || null;
        const after = updated?.assets?.[slot.key] || null;
        if (before && before !== after) {
          api.delete(`/theme-assets/${before}`).catch(() => {});
        }
      }

      setThemes((list) => list.map((t) => (t.id === updated.id ? updated : t)));
      setSavedTheme(cloneTheme(updated));
      setDraft(cloneTheme(updated));
      if (updated.id === branding?.active_theme_id) await ctx.reloadBranding();
      toast.success(`"${updated.name}" saved.`);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't save theme.");
    } finally {
      setSaving(false);
    }
  };

  const activate = async () => {
    if (!editingId || dirty) return;
    setActivating(true);
    try {
      await api.post(`/settings/themes/${editingId}/activate`);
      await ctx.reloadBranding();
      toast.success(`"${draft?.name}" is now live — including the client portal.`);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't activate theme.");
    } finally {
      setActivating(false);
    }
  };

  const deleteTheme = async (theme) => {
    const ok = await confirm({
      title: `Delete "${theme.name}"?`,
      body: "This saved theme is removed for good. It can't be undone.",
      confirmText: "Delete Theme",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/settings/themes/${theme.id}`);
      toast.success(`"${theme.name}" deleted.`);
      await load(theme.id === editingId ? undefined : editingId);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't delete that theme.");
    }
  };

  const createTheme = async () => {
    const name = newName.trim();
    if (!name) { toast.error("Give the theme a name first."); return; }
    setCreating(true);
    try {
      const base = savedTheme || {};
      const { data: created } = await api.post("/settings/themes", {
        name,
        brand_primary: base.brand_primary,
        brand_accent: base.brand_accent,
        theme_glow_color: base.theme_glow_color,
        theme_text_display: base.theme_text_display,
      });
      setNewPanelOpen(false);
      setNewName("");
      await load(created.id);
      toast.success(`"${name}" created — configure it below, then Save.`);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't create that theme.");
    } finally {
      setCreating(false);
    }
  };

  const isActiveTheme = editingId && editingId === branding?.active_theme_id;

  return (
    <div className="space-y-6 pb-16" data-testid="theme-studio">
      <PageHero
        eyebrow={{ icon: "fa-palette", text: "Theme Studio" }}
        title="Make Every Season"
        highlight="More Fun"
        subtitle="Customize your portals with seasonal themes, holidays, and special events. Upload images, adjust colors, schedule dates, and preview the changes live."
        testid="theme-studio-hero"
      />

      {loading || !draft ? (
        <div className="text-shTextMuted text-sm py-10 text-center" data-testid="theme-studio-loading">
          <i className="fas fa-spinner fa-spin mr-2" />Loading themes…
        </div>
      ) : (
        <>
          <div>
            <h3 className="text-xs font-black text-shSecondary uppercase tracking-widest">Themes</h3>
            <p className="text-[13px] text-shTextMuted mt-1">Choose a theme to edit, or create a new one from scratch.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3" data-testid="theme-studio-grid">
              {themes.map((t) => {
                const isEditing = t.id === editingId;
                const isActive = t.id === branding?.active_theme_id;
                const canDelete = !t.built_in && !isActive;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => trySelect(t)}
                    data-testid={`theme-studio-card-${t.id}`}
                    className={`text-left bg-[var(--sh-card-base)] border rounded-xl p-3 space-y-2 transition ${isEditing ? "border-shPrimary ring-1 ring-shPrimary/40" : "border-shBorder hover:border-shPrimary/40"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[14px] font-black text-shText truncate">{t.name}</p>
                      {isActive && (
                        <span className="shrink-0 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border bg-shPrimary/15 text-shPrimary border-shPrimary/40">
                          <i className="fas fa-circle-check mr-1" />Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {SWATCH_KEYS.map((k) => (
                        <span key={k} className="w-4 h-4 rounded-full border border-shBorder/60 shrink-0" style={{ background: t[k] }} />
                      ))}
                    </div>
                    {canDelete && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); deleteTheme(t); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); deleteTheme(t); } }}
                        data-testid={`theme-studio-delete-${t.id}`}
                        className="inline-block text-[10px] font-black uppercase tracking-widest text-shTextMuted hover:text-red-400"
                      >
                        Delete
                      </span>
                    )}
                  </button>
                );
              })}

              <div className="bg-[var(--sh-card-base)] border border-dashed border-shBorder rounded-xl p-3 flex flex-col justify-center items-center text-center gap-2">
                {newPanelOpen ? (
                  <div className="w-full space-y-2">
                    <input
                      type="text"
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Theme name"
                      data-testid="theme-studio-new-name"
                      className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded px-2 py-2 text-sm text-shText"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={createTheme}
                        disabled={creating}
                        data-testid="theme-studio-new-confirm"
                        className="flex-1 min-h-9 px-3 rounded bg-shPrimary text-bgHeader font-black text-[11px] uppercase tracking-widest disabled:opacity-50"
                      >
                        {creating ? "Creating…" : "Create"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setNewPanelOpen(false); setNewName(""); }}
                        disabled={creating}
                        className="min-h-9 px-3 rounded border border-shBorder text-shTextMuted font-black text-[11px] uppercase tracking-widest"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setNewPanelOpen(true); setNewName("New Theme"); }}
                    data-testid="theme-studio-new-btn"
                    className="min-h-9 px-4 rounded-lg text-shText font-black text-[12px] uppercase tracking-widest hover:text-shPrimary"
                  >
                    <i className="fas fa-plus mr-1.5" />New Theme
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4" data-testid="theme-studio-config">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-xs font-black text-shSecondary uppercase tracking-widest">Theme Configuration</h3>
                  <p className="text-[13px] text-shTextMuted mt-1">
                    Editing: <span className="text-shText font-bold">{draft.name}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isActiveTheme && (
                    <button
                      type="button"
                      onClick={activate}
                      disabled={activating || dirty}
                      title={dirty ? "Save your changes first" : undefined}
                      data-testid="theme-studio-activate"
                      className="min-h-9 px-3 rounded border border-shBorder text-shText font-black text-[11px] uppercase tracking-widest hover:border-shPrimary/50 disabled:opacity-40"
                    >
                      {activating ? "Activating…" : "Use This Theme"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving || !dirty}
                    data-testid="theme-studio-save"
                    className="min-h-9 px-4 rounded bg-shPrimary text-bgHeader font-black text-[11px] uppercase tracking-widest disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save Theme"}
                  </button>
                </div>
              </div>

              <div>
                <h4 className="text-[11px] font-black text-shTextMuted uppercase tracking-widest mb-1">Theme Images</h4>
                <p className="text-[12px] text-shTextMuted mb-3">Upload custom images for the theme. Recommended sizes are shown below each slot.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {ASSET_SLOTS.map((slot) => (
                    <ThemeAssetSlot
                      key={slot.key}
                      slotKey={slot.key}
                      label={slot.label}
                      hint={slot.hint}
                      accept={slot.accept}
                      isAnimation={!!slot.isAnimation}
                      previewSize={slot.previewSize}
                      assetId={draft.assets?.[slot.key] || null}
                      originalAssetId={savedTheme.assets?.[slot.key] || null}
                      onChange={(id) => updateAssets({ [slot.key]: id })}
                    />
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-[11px] font-black text-shTextMuted uppercase tracking-widest mb-1">Color Palette</h4>
                <p className="text-[12px] text-shTextMuted mb-3">Customize the theme's main colors. These apply throughout both portals.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {QUICK_PALETTE_FIELDS.map((f) => (
                    <ColorField
                      key={f.key}
                      label={f.label}
                      sub={f.sub}
                      value={draft[f.key]}
                      onChange={(v) => updateDraft({ [f.key]: v })}
                      testid={`theme-studio-color-${f.key}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <ThemeLivePreviewPane draft={draft} />
              <ThemeDeploymentSettings
                enabledTargets={draft.enabled_targets}
                onToggleTarget={(key, value) => updateTargets({ [key]: value })}
                startDate={draft.start_date}
                endDate={draft.end_date}
                onChangeStartDate={(v) => updateDraft({ start_date: v })}
                onChangeEndDate={(v) => updateDraft({ end_date: v })}
                intensity={draft.intensity || "standard"}
                onChangeIntensity={(v) => updateDraft({ intensity: v })}
                animationEnabled={draft.animation_enabled !== false}
                onToggleAnimation={(v) => updateDraft({ animation_enabled: v })}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
