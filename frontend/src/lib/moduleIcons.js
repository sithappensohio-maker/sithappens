/* Module icons + hues for the client course trail and welcome index.
 *
 * Resolution order (moduleIconFor):
 *   1. an admin's own uploaded image (module.icon.kind === "image")
 *   2. an admin-picked built-in    (module.icon.kind === "builtin")
 *   3. AUTO — derived from what the module actually teaches, by matching
 *      its name + description against each choice's keyword list below
 *   4. the paw, never a blank
 *
 * The icon is pure decoration: nothing here reads or influences locks,
 * progression, or any other behavior. Font Awesome 6 free-solid names only
 * (the app already loads 6.4.0).
 */

export const MODULE_ICON_CHOICES = [
  { key: "foundations", fa: "fa-paw", label: "Foundations",
    keywords: ["getting started", "welcome", "start", "foundation", "puppy", "marker", "basics", "intro"] },
  { key: "focus", fa: "fa-bullseye", label: "Focus",
    keywords: ["focus", "engagement", "attention", "watch", "eye contact", "impulse"] },
  { key: "leash", fa: "fa-dog", label: "Leash & walks",
    keywords: ["leash", "walk", "heel", "pulling"] },
  { key: "recall", fa: "fa-bullhorn", label: "Recall",
    keywords: ["recall", "come when called", "name response", "name game"] },
  { key: "manners", fa: "fa-couch", label: "Manners & settle",
    keywords: ["manner", "settle", "place", "calm", "stay", "sit", "down"] },
  { key: "home", fa: "fa-house", label: "Crate & home",
    keywords: ["crate", "potty", "house", "door", "home"] },
  { key: "confidence", fa: "fa-shield-dog", label: "Confidence",
    keywords: ["confidence", "reactiv", "fear", "anxi", "desensit"] },
  { key: "social", fa: "fa-user-group", label: "Social",
    keywords: ["social", "greeting", "other dogs", "people", "play"] },
  { key: "public", fa: "fa-store", label: "Public access",
    keywords: ["public", "store", "outing", "travel", "restaurant"] },
  { key: "service", fa: "fa-vest", label: "Service & tasks",
    keywords: ["service", "task", "alert", "assist"] },
  { key: "tricks", fa: "fa-star", label: "Tricks",
    keywords: ["trick", "spin", "shake", "roll over"] },
  { key: "graduation", fa: "fa-graduation-cap", label: "Graduation",
    keywords: ["graduation", "final", "assessment", "certificate"] },
];

const FALLBACK = { type: "fa", key: "foundations", fa: "fa-paw" };

/** Resolve one module's icon — override first, derivation second, paw last. */
export function moduleIconFor(module) {
  const icon = module?.icon;
  if (icon?.kind === "image" && icon.image_id) {
    return { type: "image", imageId: icon.image_id };
  }
  if (icon?.kind === "builtin" && icon.builtin) {
    const hit = MODULE_ICON_CHOICES.find((c) => c.key === icon.builtin);
    if (hit) return { type: "fa", key: hit.key, fa: hit.fa };
  }
  const text = `${module?.name || ""} ${module?.description || ""}`.toLowerCase();
  for (const c of MODULE_ICON_CHOICES) {
    if (c.keywords.some((k) => text.includes(k))) {
      return { type: "fa", key: c.key, fa: c.fa };
    }
  }
  return FALLBACK;
}

/* Per-module hue, cycling by the module's 1-based position so every program
 * gets the treatment with zero authoring. Raw colors (not tailwind classes)
 * because they feed inline gradients. */
export const MODULE_HUES = [
  { key: "cyan", main: "#00a9e0", grad: ["#2fbdee", "#0284b8"] },
  { key: "lime", main: "#8cc63f", grad: ["#a5dc55", "#6da42c"] },
  { key: "orange", main: "#f7941d", grad: ["#ffb556", "#e07f0e"] },
  { key: "purple", main: "#a78bfa", grad: ["#c4b0ff", "#7c5cd6"] },
];

export function moduleHue(position) {
  const idx = (Math.max(1, Number(position) || 1) - 1) % MODULE_HUES.length;
  return MODULE_HUES[idx];
}

export const GOLD = { key: "gold", main: "#f2c94c", grad: ["#ffe08a", "#e0a92e"] };
