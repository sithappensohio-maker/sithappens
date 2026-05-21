import { useState } from "react";

/**
 * Reusable FontAwesome icon picker for any admin form field that stores a
 * font-awesome class name (e.g. "fa-paw"). Curated library of ~85 icons
 * relevant to a dog daycare / training / grooming business.
 *
 * Props:
 *   value:     current icon string (e.g. "fa-tag")
 *   onChange:  (newValue) => void
 *   testid?:   prefix for data-testid attributes (defaults to "icon-picker")
 */
export const ICON_LIBRARY = [
  { name: "fa-dog", keywords: "dog pet animal" },
  { name: "fa-cat", keywords: "cat pet animal" },
  { name: "fa-paw", keywords: "paw print pet animal" },
  { name: "fa-bone", keywords: "bone treat dog" },
  { name: "fa-fish", keywords: "fish pet aquarium" },
  { name: "fa-crow", keywords: "bird crow" },
  { name: "fa-dove", keywords: "bird dove peace" },
  { name: "fa-feather", keywords: "feather light" },
  { name: "fa-bath", keywords: "bath tub grooming wash" },
  { name: "fa-shower", keywords: "shower wash bath" },
  { name: "fa-soap", keywords: "soap bath clean" },
  { name: "fa-spray-can-sparkles", keywords: "spray grooming clean shampoo" },
  { name: "fa-scissors", keywords: "scissors cut trim haircut" },
  { name: "fa-cut", keywords: "cut trim scissors" },
  { name: "fa-brush", keywords: "brush groom" },
  { name: "fa-graduation-cap", keywords: "training school education learn" },
  { name: "fa-school", keywords: "school training class" },
  { name: "fa-medal", keywords: "medal award trophy" },
  { name: "fa-trophy", keywords: "trophy award win" },
  { name: "fa-award", keywords: "award badge" },
  { name: "fa-ribbon", keywords: "ribbon award" },
  { name: "fa-star", keywords: "star favorite" },
  { name: "fa-heart", keywords: "heart love favorite" },
  { name: "fa-smile", keywords: "smile happy face" },
  { name: "fa-house", keywords: "house home boarding stay" },
  { name: "fa-bed", keywords: "bed boarding sleep" },
  { name: "fa-house-chimney", keywords: "house home boarding" },
  { name: "fa-tent", keywords: "tent camp outdoor" },
  { name: "fa-tree", keywords: "tree outdoor park" },
  { name: "fa-sun", keywords: "sun daycare day" },
  { name: "fa-moon", keywords: "moon night boarding overnight" },
  { name: "fa-cloud-sun", keywords: "weather day outdoor" },
  { name: "fa-camera", keywords: "camera photo photography" },
  { name: "fa-camera-retro", keywords: "camera photo retro" },
  { name: "fa-image", keywords: "image photo picture" },
  { name: "fa-images", keywords: "images photo gallery" },
  { name: "fa-music", keywords: "music sound" },
  { name: "fa-cookie-bite", keywords: "cookie treat reward" },
  { name: "fa-bowl-food", keywords: "food bowl feeding meal" },
  { name: "fa-utensils", keywords: "food utensils meal" },
  { name: "fa-bottle-water", keywords: "water bottle drink" },
  { name: "fa-pills", keywords: "pills medication health" },
  { name: "fa-syringe", keywords: "syringe vaccine shot" },
  { name: "fa-stethoscope", keywords: "stethoscope vet medical" },
  { name: "fa-suitcase-medical", keywords: "first aid medical kit" },
  { name: "fa-heart-pulse", keywords: "heart pulse health" },
  { name: "fa-shield", keywords: "shield protect safe" },
  { name: "fa-shield-dog", keywords: "shield dog safe" },
  { name: "fa-shield-heart", keywords: "shield heart safe" },
  { name: "fa-bell", keywords: "bell alert notification" },
  { name: "fa-bell-concierge", keywords: "bell service" },
  { name: "fa-calendar", keywords: "calendar date schedule" },
  { name: "fa-calendar-day", keywords: "calendar day daycare" },
  { name: "fa-calendar-check", keywords: "calendar appointment" },
  { name: "fa-clock", keywords: "clock time hour" },
  { name: "fa-stopwatch", keywords: "stopwatch time training" },
  { name: "fa-tag", keywords: "tag label price" },
  { name: "fa-tags", keywords: "tags labels prices" },
  { name: "fa-money-bill", keywords: "money cash bill payment" },
  { name: "fa-dollar-sign", keywords: "dollar money payment price" },
  { name: "fa-credit-card", keywords: "credit card payment" },
  { name: "fa-cash-register", keywords: "cash register pay sale" },
  { name: "fa-receipt", keywords: "receipt bill invoice" },
  { name: "fa-gift", keywords: "gift present reward" },
  { name: "fa-percent", keywords: "percent discount sale" },
  { name: "fa-truck", keywords: "truck transport pickup delivery" },
  { name: "fa-car", keywords: "car transport pickup" },
  { name: "fa-route", keywords: "route walk path" },
  { name: "fa-person-walking", keywords: "walk walking leash" },
  { name: "fa-leaf", keywords: "leaf nature outdoor" },
  { name: "fa-key", keywords: "key door kennel" },
  { name: "fa-door-open", keywords: "door kennel open" },
  { name: "fa-id-card", keywords: "id card profile" },
  { name: "fa-clipboard", keywords: "clipboard notes log" },
  { name: "fa-clipboard-list", keywords: "clipboard list checklist" },
  { name: "fa-clipboard-check", keywords: "clipboard check done" },
  { name: "fa-list-check", keywords: "list checklist done" },
  { name: "fa-book", keywords: "book log journal" },
  { name: "fa-pen", keywords: "pen note write" },
  { name: "fa-comment", keywords: "comment chat note" },
  { name: "fa-comments", keywords: "comments chat" },
  { name: "fa-envelope", keywords: "envelope email mail" },
  { name: "fa-phone", keywords: "phone call contact" },
  { name: "fa-fire", keywords: "fire hot popular" },
  { name: "fa-bolt", keywords: "bolt fast energy" },
  { name: "fa-dumbbell", keywords: "dumbbell exercise workout fitness" },
  { name: "fa-running", keywords: "running run exercise" },
  { name: "fa-walking", keywords: "walking walk leash" },
  { name: "fa-magic-wand-sparkles", keywords: "magic sparkles new" },
  { name: "fa-circle-check", keywords: "check approved done" },
  { name: "fa-circle-info", keywords: "info help" },
  { name: "fa-circle-question", keywords: "question help" },
];

