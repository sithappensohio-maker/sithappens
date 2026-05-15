import { useEffect, useState } from "react";
import axios from "axios";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

export default function Claim({ token }) {
  const [status, setStatus] = useState("loading"); // loading | invalid | ready | submitting | done
  const [info, setInfo] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    axios.get(`${API}/claim/${encodeURIComponent(token)}`)
      .then(r => { if (!alive) return;
        if (r.data?.valid) { setInfo(r.data); setStatus("ready"); }
        else { setStatus("invalid"); }
      })
      .catch(() => alive && setStatus("invalid"));
    return () => { alive = false; };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (password !== confirmPw) { setErr("Passwords don't match."); return; }
    setStatus("submitting");
    try {
      const r = await axios.post(`${API}/claim/${encodeURIComponent(token)}`, { password });
      localStorage.setItem("sh_token", r.data.token);
      setStatus("done");
      // Clean the URL and reload so AuthProvider picks up the new token and routes to the portal.
      setTimeout(() => { window.location.href = "/"; }, 1200);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Something went wrong. Try again.");
      setStatus("ready");
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-bgBase p-4" data-testid="claim-screen">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-7 shadow-2xl">
        <div className="text-center mb-5">
          <img src="/logo.png" alt="Sit Happens" className="h-24 mx-auto drop-shadow-2xl" />
          <p className="mt-3 text-[11px] text-gray-500 font-black uppercase tracking-[0.25em]">
            Dog Training • Daycare • Boarding
          </p>
        </div>

        {status === "loading" && (
          <p className="text-center text-gray-400 text-sm font-black uppercase tracking-widest py-8" data-testid="claim-loading">
            Verifying link…
          </p>
        )}

        {status === "invalid" && (
          <div className="text-center py-4" data-testid="claim-invalid">
            <div className="mx-auto w-14 h-14 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-2xl mb-3">
              <i className="fas fa-exclamation-triangle" />
            </div>
            <h3 className="text-lg font-black text-white uppercase italic tracking-tight">Link expired or invalid</h3>
            <p className="mt-2 text-[14px] text-gray-400">
              This activation link is no longer valid. Ask your trainer to send a fresh one.
            </p>
            <a href="/" className="inline-block mt-5 text-shBlue font-black uppercase text-[13px] tracking-widest hover:underline">
              Back to sign in
            </a>
          </div>
        )}

        {(status === "ready" || status === "submitting") && info && (
          <form onSubmit={submit} className="space-y-4" data-testid="claim-form">
            <div>
              <h3 className="text-xl font-black text-white uppercase italic tracking-tight">
                {info.is_reset ? "Reset your password" : `Welcome${info.client_name ? ", " + info.client_name.split(" ")[0] : ""}!`}
              </h3>
              <p className="mt-1 text-[14px] text-gray-400">
                {info.is_reset
                  ? "Choose a new password for your Sit Happens portal."
                  : "Set a password to finish activating your portal."}
              </p>
              {info.email && (
                <p className="mt-3 text-[12px] text-gray-500 font-black uppercase tracking-widest">
                  Account · <span className="text-shBlue normal-case">{info.email}</span>
                </p>
              )}
            </div>

            <div>
              <label className="text-[12px] text-gray-400 font-black uppercase tracking-widest">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e)=>setPassword(e.target.value)}
                required
                minLength={6}
                data-testid="claim-password-input"
                className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shBlue outline-none"
                placeholder="At least 6 characters"
                autoFocus
              />
            </div>

            <div>
              <label className="text-[12px] text-gray-400 font-black uppercase tracking-widest">Confirm password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e)=>setConfirmPw(e.target.value)}
                required
                minLength={6}
                data-testid="claim-confirm-input"
                className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shBlue outline-none"
                placeholder="Type it again"
              />
            </div>

            {err && (
              <div data-testid="claim-error" className="text-[13px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={status === "submitting"}
              data-testid="claim-submit"
              className="w-full bg-shGreen text-bgHeader py-3 rounded font-black text-sm uppercase tracking-widest shadow-lg hover:bg-shGreen/90 disabled:opacity-60"
            >
              {status === "submitting" ? "Activating…" : (info.is_reset ? "Reset password" : "Activate account")}
            </button>
          </form>
        )}

        {status === "done" && (
          <div className="text-center py-6" data-testid="claim-done">
            <div className="mx-auto w-14 h-14 rounded-full bg-shGreen/20 text-shGreen flex items-center justify-center text-2xl mb-3">
              <i className="fas fa-check" />
            </div>
            <h3 className="text-lg font-black text-white uppercase italic tracking-tight">You're all set</h3>
            <p className="mt-2 text-[14px] text-gray-400">Signing you in…</p>
          </div>
        )}
      </div>
    </div>
  );
}
