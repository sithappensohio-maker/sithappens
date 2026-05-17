import React from "react";
import { endImpersonation, getImpersonationMeta, isImpersonating } from "../lib/impersonation";

/**
 * Sticky banner that appears at the top of the page whenever an admin is
 * "viewing as" a client. Clicking "Return to Admin" restores the admin
 * session and reloads.
 */
export default function ImpersonationBanner() {
  if (!isImpersonating()) return null;
  const meta = getImpersonationMeta() || {};
  return (
    <div className="sticky top-0 z-[100] bg-yellow-500 text-black px-4 py-2 flex items-center justify-between gap-3 shadow-lg" data-testid="impersonation-banner">
      <div className="flex items-center gap-2 text-[12px] sm:text-[13px] font-black uppercase tracking-widest min-w-0">
        <i className="fas fa-user-shield shrink-0"/>
        <span className="truncate">Viewing portal as <span className="underline">{meta.client_name || "client"}</span> · read-only preview</span>
      </div>
      <button
        onClick={endImpersonation}
        data-testid="end-impersonation-btn"
        className="shrink-0 bg-black/15 hover:bg-black/30 text-black font-black uppercase tracking-widest text-[11px] sm:text-[12px] px-3 py-1.5 rounded transition"
      >
        <i className="fas fa-arrow-left mr-1"/>Return to Admin
      </button>
    </div>
  );
}
