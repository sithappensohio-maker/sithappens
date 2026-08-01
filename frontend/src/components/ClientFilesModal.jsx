// Admin-side Files & Homework manager for one client. Upload PDFs / photos /
// short videos, optionally tagged to a specific dog, with a note. Listed
// below in reverse-chronological order. Each row shows file metadata, the
// note, and download/delete actions. Clients see the same files in their
// portal automatically.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";

const MAX_BYTES = 10 * 1024 * 1024;

export default function ClientFilesModal({ client, onClose }) {
  const [files, setFiles] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [dogId, setDogId] = useState("");
  const inputRef = useRef(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: f }, { data: d }] = await Promise.all([
        api.get(`/clients/${client.id}/files`),
        api.get(`/dogs?owner_id=${client.id}`),
      ]);
      setFiles(f || []);
      setDogs(d || []);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Couldn't load files");
    }
    setLoading(false);
  }, [client.id]);

  useEffect(() => { reload(); }, [reload]);

  const upload = async (file) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setErr(`File too big — max ${MAX_BYTES / (1024 * 1024)} MB.`);
      return;
    }
    setErr("");
    setUploading(true);
    try {
      const dataUri = await fileToDataUri(file);
      await api.post(`/clients/${client.id}/files`, {
        name: file.name,
        content_type: file.type || "application/octet-stream",
        data: dataUri,
        note: note.trim(),
        dog_id: dogId || null,
      });
      setNote(""); setDogId("");
      await reload();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Upload failed");
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = async (file) => {
    if (!window.confirm(`Delete "${file.name}"?`)) return;
    try {
      await api.delete(`/files/${file.id}`);
      setFiles(prev => prev.filter(f => f.id !== file.id));
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Delete failed");
    }
  };

  const download = async (file) => {
    try {
      const { data } = await api.get(`/files/${file.id}/download`);
      const blob = base64ToBlob(data.data, data.content_type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = data.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Download failed");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose} data-testid="client-files-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl my-8 shadow-2xl" onClick={(e)=>e.stopPropagation()}>
        <div className="flex justify-between items-center px-6 py-4 border-b border-shBorder sticky top-0 bg-[var(--sh-card-base)] rounded-t-2xl z-10">
          <div>
            <h3 className="text-xl font-black text-shText uppercase italic tracking-tight">
              <i className="fas fa-folder-open text-shSecondary mr-2"/>Files & Homework
            </h3>
            <p className="text-[15px] text-shTextMuted mt-0.5">Upload training homework, handouts, or videos for {client.name}.</p>
          </div>
          <button onClick={onClose} data-testid="client-files-close" className="text-shTextMuted hover:text-shText text-xl px-2"><i className="fas fa-times"/></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Upload form */}
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-4 space-y-3" data-testid="client-files-upload">
            <p className="text-[15px] font-black uppercase tracking-widest text-shSecondary">
              <i className="fas fa-upload mr-2"/>Upload a file
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[13px] font-black text-shTextMuted uppercase tracking-widest">Tag to a dog (optional)</label>
                <select value={dogId} onChange={(e)=>setDogId(e.target.value)} data-testid="files-tag-dog"
                        className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded px-2 py-1.5 text-sm text-shText">
                  <option value="">— Not specific —</option>
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[13px] font-black text-shTextMuted uppercase tracking-widest">Note (optional)</label>
                <input type="text" value={note} onChange={(e)=>setNote(e.target.value)} maxLength={500}
                       placeholder='e.g. "Week 1 homework"'
                       data-testid="files-note"
                       className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded px-2 py-1.5 text-sm text-shText"/>
              </div>
            </div>
            <label className="block">
              <span className="bg-shSecondary text-shText px-5 py-2.5 rounded font-black text-[15px] uppercase tracking-widest shadow inline-flex items-center cursor-pointer hover:bg-shSecondary/90">
                {uploading ? <><i className="fas fa-spinner fa-spin mr-2"/>Uploading…</> : <><i className="fas fa-paperclip mr-2"/>Pick a file</>}
              </span>
              <input ref={inputRef} type="file" className="hidden" disabled={uploading}
                     onChange={(e)=>upload(e.target.files?.[0])} data-testid="files-pick"/>
            </label>
            <p className="text-[13px] text-shTextMuted">Max 10 MB · PDF, images, short videos, etc.</p>
          </div>

          {err && <div className="text-[15px] font-black uppercase tracking-widest text-red-400 bg-red-500/10 rounded p-2" data-testid="files-error">{err}</div>}

          {/* File list */}
          {loading ? (
            <div className="text-center text-shTextMuted py-8 font-black uppercase tracking-widest text-sm">Loading…</div>
          ) : files.length === 0 ? (
            <div className="text-center py-8 text-shTextMuted" data-testid="client-files-empty">
              <i className="fas fa-folder-open text-3xl mb-2"/>
              <p className="text-[14px] font-black uppercase tracking-widest">No files yet</p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="client-files-list">
              {files.map(f => {
                const dog = dogs.find(d => d.id === f.dog_id);
                return (
                  <div key={f.id} className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-3 flex items-start gap-3" data-testid={`file-row-${f.id}`}>
                    <i className={`${iconFor(f.content_type)} text-shSecondary text-xl mt-0.5 shrink-0`}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-shText truncate">{f.name}</p>
                      <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest">
                        {humanSize(f.size_bytes)} · {f.uploaded_at?.slice(0,10)}
                        {dog && <span className="text-shPrimary"> · for {dog.name}</span>}
                      </p>
                      {f.note && <p className="text-[15px] text-shTextMuted italic mt-1">"{f.note}"</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={()=>download(f)} title="Download" data-testid={`file-download-${f.id}`}
                              className="text-shSecondary hover:text-shText p-2"><i className="fas fa-download"/></button>
                      <button onClick={()=>remove(f)} title="Delete" data-testid={`file-delete-${f.id}`}
                              className="text-shTextMuted hover:text-red-400 p-2"><i className="fas fa-trash"/></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: type || "application/octet-stream" });
}

function iconFor(ct) {
  if (!ct) return "fas fa-file";
  if (ct.startsWith("image/")) return "fas fa-file-image";
  if (ct.startsWith("video/")) return "fas fa-file-video";
  if (ct.startsWith("audio/")) return "fas fa-file-audio";
  if (ct.includes("pdf")) return "fas fa-file-pdf";
  if (ct.includes("word") || ct.includes("doc")) return "fas fa-file-word";
  if (ct.includes("zip") || ct.includes("compressed")) return "fas fa-file-zipper";
  return "fas fa-file";
}

function humanSize(bytes) {
  if (!bytes) return "—";
  const u = ["B","KB","MB","GB"];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
