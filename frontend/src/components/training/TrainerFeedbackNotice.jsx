// Client-safe trainer reply/review notice. Data semantics unchanged.
export default function TrainerFeedbackNotice({ text, tone = "primary", label = "Trainer's note", testid }) {
  if (!text) return null;
  const toneCls = {
    primary: "border-shPrimary/30 bg-gradient-to-br from-shPrimary/[0.08] to-black/20 text-shPrimary",
    danger: "border-red-500/35 bg-red-500/[0.06] text-red-300",
    secondary: "border-shSecondary/30 bg-gradient-to-br from-shSecondary/[0.08] to-black/20 text-shSecondary",
  }[tone] || "border-shPrimary/30 bg-shPrimary/5 text-shPrimary";
  return (
    <div className={`relative overflow-hidden border rounded-2xl p-4 ${toneCls}`} data-testid={testid}>
      <div className="absolute -right-8 -top-8 w-24 h-24 rounded-full bg-current opacity-[0.04] blur-2xl"/>
      <p className="relative text-[13px] font-black uppercase tracking-[0.14em]"><i className="fas fa-comment-dots mr-1.5"/>{label}</p>
      <p className="relative text-[17px] text-shText mt-2 leading-relaxed">“{text}”</p>
    </div>
  );
}
