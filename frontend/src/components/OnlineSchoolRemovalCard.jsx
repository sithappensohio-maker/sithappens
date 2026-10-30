import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Settings → Feature Visibility, shown while Online School is off: removes
 * every Online School and hybrid enrollment with its history, deletes the
 * online-only courses, and switches the online settings off on programs
 * that are also taught in person. Shows what it will remove first. Sales,
 * payments and tax records are never touched.
 */
export default function OnlineSchoolRemovalCard() {
  const confirm = useConfirm();
  const [preview, setPreview] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadErr("");
    api.get("/admin/online-school/removal")
      .then((r) => setPreview(r.data))
      .catch((e) => setLoadErr(formatErr(e?.response?.data?.detail) || "Couldn't check what's left from Online School."));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loadErr) return <p className="text-[12px] text-shDanger" data-testid="os-removal-error">{loadErr}</p>;
  if (!preview) return null;

  const deleting = preview.courses_to_delete || [];
  const blockers = preview.blockers || [];
  const converting = preview.courses_to_convert || [];
  const nothing = !preview.enrollments && !deleting.length && !converting.length;
  if (nothing) {
    return (
      <p className="text-[12px] text-shTextMuted" data-testid="os-removal-done">
        <i className="fas fa-circle-check text-shPrimary mr-1.5"/>Nothing is left from Online School.
      </p>
    );
  }

  const remove = async () => {
    const ok = await confirm({
      title: "Remove Online School for good?",
      body: `This deletes ${plural(preview.enrollments, "online or hybrid enrollment")} with all their progress, and ${plural(deleting.length, "course")}. It can't be undone. Sales, payments and tax records stay.`,
      confirmText: "Remove it", tone: "danger",
    });
    if (!ok) return;
    setBusy(true); setErr("");
    try {
      const { data } = await api.post("/admin/online-school/removal", { confirm: true });
      toast.success(`Online School removed: ${plural(data.enrollments || 0, "enrollment")}, ${plural((data.courses_to_delete || []).length, "course")} deleted.`);
      load();
    } catch (e) {
      // A removal that stopped part way is finished by running it again.
      setErr(formatErr(e?.response?.data?.detail) || "Couldn't finish removing Online School. Press Remove again to finish.");
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-shDanger/40 bg-shDanger/[0.05] p-4 space-y-3" data-testid="os-removal-card">
      <div>
        <p className="text-[13px] font-black uppercase tracking-widest text-shDanger"><i className="fas fa-trash-can mr-1.5"/>Remove Online School</p>
        <p className="text-[12px] text-shTextMuted mt-1">Online School is off. This clears out what it left behind so none of it shows up again.</p>
      </div>
      <ul className="text-[13px] text-shText space-y-1.5 list-disc pl-5" data-testid="os-removal-summary">
        {preview.enrollments > 0 && (
          <li>
            {plural(preview.enrollments, "online or hybrid enrollment")} ({plural(preview.dogs, "dog")}, {plural(preview.clients, "client")})
            {preview.active > 0 && <span className="text-shAccent"> — {preview.active} still in progress</span>}
            , with their lessons, quizzes, checkpoints, practice and notes
          </li>
        )}
        {deleting.length > 0 && <li>Courses deleted: {deleting.map((c) => c.name).join(", ")}</li>}
        {converting.length > 0 && <li>Kept for in-person training, online settings switched off: {converting.map((c) => c.name).join(", ")}</li>}
        {preview.files > 0 && <li>{plural(preview.files, "uploaded video or photo", "uploaded videos and photos")} deleted from the server</li>}
      </ul>
      {(preview.warnings || []).length > 0 && (
        <ul className="text-[12px] text-shAccent space-y-1" data-testid="os-removal-warnings">
          {preview.warnings.map((w) => <li key={w}><i className="fas fa-triangle-exclamation mr-1.5"/>{w}</li>)}
        </ul>
      )}
      {blockers.length > 0 && (
        <div className="rounded-xl border border-shAccent/40 bg-shAccent/[0.06] p-3" data-testid="os-removal-blockers">
          <p className="text-[12px] font-black text-shAccent uppercase tracking-widest">Finish these first</p>
          <ul className="text-[12px] text-shText mt-1 space-y-1">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      <p className="text-[12px] text-shTextMuted">Kept: every sale, payment, refund and tax record, and client messages (just unlinked from the course).</p>
      {err && <p className="text-[12px] text-shDanger" data-testid="os-removal-error">{err}</p>}
      <button type="button" onClick={remove} disabled={busy || blockers.length > 0} data-testid="os-removal-go"
              className="min-h-[44px] px-4 rounded-xl bg-shDanger text-white text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
        <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-trash-can"} mr-1.5`}/>{busy ? "Removing…" : "Remove Online School"}
      </button>
    </div>
  );
}
