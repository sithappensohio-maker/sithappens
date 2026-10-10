// ThemeLivePreviewPane — Theme Studio's "Live Preview" panel. Renders a
// small, self-contained, tabbed mockup of three app surfaces (Client Portal /
// Staff Portal / Login) using a DRAFT (not-yet-saved) theme. This is a TRUE
// live reflection of the draft via real CSS vars scoped to a local wrapper
// div (never touches document.documentElement — that's the live global
// theme, this is just a preview of an in-progress edit).
import { useState } from "react";
import { themeAssetUrl, themeAssetLayeredValue } from "../../lib/theme";

const TABS = [
  { key: "client", label: "Client Portal" },
  { key: "staff", label: "Staff Portal" },
  { key: "login", label: "Login Page" },
];

export default function ThemeLivePreviewPane({ draft }) {
  const [surface, setSurface] = useState("client");

  const assetUrl = (slot, size) =>
    draft?.assets?.[slot] ? themeAssetUrl(draft.assets[slot], size) : null;

  const loginAccentUrl = assetUrl("loginAccent", "card");
  const cornerStickerUrl = assetUrl("cornerSticker", "card");
  const cardFrameUrl = assetUrl("cardFrame", "card");
  // Mirrors NeonEdge.jsx's own border-image logic (see its comment for why
  // this needs a real borderWidth change, not just swapping an image url)
  // at a smaller scale that fits this preview's tiny mock tiles.
  const cardFrameStyle = cardFrameUrl ? {
    borderWidth: "6px",
    borderStyle: "solid",
    borderImageSource: `url("${cardFrameUrl}")`,
    borderImageSlice: "64",
    borderImageWidth: "6px",
    borderImageOutset: "0",
    borderImageRepeat: "round",
  } : null;

  const scopedStyle = {
    "--sh-green": draft?.brand_primary,
    "--sh-blue": draft?.brand_accent,
    "--sh-orange": draft?.brand_warning,
    "--bg-base": draft?.theme_bg_base,
    "--bg-panel": draft?.theme_bg_panel,
    "--bg-header": draft?.theme_bg_header,
    "--bg-hover": draft?.theme_bg_hover,
    "--text-primary": draft?.theme_text_primary,
    "--text-muted": draft?.theme_text_muted,
    "--text-display": draft?.theme_text_display,
    "--card-glow-color": draft?.theme_glow_color || draft?.brand_accent,
    "--sh-font": draft?.brand_font_family === "System" ? "system-ui" : `'${draft?.brand_font_family || "Inter"}'`,
    "--sh-display": `'${draft?.brand_display_font_family || "Bowlby One SC"}', Impact, sans-serif`,
    // heroBackground/loginBackground get the same scrim gradient the real
    // app layers in (see themeAssetLayeredValue) so this preview matches
    // what actually renders, not just the raw uploaded image.
    "--theme-asset-hero-background": themeAssetLayeredValue("heroBackground", draft?.assets?.heroBackground, "card"),
    "--theme-asset-login-background": themeAssetLayeredValue("loginBackground", draft?.assets?.loginBackground, "card"),
    "--theme-asset-login-accent": loginAccentUrl ? `url("${loginAccentUrl}")` : "none",
    "--theme-asset-corner-sticker": cornerStickerUrl ? `url("${cornerStickerUrl}")` : "none",
  };

  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-4" data-testid="theme-live-preview">
      <div className="flex items-center gap-2">
        <i className="fas fa-eye text-shSecondary" />
        <span className="text-xs font-black text-shSecondary uppercase tracking-widest">LIVE PREVIEW</span>
      </div>
      <p className="text-[13px] text-shTextMuted mt-1 mb-3">
        See how your theme looks across different areas of your app.
      </p>

      <div className="flex gap-2 mb-3">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            data-testid={`theme-preview-tab-${tab.key}`}
            onClick={() => setSurface(tab.key)}
            aria-pressed={surface === tab.key}
            className={
              surface === tab.key
                ? "px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest bg-shPrimary text-bgHeader"
                : "px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest border border-shBorder text-shTextMuted hover:text-shText"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className="rounded-lg overflow-hidden border border-shBorder h-[320px]"
        style={{ ...scopedStyle, fontFamily: "var(--sh-font)" }}
        data-testid="theme-preview-surface"
      >
        {surface === "client" && <ClientPortalMock assetUrl={assetUrl} cardFrameStyle={cardFrameStyle} />}
        {surface === "staff" && <StaffPortalMock cardFrameStyle={cardFrameStyle} />}
        {surface === "login" && <LoginPageMock assetUrl={assetUrl} loginAccentUrl={loginAccentUrl} />}
      </div>
    </div>
  );
}

