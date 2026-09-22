/* Stage 2 — where "when do I pay?" is answered, and where it deliberately isn't.
 *
 * The payment timing string is resolved once on the server
 * (backend/domains/payment_timing) and every client surface prints what it is
 * told. These tests pin two things the UI used to get wrong:
 *
 *   1. A service tile asserted "Pay-on-the-day" for anything that wasn't
 *      credit-eligible. That was a payment policy inferred from the service
 *      type, not the one the operator configured.
 *   2. Timing belongs on bookings the customer still has ahead of them. On a
 *      finished visit it is noise at best and a false demand at worst.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import ServicesByCategory from "../components/ServicesByCategory";
import { upcomingPaymentNote } from "../screens/Portal";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(() => Promise.resolve({ data: [] })), post: jest.fn(() => Promise.resolve({ data: {} })), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const svc = (over = {}) => ({
  id: "s1", name: "Daycare", service_type: "daycare", base_price: 45, active: true,
  payment: {
    timing: "at_pickup", short: "Pay at pickup",
    detail: "Nothing to pay now — payment is taken when you collect your dog.",
    enforced: false, collects_payment_during_booking: false,
  },
  ...over,
});

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    text: () => host.textContent || "",
    testId: (id) => host.querySelector(`[data-testid="${id}"]`),
    cleanup: () => { act(() => root.unmount()); host.remove(); },
  };
}

describe("the service tile prints the configured timing, not an inferred one", () => {
  test("the old inferred 'Pay-on-the-day' badge is gone", () => {
    // service_type "other" is not credit-eligible, which is exactly the case
    // that used to hardcode "Pay-on-the-day".
    const w = mount(<ServicesByCategory services={[svc({ service_type: "other", id: "s9" })]} programs={[]} />);
    expect(w.text()).not.toMatch(/pay-on-the-day/i);
    expect(w.testId("portal-service-payment-s9").textContent.trim()).toBe("Pay at pickup");
    w.cleanup();
  });

  test("credit-eligibility and timing are separate facts, both shown", () => {
    const w = mount(<ServicesByCategory services={[svc()]} programs={[]} />);
    expect(w.text()).toMatch(/credit-eligible/i);
    expect(w.testId("portal-service-payment-s1").textContent.trim()).toBe("Pay at pickup");
    w.cleanup();
  });

  test("a service the server said nothing about stays silent", () => {
    // No invented fallback: saying nothing is correct, guessing is not.
    const w = mount(<ServicesByCategory services={[svc({ id: "s2", payment: undefined })]} programs={[]} />);
    expect(w.testId("portal-service-payment-s2")).toBeNull();
    expect(w.text()).not.toMatch(/pay-on-the-day/i);
    w.cleanup();
  });
});

describe("booking rows answer the question only while it is still open", () => {
  const services = [
    { id: "svc-day", service_type: "daycare", payment: { short: "Pay at drop-off" } },
    { id: "svc-board", service_type: "boarding", payment: { short: "Invoice sent separately" } },
  ];

  test("upcoming bookings carry the timing", () => {
    expect(upcomingPaymentNote({ status: "approved", service_id: "svc-day" }, services)).toBe("Pay at drop-off");
    expect(upcomingPaymentNote({ status: "pending", service_id: "svc-board" }, services)).toBe("Invoice sent separately");
  });

  test("finished and cancelled bookings do not", () => {
    for (const status of ["completed", "cancelled", "rejected"]) {
      expect(upcomingPaymentNote({ status, service_id: "svc-day" }, services)).toBeNull();
    }
  });

  test("it falls back to the service type when the booking has no service id", () => {
    expect(upcomingPaymentNote({ status: "approved", service_type: "boarding" }, services))
      .toBe("Invoice sent separately");
  });

  test("an unknown service says nothing rather than borrowing another one's answer", () => {
    expect(upcomingPaymentNote({ status: "approved", service_id: "nope" }, services)).toBeNull();
    expect(upcomingPaymentNote({ status: "approved", service_type: "grooming" }, services)).toBeNull();
    expect(upcomingPaymentNote({ status: "approved" }, [])).toBeNull();
    expect(upcomingPaymentNote({}, services)).toBeNull();
  });
});
