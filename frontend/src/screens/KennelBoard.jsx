/* Sprint 110eu — Phase 4: Visual Kennel / Daycare board
   Fast operational view of every on-site dog with assignment slots + warning
   badges (vaccine lapsed, do-not-group, open incidents, overdue meds). */
import { useEffect, useMemo, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import PageHero from "../components/PageHero";
import Avatar from "../components/Avatar";

const SERVICE_META = {
  daycare:     { label: "Daycare",     color: "text-shGreen",   accent: "border-l-shGreen",  icon: "fa-sun"      },
  boarding:    { label: "Boarding",    color: "text-shOrange",  accent: "border-l-shOrange", icon: "fa-moon"     },
  training:    { label: "Training",    color: "text-purple-300",accent: "border-l-purple-400",icon: "fa-graduation-cap" },
  grooming:    { label: "Grooming",    color: "text-shBlue",    accent: "border-l-shBlue",   icon: "fa-scissors" },
  photography: { label: "Photography", color: "text-pink-300",  accent: "border-l-pink-400", icon: "fa-camera"   },
  other:       { label: "Other",       color: "text-gray-300",  accent: "border-l-bgHover",  icon: "fa-paw"      },
};

export default function KennelBoard() {
  const [board, setBoard] = useState(null);
  const [labels, setLabels] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);   // card being edited
  const [labelsOpen, setLabelsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, l] = await Promise.all([
        api.get("/kennel-board"),
        api.get("/kennel-board/labels"),
      ]);
      setBoard(b.data);
      setLabels(l.data);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail));
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const saveAssignment = async (card, patch) => {
    try {
      await api.patch(`/bookings/${card.booking_id}`, patch);
      toast.success("Saved");
      setEditing(null);
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="kennel-board-screen">
      <PageHero
        eyebrow={{ icon: "fa-paw", text: `${board?.on_site_count || 0} dog${(board?.on_site_count||0)===1?"":"s"} scheduled today`, color: "text-shGreen" }}
        title="Kennel Board."
        highlight="Where every dog goes."
        subtitle="Assign kennel, room, crate, yard group, or training group at a glance. Warning badges flag what needs attention."
        right={(
          <div className="flex gap-2">
            <button onClick={()=>setLabelsOpen(true)} data-testid="open-labels"
                    className="bg-bgPanel border border-bgHover text-gray-300 px-4 py-2.5 rounded-lg text-[12px] font-black uppercase tracking-widest hover:text-white">
              <i className="fas fa-tags mr-2"/>Labels
            </button>
            <button onClick={load} data-testid="kennel-refresh"
                    className="bg-shGreen text-bgBase px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90">
              <i className="fas fa-rotate mr-2"/>Refresh
            </button>
          </div>
        )}
        testid="kennel-hero"
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {Object.entries(SERVICE_META).filter(([k]) => k !== "other").map(([k, m]) => (
          <div key={k} className="card-kennel rounded-xl p-3 text-center" data-testid={`kennel-stat-${k}`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500"><i className={`fas ${m.icon} mr-1`}/>{m.label}</p>
            <p className={`text-2xl font-black mt-1 ${m.color}`}>{board?.summary?.[k] || 0}</p>
          </div>
        ))}
      </div>

      {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

      {loading ? <p className="text-gray-500 text-sm">Loading…</p> :
       (!board || board.on_site_count === 0) ? (
        <div className="card-kennel rounded-xl p-10 text-center" data-testid="kennel-empty">
          <p className="text-shGreen font-black uppercase text-xs tracking-widest">
            <i className="fas fa-shield-heart mr-2"/>No dogs scheduled today. Quiet day for the team!
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(SERVICE_META).map(([k, m]) => {
            const cards = board?.groups?.[k] || [];
            if (cards.length === 0) return null;
            return (
              <div key={k} data-testid={`kennel-group-${k}`}>
                <h3 className={`text-lg font-black uppercase italic tracking-tight mb-3 ${m.color}`}>
                  <i className={`fas ${m.icon} mr-2`}/>{m.label} · {cards.length}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {cards.map(c => (
                    <KennelCard key={c.booking_id} card={c} accent={m.accent}
                                onEdit={()=>setEditing(c)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && labels && (
        <AssignmentModal card={editing} labels={labels}
                         onSave={(patch)=>saveAssignment(editing, patch)}
                         onClose={()=>setEditing(null)} />
      )}

      {labelsOpen && labels && (
        <LabelsModal labels={labels} onClose={()=>setLabelsOpen(false)}
                     onSaved={(updated)=>{ setLabels(updated); setLabelsOpen(false); load(); }} />
      )}
    </div>
  );
}

function KennelCard({ card, accent, onEdit }) {
  const w = card.warnings || {};
  return (
    <button onClick={onEdit} data-testid={`kennel-card-${card.booking_id}`}
            className={`bg-bgPanel border border-bgHover ${accent} border-l-4 rounded-xl p-4 shadow-lg text-left hover:border-shBlue transition`}>
      <div className="flex items-start gap-3">
        <Avatar src={card.photo} icon="fa-paw" size="md" ring="border-shGreen/40" alt={card.dog_name}/>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base text-white font-black uppercase tracking-tight truncate">{card.dog_name}</span>
            {card.breed && <span className="text-[11px] text-gray-500 truncate">{card.breed}</span>}
          </div>
          <p className="text-[12px] text-gray-400 truncate">{card.client_name}</p>
          {(card.dropoff_time || card.pickup_time) && (
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-500 mt-1">
              {card.dropoff_time && <span><i className="fas fa-arrow-down mr-1"/>{card.dropoff_time}</span>}
              {card.pickup_time && <span className="ml-2"><i className="fas fa-arrow-up mr-1"/>{card.pickup_time}</span>}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1 items-end">
          {w.vaccine_lapsed && <Badge icon="fa-syringe" cls="bg-red-500/15 text-red-300 ring-1 ring-red-400/40" testid={`warn-vaccine-${card.booking_id}`} title="Vaccine lapsed"/>}
          {w.med_overdue && <Badge icon="fa-pills" cls="bg-shOrange/15 text-shOrange ring-1 ring-shOrange/40" testid={`warn-med-${card.booking_id}`} title="Overdue medication"/>}
          {w.do_not_group && <Badge icon="fa-ban" cls="bg-purple-500/15 text-purple-200 ring-1 ring-purple-400/40" testid={`warn-group-${card.booking_id}`} title="Do not group"/>}
          {(w.open_incidents || 0) > 0 && <Badge icon="fa-triangle-exclamation" cls="bg-red-500/15 text-red-300" testid={`warn-incident-${card.booking_id}`} title={`${w.open_incidents} open incident${w.open_incidents>1?"s":""}`}/>}
          {w.has_feeding_plan && <Badge icon="fa-bowl-food" cls="bg-shGreen/10 text-shGreen" testid={`feed-${card.booking_id}`} title="Has feeding plan"/>}
          {w.has_med_plan && !w.med_overdue && <Badge icon="fa-pills" cls="bg-purple-500/10 text-purple-300" testid={`med-${card.booking_id}`} title="Has medication"/>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <AssignmentSlot label="Kennel"   value={card.kennel} />
        <AssignmentSlot label="Room"     value={card.room} />
        <AssignmentSlot label="Crate"    value={card.crate} />
        <AssignmentSlot label="Yard"     value={card.yard_group} />
        {card.training_group && <AssignmentSlot label="Training" value={card.training_group} />}
      </div>

      {card.safety_flags && card.safety_flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.safety_flags.map(f => (
            <span key={f} className="text-[10px] font-black uppercase tracking-widest bg-red-500/15 text-red-300 px-1.5 py-0.5 rounded">
              <i className="fas fa-flag mr-1"/>{f}
            </span>
          ))}
        </div>
      )}

      {card.notes && <p className="mt-2 text-[12px] text-gray-400 italic line-clamp-2"><i className="fas fa-quote-left text-gray-600 mr-1 text-[10px]"/>{card.notes}</p>}
    </button>
  );
}

function Badge({ icon, cls, title, testid }) {
  return (
    <span className={`inline-flex w-7 h-7 items-center justify-center rounded-full ${cls}`} title={title} data-testid={testid}>
      <i className={`fas ${icon} text-[12px]`}/>
    </span>
  );
}

function AssignmentSlot({ label, value }) {
  return (
    <div className="bg-bgBase border border-bgHover rounded p-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`text-[13px] font-black truncate ${value ? "text-white" : "text-gray-600 italic"}`}>{value || "— unassigned"}</p>
    </div>
  );
}

function AssignmentModal({ card, labels, onSave, onClose }) {
  const [kennel, setKennel] = useState(card.kennel || "");
  const [room, setRoom] = useState(card.room || "");
  const [crate, setCrate] = useState(card.crate || "");
  const [yardGroup, setYardGroup] = useState(card.yard_group || "");
  const [trainingGroup, setTrainingGroup] = useState(card.training_group || "");
  const [notes, setNotes] = useState(card.notes || "");

  const submit = () => onSave({ kennel, room, crate, yard_group: yardGroup, training_group: trainingGroup, notes });

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl animate-slide-in" data-testid="assignment-modal">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h4 className="text-lg font-black text-white uppercase italic tracking-tight">{card.dog_name}</h4>
            <p className="text-[13px] text-gray-400">{card.client_name} · {card.service_type}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times"/></button>
        </div>

        <div className="space-y-3">
          <SelectField label="Kennel" value={kennel} setValue={setKennel} options={labels.kennels} testid="assign-kennel"/>
          <SelectField label="Room" value={room} setValue={setRoom} options={labels.rooms} testid="assign-room"/>
          <SelectField label="Crate" value={crate} setValue={setCrate} options={labels.crates} testid="assign-crate"/>
          <SelectField label="Yard group" value={yardGroup} setValue={setYardGroup} options={labels.yard_groups} testid="assign-yard"/>
          <SelectField label="Training group" value={trainingGroup} setValue={setTrainingGroup} options={labels.training_groups} testid="assign-training"/>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Notes (replaces booking notes)</label>
            <textarea value={notes} onChange={(e)=>setNotes(e.target.value)} rows={2} data-testid="assign-notes"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-bgHover mt-4">
          <button onClick={onClose} className="text-gray-500 font-black uppercase text-[12px] tracking-widest">Cancel</button>
          <button onClick={submit} data-testid="assign-save"
                  className="bg-shGreen text-bgBase px-5 py-2 rounded font-black text-[12px] uppercase tracking-widest shadow-xl">
            <i className="fas fa-save mr-1"/>Save
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectField({ label, value, setValue, options, testid }) {
  return (
    <div>
      <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">{label}</label>
      <select value={value} onChange={(e)=>setValue(e.target.value)} data-testid={testid}
              className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
        <option value="">— Unassigned —</option>
        {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function LabelsModal({ labels, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => ({
    kennels: (labels.kennels || []).join("\n"),
    rooms: (labels.rooms || []).join("\n"),
    crates: (labels.crates || []).join("\n"),
    yard_groups: (labels.yard_groups || []).join("\n"),
    training_groups: (labels.training_groups || []).join("\n"),
  }));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {};
      for (const k of Object.keys(draft)) {
        payload[k] = draft[k].split("\n").map(s => s.trim()).filter(Boolean);
      }
      const { data } = await api.put("/kennel-board/labels", payload);
      toast.success("Labels saved");
      onSaved(data);
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-6 shadow-2xl animate-slide-in max-h-[calc(var(--app-height)_-_1rem)] overflow-y-auto" data-testid="labels-modal">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Kennel Board Labels</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times"/></button>
        </div>
        <p className="text-[13px] text-gray-400 mb-4">One label per line. These populate the dropdowns on every assignment card.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries({kennels: "Kennels", rooms: "Rooms", crates: "Crates", yard_groups: "Yard groups", training_groups: "Training groups"}).map(([k, l]) => (
            <div key={k}>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">{l}</label>
              <textarea value={draft[k]} onChange={(e)=>setDraft({ ...draft, [k]: e.target.value })} rows={5} data-testid={`labels-${k}`}
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm font-mono" />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-bgHover mt-4">
          <button onClick={onClose} className="text-gray-500 font-black uppercase text-[12px] tracking-widest">Cancel</button>
          <button onClick={save} disabled={busy} data-testid="labels-save"
                  className="bg-shGreen text-bgBase px-5 py-2 rounded font-black text-[12px] uppercase tracking-widest shadow-xl disabled:opacity-60">
            <i className="fas fa-save mr-1"/>Save labels
          </button>
        </div>
      </div>
    </div>
  );
}
