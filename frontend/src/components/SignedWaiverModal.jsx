/* The waiver a client actually signed — not a fresh copy of today's waiver.
 *
 * This matters more than it looks. `settings.waiver_text` changes when the
 * business updates its terms, so rendering that would quietly show someone a
 * document they never agreed to, with their name on it. Signing stores
 * `waiver_text_snapshot` — the exact text as it stood at that moment — along
 * with the version, the typed signature and the timestamp, and that snapshot
 * is what is displayed and printed here.
 *
 * The data already travels: GET /waivers/me returns the whole signature row.
 * No new endpoint, and nothing is regenerated.
 *
 * If a signature predates snapshotting and has no stored text, we say so
 * plainly rather than substituting the current waiver — a document that
 * misrepresents what was agreed is worse than no document.
 */
import { useMemo } from "react";

function humanDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** Same **bold** handling the signing modal uses, so the document a client
 *  reads back looks like the one they signed rather than raw markdown. */
function renderText(text) {
  return String(text || "").split(/\n\n+/).map((para, idx) => (
    <p key={idx} className="mb-3 text-[13px] text-shTextMuted leading-relaxed">
      {para.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i} className="text-shPrimary block mt-1 mb-1 text-[14px] uppercase tracking-widest font-bold">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </p>
  ));
}

/** Markdown stripped for the printable copy, which has no styling to carry it. */
function plainText(text) {
  return String(text || "").replace(/\*\*([^*]+)\*\*/g, "$1");
}

export default function SignedWaiverModal({ signature, onClose }) {
  const snapshot = signature?.waiver_text_snapshot || "";
  const hasSnapshot = snapshot.trim().length > 0;

  const printableHtml = useMemo(() => {
    if (!hasSnapshot) return "";
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    return `<!doctype html><html><head><meta charset="utf-8">
<title>Sit Happens — signed waiver</title>
<style>
 body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:46em;margin:2em auto;padding:0 1em;color:#111}
 h1{font-size:1.3em;margin:0 0 .2em} .meta{color:#555;font-size:.85em;margin-bottom:1.5em}
 .terms{white-space:pre-wrap} .sig{margin-top:2em;border-top:1px solid #ccc;padding-top:1em}
 .sig .name{font-family:Georgia,serif;font-style:italic;font-size:1.3em}
</style></head><body>
<h1>Sit Happens Dog Training — Client Waiver</h1>
<div class="meta">Version ${esc(signature?.waiver_version ?? "1")}
 &middot; Signed ${esc(humanDateTime(signature?.signed_at))}</div>
<div class="terms">${esc(plainText(snapshot))}</div>
<div class="sig">
 <div>Signed electronically by</div>
 <div class="name">${esc(signature?.typed_name || signature?.client_name || "")}</div>
 ${signature?.dog_names ? `<div>For: ${esc(signature.dog_names)}</div>` : ""}
 <div>${esc(humanDateTime(signature?.signed_at))}</div>
</div></body></html>`;
  }, [hasSnapshot, snapshot, signature]);

  const print = () => {
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) return;
    w.document.write(printableHtml);
    w.document.close();
    w.focus();
  };

  const download = () => {
    const blob = new Blob([printableHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sit-happens-waiver-v${signature?.waiver_version ?? 1}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="fixed inset-0 bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 z-[110] overflow-y-auto"
         role="dialog" aria-modal="true" aria-label="Your signed waiver"
         data-testid="signed-waiver-modal">
      <div className="sh-modal-surface border border-shBorder w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl p-5 sm:p-7 shadow-sh my-0 sm:my-8"
           style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-black text-shText tracking-tight">Your signed waiver</h3>
            <p className="text-[12px] text-shTextMuted mt-1 break-words">
              Version {signature?.waiver_version ?? 1} · signed {humanDateTime(signature?.signed_at)}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" data-testid="signed-waiver-close"
                  className="shrink-0 -m-2 p-3 text-shTextMuted hover:text-shText">
            <i className="fas fa-xmark text-lg"/>
          </button>
        </div>

        {hasSnapshot ? (
          <>
            <div className="border border-shBorder rounded-xl p-4 sm:p-5 max-h-[45vh] overflow-y-auto"
                 data-testid="signed-waiver-text">
              {renderText(snapshot)}
            </div>
            <div className="mt-4 rounded-xl border border-shPrimary/40 bg-shPrimary/5 p-4" data-testid="signed-waiver-signature">
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Signed electronically by</p>
              <p className="text-xl font-serif italic text-shText mt-1 break-words">
                {signature?.typed_name || signature?.client_name}
              </p>
              {signature?.dog_names && (
                <p className="text-[12px] text-shTextMuted mt-1 break-words">For: {signature.dog_names}</p>
              )}
              <p className="text-[12px] text-shTextMuted mt-1">{humanDateTime(signature?.signed_at)}</p>
            </div>
            <div className="mt-5 flex flex-col sm:flex-row gap-2">
              <button onClick={download} data-testid="signed-waiver-download"
                      className="w-full sm:w-auto min-h-[44px] px-5 rounded-lg bg-shPrimary text-bgHeader font-black text-[13px] uppercase tracking-widest">
                <i className="fas fa-download mr-2"/>Download a copy
              </button>
              <button onClick={print} data-testid="signed-waiver-print"
                      className="w-full sm:w-auto min-h-[44px] px-5 rounded-lg border border-shBorder text-shText font-black text-[13px] uppercase tracking-widest">
                <i className="fas fa-print mr-2"/>Print
              </button>
            </div>
          </>
        ) : (
          // Older signatures predate snapshotting. Showing today's waiver here
          // would put this client's name under terms they never saw.
          <div className="rounded-xl border border-shBorder p-4" data-testid="signed-waiver-unavailable">
            <p className="text-[14px] text-shText leading-relaxed">
              We have your signature on file from {humanDateTime(signature?.signed_at)}, but not a
              stored copy of the wording you agreed to at the time.
            </p>
            <p className="text-[13px] text-shTextMuted mt-2 leading-relaxed">
              We&apos;re not going to show you today&apos;s waiver instead, because the terms may
              have changed since. Message us and we&apos;ll send you the version you signed.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
