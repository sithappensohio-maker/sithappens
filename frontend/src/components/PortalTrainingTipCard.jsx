// Sprint 110di-79 — Client-portal Training Tip of the Day.
// Mirrors the Training Hub tip card but uses the client-scoped endpoint
// (filters out internal/staff-only tips). Silent-on-empty so a fresh
// install without any client-facing tips just shows nothing.
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function PortalTrainingTipCard() {
  const [tip, setTip] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get("/me/training-tip/today")
      .then(r => { if (alive) setTip(r.data?.tip || null); })
      .catch(() => { if (alive) setTip(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading || !tip) return null;

  return (
    <div data-testid="portal-training-tip-card"
         className="bg-bgPanel border-l-4 border-shGreen rounded-r-xl p-4 sm:p-5 shadow-md card-info">
      <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen mb-1">
        <i className="fas fa-lightbulb mr-1.5"/>Training tip of the day
        {tip.category ? ` · ${tip.category.replace(/_/g, " ")}` : ""}
      </p>
      <p className="text-white text-[15px] leading-relaxed">{tip.tip}</p>
      {tip.source && (
        <p className="text-gray-500 text-[11px] mt-1">— {tip.source}</p>
      )}
    </div>
  );
}
