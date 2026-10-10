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
import { useEffect, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useTheme } from "../lib/theme";
import { toast } from "sonner";
import { useConfirm } from "../lib/useConfirm";
import PageHero from "../components/PageHero";
import ThemeAssetSlot from "../components/theme-studio/ThemeAssetSlot";
import ThemeDeploymentSettings from "../components/theme-studio/ThemeDeploymentSettings";
import ThemeLivePreviewPane from "../components/theme-studio/ThemeLivePreviewPane";

const ASSET_SLOTS = [
  {
    key: "heroBackground", label: "Hero Background Image", hint: "1920 × 600px · JPG, PNG",
    accept: "image/jpeg,image/png,image/webp", previewSize: "pdp",
    purpose: "The wide banner behind the welcome header on the Client Portal home, Staff Portal home, and the admin Today dashboard.",
    promptTemplate: "A wide 1920×600px banner illustration for \"Sit Happens,\" a dog daycare and training business whose mascot is a husky. Show a husky in a {THEME} scene with a dark, moody atmosphere. Leave the left two-thirds relatively uncluttered and darker, since a white page title will be overlaid there. Warm, professional pet-business illustration style — not cartoonish or clipart. Landscape orientation, 1920×600px, JPG or PNG.",
  },
  {
    key: "sidebarAccentTop", label: "Sidebar Accent (Top)", hint: "400 × 400px · PNG, transparent",
    accept: "image/png,image/webp", previewSize: "card",
    purpose: "A soft watermark behind the logo at the top of the sidebar, in both the client and staff navigation.",
    promptTemplate: "A 400×400px PNG with a FULLY TRANSPARENT background, showing a simple husky illustration with light {THEME} decoration. Centered, generously padded, soft/muted colors — it sits at low opacity behind a logo and text. No background color — transparent PNG only.",
  },
  {
    key: "sidebarAccentBottom", label: "Sidebar Accent (Bottom)", hint: "400 × 400px · PNG, transparent",
    accept: "image/png,image/webp", previewSize: "card",
    purpose: "The same soft watermark treatment, at the bottom of the sidebar instead of the top.",
    promptTemplate: "A 400×400px PNG with a FULLY TRANSPARENT background, a second simple husky illustration (different pose than the top accent) with light {THEME} decoration. Centered, generously padded, soft/muted colors. Transparent PNG only.",
  },
  {
    key: "sectionHeaderBackground", label: "Section Header Background", hint: "1600 × 300px · JPG, PNG",
    accept: "image/jpeg,image/png,image/webp", previewSize: "card",
    purpose: "A faint background wash behind the page title on nearly every admin screen (Shop Manager, Income, Clients, and ~30 more) — shown at roughly a third opacity, so it needs to read fine without fine detail.",
    promptTemplate: "A wide 1600×300px background texture/illustration for {THEME}, featuring subtle husky silhouettes or paw prints and seasonal motifs. Muted, low-contrast — this is shown at roughly 35% opacity as a wash behind a white page title across many pages. JPG or PNG.",
  },
  {
    key: "dashboardCardOverlay", label: "Dashboard Card Overlay", hint: "600 × 400px · PNG, transparent",
    accept: "image/png,image/webp", previewSize: "card",
    purpose: "A light decoration on small stat-number tiles (e.g. \"71 Dogs Here\") on the admin Today page.",
    promptTemplate: "A 600×400px PNG with a transparent background, a light, corner-weighted {THEME} decoration suitable for layering softly behind a bold number and short label on a small stat card. Mostly empty/transparent in the center so the number stays readable. Transparent PNG only.",
  },
  {
    key: "eventBanner", label: "Event Banner Image", hint: "1200 × 400px · JPG, PNG",
    accept: "image/jpeg,image/png,image/webp", previewSize: "pdp",
    purpose: "The background of the \"Upcoming Event\" promo card, shown on both the admin Today page and the Client Portal home — only appears when a real event is published.",
    promptTemplate: "A 1200×400px banner background for a dog daycare event promo card (e.g. a costume contest or holiday party), featuring a husky in a festive {THEME} setting. Leave the left side calmer for a white event title. JPG or PNG.",
  },
  {
    key: "loginBackground", label: "Login Background", hint: "1920 × 1080px · JPG, PNG",
    accept: "image/jpeg,image/png,image/webp", previewSize: "pdp",
    purpose: "The full-bleed background behind the entire login/sign-in page.",
    promptTemplate: "A full-bleed 1920×1080px background image for a dog daycare login page, featuring a husky in an atmospheric {THEME} scene, dark and moody enough that white text and a dark sign-in card can sit on top. Landscape, JPG or PNG.",
  },
  {
    key: "loginAccent", label: "Login Screen Accent", hint: "800 × 800px · PNG, transparent",
    accept: "image/png,image/webp", previewSize: "card",
    purpose: "A small circular badge shown on the login card itself, next to the sign-in form.",
    promptTemplate: "An 800×800px PNG with a transparent background, a circular badge-style illustration of a husky face wearing {THEME} decoration. Centered, bold enough to read clearly at a small size (about 56px on screen). Transparent PNG only.",
  },
  {
    key: "cornerSticker", label: "Small Corner Sticker", hint: "200 × 200px · PNG, transparent",
    accept: "image/png,image/webp", previewSize: "card",
    purpose: "A tiny sticker in the corner of hero banners (Client Portal, Staff Portal, admin Today) — shown instead of the animation when animation is off or none is uploaded.",
    promptTemplate: "A 200×200px PNG with a transparent background, ONE simple isolated {THEME} icon or sticker in a flat illustration style. No scene and no husky needed here — just one small graphic element, like a sticker. Transparent PNG only.",
  },
  {
    key: "announcementAccent", label: "Announcement Accent", hint: "400 × 400px · PNG, transparent",
    accept: "image/png,image/webp", previewSize: "thumb",
    purpose: "A decorative accent behind the Announcements card on the Client Portal home.",
    promptTemplate: "A 400×400px PNG with a transparent background, a soft {THEME}-themed decorative pattern, subtle enough to sit behind a bullhorn icon and announcement text at low opacity. Transparent PNG only.",
  },
  {
    key: "emptyStateIllustration", label: "Empty State Illustration", hint: "600 × 600px · PNG, transparent",
    accept: "image/png,image/webp", previewSize: "card",
    purpose: "Shown behind \"nothing here yet\" messages across the app (e.g. \"No dogs added yet\").",
    promptTemplate: "A 600×600px PNG with a transparent background, a friendly, gentle illustration of a husky puppy with light {THEME} decoration, designed to sit softly behind a short empty-state message and a button. Warm and inviting, not sad or empty-feeling. Transparent PNG only.",
  },
  {
    key: "ambientAnimation", label: "Optional GIF / Animation", hint: "400 × 400px · GIF, WEBP (max 5MB)",
    accept: "image/gif,image/webp", previewSize: "original", isAnimation: true,
    purpose: "A small looping animated sticker in the same hero corner spot as the corner sticker — shown instead of it when animation is turned on.",
    promptTemplate: "A short, SIMPLE looping animation (GIF or animated WEBP), 400×400px, transparent background, of one small {THEME} element with gentle motion (e.g. a twinkling star, falling snow). Keep the file small — well under 5MB — and the loop short and seamless. Avoid fast flashing or strobing.",
  },
];

