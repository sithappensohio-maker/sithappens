import React, { useState } from "react";
import { api } from "../lib/api";

/**
 * Render services + training programs grouped by category, in a clean
 * collapsible layout. Used on the client portal so prospects can see
 * exactly what we offer with pricing.
 */
const CATEGORIES = [
  { key: "daycare", label: "Daycare", icon: "fa-sun", color: "#00a9e0" },
  { key: "boarding", label: "Boarding", icon: "fa-moon", color: "#8cc63f" },
  { key: "training", label: "Training", icon: "fa-graduation-cap", color: "#a855f7" },
  { key: "grooming", label: "Grooming", icon: "fa-bath", color: "#06b6d4" },
  { key: "photography", label: "Photography", icon: "fa-camera-retro", color: "#f97316" },
  { key: "other", label: "Other Services", icon: "fa-tag", color: "#94a3b8" },
  { key: "programs", label: "Training Programs", icon: "fa-list-check", color: "#a855f7" },
];

function ServiceTile({ svc, onRequestQuote }) {
  const usesCredits = svc.service_type === "daycare" || svc.service_type === "training" || svc.service_type === "boarding";
  return (
    <div data-testid={`portal-service-${svc.id}`}
         className="bg-bgBase rounded-lg p-4 border border-bgHover hover:border-shGreen/40 transition flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-[14px] font-black text-white uppercase italic tracking-tight flex items-center gap-2">
          <i className={`fas ${svc.icon || "fa-tag"}`} style={{ color: svc.color || undefined }}/>
          {svc.name}
        </h3>
        <span className="text-shGreen font-black text-[15px] whitespace-nowrap">${Number(svc.base_price || 0).toFixed(2)}</span>
      </div>
      {svc.description && <p className="text-[12px] text-gray-300 leading-relaxed flex-1">{svc.description}</p>}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-bgHover flex-wrap">
        {usesCredits ? (
          <span className="text-[10px] uppercase tracking-widest font-black text-shBlue">Credit-eligible</span>
        ) : (
          <span className="text-[10px] uppercase tracking-widest font-black text-shOrange">Pay-on-the-day</span>
        )}
        <button
          type="button"
          onClick={()=>onRequestQuote({ kind: "service", id: svc.id, name: svc.name, price: svc.base_price })}
          data-testid={`portal-request-quote-${svc.id}`}
          className="ml-auto text-[10px] uppercase tracking-widest font-black text-shGreen hover:text-white border border-shGreen/40 hover:border-shGreen rounded px-2 py-1 transition"
        >
          <i className="fas fa-envelope mr-1"/>Request Info
        </button>
      </div>
    </div>
  );
}

function ProgramTile({ prog, onRequestQuote }) {
  const fmt = prog.format || {};
  return (
    <div data-testid={`portal-program-${prog.id}`}
         className="bg-gradient-to-br from-purple-500/10 to-bgBase rounded-lg p-4 border border-purple-500/30 hover:border-purple-400/60 transition flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-[14px] font-black text-white uppercase italic tracking-tight flex items-center gap-2">
          <i className="fas fa-graduation-cap text-purple-400"/>
          {prog.name}
        </h3>
        <span className="text-shGreen font-black text-[15px] whitespace-nowrap">
          {Number(prog.price || 0) > 0 ? `$${Number(prog.price).toFixed(2)}` : "Contact"}
        </span>
      </div>
      {(prog.focus || prog.description) && (
        <p className="text-[12px] text-gray-300 leading-relaxed flex-1">{prog.focus || prog.description}</p>
      )}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-bgHover flex-wrap">
        <span className="text-[10px] uppercase tracking-widest font-black px-2 py-0.5 rounded bg-purple-500/15 text-purple-300">{(prog.type || "").replace("_", " ")}</span>
        {fmt.count > 0 && <span className="text-[10px] uppercase tracking-widest font-black text-gray-400">{fmt.count} {fmt.unit || "sessions"}</span>}
        {prog.min_age_months > 0 && <span className="text-[10px] uppercase tracking-widest font-black text-gray-500">{prog.min_age_months}+ mo</span>}
        <button
          type="button"
          onClick={()=>onRequestQuote({ kind: "program", id: prog.id, name: prog.name, price: prog.price })}
          data-testid={`portal-request-quote-prog-${prog.id}`}
          className="ml-auto text-[10px] uppercase tracking-widest font-black text-purple-300 hover:text-white border border-purple-400/40 hover:border-purple-400 rounded px-2 py-1 transition"
        >
          <i className="fas fa-envelope mr-1"/>Request Info
        </button>
      </div>
    </div>
  );
}

