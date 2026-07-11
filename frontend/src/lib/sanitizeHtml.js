// Small dependency-free HTML sanitizer for trusted rich-text templates that
// also contain client-supplied replacement values. It preserves normal
// formatting while removing executable markup and unsafe URLs/attributes.
const BLOCKED_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "form", "input", "button",
  "textarea", "select", "option", "meta", "link", "base", "svg", "math",
]);
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction"]);

function safeUrl(value, attr) {
  const v = String(value || "").trim();
  if (!v) return true;
  if (v.startsWith("#") || v.startsWith("/")) return true;
  if (attr === "src" && /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(v)) return true;
  return /^(https?:|mailto:|tel:)/i.test(v);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sanitizeHtml(html) {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(`<div>${String(html || "")}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  root.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tag)) {
      el.remove();
      return;
    }
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value || "";
      if (name.startsWith("on") || name === "srcdoc") {
        el.removeAttribute(attr.name);
        return;
      }
      if (URL_ATTRS.has(name) && !safeUrl(value, name)) {
        el.removeAttribute(attr.name);
        return;
      }
      if (name === "style" && /(expression\s*\(|javascript\s*:|url\s*\()/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });
    if (tag === "a") {
      el.setAttribute("rel", "noopener noreferrer");
      if (el.getAttribute("target") === "_blank") el.setAttribute("target", "_blank");
    }
  });
  return root.innerHTML;
}
