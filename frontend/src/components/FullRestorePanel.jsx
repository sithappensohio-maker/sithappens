import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";

// Settings → Backup & Restore → Restore from Backup.
//
// A full restore runs on the server as a job. A real business backup is far
// bigger than one request may be (nginx 25 MB; the Cloudflare tunnel 100 MB
// and 100 seconds), so a file from this computer goes up in pieces first, and
// backups already on the server restore by name — nothing large crosses the
// internet. Backend: domains/backup/restore_jobs.py.

const PREVIEW_LIMIT = 20 * 1024 * 1024;
// The last restore whose outcome this browser has shown, so a restore that
// finished (or failed) while the owner was away is reported once on return.
const SEEN_KEY = "sh_restore_seen_job";
const seenJob = () => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const markSeen = (id) => { try { localStorage.setItem(SEEN_KEY, id); } catch { /* private window */ } };
const KIND_LABEL = { auto: "Nightly backup", snapshot: "Safety snapshot", uploaded: "Uploaded" };
const PHASE_LABEL = {
  queued: "Starting…",
  reading: "Reading the backup…",
  snapshot: "Saving a safety snapshot of your current data…",
  restoring: "Restoring…",
};

function jobMessage(j) {
  if (j.status === "done") {
    const summary = Object.entries(j.summary || {}).map(([k, v]) => `${k}: ${v.inserted ?? v.upserted}${v.kept_live ? ` (${v.kept_live} kept as-is)` : ""}${v.live_rows_kept ? ` (${v.live_rows_kept} already live, money and status kept)` : ""}`).join(" · ");
    // Merge keeps a live record when a newer one already holds the same key
    // (the same booking's invoice, the same sale key) — say so.
    const keptNote = j.kept_live ? ` ${j.kept_live} backed-up record(s) were kept as they are now, because a newer record already uses the same key.` : "";
    const snap = j.pre_restore_snapshot;
    const snapNote = snap?.ok ? ` Pre-restore snapshot: ${snap.filename}.` : "";
    return `Restored ✓ ${summary}.${keptNote}${snapNote}`;
  }
  if (j.stalled) return "Restore stopped responding — the server may have restarted. Check your data, then run the restore again in about 20 minutes.";
  return `Restore failed: ${j.error || "unknown error"}`;
}

