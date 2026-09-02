import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { printReceipt } from "../lib/posAgent";
import ShopImageUpload from "./ShopImageUpload";
import ReceiptLogo from "./ReceiptLogo";

// Basic receipt customization (Phase 2, reduced scope). Presentation only —
// every amount on every receipt still comes from the existing authoritative
// invoice/payment/pos_sale record via the canonical _build_*_receipt_payload
// builders in server.py. This panel never computes or submits a total.
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

function Toggle({ label, help, checked, onChange, testid }) {
  return (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
             data-testid={testid} className="mt-1" />
      <span>
        <span className="block text-shText text-sm font-bold">{label}</span>
        {help && <span className="block text-shTextMuted text-[12px] mt-0.5">{help}</span>}
      </span>
    </label>
  );
}

function ReceiptPreviewCard({ payload, thermal }) {
  if (!payload) return null;
  return (
    <div className={thermal
      ? "bg-white text-black font-mono text-[11px] leading-tight p-3 rounded border border-shBorder mx-auto"
      : "bg-white text-black text-[13px] p-5 rounded-lg border border-shBorder shadow-sh"}
         style={thermal ? { width: 220 } : { maxWidth: 380 }}
         data-testid={thermal ? "receipt-preview-thermal" : "receipt-preview-digital"}>
      {payload.test_receipt && (
        <div className="bg-amber-200 text-amber-900 text-center font-black text-[10px] uppercase tracking-widest py-1 mb-2 rounded">
          {payload.test_label}
        </div>
      )}
      <div className={thermal ? "text-center mb-2" : "mb-3"}>
        <ReceiptLogo imageId={payload.business_logo_image_id} thermal={thermal} />
        <p className="font-black" style={{ fontSize: thermal ? 12 : 16 }}>{payload.business_name}</p>
        {payload.business_address && <p className="text-gray-600">{payload.business_address}</p>}
        {(payload.business_phone || payload.business_email) && (
          <p className="text-gray-600">{[payload.business_phone, payload.business_email].filter(Boolean).join(" · ")}</p>
        )}
      </div>
      <div className={thermal ? "border-t border-dashed border-gray-400 my-1.5" : "border-t border-gray-200 my-2"} />
      <p className="text-gray-500">Receipt #{payload.receipt_number}</p>
      {payload.client_name && <p className="text-gray-500">Client: {payload.client_name}</p>}
      {payload.dogs && payload.dogs.length > 0 && <p className="text-gray-500">Dog(s): {payload.dogs.join(", ")}</p>}
      {payload.staff_name && <p className="text-gray-500">Staff: {payload.staff_name}</p>}
      <div className={thermal ? "border-t border-dashed border-gray-400 my-1.5" : "border-t border-gray-200 my-2"} />
      {(payload.line_items || []).map((li, i) => (
        <div key={i} className="flex justify-between gap-2">
          <span>{li.description}{li.qty > 1 ? ` × ${li.qty}` : ""}</span>
          <span className="font-bold">{money(li.amount)}</span>
        </div>
      ))}
      {payload.public_price_note && (
        <p className="text-gray-500 mt-1">
          Public price: <span className="line-through">{money(payload.public_price_note.list_price)}</span> · Your price: {money(payload.public_price_note.effective_price)}
        </p>
      )}
      <div className={thermal ? "border-t border-dashed border-gray-400 my-1.5" : "border-t border-gray-200 my-2"} />
      <div className="flex justify-between font-black" style={{ fontSize: thermal ? 12 : 15 }}>
        <span>Total</span><span>{money(payload.invoice_total || payload.total || payload.payment_amount)}</span>
      </div>
      {payload.tendered_amount != null && (
        <>
          <div className="flex justify-between text-gray-500"><span>Cash received</span><span>{money(payload.tendered_amount)}</span></div>
          <div className="flex justify-between text-gray-500"><span>Change returned</span><span>{money(payload.change_given)}</span></div>
        </>
      )}
      {payload.remaining_prepaid_visits && (
        <p className="text-gray-500 mt-1">
          Visits remaining — Daycare: {payload.remaining_prepaid_visits.daycare ?? 0}, Training: {payload.remaining_prepaid_visits.training ?? 0}, Boarding: {payload.remaining_prepaid_visits.boarding ?? 0}
        </p>
      )}
      {payload.thank_you_message && <p className="mt-3 text-gray-600 italic">{payload.thank_you_message}</p>}
      {payload.policy_footer_message && <p className="mt-1 text-gray-400 text-[10px]">{payload.policy_footer_message}</p>}
    </div>
  );
}

