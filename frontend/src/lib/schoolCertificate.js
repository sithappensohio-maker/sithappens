// Sit Happens School — branded course completion certificates.
//
// The three flagship School levels share one light certificate system with
// course-specific accents and seals. It uses existing public brand assets
// already shipped by the app, so there is no separate image/template
// deployment to keep in sync.
function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); }
  catch { return ""; }
}

function completedYear(iso) {
  if (!iso) return new Date().getFullYear();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
}

export function schoolCertificateCourseName(programName) {
  return String(programName || "School course")
    .replace(/\s+[—–-]\s+Online School\s*$/i, "")
    .trim();
}

const CERTIFICATE_TEMPLATES = [
  {
    key: "level-1", code: "L1", match: /\blevel\s*1\b|basic manners/i,
    level: "LEVEL 1", eyebrow: "FOUNDATION GRADUATE",
    accent: "#b8e300", accent2: "#087ff5", ink: "#071629",
    completionNote: "Foundation skills completed through the Sit Happens guided training path.",
  },
  {
    key: "level-2", code: "L2", match: /\blevel\s*2\b|intermediate skills/i,
    level: "LEVEL 2", eyebrow: "INTERMEDIATE GRADUATE",
    accent: "#087ff5", accent2: "#b8e300", ink: "#071629",
    completionNote: "Intermediate skills completed through the Sit Happens guided training path.",
  },
  {
    key: "level-3", code: "L3", match: /\blevel\s*3\b|advanced off[-\s]?leash/i,
    level: "LEVEL 3", eyebrow: "ADVANCED GRADUATE",
    accent: "#b8e300", accent2: "#087ff5", ink: "#071629",
    completionNote: "Advanced reliability training completed through the Sit Happens guided training path.",
    safetyNote: "Course completion recognizes training progress; it is not a legal off-leash authorization or a guarantee against environmental risk.",
  },
];

const GENERIC_TEMPLATE = {
  key: "school-course", code: "SCH", level: "SCHOOL",
  eyebrow: "SCHOOL GRADUATE", accent: "#b8e300", accent2: "#087ff5", ink: "#071629",
  completionNote: "Course completed through the Sit Happens guided training path.",
};

export function resolveSchoolCertificateTemplate(programName) {
  const name = String(programName || "");
  return CERTIFICATE_TEMPLATES.find((t) => t.match.test(name)) || GENERIC_TEMPLATE;
}

