// Sprint 110cm — Helper used by Clients/Dogs screens (and any future list
// screen) when a search result is "navigated to". Instead of yanking the user
// into a modal automatically, we scroll the matching card into view and pulse
// it briefly so the operator can see exactly where it lives in the list — then
// they decide whether to click in.
//
// Usage:
//   useEffect(() => {
//     if (!focusId) return;
//     scrollToCardAndFlash(`card-id-${focusId}`).then(onConsumed);
//   }, [focusId, items]);
export function scrollToCardAndFlash(testId, { attempts = 20, gap = 50 } = {}) {
  return new Promise((resolve) => {
    let n = 0;
    const tryFind = () => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (el) {
        try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { el.scrollIntoView(); }
        // Restart the animation in case the class was already there.
        el.classList.remove("search-flash");
        // Force a reflow so re-adding the class restarts the keyframes.
        // eslint-disable-next-line no-unused-expressions
        el.offsetWidth;
        el.classList.add("search-flash");
        setTimeout(() => el.classList.remove("search-flash"), 2000);
        resolve(true);
        return;
      }
      if (++n < attempts) setTimeout(tryFind, gap);
      else resolve(false);
    };
    tryFind();
  });
}
