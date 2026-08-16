/* Sprint 110di-61 — TakePaymentModal
 *
 * Lightweight "cash register" modal for registering a payment against a
 * client. Two modes:
 *
 *   - PAY INVOICE (Payment rebuild Phase 2): when the selected client has
 *     an open invoice (balance > 0, not void/refunded), the modal defaults
 *     to paying that specific invoice via POST /invoices/{id}/payments —
 *     this is the invoice-aware top-up flow, and keeps the invoice's own
 *     balance/status accurate instead of leaving it stale.
 *   - PAY TAB (original, unchanged): no open invoice — POST
 *     /clients/{id}/payment exactly as before.
 *
 * Both modes share a single idempotency key generated ONCE when the modal
 * opens (matching FinancialCorrectionModal.jsx's refund_idempotency_key
 * pattern) so a double-click or network retry of the same attempt can
 * never double-collect — never regenerated inside the submit handler.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { emitRegisterChanged } from "../lib/registerBus";
import { printReceipt as posPrintReceipt, openDrawer as posOpenDrawer } from "../lib/posAgent";

export default function TakePaymentModal({ onClose, onSuccess, presetClientId }) {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(presetClientId || "");
  const [clientQuery, setClientQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [tenderedAmount, setTenderedAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [balance, setBalance] = useState(null);
  const [openInvoice, setOpenInvoice] = useState(null);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoiceLookupFailed, setInvoiceLookupFailed] = useState(false);

  // Front-desk POS hardware integration — payment already committed by the
  // time any of this runs; a hardware failure here never implies the
  // payment failed. Populated for BOTH the invoice top-up path (hwInvoiceId)
  // and the generic tab/account payment path (hwLedgerId) — exactly one of
  // the two is ever set, since a given submit is one or the other.
  const [hwResult, setHwResult] = useState(null);
  const [hwBusy, setHwBusy] = useState(false);
  const [hwInvoiceId, setHwInvoiceId] = useState(null);
  const [hwLedgerId, setHwLedgerId] = useState(null);
  const [hwSuccessData, setHwSuccessData] = useState(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [receiptViewOpen, setReceiptViewOpen] = useState(null);

  const receiptKindAndId = () => (hwInvoiceId ? ["invoice", hwInvoiceId] : hwLedgerId ? ["tab_payment", hwLedgerId] : [null, null]);

  const emailReceipt = async () => {
    const [kind, refId] = receiptKindAndId();
    if (!kind) return;
    setEmailBusy(true);
    try {
      const { data } = await api.post(`/receipts/${kind}/${refId}/email`, {});
      if (data.ok) toast.success("Receipt emailed");
      else toast.error(data.detail || "Could not email the receipt");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not email the receipt");
    }
    setEmailBusy(false);
  };

  const viewReceipt = async () => {
    const [kind, refId] = receiptKindAndId();
    if (!kind) return;
    try {
      const { data } = await api.get(`/receipts/${kind}/${refId}`);
      setReceiptViewOpen(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load the receipt");
    }
  };

  const runHardware = async (printToken, drawerToken) => {
    setHwBusy(true);
    const next = { printToken, drawerToken, print: null, drawer: null };
    if (drawerToken) next.drawer = await posOpenDrawer(drawerToken);
    if (printToken) next.print = await posPrintReceipt(printToken);
    setHwResult(next);
    setHwBusy(false);
  };

  const retryHardware = async (action) => {
    if (!hwInvoiceId && !hwLedgerId) return;
    setHwBusy(true);
    try {
      const url = hwInvoiceId
        ? `/invoices/${hwInvoiceId}/pos-tokens`
        : `/clients/${clientId}/ledger/${hwLedgerId}/pos-tokens`;
      const { data } = await api.post(url, { actions: [action] });
      if (action === "open_drawer") {
        const result = await posOpenDrawer(data.open_drawer_token);
        setHwResult(prev => ({ ...prev, drawerToken: data.open_drawer_token, drawer: result }));
      } else {
        const result = await posPrintReceipt(data.print_receipt_token);
        setHwResult(prev => ({ ...prev, printToken: data.print_receipt_token, print: result }));
      }
    } catch (e) {
      const msg = e.response?.data?.detail || "Could not reissue the hardware token";
      setHwResult(prev => ({
        ...prev,
        ...(action === "open_drawer" ? { drawer: { ok: false, error: msg } } : { print: { ok: false, error: msg } }),
      }));
    }
    setHwBusy(false);
  };

  // One stable key for the whole life of this modal — reused for the
  // initial submit, any network retry, and an accidental repeated submit
  // of the same attempt. Never regenerated on click.
  const [idempotencyKey] = useState(() => (
    window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  ));

  useEffect(() => {
    api.get("/clients").then((r) => {
      const d = r.data;
      setClients(Array.isArray(d) ? d : (d.items || []));
    }).catch(() => setClients([]));
  }, []);

  // Look up current balance + any open invoice whenever a client is picked.
  // Uses the take_payments-gated open-invoices endpoint so cashiers without
  // finance_reports can still see what they're collecting against. A failed
  // lookup is a hard error that blocks submit — falling through to the tab
  // path could double-charge a client whose balance is invoice-backed.
  useEffect(() => {
    if (!clientId) { setBalance(null); setOpenInvoice(null); setInvoiceLookupFailed(false); return; }
    const c = clients.find((x) => x.id === clientId);
    setBalance(c ? Number(c.account_balance || 0) : null);
    setInvoicesLoading(true);
    setInvoiceLookupFailed(false);
    api.get(`/clients/${clientId}/open-invoices`).then(({ data }) => {
      const invoices = Array.isArray(data?.invoices) ? data.invoices : [];
      const open = invoices.find((inv) => Number(inv.balance || 0) > 0.005);
      setOpenInvoice(open || null);
      if (open) setAmount(String(Number(open.balance).toFixed(2)));
    }).catch(() => {
      setOpenInvoice(null);
      setInvoiceLookupFailed(true);
    }).finally(() => setInvoicesLoading(false));
  }, [clientId, clients]);

  const selected = clients.find((c) => c.id === clientId);
  const results = clientQuery.trim() && !clientId
    ? clients.filter((c) =>
        (c.name + " " + (c.email || "")).toLowerCase().includes(clientQuery.toLowerCase())
      ).slice(0, 8)
    : [];

  const isInvoiceMode = !!openInvoice;
  const amountNum = Number(amount || 0);
  const tenderedNum = Number(tenderedAmount || 0);
  const changeDue = method === "cash" && tenderedAmount ? Math.max(0, tenderedNum - amountNum) : null;

  const submit = async () => {
    if (!clientId) { setErr("Pick a client first"); return; }
    if (invoicesLoading) { setErr("Still checking for open invoices — one moment"); return; }
    if (invoiceLookupFailed) {
      setErr("Couldn't check for open invoices. Reselect the client to retry — payment is blocked until the check succeeds.");
      return;
    }
    if (!amount || amountNum <= 0) { setErr("Amount must be greater than 0"); return; }
    if (method === "other" && !notes.trim()) { setErr("A note is required when the method is Other"); return; }
    if (method === "cash" && (!tenderedAmount || tenderedNum < amountNum - 0.005)) {
      setErr("Cash received must be at least the amount due");
      return;
    }
    setBusy(true); setErr("");
    try {
      if (isInvoiceMode) {
        const { data } = await api.post(`/invoices/${openInvoice.id}/payments`, {
          amount: amountNum,
          method,
          notes: notes || null,
          tendered_amount: method === "cash" ? tenderedNum : null,
          idempotency_key: idempotencyKey,
        });
        // The top-up has ALREADY fully committed by this point — nothing
        // below can affect that. Hardware actions are strictly best-effort
        // and post-hoc.
        emitRegisterChanged();
        const printToken = data?.pos_print_receipt_token;
        const drawerToken = data?.pos_open_drawer_token;
        setHwInvoiceId(data?.pos_invoice_id || null);
        setHwSuccessData(data);
        setBusy(false);
        // Always show the post-payment status screen so staff has a manual
        // View/Print/Email path even when auto-print is off and no cash was
        // tendered — turning auto-print off must never leave staff with
        // zero way to produce a receipt on request.
        if (data?.pos_invoice_id) {
          await runHardware(printToken, drawerToken);
        } else {
          onSuccess?.(data);
        }
        return;
      } else {
        const { data } = await api.post(`/clients/${clientId}/payment`, {
          amount: amountNum, method, notes,
          tendered_amount: method === "cash" ? tenderedNum : null,
        });
        // Already fully committed by this point — hardware is best-effort
        // and strictly post-hoc, exactly like the invoice top-up path above.
        emitRegisterChanged();
        const printToken = data?.pos_print_receipt_token;
        const drawerToken = data?.pos_open_drawer_token;
        setHwLedgerId(data?.row?.id || null);
        setHwSuccessData(data);
        setBusy(false);
        if (data?.row?.id) {
          await runHardware(printToken, drawerToken);
        } else {
          onSuccess?.(data);
        }
        return;
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || "Payment failed");
      setBusy(false);
    }
  };

  // Payment already committed by the time this renders — purely physical
  // status. Hardware failure here never implies the payment failed.
  if (hwBusy || hwResult) {
    return (
      <div className="fixed inset-0 bg-black/80 z-[80] flex items-center justify-center p-4" data-testid="take-payment-hw-status">
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-md p-6 shadow-2xl sh-modal-surface">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-shPrimary/20 text-shPrimary w-11 h-11 rounded-full flex items-center justify-center text-xl">
              <i className="fas fa-check"/>
            </div>
            <div>
              <h4 className="text-lg font-black text-shText uppercase italic tracking-tight">Payment recorded successfully</h4>
              <p className="text-[13px] text-shTextMuted">Checking front-desk hardware…</p>
            </div>
          </div>
          {hwBusy ? (
            <p className="text-[14px] text-shTextMuted" data-testid="hw-status-busy">Talking to the front-desk printer…</p>
          ) : (
            <div className="space-y-2">
              {hwResult.drawerToken && (
                <div className={`rounded p-2.5 text-[13px] font-black ${hwResult.drawer?.ok ? "bg-shPrimary/10 text-shPrimary border border-shPrimary/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`} data-testid="hw-drawer-status">
                  <i className={`fas ${hwResult.drawer?.ok ? "fa-check" : "fa-triangle-exclamation"} mr-1.5`}/>
                  {hwResult.drawer?.ok ? "Cash drawer opened." : `Cash drawer failed to open: ${hwResult.drawer?.error || "unknown error"}`}
                </div>
              )}
              {hwResult.printToken && (
                <div className={`rounded p-2.5 text-[13px] font-black ${hwResult.print?.ok ? "bg-shPrimary/10 text-shPrimary border border-shPrimary/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`} data-testid="hw-print-status">
                  <i className={`fas ${hwResult.print?.ok ? "fa-check" : "fa-triangle-exclamation"} mr-1.5`}/>
                  {hwResult.print?.ok ? "Receipt printed." : `Receipt printing failed: ${hwResult.print?.error || "unknown error"}`}
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            {!hwBusy && hwResult?.drawerToken && !hwResult.drawer?.ok && (hwInvoiceId || hwLedgerId) && (
              <button onClick={() => retryHardware("open_drawer")} data-testid="hw-retry-drawer"
                      className="text-shAccent font-black uppercase text-[12px] tracking-widest border border-shAccent/40 rounded px-3 py-2">
                <i className="fas fa-rotate mr-1"/>Retry Open Drawer
              </button>
            )}
            {!hwBusy && (hwInvoiceId || hwLedgerId) && (
              <button onClick={() => retryHardware("print_receipt")} data-testid="hw-reprint"
                      className="text-shSecondary font-black uppercase text-[12px] tracking-widest border border-shSecondary/40 rounded px-3 py-2">
                <i className="fas fa-print mr-1"/>
                {hwResult?.printToken ? (hwResult.print?.ok ? "Reprint Receipt" : "Retry Print") : "Print Receipt"}
              </button>
            )}
            {!hwBusy && (hwInvoiceId || hwLedgerId) && (
              <button onClick={viewReceipt} data-testid="take-payment-view-receipt"
                      className="text-shSecondary font-black uppercase text-[12px] tracking-widest border border-shSecondary/40 rounded px-3 py-2">
                <i className="fas fa-receipt mr-1"/>View Receipt
              </button>
            )}
            {!hwBusy && (hwInvoiceId || hwLedgerId) && (
              <button onClick={emailReceipt} disabled={emailBusy} data-testid="take-payment-email-receipt"
                      className="text-shSecondary font-black uppercase text-[12px] tracking-widest border border-shSecondary/40 rounded px-3 py-2 disabled:opacity-50">
                <i className="fas fa-envelope mr-1"/>{emailBusy ? "Sending…" : "Email Receipt"}
              </button>
            )}
            <button onClick={() => onSuccess?.(hwSuccessData)} disabled={hwBusy} data-testid="hw-done"
                    className="ml-auto bg-shPrimary text-bgHeader px-6 py-2 rounded font-black uppercase text-[13px] tracking-widest disabled:opacity-50">
              Done
            </button>
          </div>
        </div>
        {receiptViewOpen && (
          <div className="fixed inset-0 bg-black/70 z-[90] grid place-items-center p-4" onClick={() => setReceiptViewOpen(null)}>
            <div className="bg-white text-black rounded-lg p-5 max-w-sm w-full text-[13px]" onClick={(e) => e.stopPropagation()} data-testid="take-payment-receipt-view-modal">
              {receiptViewOpen.test_receipt && (
                <div className="bg-amber-200 text-amber-900 text-center font-black text-[10px] uppercase tracking-widest py-1 mb-2 rounded">{receiptViewOpen.test_label}</div>
              )}
              <p className="font-black text-base">{receiptViewOpen.business_name}</p>
              <p className="text-gray-500 mt-1">Receipt #{receiptViewOpen.receipt_number}</p>
              {receiptViewOpen.client_name && <p className="text-gray-500">Client: {receiptViewOpen.client_name}</p>}
              <div className="border-t border-gray-200 my-2" />
              {(receiptViewOpen.line_items || []).map((li, i) => (
                <div key={i} className="flex justify-between gap-2"><span>{li.description}{li.qty > 1 ? ` × ${li.qty}` : ""}</span><span className="font-bold">{li.amount != null ? `$${Number(li.amount).toFixed(2)}` : ""}</span></div>
              ))}
              <div className="border-t border-gray-200 my-2" />
              <div className="flex justify-between font-black text-base"><span>Total</span><span>${Number(receiptViewOpen.total ?? receiptViewOpen.invoice_total ?? receiptViewOpen.payment_amount ?? 0).toFixed(2)}</span></div>
              <button onClick={() => setReceiptViewOpen(null)} className="mt-4 w-full bg-gray-100 text-gray-700 rounded py-2 font-black uppercase text-[12px] tracking-widest">Close</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-[80] flex items-center justify-center p-4"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
         data-testid="take-payment-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto sh-modal-surface">
        <h3 className="text-xl font-black text-shText uppercase tracking-tight mb-1">
          <i className="fas fa-cash-register text-shPrimary mr-2"/>{isInvoiceMode ? "Pay Invoice" : "Take Payment"}
        </h3>
        <p className="text-[13px] text-shTextMuted mb-4">
          {isInvoiceMode
            ? `Applies to open invoice #${openInvoice.id.slice(0, 8)} — balance $${Number(openInvoice.balance).toFixed(2)}.`
            : "Register a payment from a client (settle a tab, prepay credit, etc.)"}
        </p>

        {/* Client picker */}
        <label className="text-[11px] uppercase tracking-widest font-black text-shTextMuted">Client</label>
        {selected ? (
          <div className="mt-1 mb-3 flex items-center justify-between bg-[var(--sh-card-base)] border border-shBorder rounded p-2"
               data-testid="take-payment-client-selected">
            <div>
              <p className="text-shText font-black">{selected.name}</p>
              {invoicesLoading && <p className="text-[12px] text-shTextMuted">Checking open invoices…</p>}
              {!invoicesLoading && invoiceLookupFailed && (
                <p className="text-[12px] font-black text-shAccent" data-testid="take-payment-invoice-error">
                  Couldn't check open invoices — reselect the client to retry
                </p>
              )}
              {!invoicesLoading && isInvoiceMode && (
                <p className="text-[12px] font-black text-shAccent">Open invoice — ${Number(openInvoice.balance).toFixed(2)} due</p>
              )}
              {!invoicesLoading && !isInvoiceMode && balance !== null && Math.abs(balance) > 0.005 && (
                <p className={`text-[12px] font-black ${balance > 0 ? "text-shAccent" : "text-shPrimary"}`}>
                  {balance > 0 ? `Owes $${balance.toFixed(2)}` : `Pre-paid $${(-balance).toFixed(2)}`}
                </p>
              )}
            </div>
            <button onClick={() => { setClientId(""); setClientQuery(""); setBalance(null); setOpenInvoice(null); }}
                    data-testid="take-payment-client-clear"
                    className="text-shTextMuted hover:text-shText text-[12px] uppercase tracking-widest font-black">Change</button>
          </div>
        ) : (
          <div className="relative mt-1 mb-3">
            <input value={clientQuery} onChange={(e)=>setClientQuery(e.target.value)}
                   placeholder="Type to search clients…"
                   data-testid="take-payment-client-search"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"/>
            {results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-[var(--sh-card-base)] border border-shBorder rounded shadow-2xl max-h-48 overflow-y-auto">
                {results.map((c) => (
                  <button key={c.id} onClick={()=>{ setClientId(c.id); setClientQuery(""); }}
                          data-testid={`take-payment-client-pick-${c.id}`}
                          className="w-full text-left px-3 py-2 hover:bg-shSurfaceRaised text-shText text-[15px]">
                    <span className="font-black">{c.name}</span> <span className="text-shTextMuted text-[13px]">· {c.email || "—"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="text-[11px] uppercase tracking-widest font-black text-shTextMuted">Amount</label>
        <input type="number" step="0.01" min="0" value={amount} onChange={(e)=>setAmount(e.target.value)}
               max={isInvoiceMode ? openInvoice.balance : undefined}
               data-testid="take-payment-amount"
               placeholder={balance !== null && balance > 0 ? `$${balance.toFixed(2)}` : "$0.00"}
               className="w-full mt-1 mb-3 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-lg font-black"/>

        <label className="text-[11px] uppercase tracking-widest font-black text-shTextMuted">Method</label>
        <select value={method} onChange={(e)=>{ setMethod(e.target.value); setTenderedAmount(""); }} data-testid="take-payment-method"
                className="w-full mt-1 mb-3 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
          <option value="cash">Cash</option>
          {isInvoiceMode ? null : <option value="card">Card</option>}
          <option value="venmo">Venmo</option><option value="paypal">PayPal</option><option value="check">Check</option>
          <option value="other">Other</option>
        </select>

        {method === "cash" && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] uppercase tracking-widest font-black text-shTextMuted">Amount Due</label>
              <div className="mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm font-black">${amountNum.toFixed(2)}</div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest font-black text-shTextMuted">Cash Received</label>
              <input type="number" step="0.01" min="0" value={tenderedAmount} onChange={(e)=>setTenderedAmount(e.target.value)}
                     data-testid="take-payment-tendered"
                     className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm font-black"/>
            </div>
            {changeDue !== null && (
              <div className="col-span-2 text-[13px] font-black text-shPrimary" data-testid="take-payment-change-due">
                Change due: ${changeDue.toFixed(2)}
              </div>
            )}
          </div>
        )}

        <label className="text-[11px] uppercase tracking-widest font-black text-shTextMuted">
          Notes {method === "other" ? "(required)" : "(optional)"}
        </label>
        <input value={notes} onChange={(e)=>setNotes(e.target.value)} data-testid="take-payment-notes"
               placeholder={method === "other" ? "e.g. Zelle, gift certificate…" : "What's this payment for?"}
               className="w-full mt-1 mb-4 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"/>

        {err && <p className="text-red-400 text-[13px] mb-3" data-testid="take-payment-error">{err}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-shTextMuted px-4 py-2 font-black uppercase text-[13px] tracking-widest">Cancel</button>
          <button onClick={submit} disabled={busy || !clientId || !amount || amountNum <= 0}
                  data-testid="take-payment-submit"
                  className="bg-shPrimary text-bgHeader px-6 py-2 rounded font-black uppercase text-[13px] tracking-widest disabled:opacity-50">
            {busy ? "Saving…" : (isInvoiceMode ? "Pay invoice" : "Take payment")}
          </button>
        </div>
      </div>
    </div>
  );
}
