import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import NeonEdge from "./premium/NeonEdge";
import NeonIconStage from "./premium/NeonIconStage";
import SectionCard from "./premium/SectionCard";
import PremiumButton from "./premium/PremiumButton";
import EmptyState from "./premium/EmptyState";
import { accentRgb } from "./premium/tokens";

/* Photography Phase 1 — dedicated full-screen client Photography page.
 * Reuses the existing photography booking service/pricing, the existing
 * per-client + site-wide gallery-link fallback, and the existing
 * service_descriptions copy. The only new data here is the admin-uploaded
 * featured-photo gallery (photography_gallery) and the page headline. */

function GalleryPhoto({ photoId, alt, onClick }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/photography/gallery/${photoId}`)
      .then(({ data }) => { if (!cancelled) setSrc(data.data); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [photoId]);

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`photography-photo-${photoId}`}
      className="relative w-full aspect-square rounded-xl overflow-hidden border border-shBorder hover:border-shAccent/60 transition group"
      style={{ background: "var(--sh-card-base)" }}
    >
      {src ? (
        <img src={src} alt={alt || ""} loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-300" />
      ) : (
        <div className="w-full h-full grid place-items-center text-shTextMuted">
          <i className="fas fa-image text-2xl" />
        </div>
      )}
    </button>
  );
}

function Lightbox({ photos, index, onClose, onPrev, onNext }) {
  const [src, setSrc] = useState(null);
  const touchX = useRef(null);
  const photo = photos[index];

  useEffect(() => {
    if (!photo) return;
    let cancelled = false;
    setSrc(null);
    api.get(`/photography/gallery/${photo.id}`)
      .then(({ data }) => { if (!cancelled) setSrc(data.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [photo]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  if (!photo) return null;

  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (dx > 50) onPrev();
    else if (dx < -50) onNext();
    touchX.current = null;
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-3 sm:p-8"
      onClick={onClose}
      data-testid="photography-lightbox"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button onClick={onClose} className="absolute top-4 right-4 text-shTextMuted hover:text-shText text-2xl z-10" data-testid="photography-lightbox-close">
        <i className="fas fa-xmark" />
      </button>
      {photos.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="hidden sm:grid absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full place-items-center text-shText border border-shBorder hover:border-shAccent/60 transition"
          style={{ background: "var(--sh-card-base)" }}
          data-testid="photography-lightbox-prev"
        >
          <i className="fas fa-chevron-left" />
        </button>
      )}
      <div className="max-w-4xl max-h-full flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {src ? (
          <img src={src} alt={photo.title || ""} className="max-h-[75vh] sm:max-h-[80vh] max-w-full object-contain rounded-lg" />
        ) : (
          <div className="w-72 h-72 grid place-items-center text-shTextMuted">
            <i className="fas fa-spinner fa-spin text-2xl" />
          </div>
        )}
        {(photo.title || photo.caption) && (
          <div className="text-center px-3">
            {photo.title && <p className="text-shText font-bold">{photo.title}</p>}
            {photo.caption && <p className="text-shTextMuted text-[13px] mt-1">{photo.caption}</p>}
          </div>
        )}
      </div>
      {photos.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="hidden sm:grid absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full place-items-center text-shText border border-shBorder hover:border-shAccent/60 transition"
          style={{ background: "var(--sh-card-base)" }}
          data-testid="photography-lightbox-next"
        >
          <i className="fas fa-chevron-right" />
        </button>
      )}
      {photos.length > 1 && (
        <div className="sm:hidden absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-4">
          <button onClick={(e) => { e.stopPropagation(); onPrev(); }} className="text-shText text-xl px-4" data-testid="photography-lightbox-prev-mobile"><i className="fas fa-chevron-left" /></button>
          <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="text-shText text-xl px-4" data-testid="photography-lightbox-next-mobile"><i className="fas fa-chevron-right" /></button>
        </div>
      )}
    </div>
  );
}

export default function PortalPhotography({ pubSettings, client, services = [], onBookSession }) {
  const [photos, setPhotos] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    api.get("/photography/gallery").then(({ data }) => setPhotos(data || [])).catch(() => setPhotos([]));
  }, []);

  const headline = pubSettings?.photography_page?.headline || "Capture the moments worth keeping.";
  const summary = pubSettings?.service_descriptions?.photography
    || "Professional pet photography sessions. Capture your pup's personality with a custom shoot.";
  const portfolioUrl = pubSettings?.client_portal_links?.photography_portfolio_url || "";
  const clientGalleryUrl = client?.photo_gallery_url || pubSettings?.client_portal_links?.photo_gallery_url || "";

  const closeLightbox = () => setLightboxIndex(null);
  const prevPhoto = () => setLightboxIndex((i) => (i - 1 + photos.length) % photos.length);
  const nextPhoto = () => setLightboxIndex((i) => (i + 1) % photos.length);

  return (
    <div className="space-y-6 sm:space-y-8 pb-8" data-testid="portal-photography-page">
      {/* Hero */}
      <NeonEdge accentRgb={accentRgb("orange")} intensity="hero" className="p-5 sm:p-10">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 sm:gap-8 text-center sm:text-left">
          <NeonIconStage icon="fa-camera-retro" accentRgb={accentRgb("orange")} strong sizeClass="w-20 h-20 sm:w-28 sm:h-28" iconSizeClass="text-3xl sm:text-4xl" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-[0.35em] text-shAccent mb-2">Photography</p>
            <h1 className="text-2xl sm:text-4xl font-bold text-shText tracking-tight leading-tight mb-3">{headline}</h1>
            <p className="text-[14px] sm:text-[15px] text-shTextMuted max-w-xl leading-relaxed mb-5">{summary}</p>
            <div className="flex flex-wrap justify-center sm:justify-start gap-3">
              <PremiumButton variant="orange" onClick={() => onBookSession()} data-testid="photography-book-session-btn">
                <i className="fas fa-calendar-plus" /> Book a Session
              </PremiumButton>
              {portfolioUrl && (
                <PremiumButton variant="secondary" as="a" href={portfolioUrl} target="_blank" rel="noreferrer" data-testid="photography-view-galleries-btn">
                  <i className="fas fa-images" /> View Galleries
                </PremiumButton>
              )}
            </div>
          </div>
        </div>
      </NeonEdge>

      {/* Featured Photos */}
      <div data-testid="photography-featured-section">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em] text-shAccent mb-3">
          <i className="fas fa-star mr-1.5" />Featured Photos
        </p>
        {photos.length === 0 ? (
          <EmptyState icon="fa-camera-retro" accent="orange" title="Gallery coming soon" description="Sample photography sessions will appear here." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {photos.map((p, i) => (
              <GalleryPhoto key={p.id} photoId={p.id} alt={p.title} onClick={() => setLightboxIndex(i)} />
            ))}
          </div>
        )}
      </div>

      {/* Sessions & Packages */}
      <div data-testid="photography-packages-section">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em] text-shAccent mb-3">
          <i className="fas fa-tags mr-1.5" />Sessions &amp; Packages
        </p>
        {services.length === 0 ? (
          <SectionCard accent="orange" intensity="subtle">
            <p className="text-shTextMuted text-[13px]">No photography sessions have been configured yet — add them under Settings → Services &amp; Programs → Photography.</p>
          </SectionCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {services.map((svc) => (
              <SectionCard key={svc.id} accent="orange" intensity="standard" className="flex flex-col" data-testid={`photography-package-${svc.id}`}>
                <p className="text-shText font-bold text-[15px] tracking-tight">{svc.name}</p>
                {svc.description && <p className="text-shTextMuted text-[13px] mt-1.5 leading-relaxed flex-1">{svc.description}</p>}
                <div className="flex items-center justify-between mt-4">
                  <div>
                    <p className="text-shAccent font-bold text-xl">${Number(svc.base_price || 0).toFixed(2)}</p>
                    {svc.duration_minutes ? <p className="text-[11px] text-shTextMuted uppercase tracking-widest">{svc.duration_minutes} min</p> : null}
                  </div>
                </div>
                <PremiumButton variant="orange" onClick={() => onBookSession(svc.id)} className="mt-3 w-full justify-center" data-testid={`photography-book-package-${svc.id}`}>
                  Book This Session
                </PremiumButton>
              </SectionCard>
            ))}
          </div>
        )}
      </div>

      {/* Already had a session? */}
      <SectionCard accent="orange" intensity="subtle" data-testid="photography-client-gallery-section">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em] text-shAccent mb-2">Already Had a Session?</p>
        <p className="text-shTextMuted text-[13px] leading-relaxed mb-3">
          Your finished, edited gallery is delivered securely through Pixieset — Sit Happens doesn&apos;t host your finished photos directly.
        </p>
        {clientGalleryUrl ? (
          <PremiumButton variant="secondary" as="a" href={clientGalleryUrl} target="_blank" rel="noreferrer" data-testid="photography-client-gallery-btn">
            <i className="fas fa-arrow-up-right-from-square" /> View Client Galleries
          </PremiumButton>
        ) : (
          <p className="text-[12px] text-shTextMuted italic">No gallery link on file yet — we&apos;ll send you one after your session.</p>
        )}
      </SectionCard>

      {lightboxIndex !== null && (
        <Lightbox photos={photos} index={lightboxIndex} onClose={closeLightbox} onPrev={prevPhoto} onNext={nextPhoto} />
      )}
    </div>
  );
}
