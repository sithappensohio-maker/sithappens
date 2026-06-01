// Sprint 110bp — reusable bulk-CSV-import row.
//
// Drop into any admin panel that has a matching backend endpoint pair:
//   GET  {templateUrl}   → returns a CSV with example rows
//   POST {uploadUrl}     → multipart "file" upload, returns
//                          {created, updated, skipped: [{line, reason}], skipped_count}

import { useRef, useState } from "react";
import { api } from "../lib/api";

export default function CsvImportRow({
  templateUrl,
  uploadUrl,
  templateFilename,
  testIdPrefix = "csv-import",
  helperText,
  onComplete,
  borderColor = "border-shGreen/30",
  accentColor = "text-shGreen",
}) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const downloadTemplate = async () => {
    try {
      const res = await api.get(templateUrl, { responseType: "blob" });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = templateFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.response?.data?.detail || "Could not download template");
    }
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setResult(null); setError("");
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await api.post(uploadUrl, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(res.data);
      if (onComplete) onComplete();
    } catch (err) {
      setError(err.response?.data?.detail || "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className={`bg-bgBase border ${borderColor} rounded-lg p-3 mb-4`} data-testid={`${testIdPrefix}-row`}>
      <p className={`text-[12px] font-black uppercase tracking-widest ${accentColor} mb-2`}>
        <i className="fas fa-file-csv mr-1"/>Bulk import from CSV
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={downloadTemplate}
                data-testid={`${testIdPrefix}-template`}
                className="bg-bgPanel border border-bgHover hover:border-shBlue text-gray-200 px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest">
          <i className="fas fa-download mr-1"/>Download template
        </button>
        <label className={`cursor-pointer bg-shBlue text-bgHeader px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest ${busy ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"}`}
               data-testid={`${testIdPrefix}-upload-label`}>
          {busy ? <><i className="fas fa-circle-notch fa-spin mr-1"/>Importing…</> : <><i className="fas fa-upload mr-1"/>Upload CSV</>}
          <input ref={fileRef} type="file" accept=".csv,text/csv"
                 disabled={busy} onChange={onFile}
                 data-testid={`${testIdPrefix}-file`}
                 className="hidden"/>
        </label>
        {helperText && <p className="text-[11px] text-gray-500 italic">{helperText}</p>}
      </div>

      {error && (
        <p className="text-red-400 text-[12px] mt-2" data-testid={`${testIdPrefix}-error`}>
          <i className="fas fa-circle-exclamation mr-1"/>{error}
        </p>
      )}

      {result && (
        <div className="mt-3 bg-bgPanel rounded p-2 text-[12px]" data-testid={`${testIdPrefix}-result`}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-shGreen font-black">
              <i className="fas fa-circle-check mr-1"/>{result.created} created
            </span>
            <span className="text-shBlue font-black">
              <i className="fas fa-arrows-rotate mr-1"/>{result.updated} updated
            </span>
            {result.skipped_count > 0 && (
              <span className="text-shOrange font-black">
                <i className="fas fa-triangle-exclamation mr-1"/>{result.skipped_count} skipped
              </span>
            )}
          </div>
          {result.skipped_count > 0 && (
            <ul className="mt-2 list-disc list-inside text-[11px] text-gray-400 space-y-0.5 max-h-32 overflow-y-auto">
              {result.skipped.map((s, i) => (
                <li key={i}>Line {s.line}: {s.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
