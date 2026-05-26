/**
 * Sprint 110b — Public certificate share page (no auth required).
 * Mirrors the `/claim/:token` pattern: read the token from window.location.
 */
import { useEffect, useState } from "react";
import axios from "axios";

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
      <div className="min-h-screen bg-bgBase grid place-items-center p-6">
        <div className="bg-bgPanel border border-bgHover rounded-xl p-8 max-w-md text-center" data-testid="share-cert-error">
          <i className="fas fa-circle-exclamation text-4xl text-red-400 mb-3"/>
          <h1 className="text-xl font-black text-white mb-2">Certificate unavailable</h1>
          <p className="text-gray-400 text-sm">{err}</p>
        </div>
      </div>
    );
  }
  if (!cert) {
    return (
      <div className="min-h-screen bg-bgBase grid place-items-center">
        <i className="fas fa-spinner fa-spin text-3xl text-shGreen"/>
      </div>
    );
  }

  const completedDate = cert.completed_at
    ? new Date(cert.completed_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "";

  return (
    <div className="min-h-screen bg-bgBase py-10 px-4" data-testid="share-cert-page">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <p className="text-[12px] font-black uppercase tracking-widest text-gray-500">
            Certificate of completion · Issued by {cert.brand_name}
          </p>
          <h1 className="text-3xl font-black text-white mt-2 italic tracking-tight">
            {cert.dog_name ? `${cert.dog_name}'s ` : ""}Achievement
          </h1>
        </div>

        <div className="bg-white rounded-xl p-3 shadow-2xl mb-6">
          {cert.certificate ? (
            <img src={cert.certificate} alt="Training certificate"
                 data-testid="share-cert-image"
                 className="w-full rounded"/>
          ) : (
            <p className="text-center text-gray-400 py-12">No image attached.</p>
          )}
        </div>

        <div className="bg-bgPanel border border-bgHover rounded-xl p-5">
          <div className="space-y-2 text-center">
            <p className="text-[12px] font-black uppercase tracking-widest text-gray-500">Plan</p>
            <p className="text-xl font-black text-white">{cert.title || "Training Plan"}</p>
            {completedDate && (
              <>
                <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 pt-2">Completed</p>
                <p className="text-sm text-shGreen font-black">{completedDate}</p>
              </>
            )}
          </div>
          <div className="mt-6 flex justify-center gap-2 flex-wrap">
            {cert.certificate && (
              <a href={cert.certificate}
                 download={cert.filename || "certificate.png"}
                 data-testid="share-cert-download"
                 className="bg-shGreen text-bgHeader px-5 py-2.5 rounded text-[13px] font-black uppercase tracking-widest">
                <i className="fas fa-download mr-2"/>Download
              </a>
            )}
            <button onClick={() => {
                      if (navigator.share) {
                        navigator.share({ title: cert.title || "Training Certificate", url: window.location.href });
                      } else {
                        navigator.clipboard.writeText(window.location.href).catch(() => {});
                      }
                    }}
                    data-testid="share-cert-reshare"
                    className="bg-shBlue text-bgHeader px-5 py-2.5 rounded text-[13px] font-black uppercase tracking-widest">
              <i className="fas fa-share-nodes mr-2"/>Share this link
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-600 mt-6 font-black uppercase tracking-widest">
          Powered by {cert.brand_name}
        </p>
      </div>
    </div>
  );
}
