// School redesign — shared client-visible / staff-only badge so every note
// surface says unmistakably who will read it. Never a color-only signal.
export default function VisibilityBadge({ staffOnly = false, testid }) {
  return staffOnly ? (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-shAccent/45 bg-shAccent/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-shAccent" data-testid={testid}>
      <i className="fas fa-lock text-[9px]"/>Staff only
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-shPrimary/40 bg-shPrimary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-shPrimary" data-testid={testid}>
      <i className="fas fa-eye text-[9px]"/>Visible to client
    </span>
  );
}
