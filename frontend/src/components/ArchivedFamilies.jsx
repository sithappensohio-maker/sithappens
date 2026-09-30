/* Archiving a family (or removing a dog) and bringing a family back (audit #36).
 *
 * The server refuses an archive while a dog is on site or visits are still
 * booked, and lists each one in the refusal's `block` (code
 * "archive_blocked"). ArchiveBlockers shows that list with a way through for
 * each row: Cancel (the normal cancel window, which already gives credits
 * back) for a visit or request that can be cancelled, where to check out a
 * dog that is here, and a plain note for a visit already paid for, which
 * Cancel refuses. Nothing is cancelled for staff, and the archive is never
 * retried on its own — the list only drops what has been dealt with.
 * ArchivedClientsList is the Clients screen's "Show archived" view with Restore.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { api, formatErr, invalidateSharedApiData } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { fmtDate } from "../lib/format";
import BookingDetailModal from "./BookingDetailModal";
import { CancelBookingModal } from "./CheckoutModal";

/** The archive refusal's block, or null for any other failure. */
export function archiveBlock(error) {
  const block = error?.response?.data?.block;
  return block && block.code === "archive_blocked" ? block : null;
}

function when(row) {
  const d = row.end_date && row.end_date !== row.date ? `${row.date} → ${row.end_date}` : row.date || "";
  return [d, row.time].filter(Boolean).join(" · ");
}

// A row stays in the list while it still keeps the family from being archived.
function stillInTheWay(b) {
  if (!b) return false;
  const here = b.status === "approved" && b.checked_in_at && !b.checked_out_at;
  return here || b.status === "pending" || (b.status === "approved" && !b.checked_out_at);
}

