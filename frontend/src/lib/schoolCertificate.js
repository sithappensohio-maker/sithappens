// Online School Phase 3 — graduation certificate. Reuses the EXACT same
// mechanism PortalTrainingCard.jsx's printCertificate() already relies on
// (a client-rendered HTML page opened via Blob + window.open, auto-printed)
// rather than adding a second certificate-generation engine or touching the
// daily-tracker-gated /homework/{id}/certificate backend endpoints, which
// this feature has nothing to do with. Every field printed here comes from
// the real completion_summary the server already computed — never
// approximated.
function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); }
  catch { return ""; }
}

export function printSchoolCertificate({ dogName, programName, completionSummary }) {
  const today = new Date().toLocaleDateString();
  const completed = fmtDate(completionSummary?.completed_at) || today;
  const html = `<!doctype html><html><head><title>${escHtml(dogName)} · ${escHtml(programName)}</title>
    <style>
      @page { size: landscape; margin: 0.5in; }
      body { font-family: Georgia, serif; background:#fff; color:#0f172a; text-align:center; padding:48px 32px; }
      .frame { border: 8px double #8cc63f; padding: 48px 32px; max-width: 900px; margin: 0 auto; }
      h1 { font-size: 44px; margin: 0 0 12px 0; letter-spacing: 0.05em; }
      h2 { font-size: 22px; margin: 8px 0; color:#8cc63f; }
      .name { font-size: 56px; font-weight: 900; margin: 18px 0; color:#0f172a; }
      .program { font-size: 28px; margin: 8px 0; color:#0f172a; font-style: italic; }
      .desc { font-style: italic; font-size: 17px; margin: 14px 0; color:#475569; }
      .stats { font-size: 15px; color:#334155; margin: 10px 0; }
      .footer { display:flex; justify-content:space-between; margin-top: 40px; padding-top: 14px; border-top: 1px solid #cbd5e1; font-size:14px; color:#64748b; }
    </style></head><body>
    <div class="frame">
      <h2>Sit Happens Online School</h2>
      <h1>Certificate of Completion</h1>
      <p class="desc">This certifies that</p>
      <p class="name">${escHtml(dogName)}</p>
      <p class="desc">has successfully completed</p>
      <p class="program">${escHtml(programName)}</p>
      ${completionSummary ? `<p class="stats">${escHtml(completionSummary.total_lessons)} lessons across ${escHtml(completionSummary.total_modules)} modules${completionSummary.checkpoints_passed ? ` · ${escHtml(completionSummary.checkpoints_passed)} trainer checkpoints passed` : ""}</p>` : ""}
      <div class="footer"><span>Issued ${escHtml(today)}</span><span>Completed ${escHtml(completed)}</span></div>
    </div>
    <script>window.onload=()=>setTimeout(()=>window.print(),200);</script>
    </body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    URL.revokeObjectURL(url);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
