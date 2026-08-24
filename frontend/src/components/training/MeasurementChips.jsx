// Shared measurement chip group. Editable/read-only semantics are unchanged;
// the layout is now roomier on desktop and finger-friendly on phones.

function editableHelp(item) {
  const label = String(item?.label || "").toLowerCase();
  if (label.includes("set") || label.includes("round")) {
    return "Enter how many rounds you actually completed today.";
  }
  if (label.includes("rep") || label.includes("repetition") || label.includes("tries")) {
    return "Enter how many complete tries you did in each round.";
  }
  if (label.includes("session length") || label.includes("duration") || label.includes("minutes") || label.includes("time")) {
    return "Enter about how many minutes you actually practiced.";
  }
  if (label.includes("reliability") || label.includes("rating") || label.includes("1-5") || label.includes("1–5")) {
    return "Rate today: 1 = very hard, 3 = mixed, 5 = easy and repeatable.";
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
  return "Enter what actually happened during today&apos;s practice.";
}

export default function MeasurementChips({ items, testid }) {
  const visible = items.filter(it => it.value || it.onChange);
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2" data-testid={testid}>
      {visible.map(it => (
        <div key={it.key}
             className={`bg-black/15 border border-shBorder/55 rounded-xl px-3 py-2.5 min-w-0 ${it.onChange ? "sm:min-w-[220px] sm:flex-1" : "sm:min-w-[110px]"}`}
             data-testid={testid ? `${testid}-${it.key}` : undefined}>
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-shTextMuted flex items-center gap-1.5">
            {it.icon && <i className={`fas ${it.icon} text-shSecondary`}/>}<span>{it.label}</span>
          </p>
          {it.onChange ? (
            <>
              <input value={it.value || ""} onChange={(e) => it.onChange(e.target.value)}
                     placeholder={it.placeholder || "Enter what happened"} data-testid={testid ? `${testid}-${it.key}-input` : undefined}
                     className="w-full bg-transparent text-shText text-[15px] font-black border-0 p-0 mt-1 focus:outline-none min-h-[28px]"/>
              <p className="text-[10.5px] text-shTextMuted mt-1.5 leading-relaxed">{editableHelp(it)}</p>
            </>
          ) : (
            <p className="text-shText text-[14px] font-black truncate mt-1">{it.value}</p>
          )}
        </div>
      ))}
    </div>
  );
}
