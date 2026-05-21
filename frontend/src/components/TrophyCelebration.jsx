import React, { useEffect, useState } from "react";
import TrophyBadge from "./TrophyBadge";
import { api } from "../lib/api";

/**
 * Sequentially displays celebratory cards for each unseen trophy award.
 * Marks each as seen via POST /api/awarded-trophies/{id}/seen so it never
 * shows twice. Owner of the trophy doesn't matter — works for both client
 * and dog trophies.
 */
export default function TrophyCelebration({ awards = [], onAllSeen }) {
  const [queue, setQueue] = useState(awards);
  const [idx, setIdx] = useState(0);

  useEffect(() => { setQueue(awards); setIdx(0); }, [awards]);

  if (!queue.length || idx >= queue.length) return null;
  const a = queue[idx];

  const dismiss = async () => {
    try { await api.post(`/awarded-trophies/${a.id}/seen`); } catch {}
    if (idx + 1 >= queue.length) {
      onAllSeen?.();
    } else {
      setIdx(idx + 1);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur grid place-items-center p-6 animate-fade-in" data-testid="trophy-celebration">
      <div className="bg-bgPanel border border-shOrange/50 rounded-2xl w-full max-w-md p-8 shadow-2xl text-center animate-slide-in">
        <div className="text-shOrange text-[13px] font-black uppercase tracking-widest mb-2">🎉 New Trophy Earned!</div>
        <div className="flex justify-center mb-4 animate-bounce-slow">
          <TrophyBadge trophy={a} size="lg"/>
        </div>
        <h3 className="text-3xl font-black uppercase italic text-white tracking-tight">{a.trophy_name}</h3>
        <div className="text-[14px] text-gray-400 mt-1">awarded to <span className="text-shGreen font-black">{a.recipient_name}</span></div>
        {a.trophy_description && <p className="text-[14px] text-gray-300 mt-4 leading-relaxed">{a.trophy_description}</p>}
        {a.note && <p className="text-[15px] bg-bgBase rounded p-3 mt-3 italic text-gray-300"><i className="fas fa-comment-dots mr-2 text-shBlue"/>{a.note}</p>}
        <button onClick={dismiss} data-testid="trophy-celebration-dismiss"
                className="mt-6 w-full bg-shOrange text-white py-3 rounded font-black text-[15px] uppercase tracking-widest shadow-lg hover:bg-shOrange/90">
          {queue.length > 1 ? `Next (${idx + 1}/${queue.length})` : "Sweet!"}
        </button>
      </div>
    </div>
  );
}
