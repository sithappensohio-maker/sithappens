/* Sprint 110di-25 — Viewport-gated mount helper.

Wraps any child so the child only renders (and therefore only fires its
useEffect data-fetches) once the wrapper scrolls within `rootMargin` of
the viewport. With long lists (e.g. 239 dog cards each containing 3 chatty
sub-components), this turns ~1,200 simultaneous network requests on page
load into ~45 (only the cards actually visible on screen), eliminating
the net::ERR_INSUFFICIENT_RESOURCES storm that broke the /dogs screen.

Once a card has been mounted we keep it mounted (no remount churn when
the user scrolls away and back). That's why the IntersectionObserver
disconnects after the first `isIntersecting=true`. */
import { useEffect, useRef, useState } from "react";

export default function LazyMount({
  children,
  placeholder = null,
  rootMargin = "200px",  // start loading 200px before scrolling into view
  minHeight = "48px",    // reserve vertical space so scroll position stays stable
  testid,
}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const node = ref.current;
    if (!node) return;
    // Defensive — old browsers / SSR shouldn't crash; default to mounting.
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            obs.disconnect();
            break;
          }
        }
      },
      { root: null, rootMargin, threshold: 0.01 }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [shown, rootMargin]);

  return (
    <div ref={ref} data-testid={testid} style={shown ? undefined : { minHeight }}>
      {shown ? children : placeholder}
    </div>
  );
}
