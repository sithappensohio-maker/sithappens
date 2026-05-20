// Tiny "Sit Happens" footer pill in the bottom-right corner — replaces the
// Emergent badge that used to live there. Uses brand CSS vars so it recolors
// automatically when admin changes Brand & Theme. Hidden on small screens
// (< 640px) so it doesn't fight for thumb real-estate on mobile.

export default function BrandFooter() {
  return (
    <a
      href="https://sithappens.app"
      target="_blank"
      rel="noopener noreferrer"
      data-testid="brand-footer"
      className="hidden sm:inline-flex fixed bottom-4 right-4 z-50 items-center gap-2 px-3 py-2 rounded-full bg-bgHeader/90 border border-bgHover hover:border-shGreen text-gray-400 hover:text-shGreen transition backdrop-blur-sm shadow-lg"
      style={{ fontSize: "11px", letterSpacing: "0.15em" }}
    >
      <i className="fas fa-paw text-shGreen" />
      <span className="font-black uppercase tracking-widest">Sit Happens</span>
    </a>
  );
}