export default function ReceiptSettingsPanel() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState(null);
  const [testPrinting, setTestPrinting] = useState(false);
  // Media lifecycle (same convention as ManageProductsPanel/CreditPacksSettings/
  // Programs.jsx) — the logo id this settings doc had BEFORE this screen
  // loaded. ShopImageUpload only ever deletes an id that's NOT this one, so
  // swapping/removing the logo before Save never destroys the still-live
  // published logo, and a not-yet-saved replacement is safely cleaned up.
  const [originalLogoId, setOriginalLogoId] = useState(null);

  const load = async () => {
    try {
      const [{ data: settings }, { data: prev }] = await Promise.all([
        api.get("/admin/receipt-settings"),
        api.get("/admin/receipts/preview"),
      ]);
      setForm(settings);
      setOriginalLogoId(settings.business_logo_image_id || null);
      setPreview(prev);
    } catch (e) { setErr(formatErr(e)); }
  };
  useEffect(() => { load(); }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true); setErr(""); setMsg("");
    try {
      await api.put("/admin/receipt-settings", form);
      // Save succeeded — now safe to drop the old logo, if it was replaced/removed.
      if (originalLogoId && originalLogoId !== form.business_logo_image_id) {
        api.delete(`/shop/media/${originalLogoId}`).catch(() => {});
      }
      setOriginalLogoId(form.business_logo_image_id || null);
      const { data: prev } = await api.get("/admin/receipts/preview");
      setPreview(prev);
      setMsg("Saved");
      setTimeout(() => setMsg(""), 2500);
    } catch (e) { setErr(formatErr(e)); } finally { setSaving(false); }
  };

  const printTest = async () => {
    setTestPrinting(true); setErr("");
    try {
      const { data } = await api.post("/admin/receipts/test-print", {});
      const result = await printReceipt(data.print_receipt_token);
      if (!result.ok) setErr(`Test print not sent to printer: ${result.error}`);
      else setMsg("Test receipt sent to the printer");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) { setErr(formatErr(e)); } finally { setTestPrinting(false); }
  };

  if (!form) return <div className="text-shTextMuted text-sm">Loading receipt settings…</div>;

  return (
    <div className="space-y-6" data-testid="receipt-settings-panel">
      <div>
        <h3 className="text-shText font-black text-lg uppercase tracking-tight">Receipts</h3>
        <p className="text-shTextMuted text-sm mt-1">
          Control what appears on printed and digital receipts. This never changes any amount a client is charged —
          every total always comes from the actual booking, payment, or Shop order.
        </p>
      </div>

      {err && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-3 rounded" data-testid="receipt-settings-error">{err}</div>}
      {msg && <div className="bg-shPrimary/10 border border-shPrimary/30 text-shPrimary text-sm p-3 rounded">{msg}</div>}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3">
            <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Business Info</p>
            <div>
              <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Business logo (optional)</label>
              <ShopImageUpload imageId={form.business_logo_image_id} originalImageId={originalLogoId}
                                onChange={(id) => set({ business_logo_image_id: id })} />
              <p className="text-[11px] text-shTextMuted mt-1">
                Printed thermal receipts show it in monochrome; if it doesn't print clearly, leave this blank and the business name is used instead.
              </p>
            </div>
            <div>
              <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Business display name</label>
              <input value={form.business_display_name || ""} onChange={(e) => set({ business_display_name: e.target.value })}
                     data-testid="receipt-business-name" className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Address</label>
              <input value={form.address || ""} onChange={(e) => set({ address: e.target.value })}
                     data-testid="receipt-address" className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Phone</label>
                <input value={form.phone || ""} onChange={(e) => set({ phone: e.target.value })}
                       data-testid="receipt-phone" className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Email</label>
                <input value={form.email || ""} onChange={(e) => set({ email: e.target.value })}
                       data-testid="receipt-email" className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Website</label>
              <input value={form.website || ""} onChange={(e) => set({ website: e.target.value })}
                     data-testid="receipt-website" className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Thank-you message</label>
              <input value={form.thank_you_message || ""} onChange={(e) => set({ thank_you_message: e.target.value })}
                     data-testid="receipt-thankyou" className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Policy / footer message</label>
              <input value={form.policy_footer_message || ""} onChange={(e) => set({ policy_footer_message: e.target.value })}
                     data-testid="receipt-policy" className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
          </div>

          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4">
            <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-1">Receipt Content</p>
            <Toggle label="Show client name" checked={form.show_client_name} onChange={(v) => set({ show_client_name: v })} testid="receipt-toggle-client-name" />
            <Toggle label="Show dog name(s)" checked={form.show_dog_names} onChange={(v) => set({ show_dog_names: v })} testid="receipt-toggle-dog-names" />
            <Toggle label="Show service dates" checked={form.show_service_dates} onChange={(v) => set({ show_service_dates: v })} testid="receipt-toggle-service-dates" />
            <Toggle label="Show staff name" checked={form.show_staff_name} onChange={(v) => set({ show_staff_name: v })} testid="receipt-toggle-staff-name" />
            <Toggle label="Show booking/order reference" checked={form.show_booking_reference} onChange={(v) => set({ show_booking_reference: v })} testid="receipt-toggle-booking-ref" />
            <Toggle label="Show remaining prepaid visits" checked={form.show_remaining_prepaid_visits} onChange={(v) => set({ show_remaining_prepaid_visits: v })} testid="receipt-toggle-remaining-visits" />
            <Toggle label="Show public price when a client-specific price was used"
                    help="Adds a line showing the normal price alongside what this client actually paid."
                    checked={form.show_public_price_when_override_used} onChange={(v) => set({ show_public_price_when_override_used: v })} testid="receipt-toggle-public-price" />
          </div>

          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4">
            <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-1">Delivery</p>
            <Toggle label="Automatically email receipts" checked={form.auto_email_receipts} onChange={(v) => set({ auto_email_receipts: v })} testid="receipt-toggle-auto-email" />
            <Toggle label="Automatically print receipts" help="Only applies where printing already works (front-desk hardware)."
                    checked={form.auto_print_receipts} onChange={(v) => set({ auto_print_receipts: v })} testid="receipt-toggle-auto-print" />
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving} data-testid="receipt-settings-save"
                    className="bg-shPrimary text-bgBase px-5 py-2.5 rounded font-black uppercase text-[13px] tracking-widest hover:bg-shPrimary/90 disabled:opacity-50">
              {saving ? "Saving…" : "Save Receipt Settings"}
            </button>
            <button onClick={printTest} disabled={testPrinting} data-testid="receipt-print-test"
                    className="border border-shBorder text-shText px-5 py-2.5 rounded font-black uppercase text-[13px] tracking-widest hover:border-shPrimary/60 disabled:opacity-50">
              <i className="fas fa-print mr-1" />{testPrinting ? "Printing…" : "Print Test Receipt"}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-2">Digital Receipt Preview</p>
            <ReceiptPreviewCard payload={preview?.digital} />
          </div>
          <div>
            <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-2">Thermal Receipt Preview</p>
            <ReceiptPreviewCard payload={preview?.thermal} thermal />
          </div>
        </div>
      </div>
    </div>
  );
}
