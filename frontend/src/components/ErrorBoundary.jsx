import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, msg: "" };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, msg: err?.message || String(err) };
  }
  componentDidCatch(err, info) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", err, info);
  }
  reset = () => {
    try { localStorage.removeItem("sh_token"); } catch {}
    window.location.replace("/");
  };
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-bgBase p-4" data-testid="error-boundary">
        <div className="bg-bgPanel border border-bgHover rounded-2xl p-8 max-w-md text-center shadow-2xl">
          <i className="fas fa-triangle-exclamation text-shOrange text-4xl mb-4" />
          <h2 className="text-lg font-black text-white uppercase italic tracking-tight">Something tripped up</h2>
          <p className="text-[13px] text-gray-400 font-black uppercase tracking-widest mt-2">A stale session or bad state crashed the UI. Reset to recover.</p>
          {this.state.msg && <pre className="text-[12px] text-red-400 bg-bgBase rounded p-3 mt-4 text-left whitespace-pre-wrap break-all">{this.state.msg}</pre>}
          <button onClick={this.reset} data-testid="error-reset"
                  className="mt-6 bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[12px] uppercase tracking-widest shadow-xl">
            Clear session & reload
          </button>
        </div>
      </div>
    );
  }
}
