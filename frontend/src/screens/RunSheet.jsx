import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import PageHero from "../components/PageHero";
import BookingDetailModal from "../components/BookingDetailModal";
import { todayISO } from "../lib/date";

function fmtTime(t) { return t || "—"; }
function fmtTs(iso) { if (!iso) return "—"; try { return new Date(iso).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }); } catch { return iso; } }

export default function RunSheet() {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState(null);
  // Sprint 110ar — clicking any run-sheet card opens the unified
  // BookingDetailModal so staff can peek vaccines/meds/care/report-card
  // history without leaving the run sheet.
  const [detailId, setDetailId] = useState(null);
  // Sprint 110di-37 — "Boarding only" / kennel-card filter. Boarding dogs
  // need printed door cards more often than daycare drop-offs.
  const [boardingOnly, setBoardingOnly] = useState(false);
  // Sprint 110di-37 — Save-PDF state (busy + ref to the printable region so
  // html2pdf only renders the run sheet, not the page chrome).
  const [savingPdf, setSavingPdf] = useState(false);
  const printRef = useRef(null);

  const load = async (d) => {
    const { data } = await api.get("/run-sheet", { params: { date_str: d } });
    setData(data);
  };
  useEffect(() => { load(date); }, [date]);

  const savePdf = async () => {
    if (savingPdf || !printRef.current) return;
    setSavingPdf(true);
    document.body.classList.add("printing-pdf");
    try {
      // Lazy-load html2pdf so it only ships when the user actually exports.
      const mod = await import("html2pdf.js");
      const html2pdf = mod.default || mod;
      await html2pdf().from(printRef.current).set({
        margin: 0.5,
        filename: `run-sheet-${data?.date || todayISO()}${boardingOnly ? "-boarding" : ""}.pdf`,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"], avoid: ".print-card" },
      }).save();
    } catch (e) {
      // Non-fatal — fall back to the regular print dialog so staff still
      // get a sheet out.
      window.print();
    } finally {
      document.body.classList.remove("printing-pdf");
      setSavingPdf(false);
    }
  };

  if (!data) return <div className="text-shTextMuted">Loading…</div>;

  const allGroups = ["boarding", "daycare", "grooming", "training"];
  const groups = boardingOnly ? ["boarding"] : allGroups;
  const bookings = data.bookings || [];
  const visibleCount = boardingOnly
    ? bookings.filter((b) => b.service_type === "boarding").length
    : bookings.length;

  return (
    <div className="animate-slide-in space-y-6" data-testid="run-sheet">
      <style>{`@media print { .no-print{display:none!important;} body{background:white!important;} .print-card{background:white!important;color:black!important;border-color:#ccc!important;} .print-card *{color:black!important;} }`}</style>
      <div className="no-print">
        <PageHero
          eyebrow={{ icon: "fa-clipboard-list", text: `${visibleCount} dogs on premises${boardingOnly ? " · boarding only" : ""}`, color: "text-shPrimary" }}
          title="Daily Run Sheet."
          highlight="For the team."
          subtitle="Feeding · Medication · Notes · Times — print-ready for the fridge."
          right={(
            <div className="flex items-center gap-2 flex-wrap">
              <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} data-testid="rs-date"
                     className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-xs" style={{colorScheme:"dark"}}/>
              <label className="flex items-center gap-2 bg-[var(--sh-card-base)] border border-shBorder rounded px-3 py-2 text-[12px] font-black uppercase tracking-widest text-shTextMuted cursor-pointer hover:border-shSecondary transition"
                     data-testid="rs-boarding-only-label">
                <input type="checkbox" checked={boardingOnly}
                       onChange={(e)=>setBoardingOnly(e.target.checked)}
                       data-testid="rs-boarding-only"
                       className="w-4 h-4 accent-shSecondary"/>
                Boarding only
              </label>
              <button onClick={()=>window.print()} data-testid="rs-print"
                      className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest shadow hover:bg-shPrimary/90 transition">
                <i className="fas fa-print mr-1"/>Print
              </button>
              <button onClick={savePdf} disabled={savingPdf} data-testid="rs-save-pdf"
                      className="bg-shSecondary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest shadow hover:bg-shSecondary/90 transition disabled:opacity-50">
                <i className={`fas ${savingPdf ? "fa-spinner fa-spin" : "fa-file-pdf"} mr-1`}/>{savingPdf ? "Saving…" : "Save PDF"}
              </button>
            </div>
          )}
          testid="runsheet-hero"
        />
      </div>

      <div ref={printRef}>
      <div className="print-card bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-6 mb-6 shadow-2xl">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h2 className="text-2xl font-black uppercase italic text-shPrimary">Sit Happens · Daily Sheet</h2>
            <p className="text-xs text-shTextMuted uppercase font-black tracking-widest">{new Date(data.date+"T12:00").toLocaleDateString(undefined,{ weekday:'long', month:'long', day:'numeric', year:'numeric' })}</p>
          </div>
          <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest text-right">{visibleCount} dogs{boardingOnly ? " · boarding only" : " on premises"}</p>
        </div>
      </div>

      {visibleCount === 0 && <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-10 text-center text-xs text-shTextMuted uppercase font-black" data-testid="rs-empty">No {boardingOnly ? "boarding " : ""}dogs scheduled for this day.</div>}

      {groups.map(g => {
        const list = bookings.filter(b => b.service_type === g);
        if (list.length === 0) return null;
        return (
          <div key={g} className="mb-6">
            <h4 className="text-xs font-black text-shSecondary uppercase tracking-widest mb-3 print-card"><i className="fas fa-paw mr-2"/>{g} ({list.length})</h4>
            <div className="space-y-3">
              {list.map(b => {
                const d = b.dog || {};
                return (
                  <div key={b.id}
                       onClick={() => setDetailId(b.id)}
                       role="button"
                       tabIndex={0}
                       onKeyDown={(e)=>{ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailId(b.id); } }}
                       className="print-card bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-5 shadow-lg cursor-pointer hover:border-shPrimary/60 hover:bg-[var(--sh-card-base)]/80 transition print:cursor-auto print:hover:border-shBorder"
                       data-testid={`rs-card-${b.id}`}>
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-3">
                      <div>
                        <h5 className="text-lg font-black text-shText uppercase tracking-tight">{b.dog_name}</h5>
                        <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest mt-1">{d.breed || "—"} · {d.sex} · {d.fixed==="Yes"?"Fixed":"Intact"}</p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-shTextMuted"><span className="text-shTextMuted font-black uppercase text-[15px] tracking-widest">Owner</span> {b.client_name}</p>
                        {b.client_phone && <p className="text-shTextMuted"><i className="fas fa-phone mr-1 text-[14px]"/>{b.client_phone}</p>}
                        {b.client_emerg && <p className="text-red-400 text-[15px]"><i className="fas fa-triangle-exclamation mr-1 text-[14px]"/>{b.client_emerg}</p>}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-[15px]">
                      <Pill label="Drop-off" value={fmtTime(b.dropoff_time) + (b.checked_in_at?` · in ${fmtTs(b.checked_in_at)}`:"")} />
                      <Pill label="Pickup" value={fmtTime(b.pickup_time) + (b.checked_out_at?` · out ${fmtTs(b.checked_out_at)}`:"")} />
                      {b.kennel && <Pill label="Kennel" value={b.kennel} accent="shSecondary" />}
                      <Pill label="Service" value={b.service_type==="grooming" && b.grooming_type ? `${b.service_type} · ${b.grooming_type==="bath"?"bath":"nail trim"}` : b.service_type} />
                      {b.active_program_name && <Pill label="Program" value={b.active_program_name} />}
                    </div>

                    {(d.feeding_schedule?.length > 0) && (
                      <div className="mt-4">
                        <p className="text-[14px] font-black text-shPrimary uppercase tracking-widest mb-1"><i className="fas fa-bowl-food mr-1"/>Feeding</p>
                        <ul className="text-xs text-shTextMuted space-y-1">
                          {d.feeding_schedule.map(f => (
                            <li key={f.id} className="flex flex-wrap gap-2 items-baseline">
                              <span className="font-black text-shPrimary">{f.time}</span>
                              <span>{f.amount} {f.food_type}</span>
                              {f.notes && <span className="italic text-shTextMuted">— {f.notes}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {(d.medications?.length > 0) && (
                      <div className="mt-3">
                        <p className="text-[14px] font-black text-purple-400 uppercase tracking-widest mb-1"><i className="fas fa-pills mr-1"/>Medications</p>
                        <ul className="text-xs text-shTextMuted space-y-1">
                          {d.medications.map(m => (
                            <li key={m.id} className="flex flex-wrap gap-2 items-baseline">
                              <span className="font-black text-purple-400">{(m.times||[]).join(", ") || "—"}</span>
                              <span>{m.name} {m.dosage}</span>
                              {m.with_food && <span className="text-[15px] uppercase font-black tracking-widest bg-shPrimary/15 text-shPrimary px-2 py-0.5 rounded">With food</span>}
                              {m.notes && <span className="italic text-shTextMuted">— {m.notes}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {d.notes && <p className="mt-3 text-xs text-shTextMuted bg-[var(--sh-card-base)] rounded p-2"><span className="text-shAccent font-black uppercase text-[14px] tracking-widest mr-2">Notes:</span>{d.notes}</p>}
                    {b.notes && <p className="mt-2 text-xs text-shTextMuted bg-[var(--sh-card-base)] rounded p-2"><span className="text-shSecondary font-black uppercase text-[14px] tracking-widest mr-2">Booking:</span>{b.notes}</p>}
                    {(d.vet_name || d.vet_phone) && <p className="mt-2 text-[15px] text-shTextMuted"><i className="fas fa-stethoscope mr-1 text-shSecondary"/><span className="font-black text-shTextMuted">Vet:</span> {d.vet_name} {d.vet_phone && `· ${d.vet_phone}`}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>

      {detailId && (
        <BookingDetailModal booking={{ id: detailId }}
                            onClose={()=>setDetailId(null)} />
      )}
    </div>
  );
}

function Pill({ label, value, accent="gray-400" }) {
  return (
    <div className="bg-[var(--sh-card-base)] rounded p-2">
      <p className="text-[15px] font-black uppercase tracking-widest text-shTextMuted">{label}</p>
      <p className={`text-${accent==="shSecondary"?"shSecondary":"white"} font-black text-sm`}>{value}</p>
    </div>
  );
}
