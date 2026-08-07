// Training UI Phase 1 — shared metric/status chip. Reused by the Training
// Session Workspace header row and (later phases) the trainer dashboard and
// client progress screens. Color is carried by both an icon/text pairing —
// never color alone — per the brief's accessibility requirement.
const TONE = {
  primary:   "bg-shPrimary/10 border-shPrimary/30 text-shPrimary",
  secondary: "bg-shSecondary/10 border-shSecondary/30 text-shSecondary",
  accent:    "bg-shAccent/10 border-shAccent/30 text-shAccent",
  purple:    "bg-purple-500/10 border-purple-400/30 text-purple-300",
  danger:    "bg-red-500/10 border-red-500/30 text-red-300",
  muted:     "bg-shBorder/20 border-shBorder text-shTextMuted",
};

export default function StatusChip({ icon, label, value, tone = "muted", testid }) {
  const cls = TONE[tone] || TONE.muted;
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${cls}`} data-testid={testid}>
      {icon && <i className={`fas ${icon} text-[14px] shrink-0`}/>}
      <div className="min-w-0">
        {value != null && value !== "" && (
          <p className="text-[14px] font-black leading-tight truncate">{value}</p>
        )}
        <p className="text-[10px] font-black uppercase tracking-widest opacity-80 truncate">{label}</p>
      </div>
    </div>
  );
}
