/**
 * Print a gift card at real gift-card size, in the brand's colours.
 *
 * CR80 — 85.6 x 54mm, the same rectangle as a bank card — so it fits a
 * wallet, a card sleeve, or an envelope, and looks like the thing it is
 * rather than a printout of a thing.
 *
 * Front and back print one above the other with a cut line: guillotine both,
 * glue them back to back onto card stock, or just hand over the front. The
 * back exists because the terms have to live somewhere and the front has one
 * job — the amount and the code.
 *
 * Everything on it is drawn: the paw marks and the swoosh are inline SVG, so
 * there is no image to go missing and no icon font to fail to load in a
 * print window. Colours come from the LIVE theme, so recolouring Brand &
 * Theme recolours the card; the constants below are only the historical
 * defaults, for when there is no theme to ask.
 *
 * Deliberately not the thermal printer: an 80mm roll cannot produce this,
 * and the code already lands on the till receipt for that.
 */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const FALLBACK = { green: "#8cc63f", navy: "#0e1c3d", header: "#0a1530", panel: "#132550" };

/** The brand words on the card. Overridable, but these are the real ones. */
export const BRAND = {
  name: "Sit Happens",
  rule: "People · Dogs · Good Days",
  script: "Better Dogs\nBrighter Days",
  backMark: "Same dog people\ndifferently",
  footMark: "Train · Play · Belong",
};

export function brandColors() {
  try {
    const css = getComputedStyle(document.documentElement);
    const pick = (n, f) => (css.getPropertyValue(n) || "").trim() || f;
    return {
      green: pick("--sh-green", FALLBACK.green),
      navy: pick("--bg-base", FALLBACK.navy),
      header: pick("--bg-header", FALLBACK.header),
      panel: pick("--bg-panel", FALLBACK.panel),
    };
  } catch {
    return { ...FALLBACK };
  }
}

const paw = (fill, opacity = 1) => `<svg viewBox="0 0 64 64" fill="${fill}" opacity="${opacity}"
  xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse cx="18" cy="18" rx="7.5" ry="10"/><ellipse cx="33" cy="12" rx="7.5" ry="10.5"/>
  <ellipse cx="48" cy="19" rx="7" ry="9.5"/><ellipse cx="56" cy="34" rx="6" ry="8"/>
  <path d="M33 30c9 0 17 6.5 17 14.5C50 52 43 56 33 56s-17-4-17-11.5C16 36.5 24 30 33 30z"/>
</svg>`;

/** Where the husky lives. Absolute, because a print window opened from a
 *  blob URL has no origin of its own to resolve a relative path against. */
export function logoUrl() {
  try {
    return `${window.location.origin}/logo.png`;
  } catch {
    return "/logo.png";
  }
}

