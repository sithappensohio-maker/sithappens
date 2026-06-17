import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";

const ENTITIES = [
  { id: "clients",            label: "Clients",                icon: "fa-users",                desc: "All client contact info + notes." },
  { id: "dogs",               label: "Dogs",                   icon: "fa-paw",                  desc: "Every dog with owner link + safety flags." },
  { id: "bookings",           label: "Bookings",               icon: "fa-calendar-check",       desc: "Full booking history (status, pricing, assignments)." },
  { id: "waitlist",           label: "Waitlist",               icon: "fa-hourglass-half",       desc: "Pending and converted waitlist entries." },
  { id: "intake_templates",   label: "Intake Templates",       icon: "fa-clipboard-list",       desc: "Form definitions you've published." },
  { id: "intake_submissions", label: "Intake Submissions",     icon: "fa-clipboard",            desc: "Submitted client/dog intake responses." },
  { id: "incidents",          label: "Incidents",              icon: "fa-triangle-exclamation", desc: "Logged incident reports with severity." },
  { id: "safety_flags",       label: "Dog Safety Flags",       icon: "fa-shield-halved",        desc: "Per-dog safety/temperament flags." },
  { id: "vaccines",           label: "Vaccines",               icon: "fa-syringe",              desc: "Per-dog vaccine records + expirations." },
  { id: "income",             label: "Income (Retail Sales)",  icon: "fa-dollar-sign",          desc: "Cash-basis revenue events." },
  { id: "communications",     label: "Client Communications",  icon: "fa-comments",             desc: "All logged calls/texts/emails." },
  { id: "timeclock",          label: "Staff Time Clock",       icon: "fa-clock",                desc: "Clock-in/out entries with hours." },
];

export default function DataExportPanel() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/export-index");
        setCounts(data || {});
      } catch {
        toast.error("Failed to load export counts");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const download = async (entity, label) => {
    setBusyId(entity);
    try {
      const resp = await api.get(`/export/${entity}`, { responseType: "blob" });
      const blob = new Blob([resp.data], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `sithappens-${entity}-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${label} CSV downloaded`);
    } catch (e) {
      toast.error("Export failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5" data-testid="data-export-panel">
      <div className="border border-shBlue/30 bg-shBlue/5 rounded p-4">
        <p className="text-[13px] text-gray-300">
          <span className="text-shBlue font-black uppercase tracking-widest"><i className="fas fa-cloud-arrow-down mr-2"/>One-click CSV exports.</span>
          Pull a clean spreadsheet of any major dataset for accounting, audits, migrations, or just to email your bookkeeper.
          Each file includes the row count in the response header so nothing is silently truncated.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ENTITIES.map(ent => {
          const n = counts[ent.id];
          const empty = n === 0;
          return (
            <div
              key={ent.id}
              className="bg-bgBase border border-bgHover rounded p-4 flex flex-col gap-3"
              data-testid={`export-row-${ent.id}`}
            >
              <div className="flex items-start gap-3">
                <i className={`fas ${ent.icon} text-shBlue text-lg mt-0.5`}/>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-white uppercase tracking-tight">{ent.label}</span>
                    {loading ? (
                      <span className="text-[11px] text-gray-500 uppercase tracking-widest">Loading…</span>
                    ) : (
                      <span className={`text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${empty ? "bg-gray-700/40 text-gray-500" : "bg-shGreen/15 text-shGreen"}`}>
                        {n ?? 0} rows
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-gray-400 mt-0.5">{ent.desc}</p>
                </div>
              </div>
              <button
                onClick={() => download(ent.id, ent.label)}
                disabled={busyId === ent.id || empty}
                data-testid={`export-btn-${ent.id}`}
                className={`text-[13px] font-black uppercase tracking-widest px-3 py-2 rounded transition ${
                  empty
                    ? "bg-gray-700/30 text-gray-500 cursor-not-allowed"
                    : "bg-shBlue/15 text-shBlue hover:bg-shBlue/25"
                }`}
              >
                {busyId === ent.id ? (
                  <><i className="fas fa-spinner fa-spin mr-2"/>Building CSV…</>
                ) : empty ? (
                  <><i className="fas fa-ban mr-2"/>Nothing to export</>
                ) : (
                  <><i className="fas fa-download mr-2"/>Download CSV</>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-[12px] text-gray-500 leading-relaxed border-t border-bgHover pt-4">
        <p><i className="fas fa-circle-info mr-1"/>CSVs are generated on-demand from your live database — no scheduled jobs to manage.</p>
        <p className="mt-1">Nested fields (e.g. <span className="text-gray-300 font-mono">safety_flags</span>, <span className="text-gray-300 font-mono">vaccines</span>) are exported as JSON inside the cell so nothing is lost.</p>
      </div>
    </div>
  );
}
