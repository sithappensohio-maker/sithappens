import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import LessonContentBlocks, { orderBlocksForStudent, isDemoMediaBlock } from "../school/student/LessonContentBlocks";

/* The lesson's own demonstration pictures and clips, inside the Practice Coach.
 *
 * A School lesson's images live in its content blocks (Program Studio). The
 * Practice Coach used to know nothing about them: it only reads the practice
 * recipe, whose media slots the editor never fills. So a course full of
 * "Demonstration — Lure to the Floor" pictures showed none of them at the
 * one moment the client is standing next to the dog.
 *
 * This pulls the SAME blocks the lesson page shows (client-safe endpoint,
 * same renderer, same media resolution) and shows just the media ones — the
 * trainer attaches a picture once, in the lesson, and it follows the client
 * into practice automatically. */

/** Demo media blocks for a School lesson, in the order the lesson shows them. */
export function demoBlocksFromLesson(payload) {
  const lesson = payload?.lesson && typeof payload.lesson === "object" ? payload.lesson : payload;
  const blocks = Array.isArray(lesson?.content_blocks) ? lesson.content_blocks : [];
  return orderBlocksForStudent(blocks).filter(isDemoMediaBlock);
}

export function useLessonDemoBlocks(enrollmentId, lessonId) {
  const [blocks, setBlocks] = useState([]);
  useEffect(() => {
    if (!enrollmentId || !lessonId) { setBlocks([]); return undefined; }
    let live = true;
    api.get(`/portal/school/${enrollmentId}/lessons/${lessonId}`)
      .then(({ data }) => { if (live) setBlocks(demoBlocksFromLesson(data)); })
      .catch(() => { if (live) setBlocks([]); });
    return () => { live = false; };
  }, [enrollmentId, lessonId]);
  return blocks;
}

/**
 * variant "full"    — a card with every demo block, for the Coach overview.
 * variant "compact" — a collapsed "What it looks like" row with a thumbnail
 *                     of the first picture, for the rep screen, so the cue
 *                     and the scoring buttons stay together on a phone.
 */
export default function LessonDemoMedia({ blocks = [], enrollmentId, variant = "full", testid }) {
  const [open, setOpen] = useState(false);
  const thumb = useMemo(() => blocks.find((b) => b.type === "image" && b.url)?.url || null, [blocks]);
  if (!blocks.length) return null;
  const count = blocks.length;
  const label = `What it looks like${count > 1 ? ` (${count})` : ""}`;

  if (variant === "compact") {
    return (
      <div className="rounded-xl border border-shSecondary/25 bg-shSecondary/[0.04] overflow-hidden" data-testid={testid}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
                data-testid={testid ? `${testid}-toggle` : undefined}
                className="w-full flex items-center gap-3 px-3 py-2 text-left min-h-[48px]">
          {thumb && <img src={thumb} alt="" className="w-14 h-10 object-cover rounded-md border border-shBorder/50 shrink-0" loading="lazy" />}
          {!thumb && <span className="w-9 h-9 rounded-lg bg-shSecondary/12 border border-shSecondary/30 text-shSecondary grid place-items-center shrink-0"><i className="fas fa-image" /></span>}
          <span className="flex-1 text-[14px] font-black text-shSecondary"><i className="fas fa-camera mr-1.5 text-[12px]" />{label}</span>
          <i className={`fas fa-chevron-${open ? "up" : "down"} text-shTextMuted text-[12px]`} />
        </button>
        {open && (
          <div className="px-3 pb-3" data-testid={testid ? `${testid}-open` : undefined}>
            <LessonContentBlocks blocks={blocks} enrollmentId={enrollmentId} />
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-shSecondary/30 bg-shSecondary/[0.05] p-4 sm:p-5" data-testid={testid}>
      <p className="text-[15px] sm:text-[16px] font-black uppercase tracking-[0.1em] text-shSecondary mb-3"><i className="fas fa-camera mr-1.5" />{label}</p>
      <LessonContentBlocks blocks={blocks} enrollmentId={enrollmentId} />
    </section>
  );
}
