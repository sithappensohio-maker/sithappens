// Sprint 110di-65 — Reusable CSV import button for Programs & Daily Tracker.
// Picks a CSV, parses client-side, hands the parsed payload + errors to the parent.

import { useRef, useState } from "react";

export default function CsvImportButton({
  label = "Import CSV",
  parse,                // function(text) -> { ...payload, errors: string[] }
  onImport,             // function(parsed) -> void  (parent applies it to its state)
  sampleText,           // string — used by the "Download sample" link
  sampleFilename = "sample.csv",
  testIdPrefix = "csv-import",
  helpText = "",
}) {
  const fileRef = useRef(null);
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState([]);

  const handleFile = async (e) => {
    setMsg(""); setErrors([]);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parse(text);
      if (parsed.errors?.length) setErrors(parsed.errors);
      onImport(parsed);
      const counts = [];
      if (Array.isArray(parsed.modules)) counts.push(`${parsed.modules.length} modules`);
      if (Array.isArray(parsed.days)) counts.push(`${parsed.days.length} days`);
      if (Array.isArray(parsed.modules)) {
        const goals = parsed.modules.reduce((s, m) => s + (m.goals?.length || 0), 0);
        counts.push(`${goals} goals`);
      }
      if (Array.isArray(parsed.days)) {
        const steps = parsed.days.reduce((s, d) => s + (d.steps?.length || 0), 0);
        counts.push(`${steps} steps`);
      }
      setMsg(`Loaded ${counts.join(", ")}`);
    } catch (err) {
      setMsg("");
      setErrors([err.message || "Failed to parse CSV"]);
    } finally {
      e.target.value = ""; // allow re-picking the same file
    }
  };

  const downloadSample = () => {
    const blob = new Blob([sampleText || ""], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = sampleFilename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  return (
    <div className="space-y-1" data-testid={`${testIdPrefix}-wrapper`}>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile}
               data-testid={`${testIdPrefix}-file`} className="hidden" />
        <button type="button" onClick={() => fileRef.current?.click()}
                data-testid={`${testIdPrefix}-btn`}
                className="bg-pink-500/15 text-pink-300 border border-pink-500/50 px-3 py-1.5 rounded font-black text-[12px] uppercase tracking-widest hover:bg-pink-500/25">
          <i className="fas fa-file-csv mr-1"/>{label}
        </button>
        {sampleText && (
          <button type="button" onClick={downloadSample}
                  data-testid={`${testIdPrefix}-sample`}
                  className="text-shBlue hover:text-white text-[11px] font-black uppercase tracking-widest underline-offset-2 hover:underline">
            <i className="fas fa-download mr-1"/>Download sample
          </button>
        )}
      </div>
      {helpText && <p className="text-[12px] text-gray-500">{helpText}</p>}
      {msg && (
        <p data-testid={`${testIdPrefix}-msg`} className="text-[12px] text-shGreen font-bold">
          <i className="fas fa-circle-check mr-1"/>{msg}
        </p>
      )}
      {errors.length > 0 && (
        <ul data-testid={`${testIdPrefix}-errors`} className="text-[12px] text-red-400 list-disc pl-4 max-h-24 overflow-y-auto">
          {errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
          {errors.length > 20 && <li className="text-gray-500">…and {errors.length - 20} more</li>}
        </ul>
      )}
    </div>
  );
}
