import { useState } from "react";
import { createPortal } from "react-dom";

// Printify print-on-demand — a cart with one of these items needs this
// choice before payment: pick it up here once it's produced, or have
// Printify ship it straight to the customer. The server refuses the sale
// without this (see _create_pos_sale_impl), so this gates opening the
// tender panel rather than being just a receipt-side note.
const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY",
];

const BLANK_ADDRESS = {
  first_name: "", last_name: "", email: "", phone: "",
  address1: "", address2: "", city: "", region: "OH", zip: "",
};

export default function PrintifyFulfillmentModal({ onClose, onConfirm, initial = null }) {
  const [method, setMethod] = useState(initial?.method || "pickup");
  const [address, setAddress] = useState(initial?.shipping_address || BLANK_ADDRESS);

  const addressReady = address.first_name.trim() && address.last_name.trim() && address.email.trim()
    && address.address1.trim() && address.city.trim() && address.region.trim() && address.zip.trim();
  const ready = method === "pickup" || addressReady;

  const confirm = () => {
    if (!ready) return;
    onConfirm({
      method,
      shipping_address: method === "ship" ? { ...address, country: "US" } : null,
    });
  };

  const field = "w-full min-h-[44px] bg-black/20 border border-shBorder/60 rounded-lg px-3 text-shText text-[14px] focus:outline-none focus:border-shSecondary/50";
  const label = "block text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1";
  const set = (key) => (e) => setAddress((a) => ({ ...a, [key]: e.target.value }));

  return createPortal((
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[120] overflow-y-auto"
         onClick={onClose} data-testid="printify-fulfillment-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-5 w-full max-w-md shadow-2xl my-8"
           onClick={(e) => e.stopPropagation()}>
        <h4 className="text-lg font-black text-shText uppercase italic">Printify Fulfillment</h4>
        <p className="text-[12.5px] text-shTextMuted mt-1 mb-4 leading-relaxed">
          This cart includes a print-on-demand item — it's made after this sale, not handed over today.
          How should it reach the customer?
        </p>

        <div className="flex gap-2 mb-4">
          <button type="button" onClick={() => setMethod("pickup")} data-testid="printify-method-pickup"
                  className={`flex-1 rounded-lg px-3 py-2.5 text-[12px] font-black uppercase tracking-widest ${method === "pickup" ? "bg-shPrimary text-bgHeader" : "bg-black/10 border border-shBorder text-shTextMuted"}`}>
            <i className="fas fa-store mr-1.5"/>Pick Up Here
          </button>
          <button type="button" onClick={() => setMethod("ship")} data-testid="printify-method-ship"
                  className={`flex-1 rounded-lg px-3 py-2.5 text-[12px] font-black uppercase tracking-widest ${method === "ship" ? "bg-shPrimary text-bgHeader" : "bg-black/10 border border-shBorder text-shTextMuted"}`}>
            <i className="fas fa-truck mr-1.5"/>Ship to Them
          </button>
        </div>

        {method === "pickup" ? (
          <p className="text-[11.5px] text-shTextMuted leading-relaxed">
            <i className="fas fa-circle-info mr-1.5 text-shSecondary" aria-hidden="true"/>
            Ships to the business — you'll get the usual pickup-ready notice once it arrives.
          </p>
        ) : (
          <div className="space-y-3" data-testid="printify-ship-address">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>First name <span className="text-shAccent">*</span></label>
                <input value={address.first_name} onChange={set("first_name")} className={field} data-testid="printify-first-name"/>
              </div>
              <div>
                <label className={label}>Last name <span className="text-shAccent">*</span></label>
                <input value={address.last_name} onChange={set("last_name")} className={field} data-testid="printify-last-name"/>
              </div>
            </div>
            <div>
              <label className={label}>Email <span className="text-shAccent">*</span></label>
              <input value={address.email} onChange={set("email")} inputMode="email"
                     placeholder="For Printify's own shipping confirmation" className={field} data-testid="printify-email"/>
            </div>
            <div>
              <label className={label}>Phone</label>
              <input value={address.phone} onChange={set("phone")} inputMode="tel"
                     placeholder="Optional" className={field} data-testid="printify-phone"/>
            </div>
            <div>
              <label className={label}>Address <span className="text-shAccent">*</span></label>
              <input value={address.address1} onChange={set("address1")} placeholder="Street address" className={field} data-testid="printify-address1"/>
            </div>
            <div>
              <input value={address.address2} onChange={set("address2")} placeholder="Apt, suite, etc. (optional)" className={field} data-testid="printify-address2"/>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={label}>City <span className="text-shAccent">*</span></label>
                <input value={address.city} onChange={set("city")} className={field} data-testid="printify-city"/>
              </div>
              <div>
                <label className={label}>State <span className="text-shAccent">*</span></label>
                <select value={address.region} onChange={set("region")} className={field} data-testid="printify-region">
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>ZIP <span className="text-shAccent">*</span></label>
                <input value={address.zip} onChange={set("zip")} inputMode="numeric" className={field} data-testid="printify-zip"/>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} data-testid="printify-fulfillment-cancel"
                  className="flex-1 min-h-[44px] rounded-lg border border-shBorder text-shTextMuted font-black text-[12px] uppercase tracking-widest hover:text-shText">
            Cancel
          </button>
          <button onClick={confirm} disabled={!ready} data-testid="printify-fulfillment-continue"
                  className="flex-[2] min-h-[44px] rounded-lg bg-shPrimary text-bgHeader font-black text-[12px] uppercase tracking-widest disabled:opacity-40">
            Continue to Payment
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
