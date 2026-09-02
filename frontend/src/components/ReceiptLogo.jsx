import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * The admin-uploaded business logo (Settings → Receipts), rendered on a
 * receipt. Every receipt payload carries `business_logo_image_id`; until this
 * component was shared, only the settings PREVIEW drew it — real on-screen,
 * printed and emailed receipts printed the business name text instead.
 *
 * `thermal` renders in monochrome so the preview matches what a thermal
 * printer can actually reproduce.
 */
export default function ReceiptLogo({ imageId, thermal, className = "mx-auto mb-1.5", testid = "receipt-logo" }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!imageId) { setSrc(null); return; }
    let cancelled = false;
    api.get(`/shop/media/${imageId}`).then(({ data }) => { if (!cancelled) setSrc(data.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [imageId]);
  if (!src) return null;
  return (
    <img src={src} alt="" data-testid={testid} className={className}
         style={{ maxHeight: thermal ? 40 : 56, filter: thermal ? "grayscale(1) contrast(1.3)" : undefined }} />
  );
}

/** Resolve the logo as a data URL for HTML we build by hand (print windows). */
export async function fetchReceiptLogoDataUrl(imageId) {
  if (!imageId) return null;
  try {
    const { data } = await api.get(`/shop/media/${imageId}`);
    return data?.data || null;
  } catch {
    return null;
  }
}
