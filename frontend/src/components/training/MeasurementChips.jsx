// Shared measurement chip group. Internal field ids stay unchanged; this file
// translates trainer-facing labels into one client vocabulary.

export function clientMeasurementLabel(item) {
  const raw = String(item?.label || "").trim();
  const label = raw.toLowerCase();
  if (label.includes("reps per set") || label.includes("reps per round") || label.includes("repetitions per")) return "Repetitions Per Round";
  if (label.includes("repetitions attempted") || label.includes("reps attempted") || label === "repetitions") return "Repetitions Completed";
  if (label.includes("successful rep") || label.includes("successful repetition")) return "Successful Repetitions";
  if (label.includes("sets today") || label.includes("sets completed") || label.includes("rounds today") || label.includes("rounds completed")) return "Rounds Completed";
  if (label.includes("session length") || label.includes("practice time") || label.includes("minutes practiced")) return "Practice Time";
  if (label.includes("reliability") || label.includes("rating") || label.includes("1-5") || label.includes("1–5")) return "How Well Did It Go? (1–5)";
  if (label.includes("what we worked on") || label.includes("practice focus") || label.includes("skill practiced")) return "Skill Practiced";
  return raw;
}

function editableHelp(item) {
  const label = String(item?.label || "").toLowerCase();
  if (label.includes("rep") || label.includes("repetition") || label.includes("tries")) {
    return "A repetition is one complete try. Enter how many repetitions were in each round.";
  }
  if (label.includes("set") || label.includes("round")) {
    return "Enter how many full rounds you actually completed today.";
  }
  if (label.includes("session length") || label.includes("duration") || label.includes("minutes") || label.includes("time")) {
    return "Enter about how many minutes you actually practiced.";
  }
  if (label.includes("reliability") || label.includes("rating") || label.includes("1-5") || label.includes("1–5")) {
    return "Only rate this if School did not already track the result: 1 = very hard, 3 = mixed, 5 = easy and repeatable.";
  }
  if (label.includes("worked on") || label.includes("focus") || label.includes("skill")) {
    return "Briefly name the skill or setup you practiced today.";
  }
  if (label.includes("distance")) {
    return "Enter the distance you actually used today.";
  }
  if (label.includes("success")) {
    return "Enter the result you actually saw today, not the goal.";
  }
  return "Enter what actually happened during today's practice.";
}

export default function MeasurementChips({ items, testid }) {
  const visible = (items || []).filter(it => it.value || it.onChange);
  if (visible.length === 0) return null;
  const tid = String(testid || "");
  const isPlan = tid.includes("practice-targets") || tid.includes("practice-plan");
  const isResult = tid.includes("practice-fields") || tid.includes("practice-results");

  return (
    <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2" data-testid={testid}>
      {visible.map(it => (
        <div key={it.key}
             className={`bg-black/15 border border-shBorder/55 rounded-xl px-3 py-2.5 min-w-0 ${it.onChange ? "sm:min-w-[220px] sm:flex-1" : "sm:min-w-[110px]"}`}
             data-testid={testid ? `${testid}-${it.key}` : undefined}>
          {(isPlan || isResult) && (
            <p className={`text-[12px] font-black uppercase tracking-[0.1em] mb-1 ${isPlan ? "text-shSecondary" : "text-shPrimary"}`}>
              {isPlan ? "Today's Plan" : "Today's Result"}
            </p>
          )}
          <p className="text-[12px] sm:text-[13px] font-black uppercase tracking-[0.1em] text-shTextMuted flex items-center gap-1.5">
            {it.icon && <i className={`fas ${it.icon} text-shSecondary`}/>}<span>{clientMeasurementLabel(it)}</span>
          </p>
          {it.onChange ? (
            <>
              <input value={it.value || ""} onChange={(e) => it.onChange(e.target.value)}
                     placeholder={it.placeholder || "Enter what happened"} data-testid={testid ? `${testid}-${it.key}-input` : undefined}
                     className="w-full bg-transparent text-shText text-[17px] font-black border-0 p-0 mt-1 focus:outline-none min-h-[28px]"/>
              <p className="text-[13px] text-shTextMuted mt-1.5 leading-relaxed">{editableHelp(it)}</p>
            </>
          ) : (
            <p className="text-shText text-[16px] font-black truncate mt-1">{it.value}</p>
          )}
        </div>
      ))}
    </div>
  );
}
