/**
 * useConfirm — sandbox-safe replacement for `window.confirm()`.
 *
 * Why: the Emergent preview iframe (and PWA standalone mode on some browsers)
 * silently auto-dismisses `window.confirm()` to `false`, making any "are you
 * sure?" flow appear to "do nothing." This hook is a one-line drop-in:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete dog?", body: "This cannot be undone." }))) return;
 *
 * Render <ConfirmHost /> once near the root of the app — it owns the modal.
 */
import { createContext, useCallback, useContext, useRef, useState } from "react";

const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { opts, resolve }
  const resolverRef = useRef(null);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({ opts: typeof opts === "string" ? { title: opts } : (opts || {}) });
    });
  }, []);

  const settle = (value) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setState(null);
    r?.(value);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmDialog
          {...state.opts}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const fn = useContext(ConfirmCtx);
  if (!fn) throw new Error("useConfirm must be used inside <ConfirmProvider />");
  return fn;
}

function ConfirmDialog({
  title = "Are you sure?",
  body,
  confirmText = "Confirm",
  cancelText = "Cancel",
  tone = "danger", // 'danger' | 'warning' | 'info'
  icon,
  onConfirm,
  onCancel,
}) {
  const toneCfg = {
    danger:  { border: "border-red-500/40",    chip: "bg-red-500/20 text-red-400",    cta: "bg-red-500 hover:bg-red-600 text-white",       fa: "fa-exclamation-triangle" },
    warning: { border: "border-yellow-500/40", chip: "bg-yellow-500/20 text-yellow-400", cta: "bg-yellow-500 hover:bg-yellow-600 text-bgHeader", fa: "fa-exclamation"          },
    info:    { border: "border-shBlue/40",     chip: "bg-shBlue/20 text-shBlue",      cta: "bg-shBlue hover:bg-shBlue/90 text-bgHeader",   fa: "fa-circle-info"          },
  }[tone] || {};

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[80]" data-testid="confirm-dialog">
      <div className={`bg-bgPanel border ${toneCfg.border} rounded-2xl w-full max-w-md p-7 shadow-2xl animate-slide-in`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`${toneCfg.chip} w-12 h-12 rounded-full flex items-center justify-center text-xl`}>
            <i className={`fas ${icon || toneCfg.fa}`}/>
          </div>
          <h4 className="text-lg font-black text-white uppercase italic tracking-tight flex-1">{title}</h4>
        </div>
        {body && <p className="text-[14px] text-gray-300 leading-relaxed mb-5 whitespace-pre-wrap">{body}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} data-testid="confirm-no" className="text-gray-400 font-black uppercase text-[14px] tracking-widest hover:text-white">
            {cancelText}
          </button>
          <button onClick={onConfirm} data-testid="confirm-yes" className={`px-7 py-2.5 rounded font-black text-[14px] uppercase tracking-widest shadow-lg ${toneCfg.cta}`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
