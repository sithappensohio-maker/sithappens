import React, { useState } from "react";

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

function ServiceTile({ svc }) {
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
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-bgHover">
        {usesCredits ? (
          <span className="text-[10px] uppercase tracking-widest font-black text-shBlue">Credit-eligible</span>
        ) : (
          <span className="text-[10px] uppercase tracking-widest font-black text-shOrange">Pay-on-the-day</span>
        )}
      </div>
    </div>
  );
}

function ProgramTile({ prog }) {
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
      {open && <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>}
    </div>
  );
}

export default function ServicesByCategory({ services = [], programs = [] }) {
  return (
    <div className="space-y-3" data-testid="services-by-category">
      {CATEGORIES.map(cat => {
        if (cat.key === "programs") {
          const items = programs.filter(p => p);
          return (
            <Section key={cat.key} cat={cat} count={items.length} defaultOpen={items.length > 0}>
              {items.map(p => <ProgramTile key={p.id} prog={p}/>)}
            </Section>
          );
        }
        const list = services.filter(s => s.service_type === cat.key);
        return (
          <Section key={cat.key} cat={cat} count={list.length} defaultOpen={true}>
            {list.map(svc => <ServiceTile key={svc.id} svc={svc}/>)}
          </Section>
        );
      })}
    </div>
  );
}
