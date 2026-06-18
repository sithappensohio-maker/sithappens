import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

/**
 * Sprint 110di-4 — Client portal Announcements card.
 *
 * Lives pinned at the very top of the portal so anything the studio posts is
 * the first thing a client sees. Tracks read state per-client via
 * `POST /api/portal/announcements/{id}/read` so we can show an unread badge
 * + dim already-seen entries.
 *
 * Props:
 *   refreshKey — bump to force a reload (e.g. after admin posts something)
 */
const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return ""; }
};

export default function PortalAnnouncementsCard({ refreshKey = 0 }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/portal/announcements");
      setItems(r.data?.items || []);
      setUnread(r.data?.unread || 0);
    } catch (e) { /* swallow — non-fatal */ }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const markRead = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/portal/announcements/${id}/read`);
      setItems((arr) => arr.map(a => a.id === id ? { ...a, read: true } : a));
      setUnread((u) => Math.max(0, u - 1));
    } finally { setBusy(false); }
  };

  if (!items || items.length === 0) return null;

  return (
    <div className="mb-4 sm:mb-6 rounded-xl border border-shBlue/40 bg-gradient-to-br from-shBlue/15 via-shBlue/5 to-transparent shadow-2xl overflow-hidden"
         data-testid="portal-announcements-card">
      <button onClick={()=>setCollapsed(v=>!v)} type="button"
              data-testid="portal-announcements-toggle"
              className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-shBlue/10 transition">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-full bg-shBlue/20 border border-shBlue/50 text-shBlue flex items-center justify-center shrink-0">
            <i className="fas fa-bullhorn"/>
          </span>
          <div className="min-w-0 text-left">
            <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.3em] text-shBlue">
              From the Studio
            </p>
            <p className="text-base sm:text-lg font-black text-white uppercase italic tracking-tight truncate">
              Announcements <span className="text-gray-400 normal-case font-normal tracking-normal text-sm">({items.length})</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {unread > 0 && (
            <span className="bg-shOrange text-bgHeader text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full"
                  data-testid="portal-announcements-unread-badge">
              {unread} new
            </span>
          )}
          <i className={`fas ${collapsed ? "fa-chevron-down" : "fa-chevron-up"} text-gray-400`}/>
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-shBlue/20 divide-y divide-shBlue/15" data-testid="portal-announcements-list">
          {items.map((a) => (
            <article key={a.id}
                     className={`px-4 sm:px-5 py-4 transition ${a.read ? "opacity-70 hover:opacity-100" : "bg-shBlue/5"}`}
                     data-testid={`portal-ann-${a.id}`}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    {a.pinned && (
                      <span className="text-[9px] font-black uppercase tracking-widest text-shOrange bg-shOrange/15 border border-shOrange/30 px-1.5 py-0.5 rounded">
                        <i className="fas fa-thumbtack mr-1"/>Pinned
                      </span>
                    )}
                    {!a.read && (
                      <span className="text-[9px] font-black uppercase tracking-widest text-shGreen bg-shGreen/15 border border-shGreen/30 px-1.5 py-0.5 rounded">
                        New
                      </span>
                    )}
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                      {fmtDate(a.created_at)}{a.created_by ? ` · ${a.created_by}` : ""}
                    </p>
                  </div>
                  <h4 className="text-base sm:text-lg font-black text-white uppercase italic tracking-tight">
                    {a.title}
                  </h4>
                </div>
                {!a.read && (
                  <button onClick={()=>markRead(a.id)} disabled={busy} type="button"
                          data-testid={`portal-ann-read-${a.id}`}
                          className="shrink-0 text-[11px] font-black uppercase tracking-widest text-shGreen hover:underline disabled:opacity-50">
                    Mark read
                  </button>
                )}
              </div>
              {a.image && (
                <img src={a.image} alt={a.title}
                     className="rounded-lg border border-bgHover max-h-72 w-full object-cover my-2"/>
              )}
              {a.body && (
                <p className="text-[14px] text-gray-200 leading-relaxed whitespace-pre-wrap">{a.body}</p>
              )}
              {a.expires_on && (
                <p className="text-[11px] text-gray-500 mt-2 italic">Posted until {fmtDate(a.expires_on)}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
