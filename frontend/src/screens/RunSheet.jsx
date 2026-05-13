import { useEffect, useState } from "react";
import { api } from "../lib/api";

function todayISO() { return new Date().toISOString().split("T")[0]; }
function fmtTime(t) { return t || "—"; }
function fmtTs(iso) { if (!iso) return "—"; try { return new Date(iso).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }); } catch { return iso; } }

export default function RunSheet() {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState(null);

  const load = async (d) => {
    const { data } = await api.get("/run-sheet", { params: { date_str: d } });
    setData(data);
  };
  useEffect(() => { load(date); }, [date]);

  if (!data) return <div className="text-gray-400">Loading…</div>;

  const groups = ["boarding", "daycare", "training"];
  const bookings = data.bookings || [];

  return (
    <div className="animate-slide-in" data-testid="run-sheet">
      <style>{`@media print { .no-print{display:none!important;} body{background:white!important;} .print-card{background:white!important;color:black!important;border-color:#ccc!important;} .print-card *{color:black!important;} }`}</style>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6 no-print">
        <div>
          <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Daily Run Sheet</h3>
          <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-1">Feeding · Medication · Notes · Times — for the team (and the fridge)</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} data-testid="rs-date"
                 className="bg-bgPanel border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
          <button onClick={()=>window.print()} data-testid="rs-print"
                  className="bg-shGreen text-bgHeader px-5 py-2 rounded text-[12px] font-black uppercase tracking-widest shadow"><i className="fas fa-print mr-1"/>Print</button>
        </div>
      </div>

      <div className="print-card bg-bgPanel border border-bgHover rounded-xl p-6 mb-6 shadow-2xl">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h2 className="text-2xl font-black uppercase italic text-shGreen">Sit Happens · Daily Sheet</h2>
            <p className="text-xs text-gray-400 uppercase font-black tracking-widest">{new Date(data.date+"T12:00").toLocaleDateString(undefined,{ weekday:'long', month:'long', day:'numeric', year:'numeric' })}</p>
          </div>
          <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest text-right">{bookings.length} dogs on premises</p>
        </div>
      </div>

      {bookings.length === 0 && <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center text-xs text-gray-500 uppercase font-black">No dogs scheduled for this day.</div>}

      {groups.map(g => {
        const list = bookings.filter(b => b.service_type === g);
        if (list.length === 0) return null;
        return (
          <div key={g} className="mb-6">
            <h4 className="text-xs font-black text-shBlue uppercase tracking-widest mb-3 print-card"><i className="fas fa-paw mr-2"/>{g} ({list.length})</h4>
            <div className="space-y-3">
              {list.map(b => {
                const d = b.dog || {};
                return (
                  <div key={b.id} className="print-card bg-bgPanel border border-bgHover rounded-xl p-5 shadow-lg" data-testid={`rs-card-${b.id}`}>
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3">
                      <div>
                        <h5 className="text-lg font-black text-white uppercase tracking-tight">{b.dog_name}</h5>
                        <p className="text-[12px] text-gray-400 font-black uppercase tracking-widest mt-1">{d.breed || "—"} · {d.sex} · {d.fixed==="Yes"?"Fixed":"Intact"}</p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-gray-300"><span className="text-gray-500 font-black uppercase text-[13px] tracking-widest">Owner</span> {b.client_name}</p>
                        {b.client_phone && <p className="text-gray-300"><i className="fas fa-phone mr-1 text-[12px]"/>{b.client_phone}</p>}
                        {b.client_emerg && <p className="text-red-400 text-[13px]"><i className="fas fa-triangle-exclamation mr-1 text-[12px]"/>{b.client_emerg}</p>}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-[13px]">
                      <Pill label="Drop-off" value={fmtTime(b.dropoff_time) + (b.checked_in_at?` · in ${fmtTs(b.checked_in_at)}`:"")} />
                      <Pill label="Pickup" value={fmtTime(b.pickup_time) + (b.checked_out_at?` · out ${fmtTs(b.checked_out_at)}`:"")} />
                      {b.kennel && <Pill label="Kennel" value={b.kennel} accent="shBlue" />}
                      <Pill label="Service" value={b.service_type} />
                    </div>

                    {(d.feeding_schedule?.length > 0) && (
                      <div className="mt-4">
                        <p className="text-[12px] font-black text-shGreen uppercase tracking-widest mb-1"><i className="fas fa-bowl-food mr-1"/>Feeding</p>
                        <ul className="text-xs text-gray-300 space-y-1">
                          {d.feeding_schedule.map(f => (
                            <li key={f.id} className="flex flex-wrap gap-2 items-baseline">
                              <span className="font-black text-shGreen">{f.time}</span>
                              <span>{f.amount} {f.food_type}</span>
                              {f.notes && <span className="italic text-gray-400">— {f.notes}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {(d.medications?.length > 0) && (
                      <div className="mt-3">
                        <p className="text-[12px] font-black text-purple-400 uppercase tracking-widest mb-1"><i className="fas fa-pills mr-1"/>Medications</p>
                        <ul className="text-xs text-gray-300 space-y-1">
                          {d.medications.map(m => (
                            <li key={m.id} className="flex flex-wrap gap-2 items-baseline">
                              <span className="font-black text-purple-400">{(m.times||[]).join(", ") || "—"}</span>
                              <span>{m.name} {m.dosage}</span>
                              {m.with_food && <span className="text-[13px] uppercase font-black tracking-widest bg-shGreen/15 text-shGreen px-2 py-0.5 rounded">With food</span>}
                              {m.notes && <span className="italic text-gray-400">— {m.notes}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {d.notes && <p className="mt-3 text-xs text-gray-300 bg-bgBase rounded p-2"><span className="text-shOrange font-black uppercase text-[12px] tracking-widest mr-2">Notes:</span>{d.notes}</p>}
                    {b.notes && <p className="mt-2 text-xs text-gray-300 bg-bgBase rounded p-2"><span className="text-shBlue font-black uppercase text-[12px] tracking-widest mr-2">Booking:</span>{b.notes}</p>}
                    {(d.vet_name || d.vet_phone) && <p className="mt-2 text-[13px] text-gray-400"><i className="fas fa-stethoscope mr-1 text-shBlue"/><span className="font-black text-gray-300">Vet:</span> {d.vet_name} {d.vet_phone && `· ${d.vet_phone}`}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Pill({ label, value, accent="gray-400" }) {
  return (
    <div className="bg-bgBase rounded p-2">
      <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`text-${accent==="shBlue"?"shBlue":"white"} font-black text-sm`}>{value}</p>
    </div>
  );
}
