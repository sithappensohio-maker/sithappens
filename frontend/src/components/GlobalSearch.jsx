import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export default function GlobalSearch({ open, onClose, onNavigate }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState({ clients: [], dogs: [] });
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) { setQ(""); setResults({clients:[],dogs:[]}); setActive(0); setTimeout(()=>inputRef.current?.focus(), 50); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!q.trim()) { setResults({clients:[],dogs:[]}); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/search", { params: { q } });
        setResults(data);
        setActive(0);
      } catch {}
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const flat = [...results.dogs.map(d=>({...d,kind:"dog"})), ...results.clients.map(c=>({...c,kind:"client"}))];

  const handleKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(active+1, flat.length-1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(active-1, 0)); }
    if (e.key === "Enter" && flat[active]) { e.preventDefault(); onNavigate(flat[active]); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 pt-24" onClick={onClose} data-testid="global-search">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-xl shadow-2xl animate-slide-in" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center px-4 py-3 border-b border-bgHover">
          <i className="fas fa-search text-gray-500 mr-3" />
          <input ref={inputRef} value={q} onChange={(e)=>setQ(e.target.value)} onKeyDown={handleKey} placeholder="Search dogs and clients…"
                 data-testid="search-input"
                 className="flex-1 bg-transparent text-white text-sm outline-none" />
          <kbd className="text-[9px] font-black uppercase tracking-widest text-gray-500 bg-bgBase border border-bgHover rounded px-2 py-1">ESC</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto" data-testid="search-results">
          {!q && <p className="px-6 py-10 text-center text-xs text-gray-500 uppercase font-black tracking-widest">Start typing to search.</p>}
          {q && flat.length === 0 && <p className="px-6 py-10 text-center text-xs text-gray-500 uppercase font-black tracking-widest">No matches for "{q}"</p>}
          {results.dogs.length > 0 && (
            <div>
              <p className="px-4 pt-3 pb-1 text-[9px] font-black uppercase tracking-widest text-shGreen">Dogs · {results.dogs.length}</p>
              {results.dogs.map((d, i) => {
                const idx = i;
                return (
                  <button key={d.id} onClick={()=>onNavigate({...d, kind:"dog"})}
                          onMouseEnter={()=>setActive(idx)}
                          className={`w-full text-left px-4 py-3 flex items-center justify-between ${active===idx?"bg-bgBase":""}`}>
                    <div className="flex items-center gap-3">
                      <i className="fas fa-paw text-shGreen w-5" />
                      <div>
                        <p className="text-sm font-black text-white uppercase">{d.name}</p>
                        <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">{d.breed || "Unknown"} · {d.owner_name}</p>
                      </div>
                    </div>
                    <i className="fas fa-arrow-right text-gray-600" />
                  </button>
                );
              })}
            </div>
          )}
          {results.clients.length > 0 && (
            <div>
              <p className="px-4 pt-3 pb-1 text-[9px] font-black uppercase tracking-widest text-shBlue">Clients · {results.clients.length}</p>
              {results.clients.map((c, i) => {
                const idx = results.dogs.length + i;
                return (
                  <button key={c.id} onClick={()=>onNavigate({...c, kind:"client"})}
                          onMouseEnter={()=>setActive(idx)}
                          className={`w-full text-left px-4 py-3 flex items-center justify-between ${active===idx?"bg-bgBase":""}`}>
                    <div className="flex items-center gap-3">
                      <i className="fas fa-user text-shBlue w-5" />
                      <div>
                        <p className="text-sm font-black text-white uppercase">{c.name}</p>
                        <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">{c.email || c.phone || "—"}</p>
                      </div>
                    </div>
                    <i className="fas fa-arrow-right text-gray-600" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-bgHover flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-gray-500">
          <span><kbd className="bg-bgBase border border-bgHover rounded px-1.5 py-0.5">↑</kbd> <kbd className="bg-bgBase border border-bgHover rounded px-1.5 py-0.5">↓</kbd> Navigate</span>
          <span><kbd className="bg-bgBase border border-bgHover rounded px-1.5 py-0.5">↵</kbd> Open</span>
        </div>
      </div>
    </div>
  );
}
