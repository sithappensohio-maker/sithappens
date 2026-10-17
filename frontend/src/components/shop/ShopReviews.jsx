import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";

/**
 * Reviews on a product page — a published list anyone can read, and (for
 * a signed-in client who's bought the item) a form to write or edit
 * theirs. A submitted review is never shown back as live here — it goes
 * to pending, same as every other review, until an admin approves it
 * (Shop Manager → Reviews).
 */

function StaticStars({ rating, size = "text-[13px]" }) {
  return (
    <span className="inline-flex gap-0.5 text-shAccent" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={`${n <= rating ? "fas" : "far"} fa-star ${size}`} />
      ))}
    </span>
  );
}

function StarInput({ value, onChange }) {
  return (
    <div className="inline-flex gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} data-testid={`shop-review-star-${n}`}
                aria-label={`${n} star${n === 1 ? "" : "s"}`} aria-pressed={value === n}
                className="text-shAccent text-[22px] leading-none focus-visible:outline focus-visible:outline-2
                           focus-visible:outline-shPrimary rounded">
          <i className={n <= value ? "fas fa-star" : "far fa-star"} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function ReviewRow({ review }) {
  const date = review.created_at
    ? new Date(review.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";
  return (
    <li className="py-4 border-b border-shBorder last:border-0" data-testid={`shop-review-${review.id}`}>
      <div className="flex items-center justify-between gap-3">
        <StaticStars rating={review.rating} />
        <span className="text-[11px] text-shTextMuted">{date}</span>
      </div>
      <p className="text-[13px] font-bold text-shText mt-1.5">{review.client_name || "A Sit Happens client"}</p>
      {review.text && <p className="text-[13px] text-shTextMuted mt-1 leading-relaxed">{review.text}</p>}
    </li>
  );
}

function WriteReviewForm({ productId, existing, onCancel, onSubmitted }) {
  const [rating, setRating] = useState(existing?.rating || 0);
  const [text, setText] = useState(existing?.text || "");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    // The submit button is disabled without a rating (see below) — this
    // can only run once one is chosen.
    setBusy(true);
    try {
      await api.post(`/shop/products/${productId}/reviews`, { rating, text: text.trim() || null });
      toast.success("Thanks! Your review is waiting on a quick check before it goes live.");
      onSubmitted?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not submit your review");
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-shBorder p-4 space-y-3" data-testid="shop-review-form">
      <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">
        {existing ? "Edit your review" : "Write a review"}
      </p>
      <StarInput value={rating} onChange={setRating} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={3}
                placeholder="What did you think? (optional)" data-testid="shop-review-text"
                className="w-full rounded-lg border border-shBorder bg-transparent px-3 py-2 text-[13px] text-shText
                           placeholder:text-shTextMuted focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary" />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !rating} data-testid="shop-review-submit"
                className="px-4 py-2 rounded-lg bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest
                           hover:brightness-110 transition disabled:opacity-40">
          {busy ? "Submitting…" : existing ? "Update review" : "Submit review"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} data-testid="shop-review-cancel"
                  className="text-[12px] text-shTextMuted hover:text-shText underline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

const MY_REVIEW_STATUS_LABEL = {
  published: "Your review",
  rejected: "Your review (not shown publicly)",
  pending: "Your review (awaiting approval)",
};

export default function ShopReviews({ productId, mode = "authenticated" }) {
  const isGuest = mode === "guest";
  const isRealClient = mode === "authenticated";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = () => {
    setLoading(true);
    const url = isGuest
      ? `/public/shop/products/${productId}/reviews`
      : `/shop/products/${productId}/reviews`;
    api.get(url)
      .then(({ data: d }) => setData(d))
      .catch(() => setData({ reviews: [], rating_avg: null, rating_count: 0 }))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); setEditing(false); }, [productId, isGuest]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !data) return null;

  const { reviews = [], rating_avg = null, rating_count = 0, my_review = null, can_review = false } = data;
  const showForm = isRealClient && (editing || can_review);

  return (
    <div className="mt-10 border-t border-shBorder pt-8" data-testid="shop-reviews-section">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h2 className="text-shText font-black uppercase tracking-widest text-sm">
          Reviews{rating_count > 0 && <span className="text-shTextMuted ml-2 tabular-nums">({rating_count})</span>}
        </h2>
        {rating_count > 0 && (
          <div className="flex items-center gap-2">
            <StaticStars rating={Math.round(rating_avg)} size="text-[15px]" />
            <span className="text-[13px] font-bold text-shText tabular-nums">{rating_avg.toFixed(1)} out of 5</span>
          </div>
        )}
      </div>

      {isRealClient && (
        showForm ? (
          <div className="mb-4">
            <WriteReviewForm productId={productId} existing={my_review}
                              onCancel={my_review ? () => setEditing(false) : null}
                              onSubmitted={() => { setEditing(false); load(); }} />
          </div>
        ) : my_review ? (
          <div className="rounded-xl border border-shBorder bg-black/15 p-4 mb-4 flex items-center justify-between gap-3"
               data-testid="shop-my-review">
            <div>
              <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-1">
                {MY_REVIEW_STATUS_LABEL[my_review.status] || "Your review"}
              </p>
              <StaticStars rating={my_review.rating} />
            </div>
            <button type="button" onClick={() => setEditing(true)} data-testid="shop-my-review-edit"
                    className="text-[12px] text-shTextMuted hover:text-shText underline">
              Edit
            </button>
          </div>
        ) : null
      )}

      {reviews.length === 0 ? (
        <div className="text-center py-8 px-4 rounded-xl border border-shBorder border-dashed" data-testid="shop-reviews-empty">
          <div className="w-12 h-12 rounded-2xl mx-auto grid place-items-center border border-shBorder">
            <i className="fas fa-star text-shTextMuted text-[17px]" aria-hidden="true" />
          </div>
          <h3 className="text-[14px] font-black text-shText mt-3">No reviews yet</h3>
          <p className="text-[13px] text-shTextMuted mt-1">
            {can_review ? "You've bought this — be the first to share what you think." : "Be the first to share what you think."}
          </p>
        </div>
      ) : (
        <ul data-testid="shop-reviews-list">
          {reviews.map((r) => <ReviewRow key={r.id} review={r} />)}
        </ul>
      )}
    </div>
  );
}
