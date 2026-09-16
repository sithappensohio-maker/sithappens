import { useState } from "react";
import { createPortal } from "react-dom";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

// Walk-in intake — the person at the desk with a dog we do not have on file,
// here for a nail trim or a bath. Two names are all the desk has to ask for;
// everything else is optional, because a walk-in who is being kept waiting
// while staff type is a walk-in who goes somewhere else next time.
//
// The record it creates is an ordinary client marked `walk_in`, so the visit,
// the dog and the money all have somewhere to live, and the same person can be
// booked ahead or converted to a real client later without re-entry.
export default function WalkInModal({ onClose, onCreated, title = "New walk-in" }) {
  const [ownerName, setOwnerName] = useState("");
  const [dogName, setDogName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [breed, setBreed] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = ownerName.trim() && dogName.trim();

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/clients/walk-in", {
        owner_name: ownerName.trim(), dog_name: dogName.trim(),
        phone: phone.trim(), email: email.trim(), breed: breed.trim(), notes: notes.trim(),
      });
      toast.success(`${data.dog.name} added as a walk-in`);
      onCreated?.(data);
    } catch (e) {
      toast.error(formatErr(e) || "Could not add the walk-in");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full min-h-[44px] bg-black/20 border border-shBorder/60 rounded-lg px-3 text-shText text-[14px] focus:outline-none focus:border-shSecondary/50";
  const label = "block text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1";

  return createPortal((
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[120] overflow-y-auto"
         onClick={onClose} data-testid="walk-in-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-5 w-full max-w-md shadow-2xl my-8"
           onClick={(e) => e.stopPropagation()}>
        <h4 className="text-lg font-black text-shText uppercase italic">{title}</h4>
        <p className="text-[12.5px] text-shTextMuted mt-1 mb-4 leading-relaxed">
          For someone who isn&apos;t a client yet — a nail trim or a bath today. Just the two names
          are required; you can fill in the rest later or turn them into a full client.
        </p>

        <div className="space-y-3">
          <div>
            <label className={label}>Owner&apos;s name <span className="text-shAccent">*</span></label>
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoFocus
                   placeholder="e.g. Dana Reyes" className={field} data-testid="walk-in-owner-name"/>
          </div>
          <div>
            <label className={label}>Dog&apos;s name <span className="text-shAccent">*</span></label>
            <input value={dogName} onChange={(e) => setDogName(e.target.value)}
                   placeholder="e.g. Pepper" className={field} data-testid="walk-in-dog-name"/>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel"
                     placeholder="Optional" className={field} data-testid="walk-in-phone"/>
            </div>
            <div>
              <label className={label}>Breed</label>
              <input value={breed} onChange={(e) => setBreed(e.target.value)}
                     placeholder="Optional" className={field} data-testid="walk-in-breed"/>
            </div>
          </div>
          <div>
            <label className={label}>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email"
                   placeholder="Optional — lets you send a receipt" className={field} data-testid="walk-in-email"/>
          </div>
          <div>
            <label className={label}>Note</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
                   placeholder="Optional — e.g. nervous about clippers" className={field} data-testid="walk-in-notes"/>
          </div>
        </div>

        <p className="text-[11.5px] text-shTextMuted mt-3 leading-relaxed">
          <i className="fas fa-circle-info mr-1.5 text-shSecondary" aria-hidden="true"/>
          No vaccine records are on file for a walk-in, so the dog will show as unvaccinated until
          paperwork is handed in.
        </p>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} disabled={busy} data-testid="walk-in-cancel"
                  className="flex-1 min-h-[44px] rounded-lg border border-shBorder text-shTextMuted font-black text-[12px] uppercase tracking-widest hover:text-shText disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={!ready || busy} data-testid="walk-in-save"
                  className="flex-[2] min-h-[44px] rounded-lg bg-shPrimary text-bgHeader font-black text-[12px] uppercase tracking-widest disabled:opacity-40">
            {busy ? <><i className="fas fa-spinner fa-spin mr-1.5"/>Adding…</> : "Add walk-in"}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
