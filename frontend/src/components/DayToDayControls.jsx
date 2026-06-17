// ───────────────────────────────────────────────────────────────────────
// Sprint 110dm — Day-to-day operator controls.
// One self-contained block of 9 settings sections that gives the admin
// absolute day-to-day control over money rules, seasonal surcharges,
// booking guardrails, communication lead times, loyalty/referral rewards,
// vaccine/waiver compliance, service-specific defaults, finance/bookkeeping
// preferences, and branding/UI knobs. Every input is one of: number, text,
// select, toggle, date range, or repeatable row.
//
// Renders ONE rolled-up section that expands into the 9 sub-sections,
// each collapsible so the admin can focus on one area at a time.
// Reads from `settings.day_to_day` and writes back via the existing
// `set("day_to_day", { ...currentVal, [section]: { ...sectionVal, [key]: val } })`
// pattern (no JSX changes outside this file).
// ───────────────────────────────────────────────────────────────────────
import { useState } from "react";

const Field = ({ label, type = "text", value, onChange, hint, testId, options, placeholder }) => {
  if (type === "select") {
    return (
      <label className="block">
        <span className="block text-[12px] font-black text-gray-400 uppercase tracking-widest mb-1">{label}</span>
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} data-testid={testId}
                className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
          {(options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
      </label>
    );
  }
  if (type === "toggle") {
    return (
      <label className="flex items-center gap-3 cursor-pointer py-1">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)}
               data-testid={testId} className="accent-shGreen w-4 h-4" />
        <span className="text-[14px] font-black uppercase tracking-widest text-gray-300">{label}</span>
        {hint && <span className="text-[11px] text-gray-500 normal-case font-normal">{hint}</span>}
      </label>
    );
  }
  const isNum = type === "number";
  return (
    <label className="block">
      <span className="block text-[12px] font-black text-gray-400 uppercase tracking-widest mb-1">{label}</span>
      <input type={type} value={value ?? ""}
             placeholder={placeholder || ""}
             onChange={(e) => onChange(isNum ? (e.target.value === "" ? "" : parseFloat(e.target.value)) : e.target.value)}
             data-testid={testId}
             className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
      {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
    </label>
  );
};

