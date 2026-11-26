import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, formatErr } from "../lib/api";

// One-time guest dog (owner request 2026-11-26) — a family already on file
// turns up with an extra dog we have never seen. One name is all the desk has
// to type. The dog is saved on the family's file tagged "One-time guest"
// (POST /clients/{id}/guest-dog), so its visit and bill have somewhere to live;
// take the tag off later if the dog becomes a regular.
//
// A guest has no vaccine records on file. The desk has to tick the box saying
// so before the dog can be added; that confirmation covers today's visit only.
export default function GuestDogModal({ clientId, clientName, onClose, onCreated }) {
  const [dogName, setDogName] = useState("");
  const [breed, setBreed] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const busyRef = useRef(false);   // a double tap never sends twice

  const ready = dogName.trim() && confirmed;

  const submit = async () => {
    if (!ready || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setErr("");
    try {
      const { data } = await api.post(`/clients/${clientId}/guest-dog`, {
        dog_name: dogName.trim(), breed: breed.trim(), notes: notes.trim(), no_vaccines_confirmed: true,
      });
      await onCreated?.(data.dog);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Could not add the guest dog.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const field = "w-full min-h-[44px] bg-black/20 border border-shBorder/60 rounded-lg px-3 text-shText text-[14px] focus:outline-none focus:border-shSecondary/50";
  const label = "block text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1";

  return createPortal((
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[130] overflow-y-auto"
         onClick={busy ? undefined : onClose} data-testid="guest-dog-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-5 w-full max-w-md shadow-2xl my-8"
           onClick={(e) => e.stopPropagation()}>
        <h4 className="text-lg font-black text-shText uppercase italic">Add a guest dog</h4>
        <p className="text-[12.5px] text-shTextMuted mt-1 mb-4 leading-relaxed">
          An extra dog coming along with {clientName || "this family"} today. It is saved on their file marked
          {" "}<span className="text-shSecondary font-black">One-time guest</span>; you can fill in the rest later.
        </p>

        <div className="space-y-3">
          <div>
            <label className={label}>Dog&apos;s name <span className="text-shAccent">*</span></label>
            <input value={dogName} onChange={(e) => setDogName(e.target.value)} autoFocus
                   placeholder="e.g. Pepper" className={field} data-testid="guest-dog-name"/>
          </div>
          <div>
            <label className={label}>Breed</label>
            <input value={breed} onChange={(e) => setBreed(e.target.value)}
                   placeholder="Optional" className={field} data-testid="guest-dog-breed"/>
          </div>
          <div>
            <label className={label}>Note</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
                   placeholder="Optional — e.g. grandma's dog, shy with big dogs" className={field} data-testid="guest-dog-notes"/>
          </div>
        </div>

        <label className="mt-4 flex items-start gap-3 rounded-lg border border-shAccent/50 bg-shAccent/10 p-3 cursor-pointer"
               data-testid="guest-dog-vaccine-warning">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
                 data-testid="guest-dog-vaccine-confirm" className="accent-shAccent w-5 h-5 mt-0.5 shrink-0"/>
          <span className="text-[13px] text-shText leading-relaxed">
            <span className="font-black text-shAccent"><i className="fas fa-triangle-exclamation mr-1.5" aria-hidden="true"/>No vaccine records on file.</span>{" "}
            I have the owner&apos;s OK for this dog to stay today. This covers today&apos;s visit only.
          </span>
        </label>

        {err && <p className="text-[13px] text-red-300 mt-3" data-testid="guest-dog-error">{err}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} disabled={busy} data-testid="guest-dog-cancel"
                  className="flex-1 min-h-[44px] rounded-lg border border-shBorder text-shTextMuted font-black text-[12px] uppercase tracking-widest hover:text-shText disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={!ready || busy} data-testid="guest-dog-save"
                  className="flex-[2] min-h-[44px] rounded-lg bg-shPrimary text-bgHeader font-black text-[12px] uppercase tracking-widest disabled:opacity-40">
            {busy ? <><i className="fas fa-spinner fa-spin mr-1.5"/>Adding…</> : "Add guest dog"}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
