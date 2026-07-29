import { useState } from "react";
import InstallAppButton from "./InstallAppButton";

/* Redesign Phase B — collapses the old row of permanent header buttons
 * (How to Use / Install / Logout) into one profile menu. Logout no longer
 * needs to be a giant always-visible red button; it's still exactly the
 * same `logout()` call, just one tap further behind an intentional menu. */
export default function ClientProfileMenu({ name, showHelp, onHelp, onLogout }) {
  const [open, setOpen] = useState(false);
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="client-profile-menu-button"
        aria-label="Account menu"
        className="flex items-center gap-2 h-9 pl-1 pr-2.5 rounded-full border border-shBorder text-shText hover:border-shPrimary/50 transition"
        style={{ background: "var(--sh-card-base)" }}
      >
        <span className="w-7 h-7 rounded-full bg-shPrimary/20 text-shPrimary text-[12px] font-black grid place-items-center"
              style={{ boxShadow: "0 0 10px -3px rgba(140,198,63,0.6)" }}>
          {initial}
        </span>
        <i className="fas fa-chevron-down text-[10px] text-shTextMuted"/>
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 mt-2 w-56 z-50 rounded-xl border border-shBorder shadow-sh overflow-hidden"
            style={{ background: "var(--sh-card-base)" }}
            data-testid="client-profile-menu"
          >
            <div className="px-4 py-3 border-b border-shBorder">
              <p className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Signed in</p>
              <p className="text-shText text-[14px] font-bold truncate">{name}</p>
            </div>
            {showHelp && (
              <button
                onClick={() => { setOpen(false); onHelp(); }}
                data-testid="client-profile-menu-help"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-shSecondary hover:bg-shSurfaceRaised text-[13px] font-bold text-left"
              >
                <i className="fas fa-circle-question w-4 text-center" />
                How to Use
              </button>
            )}
            <InstallAppButton
              testid="client-profile-menu-install"
              label="Install App"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-shPrimary hover:bg-shSurfaceRaised text-[13px] font-bold text-left"
            />
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              data-testid="logout-button"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-red-400 hover:bg-shDanger/10 text-[13px] font-bold text-left border-t border-shBorder"
            >
              <i className="fas fa-right-from-bracket w-4 text-center" />
              Logout
            </button>
          </div>
        </>
      )}
    </div>
  );
}
