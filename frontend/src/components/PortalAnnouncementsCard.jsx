import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import NeonEdge from "./premium/NeonEdge";
import NeonIconStage from "./premium/NeonIconStage";
import StatusBadge from "./premium/StatusBadge";
import { accentRgb } from "./premium/tokens";

/**
 * Sprint 110di-4 — Client portal Announcements card.
 *
 * Lives pinned at the very top of the portal so anything the Sit Happens team
 * posts is the first thing a client sees. Tracks read state per-client via
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

export default function PortalAnnouncementsCard({ refreshKey = 0, defaultCollapsed = false }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
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

  const latest = items[0];

  return (
    <NeonEdge accentRgb={accentRgb("cyan")} intensity="standard" className="mb-4 sm:mb-6" data-testid="portal-announcements-card">
      <button onClick={()=>setCollapsed(v=>!v)} type="button"
              data-testid="portal-announcements-toggle"
              className="relative z-10 w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-shSurfaceRaised transition">
        <div className="flex items-center gap-3 min-w-0">
          <NeonIconStage icon="fa-bullhorn" accentRgb={accentRgb("cyan")} rings={false} sizeClass="w-9 h-9" iconSizeClass="text-sm" />
          <div className="min-w-0 text-left">
            <p className="text-[15px] font-bold text-shText truncate">
              Announcements <span className="text-shTextMuted font-medium text-[13px]">({items.length})</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {unread > 0 && (
            <StatusBadge tone="warning" glow data-testid="portal-announcements-unread-badge">
              {unread} new
            </StatusBadge>
          )}
          <i className={`fas ${collapsed ? "fa-chevron-down" : "fa-chevron-up"} text-shTextMuted text-xs`}/>
        </div>
      </button>

      {collapsed && latest && (
        <button onClick={()=>setCollapsed(false)} type="button" data-testid="portal-announcements-preview"
                className="relative z-10 w-full text-left px-4 sm:px-5 pb-3 -mt-1 hover:bg-shSurfaceRaised transition">
          <p className="text-[13px] font-bold text-shText truncate">{latest.title}</p>
          {latest.body && <p className="text-[12px] text-shTextMuted truncate">{latest.body}</p>}
          <span className="text-[11px] font-black uppercase tracking-widest text-shSecondary">View All →</span>
        </button>
      )}

      {!collapsed && (
        <div className="relative z-10 border-t border-shBorder divide-y divide-shBorder max-h-96 overflow-y-auto" data-testid="portal-announcements-list">
          {items.map((a) => (
            <article key={a.id}
                     className={`px-4 sm:px-5 py-3 transition ${a.read ? "opacity-70 hover:opacity-100" : "bg-shSecondary/5"}`}
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
                  <h4 className="text-[14px] font-bold text-shText">
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
    </NeonEdge>
  );
}
