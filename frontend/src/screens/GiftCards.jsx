import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatErr } from "../lib/api";
import PageHero from "../components/PageHero";
import { printGiftCard, printGiftCardSheet, PER_SHEET } from "../lib/printGiftCard";

/**
 * Gift cards — the ones you have sold, and the ones you hand out.
 *
 * The number at the top is the one that matters and the one an accountant
 * asks for: what you still owe the people holding cards. Every card here is
 * a promise you have already been paid for.
 *
 * Selling a card happens at the Register, because that is a real sale with a
 * tender and a receipt. Issuing one here is the other thing — a make-good, a
 * replacement for a lost card, a comp — and it deliberately books no revenue,
 * because no money came in.
 */
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const STATUS = {
  active: { label: "Active", cls: "bg-shPrimary/15 text-shPrimary border-shPrimary/40" },
  spent: { label: "Spent", cls: "bg-shBorder/40 text-shTextMuted border-shBorder" },
  voided: { label: "Voided", cls: "bg-red-500/15 text-red-300 border-red-500/40" },
  // A printed blank waiting to be bought. Worth nothing, owed to nobody, and
  // deliberately NOT called "Active" — the difference between a rack of cards
  // and a rack of promises.
  stock: { label: "On the rack", cls: "bg-shBlue/15 text-shBlue border-shBlue/40" },
};

