/* Stage 2 — the admin control for WHEN payment is expected.
 *
 * Two things have to stay true here or the setting becomes a way to lie to
 * customers:
 *
 *   1. The two enforced modes ("pay online now", "deposit required") are
 *      visible but not selectable. Hiding them would leave an operator
 *      wondering whether the app can do it at all; enabling them would have
 *      the site telling customers to pay during a booking flow that collects
 *      nothing. The server refuses them too (PUT /settings -> 422) — this UI
 *      is the explanation, not the guard.
 *   2. This control answers "when am I expected to pay". Settings -> Payment
 *      Options answers "how can I pay". They are not the same question and
 *      must not read as one setting.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import PaymentTimingSelect, {
  PAYMENT_TIMING_OPTIONS, PAYMENT_TIMING_UNSUPPORTED, UNSUPPORTED_REASON,
} from "../components/PaymentTimingSelect";

global.IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    text: () => host.textContent || "",
    select: () => host.querySelector("select"),
    options: () => [...host.querySelectorAll("option")],
    cleanup: () => { act(() => root.unmount()); host.remove(); },
  };
}

describe("the four supported timings are offered", () => {
  test("each one is selectable and reads as customer-facing words", () => {
    const w = mount(<PaymentTimingSelect value="none_at_booking" onChange={() => {}} testId="t" />);
    const selectable = w.options().filter((o) => !o.disabled).map((o) => o.value);
    for (const opt of PAYMENT_TIMING_OPTIONS) {
      expect(selectable).toContain(opt.value);
      expect(opt.label.length).toBeGreaterThan(5);
      expect(opt.hint).toMatch(/customer sees/i);
    }
    expect(PAYMENT_TIMING_OPTIONS).toHaveLength(4);
    w.cleanup();
  });
});

describe("the enforced timings are shown but cannot be chosen", () => {
  test("they render disabled, labelled, and with the reason on screen", () => {
    const w = mount(<PaymentTimingSelect value="none_at_booking" onChange={() => {}} testId="t" />);
    for (const opt of PAYMENT_TIMING_UNSUPPORTED) {
      const el = w.options().find((o) => o.value === opt.value);
      expect(el).toBeTruthy();
      expect(el.disabled).toBe(true);
      expect(el.textContent).toMatch(/not available yet/i);
    }
    expect(w.text()).toContain(UNSUPPORTED_REASON);
    w.cleanup();
  });

  test("the reason says why, not just that it is off", () => {
    expect(UNSUPPORTED_REASON).toMatch(/does(n't| not) collect payment/i);
  });
});

describe("when is not how", () => {
  test("the control names the question it answers", () => {
    const w = mount(<PaymentTimingSelect value="at_pickup" onChange={() => {}} testId="t" />);
    expect(w.text()).toMatch(/when payment is expected/i);
    // It must not present itself as the payment-method setting.
    expect(w.text()).not.toMatch(/venmo|credit card|cash app/i);
    w.cleanup();
  });
});

describe("a per-service override can defer to the category default", () => {
  test("allowInherit adds an explicit inherit option naming what it inherits", () => {
    const w = mount(
      <PaymentTimingSelect value={null} inheritedValue="at_dropoff" allowInherit onChange={() => {}} testId="t" />
    );
    const inherit = w.options().find((o) => o.value === "");
    expect(inherit).toBeTruthy();
    expect(inherit.textContent).toMatch(/category default/i);
    // Naming the inherited value matters: "use default" alone hides what the
    // customer will actually be told.
    expect(inherit.textContent).toMatch(/pay at drop-off/i);
    w.cleanup();
  });

  test("without allowInherit there is no blank choice to fall into", () => {
    const w = mount(<PaymentTimingSelect value="at_pickup" onChange={() => {}} testId="t" />);
    expect(w.options().find((o) => o.value === "")).toBeUndefined();
    w.cleanup();
  });
});