function buildImageGuide(themeName) {
  const theme = (themeName || "").trim() || "seasonal/holiday";
  const lines = [
    `# Sit Happens Theme Studio — Image Guide`,
    ``,
    `Specs and ready-to-use AI image prompts for every Theme Studio slot${themeName ? ` — written for "${themeName}"` : ""}. Paste a prompt into an image generator (ChatGPT/DALL·E, Midjourney, etc.), then upload the result into the matching slot in Theme Studio.`,
    ``,
    `**Brand context** (already baked into each prompt below, repeated here for reference or if you want to write your own): Sit Happens is a dog daycare, boarding, and training business. Its mascot is a **husky** — not a generic dog or golden retriever. The app's visual style is a dark navy background (#060c2e) with neon green, blue, and orange accents.`,
    ``,
    `Every slot is optional — upload only the ones you want for this theme. "PNG, transparent" slots must have a real transparent background (not white) or they'll show a solid box instead of blending into the page.`,
    ``,
    `---`,
    ``,
  ];
  ASSET_SLOTS.forEach((slot, i) => {
    lines.push(`## ${i + 1}. ${slot.label}`);
    lines.push(``);
    lines.push(`- **Size:** ${slot.hint}`);
    lines.push(`- **Used for:** ${slot.purpose}`);
    lines.push(``);
    lines.push("**Prompt:**");
    lines.push("```");
    lines.push(slot.promptTemplate.replaceAll("{THEME}", theme));
    lines.push("```");
    lines.push(``);
  });
  return lines.join("\n");
}

