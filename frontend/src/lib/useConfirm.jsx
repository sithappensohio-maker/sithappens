/**
 * Sit Happens confirmation + prompt dialogs.
 *
 * Native browser confirm/prompt dialogs are inconsistent in installed PWAs,
 * cannot be branded, and are awkward on phones. Keep every decision inside
 * the app shell instead.
 */
import { createContext, useCallback, useContext, useRef, useState } from "react";

const ConfirmCtx = createContext(null);
const PromptCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { kind, opts }
  const resolverRef = useRef(null);

  const begin = useCallback((kind, opts) => new Promise((resolve) => {
    resolverRef.current = resolve;
    setState({ kind, opts: typeof opts === "string" ? { title: opts } : (opts || {}) });
  }), []);

  const confirm = useCallback((opts) => begin("confirm", opts), [begin]);
  const prompt = useCallback((opts) => begin("prompt", opts), [begin]);

  const settle = (value) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState(null);
    resolve?.(value);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      <PromptCtx.Provider value={prompt}>
        {children}
        {state?.kind === "confirm" && (
          <ConfirmDialog
            {...state.opts}
            onConfirm={() => settle(true)}
            onCancel={() => settle(false)}
          />
        )}
        {state?.kind === "prompt" && (
          <PromptDialog
            {...state.opts}
            onConfirm={(value) => settle(value)}
            onCancel={() => settle(null)}
          />
        )}
      </PromptCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const fn = useContext(ConfirmCtx);
  if (!fn) throw new Error("useConfirm must be used inside <ConfirmProvider />");
  return fn;
}

export function usePromptDialog() {
  const fn = useContext(PromptCtx);
  if (!fn) throw new Error("usePromptDialog must be used inside <ConfirmProvider />");
  return fn;
}

const TONES = {
  danger:  { border: "border-red-500/40", chip: "bg-red-500/20 text-red-400", cta: "bg-red-500 hover:bg-red-600 text-white", fa: "fa-exclamation-triangle" },
  warning: { border: "border-shAccent/40", chip: "bg-shAccent/15 text-shAccent", cta: "bg-shAccent hover:brightness-110 text-bgHeader", fa: "fa-exclamation" },
  info:    { border: "border-shSecondary/40", chip: "bg-shSecondary/15 text-shSecondary", cta: "bg-shSecondary hover:brightness-110 text-bgHeader", fa: "fa-circle-info" },
};

function ConfirmDialog({
  title = "Are you sure?",
  body,
  confirmText = "Confirm",
  cancelText = "Cancel",
  tone = "danger",
  icon,
  onConfirm,
  onCancel,
}) {
  const toneCfg = TONES[tone] || TONES.danger;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[80]" data-testid="confirm-dialog">
      <div className={`sh-modal-surface border ${toneCfg.border} rounded-2xl w-full max-w-md p-6 sm:p-7 shadow-2xl animate-slide-in`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`${toneCfg.chip} w-11 h-11 rounded-xl flex items-center justify-center text-lg flex-none`}>
            <i className={`fas ${icon || toneCfg.fa}`}/>
          </div>
          <h4 className="text-lg font-black text-shText tracking-tight flex-1">{title}</h4>
        </div>
        {body && <p className="text-[14px] text-shTextMuted leading-relaxed mb-5 whitespace-pre-wrap">{body}</p>}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button onClick={onCancel} data-testid="confirm-no" className="min-h-11 px-5 rounded-lg border border-shBorder text-shTextMuted font-black text-[13px] hover:text-shText">
            {cancelText}
          </button>
          <button onClick={onConfirm} data-testid="confirm-yes" className={`min-h-11 px-7 rounded-lg font-black text-[13px] shadow-lg ${toneCfg.cta}`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptDialog({
  title = "Enter a value",
  body,
  defaultValue = "",
  placeholder = "",
  confirmText = "Save",
  cancelText = "Cancel",
  tone = "info",
  icon = "fa-pen",
  onConfirm,
  onCancel,
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const toneCfg = TONES[tone] || TONES.info;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[80]" data-testid="prompt-dialog">
      <div className={`sh-modal-surface border ${toneCfg.border} rounded-2xl w-full max-w-md p-6 sm:p-7 shadow-2xl animate-slide-in`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`${toneCfg.chip} w-11 h-11 rounded-xl flex items-center justify-center text-lg flex-none`}><i className={`fas ${icon}`}/></div>
          <h4 className="text-lg font-black text-shText tracking-tight flex-1">{title}</h4>
        </div>
        {body && <p className="text-[14px] text-shTextMuted leading-relaxed mb-4 whitespace-pre-wrap">{body}</p>}
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e)=>setValue(e.target.value)}
          onKeyDown={(e)=>{ if (e.key === "Enter") onConfirm(value); }}
          data-testid="prompt-input"
          className="w-full min-h-12 bg-[var(--sh-card-base)] border border-shBorder rounded-lg px-3 py-2 text-shText mb-5"
        />
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button onClick={onCancel} data-testid="prompt-cancel" className="min-h-11 px-5 rounded-lg border border-shBorder text-shTextMuted font-black text-[13px] hover:text-shText">{cancelText}</button>
          <button onClick={()=>onConfirm(value)} data-testid="prompt-confirm" className={`min-h-11 px-7 rounded-lg font-black text-[13px] shadow-lg ${toneCfg.cta}`}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