export function schoolCertificateNumber({ schoolEnrollmentId, programName, completionSummary }) {
  const template = resolveSchoolCertificateTemplate(programName);
  const year = completedYear(completionSummary?.completed_at);
  const raw = String(schoolEnrollmentId || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const tail = raw.slice(-8) || "COMPLETE";
  return `SH-${template.code}-${year}-${tail}`;
}

export function printSchoolCertificate({
  clientName,
  dogName,
  programName,
  completionSummary,
  schoolEnrollmentId,
}) {
  const template = resolveSchoolCertificateTemplate(programName);
  const courseName = schoolCertificateCourseName(programName);
  const completed = fmtDate(completionSummary?.completed_at) || new Date().toLocaleDateString();
  const certificateNo = schoolCertificateNumber({ schoolEnrollmentId, programName, completionSummary });
  const client = String(clientName || "").trim();
  const dog = String(dogName || "").trim();
  const graduate = client && dog ? `${client} & ${dog}` : (dog || client || "Student & Dog");
  const finalAssessment = completionSummary?.final_assessment || null;
  const trainerName = String(finalAssessment?.trainer_name || "").trim() || "Sit Happens Trainer";
  const checkpoints = Number(completionSummary?.checkpoints_passed || 0);
  const lessons = completionSummary?.total_lessons;
  const modules = completionSummary?.total_modules;

  const html = `<!doctype html><html><head>
    <meta charset="utf-8" />
    <title>${escHtml(courseName)} · ${escHtml(graduate)}</title>
    <style>
      :root {
        --lime:${template.accent};
        --blue:${template.accent2};
        --ink:${template.ink};
        --paper:#f8f6ef;
        --muted:#4e5968;
      }
      * { box-sizing:border-box; }
      @page { size: landscape; margin:0.18in; }
      html,body { margin:0; padding:0; background:#e8ecef; color:var(--ink); }
      body { font-family:Arial,Helvetica,sans-serif; padding:14px; }
      .certificate {
        position:relative;
        width:min(1180px,100%);
        min-height:760px;
        margin:0 auto;
        overflow:hidden;
        background:
          radial-gradient(circle at 28% 18%, rgba(255,255,255,.95), rgba(255,255,255,0) 38%),
          repeating-linear-gradient(0deg, rgba(7,22,41,.018) 0 1px, transparent 1px 4px),
          var(--paper);
        border:3px solid var(--ink);
        box-shadow:0 22px 65px rgba(7,22,41,.20);
      }
      .certificate:before {
        content:"";
        position:absolute; inset:10px;
        border:1px solid rgba(8,127,245,.78);
        pointer-events:none;
      }
      .brush {
        position:absolute; pointer-events:none; opacity:.96;
        transform:skewX(-14deg) rotate(-2deg);
        filter:saturate(1.1);
      }
      .brush.one { left:-42px; top:-15px; width:420px; height:70px; background:linear-gradient(90deg,var(--lime),transparent); clip-path:polygon(0 18%,92% 0,77% 32%,100% 44%,72% 57%,90% 78%,0 100%); }
      .brush.two { right:-20px; bottom:-12px; width:430px; height:145px; background:linear-gradient(135deg,transparent 5%,var(--blue) 30%,var(--lime) 74%,transparent 96%); clip-path:polygon(10% 56%,100% 0,87% 24%,100% 31%,78% 47%,97% 54%,63% 68%,90% 75%,0 100%); }
      .brush.three { left:32%; top:155px; width:360px; height:31px; background:var(--lime); clip-path:polygon(4% 28%,100% 3%,91% 47%,100% 71%,2% 93%,11% 60%,0 48%); opacity:.92; }
      .husky {
        position:absolute; left:-18px; bottom:42px; width:310px;
        opacity:.12; filter:grayscale(1) contrast(1.15); pointer-events:none;
      }
      .pawmark {
        position:absolute; right:86px; top:132px; font-size:112px;
        opacity:.07; transform:rotate(18deg); font-weight:900; color:var(--ink);
      }
      .content { position:relative; z-index:2; min-height:754px; padding:35px 58px 28px; text-align:center; }
      .brand-logo { width:275px; height:auto; display:block; margin:0 auto; }
      .eyebrow {
        display:inline-block; position:relative; margin-top:13px;
        padding:7px 56px 6px; font:900 17px/1 "Arial Narrow",Arial,sans-serif;
        letter-spacing:.18em; color:var(--ink); text-transform:uppercase;
      }
      .eyebrow:before {
        content:""; position:absolute; z-index:-1; inset:1px -15px;
        background:var(--lime); transform:skewX(-12deg); clip-path:polygon(4% 13%,100% 0,94% 44%,100% 58%,7% 100%,0 64%);
      }
      .stars { margin:14px 0 8px; color:var(--blue); font-size:20px; letter-spacing:12px; }
      h1 {
        margin:2px auto 0; max-width:1020px;
        font-family:Impact,"Arial Narrow",Arial,sans-serif;
        font-size:62px; line-height:.98; letter-spacing:.018em; text-transform:uppercase;
        color:var(--ink);
      }
      .certifies { margin:20px 0 2px; font-size:19px; color:var(--ink); }
      .graduate {
        display:inline-block; max-width:900px; margin:4px auto 0; padding:0 26px 8px;
        font-family:"Brush Script MT","Segoe Script","Snell Roundhand",cursive;
        font-size:64px; line-height:1; color:var(--ink);
        border-bottom:4px solid var(--lime);
      }
      .completed-copy { margin:11px 0 5px; font-size:18px; color:var(--ink); }
      .course {
        margin:0 auto; max-width:900px;
        font-family:"Arial Narrow",Arial,sans-serif; font-size:34px; font-weight:1000; font-style:italic;
        color:var(--ink);
      }
      .course .levelword { color:var(--lime); }
      .course-note { margin:9px auto 0; max-width:770px; font-size:14px; font-style:italic; color:var(--muted); }
      .stats {
        display:flex; justify-content:center; gap:25px; flex-wrap:wrap; margin:24px auto 0;
      }
      .stat {
        min-width:188px; min-height:64px; display:flex; align-items:center; gap:12px;
        padding:8px 14px 8px 8px; border:2px solid var(--lime); border-radius:10px;
        background:rgba(255,255,255,.72); box-shadow:0 3px 0 rgba(7,22,41,.05);
      }
      .stat:nth-child(2) { border-color:var(--blue); }
      .stat-icon {
        width:46px; height:46px; display:grid; place-items:center; border-radius:50%;
        color:white; background:var(--lime); font-size:23px; font-weight:900;
      }
      .stat:nth-child(2) .stat-icon { background:var(--blue); }
      .stat-value { text-align:left; font-size:24px; line-height:1; font-weight:1000; color:var(--ink); }
      .stat-label { display:block; margin-top:3px; font-size:11px; line-height:1.1; color:var(--ink); font-style:italic; font-weight:800; }
      .seal {
        position:absolute; right:42px; bottom:84px;
        width:168px; height:168px; border-radius:50%; display:grid; place-items:center;
        background:var(--ink); color:white; border:8px solid white;
        box-shadow:0 0 0 4px var(--ink),0 0 0 7px var(--blue);
      }
      .seal:before { content:""; position:absolute; inset:11px; border:2px solid var(--lime); border-radius:50%; }
      .seal-inner { position:relative; z-index:2; font-weight:1000; line-height:1; }
      .seal-small { display:block; font-size:22px; letter-spacing:.06em; }
      .seal-num { display:block; margin-top:4px; font-size:68px; color:var(--lime); }
      .footer {
        display:grid; grid-template-columns:1fr 1.35fr 1fr; gap:30px; align-items:end;
        margin:42px 190px 0 100px; padding-top:11px;
      }
      .foot-label { display:block; padding-top:6px; border-top:2px solid var(--blue); font-size:11px; color:var(--muted); }
      .foot-value { display:block; margin-top:5px; font-size:14px; font-weight:1000; color:var(--ink); }
      .signature-name {
        display:block; font-family:"Brush Script MT","Segoe Script","Snell Roundhand",cursive;
        font-size:30px; line-height:1; padding-bottom:5px; border-bottom:2px solid var(--blue);
      }
      .signature-label { display:block; margin-top:5px; font-size:10px; color:var(--muted); }
      .safety { margin:13px auto 0; max-width:690px; font-size:9.5px; line-height:1.35; color:#485464; font-style:italic; }
      .tiny-paw { position:absolute; left:50%; bottom:11px; transform:translateX(-50%); color:var(--lime); font-size:25px; }
      @media print {
        html,body { background:#fff; }
        body { padding:0; }
        .certificate { width:100%; min-height:0; box-shadow:none; }
        .content { min-height:7.05in; }
      }
    </style></head><body>
    <main class="certificate" data-certificate-template="${escHtml(template.key)}">
      <div class="brush one"></div><div class="brush two"></div><div class="brush three"></div>
      <img class="husky" src="/brand/husky-placeholder-black-white.png" alt="" />
      <div class="pawmark">🐾</div>
      <div class="content">
        <img class="brand-logo" src="/logo.png" alt="Sit Happens Dog Training" />
        <div class="eyebrow">${escHtml(template.eyebrow)}</div>
        <div class="stars">★ ★ ★</div>
        <h1>Certificate of Completion</h1>
        <p class="certifies">This certifies that</p>
        <div class="graduate">${escHtml(graduate)}</div>
        <p class="completed-copy">successfully completed</p>
        <div class="course">${escHtml(courseName).replace(/^Level\s+(\d+):/i, '<span class="levelword">Level $1:</span>')}</div>
        <p class="course-note">${escHtml(template.completionNote)}</p>

        <div class="stats">
          ${lessons != null ? `<div class="stat"><div class="stat-icon">▤</div><div class="stat-value">${escHtml(lessons)}<span class="stat-label">Guided Lessons</span></div></div>` : ""}
          ${modules != null ? `<div class="stat"><div class="stat-icon">▱</div><div class="stat-value">${escHtml(modules)}<span class="stat-label">Modules</span></div></div>` : ""}
          ${checkpoints > 0 ? `<div class="stat"><div class="stat-icon">✓</div><div class="stat-value">${escHtml(checkpoints)}<span class="stat-label">Trainer Checkpoints Passed</span></div></div>` : ""}
        </div>

        <div class="seal"><div class="seal-inner"><span class="seal-small">${escHtml(template.level)}</span><span class="seal-num">${escHtml(template.code.replace(/\D/g,"") || "✓")}</span></div></div>

        <div class="footer">
          <div><span class="foot-label">Completed</span><span class="foot-value">${escHtml(completed)}</span></div>
          <div><span class="signature-name">${escHtml(trainerName)}</span><span class="signature-label">Sit Happens Trainer</span></div>
          <div><span class="foot-label">Certificate No.</span><span class="foot-value">${escHtml(certificateNo)}</span></div>
        </div>
        ${template.safetyNote ? `<p class="safety">${escHtml(template.safetyNote)}</p>` : ""}
        <div class="tiny-paw">🐾</div>
      </div>
    </main>
    <script>window.onload=()=>setTimeout(()=>window.print(),200);</script>
    </body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    URL.revokeObjectURL(url);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