function BlockerRow({ row, onCancel, onDetails, testid }) {
  const what = row.is_meet_greet ? "Meet & Greet" : (row.service_name || row.service_type || "Visit");
  const paid = !row.can_cancel && !row.on_site;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-shBorder bg-bgHeader/40 px-3 py-2" data-testid={testid}>
      <div className="flex-1 min-w-[10rem]">
        <p className="text-[14px] text-shText font-bold truncate">{row.dog_name || "—"} · {what}</p>
        <p className="text-[12px] text-shTextMuted">
          {when(row)}{row.status === "pending" ? " · request" : ""}
          {row.paid_for_by_this_family ? ` · ${row.client_name || "another family"}'s dog, on this family's account` : ""}
        </p>
        {row.on_site && (
          <p className="text-[12px] text-shAccent mt-0.5" data-testid={`${testid}-how`}>Check {row.dog_name || "the dog"} out on Today{row.reopened ? " (this checkout was reopened)" : ""}.</p>
        )}
        {paid && (
          <p className="text-[12px] text-shAccent mt-0.5" data-testid={`${testid}-how`}>
            {row.prepaid ? "Prepaid program session" : "Already paid for"} — can't be cancelled here yet; it stays until it has taken place.
          </p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        {row.can_cancel && (
          <button type="button" onClick={() => onCancel(row)} data-testid={`${testid}-cancel`}
                  className="min-h-[36px] px-3 rounded text-[12px] font-black uppercase tracking-widest bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25">
            Cancel
          </button>
        )}
        <button type="button" onClick={() => onDetails(row)} data-testid={`${testid}-open`}
                className="min-h-[36px] px-3 rounded text-[12px] font-black uppercase tracking-widest bg-shSurfaceRaised text-shText border border-shBorder hover:border-shSecondary">
          Details
        </button>
      </div>
    </li>
  );
}

/** The visits keeping a family / dog from being archived. */
export function ArchiveBlockers({ title, message, block, onClose, onRetry }) {
  const [open, setOpen] = useState(null);         // { row, mode: "details" | "cancel", booking? }
  const [dropped, setDropped] = useState(() => new Set());
  const onSite = (block?.on_site || []).filter((r) => !dropped.has(r.id));
  const upcoming = (block?.upcoming || []).filter((r) => !dropped.has(r.id));
  const shown = onSite.length + upcoming.length;
  const hidden = Math.max(0, (block?.total || 0) - (block?.on_site || []).length - (block?.upcoming || []).length);

  // Back from a visit's window: drop it from the list if it no longer blocks.
  const recheck = async (row) => {
    setOpen(null);
    try {
      const { data } = await api.get(`/bookings/${row.id}`);
      if (!stillInTheWay(data)) setDropped((d) => new Set(d).add(row.id));
    } catch { /* leave it listed */ }
  };
  const startCancel = async (row) => {
    try {
      const { data } = await api.get(`/bookings/${row.id}`);   // the cancel window reads credits, price, check-in
      setOpen({ row, mode: "cancel", booking: data });
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't open that visit.");
    }
  };

  // The visit's own window replaces this list while it's open, then the list comes back.
  if (open?.mode === "cancel") return <CancelBookingModal booking={open.booking} onClose={() => recheck(open.row)} />;
  if (open?.mode === "details") {
    return <BookingDetailModal booking={{ id: open.row.id }} onClose={() => recheck(open.row)} onChanged={() => {}} />;
  }
  return createPortal(
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[70]" data-testid="archive-blockers">
      <div className="sh-modal-surface border border-shAccent/40 rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <h4 className="text-lg font-black text-shText tracking-tight">{title}</h4>
        <p className="text-[14px] text-shTextMuted leading-relaxed mt-2" data-testid="archive-blockers-message">{message}</p>
        <div className="overflow-y-auto mt-4 space-y-4 min-h-0">
          {onSite.length > 0 && (
            <section>
              <p className="text-[12px] font-black uppercase tracking-widest text-shAccent mb-2">Checked in now — check out first</p>
              <ul className="space-y-2">
                {onSite.map((r) => <BlockerRow key={r.id} row={{ ...r, on_site: true }} onCancel={startCancel}
                                               onDetails={(row) => setOpen({ row, mode: "details" })} testid={`archive-blocker-${r.id}`} />)}
              </ul>
            </section>
          )}
          {upcoming.length > 0 && (
            <section>
              <p className="text-[12px] font-black uppercase tracking-widest text-shSecondary mb-2">Still booked</p>
              <ul className="space-y-2">
                {upcoming.map((r) => <BlockerRow key={r.id} row={r} onCancel={startCancel}
                                                 onDetails={(row) => setOpen({ row, mode: "details" })} testid={`archive-blocker-${r.id}`} />)}
              </ul>
            </section>
          )}
          {shown === 0 && (
            <p className="text-[13px] text-shText" data-testid="archive-blockers-cleared">Everything listed has been dealt with — try archiving again.</p>
          )}
          {hidden > 0 && (
            <p className="text-[12px] text-shTextMuted" data-testid="archive-blockers-more">…and {hidden} more. Deal with these, then try again to see the rest.</p>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} data-testid="archive-blockers-close"
                  className="min-h-11 px-5 rounded-lg border border-shBorder text-shTextMuted font-black text-[13px] hover:text-shText">
            Close
          </button>
          <button type="button" onClick={onRetry} data-testid="archive-blockers-retry"
                  className="min-h-11 px-6 rounded-lg font-black text-[13px] bg-shSecondary text-bgHeader hover:brightness-110">
            Try archiving again
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Archive (or remove) with the refusal list and a retry. `run` performs the DELETE. */
export function useArchiveAction() {
  const [blocked, setBlocked] = useState(null);   // { title, message, block, run, done }
  const attempt = useCallback(async ({ title, run, done }) => {
    try {
      const { data } = await run();
      setBlocked(null);
      invalidateSharedApiData(["clients", "dogs", "navCounts"]);
      done?.(data);
      return true;
    } catch (e) {
      const block = archiveBlock(e);
      if (block) {
        setBlocked({ title, message: formatErr(e.response?.data?.detail), block, run, done });
      } else {
        setBlocked(null);
        toast.error(formatErr(e.response?.data?.detail) || "That didn't work. Please try again.");
      }
      return false;
    }
  }, []);
  const view = blocked ? (
    <ArchiveBlockers title={blocked.title} message={blocked.message} block={blocked.block}
                     onClose={() => setBlocked(null)}
                     onRetry={() => attempt({ title: blocked.title, run: blocked.run, done: blocked.done })} />
  ) : null;
  return { attempt, view };
}

/** Clients → Show archived: the archived families, newest first, with Restore. */
export function ArchivedClientsList({ query = "", onRestored = () => {} }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/clients/page", { params: { q: query, page: 1, page_size: 100, archived: true } });
      setRows(data?.items || []);
      setTotal(Number(data?.total) || 0);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't load archived families.");
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const restore = async (c) => {
    const dogs = (c.dogs || []).map((d) => d.name).filter(Boolean);
    const ok = await confirm({
      title: `Restore ${c.name}?`,
      body: `${c.name} comes back on every screen${dogs.length ? ` with ${dogs.join(", ")}` : ""}, and any portal login they had works again. `
        + "Weekly schedules stay paused — resume each one on the Recurring tab when they're ready.",
      confirmText: "Restore family", tone: "info", icon: "fa-rotate-left",
    });
    if (!ok) return;
    setBusy(c.id);
    try {
      const { data } = await api.post(`/clients/${c.id}/restore`);
      invalidateSharedApiData(["clients", "dogs", "navCounts"]);
      const extra = [
        data?.paused_schedules ? `${data.paused_schedules} weekly schedule${data.paused_schedules === 1 ? "" : "s"} still paused` : "",
        data?.still_removed?.length ? `${data.still_removed.join(", ")} stay${data.still_removed.length === 1 ? "s" : ""} removed` : "",
      ].filter(Boolean).join(" · ");
      toast.success(`${c.name} restored${extra ? ` — ${extra}` : ""}`);
      await load();
      onRestored(c);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Restore failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6" data-testid="archived-client-grid">
      {!loading && rows.length === 0 && (
        <div className="col-span-full text-center text-shTextMuted text-xs font-black uppercase py-16" data-testid="archived-client-empty">
          {query ? "No archived families match that search." : "No archived families."}
        </div>
      )}
      {!loading && total > rows.length && (
        <p className="col-span-full text-[13px] text-shTextMuted" data-testid="archived-client-more">
          Showing the newest {rows.length} of {total} archived families — search by name, email or phone to find the others.
        </p>
      )}
      {rows.map((c) => (
        <div key={c.id} className="sh-entity-card p-5 sm:p-6" data-testid={`archived-client-card-${c.id}`}>
          <p className="text-shText font-black text-[16px] truncate">{c.name}</p>
          <p className="text-[13px] text-shTextMuted truncate">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</p>
          <p className="mt-2 inline-block text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-shSurfaceRaised text-shTextMuted"
             data-testid={`archived-client-badge-${c.id}`}>
            Archived {fmtDate(c.deleted_at)}{c.archived_by_name ? ` by ${c.archived_by_name}` : ""}
          </p>
          <p className="mt-2 text-[13px] text-shTextMuted">
            {(c.dogs || []).length ? `Dogs: ${(c.dogs || []).map((d) => d.name).join(", ")}` : "No dogs come back with this family."}
          </p>
          <button type="button" onClick={() => restore(c)} disabled={busy === c.id} data-testid={`restore-client-${c.id}`}
                  className="mt-4 min-h-[40px] px-4 rounded-lg text-[12px] font-black uppercase tracking-widest bg-shSecondary text-bgHeader hover:brightness-110 disabled:opacity-40">
            <i className="fas fa-rotate-left mr-2" />{busy === c.id ? "Restoring…" : "Restore"}
          </button>
        </div>
      ))}
    </div>
  );
}
