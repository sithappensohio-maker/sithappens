import { useEffect, useRef, useState } from "react";
import axios from "axios";
import PublicBrandShell from "../components/PublicBrandShell";
import { PremiumButton, SectionCard } from "../components/premium";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

// Always a sentence: a validation error arrives as a list of objects.
const errText = (e) => {
  const d = e?.response?.data?.detail;
  return typeof d === "string" && d ? d : "This confirmation link didn't work. Change your email again from your profile.";
};

// The link sent to a new address. Opening it is what makes the change real (audit #27).
export default function ConfirmEmail({ token }) {
  const [status, setStatus] = useState("loading"); // loading | done | invalid
  const [email, setEmail] = useState("");
  const [detail, setDetail] = useState("");
  // The link works once. React StrictMode runs this effect twice in development,
  // and the second request would find the link already used, so only the first sends.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) {
      setDetail("This confirmation link is missing its code.");
      setStatus("invalid");
      return;
    }
    axios.post(API + "/portal/email-change/confirm", { token })
      .then((r) => { setEmail(r.data?.email || ""); setStatus("done"); })
      .catch((e) => { setDetail(errText(e)); setStatus("invalid"); });
  }, [token]);

  const toSignIn = () => { window.location.href = "/login"; };

  return (
    <PublicBrandShell
      compact
      center
      eyebrow="Email change"
      title={status === "done" ? "EMAIL CONFIRMED." : status === "invalid" ? "THIS LINK DIDN'T WORK." : "CONFIRMING…"}
      subtitle={status === "done" ? "Your account now uses the new address." : status === "invalid" ? "Nothing was changed on your account." : "This usually takes only a moment."}
      testid="confirm-email-screen"
    >
      <SectionCard accent={status === "invalid" ? "danger" : status === "done" ? "lime" : "cyan"} className="w-full max-w-lg">
        {status === "loading" && (
          <div className="text-center py-10" data-testid="confirm-email-loading">
            <i className="fas fa-circle-notch fa-spin text-3xl text-shSecondary" />
          </div>
        )}

        {status === "done" && (
          <div className="text-center py-4" data-testid="confirm-email-done">
            <p className="text-shText font-bold">Sign in with <span className="break-all">{email}</span> from now on.</p>
            <p className="text-shTextMuted text-[13px] mt-2">Sign in again on this device. Your old sign-in no longer works.</p>
            <div className="mt-6 flex justify-center">
              <PremiumButton variant="primary" onClick={toSignIn} data-testid="confirm-email-signin">Go to sign in</PremiumButton>
            </div>
          </div>
        )}

        {status === "invalid" && (
          <div className="text-center py-4" data-testid="confirm-email-invalid">
            <p className="text-shText font-bold" data-testid="confirm-email-error">{detail}</p>
            <div className="mt-6 flex justify-center">
              <PremiumButton variant="ghost" onClick={toSignIn}>Back to sign in</PremiumButton>
            </div>
          </div>
        )}
      </SectionCard>
    </PublicBrandShell>
  );
}
