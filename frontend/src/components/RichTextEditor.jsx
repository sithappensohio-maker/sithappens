import { useEffect, useRef } from "react";

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
  const ref = useRef(null);
  const lastEmittedRef = useRef("");

  // Sync external value → DOM (only when it differs to avoid caret jumping)
  useEffect(() => {
    if (!ref.current) return;
    if ((value || "") !== lastEmittedRef.current && ref.current.innerHTML !== (value || "")) {
      ref.current.innerHTML = value || "";
    }
  }, [value]);

  const emit = () => {
    if (!ref.current) return;
    const html = ref.current.innerHTML;
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
  const promptLink = () => {
    const url = prompt("Link URL (paste from your browser):", "https://");
    if (url) fmt("createLink", url);
  };
  const insertVar = (v) => {
    document.execCommand("insertText", false, `{{${v}}}`);
    ref.current?.focus();
    emit();
  };

  return (
    <div className="bg-bgInput border border-bgHover rounded">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-bgHover bg-bgPanel/40">
        <ToolbarBtn icon="fa-bold" label="Bold" onClick={() => fmt("bold")} />
        <ToolbarBtn icon="fa-italic" label="Italic" onClick={() => fmt("italic")} />
        <ToolbarBtn icon="fa-underline" label="Underline" onClick={() => fmt("underline")} />
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
      `}</style>

      {/* Variable chips */}
      {variables.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-t border-bgHover bg-bgPanel/30">
          <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest mr-1">Insert:</span>
          {variables.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => insertVar(v)}
              data-testid={`rte-var-${v}`}
              className="bg-shBlue/15 hover:bg-shBlue/30 text-shBlue border border-shBlue/30 rounded px-2 py-0.5 text-[10px] font-black tracking-wider"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
