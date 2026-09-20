/**
 * Print a gift card as something you can actually hand to a person.
 *
 * Deliberately a full page, not a thermal receipt slip. A gift is given, and
 * a curling till receipt is a poor thing to give. This prints on plain paper
 * or card stock, cuts to roughly a greetings-card size, and carries the one
 * thing that matters — the code — large enough to read without squinting.
 *
 * Same mechanism as the training certificate (see PortalTrainingCard): build
 * the document, open it, print it. No dependency, no server round trip, and
 * it works with whatever printer is already attached.
 */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

export function giftCardHtml(card, { businessName = "Sit Happens", note = "" } = {}) {
  const code = esc(card.code_display || card.code || "");
  const amount = money(card.balance != null ? card.balance : card.amount);
  const to = esc(card.recipient_name || "");
  const issued = esc(String(card.issued_at || new Date().toISOString()).slice(0, 10));
  return `<!doctype html><html><head><meta charset="utf-8">
  <title>Gift Card ${code}</title>
  <style>
    @page { margin: 14mm; }
    body { font-family: Georgia, "Times New Roman", serif; color:#0f172a; margin:0; }
    .card { border:3px solid #0f172a; border-radius:14px; padding:26px 30px; max-width:150mm;
            margin:0 auto; text-align:center; }
    .biz { font-size:15px; letter-spacing:.24em; text-transform:uppercase; color:#475569; }
    h1 { font-size:40px; margin:10px 0 2px; letter-spacing:.04em; }
    .amount { font-size:64px; font-weight:bold; margin:10px 0 4px; }
    .to { font-size:19px; font-style:italic; color:#334155; margin:2px 0 14px; }
    .codebox { border:2px dashed #94a3b8; border-radius:10px; padding:12px 8px; margin:16px 0 8px; }
    .codelabel { font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:#64748b; }
    .code { font-family:"Courier New",monospace; font-size:34px; font-weight:bold;
            letter-spacing:.16em; margin-top:4px; }
    .terms { font-size:12px; color:#475569; line-height:1.55; margin-top:14px; text-align:left; }
    .foot { display:flex; justify-content:space-between; font-size:11px; color:#64748b;
            margin-top:16px; border-top:1px solid #cbd5e1; padding-top:8px; }
    @media print { .noprint { display:none; } }
  </style></head><body>
  <div class="card">
    <p class="biz">${esc(businessName)}</p>
    <h1>Gift Card</h1>
    <p class="amount">${esc(amount)}</p>
    ${to ? `<p class="to">for ${to}</p>` : ""}
    <div class="codebox">
      <p class="codelabel">Redemption code</p>
      <p class="code">${code}</p>
    </div>
    <p class="terms">
      Present this code at Sit Happens to use the balance. It can be spent on anything we
      sell &mdash; daycare, boarding, training, grooming or anything on the shelf &mdash; and
      can be used over more than one visit until it runs out.
      It does not expire. It cannot be exchanged for cash.
      Treat it like cash: we cannot replace it if it is lost, though we can void and reissue
      it if you tell us before somebody else spends it.
      ${note ? `<br><br>${esc(note)}` : ""}
    </p>
    <div class="foot"><span>Issued ${issued}</span><span>${code}</span></div>
  </div>
  <script>window.onload=()=>setTimeout(()=>window.print(),200);</script>
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