export default function IconPicker({ value, onChange, testid = "icon-picker", autoOpen = false }) {
  const [open, setOpen] = useState(autoOpen);
  const [q, setQ] = useState("");
  const filtered = ICON_LIBRARY.filter(i => {
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return i.name.includes(term) || i.keywords.includes(term);
  });
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button type="button" onClick={()=>setOpen(o=>!o)}
                data-testid={`${testid}-toggle`}
                className="shrink-0 w-10 h-10 mt-1 bg-bgBase border border-bgHover rounded grid place-items-center text-white hover:border-shGreen">
          <i className={`fas ${value || "fa-tag"}`}/>
        </button>
        <input value={value} onChange={(e)=>onChange(e.target.value)} placeholder="fa-tag"
               className="flex-1 mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
      </div>
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-2 bg-bgPanel border border-bgHover rounded-lg shadow-2xl p-3 max-h-72 overflow-hidden flex flex-col"
             data-testid={`${testid}-grid`}>
          <div className="flex items-center gap-2 mb-2">
            <i className="fas fa-search text-gray-500 text-xs"/>
            <input autoFocus value={q} onChange={(e)=>setQ(e.target.value)}
                   placeholder="Search icons (e.g. paw, bath, training)…"
                   className="flex-1 bg-bgBase border border-bgHover rounded px-2 py-1 text-white text-[14px]"
                   data-testid={`${testid}-search`}/>
            <button type="button" onClick={()=>setOpen(false)} className="text-gray-500 hover:text-white text-xs px-1" aria-label="Close icon picker">
              <i className="fas fa-xmark"/>
            </button>
          </div>
          <div className="grid grid-cols-8 gap-1 overflow-y-auto pr-1">
            {filtered.map(i => (
              <button key={i.name} type="button"
                      onClick={()=>{ onChange(i.name); setOpen(false); }}
                      title={i.name.replace("fa-", "")}
                      data-testid={`${testid}-${i.name}`}
                      className={`aspect-square rounded grid place-items-center text-white hover:bg-shGreen/20 hover:text-shGreen border ${value === i.name ? "border-shGreen bg-shGreen/20 text-shGreen" : "border-transparent"}`}>
                <i className={`fas ${i.name} text-[14px]`}/>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-8 text-center text-[14px] text-gray-500 py-4">No icons match &quot;{q}&quot;.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
