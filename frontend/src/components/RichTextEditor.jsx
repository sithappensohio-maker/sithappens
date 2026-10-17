import { useEffect, useRef } from "react";
import { sanitizeHtml } from "../lib/sanitizeHtml";
import { usePromptDialog } from "../lib/useConfirm";

/**
 * Sprint 110ci — Friendly rich-text editor.
 *
 * Replaces raw HTML textareas with a "what you see is what you get" editor.
 * The operator types like a normal document — clicks Bold/Italic/Link to
 * format selected text — no HTML knowledge required.
 *
 * Output: HTML string (compatible with all the existing `dangerouslySetInnerHTML`
 * renderers used in emails, agreements, previews, etc.).
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Type your text here…",
  testId,
  rows = 6,
  variables = [],  // ["client_name", "total_amount", ...] - rendered as click-to-insert chips
}) {
  const promptDialog = usePromptDialog();
  const ref = useRef(null);
  const lastEmittedRef = useRef("");
  const savedRangeRef = useRef(null);

  // A <select> (Heading) or <input type="color"> needs its OWN focus to
  // work at all — opening either one clears whatever text was selected in
  // the contentEditable body, so by the time its change handler runs
  // there is nothing left for execCommand to act on. A plain <button>
  // (Bold, Italic, the rest of this toolbar) does not have this problem —
  // it never takes over the page's selection the way a native form
  // control opening its own picker does. Saved on mousedown, which fires
  // before the browser moves focus; restored right before the command runs.
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };
  const restoreSelection = () => {
    if (!savedRangeRef.current) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRangeRef.current);
  };

  // Sync external value → DOM (only when it differs to avoid caret jumping)
  useEffect(() => {
    if (!ref.current) return;
    const safeValue = sanitizeHtml(value || "");
    if (safeValue !== lastEmittedRef.current && ref.current.innerHTML !== safeValue) {
      ref.current.innerHTML = safeValue;
    }
  }, [value]);

  const emit = () => {
    if (!ref.current) return;
    const html = sanitizeHtml(ref.current.innerHTML);
    lastEmittedRef.current = html;
    onChange(html);
  };

  // execCommand is "deprecated" by spec but every browser still supports it —
  // and it's the simplest stable WYSIWYG primitive without bringing in a library.
  const fmt = (cmd, arg) => {
    document.execCommand(cmd, false, arg);
    ref.current?.focus();
    emit();
  };
  const promptLink = async () => {
    const url = await promptDialog({
      title: "Add a link",
      body: "Paste the full destination URL.",
      defaultValue: "https://",
      placeholder: "https://example.com",
      confirmText: "Add Link",
      tone: "info",
    });
    if (url?.trim()) fmt("createLink", url.trim());
  };
  const setHeading = (e) => {
    const tag = e.target.value; // "p" | "h2" | "h3"
    restoreSelection();
    fmt("formatBlock", tag === "p" ? "div" : tag);
    e.target.value = "p"; // the dropdown is a one-shot action, not a persistent mode indicator
  };
  const setColor = (e) => {
    restoreSelection();
    fmt("foreColor", e.target.value);
  };
  const insertVar = (v) => {
    document.execCommand("insertText", false, `{{${v}}}`);
    ref.current?.focus();
    emit();
  };

  return (
    <div className="bg-bgBase border border-bgHover rounded">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-bgHover bg-bgPanel/40">
        <select onMouseDown={saveSelection} onChange={setHeading} defaultValue="p"
                data-testid={testId ? `${testId}-heading` : undefined}
                title="Heading" aria-label="Heading"
                className="bg-bgPanel border border-bgHover rounded px-1.5 py-1 text-xs text-gray-300">
          <option value="p">Paragraph</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
        </select>
        <ToolbarBtn icon="fa-bold" label="Bold" onClick={() => fmt("bold")} />
        <ToolbarBtn icon="fa-italic" label="Italic" onClick={() => fmt("italic")} />
        <ToolbarBtn icon="fa-underline" label="Underline" onClick={() => fmt("underline")} />
        <label title="Text color" className="relative w-7 h-7 grid place-items-center text-gray-400 hover:text-white hover:bg-bgHover rounded cursor-pointer">
          <i className="fas fa-palette text-xs" aria-hidden="true" />
          <input type="color" onMouseDown={saveSelection} onChange={setColor}
                 data-testid={testId ? `${testId}-color` : undefined}
                 aria-label="Text color"
                 className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
        <span className="text-gray-700 mx-1">·</span>
        <ToolbarBtn icon="fa-list-ul" label="Bullet list" onClick={() => fmt("insertUnorderedList")} />
        <ToolbarBtn icon="fa-list-ol" label="Numbered list" onClick={() => fmt("insertOrderedList")} />
        <ToolbarBtn icon="fa-link" label="Link" onClick={promptLink} />
        <span className="text-gray-700 mx-1">·</span>
        <ToolbarBtn icon="fa-eraser" label="Clear formatting" onClick={() => fmt("removeFormat")} />
      </div>

      {/* Editor body */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          emit();
        }}
        data-testid={testId}
        data-placeholder={placeholder}
        className="px-3 py-2 text-sm text-white outline-none rte-body"
        style={{ minHeight: `${rows * 1.5}rem`, maxHeight: "60vh", overflowY: "auto" }}
      />

      {/* Inline placeholder via CSS (because contentEditable can't use the native placeholder attribute) */}
      <style>{`
        .rte-body:empty:before {
          content: attr(data-placeholder);
          color: #475569;
          pointer-events: none;
          display: block;
        }
        .rte-body a { color: #00a9e0; text-decoration: underline; }
        .rte-body ul { list-style: disc; padding-left: 1.25rem; margin: 0.25rem 0; }
        .rte-body ol { list-style: decimal; padding-left: 1.5rem; margin: 0.25rem 0; }
        .rte-body h2 { font-size: 1.15em; font-weight: 900; margin: 0.5rem 0 0.25rem; }
        .rte-body h3 { font-size: 1.05em; font-weight: 700; margin: 0.4rem 0 0.2rem; }
      `}</style>

      {/* Variable chips with plain-English labels */}
      {variables.length > 0 && (
        <div className="px-2 py-2 border-t border-bgHover bg-bgPanel/30">
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">
            <i className="fas fa-magic-wand-sparkles mr-1"/>Auto-fill — tap to insert
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {variables.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => insertVar(v)}
                data-testid={`rte-var-${v}`}
                title={`Inserts a placeholder that gets replaced with the actual ${VAR_LABELS[v] || v} when the message is sent`}
                className="bg-shBlue/15 hover:bg-shBlue/30 text-shBlue border border-shBlue/30 rounded px-2 py-0.5 text-[11px] font-black tracking-wider"
              >
                <i className="fas fa-plus text-[8px] mr-1"/>{VAR_LABELS[v] || v}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Plain-English labels for the cryptic {{variable}} names so non-technical
// operators can understand what each chip does.
const VAR_LABELS = {
  first_name: "Client's first name",
  client_name: "Client's full name",
  dog_name: "Dog's name",
  dog_name_or_dogs: "Dog name(s)",
  business_name: "Your business name",
  program_name: "Program name",
  homework_title: "Practice title",
  total_amount: "Total amount",
  installment_count: "Number of payments",
  installment_amount: "Each payment amount",
  schedule_list: "Full payment schedule",
  service_label: "Service name",
  date_range: "Date range",
  due_date: "Due date",
  assigned_by: "Assigned by",
  kennel: "Kennel #",
  remaining: "Remaining count",
  unit: "Unit (days/sessions)",
  amount: "Amount",
  paid_method: "Payment method",
  remaining_count: "# remaining",
  remaining_text: "Remaining summary",
  days_overdue: "Days overdue",
  first_due_date: "First due date",
};

function ToolbarBtn({ onClick, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="text-gray-400 hover:text-white hover:bg-bgHover rounded px-2 py-1 text-xs"
    >
      <i className={`fas ${icon}`}/>
    </button>
  );
}
