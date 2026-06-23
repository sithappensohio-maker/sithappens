// Sprint 110ax — Dog Fact of the Day card.
//
// Same fact appears for every authenticated user (admin or client) on the
// same calendar day. Two variants: `big` (portal hero) and `chip` (admin
// dashboard / sidebar).
//
// The fact is cached in localStorage for the day so the card stays stable
// even if the API blips, and it doesn't refetch on every screen mount.

import { useEffect, useState } from "react";
import { api } from "../lib/api";

const TAG_COLORS = {
  anatomy:      "text-blue-300 bg-blue-500/15 border-blue-500/30",
  behavior:     "text-purple-300 bg-purple-500/15 border-purple-500/30",
  breed:        "text-amber-300 bg-amber-500/15 border-amber-500/30",
  health:       "text-emerald-300 bg-emerald-500/15 border-emerald-500/30",
  fun:          "text-shGreen bg-shGreen/15 border-shGreen/30",
  training:     "text-shOrange bg-shOrange/15 border-shOrange/30",
  "myth-buster":"text-pink-300 bg-pink-500/15 border-pink-500/30",
};

function tagClass(t) { return TAG_COLORS[t] || TAG_COLORS.fun; }

function todayKey() { return new Date().toISOString().slice(0, 10); }

function useDailyFact() {
  const [fact, setFact] = useState(() => {
    try {
      const raw = localStorage.getItem("dog-fact-today");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.date === todayKey()) return parsed.fact;
    } catch {}
    return null;
  });
  useEffect(() => {
    api.get("/dog-facts/today").then((r) => {
      if (r.data?.fact) {
        setFact(r.data.fact);
        try { localStorage.setItem("dog-fact-today", JSON.stringify(r.data)); } catch {}
      }
    }).catch(() => {});
  }, []);
  return fact;
}

export function DogFactCard({ variant = "big" }) {
  const fact = useDailyFact();
  if (!fact) return null;

  if (variant === "chip") {
    return (
      <div data-testid="dog-fact-chip"
           className="flex items-center gap-3 bg-bgPanel border border-bgHover rounded-xl px-4 py-3 hover:border-shGreen/30 transition card-fact">
        <div className="text-2xl shrink-0" aria-hidden>{fact.emoji || "🐶"}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black tracking-[0.18em] uppercase text-gray-500">Dog Fact · Today</p>
          <p className="text-[13px] text-gray-200 leading-snug truncate">{fact.text}</p>
        </div>
      </div>
    );
  }

  // big variant — Sprint 110di-81: slimmed to match the Training Tip card
  // (left-border accent, no oversized background glyph, compact one-line layout).
  return (
    <div data-testid="dog-fact-big"
         className="bg-bgPanel border-l-4 border-shGreen rounded-r-xl p-4 sm:p-5 shadow-md card-info">
      <div className="flex items-baseline flex-wrap gap-2 mb-1">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen">
          <span className="mr-1.5" aria-hidden>{fact.emoji || "🐶"}</span>Dog Fact of the Day
        </p>
        {fact.tag && (
          <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${tagClass(fact.tag)}`}>
            {fact.tag}
          </span>
        )}
      </div>
      <p className="text-white text-[15px] leading-relaxed">{fact.text}</p>
    </div>
  );
}
