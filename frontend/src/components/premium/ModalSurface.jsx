/* Reusable client-portal modal/drawer shell — near-black raised surface,
 * soft shadow, subtle illuminated edge, clean close button. Replaces
 * ad-hoc bright/white modal containers screen-by-screen. Callers keep
 * their own form logic/state; this only supplies the chrome. */
export default function ModalSurface({ title, onClose, children, footer, maxWidth = "max-w-md", testId }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)" }}>
      <div
        data-testid={testId}
        className={`relative w-full ${maxWidth} rounded-2xl border border-shBorder shadow-sh max-h-[90vh] flex flex-col overflow-hidden`}
        style={{ background: "var(--sh-card-base)" }}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-shBorder shrink-0">
          <h2 className="text-[16px] font-bold text-shText">{title}</h2>
          {onClose && (
            <button type="button" onClick={onClose} data-testid="modal-close" className="w-8 h-8 rounded-full grid place-items-center text-shTextMuted hover:text-shText hover:bg-shSurfaceRaised transition">
              <i className="fas fa-xmark" />
            </button>
          )}
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-shBorder shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