export function giftCardHtml(card, { businessName, note = "", colors, brand, logo } = {}) {
  const c = colors || brandColors();
  const b = { ...BRAND, ...(brand || {}) };
  const name = esc(businessName || b.name);
  const code = esc(card.code_display || card.code || "");
  const amount = money(card.balance != null ? card.balance : card.amount);
  const to = esc(card.recipient_name || "");
  const issued = esc(String(card.issued_at || new Date().toISOString()).slice(0, 10));
  const scriptLines = b.script.split("\n").map((l) => `<span>${esc(l)}</span>`).join("");
  const husky = logo === null ? "" : esc(logo || logoUrl());

  return `<!doctype html><html><head><meta charset="utf-8">
  <title>Gift Card ${code}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&display=swap" rel="stylesheet">
  <style>
    /* Browsers strip background colours when printing unless told not to.
       Without this the card comes out as white paper with lime text on it. */
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
    @page { size: auto; margin: 10mm; }
    body { margin:0; background:#fff;
           font-family: Inter, "Segoe UI", "Helvetica Neue", system-ui, sans-serif; }

    .cut { font-size:7pt; color:#94a3b8; margin:0 0 3mm; }
    .stack { display:flex; flex-direction:column; gap:6mm; }

    /* CR80 — the same rectangle as a bank card. */
    .card { width:85.6mm; height:53.98mm; border-radius:4mm; overflow:hidden; position:relative;
            color:#fff; flex:none;
            background:linear-gradient(150deg, ${c.header} 0%, ${c.navy} 60%, ${c.panel} 100%); }
    .inner { position:absolute; inset:0; padding:4.6mm 5mm; display:flex; flex-direction:column; }

    /* ── front ─────────────────────────────────────────────── */
    .brandrow { display:flex; align-items:center; gap:2mm; }
    .brandrow svg { width:6.4mm; height:6.4mm; flex:none; }
    .bizname { font-size:11pt; font-weight:800; letter-spacing:.26em; text-transform:uppercase;
               line-height:1; }
    .rule { border-top:.25mm solid rgba(255,255,255,.35); margin:1.4mm 0 1mm; width:56mm; }
    .tagline { font-size:5.2pt; letter-spacing:.32em; text-transform:uppercase; color:#b9c6e4; }

    .big { font-size:26pt; font-weight:900; letter-spacing:-.01em; line-height:.92;
           margin-top:4.6mm; color:#f5f7fb; text-transform:uppercase; }
    .dash { width:10mm; height:1mm; background:${c.green}; border-radius:1mm; margin:2mm 0 1.2mm; }
    .amount { font-size:31pt; font-weight:900; color:${c.green}; line-height:1; letter-spacing:-.025em; }
    .pad { margin-top:auto; }
    .to { font-size:9pt; font-style:italic; color:#e8edf8; }

    .script { position:absolute; right:2.5mm; top:39.5mm; text-align:center; line-height:1.0;
              font-family:Caveat, "Segoe Script", "Brush Script MT", cursive;
              font-size:11pt; color:rgba(255,255,255,.55); display:flex; flex-direction:column; }

    /* The husky holds the right of the card, the way the mock does.
       He is cropped out of the full logo with a window rather than from a
       second cropped file, so there is still exactly ONE mascot image in the
       app: change logo.png and the card changes with it. The numbers come
       from his bounding box inside that 735x693 artwork — x 230..510,
       y 0..450 — which is why the image is oversized and pulled left: the
       wordmark and the ring fall outside the window. Re-crop the maths if the
       logo is ever redrawn. */
    .husky { position:absolute; right:0; top:1.5mm; width:26mm; height:37mm;
             overflow:hidden; opacity:.44;
             /* Fade the two cut edges. Without this he ends in a hard
                rectangle and reads as a pasted-in photo rather than as part
                of the card. */
             -webkit-mask-image:linear-gradient(to bottom,#000 62%,transparent 100%),
                                linear-gradient(to right,transparent 0,#000 26%);
             mask-image:linear-gradient(to bottom,#000 62%,transparent 100%),
                        linear-gradient(to right,transparent 0,#000 26%);
             -webkit-mask-composite:source-in; mask-composite:intersect; }
    .husky img { position:absolute; left:-21.4mm; top:0; width:68.25mm; height:auto; }
    .swoosh { position:absolute; left:0; right:0; bottom:0; height:22mm; }

    /* ── back ──────────────────────────────────────────────── */
    .backhead { display:flex; justify-content:space-between; align-items:flex-start; gap:3mm; }
    .h3 { font-size:9pt; font-weight:800; letter-spacing:.2em; text-transform:uppercase;
          color:${c.green}; margin:0; }
    .mark { display:flex; align-items:center; gap:1.4mm; text-align:right; }
    .mark span { font-size:4.6pt; letter-spacing:.2em; text-transform:uppercase; color:#b9c6e4;
                 line-height:1.35; }
    .mark svg { width:4.6mm; height:4.6mm; flex:none; }
    .terms { font-size:5.7pt; line-height:1.55; color:#dbe3f4; margin:2mm 0 0; }

    .codebox { position:relative; margin-top:2.2mm; border:.45mm solid ${c.green};
               border-radius:2mm; background:rgba(140,198,63,.10); padding:1.7mm 2.4mm;
               overflow:hidden; }
    .codelabel { font-size:5.4pt; letter-spacing:.24em; text-transform:uppercase;
                 color:${c.green}; font-weight:800; }
    .code { font-size:12.5pt; font-weight:700; letter-spacing:.14em; margin-top:.5mm;
            font-family:ui-monospace,"Courier New",monospace; }
    .codepaw { position:absolute; right:2mm; bottom:1mm; width:6mm; height:6mm; }

    .backfoot { margin-top:auto; display:flex; justify-content:space-between; align-items:flex-end; }
    .issued { font-size:5.8pt; color:#b9c6e4; }
    .footright { text-align:right; }
    .footmark { font-size:5.2pt; letter-spacing:.22em; text-transform:uppercase; color:#b9c6e4; }
    .footamount { font-size:8.5pt; font-weight:700; margin-top:.4mm; }
  </style></head><body>
  <p class="cut">Cut along the edges &middot; front and back &middot; 85.6 &times; 54&nbsp;mm</p>
  <div class="stack">

    <div class="card front">
      <svg class="swoosh" viewBox="0 0 340 88" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0 62 C 70 92, 150 30, 218 44" fill="none" stroke="${c.green}" stroke-width="2.4"/>
        <path d="M218 44 c 8 -16, 32 -12, 32 4 c 0 14, -22 22, -32 30 c -10 -8, -32 -16, -32 -30
                 c 0 -16, 24 -20, 32 -4 z" fill="none" stroke="${c.green}" stroke-width="2.4"/>
        <path d="M250 48 C 286 40, 314 52, 340 40" fill="none" stroke="${c.green}" stroke-width="2.4"/>
      </svg>
      ${husky ? `<div class="husky"><img src="${husky}" alt=""></div>` : ""}
      <div class="script">${scriptLines}</div>
      <div class="inner">
        <div class="brandrow">${paw(c.green)}<span class="bizname">${name}</span></div>
        <div class="rule"></div>
        <p class="tagline" style="margin:0">${esc(b.rule)}</p>
        <p class="big" style="margin:0">Gift Card</p>
        <div class="dash"></div>
        <p class="amount" style="margin:0">${esc(amount)}</p>
        <div class="pad"></div>
        ${to ? `<p class="to" style="margin:0">for ${to}</p>` : ""}
      </div>
    </div>

    <div class="card back">
      <div class="inner">
        <div class="backhead">
          <p class="h3">How to use it</p>
          <div class="mark">
            <span>${b.backMark.split("\n").map(esc).join("<br>")}</span>${paw(c.green, .85)}
          </div>
        </div>
        <p class="terms">
          Bring this card to ${name}. The balance can be spent on anything we sell &mdash;
          daycare, boarding, training, grooming, or anything on the shelf &mdash; and can be used
          over as many visits as it takes until it runs out.
          It does not expire and cannot be exchanged for cash.
          Treat it like cash: we cannot replace it if it is lost, though we
          can void and reissue it if you tell us before somebody else spends it.${note ? ` ${esc(note)}` : ""}
        </p>
        <div class="codebox">
          <p class="codelabel" style="margin:0">Redemption code</p>
          <p class="code" style="margin:0">${code}</p>
          <div class="codepaw">${paw("#ffffff", .10)}</div>
        </div>
        <div class="backfoot">
          <span class="issued">Issued ${issued}</span>
          <div class="footright">
            <div class="footmark">${esc(b.footMark)}</div>
            <div class="footamount">${esc(amount)}</div>
          </div>
        </div>
      </div>
    </div>

  </div>
  <script>
    // Wait for the artwork. Printing on a fixed delay races the image and
    // puts a hole in the card on a slow load.
    window.onload = () => {
      const pending = [...document.images].filter((i) => !i.complete);
      Promise.all(pending.map((i) => new Promise((r) => { i.onload = i.onerror = r; })))
        .then(() => setTimeout(() => window.print(), 250));
    };
  </script>
  </body></html>`;
}

export function printGiftCard(card, opts) {
  const blob = new Blob([giftCardHtml(card, opts)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    // Pop-up blocked. Free the object rather than leaking it, and let the
    // caller tell the operator why nothing happened.
    URL.revokeObjectURL(url);
    return false;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
