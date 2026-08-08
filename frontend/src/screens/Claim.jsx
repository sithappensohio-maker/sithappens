import { useEffect, useState } from "react";
import axios from "axios";
import PublicBrandShell from "../components/PublicBrandShell";
import { FormError, FormInput, FormLabel, PremiumButton, SectionCard, StatusBadge } from "../components/premium";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

export default function Claim({ token }) {
  const [status, setStatus] = useState("loading"); // loading | invalid | ready | submitting | done
  const [info, setInfo] = useState(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    axios.get(`${API}/claim/${encodeURIComponent(token)}`)
      .then(r => { if (!alive) return;
        if (r.data?.valid) {
          setInfo(r.data);
          setStatus("ready");
          // Staff/admin reset links (is_client=false) never had a passwordless
          // option — go straight to the password form for them.
          setShowPasswordForm(!r.data.is_client);
        }
        else { setStatus("invalid"); }
      })
      .catch(() => alive && setStatus("invalid"));
    return () => { alive = false; };
  }, [token]);

  const finishLogin = (data) => {
    localStorage.setItem("sh_token", data.token);
    setStatus("done");
    // Clean the URL and reload so AuthProvider picks up the new token and routes to the portal.
    setTimeout(() => { window.location.href = "/"; }, 1200);
  };

  const continuePasswordless = async () => {
    setErr("");
    setStatus("submitting");
    try {
      const r = await axios.post(`${API}/claim/${encodeURIComponent(token)}/login`);
      finishLogin(r.data);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Something went wrong. Try again.");
      setStatus("ready");
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (password !== confirmPw) { setErr("Passwords don't match."); return; }
    setStatus("submitting");
    try {
      const r = await axios.post(`${API}/claim/${encodeURIComponent(token)}`, { password });
      finishLogin(r.data);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Something went wrong. Try again.");
      setStatus("ready");
    }
  };

  const firstName = info?.client_name ? info.client_name.split(" ")[0] : "";
  const heading = info?.is_reset ? "RESET YOUR PASSWORD." : firstName ? `WELCOME, ${firstName}.` : "WELCOME TO SIT HAPPENS.";
  const subtitle = info?.is_reset
    ? "Choose a new password and get right back into your account."
    : "Your portal is ready. Finish this one step and you're in.";

  return (
    <PublicBrandShell
      compact
      center
      eyebrow={info?.is_reset ? "Account recovery" : "Portal activation"}
      title={status === "invalid" ? "THIS LINK HAS EXPIRED." : status === "done" ? "YOU'RE ALL SET." : heading}
      subtitle={status === "invalid" ? "Ask your trainer to send a fresh activation link." : status === "done" ? "Signing you in now." : subtitle}
      testid="claim-screen"
      mascotKey={info?.client_name || info?.email || "claim"}
    >
      <SectionCard accent={status === "invalid" ? "danger" : status === "done" ? "lime" : "cyan"} className="w-full max-w-lg sh-claim-card">
        {status === "loading" && (
          <div className="text-center py-10" data-testid="claim-loading">
            <i className="fas fa-circle-notch fa-spin text-3xl text-shSecondary"/>
            <p className="text-shText font-bold mt-4">Verifying your secure link…</p>
            <p className="text-shTextMuted text-[13px] mt-1">This usually takes only a moment.</p>
          </div>
        )}

        {status === "invalid" && (
          <div className="text-center py-4" data-testid="claim-invalid">
            <span className="inline-flex w-14 h-14 rounded-full items-center justify-center bg-shDanger/15 border border-shDanger/30 text-shDanger text-2xl">
              <i className="fas fa-link-slash" />
            </span>
            <h3 className="text-xl font-black text-shText mt-4">Link expired or invalid</h3>
            <p className="mt-2 text-[14px] text-shTextMuted">This activation link is no longer valid. Ask your trainer to send a fresh one.</p>
            <PremiumButton as="a" href="/" variant="secondary" className="mt-5 justify-center">Back to sign in</PremiumButton>
          </div>
        )}

        {(status === "ready" || status === "submitting") && info && (
          <div className="space-y-5" data-testid="claim-ready">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info"><i className="fas fa-shield-halved"/> Secure account link</StatusBadge>
              {info.email && <span className="text-[13px] text-shTextMuted truncate">{info.email}</span>}
            </div>

            {!showPasswordForm && (
              <div className="space-y-3" data-testid="claim-passwordless">
                <p className="text-[14px] text-shTextMuted leading-relaxed">You're almost in — continue below and set a password later, whenever you're ready.</p>
                {err && <div data-testid="claim-error"><FormError>{err}</FormError></div>}
                <PremiumButton
                  type="button"
                  onClick={continuePasswordless}
                  disabled={status === "submitting"}
                  data-testid="claim-continue-passwordless"
                  className="w-full justify-center"
                >
                  {status === "submitting" ? <><i className="fas fa-circle-notch fa-spin"/>Signing you in…</> : <>Continue to setup <i className="fas fa-arrow-right"/></>}
                </PremiumButton>
                <PremiumButton
                  type="button"
                  variant="ghost"
                  onClick={() => { setErr(""); setShowPasswordForm(true); }}
                  data-testid="claim-show-password-form"
                  className="w-full justify-center"
                >
                  Set a password now instead
                </PremiumButton>
              </div>
            )}

            {showPasswordForm && (
              <form onSubmit={submit} className="space-y-4" data-testid="claim-form">
                <div>
                  <FormLabel>New password</FormLabel>
                  <FormInput
                    type="password"
                    value={password}
                    onChange={(e)=>setPassword(e.target.value)}
                    required
                    minLength={8}
                    data-testid="claim-password-input"
                    placeholder="At least 8 characters"
                    autoFocus
                  />
                </div>
                <div>
                  <FormLabel>Confirm password</FormLabel>
                  <FormInput
                    type="password"
                    value={confirmPw}
                    onChange={(e)=>setConfirmPw(e.target.value)}
                    required
                    minLength={8}
                    data-testid="claim-confirm-input"
                    placeholder="Type it again"
                  />
                </div>
                {err && <div data-testid="claim-error"><FormError>{err}</FormError></div>}
                <PremiumButton type="submit" disabled={status === "submitting"} data-testid="claim-submit" className="w-full justify-center">
                  {status === "submitting" ? <><i className="fas fa-circle-notch fa-spin"/>Working…</> : (info.is_reset ? "Reset password" : "Activate account")}
                </PremiumButton>
                {info.is_client && (
                  <PremiumButton
                    type="button"
                    variant="ghost"
                    onClick={() => { setErr(""); setShowPasswordForm(false); }}
                    data-testid="claim-back-to-passwordless"
                    className="w-full justify-center"
                  >
                    Back
                  </PremiumButton>
                )}
              </form>
            )}
          </div>
        )}

        {status === "done" && (
          <div className="text-center py-8" data-testid="claim-done">
            <span className="inline-flex w-16 h-16 rounded-full items-center justify-center bg-shPrimary/15 border border-shPrimary/35 text-shPrimary text-2xl shadow-[0_0_28px_-10px_rgba(140,198,63,.7)]">
              <i className="fas fa-check" />
            </span>
            <h3 className="text-xl font-black text-shText mt-4">Account ready</h3>
            <p className="mt-2 text-[14px] text-shTextMuted">Taking you into Sit Happens…</p>
          </div>
        )}
      </SectionCard>
    </PublicBrandShell>
  );
}
