import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import IconPicker from "./IconPicker";
import ColorSwatchRow from "./ColorSwatchRow";

/**
 * Admin-managed catalog of credit packs (bulk daycare day discounts).
 * Each pack stores qty + price; per-credit value is computed on the fly.
 */
const empty = { name: "", qty: 10, price: 300, service_type: "daycare", icon: "fa-tag", color: "", active: true, welcome_email_template_slug: null };

const DEFAULT_ICON_BY_POOL = { daycare: "fa-sun", training: "fa-graduation-cap", boarding: "fa-moon" };
const DEFAULT_COLOR_BY_POOL = { daycare: "#8cc63f", training: "#a855f7", boarding: "#f26522" };

export default function CreditPacksSettings() {
  const confirm = useConfirm();
  const [packs, setPacks] = useState([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false); // controls the New/Edit modal
  // Sprint 110di-62 — load all client-audience email templates so packs can
  // bind a custom welcome email that fires the moment the pack is sold.
  const [emailTemplates, setEmailTemplates] = useState([]);

  const load = async () => {
    // include_inactive=false (default) so soft-deleted default packs disappear from the list.
    const { data } = await api.get("/credit-packs");
    setPacks(data);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get("/admin/email-templates")
      .then(r => setEmailTemplates((r.data || []).filter(t => t.audience === "client")))
      .catch(() => setEmailTemplates([]));
  }, []);

  const openNew = () => { setEditing(null); setForm(empty); setErr(""); setOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ ...empty, ...p }); setErr(""); setOpen(true); };
  const closeModal = () => { setOpen(false); setEditing(null); setForm(empty); setErr(""); };

  const save = async () => {
    setErr("");
    // Client-side guard so we surface a friendly inline message instead of a
    // 422 from FastAPI (whose `detail` is an array of objects React can't render).
    if (!form.name?.trim()) { setErr("Pack name is required."); return; }
    if (!Number.isFinite(form.qty) || form.qty < 1) { setErr("Credits per pack must be at least 1."); return; }
    if (!Number.isFinite(form.price) || form.price < 0) { setErr("Price must be 0 or higher."); return; }
    try {
      if (editing) await api.put(`/credit-packs/${editing.id}`, form);
      else await api.post("/credit-packs", form);
      closeModal();
      load();
    } catch (e) {
      // FastAPI 422 detail can be an array of error objects — formatErr
      // flattens it so we never try to render a raw object inside <p>.
      setErr(formatErr(e.response?.data?.detail) || "Save failed");
    }
  };

  const remove = async (p) => {
    if (!(await confirm({ title: `Remove "${p.name}"?`, body: "Already-issued credit lots stay valid. New sales of this pack will be disabled.", confirmText: "Remove pack", tone: "danger" }))) return;
    await api.delete(`/credit-packs/${p.id}`);
    load();
  };

  const seed = async () => {
    const r = await api.post("/credit-packs/seed-standard");
    load();
    if ((r?.data?.seeded ?? 0) === 0) {
      // gentle inline hint via err (it shows in the form area)
      setErr(""); // clear stale error if any
    }
  };

  return (
    <div className="space-y-5" data-testid="credit-packs-settings">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Credit Packs</h4>
          <p className="text-[15px] text-gray-500 font-black uppercase tracking-widest mt-1">Bulk pricing for daycare, training, and boarding credits. New packs sold from this point on are recognized as revenue at sale-time.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={seed} data-testid="seed-packs-btn"
                  className="bg-shBlue/15 text-shBlue px-4 py-2 rounded text-[15px] font-black uppercase tracking-widest hover:bg-shBlue/25">
            <i className="fas fa-magic-wand-sparkles mr-1"/>{packs.length === 0 ? "Seed Standard Packs" : "Add Missing Defaults"}
          </button>
          <button onClick={openNew} data-testid="new-pack-btn"
                  className="bg-shGreen text-black px-4 py-2 rounded text-[15px] font-black uppercase tracking-widest hover:bg-shGreen/80">
            + New Pack
          </button>
        </div>
      </div>

      <LegacyMigrationCard />

      <div className="space-y-2" data-testid="credit-packs-list">
        {packs.length === 0 && (
          <div className="bg-bgBase border border-bgHover rounded-lg p-8 text-center text-[15px] text-gray-500 uppercase font-black tracking-widest">
            No packs yet — seed the standard 4 or add your own.
          </div>
        )}
        {packs.map(p => {
          const accent = p.color || DEFAULT_COLOR_BY_POOL[p.service_type] || "#94a3b8";
          return (
          <div key={p.id} className={`bg-bgBase border rounded-lg p-3 grid grid-cols-12 items-center gap-2 ${p.active ? "border-bgHover" : "border-bgHover/30 opacity-50"}`}>
            <div className="col-span-5 min-w-0 flex items-center gap-3">
              <div className="w-10 h-10 rounded grid place-items-center shrink-0"
                   style={{ backgroundColor: `${accent}26` }}>
                <i className={`fas ${p.icon || DEFAULT_ICON_BY_POOL[p.service_type] || "fa-tag"}`} style={{ color: accent }}/>
              </div>
              <div className="min-w-0">
                <p className="text-white font-black text-[14px] tracking-tight truncate">{p.name}</p>
                <p className="text-[14px] font-black uppercase tracking-widest mt-0.5">
                  <span style={{ color: accent }}>{p.service_type}</span>
                  <span className="text-gray-500">{p.is_default ? " · default" : ""}{!p.active ? " · inactive" : ""}</span>
                </p>
              </div>
            </div>
            <div className="col-span-2 text-center">
              <p className="text-shBlue font-black text-[18px]">{p.qty}</p>
              <p className="text-[12px] text-gray-500 uppercase tracking-widest">credits</p>
            </div>
            <div className="col-span-2 text-center">
              <p className="text-shGreen font-black text-[18px]">${p.price?.toFixed(2)}</p>
              <p className="text-[12px] text-gray-500 uppercase tracking-widest">price</p>
            </div>
            <div className="col-span-2 text-center">
              <p className="text-white font-black text-[16px]">${p.value_each?.toFixed(2)}</p>
              <p className="text-[12px] text-gray-500 uppercase tracking-widest">per credit</p>
            </div>
            <div className="col-span-1 text-right">
              <button onClick={()=>openEdit(p)} data-testid={`edit-pack-${p.id}`} className="text-shBlue text-[14px] font-black uppercase tracking-widest hover:underline px-1">Edit</button>
              <button onClick={()=>remove(p)} className="text-red-400 text-[14px] font-black uppercase tracking-widest hover:underline px-1">Remove</button>
            </div>
          </div>
          );
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-3 sm:p-6 animate-fade-in"
             onClick={closeModal}
             data-testid="pack-form-modal">
          <div onClick={(e)=>e.stopPropagation()}
               className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl shadow-2xl max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto">
            <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-5 py-4 flex items-center justify-between gap-3 z-10">
              <h5 className="text-white font-black text-[16px] uppercase italic tracking-tight">{editing ? `Edit · ${editing.name}` : "New Pack"}</h5>
              <button onClick={closeModal} className="text-gray-500 hover:text-white" data-testid="pack-form-close">
                <i className="fas fa-xmark text-xl"/>
              </button>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Pack name</label>
                  <input value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} placeholder="e.g., 50-Day Daycare Pack"
                         data-testid="pack-name-input"
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Pool</label>
                  <select value={form.service_type} onChange={(e)=>{
                             const t = e.target.value;
                             const pooledDefaults = Object.values(DEFAULT_ICON_BY_POOL);
                             const nextIcon = (!form.icon || pooledDefaults.includes(form.icon)) ? (DEFAULT_ICON_BY_POOL[t] || form.icon) : form.icon;
                             setForm({...form, service_type: t, icon: nextIcon});
                           }}
                          data-testid="pack-pool-select"
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                    <option value="daycare">Daycare credits</option>
                    <option value="training">Training credits</option>
                    <option value="boarding">Boarding nights</option>
                  </select>
                </div>
                <div>
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Credits per pack</label>
                  <input type="number" min="1" value={form.qty} onChange={(e)=>setForm({...form, qty: parseInt(e.target.value) || 1})}
                         data-testid="pack-qty-input"
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                </div>
                <div>
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Price (USD)</label>
                  <input type="number" step="0.01" min="0" value={form.price} onChange={(e)=>setForm({...form, price: parseFloat(e.target.value) || 0})}
                         data-testid="pack-price-input"
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Icon</label>
                  <IconPicker value={form.icon} onChange={(v)=>setForm({...form, icon: v})} testid="pack-icon-picker" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Color</label>
                  <div className="mt-2">
                    <ColorSwatchRow value={form.color} onChange={(hex)=>setForm({...form, color: hex})} testid="pack-color-row" />
                    <p className="text-[13px] text-gray-500 mt-1.5">Leave blank to use the pool default ({form.service_type === "training" ? "purple" : form.service_type === "boarding" ? "orange" : "green"}).</p>
                  </div>
                </div>
              </div>
              <p className="text-[14px] text-gray-500 mt-2">Per-credit value: <span className="text-shGreen font-black">${(form.price / Math.max(form.qty, 1)).toFixed(2)}</span></p>

              {/* Sprint 110di-62 — Welcome email: custom template that fires when the pack is sold */}
              <div className="mt-4">
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Welcome email (auto-sent when pack is sold)</label>
                <select value={form.welcome_email_template_slug||""}
                        onChange={(e)=>setForm({...form, welcome_email_template_slug: e.target.value || null})}
                        data-testid="pack-welcome-email"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  <option value="">— None (use default sale email) —</option>
                  {emailTemplates.map(t => (
                    <option key={t.slug} value={t.slug}>{t.name}{t.kind === "custom" ? " · Custom" : ""}</option>
                  ))}
                </select>
                <p className="text-[13px] text-gray-500 mt-1">
                  <i className="fas fa-paper-plane mr-1 text-shBlue"/>Sends this template the moment a client buys this pack. Create new templates from Settings → Email Designer.
                </p>
              </div>
              {/* Live preview — exactly how this pack will render in the catalog list. */}
              <div className="mt-4">
                <p className="text-[13px] font-black text-gray-500 uppercase tracking-widest mb-1.5">Preview</p>
                {(() => {
                  const accent = form.color || DEFAULT_COLOR_BY_POOL[form.service_type] || "#94a3b8";
                  const unit = form.service_type === "training" ? "sessions" : form.service_type === "boarding" ? "nights" : "credits";
                  return (
                    <div className="bg-bgBase border border-bgHover rounded-lg p-3 flex items-center gap-3" data-testid="pack-preview">
                      <div className="w-10 h-10 rounded grid place-items-center shrink-0"
                           style={{ backgroundColor: `${accent}26` }}>
                        <i className={`fas ${form.icon || DEFAULT_ICON_BY_POOL[form.service_type] || "fa-tag"}`} style={{ color: accent }}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-black text-[14px] tracking-tight truncate">{form.name || "Untitled pack"}</p>
                        <p className="text-[13px] font-black uppercase tracking-widest" style={{ color: accent }}>{form.service_type} · {form.qty} {unit}</p>
                      </div>
                      <p className="text-shGreen font-black text-[18px] whitespace-nowrap">${(form.price || 0).toFixed(2)}</p>
                    </div>
                  );
                })()}
              </div>
              {err && <p className="text-red-400 text-[15px] mt-3">{err}</p>}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={closeModal} className="text-gray-400 text-[14px] uppercase font-black tracking-widest px-3 py-2 hover:text-white">Cancel</button>
                <button onClick={save} data-testid="save-pack-btn"
                        className="bg-shGreen text-black px-5 py-2 rounded font-black text-[15px] uppercase tracking-widest hover:bg-shGreen/80">
                  {editing ? "Save Changes" : "Add Pack"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * Sprint 110dc — One-shot transitional migration card. Marks every CURRENT
 * (non-program) credit lot as Legacy (recognize at redemption). New packs
 * sold AFTER this call continue to land as paid-at-sale (the bulk
 * sell-packs flow stamps `recognize_at_sale: true` automatically).
 * Historical P&L is NOT touched — only future-redemption behavior changes.
 */
function LegacyMigrationCard() {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/admin/credit-lots/legacy-migration-preview");
        setPreview(r.data);
      } catch { /* hide card silently if endpoint isn't reachable */ }
    })();
  }, []);

  if (!preview) return null;
  const { to_migrate, already_legacy, training_programs_skipped } = preview;

  const run = async () => {
    const ok = window.confirm(
      `Mark ALL ${to_migrate} currently paid-at-sale lot${to_migrate===1?"":"s"} as Legacy?\n\n` +
      `From now on, those packs will add to revenue WHEN EACH CREDIT IS REDEEMED at checkout (you'll enter the $ then).\n\n` +
      `Any NEW credit packs sold AFTER this point will keep using the new "paid at sale" model automatically — no change there.\n\n` +
      `Historical income / P&L is NOT modified. This is fully reversible per-lot from the Pack Lots modal on each client.`
    );
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.post("/admin/credit-lots/migrate-existing-to-legacy");
      setDone(r.data);
      // Refresh the preview so the card reflects the new state
      const r2 = await api.get("/admin/credit-lots/legacy-migration-preview");
      setPreview(r2.data);
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Migration failed");
    }
    setBusy(false);
  };

  return (
    <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4"
         data-testid="legacy-migration-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-black uppercase tracking-widest text-amber-400 mb-1">
            <i className="fas fa-flag-checkered mr-1"/>One-Shot Cutover
          </p>
          <h5 className="text-white font-black text-[15px] mb-1">Mark existing credit packs as Legacy</h5>
          <p className="text-[13px] text-gray-300 leading-relaxed">
            Use this once during the transitional period: it stamps every pack already on file as <strong className="text-amber-400">Legacy</strong> (you'll enter $ at checkout for those). Any packs sold from this moment on use the new <strong className="text-shBlue">paid-at-sale</strong> model automatically. Historical income is not changed.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-widest">
            <span className="bg-amber-500/15 text-amber-400 border border-amber-500/40 rounded px-2 py-1" data-testid="legacy-migration-to-migrate">
              🏷️ {to_migrate} lot{to_migrate===1?"":"s"} will switch to Legacy
            </span>
            <span className="bg-bgHover/40 text-gray-300 border border-bgHover rounded px-2 py-1">
              ✓ {already_legacy} already Legacy
            </span>
            <span className="bg-purple-500/15 text-purple-300 border border-purple-500/40 rounded px-2 py-1">
              🎓 {training_programs_skipped} training program{training_programs_skipped===1?"":"s"} (skipped — always paid at sale)
            </span>
          </div>
        </div>
        <button
          onClick={run}
          disabled={busy || to_migrate === 0}
          data-testid="legacy-migration-run-btn"
          className="bg-amber-500 text-black px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap self-start">
          {busy
            ? "Migrating…"
            : to_migrate === 0
            ? "✓ Already Done"
            : `Mark ${to_migrate} as Legacy`}
        </button>
      </div>
      {err && (
        <p className="mt-2 text-[13px] text-red-400 font-black" data-testid="legacy-migration-err">{err}</p>
      )}
      {done && (
        <p className="mt-2 text-[13px] text-shGreen" data-testid="legacy-migration-done">
          <i className="fas fa-check-circle mr-1"/>
          Migrated {done.modified_count} lot{done.modified_count===1?"":"s"}. New packs sold from here will use the paid-at-sale model.
        </p>
      )}
    </div>
  );
}
