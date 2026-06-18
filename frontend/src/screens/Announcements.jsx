import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { compressImage } from "../lib/imageCompress";

/**
 * Sprint 110di-4 — Admin Announcements screen.
 *
 * Composer + list with edit/delete/pin/expire. Drives the
 * `/api/admin/announcements` CRUD endpoints. Clients see them in real time
 * on the portal via `/api/portal/announcements`.
 */
const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
};

const emptyForm = () => ({ title: "", body: "", image: "", pinned: false, expires_on: "", published: true });

export default function Announcements() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);  // id of item being edited, or "new"
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/announcements");
      setItems(r.data || []);
    } catch (e) { setErr("Couldn't load announcements"); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startNew = () => { setEditing("new"); setForm(emptyForm()); setErr(""); };
  const startEdit = (a) => {
    setEditing(a.id);
    setForm({
      title: a.title || "",
      body: a.body || "",
      image: a.image || "",
      pinned: !!a.pinned,
      expires_on: a.expires_on || "",
      published: a.published !== false,
    });
    setErr("");
  };
  const cancel = () => { setEditing(null); setForm(emptyForm()); setErr(""); };

  const onImage = async (e) => {
    const f = (e.target.files || [])[0];
    if (!f) return;
    try {
      const url = await compressImage(f, { maxWidth: 1400, maxHeight: 1400, quality: 0.8 });
      setForm((p) => ({ ...p, image: url }));
    } catch { setErr("Couldn't load that image"); }
    e.target.value = "";
  };

  const save = async () => {
    setErr("");
    if (!form.title.trim()) { setErr("Title is required"); return; }
    setSaving(true);
    try {
      if (editing === "new") await api.post("/admin/announcements", form);
      else await api.put(`/admin/announcements/${editing}`, form);
      await load();
      cancel();
    } catch (e) { setErr(e?.response?.data?.detail || "Save failed"); }
    setSaving(false);
  };

  const remove = async (a) => {
    if (!window.confirm(`Delete "${a.title}"? Clients will stop seeing it immediately.`)) return;
    try {
      await api.delete(`/admin/announcements/${a.id}`);
      await load();
    } catch { setErr("Delete failed"); }
  };

  return (
    <div className="space-y-6" data-testid="admin-announcements-screen">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-1">
            <i className="fas fa-bullhorn mr-1.5"/>Studio Broadcast
          </p>
          <h2 className="text-3xl sm:text-4xl font-black italic text-white uppercase tracking-tight">Announcements</h2>
          <p className="text-[13px] text-gray-400 mt-1">Anything you post here lands on every active client&apos;s portal home page.</p>
        </div>
        {editing === null && (
          <button onClick={startNew} data-testid="ann-new-btn"
                  className="text-[13px] font-black uppercase tracking-widest px-4 py-2 rounded bg-shGreen text-bgHeader hover:bg-shGreen/90 transition">
            <i className="fas fa-plus mr-1.5"/>New Announcement
          </button>
        )}
      </div>

      {/* Composer */}
      {editing !== null && (
        <div className="bg-bgPanel border border-shGreen/40 rounded-xl p-5 shadow-2xl space-y-4" data-testid="ann-composer">
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen">
            <i className={`fas ${editing === "new" ? "fa-plus" : "fa-pen"} mr-1.5`}/>
            {editing === "new" ? "New announcement" : "Edit announcement"}
          </p>

          <div>
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest block mb-1">Title *</label>
            <input value={form.title} onChange={(e)=>setForm({...form, title: e.target.value})}
                   placeholder="e.g. Closed Thanksgiving — book now"
                   maxLength={180} data-testid="ann-title"
                   className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shGreen outline-none"/>
          </div>

          <div>
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest block mb-1">Body</label>
            <textarea value={form.body} onChange={(e)=>setForm({...form, body: e.target.value})}
                      rows={5} data-testid="ann-body"
                      placeholder="Write the message clients will see. Plain text — line breaks are preserved."
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shGreen outline-none"/>
          </div>

          <div>
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest block mb-1">Optional image</label>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2 cursor-pointer bg-shBlue/15 hover:bg-shBlue/25 text-shBlue text-[11px] font-black uppercase tracking-widest px-3 py-2 rounded border border-shBlue/30 transition">
                <i className="fas fa-image"/> {form.image ? "Replace image" : "Add image"}
                <input type="file" accept="image/*" onChange={onImage} className="hidden" data-testid="ann-image-file"/>
              </label>
              {form.image && (
                <>
                  <img src={form.image} alt="preview" className="w-20 h-20 object-cover rounded border border-bgHover"/>
                  <button type="button" onClick={()=>setForm({...form, image: ""})}
                          className="text-[11px] font-black uppercase tracking-widest text-red-400 hover:underline">
                    Remove
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.pinned} onChange={(e)=>setForm({...form, pinned: e.target.checked})}
                     data-testid="ann-pinned" className="accent-shGreen w-4 h-4"/>
              <span className="text-[12px] font-black uppercase tracking-widest text-white">
                <i className="fas fa-thumbtack mr-1 text-shOrange"/>Pin to top
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.published} onChange={(e)=>setForm({...form, published: e.target.checked})}
                     data-testid="ann-published" className="accent-shGreen w-4 h-4"/>
              <span className="text-[12px] font-black uppercase tracking-widest text-white">
                Visible to clients
              </span>
            </label>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Auto-hide after</label>
              <input type="date" value={form.expires_on} onChange={(e)=>setForm({...form, expires_on: e.target.value})}
                     data-testid="ann-expires"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"
                     style={{ colorScheme: "dark" }}/>
            </div>
          </div>

          {err && <p className="text-[12px] text-red-400" data-testid="ann-error"><i className="fas fa-circle-exclamation mr-1"/>{err}</p>}

          <div className="flex justify-end gap-2 pt-2 border-t border-bgHover">
            <button onClick={cancel} disabled={saving}
                    className="text-[13px] font-black uppercase tracking-widest px-3 py-2 text-gray-400 hover:text-white disabled:opacity-40"
                    data-testid="ann-cancel">Cancel</button>
            <button onClick={save} disabled={saving} data-testid="ann-save"
                    className="text-[13px] font-black uppercase tracking-widest px-5 py-2 rounded bg-shGreen text-bgHeader hover:bg-shGreen/90 disabled:opacity-40 transition">
              {saving ? <><i className="fas fa-spinner fa-spin mr-2"/>Saving…</> : <><i className="fas fa-paper-plane mr-2"/>{editing === "new" ? "Post" : "Save"}</>}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-bgPanel border border-bgHover rounded-xl shadow-xl divide-y divide-bgHover" data-testid="ann-list">
        {loading && <p className="p-5 text-[13px] text-gray-400"><i className="fas fa-spinner fa-spin mr-2"/>Loading…</p>}
        {!loading && items.length === 0 && (
          <div className="p-8 text-center">
            <i className="fas fa-bullhorn text-3xl text-gray-600 mb-3"/>
            <p className="text-[14px] text-gray-400">No announcements posted yet.</p>
            <p className="text-[12px] text-gray-500 mt-1">Click <span className="text-shGreen font-black">&quot;New Announcement&quot;</span> to broadcast your first update.</p>
          </div>
        )}
        {!loading && items.map((a) => (
          <article key={a.id} className="p-4 sm:p-5" data-testid={`ann-row-${a.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {a.pinned && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-shOrange bg-shOrange/15 border border-shOrange/30 px-1.5 py-0.5 rounded">
                      <i className="fas fa-thumbtack mr-1"/>Pinned
                    </span>
                  )}
                  {a.published === false && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 bg-bgBase border border-bgHover px-1.5 py-0.5 rounded">
                      Hidden
                    </span>
                  )}
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                    {fmtDate(a.created_at)}{a.created_by ? ` · ${a.created_by}` : ""}
                  </p>
                </div>
                <h4 className="text-base sm:text-lg font-black text-white uppercase italic tracking-tight">{a.title}</h4>
                {a.body && <p className="text-[13px] text-gray-300 mt-1 whitespace-pre-wrap line-clamp-4">{a.body}</p>}
                {a.expires_on && (
                  <p className="text-[11px] text-gray-500 mt-2 italic">Auto-hides after {a.expires_on}</p>
                )}
              </div>
              {a.image && (
                <img src={a.image} alt={a.title}
                     className="w-24 h-24 object-cover rounded border border-bgHover shrink-0"/>
              )}
              <div className="flex gap-2 shrink-0">
                <button onClick={()=>startEdit(a)} data-testid={`ann-edit-${a.id}`}
                        className="text-[11px] font-black uppercase tracking-widest text-shBlue hover:underline px-2 py-1">
                  <i className="fas fa-pen mr-1"/>Edit
                </button>
                <button onClick={()=>remove(a)} data-testid={`ann-delete-${a.id}`}
                        className="text-[11px] font-black uppercase tracking-widest text-red-400 hover:underline px-2 py-1">
                  <i className="fas fa-trash mr-1"/>Delete
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
