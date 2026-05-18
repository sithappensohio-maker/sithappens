/**
 * Reusable color swatch row for any admin form that pairs with the IconPicker.
 * Curated brand-friendly palette (8 colors). Selected swatch shows a white ring.
 *
 * Props:
 *   value:     current color hex (e.g. "#8cc63f"). Empty string = unset.
 *   onChange:  (hex) => void
 *   testid?:   prefix for data-testid attributes (defaults to "color-row")
 */
export const TAG_COLORS = [
  { key: "green",  hex: "#8cc63f" },
  { key: "blue",   hex: "#00a9e0" },
  { key: "orange", hex: "#f26522" },
  { key: "purple", hex: "#a855f7" },
  { key: "pink",   hex: "#ec4899" },
  { key: "red",    hex: "#ef4444" },
  { key: "yellow", hex: "#facc15" },
  { key: "slate",  hex: "#94a3b8" },
];

export default function ColorSwatchRow({ value, onChange, testid = "color-row" }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid={testid}>
      {TAG_COLORS.map(c => (
        <button key={c.key} type="button"
                onClick={()=>onChange(c.hex)}
                title={c.key}
                data-testid={`${testid}-${c.key}`}
                className={`w-6 h-6 rounded-full border transition ${value === c.hex ? "ring-2 ring-white/70 ring-offset-2 ring-offset-bgPanel" : "border-white/20 hover:scale-110"}`}
                style={{ backgroundColor: c.hex }}/>
      ))}
    </div>
  );
}
