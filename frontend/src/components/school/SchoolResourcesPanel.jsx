import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

const blank = {
  title: "", description: "", kind: "link", url: "", media_id: "",
  program_ids: [], lesson_ids: [], tags: [], active: true,
};
const fileData = (file) => new Promise((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
});

export default function SchoolResourcesPanel() {
  const [rows, setRows] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    const [r, p] = await Promise.all([
      api.get("/admin/school/resources"),
      api.get("/programs", { params: { include_inactive: true } }).catch(() => ({ data: [] })),
    ]);
    setRows(r.data || []); setPrograms(p.data || []);
  };
  useEffect(() => { load().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => rows.filter((r) => !q || `${r.title} ${r.description} ${(r.tags || []).join(" ")}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const save = async () => {
    const body = {
      ...form,
      tags: (typeof form.tags === "string" ? form.tags.split(",") : form.tags).map((x) => String(x).trim()).filter(Boolean),
      program_ids: form.program_ids || [], lesson_ids: form.lesson_ids || [],
      url: form.url || null, media_id: form.media_id || null,
    };
    if (editing) await api.patch(`/admin/school/resources/${editing}`, body);
    else await api.post("/admin/school/resources", body);
    setEditing(null); setForm(blank); await load();
  };
  const edit = (r) => { setEditing(r.id); setForm({ ...r, tags: (r.tags || []).join(", ") }); };
  const archive = async (id) => { await api.delete(`/admin/school/resources/${id}`); await load(); };
  const upload = async (file) => {
    if (!file) return; setUploading(true);
    try {
      const data = await fileData(file);
      const r = await api.post("/admin/school/resources/upload", { data, filename: file.name });
      const mime = r.data?.mime || file.type;
      const kind = mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : "file";
      setForm((f) => ({ ...f, media_id: r.data.media_id, url: "", kind, title: f.title || file.name.replace(/\.[^.]+$/, "") }));
    } finally { setUploading(false); }
  };
  const targetProgram = form.program_ids?.[0] || "";

  return <div className="grid xl:grid-cols-[1fr_400px] gap-4" data-testid="school-resources-admin">
    <section className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search resources and tags…" className="w-full rounded-xl border border-shBorder bg-black/20 px-3 py-2.5 text-sm text-shText"/>
      {filtered.map((r) => <div key={r.id} className="rounded-2xl border border-shBorder p-4 flex gap-3 items-start">
        <div className="w-10 h-10 rounded-xl bg-shSecondary/10 grid place-items-center shrink-0"><i className={`fas ${r.kind === "video" ? "fa-video" : r.kind === "image" ? "fa-image" : r.kind === "file" ? "fa-file" : "fa-link"} text-shSecondary`}/></div>
        <div className="min-w-0 flex-1"><p className="font-black text-shText">{r.title}</p><p className="text-xs text-shTextMuted mt-1">{r.description}</p>
          <div className="flex flex-wrap gap-1 mt-2">{(r.tags || []).map((t) => <span key={t} className="text-[9px] bg-shBorder/25 rounded px-2 py-1 text-shTextMuted">{t}</span>)}</div>
          <p className="text-[10px] text-shTextMuted mt-2">{(r.program_ids || []).length ? `Course-specific · ${(r.program_ids || []).length} course` : "Available to all School students"}</p>
        </div>
        <button onClick={() => edit(r)} className="text-xs text-shSecondary" aria-label="Edit resource"><i className="fas fa-pen"/></button>
        <button onClick={() => archive(r.id)} className="text-xs text-shAccent" aria-label="Archive resource"><i className="fas fa-box-archive"/></button>
      </div>)}
    </section>
    <section className="rounded-2xl border border-shBorder p-4 h-fit xl:sticky xl:top-4">
      <h3 className="font-black text-shText">{editing ? "Edit resource" : "Add resource"}</h3>
      <div className="space-y-3 mt-3">
        <input className="input-res" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title"/>
        <textarea className="input-res min-h-[90px]" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What this helps with…"/>
        <select className="input-res" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}><option value="link">Link</option><option value="guide">Guide</option><option value="file">File</option><option value="image">Image</option><option value="video">Video</option></select>
        <select className="input-res" value={targetProgram} onChange={(e) => setForm((f) => ({ ...f, program_ids: e.target.value ? [e.target.value] : [] }))}>
          <option value="">All Online School students</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="input-res" value={form.url || ""} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value, media_id: "" }))} placeholder="External URL (optional)"/>
        <label className="block rounded-xl border border-dashed border-shBorder p-3 text-xs text-shTextMuted cursor-pointer"><i className="fas fa-upload mr-2 text-shSecondary"/>{uploading ? "Uploading…" : form.media_id ? "File uploaded — choose another to replace" : "Or upload a PDF, image, or video"}<input type="file" accept="application/pdf,image/*,video/*" className="hidden" onChange={(e) => upload(e.target.files?.[0] || null)}/></label>
        <input className="input-res" value={typeof form.tags === "string" ? form.tags : (form.tags || []).join(", ")} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="Tags: leash, place, puppy"/>
      </div>
      <div className="flex gap-2 mt-3"><button onClick={save} disabled={!form.title.trim()} className="min-h-[42px] flex-1 rounded-xl bg-shPrimary text-bgHeader font-black text-xs uppercase">{editing ? "Save" : "Add resource"}</button>{editing && <button onClick={() => { setEditing(null); setForm(blank); }} className="min-h-[42px] px-3 rounded-xl border border-shBorder text-shText">Cancel</button>}</div>
    </section>
    <style>{`.input-res{width:100%;border:1px solid var(--sh-border);background:rgba(0,0,0,.18);border-radius:.75rem;padding:.65rem .75rem;color:var(--sh-text);font-size:.8rem}`}</style>
  </div>;
}
