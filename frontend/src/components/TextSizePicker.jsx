// Text-size picker — S / M / L / XL.
// • `compact=true` (default in sidebars + portal header): renders as a tiny
//   "A±" icon button that opens a popover, saving precious sidebar space.
// • `compact=false`: renders the full row of pills (used inside Settings).
//
// Both variants save instantly via the theme context.

import { useEffect, useRef, useState } from "react";
import { useTheme, TEXT_SIZE_OPTIONS } from "../lib/theme";

export function TextSizePicker({ testid = "text-size", compact = false }) {
  const ctx = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close on outside click / escape — keeps the UI clean per Sprint 104.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ctx) return null;
  const { prefs, savePrefs } = ctx;
  const current = prefs?.text_size || "M";

  const Pills = ({ inline = false }) => (
    <div className={`flex gap-1.5 ${inline ? "" : "w-full"}`}>
      {TEXT_SIZE_OPTIONS.map(opt => {
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={`${testid}-${opt.value}`}
            onClick={() => { savePrefs({ text_size: opt.value }); }}
            className={`flex-1 py-2 rounded-md text-[14px] font-black uppercase tracking-wider transition border ${
              active
                ? "bg-shGreen text-bgBase border-shGreen"
                : "bg-bgPanel text-gray-400 border-bgHover hover:border-shGreen hover:text-shGreen"
            }`}
            title={opt.label}
          >
            {opt.value}
          </button>
        );
      })}
    </div>
  );

  if (compact) {
    return (
      <div ref={wrapRef} className="relative" data-testid={testid}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          data-testid={`${testid}-trigger`}
          aria-label="Text size"
          className={`w-full flex items-center justify-center gap-2 py-2 rounded-md text-[14px] font-black uppercase tracking-widest transition border ${
            open ? "bg-shGreen/15 border-shGreen text-shGreen" : "bg-bgPanel border-bgHover text-gray-400 hover:border-shGreen hover:text-shGreen"
          }`}
        >
          <i className="fas fa-text-height" />
          <span>Text · {current}</span>
        </button>
        {open && (
          <div
            data-testid={`${testid}-popover`}
            className="absolute bottom-full left-0 right-0 mb-2 bg-bgPanel border border-bgHover rounded-lg shadow-2xl p-3 z-50 animate-slide-in"
          >
            <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mb-2">
              <i className="fas fa-text-height text-shGreen mr-1.5" />Text Size
            </p>
            <Pills />
            <button
              type="button"
              data-testid={`${testid}-close`}
              onClick={() => setOpen(false)}
              className="w-full mt-3 text-[12px] text-gray-500 hover:text-white font-black uppercase tracking-widest"
            >
              Close
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid={testid} className="space-y-2">
      <p className="text-[15px] text-gray-400 font-black uppercase tracking-widest">
        <i className="fas fa-text-height mr-2 text-shGreen" />
        Text Size
      </p>
      <Pills />
      <p className="text-[14px] text-gray-500 leading-tight">
        Adjusts everything in the app proportionally.
      </p>
    </div>
  );
}

export default TextSizePicker;