const Sub = ({ id, title, icon, color, open, onToggle, children, hideHeader }) => (
  <div className="bg-bgBase/40 border border-bgHover rounded-lg overflow-hidden" data-testid={`d2d-sub-${id}`}>
    {!hideHeader && (
      <button type="button" onClick={onToggle}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-bgBase/70 transition">
        <span className="flex items-center gap-3">
          <i className={`fas ${icon} ${color} text-base`} />
          <span className={`text-[15px] font-black uppercase tracking-widest ${color}`}>{title}</span>
        </span>
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-[12px] text-gray-500`} />
      </button>
    )}
    {open && <div className={`p-4 space-y-4 ${hideHeader ? "" : "border-t border-bgHover"}`}>{children}</div>}
  </div>
);

export default function DayToDayControls({ d2d, setD2d, section }) {
  // Sprint 110ei — Day-to-Day mega-panel split into per-category sub-panels.
  //
  // - When `section` is one of {"money", "seasonal", "guardrails", "comms",
  //   "loyalty", "compliance", "services", "finance", "ui"}, render ONLY
  //   that subsection's body (no collapsible header, no other sections).
  //   Each Settings category card mounts the slice that belongs to it as
  //   its single source of truth.
  // - When `section` is undefined, render the new "Operator Quick Controls"
  //   hub — summary cards + shortcuts that link to each setting's true
  //   home. No editable controls live here anymore; the hub is read-only
  //   pulse-checks plus deep-link buttons.
  const [openIds, setOpenIds] = useState(new Set(section ? [section] : ["money"]));
  const toggle = (id) => setOpenIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const isOpen = (id) => section ? id === section : openIds.has(id);
  const showHeader = !section;  // hide the collapsible header on split-view

  const v = d2d || {};
  const set = (sec, key, val) =>
    setD2d({ ...v, [sec]: { ...(v[sec] || {}), [key]: val } });

  const m = v.money || {};
  const s = v.seasonal || {};
  const g = v.guardrails || {};
  const c = v.comms || {};
  const l = v.loyalty || {};
  const co = v.compliance || {};
  const sv = v.services || {};
  const f = v.finance || {};
  const u = v.ui || {};

  const addHolidaySurcharge = () => {
    const next = [...(s.holiday_surcharges || []), { date: "", multiplier: 1.5, label: "" }];
    set("seasonal", "holiday_surcharges", next);
  };
  const updateHoliday = (idx, key, val) => {
    const next = (s.holiday_surcharges || []).map((h, i) => i === idx ? { ...h, [key]: val } : h);
    set("seasonal", "holiday_surcharges", next);
  };
  const removeHoliday = (idx) => set("seasonal", "holiday_surcharges", (s.holiday_surcharges || []).filter((_, i) => i !== idx));

  const addPeak = () => set("seasonal", "peak_season_ranges", [...(s.peak_season_ranges || []), { start: "", end: "", multiplier: 1.25, label: "" }]);
  const updatePeak = (idx, key, val) => set("seasonal", "peak_season_ranges", (s.peak_season_ranges || []).map((p, i) => i === idx ? { ...p, [key]: val } : p));
  const removePeak = (idx) => set("seasonal", "peak_season_ranges", (s.peak_season_ranges || []).filter((_, i) => i !== idx));

  // When rendering as a section slice, the wrapping `<Sub>` shows ONLY the
  // requested section's body (no collapsible header, no other sections).
  const subProps = (id) => ({
    open: isOpen(id),
    onToggle: () => toggle(id),
    hideHeader: !showHeader,
  });
  const showSec = (id) => !section || section === id;

  // Operator Quick Controls hub (when `section` is not specified).
  if (!section) {
    return <OperatorQuickControls d2d={v} />;
  }

  return (
    <div className="space-y-3" data-testid="day-to-day-controls">
      {/* MONEY ───────────────────────────────────────────────── */}
      {showSec("money") && (
      <Sub id="money" title="Money rules" icon="fa-dollar-sign" color="text-shGreen" {...subProps("money")}>
        <Field label="Show tipping prompt at checkout" type="toggle" value={m.tipping_enabled}
               onChange={(v) => set("money", "tipping_enabled", v)} testId="d2d-tipping-enabled"
               hint="Adds a tip step in the check-out flow with quick-pick percentages." />
        <Field label="Tip preset percentages (comma-separated)" value={(m.tip_presets_pct || []).join(",")}
               onChange={(val) => set("money", "tip_presets_pct", val.split(",").map(x => parseFloat(x.trim())).filter(x => !isNaN(x)))}
               testId="d2d-tip-presets" hint="Example: 15,18,20" placeholder="15,18,20" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Late pickup fee ($/15 min)" type="number" value={m.late_pickup_fee_per_15min}
                 onChange={(v) => set("money", "late_pickup_fee_per_15min", v)} testId="d2d-late-fee"
                 hint="Per 15 min past closing or declared pickup time. 0 = off." />
          <Field label="Late pickup grace minutes" type="number" value={m.late_pickup_grace_min}
                 onChange={(v) => set("money", "late_pickup_grace_min", v)} testId="d2d-late-grace"
                 hint="No fee charged within this grace window." />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Free cancel ≥ N hours" type="number" value={m.cancellation_tier1_hours}
                 onChange={(v) => set("money", "cancellation_tier1_hours", v)} testId="d2d-cancel-t1h" />
          <Field label="Tier 2 cutoff (hours)" type="number" value={m.cancellation_tier2_hours}
                 onChange={(v) => set("money", "cancellation_tier2_hours", v)} testId="d2d-cancel-t2h"
                 hint="Between tier-1 and tier-2 hours, bill tier-2 %." />
          <Field label="Tier 3 charge (%)" type="number" value={m.cancellation_tier3_pct}
                 onChange={(v) => set("money", "cancellation_tier3_pct", v)} testId="d2d-cancel-t3p"
                 hint="Below tier-2 hours, bill this %." />
          <Field label="Tier 1 charge (%)" type="number" value={m.cancellation_tier1_pct}
                 onChange={(v) => set("money", "cancellation_tier1_pct", v)} testId="d2d-cancel-t1p" />
          <Field label="Tier 2 charge (%)" type="number" value={m.cancellation_tier2_pct}
                 onChange={(v) => set("money", "cancellation_tier2_pct", v)} testId="d2d-cancel-t2p" />
          <Field label="No-show charge (%)" type="number" value={m.no_show_fee_pct}
                 onChange={(v) => set("money", "no_show_fee_pct", v)} testId="d2d-noshow" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Boarding deposit (%)" type="number" value={m.boarding_deposit_pct}
                 onChange={(v) => set("money", "boarding_deposit_pct", v)} testId="d2d-board-dep"
                 hint="Required upfront when booking is placed." />
          <Field label="Credit pack expiry (days)" type="number" value={m.credit_pack_expiry_days}
                 onChange={(v) => set("money", "credit_pack_expiry_days", v)} testId="d2d-pack-exp"
                 hint="0 = never expire." />
          <Field label="Auto-decline if balance owed >" type="number" value={m.auto_decline_if_balance_over}
                 onChange={(v) => set("money", "auto_decline_if_balance_over", v)} testId="d2d-auto-decline"
                 hint="0 = off." />
        </div>
        <Field label="Round receipt totals to whole dollar" type="toggle" value={m.round_to_dollar}
               onChange={(v) => set("money", "round_to_dollar", v)} testId="d2d-round" />
      </Sub>
      )}

      {/* SEASONAL ─────────────────────────────────────────────── */}
      {showSec("seasonal") && (
      <Sub id="seasonal" title="Holiday & peak-season pricing" icon="fa-calendar-star" color="text-shOrange" {...subProps("seasonal")}>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-black uppercase tracking-widest text-gray-300">Holiday surcharges</span>
            <button type="button" onClick={addHolidaySurcharge} data-testid="d2d-holiday-add"
                    className="text-[12px] font-black uppercase tracking-widest text-shGreen hover:text-white">+ Holiday</button>
          </div>
          <div className="space-y-2">
            {(s.holiday_surcharges || []).map((h, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 bg-bgPanel/40 rounded p-2 border border-bgHover" data-testid={`d2d-holiday-row-${i}`}>
                <input type="date" value={h.date || ""} onChange={(e) => updateHoliday(i, "date", e.target.value)}
                       className="col-span-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                <input type="text" placeholder="Label (e.g. Christmas)" value={h.label || ""} onChange={(e) => updateHoliday(i, "label", e.target.value)}
                       className="col-span-5 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                <input type="number" step="0.05" placeholder="1.5" value={h.multiplier ?? ""} onChange={(e) => updateHoliday(i, "multiplier", parseFloat(e.target.value))}
                       className="col-span-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                <button type="button" onClick={() => removeHoliday(i)} className="col-span-1 text-red-400 hover:text-red-300">
                  <i className="fas fa-trash text-sm" />
                </button>
              </div>
            ))}
            {(s.holiday_surcharges || []).length === 0 && <p className="text-[12px] text-gray-500 italic">No holidays yet — click + to add one.</p>}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-black uppercase tracking-widest text-gray-300">Peak season ranges</span>
            <button type="button" onClick={addPeak} data-testid="d2d-peak-add"
                    className="text-[12px] font-black uppercase tracking-widest text-shGreen hover:text-white">+ Range</button>
          </div>
          <div className="space-y-2">
            {(s.peak_season_ranges || []).map((p, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 bg-bgPanel/40 rounded p-2 border border-bgHover" data-testid={`d2d-peak-row-${i}`}>
                <input type="date" value={p.start || ""} onChange={(e) => updatePeak(i, "start", e.target.value)}
                       className="col-span-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                <input type="date" value={p.end || ""} onChange={(e) => updatePeak(i, "end", e.target.value)}
                       className="col-span-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                <input type="text" placeholder="Label" value={p.label || ""} onChange={(e) => updatePeak(i, "label", e.target.value)}
                       className="col-span-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                <input type="number" step="0.05" placeholder="1.25" value={p.multiplier ?? ""} onChange={(e) => updatePeak(i, "multiplier", parseFloat(e.target.value))}
                       className="col-span-2 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                <button type="button" onClick={() => removePeak(i)} className="col-span-1 text-red-400 hover:text-red-300">
                  <i className="fas fa-trash text-sm" />
                </button>
              </div>
            ))}
            {(s.peak_season_ranges || []).length === 0 && <p className="text-[12px] text-gray-500 italic">No peak ranges yet — click + to add one.</p>}
          </div>
        </div>
        <Field label="Block bookings within N days before any holiday" type="number" value={s.holiday_lockout_days}
               onChange={(v) => set("seasonal", "holiday_lockout_days", v)} testId="d2d-holiday-lockout"
               hint="0 = no lockout." />
        <div>
          <span className="block text-[12px] font-black text-gray-400 uppercase tracking-widest mb-1">Owner vacation auto-message</span>
          <textarea value={s.vacation_message || ""}
                    onChange={(e) => set("seasonal", "vacation_message", e.target.value)}
                    data-testid="d2d-vac-msg"
                    placeholder="Closed Aug 1-7. See you Aug 8!"
                    className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm h-20" />
          <div className="grid grid-cols-2 gap-3 mt-2">
            <input type="date" value={s.vacation_start || ""} onChange={(e) => set("seasonal", "vacation_start", e.target.value)}
                   data-testid="d2d-vac-start" className="bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            <input type="date" value={s.vacation_end || ""} onChange={(e) => set("seasonal", "vacation_end", e.target.value)}
                   data-testid="d2d-vac-end" className="bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          </div>
        </div>
      </Sub>
      )}

      {/* GUARDRAILS ─────────────────────────────────────────── */}
      {showSec("guardrails") && (
      <Sub id="guardrails" title="Booking & capacity guardrails" icon="fa-shield" color="text-shBlue" {...subProps("guardrails")}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Min advance booking (hours)" type="number" value={g.min_advance_booking_hours}
                 onChange={(v) => set("guardrails", "min_advance_booking_hours", v)} testId="d2d-min-adv" />
          <Field label="Weekend lead time (hours)" type="number" value={g.weekend_lead_time_hours}
                 onChange={(v) => set("guardrails", "weekend_lead_time_hours", v)} testId="d2d-wknd-lead"
                 hint="Extra lead time for Sat/Sun bookings." />
          <Field label="Max bookings / client / day" type="number" value={g.max_bookings_per_client_per_day}
                 onChange={(v) => set("guardrails", "max_bookings_per_client_per_day", v)} testId="d2d-max-bkpd"
                 hint="0 = unlimited." />
          <Field label="Max consecutive boarding nights" type="number" value={g.max_consecutive_boarding_nights}
                 onChange={(v) => set("guardrails", "max_consecutive_boarding_nights", v)} testId="d2d-max-bnights"
                 hint="0 = unlimited." />
          <Field label="Max dogs per kennel" type="number" value={g.max_dogs_per_kennel}
                 onChange={(v) => set("guardrails", "max_dogs_per_kennel", v)} testId="d2d-max-kennel" />
          <Field label="Warn at staff:dog ratio of 1:" type="number" value={g.staff_dog_ratio_warn_at}
                 onChange={(v) => set("guardrails", "staff_dog_ratio_warn_at", v)} testId="d2d-ratio" />
        </div>
        <Field label="Allow same-day bookings" type="toggle" value={g.same_day_booking_allowed}
               onChange={(v) => set("guardrails", "same_day_booking_allowed", v)} testId="d2d-sameday" />
        <Field label="Block bookings when vaccines expired" type="toggle" value={g.block_bookings_if_vaccines_expired}
               onChange={(v) => set("guardrails", "block_bookings_if_vaccines_expired", v)} testId="d2d-block-vax" />
        <Field label="Setup/cleanup buffer (min)" type="number" value={g.setup_cleanup_buffer_min}
               onChange={(v) => set("guardrails", "setup_cleanup_buffer_min", v)} testId="d2d-buffer"
               hint="Spacing required between back-to-back training/grooming appointments." />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check-in window starts" value={g.check_in_window_start || ""}
                 onChange={(v) => set("guardrails", "check_in_window_start", v)} testId="d2d-ci-start" placeholder="07:00" />
          <Field label="Check-in window ends" value={g.check_in_window_end || ""}
                 onChange={(v) => set("guardrails", "check_in_window_end", v)} testId="d2d-ci-end" placeholder="10:00" />
          <Field label="Check-out window starts" value={g.check_out_window_start || ""}
                 onChange={(v) => set("guardrails", "check_out_window_start", v)} testId="d2d-co-start" placeholder="16:00" />
          <Field label="Check-out window ends" value={g.check_out_window_end || ""}
                 onChange={(v) => set("guardrails", "check_out_window_end", v)} testId="d2d-co-end" placeholder="19:00" />
        </div>
      </Sub>
      )}

      {/* COMMS ──────────────────────────────────────────────── */}
      {showSec("comms") && (
      <Sub id="comms" title="Email automation timing" icon="fa-envelope" color="text-purple-300" {...subProps("comms")}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Reminder email — hours before" type="number" value={c.reminder_email_hours_before}
                 onChange={(v) => set("comms", "reminder_email_hours_before", v)} testId="d2d-rmd-hours" />
          <Field label="Vaccine expiry warn (extra days)" type="number" value={c.vaccine_expiry_warn_days_extended}
                 onChange={(v) => set("comms", "vaccine_expiry_warn_days_extended", v)} testId="d2d-vax-warn" />
          <Field label='"We miss you" after N inactive days' type="number" value={c.inactive_client_days}
                 onChange={(v) => set("comms", "inactive_client_days", v)} testId="d2d-miss-days" />
          <Field label="Review request — days after visit" type="number" value={c.review_request_days_after_visit}
                 onChange={(v) => set("comms", "review_request_days_after_visit", v)} testId="d2d-rev-days" />
          <Field label="Report card auto-send" type="select" value={c.report_card_auto_send}
                 onChange={(v) => set("comms", "report_card_auto_send", v)} testId="d2d-rc-mode"
                 options={[{value:"per_session",label:"After every session"},{value:"weekly_digest",label:"Weekly digest"},{value:"off",label:"Off (manual only)"}]} />
          <Field label="Birthday emails enabled" type="toggle" value={c.birthday_email_enabled}
                 onChange={(v) => set("comms", "birthday_email_enabled", v)} testId="d2d-bday" />
        </div>
        <div className="grid grid-cols-3 gap-3 items-end">
          <Field label="Quiet hours enabled" type="toggle" value={c.quiet_hours_enabled}
                 onChange={(v) => set("comms", "quiet_hours_enabled", v)} testId="d2d-quiet-en" />
          <Field label="Quiet hours start" value={c.quiet_hours_start || ""}
                 onChange={(v) => set("comms", "quiet_hours_start", v)} testId="d2d-quiet-start" placeholder="21:00" />
          <Field label="Quiet hours end" value={c.quiet_hours_end || ""}
                 onChange={(v) => set("comms", "quiet_hours_end", v)} testId="d2d-quiet-end" placeholder="08:00" />
        </div>
        <Field label="Reply-to address (blank = system from address)" type="email" value={c.reply_to_address || ""}
               onChange={(v) => set("comms", "reply_to_address", v)} testId="d2d-replyto" />
        <div>
          <span className="block text-[12px] font-black text-gray-400 uppercase tracking-widest mb-1">Email footer signature</span>
          <textarea value={c.email_footer_signature || ""}
                    onChange={(e) => set("comms", "email_footer_signature", e.target.value)}
                    data-testid="d2d-footer-sig"
                    className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm h-20" />
        </div>
      </Sub>
      )}

      {/* LOYALTY ────────────────────────────────────────────── */}
      {showSec("loyalty") && (
      <Sub id="loyalty" title="Trophies, streaks & referrals" icon="fa-trophy" color="text-amber-400" {...subProps("loyalty")}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Streak target — daycare (days)" type="number" value={l.streak_target_daycare}
                 onChange={(v) => set("loyalty", "streak_target_daycare", v)} testId="d2d-streak-d" />
          <Field label="Streak target — training (days)" type="number" value={l.streak_target_training}
                 onChange={(v) => set("loyalty", "streak_target_training", v)} testId="d2d-streak-t" />
          <Field label="Streak target — boarding (visits)" type="number" value={l.streak_target_boarding}
                 onChange={(v) => set("loyalty", "streak_target_boarding", v)} testId="d2d-streak-b" />
          <Field label="Bronze tier (visits)" type="number" value={l.loyalty_tier_bronze_visits}
                 onChange={(v) => set("loyalty", "loyalty_tier_bronze_visits", v)} testId="d2d-bronze" />
          <Field label="Silver tier (visits)" type="number" value={l.loyalty_tier_silver_visits}
                 onChange={(v) => set("loyalty", "loyalty_tier_silver_visits", v)} testId="d2d-silver" />
          <Field label="Gold tier (visits)" type="number" value={l.loyalty_tier_gold_visits}
                 onChange={(v) => set("loyalty", "loyalty_tier_gold_visits", v)} testId="d2d-gold" />
          <Field label="Platinum tier (visits)" type="number" value={l.loyalty_tier_platinum_visits}
                 onChange={(v) => set("loyalty", "loyalty_tier_platinum_visits", v)} testId="d2d-platinum" />
          <Field label="Trophy reward value ($)" type="number" value={l.trophy_reward_value_usd}
                 onChange={(v) => set("loyalty", "trophy_reward_value_usd", v)} testId="d2d-trophy-val"
                 hint="0 = symbolic only." />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Referral reward type" type="select" value={l.referral_reward_type}
                 onChange={(v) => set("loyalty", "referral_reward_type", v)} testId="d2d-ref-type"
                 options={[{value:"credit",label:"Free credit"},{value:"dollar_off",label:"$ off next visit"},{value:"percent_off",label:"% off next visit"},{value:"free_session",label:"Free session"}]} />
          <Field label="Referral reward amount" type="number" value={l.referral_reward_amount}
                 onChange={(v) => set("loyalty", "referral_reward_amount", v)} testId="d2d-ref-amt" />
          <Field label="Referral service (for credits)" type="select" value={l.referral_reward_service}
                 onChange={(v) => set("loyalty", "referral_reward_service", v)} testId="d2d-ref-svc"
                 options={[{value:"daycare",label:"Daycare"},{value:"boarding",label:"Boarding"},{value:"training",label:"Training"}]} />
        </div>
      </Sub>
      )}

      {/* COMPLIANCE ─────────────────────────────────────────── */}
      {showSec("compliance") && (
      <Sub id="compliance" title="Vaccines & waiver compliance" icon="fa-syringe" color="text-red-400" {...subProps("compliance")}>
        <div>
          <span className="block text-[12px] font-black text-gray-400 uppercase tracking-widest mb-1">
            Vaccines required PER service (comma-separated; blank = use global required-vaccines list)
          </span>
          <div className="grid grid-cols-1 gap-2">
            {["daycare","boarding","training","grooming","photography"].map(svc => (
              <div key={svc} className="grid grid-cols-12 gap-2 items-center">
                <span className="col-span-2 text-[13px] font-black uppercase tracking-widest text-shBlue">{svc}</span>
                <input type="text"
                       value={((co.vaccines_per_service || {})[svc] || []).join(", ")}
                       onChange={(e) => set("compliance", "vaccines_per_service", {
                         ...(co.vaccines_per_service || {}),
                         [svc]: e.target.value.split(",").map(x => x.trim()).filter(Boolean)
                       })}
                       data-testid={`d2d-vax-${svc}`}
                       placeholder="rabies, dhpp, bordetella"
                       className="col-span-10 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Block bookings ON expiry day (vs after)" type="toggle" value={co.block_on_expiry_day}
                 onChange={(v) => set("compliance", "block_on_expiry_day", v)} testId="d2d-expiry-day" />
          <Field label="Require vaccine doc upload" type="toggle" value={co.vaccine_doc_upload_required}
                 onChange={(v) => set("compliance", "vaccine_doc_upload_required", v)} testId="d2d-doc-req" />
          <Field label="Waiver re-sign frequency" type="select" value={co.waiver_resign_frequency}
                 onChange={(v) => set("compliance", "waiver_resign_frequency", v)} testId="d2d-waiver-freq"
                 options={[{value:"never",label:"Never (one-time)"},{value:"annual",label:"Annually"},{value:"version_bump",label:"On version bump"}]} />
          <Field label="Waiver required for" type="select" value={co.waiver_scope}
                 onChange={(v) => set("compliance", "waiver_scope", v)} testId="d2d-waiver-scope"
                 options={[{value:"first_visit",label:"First visit only"},{value:"every_visit",label:"Every visit"},{value:"bookings_only",label:"Bookings only"}]} />
        </div>
      </Sub>
      )}

      {/* SERVICES ──────────────────────────────────────────── */}
      {showSec("services") && (
      <Sub id="services" title="Service-specific defaults" icon="fa-paw" color="text-shGreen" {...subProps("services")}>
        <Field label="Boarding price includes daycare hours" type="toggle" value={sv.boarding_includes_daycare}
               onChange={(v) => set("services", "boarding_includes_daycare", v)} testId="d2d-b-inc-d"
               hint="When ON, a boarding night covers daytime daycare too." />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Training session length (min)" type="number" value={sv.training_session_length_min}
                 onChange={(v) => set("services", "training_session_length_min", v)} testId="d2d-train-len" />
          <Field label="Graduation: % mastery" type="number" value={sv.training_graduation_pct_mastery}
                 onChange={(v) => set("services", "training_graduation_pct_mastery", v)} testId="d2d-grad-pct" />
          <Field label="Graduation: consecutive successes" type="number" value={sv.training_graduation_consecutive_successes}
                 onChange={(v) => set("services", "training_graduation_consecutive_successes", v)} testId="d2d-grad-streak" />
          <Field label="Photography default price ($)" type="number" value={sv.photography_default_price}
                 onChange={(v) => set("services", "photography_default_price", v)} testId="d2d-photo-price" />
          <Field label="Photography photos included" type="number" value={sv.photography_edited_photos_included}
                 onChange={(v) => set("services", "photography_edited_photos_included", v)} testId="d2d-photo-count" />
          <Field label="Photography delivery SLA (days)" type="number" value={sv.photography_delivery_sla_days}
                 onChange={(v) => set("services", "photography_delivery_sla_days", v)} testId="d2d-photo-sla" />
          <Field label="Grooming — bath duration (min)" type="number" value={sv.grooming_bath_duration_min}
                 onChange={(v) => set("services", "grooming_bath_duration_min", v)} testId="d2d-bath-dur" />
          <Field label="Grooming — nail-trim duration (min)" type="number" value={sv.grooming_nailtrim_duration_min}
                 onChange={(v) => set("services", "grooming_nailtrim_duration_min", v)} testId="d2d-nail-dur" />
        </div>
      </Sub>
      )}

      {/* FINANCE ────────────────────────────────────────────── */}
      {showSec("finance") && (
      <Sub id="finance" title="Finance & bookkeeping" icon="fa-chart-pie" color="text-shBlue" {...subProps("finance")}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fiscal year start month (1-12)" type="number" value={f.fiscal_year_start_month}
                 onChange={(v) => set("finance", "fiscal_year_start_month", v)} testId="d2d-fy" />
          <Field label="Bookkeeping export format" type="select" value={f.bookkeeping_export_format}
                 onChange={(v) => set("finance", "bookkeeping_export_format", v)} testId="d2d-export"
                 options={[{value:"csv",label:"Generic CSV"},{value:"quickbooks",label:"QuickBooks"},{value:"wave",label:"Wave"}]} />
          <Field label="Business mileage rate ($/mile)" type="number" value={f.mileage_rate_per_mile}
                 onChange={(v) => set("finance", "mileage_rate_per_mile", v)} testId="d2d-mileage"
                 hint="IRS 2024 standard = $0.67." />
          <Field label="1099 threshold ($)" type="number" value={f.form_1099_threshold_usd}
                 onChange={(v) => set("finance", "form_1099_threshold_usd", v)} testId="d2d-1099" />
        </div>
      </Sub>
      )}

      {/* UI ─────────────────────────────────────────────────── */}
      {showSec("ui") && (
      <Sub id="ui" title="Branding & UI polish" icon="fa-palette" color="text-shOrange" {...subProps("ui")}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Splatter intensity" type="select" value={u.splatter_intensity}
                 onChange={(v) => set("ui", "splatter_intensity", v)} testId="d2d-splatter"
                 options={[{value:"off",label:"Off"},{value:"low",label:"Low"},{value:"medium",label:"Medium"},{value:"high",label:"High"}]} />
          <Field label="Primary CTA copy" value={u.primary_cta_copy || ""}
                 onChange={(v) => set("ui", "primary_cta_copy", v)} testId="d2d-cta" placeholder="Book Now" />
          <Field label="PWA short name" value={u.pwa_short_name || ""}
                 onChange={(v) => set("ui", "pwa_short_name", v)} testId="d2d-pwa-name" />
          <Field label="PWA tagline" value={u.pwa_tagline || ""}
                 onChange={(v) => set("ui", "pwa_tagline", v)} testId="d2d-pwa-tag" />
          <Field label="Letter case preference" type="select" value={u.letter_case_preference}
                 onChange={(v) => set("ui", "letter_case_preference", v)} testId="d2d-case"
                 options={[{value:"upper",label:"UPPERCASE"},{value:"title",label:"Title Case"},{value:"sentence",label:"Sentence case"}]} />
          <Field label="Time format" type="select" value={u.time_format}
                 onChange={(v) => set("ui", "time_format", v)} testId="d2d-tfmt"
                 options={[{value:"12h",label:"12-hour (3:00 PM)"},{value:"24h",label:"24-hour (15:00)"}]} />
          <Field label="Date format" type="select" value={u.date_format}
                 onChange={(v) => set("ui", "date_format", v)} testId="d2d-dfmt"
                 options={[{value:"us",label:"US (MM/DD/YYYY)"},{value:"iso",label:"ISO (YYYY-MM-DD)"},{value:"eu",label:"EU (DD/MM/YYYY)"}]} />
          <Field label="Week starts on" type="select" value={u.week_starts_on}
                 onChange={(v) => set("ui", "week_starts_on", v)} testId="d2d-wkstart"
                 options={[{value:"sunday",label:"Sunday"},{value:"monday",label:"Monday"}]} />
          <Field label="Dog avatar fallback" type="select" value={u.dog_avatar_fallback}
                 onChange={(v) => set("ui", "dog_avatar_fallback", v)} testId="d2d-avatar"
                 options={[{value:"paw",label:"Paw icon"},{value:"initials",label:"Initials"},{value:"placeholder",label:"Generic placeholder"}]} />
        </div>
        <Field label="Show prices in client portal" type="toggle" value={u.show_prices_in_portal}
               onChange={(v) => set("ui", "show_prices_in_portal", v)} testId="d2d-portal-prices" />
        <Field label="Show waitlist signup in client portal" type="toggle" value={u.show_waitlist_signup_in_portal}
               onChange={(v) => set("ui", "show_waitlist_signup_in_portal", v)} testId="d2d-waitlist" />
      </Sub>
      )}

      <div className="text-[12px] text-gray-500 italic pt-2 px-1">
        <i className="fas fa-info-circle mr-1" />
        Every setting above defaults to current behavior — flipping a toggle is opt-in.
        High-impact rules (money, guardrails, holidays, vaccines, quiet hours) are wired live;
        cosmetic UI knobs will apply gradually as we polish each screen.
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Sprint 110ei — Operator Quick Controls hub.
// Replaces the old "Day-to-Day Controls" mega-page. Shows read-only pulse
// cards summarising the most-frequently-touched rules (today's hours, quiet
// hours, holiday surcharges loaded, capacity cap, loyalty thresholds, etc.)
// plus "Configure ↗" shortcuts that deep-link to each setting's true home
// category. NO editable controls live on this page anymore — every edit
// happens in its single-owner home (Business Operations, Services &
// Pricing, Email & Notifications, etc.). This honours the rule:
//   "Each setting has one true home category."
// ───────────────────────────────────────────────────────────────────────
function OperatorQuickControls({ d2d }) {
  const v = d2d || {};
  const m = v.money || {};
  const s = v.seasonal || {};
  const g = v.guardrails || {};
  const c = v.comms || {};
  const l = v.loyalty || {};
  const co = v.compliance || {};
  const f = v.finance || {};

  const goto = (cat, sub) => {
    window.dispatchEvent(new CustomEvent("sh:settings-jump", { detail: { cat, sub } }));
  };

  const cards = [
    {
      label: "Today's Operating Rules",
      lines: [
        ["Same-day bookings", g.same_day_booking_allowed ? "Allowed" : "Blocked", g.same_day_booking_allowed ? "shGreen" : "shOrange"],
        ["Min advance", `${g.min_advance_booking_hours ?? "—"} h`],
        ["Block on expired vaccines", g.block_bookings_if_vaccines_expired ? "Yes" : "No", g.block_bookings_if_vaccines_expired ? "shGreen" : "shOrange"],
      ],
      cta: { label: "Configure booking rules", cat: "ops", sub: "_d2d_guardrails" },
      icon: "fa-shield", color: "shBlue",
    },
    {
      label: "Holiday & Peak Pricing",
      lines: [
        ["Holidays loaded", `${(s.holiday_surcharges || []).length}`],
        ["Peak ranges", `${(s.peak_season_ranges || []).length}`],
        ["Vacation mode", s.vacation_start && s.vacation_end ? `${s.vacation_start} → ${s.vacation_end}` : "Off", s.vacation_start ? "shOrange" : null],
      ],
      cta: { label: "Configure pricing seasons", cat: "pricing", sub: "_d2d_seasonal" },
      icon: "fa-calendar-star", color: "shOrange",
    },
    {
      label: "Money & Checkout",
      lines: [
        ["Tipping at checkout", m.tipping_enabled ? "On" : "Off", m.tipping_enabled ? "shGreen" : "shOrange"],
        ["Late pickup fee", m.late_pickup_fee_per_15min ? `$${m.late_pickup_fee_per_15min}/15min` : "Off"],
        ["No-show fee", m.no_show_fee_pct ? `${m.no_show_fee_pct}%` : "Off"],
      ],
      cta: { label: "Configure money rules", cat: "pricing", sub: "_d2d_money" },
      icon: "fa-dollar-sign", color: "shGreen",
    },
    {
      label: "Email Quiet Hours",
      lines: [
        ["Quiet hours", c.quiet_hours_enabled ? `${c.quiet_hours_start || "?"} → ${c.quiet_hours_end || "?"}` : "Off", c.quiet_hours_enabled ? "shGreen" : "shOrange"],
        ["Reminder lead", `${c.reminder_email_hours_before ?? "—"} h before`],
        ["Birthday emails", c.birthday_email_enabled ? "On" : "Off"],
      ],
      cta: { label: "Configure email timing", cat: "comms", sub: "_d2d_comms" },
      icon: "fa-moon", color: "purple-300",
    },
    {
      label: "Vaccine & Waiver Compliance",
      lines: [
        ["Block on expiry day", co.block_on_expiry_day ? "Yes" : "After"],
        ["Doc upload required", co.vaccine_doc_upload_required ? "Yes" : "No"],
        ["Waiver re-sign", co.waiver_resign_frequency || "never"],
      ],
      cta: { label: "Configure compliance", cat: "compliance", sub: "_d2d_compliance" },
      icon: "fa-syringe", color: "red-400",
    },
    {
      label: "Loyalty & Referrals",
      lines: [
        ["Tiers", `${l.loyalty_tier_bronze_visits || "—"}/${l.loyalty_tier_silver_visits || "—"}/${l.loyalty_tier_gold_visits || "—"}/${l.loyalty_tier_platinum_visits || "—"}`],
        ["Referral reward", l.referral_reward_type ? `${l.referral_reward_amount || 0} ${l.referral_reward_type}` : "Off"],
        ["Trophy value", l.trophy_reward_value_usd ? `$${l.trophy_reward_value_usd}` : "Symbolic"],
      ],
      cta: { label: "Configure rewards", cat: "rewards", sub: "_d2d_loyalty" },
      icon: "fa-trophy", color: "amber-400",
    },
    {
      label: "Finance Defaults",
      lines: [
        ["Fiscal year start", `Month ${f.fiscal_year_start_month || 1}`],
        ["Export format", f.bookkeeping_export_format || "csv"],
        ["Mileage rate", f.mileage_rate_per_mile ? `$${f.mileage_rate_per_mile}/mi` : "—"],
      ],
      cta: { label: "Configure finance", cat: "finance", sub: "_d2d_finance" },
      icon: "fa-chart-pie", color: "shBlue",
    },
  ];

  return (
    <div className="space-y-5" data-testid="operator-quick-controls">
      <div className="bg-shGreen/10 border border-shGreen/30 rounded-lg p-3">
        <p className="text-[12px] font-black uppercase tracking-[0.25em] text-shGreen mb-1">
          <i className="fas fa-bolt mr-1.5"/>Operator Quick Controls
        </p>
        <p className="text-[13px] text-gray-300 normal-case leading-snug">
          One-glance status of the rules you tweak most often. <strong className="text-white">Every editable control lives in its true home category</strong> — tap &ldquo;Configure&rdquo; on any card to jump there.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {cards.map((card, i) => (
          <div key={i} className="bg-bgBase/50 border border-bgHover rounded-xl p-4 flex flex-col gap-3" data-testid={`qc-card-${card.cta.sub}`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-[16px] shrink-0 bg-${card.color}/15 text-${card.color}`}>
                <i className={`fas ${card.icon}`}/>
              </div>
              <h3 className="text-[14px] font-black uppercase tracking-widest text-white">{card.label}</h3>
            </div>
            <dl className="space-y-1 text-[13px] pl-1">
              {card.lines.map(([k, val, accent], j) => (
                <div key={j} className="flex items-baseline justify-between gap-3 normal-case">
                  <dt className="text-gray-400">{k}</dt>
                  <dd className={`font-bold ${accent === "shGreen" ? "text-shGreen" : accent === "shOrange" ? "text-shOrange" : "text-white"}`}>{val}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              onClick={() => goto(card.cta.cat, card.cta.sub)}
              data-testid={`qc-goto-${card.cta.sub}`}
              className="self-start text-[11px] font-black uppercase tracking-widest text-shBlue hover:text-shGreen transition inline-flex items-center gap-1"
            >
              {card.cta.label} <i className="fas fa-arrow-right text-[10px]"/>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
