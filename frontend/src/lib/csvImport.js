// Sprint 110di-65 — CSV import utilities for Programs & Daily Tracker.
// Client-side only — fills the existing builder state, then the existing
// /programs and /homework/daily-tracker endpoints handle persistence.
// Zero new backend code.

/** Tiny RFC-4180-ish CSV parser. Handles quoted fields with embedded commas
 *  and "" escapes. Returns an array of arrays of strings. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  // Drop empty trailing rows
  return rows.filter(r => r.some(c => (c || "").trim() !== ""));
}

/** Convert rows to objects keyed by the first row's headers (lowercased, trimmed). */
export function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { headers: rows[0] || [], records: [] };
  const headers = rows[0].map(h => (h || "").trim().toLowerCase());
  const records = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] || "").trim(); });
    return obj;
  });
  return { headers, records };
}

/** Parse a program-modules CSV into the shape ProgramEditor expects.
 *  Required columns: module_name, goal_name. Optional: module_description, goal_description.
 *  Rows are grouped by module_name (first occurrence sets module_description). */
export function parseProgramCsv(text) {
  const { headers, records } = csvToObjects(text);
  if (!headers.includes("module_name") || !headers.includes("goal_name")) {
    throw new Error('CSV must have a header row with at least "module_name" and "goal_name" columns.');
  }
  const byModule = new Map();
  const errors = [];
  records.forEach((rec, idx) => {
    const rowNum = idx + 2; // 1-indexed + header offset
    const mName = (rec.module_name || "").trim();
    const gName = (rec.goal_name || "").trim();
    if (!mName) { errors.push(`Row ${rowNum}: missing module_name`); return; }
    if (!gName) { errors.push(`Row ${rowNum}: missing goal_name`); return; }
    if (!byModule.has(mName)) {
      byModule.set(mName, {
        name: mName,
        description: (rec.module_description || "").trim(),
        order: byModule.size,
        goals: [],
      });
    }
    const mod = byModule.get(mName);
    // First non-empty module_description wins if the first row had it blank
    if (!mod.description && (rec.module_description || "").trim()) {
      mod.description = (rec.module_description || "").trim();
    }
    mod.goals.push({
      name: gName,
      description: (rec.goal_description || "").trim(),
      order: mod.goals.length,
    });
  });
  return { modules: Array.from(byModule.values()), errors };
}

/** Parse a daily-tracker CSV into the shape DailyTrackerBuilder expects.
 *  Required columns: day_number, day_focus, step_label.
 *  Optional: step_description, step_minutes, day_instructions, day_equipment.
 *  `day_equipment` is a semicolon-separated list (e.g. "treat pouch; clicker; long line").
 *  `step_minutes` is an integer (e.g. 3) — blank = untimed.
 *  Rows are grouped by day_number (first non-empty value for day-level fields wins). */
export function parseDailyTrackerCsv(text) {
  const { headers, records } = csvToObjects(text);
  if (!headers.includes("day_number") || !headers.includes("day_focus") || !headers.includes("step_label")) {
    throw new Error('CSV must have a header row with "day_number", "day_focus", and "step_label" columns.');
  }
  const byDay = new Map();
  const errors = [];
  records.forEach((rec, idx) => {
    const rowNum = idx + 2;
    const dNum = parseInt(rec.day_number, 10);
    const dFocus = (rec.day_focus || "").trim();
    const sLabel = (rec.step_label || "").trim();
    if (!Number.isFinite(dNum) || dNum < 1) { errors.push(`Row ${rowNum}: day_number must be a positive integer`); return; }
    if (!sLabel) { errors.push(`Row ${rowNum}: missing step_label`); return; }
    if (!byDay.has(dNum)) {
      byDay.set(dNum, {
        day_number: dNum,
        day_focus: dFocus,
        instructions: "",
        equipment: [],
        steps: [],
        fields: [
          { id: `f-${dNum}-mood`, label: "How'd it go?", kind: "mood_5" },
          { id: `f-${dNum}-notes`, label: "Anything to flag for your trainer?", kind: "longtext" },
        ],
      });
    }
    const day = byDay.get(dNum);
    if (!day.day_focus && dFocus) day.day_focus = dFocus;
    // Day-level fields — first non-empty value wins
    const dInstructions = (rec.day_instructions || "").trim();
    if (!day.instructions && dInstructions) day.instructions = dInstructions;
    const dEquipment = (rec.day_equipment || "").trim();
    if (day.equipment.length === 0 && dEquipment) {
      day.equipment = dEquipment.split(";").map(s => s.trim()).filter(Boolean);
    }
    day.steps.push({
      id: `s-${dNum}-${day.steps.length + 1}`,
      label: sLabel,
      description: (rec.step_description || "").trim() || undefined,
      // Sprint 110di-66b — Optional per-step duration. Empty cell → null (untimed step).
      minutes: rec.step_minutes && rec.step_minutes.trim() !== ""
        ? (Number.isFinite(parseInt(rec.step_minutes, 10)) ? Math.max(0, parseInt(rec.step_minutes, 10)) : null)
        : null,
    });
  });
  const days = Array.from(byDay.values()).sort((a, b) => a.day_number - b.day_number);
  // Each day must have at least one step
  days.forEach(d => {
    if (d.steps.length === 0) {
      d.steps.push({ id: `s-${d.day_number}-1`, label: "" });
    }
  });
  return { days, errors };
}

export const PROGRAM_CSV_SAMPLE = `module_name,module_description,goal_name,goal_description
Week 1 - Foundations,Calm intro to basics,Sit,Lure-based then hand signal
Week 1 - Foundations,Calm intro to basics,Down,From sit position
Week 2 - Loose Leash,Short loops in low-distraction,Heel 5 steps,Start indoors then yard
Week 2 - Loose Leash,Short loops in low-distraction,Turn left smoothly,Mark the pivot
Week 3 - Stay Duration,Build to 60 seconds,Sit-stay 30s,At 3 ft distance
Week 3 - Stay Duration,Build to 60 seconds,Down-stay 60s,Trainer out of sight at end
`;

export const DAILY_TRACKER_CSV_SAMPLE = `day_number,day_focus,day_instructions,day_equipment,step_label,step_minutes,step_description
1,Foundations,"Keep sessions short — 3 to 5 min max. Quit while ahead.",treat pouch; clicker; soft treats,Charge the marker (10 reps),3,"Say ""Yes!"" then treat. No cue, no behaviour."
1,Foundations,,,Sit (2 reps),2,Lure-based
1,Foundations,,,Down (2 reps),2,From sit
2,Loose Leash,"Pick a low-distraction area. Reward when leash stays slack.",6 ft leash; high-value treats; treat pouch,Heel 5 steps,5,Indoor first
2,Loose Leash,,,Turn left,3,Mark the pivot
3,Stay Duration,"Reward duration not distance yet. Release with a clear cue.",mat; long line; jackpot treats,Sit-stay 30s,4,At 3 ft distance
3,Stay Duration,,,Down-stay 60s,5,Trainer out of sight at end
`;

/** Trigger a browser download of the given text as a CSV file. */
export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
