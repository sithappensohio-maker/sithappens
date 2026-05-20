// Tiny pill-style picker — S / M / L / XL — saves immediately and applies the
// new html font-size instantly. Used in both the admin sidebar and the client
// portal profile area so every user can dial in their own readability.

import { useTheme, TEXT_SIZE_OPTIONS } from "../lib/theme";

export function TextSizePicker({ testid = "text-size", compact = false }) {
  const ctx = useTheme();
  if (!ctx) return null;
  const { prefs, savePrefs } = ctx;
  const current = prefs?.text_size || "M";

  return (
    <div data-testid={testid} className="space-y-2">
      <p className="text-[15px] text-gray-400 font-black uppercase tracking-widest">
        <i className="fas fa-text-height mr-2 text-shGreen" />
        Text Size
      </p>
      <div className="flex gap-1.5">
        {TEXT_SIZE_OPTIONS.map(opt => {
          const active = current === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              data-testid={`${testid}-${opt.value}`}
              onClick={() => savePrefs({ text_size: opt.value })}
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
      {!compact && (
        <p className="text-[12px] text-gray-500 leading-tight">
          Adjusts everything in the app proportionally.
        </p>
      )}
    </div>
  );
}

export default TextSizePicker;
