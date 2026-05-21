import { Component } from "react";
import ErrorState from "./ErrorState";

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
    try { localStorage.removeItem("sh_token"); } catch { /* private mode */ }
    window.location.replace("/");
  };
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-bgBase p-4" data-testid="error-boundary">
        <div className="bg-bgPanel border border-bgHover rounded-2xl max-w-md w-full shadow-2xl">
          <ErrorState
            title="The dog ate our homework"
            message="A stale session or bad state crashed the UI. We'll fetch it back — just hit the button below."
            detail={this.state.msg}
            action={{ label: "Clear session & reload", onClick: this.reset }}
          />
        </div>
      </div>
    );
  }
}
