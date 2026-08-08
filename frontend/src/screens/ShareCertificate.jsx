/**
 * Sprint 110b — Public certificate share page (no auth required).
 * Mirrors the `/claim/:token` pattern: read the token from window.location.
 */
import { useEffect, useState } from "react";
import axios from "axios";
import PublicBrandShell from "../components/PublicBrandShell";
import { EmptyState, PremiumButton, SectionCard, StatusBadge } from "../components/premium";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

export default function ShareCertificatePage({ token }) {
  const [cert, setCert] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/share/cert/${token}`);
        setCert(r.data);
      } catch (e) {
        setErr(e.response?.status === 404 ? "This certificate link is invalid or has been revoked." : "Couldn't load certificate.");
      }
    })();
  }, [token]);

  if (err) {
    return (
      <PublicBrandShell compact center eyebrow="Certificate" title="CERTIFICATE UNAVAILABLE." subtitle="This public link can't be opened right now." mascotKey="certificate-error" testid="share-cert-error">
        <EmptyState icon="fa-certificate" accent="danger" title="Certificate unavailable" description={err} />
      </PublicBrandShell>
    );
  }

  if (!cert) {
    return (
      <PublicBrandShell compact center eyebrow="Certificate" title="LOADING ACHIEVEMENT…" subtitle="Verifying this Sit Happens training record." footer={false} mascotKey="certificate-loading">
        <SectionCard accent="cyan" className="w-full max-w-md text-center py-10">
          <i className="fas fa-circle-notch fa-spin text-3xl text-shSecondary"/>
          <p className="text-shTextMuted text-[13px] mt-4">Loading certificate.</p>
        </SectionCard>
      </PublicBrandShell>
    );
  }

  const completedDate = cert.completed_at
    ? new Date(cert.completed_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "";

  const share = () => {
    if (navigator.share) {
      navigator.share({ title: cert.title || "Training Certificate", url: window.location.href });
    } else {
      navigator.clipboard.writeText(window.location.href).catch(() => {});
    }
  };

  return (
    <PublicBrandShell
      eyebrow="Certificate of completion"
      title={cert.dog_name ? `${cert.dog_name.toUpperCase()} DID IT.` : "ACHIEVEMENT UNLOCKED."}
      subtitle={`A verified Sit Happens training achievement${cert.brand_name ? ` issued by ${cert.brand_name}` : ""}.`}
      testid="share-cert-page"
      mascotKey={cert.dog_name || cert.title || "certificate"}
    >
      <div className="sh-certificate-grid max-w-5xl mx-auto">
        <SectionCard accent="lime" intensity="hero" className="sh-certificate-frame p-2 sm:p-3">
          {cert.certificate ? (
            <img
              src={cert.certificate}
              alt="Training certificate"
              data-testid="share-cert-image"
              className="w-full rounded-xl bg-white object-contain"
            />
          ) : (
            <EmptyState icon="fa-image" accent="cyan" title="Certificate image unavailable" description="The achievement record is valid, but no certificate image is attached." />
          )}
        </SectionCard>

        <SectionCard accent="cyan" className="sh-certificate-summary">
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <StatusBadge tone="success" glow><i className="fas fa-circle-check"/> Completed</StatusBadge>
            <StatusBadge tone="info"><i className="fas fa-shield-halved"/> Public verification</StatusBadge>
          </div>

          <p className="sh-eyebrow text-shSecondary">Training plan</p>
          <h2 className="text-2xl sm:text-3xl font-black text-shText mt-2">{cert.title || "Training Plan"}</h2>
          {cert.dog_name && <p className="text-[14px] text-shTextMuted mt-1">Completed by <span className="text-shText font-bold">{cert.dog_name}</span></p>}

          {completedDate && (
            <div className="mt-5 pt-5 border-t border-shBorder">
              <p className="text-[11px] font-bold text-shTextMuted uppercase tracking-wide">Completed</p>
              <p className="text-lg font-black text-shPrimary mt-1">{completedDate}</p>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
            {cert.certificate && (
              <PremiumButton
                as="a"
                href={cert.certificate}
                download={cert.filename || "certificate.png"}
                data-testid="share-cert-download"
                className="justify-center"
              >
                <i className="fas fa-download"/>Download certificate
              </PremiumButton>
            )}
            <PremiumButton type="button" variant="cyan" onClick={share} data-testid="share-cert-reshare" className="justify-center">
              <i className="fas fa-share-nodes"/>Share this link
            </PremiumButton>
          </div>

          <p className="text-[11px] text-shTextMuted mt-6">This page contains only the public certificate record. Private client and training data are not shown.</p>
        </SectionCard>
      </div>
    </PublicBrandShell>
  );
}
