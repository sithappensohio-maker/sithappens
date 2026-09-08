/* Inquiries — every "Tell us about your dog" questionnaire from the public
   landing page, newest first, with the full answers, one-tap reply links,
   and a three-step status so nothing is lost in an inbox. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import PageHero from "../components/PageHero";

const STATUS_META = {
  new:       { label: "New",       cls: "bg-shAccent/15 text-shAccent ring-1 ring-shAccent/40", icon: "fa-inbox" },
  contacted: { label: "Contacted", cls: "bg-shPrimary/15 text-shPrimary", icon: "fa-reply" },
  closed:    { label: "Closed",    cls: "bg-shSurfaceRaised text-shTextMuted", icon: "fa-check" },
};
const FILTERS = ["new", "contacted", "closed", "all"];

function fmtReceived(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}

function telHref(phone) {
  return (phone || "").replace(/[^\d+]/g, "");
}

function Row({ label, children }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3 text-[14px]">
      <span className="sm:w-40 shrink-0 text-[11px] font-black uppercase tracking-widest text-shTextMuted pt-0.5">{label}</span>
      <span className="text-shText break-words">{children}</span>
    </div>
  );
}

export function InquiryCard({ inq, labels, onStatus, onNotes, onOpenClient, canEdit }) {
  const [notes, setNotes] = useState(inq.admin_notes || "");
  useEffect(() => { setNotes(inq.admin_notes || ""); }, [inq.id, inq.admin_notes]);
  const meta = STATUS_META[inq.status] || STATUS_META.new;
  const lab = (group, key) => (labels?.[group] || {})[key] || key;
  const list = (group, keys) => (keys || []).map((k) => lab(group, k)).join(", ");
  const tel = telHref(inq.phone);
  return (
    <article className="rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)] p-4 sm:p-5 space-y-3" data-testid={`inquiry-${inq.id}`} data-status={inq.status}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${meta.cls}`} data-testid={`inquiry-${inq.id}-status`}>
              <i className={`fas ${meta.icon} mr-1`}/>{meta.label}
            </span>
            <span className="text-[11px] text-shTextMuted font-bold">Received {fmtReceived(inq.created_at)}</span>
            {inq.client_merged && <span className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">existing client</span>}
          </div>
          <h3 className="text-[18px] font-black text-shText leading-tight">
            {inq.name} <span className="text-shTextMuted font-bold">/ {inq.dog_name}</span>
          </h3>
          <p className="text-[13px] text-shTextMuted mt-0.5">{inq.breed} · {inq.dog_age} · prefers {lab("preferred_contact", inq.preferred_contact).toLowerCase()}</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {inq.email && <a href={`mailto:${inq.email}`} data-testid={`inquiry-${inq.id}-email`} className="min-h-[40px] inline-flex items-center px-3 rounded-xl bg-shSurfaceRaised text-shText text-[12px] font-black uppercase tracking-widest hover:bg-shSurfaceRaised/80"><i className="fas fa-envelope mr-1.5"/>Email</a>}
          {tel && <a href={`tel:${tel}`} data-testid={`inquiry-${inq.id}-call`} className="min-h-[40px] inline-flex items-center px-3 rounded-xl bg-shSurfaceRaised text-shText text-[12px] font-black uppercase tracking-widest hover:bg-shSurfaceRaised/80"><i className="fas fa-phone mr-1.5"/>Call</a>}
          {tel && <a href={`sms:${tel}`} data-testid={`inquiry-${inq.id}-text`} className="min-h-[40px] inline-flex items-center px-3 rounded-xl bg-shSurfaceRaised text-shText text-[12px] font-black uppercase tracking-widest hover:bg-shSurfaceRaised/80"><i className="fas fa-comment-sms mr-1.5"/>Text</a>}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-shBorder/40 pt-3">
        <Row label="Looking for">{list("interests", inq.interests)}</Row>
        <Row label="Goals / concerns">{list("concerns", inq.concerns)}</Row>
        <Row label="Message"><span className="italic">“{inq.message}”</span></Row>
        <Row label="Phone">{inq.phone}</Row>
        <Row label="Email">{inq.email}</Row>
        <Row label="Sex">{inq.dog_sex ? (inq.dog_sex === "male" ? "Male" : "Female") : ""}</Row>
        <Row label="Spayed / neutered">{inq.fixed ? lab("yes_no_unsure", inq.fixed) : ""}</Row>
        <Row label="Vaccines current">{inq.vaccines_current ? lab("yes_no_unsure", inq.vaccines_current) : ""}</Row>
        <Row label="Previous training">{inq.previous_training}</Row>
        <Row label="Household">{inq.household}</Row>
        <Row label="Zip">{inq.zip}</Row>
        <Row label="Wants to start">{inq.start_timing ? lab("start_timing", inq.start_timing) : ""}</Row>
        <Row label="Heard about us">{inq.heard_from}</Row>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3 border-t border-shBorder/40 pt-3">
        <div className="flex-1">
          <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Your notes</label>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit}
                    onBlur={() => { if (canEdit && notes !== (inq.admin_notes || "")) onNotes(inq, notes); }}
                    data-testid={`inquiry-${inq.id}-notes`}
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-shText text-[14px] focus:border-shGreen outline-none disabled:opacity-60"/>
        </div>
        <div className="flex flex-wrap gap-2">
          {inq.client_id && onOpenClient && (
            <button type="button" onClick={() => onOpenClient(inq.client_id)} data-testid={`inquiry-${inq.id}-open-client`}
                    className="min-h-[40px] px-3 rounded-xl bg-shSurfaceRaised text-shText text-[12px] font-black uppercase tracking-widest">
              <i className="fas fa-user mr-1.5"/>Open client
            </button>
          )}
          {canEdit && inq.status !== "contacted" && (
            <button type="button" onClick={() => onStatus(inq, "contacted")} data-testid={`inquiry-${inq.id}-mark-contacted`}
                    className="min-h-[40px] px-3 rounded-xl bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest">
              <i className="fas fa-reply mr-1.5"/>Mark contacted
            </button>
          )}
          {canEdit && inq.status !== "closed" && (
            <button type="button" onClick={() => onStatus(inq, "closed")} data-testid={`inquiry-${inq.id}-close`}
                    className="min-h-[40px] px-3 rounded-xl bg-shSurfaceRaised text-shTextMuted text-[12px] font-black uppercase tracking-widest">
              Close
            </button>
          )}
          {canEdit && inq.status === "closed" && (
            <button type="button" onClick={() => onStatus(inq, "new")} data-testid={`inquiry-${inq.id}-reopen`}
                    className="min-h-[40px] px-3 rounded-xl bg-shSurfaceRaised text-shTextMuted text-[12px] font-black uppercase tracking-widest">
              Reopen
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function Inquiries({ onOpenClient, can, focusId }) {
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [labels, setLabels] = useState(null);
  const [filter, setFilter] = useState("new");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const canEdit = typeof can === "function" ? can("clients_edit") : true;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/inquiries", { params: { status: "all" } });
      setItems(data.items || []);
      setCounts(data.counts || {});
      setLabels(data.labels || null);
      setErr("");
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Couldn't load inquiries.");
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Deep link from Action Required: show the one they tapped, whatever its status.
  useEffect(() => {
    if (!focusId || !items.length) return;
    const hit = items.find((i) => i.id === focusId);
    if (hit && hit.status !== filter) setFilter("all");
    const el = document.querySelector(`[data-testid="inquiry-${focusId}"]`);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, [focusId, items, filter]);

  const visible = useMemo(() => (filter === "all" ? items : items.filter((i) => i.status === filter)), [items, filter]);

  const patch = async (inq, body, okMsg) => {
    try {
      const { data } = await api.patch(`/inquiries/${inq.id}`, body);
      setItems((prev) => prev.map((i) => (i.id === inq.id ? { ...i, ...data } : i)));
      setCounts((c) => {
        if (!body.status || body.status === inq.status) return c;
        return { ...c, [inq.status]: Math.max(0, (c[inq.status] || 0) - 1), [body.status]: (c[body.status] || 0) + 1 };
      });
      if (body.status) window.dispatchEvent(new CustomEvent("sh:pending-actions-changed"));
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't update that inquiry.");
    }
  };

  return (
    <div className="space-y-5" data-testid="inquiries-screen">
      <PageHero icon="fa-inbox" title="Inquiries" subtitle="Everyone who told us about their dog from the website. Reply, then mark it contacted so it leaves Action Required." />

      <div className="flex flex-wrap gap-2" data-testid="inquiries-filters">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} data-testid={`inquiries-filter-${f}`} aria-pressed={filter === f}
                  className={`min-h-[40px] px-3 rounded-xl text-[12px] font-black uppercase tracking-widest ${filter === f ? "bg-shPrimary text-bgHeader" : "bg-shSurfaceRaised text-shTextMuted"}`}>
            {f === "all" ? "All" : STATUS_META[f].label}
            <span className="ml-1.5 opacity-80">{f === "all" ? items.length : counts[f] ?? 0}</span>
          </button>
        ))}
      </div>

      {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded p-3 font-black" data-testid="inquiries-error">{err}</div>}
      {loading && !items.length && <p className="text-shTextMuted text-[14px]">Loading…</p>}
      {!loading && visible.length === 0 && (
        <p className="text-shTextMuted text-[14px]" data-testid="inquiries-empty">
          {filter === "new" ? "No new inquiries. Anything new from the website lands here and in Action Required." : "Nothing here."}
        </p>
      )}
      <div className="space-y-4">
        {visible.map((inq) => (
          <InquiryCard key={inq.id} inq={inq} labels={labels} canEdit={canEdit} onOpenClient={onOpenClient}
                       onStatus={(i, status) => patch(i, { status }, status === "contacted" ? "Marked contacted" : status === "closed" ? "Closed" : "Reopened")}
                       onNotes={(i, admin_notes) => patch(i, { admin_notes }, "Notes saved")}/>
        ))}
      </div>
    </div>
  );
}