function downloadImageGuide(themeName) {
  const blob = new Blob([buildImageGuide(themeName)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sit-happens-theme-studio-image-guide.md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
          aria-label={`${label} color picker`}
          className="w-12 h-10 rounded cursor-pointer bg-transparent border border-shBorder"
        />
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`${testid}-hex`}
          placeholder="#8cc63f"
          aria-label={`${label} hex value`}
          className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded px-2 py-1.5 text-sm text-shText font-mono"
        />
      </div>
    </div>
  );
}

function cloneTheme(t) {
  return { ...t, assets: { ...(t.assets || {}) }, enabled_targets: { ...(t.enabled_targets || {}) } };
}

// Remembers which theme the admin was last editing — purely a per-browser
// convenience (same convention as sh_text_size), never a source of truth.
// Without this, a reload always re-defaulted to whichever theme is ACTIVE,
// silently discarding whatever non-active theme the admin was actually
// working on. That theme's edits were never lost (every Save round-trips
// through the real API), but Theme Studio looked like it had forgotten
// them, because it was quietly showing a different theme's empty slots.
const LAST_EDITED_THEME_KEY = "sh_theme_studio_last_edited_id";

// Pure so it's directly unit-testable (see ThemeStudio.test.js) without
// mocking the API/context this screen otherwise needs. Order matters: the
// remembered theme wins over the active one specifically because editing a
// theme you haven't activated yet (the normal "prep it before the holiday"
// workflow) is the exact case a pure active-theme default silently broke.
export function pickThemeToEdit({ list, rememberedId, activeThemeId }) {
  return (rememberedId && list.find((t) => t.id === rememberedId))
    || list.find((t) => t.id === activeThemeId)
    || list[0]
    || null;
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
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);

  const selectForEditing = (theme) => {
    setEditingId(theme.id);
    setSavedTheme(cloneTheme(theme));
    setDraft(cloneTheme(theme));
    try { localStorage.setItem(LAST_EDITED_THEME_KEY, theme.id); } catch { /* private mode */ }
  };

  // Picking which theme to default into only happens ONCE (guarded by this
  // ref), not every time `branding` changes — otherwise a later
  // reloadBranding() (e.g. from this screen's own activate(), or anything
  // else that touches branding while this page happens to be mounted) would
  // silently blow away whatever the admin is mid-edit on. But the FIRST
  // pick can't just read `branding` once on mount either: ThemeProvider's
  // own `/branding` fetch is still async at that point, so `ctx.branding`
  // is still DEFAULT_BRANDING — an object that has no `active_theme_id` KEY
  // at all (fetch_branding() always includes the key, `null` or not, so its
  // presence is what actually distinguishes "real data" from "placeholder",
  // not just truthiness). A hard reload landing directly on this page would
  // otherwise default to whatever theme sorts first rather than the one
  // that's actually live. So the guard is only satisfied once `branding`
  // demonstrably came from a real fetch; until then this re-fires (via the
  // dependency array below) on every `branding` identity change, and simply
  // keeps the loading spinner up rather than flashing the wrong theme.
  const initialPickDone = useRef(false);

  const load = async (selectId) => {
    setLoading(true);
    try {
      const { data } = await api.get("/settings/themes");
      const list = Array.isArray(data) ? data : [];
      setThemes(list);
      const brandingReady = !!branding && "active_theme_id" in branding;
      let pick = null;
      if (selectId) {
        pick = list.find((t) => t.id === selectId) || list[0];
      } else if (!initialPickDone.current && brandingReady) {
        let rememberedId = null;
        try { rememberedId = localStorage.getItem(LAST_EDITED_THEME_KEY); } catch { /* private mode */ }
        pick = pickThemeToEdit({ list, rememberedId, activeThemeId: branding.active_theme_id });
      }
      if (pick) {
        selectForEditing(pick);
        if (!selectId) initialPickDone.current = true;
      }
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't load themes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [branding?.active_theme_id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Export/Import Theme Pack — a .zip with the theme's artwork, unlike
  // ThemeGallery's plain-JSON export (colors only). Exports whichever theme
  // is currently open for editing; import always creates a new theme (never
  // overwrites one in place) and selects it for editing, same as "+ New
  // Theme" and duplicate already do.
  const exportThemePack = async () => {
    if (!editingId) return;
    setExporting(true);
    try {
      const resp = await api.get(`/settings/themes/${editingId}/export`, { responseType: "blob" });
      const blob = new Blob([resp.data], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sit-happens-theme-${(draft?.name || "theme").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't export that theme.");
    } finally {
      setExporting(false);
    }
  };

  const onImportPackFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file again later
    if (!file) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data: created } = await api.post("/settings/themes/import", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await load(created.id);
      toast.success(`"${created.name}" imported — find it above to configure or activate it.`);
    } catch (e2) {
      toast.error(formatErr(e2.response?.data?.detail) || "Couldn't import that theme pack.");
    } finally {
      setImporting(false);
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
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
              data-testid="theme-studio-import-pack-btn"
              className="min-h-10 px-3 rounded-lg border border-shBorder text-shText font-black text-[11px] uppercase tracking-widest hover:border-shSecondary/50 disabled:opacity-50"
            >
              <i className="fas fa-upload mr-1.5" />{importing ? "Importing…" : "Import Theme Pack"}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".zip,application/zip"
              data-testid="theme-studio-import-pack-input"
              className="hidden"
              onChange={onImportPackFile}
            />
            <button
              type="button"
              onClick={exportThemePack}
              disabled={exporting || !editingId}
              data-testid="theme-studio-export-pack-btn"
              className="min-h-10 px-3 rounded-lg border border-shBorder text-shText font-black text-[11px] uppercase tracking-widest hover:border-shPrimary/50 disabled:opacity-50"
            >
              <i className="fas fa-download mr-1.5" />{exporting ? "Exporting…" : "Export Theme Pack"}
            </button>
          </div>
        }
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
                    aria-current={isEditing ? "true" : undefined}
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
                        aria-label={`Delete theme "${t.name}"`}
                        onClick={(e) => { e.stopPropagation(); deleteTheme(t); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            deleteTheme(t);
                          }
                        }}
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

              {isActiveTheme && branding?.theme_schedule_active === false && (
                <div
                  className="bg-shOrange/10 border border-shOrange/40 rounded-lg px-3 py-2 text-[12px] text-shOrange"
                  data-testid="theme-studio-schedule-inactive-notice"
                >
                  <i className="fas fa-clock mr-1.5" />
                  This theme is active, but today falls outside its Active Dates window — the app is currently showing
                  the default look instead. It'll apply automatically again once the date window opens.
                </div>
              )}

              <div>
                <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
                  <h4 className="text-[11px] font-black text-shTextMuted uppercase tracking-widest">Theme Images</h4>
                  <button
                    type="button"
                    onClick={() => downloadImageGuide(draft.name)}
                    data-testid="theme-studio-download-image-guide"
                    className="text-[11px] font-black uppercase tracking-widest text-shPrimary hover:underline"
                  >
                    <i className="fas fa-file-lines mr-1" />Download image guide
                  </button>
                </div>
                <p className="text-[12px] text-shTextMuted mb-3">
                  Upload custom images for the theme. Recommended sizes are shown below each slot — or download the
                  guide above for exact specs and ready-to-use AI image prompts for every slot.
                </p>
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
