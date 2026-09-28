import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import WalkInModal from "./WalkInModal";

// Add a dog to a booking that already exists — a friend's dog or another of
// the family's own (friends & family, owner request 2026-09-28). The server
// decides everything (POST /bookings/{id}/group-dogs): same dates and service,
// the paying family's rates, never after a dog of the booking has gone home.
// This panel only picks the dog, and asks before overriding vaccines.
export default function GroupDogAdd({ booking, onDogs, payerName, isAdmin, canNewFriend = false, canVaccines = false, onAdded, onCancel }) {
  const [dogs, setDogs] = useState(null);
  const [families, setFamilies] = useState({});
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [vaccineBlock, setVaccineBlock] = useState(null);
  const [newFriendOpen, setNewFriendOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.get("/dogs/options"), api.get("/clients/options")])
      .then(([d, c]) => {
        if (!alive) return;
        setDogs(Array.isArray(d.data) ? d.data : []);
        setFamilies(Object.fromEntries((Array.isArray(c.data) ? c.data : []).map((f) => [f.id, f])));
      })
      .catch(() => { if (alive) { setDogs([]); setErr("Could not load the dogs."); } });
    return () => { alive = false; };
  }, []);

  const onBooking = useMemo(() => new Set(onDogs || []), [onDogs]);
  const matches = useMemo(() => {
    const words = search.trim().toLowerCase();
    return (dogs || [])
      .filter((d) => !onBooking.has(d.id))
      .filter((d) => !words || `${d.name} ${families[d.owner_id]?.name || ""}`.toLowerCase().includes(words))
      .slice(0, 30);
  }, [dogs, families, search, onBooking]);

  const add = async (dog, overrideVaccines = false) => {
    setBusy(true); setErr(""); setVaccineBlock(null);
    try {
      const { data } = await api.post(`/bookings/${booking.id}/group-dogs`, {
        dog_id: dog.id, addon_service_ids: [], override_vaccines: overrideVaccines,
      });
      onAdded?.(data);
    } catch (e) {
      const block = e.response?.data?.block;
      if (block && String(block.code || "").startsWith("vaccine_") && isAdmin && !overrideVaccines) setVaccineBlock(dog);
      setErr(e.response?.data?.detail || "Could not add the dog.");
    }
    setBusy(false);
  };

  const rejected = (d) => families[d.owner_id]?.client_status === "rejected";

  return (
    <div className="mt-3 rounded-lg border border-shSecondary/40 bg-[var(--sh-card-base)]/40 p-3 space-y-2" data-testid="group-dog-add">
      <p className="text-[12px] text-shTextMuted">
        Same dates and service as this booking, at {payerName ? `${payerName}'s` : "the paying family's"} rates — the multi-dog discount applies.
      </p>
      <div className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a dog or family"
               data-testid="group-dog-add-search"
               className="flex-1 min-w-0 min-h-[40px] bg-black/20 border border-shBorder/60 rounded-lg px-3 text-shText text-[14px]"/>
        {canNewFriend && (
          <button type="button" onClick={() => setNewFriendOpen(true)} data-testid="group-dog-add-new-friend"
                  className="min-h-[40px] px-3 rounded-lg border border-shSecondary/50 text-shSecondary text-[12px] font-black uppercase tracking-widest">
            <i className="fas fa-plus mr-1"/>New friend + dog
          </button>
        )}
      </div>
      {dogs === null ? (
        <p className="text-[13px] text-shTextMuted">Loading dogs…</p>
      ) : (
        <div className="max-h-[220px] overflow-y-auto space-y-1" data-testid="group-dog-add-list">
          {matches.map((d) => (
            <button key={d.id} type="button" disabled={rejected(d)} onClick={() => { setPicked(d); setErr(""); setVaccineBlock(null); }}
                    data-testid={`group-dog-add-option-${d.id}`}
                    className={`w-full text-left rounded border px-3 py-2 text-[13px] disabled:opacity-40 ${
                      picked?.id === d.id ? "border-shPrimary bg-shPrimary/10 text-shText" : "border-shBorder text-shTextMuted"}`}>
              <span className="font-black text-shText">{d.name}</span>
              {d.breed ? ` · ${d.breed}` : ""} · {families[d.owner_id]?.name || "—"}
              {rejected(d) && " · family marked rejected"}
            </button>
          ))}
          {matches.length === 0 && <p className="text-[13px] text-shTextMuted">No dogs match.</p>}
        </div>
      )}
      {err && <p className="text-[13px] text-red-300" data-testid="group-dog-add-error">{err}</p>}
      <div className="flex flex-wrap gap-2">
        {vaccineBlock && (
          <button type="button" onClick={() => add(vaccineBlock, true)} disabled={busy} data-testid="group-dog-add-override"
                  className="min-h-[40px] px-3 rounded-lg border border-shAccent/50 text-shAccent text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
            Add anyway (vaccines overridden)
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={busy}
                className="min-h-[40px] px-3 rounded-lg border border-shBorder text-shTextMuted text-[12px] font-black uppercase tracking-widest">
          Cancel
        </button>
        <button type="button" onClick={() => picked && add(picked)} disabled={!picked || busy} data-testid="group-dog-add-save"
                className="ml-auto min-h-[40px] px-4 rounded-lg bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest disabled:opacity-40">
          {busy ? "Adding…" : picked ? `Add ${picked.name}` : "Pick a dog"}
        </button>
      </div>
      {newFriendOpen && (
        <WalkInModal friend vaccinesAllowed={canVaccines} title="Add a friend's dog" onClose={() => setNewFriendOpen(false)}
                     onCreated={({ client, dog }) => {
                       // Kept in the list: a refused add (vaccines, space) is retried with this same dog.
                       setNewFriendOpen(false);
                       setFamilies((f) => ({ ...f, [client.id]: client }));
                       setDogs((ds) => [dog, ...(ds || [])]);
                       setPicked(dog);
                       add(dog);
                     }}/>
      )}
    </div>
  );
}
