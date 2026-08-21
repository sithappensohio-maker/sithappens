import { useEffect, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { useAuth } from "../lib/auth";
import CsvImportButton from "./CsvImportButton";
import { parseProgramCsv, PROGRAM_CSV_SAMPLE } from "../lib/csvImport";
import ShopImageUpload from "./ShopImageUpload";
import ShopCategoryFields from "./ShopCategoryFields";
import ProgramStudio from "./ProgramStudio";
import { programToTemplate, parseProgramTemplate, remapProgramHomework } from "../lib/programStudioPolish";

/** Canonical single-program loader for every editor entry point.
 *  The list endpoints are bounded (500 rows), so an editor must never depend
 *  on a program appearing in a list response — fetch the current full doc by
 *  id, and only fall back to a caller-supplied row if the fetch fails. */
export async function fetchProgramById(programId, fallbackRow = null) {
  try {
    const { data } = await api.get(`/programs/${programId}`);
    if (data?.id === programId) return data;
  } catch { /* fall through to the caller's row, if any */ }
  return fallbackRow && fallbackRow.id === programId ? fallbackRow : null;
}

/* ============================================================
 *  Admin: Settings → Programs tab. Manage the library of programs.
 *
 *  UI Phase 5 — Program Studio (edit/new) is hidden for any employee
 *  without manage_training_content, on top of the pre-existing server-
 *  side enforcement (every program-authoring endpoint already requires
 *  this permission — see backend/server.py's require_admin_and_permission
 *  calls). This is presentation-only: it hides an entry point a 403 would
 *  reject anyway, it does not change what the permission itself grants.
 * ============================================================ */
export function ProgramsPanel() {
  const confirm = useConfirm();
  const { permissions } = useAuth();
  // Owners/legacy-admin accounts get every permission back as `true` from
  // /me/permissions itself (see backend's _perms_for owner bypass) — so
  // checking the flag directly, with no separate owner special-case here,
  // already covers them.
  const canManage = permissions ? !!permissions.manage_training_content : true; // true while permissions are still loading, to avoid a flash of "forbidden"
  const [programs, setPrograms] = useState([]);
  const [meta, setMeta] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState("");
  const [importing, setImporting] = useState(false);
  const [zipResult, setZipResult] = useState(null);   // last curriculum-package result
  // The one question an import can ask: an archived course already owns this
  // pathway — is this package that course? Holds the server's offer.
  const [adoptPrompt, setAdoptPrompt] = useState(null);
  // Practice Coach recipes, loaded so an exported template can bundle the ones
  // its lessons link to (import recreates them and relinks — see below).
  const [hwTemplates, setHwTemplates] = useState([]);
  useEffect(() => {
    api.get("/homework-templates").then(({ data }) => setHwTemplates(data || [])).catch(() => setHwTemplates([]));
  }, []);

  const load = async () => {
    try {
      const [p, m] = await Promise.all([api.get("/programs"), api.get("/programs/meta")]);
      setPrograms(p.data); setMeta(m.data);
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };
  useEffect(() => { load(); }, []);
  // Shop Organization category/subcategory names, for the list rows only.
  const [shopCategories, setShopCategories] = useState([]);
  useEffect(() => {
    api.get("/shop/categories", { params: { include_inactive: true } })
      .then(({ data }) => setShopCategories(data.categories || []))
      .catch(() => setShopCategories([]));
  }, []);
  const shopCategoryLabel = (p) => {
    if (!p.category_id) return "Uncategorized";
    const cat = shopCategories.find((c) => c.id === p.category_id);
    if (!cat) return "Uncategorized";
    const sub = (cat.subcategories || []).find((s) => s.id === p.subcategory_id);
    return sub ? `${cat.name} / ${sub.name}` : cat.name;
  };

  const importInputRef = useRef(null);
  const zipInputRef = useRef(null);
  // The package the admin is being asked about. A ref, not state: it is a
  // 15 MB data URL and re-rendering the page with it would be wasteful.
  const pendingZipRef = useRef(null);

  const startNew = (type = "private_lessons") => {
    setEdit({
      name: "", slug: "", type, description: "", focus: "",
      format: { count: 1, unit: "sessions" }, min_age_months: 0,
      prereq_slugs: [], modules: [], price: 0, active: true,
      available_online: false, online_description: "", image_id: null,
      category_id: null, subcategory_id: null,
      // Public no-account storefront — training programs are ALWAYS
      // account-required (kind-based hard rule, never a stored flag).
      publicly_visible: false, show_public_price: true,
      requires_dog: false, requires_approval: false, requires_completed_onboarding: false,
    });
  };
  const openEditProgram = async (p) => {
    // Always open the Studio on the CURRENT full document — the list row may
    // be stale, and the list response is bounded, so it is never the source
    // of truth for what the editor loads.
    const full = await fetchProgramById(p.id, p);
    if (!full) { setErr("Could not load program"); return; }
    setEdit({ ...full });
  };
  const closeEditor = () => setEdit(null);
  const onStudioSaved = () => { setEdit(null); load(); };

  // Program templates — download a program (WITH the Practice Coach recipes its
  // lessons link to) as one reusable .json blueprint, and upload one to seed a
  // NEW program: import first recreates the bundled recipes, relinks each
  // lesson to the fresh ids, then opens the editor for review + Save through
  // the normal create path (never a silent import).
  /* Full curriculum package (.zip of manifest.json + media).
   *
   * Distinct from the .json template above, which carries structure only: a
   * package also carries the demonstration images, and the server places them
   * as ordinary image blocks in the order the manifest declares. The server
   * validates the WHOLE package before writing anything, so a broken package
   * cannot leave half a course behind.
   */
  const sendCurriculumZip = async (data, filename, adoptProgramId) => {
    setErr(""); setZipResult(null);
    setImporting(true);
    try {
      const body = { data, filename };
      if (adoptProgramId) body.adopt_program_id = adoptProgramId;
      const { data: summary } = await api.post("/admin/school/curriculum/import", body);
      setZipResult(summary);
      setAdoptPrompt(null);
      pendingZipRef.current = null;
      await load();
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (detail && detail.error_code === "invalid_curriculum_package") {
        // Show every problem, not just the first — an author fixing a package
        // wants the whole list in one go.
        setAdoptPrompt(null);
        setZipResult({ errors: detail.errors || [] });
      } else if (detail && detail.error_code === "archived_course_adoption_required") {
        // Not a failure — a question. Nothing was written, so hold onto the
        // package and ask before doing anything to an archived course.
        pendingZipRef.current = { data, filename };
        setAdoptPrompt(detail);
      } else {
        setAdoptPrompt(null);
        pendingZipRef.current = null;
        setErr(formatErr(detail) || "Curriculum import failed");
      }
    }
    setImporting(false);
  };

  const importCurriculumZip = async (file) => {
    setErr(""); setZipResult(null); setAdoptPrompt(null);
    pendingZipRef.current = null;
    if (!file) return;
    setImporting(true);
    let data;
    try {
      data = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error("Could not read that file"));
        fr.readAsDataURL(file);
      });
    } catch (e) {
      setErr(e.message || "Could not read that file");
      setImporting(false);
      return;
    }
    await sendCurriculumZip(data, file.name);
  };

  const confirmAdoption = async () => {
    const pending = pendingZipRef.current;
    if (!pending || !adoptPrompt || importing) return;
    await sendCurriculumZip(pending.data, pending.filename, adoptPrompt.program_id);
  };

  const cancelAdoption = () => {
    setAdoptPrompt(null);
    pendingZipRef.current = null;
  };

  const exportTemplate = (p) => {
    const blob = new Blob([JSON.stringify(programToTemplate(p, hwTemplates), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (p.name || "program").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "program";
    a.href = url; a.download = `sit-happens-program-${safe}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const importTemplate = async (file) => {
    setErr("");
    if (!file) return;
    let bundle;
    try {
      bundle = parseProgramTemplate(JSON.parse(await file.text()));
    } catch (e) {
      setErr("Couldn't read that template file — make sure it's a .json exported from a program.");
      return;
    }
    if (!bundle) { setErr("That file isn't a Sit Happens program template (no program with modules and a name)."); return; }
    let program = bundle.program;
    if (bundle.homeworkTemplates.length) {
      // Recreate each bundled Practice Coach recipe, then relink lessons to the
      // fresh ids. Recipes are independently-useful library records, so leaving
      // them behind if the operator later cancels the Save is harmless.
      setImporting(true);
      try {
        const idMap = {};
        for (const t of bundle.homeworkTemplates) {
          const body = { ...t };
          delete body.id; delete body._id; delete body.created_at; delete body.practice_coach_readiness;
          const { data } = await api.post("/homework-templates", body);
          if (t.id && data?.id) idMap[t.id] = data.id;
        }
        program = remapProgramHomework(program, idMap);
      } catch (e) {
        setImporting(false);
        setErr(formatErr(e) || "Couldn't recreate this template's practice recipes.");
        return;
      }
      setImporting(false);
    }
    setEdit(program); // id-less => opens Program Studio as a NEW program for review + Save
  };

  const remove = async (id) => {
    if (!(await confirm({ title: "Archive this program?", body: "Existing dogs already enrolled in this program will keep their progress. New enrollments will no longer be possible.", confirmText: "Archive", tone: "warning" }))) return;
    try { await api.delete(`/programs/${id}`); load(); } catch (e) { setErr(e.response?.data?.detail); }
  };

  if (!meta) return <p className="text-gray-500 text-sm">Loading…</p>;
  const grouped = meta.types.map(t => ({ ...t, items: programs.filter(p => p.type === t.key && p.type !== "custom" || (t.key === "custom" && p.type === "custom")) }));

  return (
    <div className="space-y-5 max-w-4xl" data-testid="programs-panel">
      {/* The heading block needs min-w-0 or its description's min-content
          width keeps the row from shrinking, which pushed the shrink-0 action
          buttons past the panel's right edge. flex-wrap lets the buttons drop
          to their own line before that can happen at all. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-black text-shBlue uppercase tracking-widest"><i className="fas fa-list-check mr-2"/>Training Programs</h4>
          <p className="text-[14px] text-gray-300 mt-1">Tiers and curricula you offer. Seeded from your website&rsquo;s standard lineup.</p>
        </div>
        {/* No shrink-0 on the action group: it pinned the group at its 386px
            max-content width, so flex-wrap could never actually engage and the
            buttons ran past the panel edge on a narrow canvas. */}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" data-testid="prog-import-input"
                   onChange={(e)=>{ const f = e.target.files?.[0]; e.target.value = ""; importTemplate(f); }} />
            <input ref={zipInputRef} type="file" accept=".zip,application/zip" className="hidden" data-testid="prog-import-zip-input"
                   onChange={(e)=>{ const f = e.target.files?.[0]; e.target.value = ""; importCurriculumZip(f); }} />
            <button onClick={()=>zipInputRef.current?.click()} data-testid="prog-import-zip" disabled={importing}
                    className="border border-shGreen/60 text-shGreen px-3 py-2 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shGreen/10 disabled:opacity-60"><i className={`fas ${importing ? "fa-spinner fa-spin" : "fa-file-zipper"} mr-1`}/>{importing ? "Importing…" : "Import Curriculum"}</button>
            <button onClick={()=>importInputRef.current?.click()} data-testid="prog-import" disabled={importing}
                    className="border border-shBlue/60 text-shBlue px-3 py-2 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shBlue/10 disabled:opacity-60"><i className={`fas ${importing ? "fa-spinner fa-spin" : "fa-file-import"} mr-1`}/>{importing ? "Importing…" : "Import Template"}</button>
            <button onClick={()=>startNew()} data-testid="prog-new"
                    className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow"><i className="fas fa-plus mr-1"/>New Program</button>
          </div>
        )}
      </div>

      {!canManage && (
        <div className="text-center text-gray-400 py-6 text-sm" data-testid="programs-forbidden">
          You don&rsquo;t have permission to manage training content. Ask an owner/admin to grant the Manage Training Content permission — you can still view the catalog below.
        </div>
      )}

      {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-2 uppercase font-black">{err}</div>}

      {adoptPrompt && (
        <div className="rounded-xl border border-shAccent/50 bg-shAccent/[0.07] p-4" data-testid="zip-adopt-prompt">
          <p className="text-[13px] font-black text-shAccent uppercase tracking-widest">
            Existing archived course found
          </p>
          <p className="text-[15px] font-black text-shText mt-1" data-testid="zip-adopt-name">
            {adoptPrompt.program_name}
          </p>
          <p className="text-[14px] text-shText mt-2">
            Use this course for the imported curriculum?
          </p>
          <p className="text-[12px] text-shTextMuted mt-1">
            Nothing has been imported yet. Choosing this course keeps its enrollments,
            progress and history, and adds {adoptPrompt.lessons} lesson{adoptPrompt.lessons === 1 ? "" : "s"},
            {" "}{adoptPrompt.images} demonstration image{adoptPrompt.images === 1 ? "" : "s"} and
            {" "}{adoptPrompt.practice_recipes} Practice recipe{adoptPrompt.practice_recipes === 1 ? "" : "s"} to it.
          </p>
          {adoptPrompt.will_reactivate && (
            <p className="text-[13px] font-black text-shAccent mt-2" data-testid="zip-adopt-reactivate">
              This import will reactivate the course.
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <button onClick={confirmAdoption} disabled={importing} data-testid="zip-adopt-confirm"
                    className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-60">
              {importing ? "Importing…" : "Use this course"}
            </button>
            <button onClick={cancelAdoption} disabled={importing} data-testid="zip-adopt-cancel"
                    className="border border-bgHover text-shTextMuted px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-60">
              Cancel
            </button>
          </div>
        </div>
      )}

      {zipResult && (zipResult.errors?.length ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/[0.06] p-4" data-testid="zip-import-errors">
          <p className="text-[13px] font-black text-red-300 uppercase tracking-widest">Package not imported</p>
          <p className="text-[12px] text-shTextMuted mt-1">Nothing was created — fix these and upload again.</p>
          <ul className="mt-2 space-y-1 list-disc pl-5">
            {zipResult.errors.map((e, i) => <li key={i} className="text-[13px] text-shText">{e}</li>)}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border border-shGreen/40 bg-shGreen/[0.06] p-4" data-testid="zip-import-summary">
          <p className="text-[13px] font-black text-shGreen uppercase tracking-widest">
            Curriculum {zipResult.program_action === "updated" ? "updated"
              : zipResult.program_action === "adopted" ? "added to the existing course"
              : "imported"}
          </p>
          <p className="text-[14px] font-black text-shText mt-1">{zipResult.program_name}</p>
          <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[13px] text-shTextMuted">
            <li>{zipResult.modules} module{zipResult.modules === 1 ? "" : "s"}</li>
            <li>{zipResult.lessons} lesson{zipResult.lessons === 1 ? "" : "s"}</li>
            <li>{zipResult.blocks} content block{zipResult.blocks === 1 ? "" : "s"}</li>
            <li>{zipResult.images} demonstration image{zipResult.images === 1 ? "" : "s"} placed</li>
            {zipResult.videos > 0 && <li>{zipResult.videos} video{zipResult.videos === 1 ? "" : "s"}</li>}
            <li className={zipResult.unplaced_media ? "text-shAccent" : ""}>
              {zipResult.unplaced_media} image{zipResult.unplaced_media === 1 ? " needs" : "s need"} placement
            </li>
          </ul>
          {zipResult.unplaced_media > 0 && (
            <p className="text-[12px] text-shTextMuted mt-2">
              Kept in School Resources so you can drop {zipResult.unplaced_media === 1 ? "it" : "them"} into a lesson yourself.
            </p>
          )}
        </div>
      ))}

      {grouped.filter(g => g.items.length > 0 || g.key !== "custom").map(g => (
        <div key={g.key} className="bg-bgBase/40 border border-bgHover rounded">
          <div className="px-3 py-2 border-b border-bgHover flex items-center justify-between" style={{background: g.color + "12"}}>
            <p className="text-[15px] font-black uppercase tracking-widest" style={{color: g.color}}>{g.label} · {g.items.length}</p>
          </div>
          <div className="divide-y divide-bgHover">
            {g.items.length === 0 && <p className="px-3 py-3 text-[15px] text-gray-500 italic">No programs in this category.</p>}
            {/* Row is flex-wrap with a name floor: at 320px the price and the
                three icon actions could not fit beside the name, and with no
                shrink-0 they simply ran past the panel edge. They now drop to
                a second line instead. */}
            {g.items.map(p => (
              <div key={p.id} className="px-3 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[9rem]">
                  <p className="text-sm font-black text-white">{p.name} {p.is_default && <span className="text-[13px] text-gray-500 font-black tracking-widest ml-2">DEFAULT</span>} {p.draft && <span className="text-[13px] text-orange-400 font-black tracking-widest ml-2">DRAFT SAVED</span>}</p>
                  <p className="text-[15px] text-gray-400">{p.modules.length} modules · {p.modules.reduce((a,m)=>a+m.goals.length,0)} goals · {p.format?.count} {p.format?.unit}</p>
                  <p className="text-[11px] text-gray-500 uppercase tracking-widest mt-0.5 truncate">{shopCategoryLabel(p)}</p>
                </div>
                <p className="text-shGreen font-black text-[16px] whitespace-nowrap shrink-0">${Number(p.price || 0).toFixed(2)}</p>
                {canManage && (
                  <>
                    <button onClick={()=>exportTemplate(p)} data-testid={`prog-export-${p.id}`} title="Download as reusable template" className="text-gray-400 hover:text-white text-sm px-2"><i className="fas fa-file-export"/></button>
                    <button onClick={()=>openEditProgram(p)} data-testid={`prog-edit-${p.id}`} title="Edit" className="text-shBlue hover:text-white text-sm px-2"><i className="fas fa-pen"/></button>
                    <button onClick={()=>remove(p.id)} title="Archive" className="text-red-400 hover:text-red-300 text-sm px-2"><i className="fas fa-trash"/></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {edit && <ProgramStudio programId={edit.id || null} initialProgram={edit} meta={meta} allPrograms={programs} onClose={closeEditor} onSaved={onStudioSaved} />}
    </div>
  );
}

/* ============================================================
 *  Program editor modal — used for both standard and custom programs
 * ============================================================ */
export function ProgramEditor({ program, setProgram, meta, allPrograms = [], onSave, onClose, hideTypePicker = false, extraError = "", originalImageId = null }) {
  // Sprint 110bx — load homework templates so we can pick which one auto-sends
  // on enrollment (welcome) and after a module is mastered.
  const [hwTemplates, setHwTemplates] = useState([]);
  // Sprint 110di-62 — load all email templates so the operator can bind a custom
  // welcome email that fires the moment the program is sold.
  const [emailTemplates, setEmailTemplates] = useState([]);
  useEffect(() => {
    api.get("/homework-templates")
      .then(r => setHwTemplates(r.data || []))
      .catch(() => setHwTemplates([]));
    api.get("/admin/email-templates")
      .then(r => setEmailTemplates((r.data || []).filter(t => t.audience === "client")))
      .catch(() => setEmailTemplates([]));
  }, []);

  const set = (patch) => setProgram(p => ({ ...p, ...patch }));
  const addModule = () => set({ modules: [...(program.modules||[]), { name: "New module", description: "", goals: [] }] });
  const removeModule = (i) => set({ modules: program.modules.filter((_, j) => j !== i) });
  const updateModule = (i, patch) => set({ modules: program.modules.map((m, j) => j === i ? { ...m, ...patch } : m) });
  const addGoal = (mi) => updateModule(mi, { goals: [...(program.modules[mi].goals||[]), { name: "New goal", description: "" }] });
  const removeGoal = (mi, gi) => updateModule(mi, { goals: program.modules[mi].goals.filter((_, j) => j !== gi) });
  const updateGoal = (mi, gi, patch) => updateModule(mi, { goals: program.modules[mi].goals.map((g, j) => j === gi ? { ...g, ...patch } : g) });

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="program-editor">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-3xl max-h-[calc(var(--app-height)_-_2rem)] flex flex-col min-h-0 shadow-2xl">
        <div className="px-6 py-4 border-b border-bgHover flex items-center justify-between shrink-0">
          <h4 className="text-base font-black text-white uppercase italic">{program.id?"Edit Program":"New Program"}</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl"/></button>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name *">
              <input value={program.name} onChange={(e)=>set({name:e.target.value})} data-testid="prog-name"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </Field>
            {!hideTypePicker && (
              <Field label="Type">
                <select value={program.type} onChange={(e)=>set({type:e.target.value})}
                        className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {meta.types.filter(t => t.key !== "custom").map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="Description"><textarea value={program.description||""} onChange={(e)=>set({description:e.target.value})} rows={2} className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/></Field>
          <Field label="Focus (short summary)"><input value={program.focus||""} onChange={(e)=>set({focus:e.target.value})} className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/></Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Sessions / credits issued">
              <input type="number" min="1" value={program.format?.count||1} onChange={(e)=>set({format:{...program.format, count: parseInt(e.target.value)||1}})} data-testid="prog-format-count"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
              <p className="text-[12px] text-gray-500 mt-1 normal-case font-normal tracking-normal">When a client buys this program they get this many credits.</p>
            </Field>
            <Field label="Unit">
              <select value={program.format?.unit||"sessions"} onChange={(e)=>set({format:{...program.format, unit: e.target.value}})}
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                <option value="sessions">Sessions</option><option value="weeks">Weeks</option><option value="days">Days</option><option value="months">Months</option>
              </select>
            </Field>
            <Field label="Min age (months)"><input type="number" min="0" value={program.min_age_months||0} onChange={(e)=>set({min_age_months: parseInt(e.target.value)||0})} className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/></Field>
          </div>

          <Field label="Price (USD)">
            <input type="number" min="0" step="0.01" value={program.price ?? 0}
                   onChange={(e)=>set({price: parseFloat(e.target.value)||0})} data-testid="prog-price"
                   placeholder="e.g. 450.00"
                   className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
            <p className="text-[13px] text-gray-500 mt-1 normal-case font-normal tracking-normal">Shown on the client portal so prospects can see what each program costs.</p>
          </Field>

          {/* Shop Organization — purely organizational, independent of online
              visibility. A program can be categorized whether or not it's
              available online. */}
          <div className="border-t border-bgHover pt-3 space-y-3">
            <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black">Shop Category</p>
            <ShopCategoryFields categoryId={program.category_id} subcategoryId={program.subcategory_id} section="training"
                                onChange={(patch) => set(patch)} />
          </div>

          {/* Client Shop Phase 1 — additive online-visibility controls. */}
          <div className="border-t border-bgHover pt-3 space-y-3">
            <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black">Client Shop</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!program.available_online}
                     onChange={(e)=>set({available_online: e.target.checked})}
                     data-testid="prog-available-online" />
              <span className="text-white text-sm">Available Online (client Shop)</span>
            </label>
            {program.available_online && (
              <div className="space-y-3">
                <Field label="Online Description (optional — falls back to Description)">
                  <input value={program.online_description||""} onChange={(e)=>set({online_description: e.target.value})}
                         data-testid="prog-online-description"
                         className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                </Field>
                <Field label="Program Photo">
                  <ShopImageUpload imageId={program.image_id} originalImageId={originalImageId}
                                   onChange={(id)=>set({image_id: id})} />
                </Field>
              </div>
            )}
          </div>

          {/* Public no-account storefront — training programs always
              require signing in to buy; these only affect browsing. */}
          {program.available_online && (
            <div className="border-t border-bgHover pt-3 space-y-3">
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black">Public Storefront (signed-out visitors)</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!program.publicly_visible}
                       onChange={(e)=>set({publicly_visible: e.target.checked})}
                       data-testid="prog-publicly-visible" />
                <span className="text-white text-sm">Publicly Visible (shown to signed-out visitors — always requires sign-in to buy)</span>
              </label>
              {program.publicly_visible && (
                <>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={program.show_public_price !== false}
                           onChange={(e)=>set({show_public_price: e.target.checked})}
                           data-testid="prog-show-public-price" />
                    <span className="text-white text-sm">Show Price to Guests</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!program.requires_dog}
                           onChange={(e)=>set({requires_dog: e.target.checked})}
                           data-testid="prog-requires-dog" />
                    <span className="text-white text-sm">Requires Selecting a Dog</span>
                  </label>
                  {program.requires_dog && (
                    <p className="text-[12px] text-amber-400" data-testid="prog-requires-dog-warning">
                      Until real dog-selection support is built, this blocks online checkout entirely — customers will be directed to contact staff.
                    </p>
                  )}
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!program.requires_approval}
                           onChange={(e)=>set({requires_approval: e.target.checked})}
                           data-testid="prog-requires-approval" />
                    <span className="text-white text-sm">Requires Approval</span>
                  </label>
                  {program.requires_approval && (
                    <p className="text-[12px] text-amber-400" data-testid="prog-requires-approval-warning">
                      Until real approval-workflow support is built, this blocks online checkout entirely — customers will be directed to contact staff.
                    </p>
                  )}
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!program.requires_completed_onboarding}
                           onChange={(e)=>set({requires_completed_onboarding: e.target.checked})}
                           data-testid="prog-requires-onboarding" />
                    <span className="text-white text-sm">Requires Completed Account Setup</span>
                  </label>
                </>
              )}
            </div>
          )}

          {/* Sprint 110bx — Welcome homework: auto-sent the moment the dog is enrolled */}
          <Field label="Welcome Practice (auto-sent on enrollment)">
            <select value={program.welcome_homework_template_id||""}
                    onChange={(e)=>set({welcome_homework_template_id: e.target.value || null})}
                    data-testid="prog-welcome-hw"
                    className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="">— None (no welcome Practice) —</option>
              {hwTemplates.map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.tier ? ` · ${t.tier}` : ""}</option>
              ))}
            </select>
            <p className="text-[13px] text-gray-500 mt-1 normal-case font-normal tracking-normal">
              <i className="fas fa-envelope mr-1 text-shGreen"/>Auto-assigns Practice + emails the client the moment a dog is enrolled in this program.
            </p>
          </Field>

          {/* Sprint 110di-62 — Welcome email: custom template that fires when the program is sold */}
          <Field label="Welcome email (auto-sent when program is sold)">
            <select value={program.welcome_email_template_slug||""}
                    onChange={(e)=>set({welcome_email_template_slug: e.target.value || null})}
                    data-testid="prog-welcome-email"
                    className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="">— None (use default sale email) —</option>
              {emailTemplates.map(t => (
                <option key={t.slug} value={t.slug}>{t.name}{t.kind === "custom" ? " · Custom" : ""}</option>
              ))}
            </select>
            <p className="text-[13px] text-gray-500 mt-1 normal-case font-normal tracking-normal">
              <i className="fas fa-paper-plane mr-1 text-shBlue"/>Sends this template (e.g. &ldquo;Welcome to Puppy Basics&rdquo;) the moment a client buys this program. Create new templates from Settings → Email Designer.
            </p>
          </Field>

          {allPrograms.length > 0 && !hideTypePicker && (
            <Field label="Prerequisites (any of these)">
              <select multiple value={program.prereq_slugs||[]} onChange={(e)=>set({prereq_slugs: Array.from(e.target.selectedOptions, o => o.value)})}
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm h-24">
                {allPrograms.filter(p => p.slug && p.id !== program.id).map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
              </select>
            </Field>
          )}

          {/* Completion rule */}
          <div className="bg-bgBase/40 border border-bgHover rounded p-3">
            <p className="text-[15px] font-black uppercase tracking-widest text-shBlue mb-2"><i className="fas fa-flag-checkered mr-2"/>Completion Rule</p>
            <p className="text-[15px] text-gray-400 mb-2">When is a dog ready to graduate from this program?</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { k: "percent", label: "% mastered", icon: "fa-percent" },
                { k: "all_mastered", label: "All goals", icon: "fa-list-check" },
                { k: "manual", label: "Manual sign-off", icon: "fa-hand-pointer" },
                { k: "sessions", label: "Session count", icon: "fa-calendar-check" },
              ].map(rt => (
                <button key={rt.k} type="button" onClick={()=>set({completion_rule:{...(program.completion_rule||{}), type: rt.k}})}
                        data-testid={`rule-${rt.k}`}
                        className={`py-2 rounded text-[15px] font-black uppercase tracking-widest border ${(program.completion_rule?.type||"percent")===rt.k?"bg-shBlue text-white border-shBlue":"bg-bgPanel border-bgHover text-gray-400"}`}>
                  <i className={`fas ${rt.icon} mr-1`}/>{rt.label}
                </button>
              ))}
            </div>
            {((program.completion_rule?.type||"percent")==="percent" || program.completion_rule?.type==="sessions") && (
              <div className="mt-2 flex items-center gap-2">
                <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">{program.completion_rule?.type==="sessions"?"Required sessions":"Threshold %"}:</label>
                <input type="number" min="1" max={program.completion_rule?.type==="sessions"?100:100}
                       value={program.completion_rule?.threshold ?? (program.completion_rule?.type==="sessions"?5:80)}
                       onChange={(e)=>set({completion_rule:{...(program.completion_rule||{type:"percent"}), threshold: parseInt(e.target.value)||0}})}
                       className="w-24 bg-bgPanel border border-bgHover rounded p-1.5 text-white text-sm" />
              </div>
            )}
          </div>

          {/* Module builder */}
          <div className="border-t border-bgHover pt-3">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-[15px] font-black uppercase tracking-widest text-shBlue">Modules & Goals</p>
              <div className="flex items-center gap-2 flex-wrap">
                <CsvImportButton
                  label="Import from CSV"
                  parse={parseProgramCsv}
                  sampleText={PROGRAM_CSV_SAMPLE}
                  sampleFilename="program-template.csv"
                  testIdPrefix="program-csv"
                  helpText="Columns: module_name, module_description (optional), goal_name, goal_description (optional). Rows append to existing modules."
                  onImport={(parsed) => {
                    if (!parsed?.modules?.length) return;
                    set({ modules: [...(program.modules || []), ...parsed.modules] });
                  }}
                />
                <button onClick={addModule} data-testid="add-module"
                        className="bg-bgBase border border-shGreen/40 text-shGreen px-3 py-1 rounded text-[15px] font-black uppercase tracking-widest hover:bg-shGreen/15"><i className="fas fa-plus mr-1"/>Add Module</button>
              </div>
            </div>
            {(program.modules||[]).length === 0 && <p className="text-[15px] text-gray-500 italic py-3">No modules yet. Add one to begin.</p>}
            <div className="space-y-3">
              {(program.modules||[]).map((m, mi) => (
                <div key={mi} className="bg-bgBase/50 border border-bgHover rounded p-3">
                  <div className="flex gap-2 mb-2">
                    <input value={m.name} onChange={(e)=>updateModule(mi, {name:e.target.value})}
                           className="flex-1 bg-transparent border-b border-bgHover text-sm font-black text-white outline-none focus:border-shBlue py-1" />
                    <button onClick={()=>removeModule(mi)} className="text-red-400 hover:text-red-300"><i className="fas fa-trash text-xs"/></button>
                  </div>
                  <input value={m.description||""} onChange={(e)=>updateModule(mi, {description:e.target.value})}
                         placeholder="Module description (optional)"
                         className="w-full bg-bgBase border border-bgHover rounded p-1.5 text-[15px] text-gray-300 mb-2" />
                  {/* Sprint 110bz — homework for THIS module: auto-sent the moment
                      the client begins this module (module 1 → at enrollment;
                      module 2..N → when the previous module's goals are mastered). */}
                  <div className="mb-2 bg-shGreen/5 border border-shGreen/30 rounded p-2">
                    <label className="block">
                      <span className="text-[11px] font-black uppercase tracking-widest text-shGreen">
                        <i className="fas fa-envelope-open-text mr-1"/>Practice for this module
                        {mi === 0 ? " · sent at enrollment" : ` · sent when module ${mi} is mastered`}
                      </span>
                      <select value={m.homework_template_id||""}
                              onChange={(e)=>updateModule(mi, {homework_template_id: e.target.value || null})}
                              data-testid={`prog-module-hw-${mi}`}
                              className="mt-1 w-full bg-bgPanel border border-bgHover rounded p-1.5 text-white text-[13px]">
                        <option value="">— None (no automatic Practice for this module) —</option>
                        {hwTemplates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}{t.tier ? ` · ${t.tier}` : ""}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-gray-500 mt-1 normal-case font-normal tracking-normal">
                        {mi === 0
                          ? "This is module 1 — its Practice is sent the moment the dog is enrolled in the program."
                          : `Sent automatically when all goals in the previous module ("${(program.modules[mi-1]||{}).name || `Module ${mi}`}") are marked mastered.`}
                      </p>
                    </label>
                  </div>
                  <div className="space-y-1">
                    {(m.goals||[]).map((g, gi) => (
                      <div key={gi} className="bg-bgPanel rounded px-2 py-1.5">
                        <div className="flex gap-2 items-center">
                          <i className="fas fa-circle-dot text-shGreen text-[12px]"/>
                          <input value={g.name} onChange={(e)=>updateGoal(mi, gi, {name:e.target.value})}
                                 className="flex-1 bg-transparent text-[14px] text-white outline-none" />
                          <input value={g.description||""} onChange={(e)=>updateGoal(mi, gi, {description:e.target.value})}
                                 placeholder="description"
                                 className="flex-[2] bg-transparent text-[15px] text-gray-400 outline-none" />
                          <label className="flex items-center gap-1 text-[13px] text-pink-300 cursor-pointer" title="If on, this goal is a check-off (Done/Reset) instead of a 0-5 score">
                            <input type="checkbox" checked={!!g.manual_only} onChange={(e)=>updateGoal(mi, gi, {manual_only:e.target.checked})} className="accent-pink-400"/>
                            Manual
                          </label>
                          <button onClick={()=>removeGoal(mi, gi)} className="text-red-400 hover:text-red-300 text-xs"><i className="fas fa-times"/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={()=>addGoal(mi)}
                          className="mt-2 text-[15px] text-shBlue hover:text-white font-black uppercase tracking-widest">
                    <i className="fas fa-plus mr-1"/>Add Goal
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-bgHover flex justify-between items-center gap-3 shrink-0">
          {extraError ? <p className="text-red-400 text-[14px] font-bold truncate flex-1" data-testid="program-editor-err">{extraError}</p> : <span className="flex-1"/>}
          <div className="flex gap-3 shrink-0">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[15px] tracking-widest">Cancel</button>
            <button onClick={onSave} data-testid="prog-save"
                    className="bg-shGreen text-bgHeader px-6 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow">Save Program</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div><label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">{label}</label><div className="mt-1">{children}</div></div>;
}
