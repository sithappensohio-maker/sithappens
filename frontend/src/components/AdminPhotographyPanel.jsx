import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { compressImage } from "../lib/imageCompress";
import { useConfirm } from "../lib/useConfirm";

/* Photography Phase 1 — admin management for the client Photography page:
 * featured photo gallery (upload/reorder/feature/hide/delete) + page
 * headline. Pixieset links live in the existing Portal Links panel (reused,
 * not duplicated). Packages/pricing reuse the existing Services & Programs
 * catalog (Photography category) — not duplicated here either. */

function AdminGalleryImage({ photoId }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/photography/gallery/${photoId}`).then(({ data }) => { if (!cancelled) setSrc(data.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [photoId]);
  if (!src) return <div className="w-16 h-16 rounded border border-shBorder bg-[var(--sh-card-base)] grid place-items-center text-gray-600"><i className="fas fa-image" /></div>;
  return <img src={src} alt="" className="w-16 h-16 object-cover rounded border border-shBorder" />;
}

export default function AdminPhotographyPanel({ s, save, saving }) {
  const confirm = useConfirm();
  const [headline, setHeadline] = useState(s?.photography_page?.headline || "Capture the moments worth keeping.");
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: "", caption: "", featured: false });

  const loadPhotos = () => {
    api.get("/photography/gallery", { params: { include_inactive: true } }).then(({ data }) => setPhotos(data || [])).catch(() => setPhotos([]));
  };
  useEffect(() => { loadPhotos(); }, []);

  const onSaveHeadline = () => save({ photography_page: { ...(s?.photography_page || {}), headline } });

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const compressed = await compressImage(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.85 });
      await api.post("/photography/gallery", {
        data: compressed, filename: file.name,
        title: form.title.trim() || null, caption: form.caption.trim() || null,
        featured: form.featured,
      });
      setForm({ title: "", caption: "", featured: false });
      toast.success("Photo uploaded");
      loadPhotos();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    }
    setUploading(false);
  };

  const toggleField = async (photo, field) => {
    await api.put(`/photography/gallery/${photo.id}`, { [field]: !photo[field] });
    loadPhotos();
  };

  const move = async (photo, direction) => {
    await api.post(`/photography/gallery/${photo.id}/move`, { direction });
    loadPhotos();
  };

  const remove = async (photo) => {
    if (!(await confirm({ title: "Delete this photo?", body: "This removes it from the client Photography page permanently.", confirmText: "Delete", tone: "danger" }))) return;
    await api.delete(`/photography/gallery/${photo.id}`);
    loadPhotos();
  };

  return (
    <div className="space-y-6" data-testid="admin-photography-panel">
      <div>
        <h4 className="text-lg font-black text-shText uppercase italic tracking-tight">Photography Page</h4>
        <p className="text-[14px] text-shTextMuted mt-1">
          Featured photos and headline shown on the client Photography page. Pixieset links live in Marketing &amp; Branding → Portal Links.
          Session packages/pricing are managed in Services &amp; Programs → Photography category (not duplicated here).
        </p>
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-4" data-testid="photography-headline-panel">
        <label className="text-[13px] font-black text-shTextMuted uppercase tracking-widest">Page Headline</label>
        <div className="flex gap-2 mt-1">
          <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={140}
                 data-testid="photography-headline-input"
                 className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          <button onClick={onSaveHeadline} disabled={saving} data-testid="photography-headline-save"
                  className="bg-shPrimary text-black px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shPrimary/80 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg overflow-hidden" data-testid="photography-featured-admin">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-shBorder" style={{ background: "linear-gradient(90deg, #f9731630, transparent 60%)" }}>
          <i className="fas fa-camera-retro" style={{ color: "#f97316" }} />
          <h5 className="text-shText font-black text-[14px] uppercase italic tracking-tight">Featured Photos</h5>
          <span className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">· {photos.length}</span>
        </div>
        <div className="p-4 border-b border-shBorder space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-black text-shTextMuted uppercase tracking-widest">Title (optional)</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={140}
                     data-testid="photography-upload-title"
                     className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
            <div>
              <label className="text-[12px] font-black text-shTextMuted uppercase tracking-widest">Caption (optional)</label>
              <input value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} maxLength={500}
                     data-testid="photography-upload-caption"
                     className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
              <span className="text-[12px] font-black text-amber-400 uppercase tracking-widest">Featured</span>
            </label>
            <label className="bg-shAccent/15 text-shAccent border border-shAccent/40 px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest cursor-pointer hover:bg-shAccent/25 transition">
              {uploading ? "Uploading…" : "Upload Photo"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUpload} disabled={uploading} data-testid="photography-upload-input" />
            </label>
          </div>
        </div>
        <div className="divide-y divide-shBorder/40">
          {photos.length === 0 && (
            <p className="p-6 text-center text-[13px] text-shTextMuted uppercase font-black tracking-widest">No photos uploaded yet.</p>
          )}
          {photos.map((p, i) => (
            <div key={p.id} className={`p-3 flex items-center gap-3 ${p.active ? "" : "opacity-40"}`} data-testid={`admin-photo-row-${p.id}`}>
              <AdminGalleryImage photoId={p.id} />
              <div className="flex-1 min-w-0">
                <p className="text-shText font-black text-[14px] truncate">{p.title || "Untitled"}</p>
                {p.caption && <p className="text-[12px] text-shTextMuted truncate">{p.caption}</p>}
                <p className="text-[11px] text-gray-600 uppercase tracking-widest mt-0.5">
                  {p.featured ? "Featured" : ""} {!p.active ? "· Hidden" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => move(p, "up")} disabled={i === 0} data-testid={`admin-photo-up-${p.id}`}
                        className="w-8 h-8 rounded bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted hover:text-shText disabled:opacity-30"><i className="fas fa-arrow-up text-xs" /></button>
                <button onClick={() => move(p, "down")} disabled={i === photos.length - 1} data-testid={`admin-photo-down-${p.id}`}
                        className="w-8 h-8 rounded bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted hover:text-shText disabled:opacity-30"><i className="fas fa-arrow-down text-xs" /></button>
                <button onClick={() => toggleField(p, "featured")} data-testid={`admin-photo-feature-${p.id}`}
                        className={`px-2 h-8 rounded border text-[11px] font-black uppercase tracking-widest ${p.featured ? "bg-amber-500/20 border-amber-500/50 text-amber-300" : "bg-[var(--sh-card-base)] border-shBorder text-shTextMuted"}`}>
                  Feature
                </button>
                <button onClick={() => toggleField(p, "active")} data-testid={`admin-photo-toggle-${p.id}`}
                        className="px-2 h-8 rounded bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted hover:text-shText text-[11px] font-black uppercase tracking-widest">
                  {p.active ? "Hide" : "Show"}
                </button>
                <button onClick={() => remove(p)} data-testid={`admin-photo-delete-${p.id}`}
                        className="px-2 h-8 rounded bg-[var(--sh-card-base)] border border-shBorder text-red-400 hover:text-red-300 text-[11px] font-black uppercase tracking-widest">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
