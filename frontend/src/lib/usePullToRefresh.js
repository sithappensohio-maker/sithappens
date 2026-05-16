/**
 * usePullToRefresh — native-feel pull-to-refresh for mobile.
 *
 * Wires a touch listener to the scrolling container, tracks downward drag
 * while scrollTop === 0, and fires `onRefresh()` when released past threshold.
 * Returns { pulling, progress } so the caller can render a spinner indicator.
 *
 * Usage:
 *   const scrollRef = useRef(null);
 *   const { pulling, progress } = usePullToRefresh(scrollRef, refresh);
 *   <div ref={scrollRef} className="overflow-y-auto">…</div>
 *   {pulling && <RefreshSpinner progress={progress} />}
 */
import { useEffect, useState } from "react";

const THRESHOLD = 70; // px to trigger
const MAX = 120;      // px max pull distance

export default function usePullToRefresh(scrollSource, onRefresh) {
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("ontouchstart" in window)) return; // skip on non-touch devices

    // Accept either a ref-style object {current: el}, a DOM element, or a selector string.
    const el =
      typeof scrollSource === "string"
        ? document.querySelector(scrollSource)
        : scrollSource && "current" in scrollSource
          ? scrollSource.current
          : scrollSource;
    if (!el) return;

    let startY = 0;
    let pullDist = 0;
    let armed = false;

    const onStart = (e) => {
      if (el.scrollTop > 0) { armed = false; return; }
      armed = true;
      startY = e.touches[0].clientY;
      pullDist = 0;
    };
    const onMove = (e) => {
      if (!armed) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) { setPulling(false); setProgress(0); return; }
      pullDist = Math.min(dy, MAX);
      setPulling(true);
      setProgress(Math.min(pullDist / THRESHOLD, 1));
      // prevent scroll bounce on iOS while pulling
      if (dy > 4) e.preventDefault?.();
    };
    const onEnd = async () => {
      if (!armed) return;
      armed = false;
      const fire = pullDist >= THRESHOLD;
      setPulling(false);
      setProgress(0);
      pullDist = 0;
      if (fire) {
        try { await onRefresh?.(); } catch { /* ignore */ }
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scrollSource, onRefresh]);

  return { pulling, progress };
}

export function RefreshSpinner({ progress = 0, pulling = false }) {
  return (
    <div
      data-testid="pull-to-refresh-spinner"
      className="absolute top-0 left-0 right-0 flex items-center justify-center pointer-events-none z-20 transition-opacity"
      style={{
        opacity: pulling ? 1 : 0,
        transform: `translateY(${Math.min(progress, 1) * 36}px)`,
      }}
    >
      <div
        className="bg-bgPanel border border-bgHover rounded-full w-9 h-9 flex items-center justify-center shadow-lg"
        style={{ transform: `rotate(${progress * 360}deg)` }}
      >
        <i className={`fas fa-arrow-down text-shGreen text-[13px] transition-transform ${progress >= 1 ? "rotate-180" : ""}`} />
      </div>
    </div>
  );
}