export default function FullRestorePanel() {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreMode, setRestoreMode] = useState("merge");
  const [restorePreview, setRestorePreview] = useState(null);
  const [uploadPct, setUploadPct] = useState(null);
  const [job, setJob] = useState(null);
  const [serverFiles, setServerFiles] = useState([]);
  const pollRef = useRef(null);

  const loadServerFiles = useCallback(async () => {
    try {
      const { data } = await api.get("/backup/files");
      setServerFiles(data?.files || []);
    } catch { setServerFiles([]); }
  }, []);

  const watchJob = useCallback((id) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/backup/restore-jobs/${id}`);
        setJob(data);
        if (data.status !== "running" || data.stalled) {
          clearInterval(pollRef.current); pollRef.current = null;
          setBusy(false); setMsg(jobMessage(data)); markSeen(data.id); loadServerFiles();
        }
      } catch { /* keep watching — the server may be busy mid-restore */ }
    }, 2000);
  }, [loadServerFiles]);

  // Pick a running restore back up (a reload, another tab, coming back
  // later) — or report how the last one ended if this browser hasn't yet.
  useEffect(() => {
    let gone = false;
    loadServerFiles();
    (async () => {
      try {
        const { data } = await api.get("/backup/restore-jobs", { params: { limit: 1 } });
        const last = Array.isArray(data) ? data[0] : null;
        if (gone || !last) return;
        if (last.status === "running" && !last.stalled) { setJob(last); setBusy(true); watchJob(last.id); }
        else if (last.id !== seenJob()) { setJob(last); setMsg(jobMessage(last)); markSeen(last.id); }
      } catch { /* nothing yet, or not the owner */ }
    })();
    return () => { gone = true; clearInterval(pollRef.current); };
  }, [loadServerFiles, watchJob]);

  const onPickFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setRestoreFile(f); setRestorePreview(null); setMsg("");
    if (f.size > PREVIEW_LIMIT || /\.gz$/i.test(f.name)) {
      // Too big (or compressed) to open here — the server checks it after upload.
      setRestorePreview({ large: true, sizeMb: (f.size / (1024 * 1024)).toFixed(1) });
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        if (!parsed.version || !parsed.collections) throw new Error("Not a valid Sit Happens backup");
        const counts = {};
        Object.entries(parsed.collections).forEach(([k, v]) => counts[k] = (v || []).length);
        setRestorePreview({ version: parsed.version, exportedAt: parsed.exported_at, counts });
      } catch (err) { setMsg(`Invalid file: ${err.message}`); setRestoreFile(null); }
    };
    r.readAsText(f);
  };

  // Pieces go up one at a time; each is its own file on the server, so a
  // piece re-sent after a dropped connection simply replaces itself.
  const uploadBackup = async (file) => {
    const { data: start } = await api.post("/backup/uploads", { filename: file.name, size_bytes: file.size });
    const step = start.chunk_bytes;
    try {
      return await sendPieces(file, start, step);
    } catch (e) {
      api.delete(`/backup/uploads/${start.upload_id}`).catch(() => {});  // drop the partial pieces
      throw e;
    }
  };

  const sendPieces = async (file, start, step) => {
    for (let off = 0; off < file.size; off += step) {
      const piece = file.slice(off, Math.min(off + step, file.size));
      for (let tries = 1; ; tries += 1) {
        try {
          await api.put(`/backup/uploads/${start.upload_id}/chunks/${off}`, piece, { headers: { "Content-Type": "application/octet-stream" } });
          break;
        } catch (e) {
          const status = e.response?.status;
          if (tries >= 4 || (status && status < 500 && status !== 408 && status !== 429)) throw e;
          await new Promise((r) => setTimeout(r, 1000 * tries));
        }
      }
      setUploadPct(Math.round((Math.min(off + step, file.size) / file.size) * 100));
    }
    const { data } = await api.post(`/backup/uploads/${start.upload_id}/finish`);
    return data;
  };

  const startRestore = async (name, totalDocs, label) => {
    const verb = restoreMode === "replace" ? "REPLACE all current data with" : "merge into your current data (keeping current money and booking status)";
    const count = totalDocs != null ? `${totalDocs} records` : "the records";
    if (!(await confirm({ title: restoreMode === "replace" ? "Replace ALL data?" : "Merge into current data?", body: `This will ${verb} ${count} from ${label}.\n\nA safety snapshot of your CURRENT state will be auto-saved to /app/backups/ before anything is touched — you can roll back from there if needed.`, confirmText: restoreMode === "replace" ? "Yes, replace everything" : "Yes, merge", tone: "danger" }))) return;
    setBusy(true); setMsg("");
    try {
      const { data } = await api.post("/backup/restore-jobs", { name, mode: restoreMode });
      setJob(data); setRestoreFile(null); setRestorePreview(null);
      watchJob(data.id);
    } catch (e) { setBusy(false); setMsg(`Restore failed: ${formatErr(e.response?.data?.detail) || e.message}`); }
  };

  const doRestore = async () => {
    if (!restoreFile || !restorePreview) return;
    setBusy(true); setMsg(""); setUploadPct(0);
    let info;
    try {
      info = await uploadBackup(restoreFile);
    } catch (e) {
      setUploadPct(null); setBusy(false);
      setMsg(`Upload failed: ${formatErr(e.response?.data?.detail) || e.message}`);
      return;
    }
    // The file is on the server now: restoring (or retrying after a cancel or
    // a "backup running" refusal) uses that copy from the list below.
    const label = restoreFile.name;
    setUploadPct(null); setBusy(false); setRestoreFile(null); setRestorePreview(null);
    setMsg(`Uploaded ✓ ${label} is in "Backups on this server" below.`);
    loadServerFiles();
    await startRestore(info.name, info.total_docs, label);
  };

  const downloadServerFile = async (f) => {
    setBusy(true); setMsg("");
    try {
      const resp = await api.get("/backup/files/download", { params: { name: f.name }, responseType: "blob" });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url; a.download = f.name.split("/").pop();
      a.click();
      URL.revokeObjectURL(url);
      setMsg("Backup downloaded ✓");
    } catch { setMsg("Download failed"); }
    setBusy(false);
  };

  const deleteServerFile = async (f) => {
    if (!(await confirm({ title: "Delete uploaded backup?", body: `${f.name} will be removed from the server.`, confirmText: "Delete", tone: "danger" }))) return;
    try { await api.delete("/backup/files", { params: { name: f.name } }); loadServerFiles(); }
    catch (e) { setMsg(`Delete failed: ${formatErr(e.response?.data?.detail) || e.message}`); }
  };

  const running = job?.status === "running" && !job?.stalled;
  const jobPct = Math.round(((job?.collections_done || 0) / Math.max(1, job?.collections_total || 1)) * 100);

  return (
    <div className="border-t border-shBorder pt-6" data-testid="full-restore-panel">
      <h4 className="text-sm font-black text-shAccent uppercase tracking-widest mb-2"><i className="fas fa-upload mr-2"/>Restore from Backup</h4>
      <p className="text-[14px] text-shTextMuted mb-3 leading-relaxed">
        Upload a previously-downloaded backup file (.json or .json.gz, any size — it goes up in pieces), or restore one already on the server below. <span className="text-shAccent font-black">Always download a fresh backup before restoring</span> in case you need to revert.
      </p>

      <div className="space-y-3">
        <label className="block">
          <span className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Backup file</span>
          <input type="file" accept=".json,.gz,application/json,application/gzip" onChange={onPickFile} data-testid="backup-file"
                 className="block mt-1 w-full text-sm text-shTextMuted file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-[var(--sh-card-base)] file:text-shSecondary file:font-black file:uppercase file:text-[14px] file:tracking-widest hover:file:bg-shSurfaceRaised cursor-pointer" />
        </label>

        {restorePreview?.large && (
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded p-3 text-[14px] text-shTextMuted" data-testid="backup-preview">
            <i className="fas fa-file-zipper mr-2 text-shSecondary"/>{restorePreview.sizeMb} MB — uploaded in pieces and checked on the server; you'll see what it holds before anything is restored.
          </div>
        )}
        {restorePreview && !restorePreview.large && (
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded p-3 space-y-2" data-testid="backup-preview">
            <p className="text-[14px] font-black text-shSecondary uppercase tracking-widest">Backup preview</p>
            <p className="text-[14px] text-shTextMuted">Exported {restorePreview.exportedAt?.slice(0,19).replace("T", " ")}</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[14px]">
              {Object.entries(restorePreview.counts).map(([k,v]) => (
                <div key={k} className="bg-[var(--sh-card-base)] rounded px-2 py-1 flex justify-between">
                  <span className="text-shTextMuted uppercase font-black tracking-widest">{k}</span>
                  <span className="text-shText font-black">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <span className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Restore mode</span>
          <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className={`cursor-pointer rounded p-3 border ${restoreMode==="merge"?"bg-shSecondary/10 border-shSecondary/50":"bg-[var(--sh-card-base)] border-shBorder"}`}>
              <input type="radio" name="mode" checked={restoreMode==="merge"} disabled={busy} onChange={()=>setRestoreMode("merge")} className="mr-2 accent-shSecondary" data-testid="mode-merge" />
              <span className="text-sm font-black text-shText uppercase tracking-tight">Merge (safer)</span>
              <p className="text-[14px] text-shTextMuted mt-1">Adds and updates by ID. Money, credits, payments and booking status already in the app are kept as they are now, so an older backup cannot undo them. Anything not in the backup stays untouched.</p>
            </label>
            <label className={`cursor-pointer rounded p-3 border ${restoreMode==="replace"?"bg-red-500/10 border-red-500/50":"bg-[var(--sh-card-base)] border-shBorder"}`}>
              <input type="radio" name="mode" checked={restoreMode==="replace"} disabled={busy} onChange={()=>setRestoreMode("replace")} className="mr-2 accent-red-500" data-testid="mode-replace" />
              <span className="text-sm font-black text-shText uppercase tracking-tight">Replace (wipes current)</span>
              <p className="text-[14px] text-shTextMuted mt-1">Deletes all current data and restores exactly what's in the backup.</p>
            </label>
          </div>
        </div>

        <button onClick={doRestore} disabled={busy || !restorePreview} data-testid="backup-restore"
                className={`px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50 ${restoreMode==="replace"?"bg-red-500 text-shText":"bg-shSecondary text-shText"}`}>
          <i className="fas fa-upload mr-2"/>{busy ? "Restoring…" : `Restore (${restoreMode})`}
        </button>

        {(uploadPct != null || running) && (
          <div className="bg-[var(--sh-card-base)] border border-shSecondary/40 rounded p-3 space-y-2" data-testid="restore-progress">
            <p className="text-[14px] font-black text-shSecondary uppercase tracking-widest">
              {uploadPct != null ? `Uploading… ${uploadPct}%` : (PHASE_LABEL[job.phase] || "Restoring…")}
            </p>
            {uploadPct == null && job?.current && (
              <p className="text-[13px] text-shTextMuted">{job.current} · {job.collections_done || 0} of {job.collections_total || "?"} collections{job.current_docs_done ? ` · ${job.current_docs_done} records` : ""}</p>
            )}
            <div className="h-2 rounded bg-bgBase overflow-hidden">
              <div className="h-full bg-shSecondary transition-all" style={{ width: `${uploadPct != null ? uploadPct : jobPct}%` }}/>
            </div>
            <p className="text-[12px] text-shTextMuted">You can leave this page — the restore keeps going on the server, and this panel picks it back up.</p>
          </div>
        )}

        {msg && (
          <div className={`text-[14px] font-black uppercase tracking-widest p-3 rounded ${msg.includes("✓") ? "bg-shPrimary/15 text-shPrimary" : "bg-red-500/15 text-red-400"}`} data-testid="restore-msg">
            {msg}
          </div>
        )}

        <div className="pt-2" data-testid="server-backups">
          <span className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Backups on this server</span>
          <p className="text-[13px] text-shTextMuted mt-1 mb-2">Nightly backups, safety snapshots and uploaded files. Restoring one sends nothing over the internet, so size doesn't matter. Uses the restore mode above.</p>
          {serverFiles.length === 0 ? (
            <p className="text-[13px] text-shTextMuted italic">None yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {serverFiles.map((f) => (
                <div key={f.name} className="flex flex-wrap items-center justify-between gap-2 bg-[var(--sh-card-base)] border border-shBorder rounded px-3 py-2" data-testid={`server-backup-${f.name}`}>
                  <div className="min-w-0">
                    <p className="text-[13px] font-black text-shText truncate">{KIND_LABEL[f.kind] || f.kind} · {(f.modified_at || "").slice(0, 16).replace("T", " ")}</p>
                    <p className="text-[12px] text-shTextMuted truncate">{f.name} · {(f.size_bytes / (1024 * 1024)).toFixed(1)} MB{f.total_docs != null ? ` · ${f.total_docs} records` : ""}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => downloadServerFile(f)} disabled={busy} className="px-2.5 py-1.5 rounded border border-shBorder text-[12px] font-black uppercase tracking-wider text-shTextMuted hover:text-shText disabled:opacity-50">Download</button>
                    <button onClick={() => startRestore(f.name, f.total_docs, f.name)} disabled={busy} data-testid={`server-backup-restore-${f.name}`}
                            className={`px-2.5 py-1.5 rounded text-[12px] font-black uppercase tracking-wider disabled:opacity-50 ${restoreMode === "replace" ? "bg-red-500 text-shText" : "bg-shSecondary text-shText"}`}>Restore</button>
                    {f.kind === "uploaded" && (
                      <button onClick={() => deleteServerFile(f)} disabled={busy} data-testid={`server-backup-delete-${f.name}`} className="px-2.5 py-1.5 rounded border border-red-500/40 text-[12px] font-black uppercase tracking-wider text-red-400 disabled:opacity-50">Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
