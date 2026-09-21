/**
 * Hand the browser over to an external URL — in practice, Stripe Checkout.
 *
 * Its own module purely so it can be observed: jsdom refuses to let a test
 * redefine `window.location`, so a component that assigns to it directly
 * cannot be tested for where it actually sends somebody. That matters here,
 * because "did we send the customer to the real payment page" is exactly the
 * kind of thing that must not silently break.
 */
export function goTo(url) {
  window.location.href = url;
}