export default function GiftCards() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get("/gift-cards", { params: filter ? { status: filter } : {} });
      setData(d);
    } catch (e) {
      toast.error(formatErr(e) || "Could not load gift cards");
    }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  // ── issuing one by hand ──────────────────────────────────────────────
  const [issueOpen, setIssueOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [reason, setReason] = useState("");
  const [issued, setIssued] = useState(null);

  const issue = async () => {
    if (!(Number(amount) > 0)) { toast.error("Enter an amount."); return; }
    if (reason.trim().length < 3) { toast.error("Say why you are issuing it (3+ characters)."); return; }
    setBusy(true);
    try {
      const { data: d } = await api.post("/gift-cards/issue", {
        amount: Number(amount), recipient_name: recipient.trim() || null, reason: reason.trim(),
      });
      // Shown once, big, because this is the only moment the code matters —
      // it has to get written onto a physical card before this closes.
      setIssued({ code: d.code, amount: Number(amount) });
      setIssueOpen(false); setAmount(""); setRecipient(""); setReason("");
      load();
    } catch (e) {
      toast.error(formatErr(e) || "Could not issue the card");
    }
    setBusy(false);
  };

  // ── printing blanks for the rack ────────────────────────────────────
  const [rackOpen, setRackOpen] = useState(false);
  const [rackQty, setRackQty] = useState("10");
  // Empty means a blank stack, sellable for any amount. A number means a
  // denomination stack: that value is printed on the card and the Register
  // will not sell it for anything else.
  const [rackValue, setRackValue] = useState("");
  const [madeCards, setMadeCards] = useState(null);

  const makeRack = async () => {
    const n = Math.floor(Number(rackQty));
    if (!(n >= 1 && n <= 100)) { toast.error("Between 1 and 100 cards."); return; }
    setBusy(true);
    try {
      const face = rackValue.trim() === "" ? null : Number(rackValue);
      if (face !== null && !(face > 0)) { toast.error("Enter a real amount, or leave it empty."); setBusy(false); return; }
      const { data: d } = await api.post("/gift-cards/stock",
                                         { quantity: n, face_value: face });
      // Held on screen rather than printed straight away: if the print is
      // blocked or the paper jams, the codes are still here to print again.
      setMadeCards(d.cards || []);
      setRackOpen(false);
      load();
      toast.success(`${d.count} card${d.count === 1 ? "" : "s"} ready to print.`);
    } catch (e) {
      toast.error(formatErr(e) || "Could not make the cards");
    }
    setBusy(false);
  };

  const printRack = (cards) => {
    if (!printGiftCardSheet(cards)) toast.error("Allow pop-ups to print the cards.");
  };

  // ── picking which cards to print ────────────────────────────────────
  // A batch you just made is easy; reprinting one from last month is the
  // case that matters, because that is when a card goes missing.
  const [picked, setPicked] = useState(() => new Set());
  const togglePick = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const pickedCards = () => (data?.cards || []).filter((c) => picked.has(c.id));
  const printPicked = () => {
    const cards = pickedCards();
    if (!cards.length) { toast.error("Tick the cards you want to print."); return; }
    if (!printGiftCardSheet(cards)) toast.error("Allow pop-ups to print the cards.");
  };

  // ── editing the two things that are not money ───────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");
  const openEdit = () => {
    setEditName(found?.recipient_name || "");
    setEditNote(found?.note || "");
    setEditOpen(true);
  };
  const saveEdit = async () => {
    setBusy(true);
    try {
      const { data: d } = await api.post(
        `/gift-cards/${encodeURIComponent(found.code_display)}/details`,
        { recipient_name: editName.trim(), note: editNote.trim() });
      setFound((f) => ({ ...f, ...(d.card || {}) }));
      setEditOpen(false);
      load();
      toast.success("Card updated.");
    } catch (e) {
      toast.error(formatErr(e) || "Could not update the card");
    }
    setBusy(false);
  };

  // ── looking one up ───────────────────────────────────────────────────
  const [code, setCode] = useState("");
  const [found, setFound] = useState(null);
  const lookup = async () => {
    if (!code.trim()) return;
    try {
      const { data: d } = await api.get(`/gift-cards/lookup/${encodeURIComponent(code.trim())}`);
      setFound(d);
    } catch (e) {
      setFound(null);
      toast.error(formatErr(e) || "No gift card with that code");
    }
  };

  const act = async (path, body, done) => {
    setBusy(true);
    try {
      await api.post(path, body);
      toast.success(done);
      if (found) {
        const { data: d } = await api.get(`/gift-cards/lookup/${encodeURIComponent(found.code_display)}`);
        setFound(d);
      }
      load();
    } catch (e) {
      toast.error(formatErr(e) || "That did not work");
    }
    setBusy(false);
  };

  const print = (card) => {
    if (!printGiftCard(card)) toast.error("Allow pop-ups to print the gift card.");
  };

  const input = "w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2.5 text-shText text-sm";
  const label = "text-[11px] font-black uppercase tracking-widest text-shTextMuted";

  return (
    <div className="space-y-4" data-testid="gift-cards-screen">
      <PageHero icon="fa-gift" title="Gift Cards"
                subtitle="Money your customers have already paid for."/>

      {/* What you owe. One number, because that is the one that matters. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sh-front-desk-panel p-4" data-testid="gift-outstanding">
          <p className={label}>Outstanding</p>
          <p className="text-shPrimary text-3xl font-black">{money(data?.outstanding_balance)}</p>
          <p className="text-[12px] text-shTextMuted mt-1">
            owed to {data?.outstanding_count || 0} card{data?.outstanding_count === 1 ? "" : "s"} still in circulation
          </p>
        </div>
        <div className="sm:col-span-2 sh-front-desk-panel p-4">
          <p className={label}>Find a card</p>
          <div className="flex gap-2 mt-1">
            <input value={code} onChange={(e) => setCode(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
                   placeholder="XXXX-XXXX-XXXX" data-testid="gift-lookup-code" className={`${input} flex-1 min-w-0`}/>
            <button onClick={lookup} data-testid="gift-lookup-go"
                    className="min-h-[44px] px-4 rounded border border-shPrimary/50 text-shPrimary text-[12px] font-black uppercase tracking-widest">
              Look up
            </button>
          </div>
          <p className="text-[12px] text-shTextMuted mt-2">
            Sell a card at the <b className="text-shText">Register</b> — that is a real sale with a receipt.
            Issuing one here is for a make-good or a replacement, and records no income.
          </p>
        </div>
      </div>

      {issued && (
        /* The code exists in exactly one place a human can read it: here,
           now, before this closes. Write it on the card. */
        <div className="rounded-2xl border-2 border-shPrimary bg-shPrimary/10 p-5 text-center" data-testid="gift-issued">
          <p className={label}>Write this on the card</p>
          <p className="text-shPrimary text-[34px] sm:text-[44px] font-black tracking-[0.15em] leading-tight my-1">
            {issued.code}
          </p>
          <p className="text-shText font-black">{money(issued.amount)}</p>
          <div className="flex flex-wrap gap-2 justify-center mt-3">
            <button onClick={() => print({ code_display: issued.code, balance: issued.amount })}
                    data-testid="gift-issued-print"
                    className="min-h-[44px] px-6 rounded-xl bg-shPrimary text-bgHeader font-black uppercase text-[12px] tracking-widest">
              <i className="fas fa-print mr-1.5"/>Print the card
            </button>
            <button onClick={() => setIssued(null)} data-testid="gift-issued-done"
                    className="min-h-[44px] px-6 rounded-xl border border-shBorder text-shTextMuted font-black uppercase text-[12px] tracking-widest">
              Written it down
            </button>
          </div>
        </div>
      )}

      {found && (
        <div className="sh-front-desk-panel p-4" data-testid="gift-found">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-shText text-xl font-black tracking-widest">{found.code_display}</p>
              <p className="text-[12.5px] text-shTextMuted">
                {found.status === "stock"
                  ? (found.face_value != null
                      ? `${money(found.face_value)} card · not sold yet`
                      : "Blank · sells for any amount")
                  : `${money(found.initial_amount)} issued · ${money(found.spent)} spent`}
                {found.recipient_name ? ` · for ${found.recipient_name}` : ""}
              </p>
            </div>
            <div className="text-right">
              {/* A card nobody has bought is worth nothing, and "$0.00" in
                  32px reads as an empty card rather than an unsold one. */}
              <p className="text-shPrimary text-3xl font-black">
                {found.status === "stock" ? "—" : money(found.balance)}
              </p>
              <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border ${
                    (STATUS[found.status] || STATUS.spent).cls}`}>
                {(STATUS[found.status] || {}).label || found.status}
              </span>
            </div>
          </div>

          {editOpen && (
            <div className="border border-shBorder rounded-xl p-3 mt-3 space-y-2"
                 data-testid="gift-edit-form">
              <p className="text-[12px] text-shTextMuted">
                Who it is for, and a note. <b className="text-shText">No money moves here</b> —
                the balance is changed by selling, spending or topping the card up.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className={label}>Who is it for?</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)}
                         data-testid="gift-edit-name" className={input}/>
                </div>
                <div>
                  <label className={label}>Note</label>
                  <input value={editNote} onChange={(e) => setEditNote(e.target.value)}
                         data-testid="gift-edit-note" className={input}/>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={saveEdit} disabled={busy} data-testid="gift-edit-save"
                        className="min-h-[44px] px-5 rounded bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
                  {busy ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setEditOpen(false)} data-testid="gift-edit-cancel"
                        className="min-h-[44px] px-5 rounded border border-shBorder text-shText text-[12px] font-black uppercase tracking-widest">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            {/* Loading a blank by hand is refused by the backend on purpose —
                money on a card has to arrive through a sale. Offering the
                button anyway just hands the operator an error. */}
            {found.status !== "stock" && (
            <button onClick={() => {
                      const v = window.prompt("Add how much to this card?");
                      const why = v && window.prompt("Why?");
                      if (v && why) act(`/gift-cards/${encodeURIComponent(found.code_display)}/adjust`,
                                        { amount: Number(v), direction: "add", reason: why }, "Balance updated");
                    }} disabled={busy} data-testid="gift-add"
                    className="min-h-[40px] px-3 rounded border border-shBorder text-[11px] font-black uppercase tracking-widest text-shTextMuted">
              Add to balance
            </button>
            )}
            <button onClick={openEdit} data-testid="gift-edit"
                    className="min-h-[40px] px-3 rounded border border-shBorder text-[11px] font-black uppercase tracking-widest text-shTextMuted">
              Edit details
            </button>
            <button onClick={() => print(found)} data-testid="gift-print"
                    className="min-h-[40px] px-3 rounded border border-shPrimary/50 text-[11px] font-black uppercase tracking-widest text-shPrimary">
              <i className="fas fa-print mr-1.5"/>Print
            </button>
            <button onClick={() => {
                      const why = window.prompt("Why is this card being voided?");
                      if (why) act(`/gift-cards/${encodeURIComponent(found.code_display)}/void`,
                                   { reason: why }, "Card voided");
                    }} disabled={busy || found.status === "voided"} data-testid="gift-void"
                    className="min-h-[40px] px-3 rounded border border-red-500/40 text-[11px] font-black uppercase tracking-widest text-red-300 disabled:opacity-40">
              Void (lost or stolen)
            </button>
          </div>

          <div className="mt-3 border-t border-shBorder pt-2">
            <p className={label}>History</p>
            <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
              {(found.history || []).map((h) => (
                <div key={h.id} className="flex justify-between text-[12.5px]" data-testid="gift-history-row">
                  <span className="text-shTextMuted">
                    {String(h.created_at || "").slice(0, 10)} · {h.kind}
                    {h.note ? ` · ${h.note}` : ""}
                  </span>
                  <span className="text-shText font-bold">{money(h.balance_after)} left</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="sh-front-desk-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-shText text-[14px] uppercase tracking-widest font-black">All cards</p>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="gift-filter"
                    className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-[12px]">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="spent">Spent</option>
              <option value="stock">On the rack</option>
              <option value="voided">Voided</option>
            </select>
            {picked.size > 0 && (
              <button onClick={printPicked} data-testid="gift-print-picked"
                      className="min-h-[40px] px-4 rounded bg-shBlue text-bgHeader text-[12px] font-black uppercase tracking-widest whitespace-nowrap flex-1 sm:flex-none">
                <i className="fas fa-print mr-1.5"/>Print {picked.size}
              </button>
            )}
            <button onClick={() => setRackOpen((v) => !v)} data-testid="gift-rack-toggle"
                    className="min-h-[40px] px-4 rounded border border-shPrimary text-shPrimary text-[12px] font-black uppercase tracking-widest whitespace-nowrap flex-1 sm:flex-none">
              <i className="fas fa-print mr-1.5"/>Make cards
            </button>
            <button onClick={() => setIssueOpen((v) => !v)} data-testid="gift-issue-toggle"
                    className="min-h-[40px] px-4 rounded bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest whitespace-nowrap flex-1 sm:flex-none">
              <i className="fas fa-plus mr-1.5"/>Issue a card
            </button>
          </div>
        </div>

        {rackOpen && (
          <div className="border border-shBorder rounded-xl p-3 mb-3 space-y-2" data-testid="gift-rack-form">
            <p className="text-[12px] text-shTextMuted">
              Prints blank cards with real codes to hang on the rack. Each one is
              <b className="text-shText"> its own card</b> with its own code and its own balance.
              A blank is worth <b className="text-shText">nothing</b> until somebody buys it —
              no income and nothing owed until the Register loads it.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <label className={label}>How many</label>
                <input type="number" min="1" max="100" value={rackQty}
                       onChange={(e) => setRackQty(e.target.value)}
                       data-testid="gift-rack-qty" className={input}/>
                <p className="text-[11px] text-shTextMuted mt-1">
                  {PER_SHEET} to a sheet, cut lines included.
                </p>
              </div>
              <div>
                <label className={label}>Amount printed on them</label>
                <input type="number" min="1" value={rackValue}
                       onChange={(e) => setRackValue(e.target.value)}
                       placeholder="Leave empty for blanks"
                       data-testid="gift-rack-value" className={input}/>
                <p className="text-[11px] text-shTextMuted mt-1">
                  {rackValue.trim() === ""
                    ? "Blanks — sell each one for whatever the customer wants."
                    : `A $${Number(rackValue) || 0} stack — the Register will only sell these for $${Number(rackValue) || 0}.`}
                </p>
              </div>
            </div>
            <button onClick={makeRack} disabled={busy} data-testid="gift-rack-go"
                    className="min-h-[44px] px-5 rounded bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
              {busy ? "Making…" : "Make cards"}
            </button>
          </div>
        )}

        {madeCards && madeCards.length > 0 && (
          <div className="rounded-2xl border-2 border-shPrimary bg-shPrimary/10 p-4 mb-3"
               data-testid="gift-rack-made">
            <p className="text-[12px] uppercase tracking-widest text-shPrimary font-black">
              {madeCards.length} blank card{madeCards.length === 1 ? "" : "s"} ready
            </p>
            <p className="text-[12px] text-shTextMuted mt-1">
              Print them, cut them up and hang them. They are already saved, so you can
              print again from the list if anything goes wrong.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button onClick={() => printRack(madeCards)} data-testid="gift-rack-print"
                      className="min-h-[44px] px-5 rounded bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest">
                <i className="fas fa-print mr-1.5"/>
                Print {Math.ceil(madeCards.length / PER_SHEET)} sheet{Math.ceil(madeCards.length / PER_SHEET) === 1 ? "" : "s"}
              </button>
              <button onClick={() => setMadeCards(null)} data-testid="gift-rack-done"
                      className="min-h-[44px] px-5 rounded border border-shBorder text-shText text-[12px] font-black uppercase tracking-widest">
                Done
              </button>
            </div>
          </div>
        )}

        {issueOpen && (
          <div className="border border-shBorder rounded-xl p-3 mb-3 space-y-2" data-testid="gift-issue-form">
            <p className="text-[12px] text-shTextMuted">
              No money changes hands here, so this records <b className="text-shText">no income</b> —
              it is a promise you have chosen to make. Sell a card at the Register instead when
              somebody is paying for it.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <label className={label}>Amount</label>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                       data-testid="gift-issue-amount" className={input}/>
              </div>
              <div>
                <label className={label}>Who is it for? (optional)</label>
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)}
                       data-testid="gift-issue-recipient" className={input}/>
              </div>
              <div>
                <label className={label}>Why</label>
                <input value={reason} onChange={(e) => setReason(e.target.value)}
                       placeholder="Make-good for a bad groom" data-testid="gift-issue-reason" className={input}/>
              </div>
            </div>
            <button onClick={issue} disabled={busy} data-testid="gift-issue-go"
                    className="min-h-[44px] px-5 rounded bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
              {busy ? "Issuing…" : "Issue card"}
            </button>
          </div>
        )}

        {!data ? (
          <p className="text-shTextMuted text-sm py-6 text-center">Loading…</p>
        ) : (data.cards || []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-shBorder py-10 text-center" data-testid="gift-empty">
            <p className="text-shTextMuted">No gift cards yet.</p>
            <p className="text-[13px] text-shTextMuted mt-1">Sell one at the Register and it will appear here.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.cards.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-shBorder/60 py-2"
                   data-testid={`gift-row-${c.id}`}>
                <div className="min-w-0 flex items-center gap-2">
                  <input type="checkbox" checked={picked.has(c.id)}
                         onChange={() => togglePick(c.id)}
                         aria-label={`Print ${c.code_display}`}
                         data-testid={`gift-pick-${c.id}`}
                         className="w-4 h-4 accent-shPrimary shrink-0"/>
                  <div className="min-w-0">
                  <button onClick={() => { setCode(c.code_display); setFound(null); lookup(); }}
                          className="text-shText font-black tracking-widest text-[14px] hover:text-shPrimary">
                    {c.code_display}
                  </button>
                  <p className="text-[12px] text-shTextMuted">
                    {String(c.issued_at || "").slice(0, 10)}
                    {c.recipient_name ? ` · ${c.recipient_name}` : ""}
                    {c.issued_by_name ? ` · by ${c.issued_by_name}` : ""}
                  </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-shText font-black">
                    {c.status !== "stock" ? money(c.balance)
                     : c.face_value != null ? (
                        <span className="text-shTextMuted text-[12px] font-bold">
                          {money(c.face_value)} card
                        </span>)
                     : "—"}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border ${
                        (STATUS[c.status] || STATUS.spent).cls}`}>
                    {(STATUS[c.status] || {}).label || c.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