function ClientPortalMock({ assetUrl, cardFrameStyle }) {
  const heroUrl = assetUrl("heroBackground", "card");
  return (
    <div className="flex h-full">
      <div className="w-12 bg-bgHeader flex flex-col items-center gap-3 py-3">
        <i className="fas fa-house text-shTextMuted text-sm" />
        <i className="fas fa-calendar text-shTextMuted text-sm" />
        <i className="fas fa-bag-shopping text-shTextMuted text-sm" />
        <i className="fas fa-camera text-shTextMuted text-sm" />
      </div>
      <div className="flex-1 p-3 overflow-hidden" style={{ backgroundColor: "var(--bg-base)" }}>
        <div
          className="rounded h-16 mb-2 flex items-center px-3"
          style={{
            backgroundImage: heroUrl ? `url("${heroUrl}")` : undefined,
            backgroundSize: "cover",
            backgroundColor: "var(--bg-panel)",
          }}
        >
          <span className="font-black text-sm" style={{ color: "var(--text-display)", fontFamily: "var(--sh-display)" }}>
            Welcome back!
          </span>
        </div>
        <div className="flex gap-2">
          {[
            { icon: "fa-calendar-plus", label: "Book Now" },
            { icon: "fa-bag-shopping", label: "Shop" },
            { icon: "fa-camera", label: "Photography" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex-1 rounded p-2 text-center"
              style={{ backgroundColor: "var(--bg-panel)", ...(cardFrameStyle || { border: "1px solid var(--card-glow-color)" }) }}
            >
              <i className={`fas ${item.icon} text-xs`} style={{ color: "var(--text-primary)" }} />
              <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StaffPortalMock({ cardFrameStyle }) {
  return (
    <div className="flex h-full">
      <div className="w-12 bg-bgHeader flex flex-col items-center gap-3 py-3">
        <i className="fas fa-clipboard-list text-shTextMuted text-sm" />
        <i className="fas fa-calendar-check text-shTextMuted text-sm" />
        <i className="fas fa-dollar-sign text-shTextMuted text-sm" />
      </div>
      <div className="flex-1 p-3 overflow-hidden" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="flex gap-2 mb-2">
          {[
            { value: "7", label: "Dogs Here" },
            { value: "3", label: "Arriving" },
            { value: "$240", label: "Amount Due" },
          ].map((tile) => (
            <div key={tile.label} className="flex-1 rounded p-2 text-center" style={{ backgroundColor: "var(--bg-panel)", ...(cardFrameStyle || {}) }}>
              <div className="text-lg font-black" style={{ color: "var(--sh-green)" }}>
                {tile.value}
              </div>
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {tile.label}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          {["2 vaccine uploads pending", "1 payment needs retry"].map((row) => (
            <div key={row} className="rounded px-2 py-1.5 flex items-center justify-between" style={{ backgroundColor: "var(--bg-panel)" }}>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {row}
              </span>
              <span
                className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded"
                style={{ backgroundColor: "var(--bg-hover)", color: "var(--text-primary)" }}
              >
                Open
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoginPageMock({ assetUrl, loginAccentUrl }) {
  const loginBgUrl = assetUrl("loginBackground", "card");
  return (
    <div
      className="h-full flex items-center justify-center"
      style={{
        backgroundImage: loginBgUrl ? `url("${loginBgUrl}")` : undefined,
        backgroundSize: "cover",
        backgroundColor: "var(--bg-base)",
      }}
    >
      <div className="mx-auto my-auto rounded p-3 w-40" style={{ backgroundColor: "var(--bg-panel)" }}>
        <div className="flex justify-center mb-2">
          {loginAccentUrl ? (
            <img src={loginAccentUrl} alt="" className="w-8 h-8 rounded object-cover" />
          ) : (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "var(--sh-green)" }}
            >
              <i className="fas fa-paw text-white text-xs" />
            </div>
          )}
        </div>
        <div className="text-center text-[11px] font-black" style={{ color: "var(--text-display)", fontFamily: "var(--sh-display)" }}>
          Sign in to Sit Happens
        </div>
        <div className="h-5 rounded mt-1.5" style={{ backgroundColor: "var(--bg-base)", border: "1px solid var(--bg-hover)" }} />
        <div className="h-5 rounded mt-1.5" style={{ backgroundColor: "var(--bg-base)", border: "1px solid var(--bg-hover)" }} />
        <div className="h-6 rounded mt-2 bg-shGreen" />
      </div>
    </div>
  );
}