function QuoteRequestModal({ item, onClose, onSent }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await api.post("/portal/quote-request", { kind: item.kind, item_id: item.id, message: msg });
      setSent(true);
      onSent?.();
      setTimeout(onClose, 1800);
    } catch (e) {
      setErr(e.response?.data?.detail || "Couldn't send request. Try again?");
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur grid place-items-center p-4" onClick={onClose} data-testid="quote-request-modal">
      <div onClick={(e)=>e.stopPropagation()} className="bg-bgPanel border border-shGreen/40 rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-black uppercase italic text-white"><i className="fas fa-envelope text-shGreen mr-2"/>Request Info</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><i className="fas fa-times text-lg"/></button>
        </div>
        {sent ? (
          <div className="bg-shGreen/10 border border-shGreen/40 rounded p-4 text-center">
            <i className="fas fa-check-circle text-shGreen text-3xl mb-2"/>
            <p className="text-white font-black uppercase tracking-widest text-sm">Sent — we'll be in touch!</p>
          </div>
        ) : (
          <>
            <div className="bg-bgBase rounded p-3 mb-4">
              <p className="text-[11px] uppercase tracking-widest text-gray-500 font-black">{item.kind === "program" ? "Program" : "Service"}</p>
              <p className="text-white font-black text-lg mt-0.5">{item.name}</p>
              {Number(item.price || 0) > 0 && <p className="text-shGreen font-black text-sm mt-1">${Number(item.price).toFixed(2)}</p>}
            </div>
            <label className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Your question (optional)</label>
            <textarea
              value={msg}
              onChange={(e)=>setMsg(e.target.value)}
              rows={4}
              placeholder="e.g. Is my pup old enough? Any current openings?"
              data-testid="quote-request-message"
              maxLength={500}
              className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shGreen outline-none resize-none"
            />
            <p className="text-[11px] text-gray-500 mt-1">{msg.length}/500 — we already have your email & phone on file.</p>
            {err && <div className="bg-red-500/10 text-red-400 rounded p-2 text-sm mt-3">{err}</div>}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={onClose} className="text-gray-400 hover:text-white text-[13px] font-black uppercase tracking-widest">Cancel</button>
              <button onClick={submit} disabled={busy} data-testid="quote-request-submit"
                      className="bg-shGreen text-bgHeader px-7 py-2.5 rounded font-black text-[14px] uppercase tracking-widest shadow-lg hover:bg-shGreen/90 disabled:opacity-50">
                {busy ? "Sending…" : "Send Request"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ cat, count, children, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!count) return null;
  return (
    <div className="bg-bgBase/40 border border-bgHover rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={()=>setOpen(o=>!o)}
        data-testid={`portal-category-${cat.key}`}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-bgHover/30 transition"
        style={{ background: `linear-gradient(90deg, ${cat.color}1f, transparent 65%)` }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <i className={`fas ${cat.icon} text-lg`} style={{ color: cat.color }}/>
          <span className="text-[13px] font-black uppercase italic tracking-tight text-white truncate">{cat.label}</span>
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">· {count}</span>
        </div>
        <i className={`fas ${open ? "fa-chevron-up" : "fa-chevron-down"} text-gray-500`}/>
      </button>
      {open && <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>}
    </div>
  );
}

export default function ServicesByCategory({ services = [], programs = [] }) {
  const [quoteItem, setQuoteItem] = useState(null);
  return (
    <div className="space-y-3" data-testid="services-by-category">
      {CATEGORIES.map(cat => {
        if (cat.key === "programs") {
          const items = programs.filter(p => p);
          return (
            <Section key={cat.key} cat={cat} count={items.length} defaultOpen={items.length > 0}>
              {items.map(p => <ProgramTile key={p.id} prog={p} onRequestQuote={setQuoteItem}/>)}
            </Section>
          );
        }
        const list = services.filter(s => s.service_type === cat.key);
        return (
          <Section key={cat.key} cat={cat} count={list.length} defaultOpen={true}>
            {list.map(svc => <ServiceTile key={svc.id} svc={svc} onRequestQuote={setQuoteItem}/>)}
          </Section>
        );
      })}
      {quoteItem && <QuoteRequestModal item={quoteItem} onClose={()=>setQuoteItem(null)}/>}
    </div>
  );
}
