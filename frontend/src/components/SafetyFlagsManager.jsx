/* Sprint 110ev — Phase 5: Safety flags manager with auto-suggest.
   Drop-in section for the dog detail card. Shows current flags + one-click
   suggestions sourced from prior incidents + intake submissions. */
import { useEffect, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

export default function SafetyFlagsManager({ dogId, compact = false }) {
  const [data, setData] = useState(null);
  const [custom, setCustom] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/dogs/${dogId}/safety-flag-suggestions`);
      setData(data);
    } catch { setData(null); }
  }, [dogId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [dogId]);

  const save = async (flags) => {
    try {
      await api.put(`/dogs/${dogId}/safety-flags`, { flags });
      toast.success("Flags saved");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const toggle = (label) => {
    if (!data) return;
    const cur = data.current_flags || [];
    const has = cur.some(f => f.toLowerCase() === label.toLowerCase());
    const next = has ? cur.filter(f => f.toLowerCase() !== label.toLowerCase()) : [...cur, label];
    save(next);
  };

  const accept = (label) => {
    if (!data) return;
    save([...(data.current_flags || []), label]);
  };

  const addCustom = () => {
    const v = custom.trim();
    if (!v) return;
    save([...(data.current_flags || []), v]);
    setCustom("");
  };

  if (!data) return null;

  return (
    <div className="mt-3 pt-3 border-t border-bgHover" data-testid={`safety-flags-${dogId}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-black uppercase tracking-widest text-gray-500">
          <i className="fas fa-shield-halved mr-1"/>Safety flags · {data.current_flags.length}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mb-2" data-testid={`current-flags-${dogId}`}>
        {data.current_flags.length === 0 && <span className="text-[12px] text-gray-500 italic">None set.</span>}
        {data.current_flags.map(f => (
          <button key={f} onClick={()=>toggle(f)} data-testid={`flag-remove-${f}`}
                  className="text-[11px] font-black uppercase tracking-widest bg-red-500/15 text-red-300 px-2 py-0.5 rounded hover:bg-red-500/25">
            <i className="fas fa-flag mr-1"/>{f}
            <i className="fas fa-times ml-1.5 opacity-60"/>
          </button>
        ))}
      </div>

      {data.suggestions.length > 0 && (
        <div className="bg-shOrange/5 border border-shOrange/30 rounded p-2 mb-2" data-testid={`suggestions-${dogId}`}>
          <p className="text-[10px] font-black uppercase tracking-widest text-shOrange mb-1">
            <i className="fas fa-lightbulb mr-1"/>Suggested ({data.suggestions.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {data.suggestions.map(s => (
              <button key={s.flag} onClick={()=>accept(s.flag)} title={s.reason}
                      data-testid={`accept-${s.flag}`}
                      className="text-[11px] font-black uppercase tracking-widest bg-shOrange/15 text-shOrange px-2 py-0.5 rounded hover:bg-shOrange/25 transition">
                + {s.flag}
              </button>
            ))}
          </div>
        </div>
      )}

      {!compact && (
        <>
          <div className="flex flex-wrap gap-1 mb-2">
            {data.library.filter(l => !data.current_flags.some(f => f.toLowerCase() === l.toLowerCase())).map(l => (
              <button key={l} onClick={()=>toggle(l)} data-testid={`lib-${l}`}
                      className="text-[10px] font-black uppercase tracking-widest bg-bgHover text-gray-400 px-2 py-0.5 rounded hover:text-white">
                + {l}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={custom} onChange={(e)=>setCustom(e.target.value)}
                   onKeyDown={(e)=>e.key==="Enter" && addCustom()}
                   placeholder="Custom flag…" data-testid={`custom-${dogId}`}
                   className="flex-1 bg-bgBase border border-bgHover rounded p-1.5 text-white text-[12px]" />
            <button onClick={addCustom} className="text-[11px] font-black uppercase tracking-widest bg-shGreen text-bgBase px-3 rounded">
              Add
            </button>
          </div>
        </>
      )}
    </div>
  );
}
