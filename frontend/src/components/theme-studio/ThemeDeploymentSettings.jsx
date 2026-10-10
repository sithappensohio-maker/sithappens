const INTENSITY_LEVELS = ["subtle", "standard", "bold"];
const INTENSITY_LABELS = { subtle: "Subtle", standard: "Standard", bold: "Bold" };

export default function ThemeDeploymentSettings({
  enabledTargets,
  onToggleTarget,
  startDate,
  endDate,
  onChangeStartDate,
  onChangeEndDate,
  intensity,
  onChangeIntensity,
  animationEnabled,
  onToggleAnimation,
}) {
  const intensityIndex = Math.max(0, INTENSITY_LEVELS.indexOf(intensity));

  return (
    <div className="space-y-4" data-testid="theme-deployment-settings">
      <div>
        <h3 className="text-xs font-black text-shSecondary uppercase tracking-widest">
          Deployment Settings
        </h3>
        <p className="text-[13px] text-shTextMuted mt-1">
          Choose when this theme will be applied and when.
        </p>
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-3">
        <div className="text-[11px] font-black text-shTextMuted uppercase tracking-widest mb-2">
          Enable Theme On
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-shPrimary w-4 h-4"
              checked={!!enabledTargets?.client_portal}
              onChange={(e) => onToggleTarget("client_portal", e.target.checked)}
              data-testid="theme-deploy-target-client_portal"
            />
            <span className="text-sm text-shText">Client Portal</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-shPrimary w-4 h-4"
              checked={!!enabledTargets?.staff_portal}
              onChange={(e) => onToggleTarget("staff_portal", e.target.checked)}
              data-testid="theme-deploy-target-staff_portal"
            />
            <span className="text-sm text-shText">Staff Portal</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-shPrimary w-4 h-4"
              checked={!!enabledTargets?.login}
              onChange={(e) => onToggleTarget("login", e.target.checked)}
              data-testid="theme-deploy-target-login"
            />
            <span className="text-sm text-shText">Login Page</span>
          </label>
        </div>
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-3">
        <div className="text-[11px] font-black text-shTextMuted uppercase tracking-widest mb-2">
          Active Dates (Optional)
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="theme-deploy-start-date" className="block text-[11px] text-shTextMuted mb-1">Start Date</label>
            <input
              id="theme-deploy-start-date"
              type="date"
              className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded px-2 py-1.5 text-sm text-shText"
              value={startDate || ""}
              onChange={(e) => onChangeStartDate(e.target.value || null)}
              data-testid="theme-deploy-start-date"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="theme-deploy-end-date" className="block text-[11px] text-shTextMuted mb-1">End Date</label>
            <input
              id="theme-deploy-end-date"
              type="date"
              className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded px-2 py-1.5 text-sm text-shText"
              value={endDate || ""}
              onChange={(e) => onChangeEndDate(e.target.value || null)}
              data-testid="theme-deploy-end-date"
            />
          </div>
        </div>
        <p className="text-[11px] text-shTextMuted mt-1">
          Leave both blank to keep this theme on indefinitely once activated.
        </p>
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-3">
        <div className="text-[11px] font-black text-shTextMuted uppercase tracking-widest mb-2">
          Theme Intensity
        </div>
        <div className="text-shPrimary font-black text-sm mb-1">
          {INTENSITY_LABELS[INTENSITY_LEVELS[intensityIndex]]}
        </div>
        <div className="flex items-center justify-between text-[11px] text-shTextMuted uppercase tracking-widest mb-1">
          <span>Subtle</span>
          <span>Bold</span>
        </div>
        <input
          type="range"
          min="0"
          max="2"
          step="1"
          className="w-full accent-shPrimary"
          value={intensityIndex}
          onChange={(e) => onChangeIntensity(INTENSITY_LEVELS[Number(e.target.value)])}
          aria-label="Theme intensity"
          aria-valuetext={INTENSITY_LABELS[INTENSITY_LEVELS[intensityIndex]]}
          data-testid="theme-deploy-intensity"
        />

        <div className="mt-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-shPrimary w-4 h-4"
              checked={!!animationEnabled}
              onChange={(e) => onToggleAnimation(e.target.checked)}
              data-testid="theme-deploy-animation-toggle"
            />
            <span className="text-sm text-shText">Play GIF / Animation</span>
          </label>
          <p className="text-[11px] text-shTextMuted mt-1">
            When off, this theme's animation slot is not shown even if an image is uploaded there.
          </p>
        </div>
      </div>
    </div>
  );
}
