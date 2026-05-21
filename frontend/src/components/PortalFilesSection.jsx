// Client portal — shows files the admin uploaded for them. Lists ALL files
// grouped: dog-specific files first (grouped by dog), then general files.
// Click any row → downloads the file. Auto-hides when there's nothing to show.

import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function PortalFilesSection({ dogs }) {
  const [files, setFiles] = useState(null);

  useEffect(() => {
    api.get("/portal/files")
      .then(({ data }) => setFiles(data || []))
      .catch(() => setFiles([]));
  }, []);

  if (!files || files.length === 0) return null;

  const dogById = Object.fromEntries((dogs || []).map(d => [d.id, d]));
  const groups = {};
  for (const f of files) {
    const key = f.dog_id && dogById[f.dog_id] ? f.dog_id : "_general";
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }
  // Order: general first if any, then dogs in their existing order
  const orderedKeys = [
    ...(groups._general ? ["_general"] : []),
    ...(dogs || []).filter(d => groups[d.id]).map(d => d.id),
  ];

  const download = async (file) => {
    try {
      const { data } = await api.get(`/files/${file.id}/download`);
      const blob = b64ToBlob(data.data, data.content_type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = data.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { /* shrug */ }
  };

  return (
    <div data-testid="portal-files-section">
      <h2 className="text-xl font-black text-white uppercase italic tracking-tight mb-4">
        <i className="fas fa-folder-open text-shBlue mr-2"/>Training Files & Homework
      </h2>
      <div className="space-y-4">
        {orderedKeys.map(key => {
          const list = groups[key];
          const dog = key === "_general" ? null : dogById[key];
          return (
            <div key={key} className="bg-bgPanel rounded-xl border border-bgHover shadow-lg p-4">
              <p className="text-[13px] font-black uppercase tracking-widest text-shBlue mb-2">
                {dog ? <><i className="fas fa-paw mr-2"/>For {dog.name}</> : <><i className="fas fa-house mr-2"/>General</>}
              </p>
              <div className="space-y-2">
                {list.map(f => (
                  <button key={f.id} onClick={()=>download(f)}
                          data-testid={`portal-file-${f.id}`}
                          className="w-full text-left bg-bgBase border border-bgHover rounded-lg p-3 flex items-start gap-3 transition hover:border-shBlue/50 hover:bg-bgBase/80">
                    <i className={`${iconFor(f.content_type)} text-shBlue text-xl mt-0.5 shrink-0`}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-white truncate">{f.name}</p>
                      <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">
                        {humanSize(f.size_bytes)} · {f.uploaded_at?.slice(0,10)}
                      </p>
                      {f.note && <p className="text-[13px] text-gray-300 italic mt-1">"{f.note}"</p>}
                    </div>
                    <i className="fas fa-download text-shBlue mt-1 shrink-0"/>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function b64ToBlob(b64, type) {
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
