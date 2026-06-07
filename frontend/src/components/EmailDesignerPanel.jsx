import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import RichTextEditor from "./RichTextEditor";

/**
 * Sprint 110by — Email Designer.
 *
 * Two cards:
 *   1. Branding — logo URL, brand colors, signature, footer text. Applies to
 *      every email Sit Happens sends.
 *   2. Templates — per-email subject + intro body + CTA text overrides, with
 *      a chips-style variable inserter and "Send Test" button.
 */
export default function EmailDesignerPanel() {
  return (
    <div className="space-y-6" data-testid="email-designer-panel">
      <BrandingCard />
      <TemplatesCard />
    </div>
  );
}

// ----------------------------- Branding -----------------------------

const DEFAULT_BRAND = {
  brand_name: "Sit Happens",
  brand_green: "#8cc63f",
  brand_blue: "#00a9e0",
  brand_dark: "#0f172a",
  logo_url: "",
  signature_html: "",
  footer_html: "Sit Happens Dog Training · Daycare · Boarding<br/>You're receiving this because of activity on your Sit Happens account.",
};

function BrandingCard() {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.get("/admin/email-settings")
      .then(r => setDraft({ ...DEFAULT_BRAND, ...r.data }))
      .catch(() => setDraft({ ...DEFAULT_BRAND }));
  }, []);

  if (!draft) return <div className="text-gray-400 text-sm">Loading branding…</div>;

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await api.put("/admin/email-settings", draft);
      setMsg("Saved");
      setTimeout(() => setMsg(""), 2200);
    } catch (e) {
      setMsg(formatErr(e.response?.data?.detail) || "Save failed");
    }
    setSaving(false);
  };

  const update = (k, v) => setDraft({ ...draft, [k]: v });

  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-5 shadow-xl" data-testid="email-branding-card">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-1">
            <i className="fas fa-brush mr-1.5"/>Global Branding
          </p>
          <h3 className="text-xl font-black text-white">Email Look & Feel</h3>
          <p className="text-xs text-gray-400 mt-1">Applied automatically to every email Sit Happens sends.</p>
        </div>
        {msg && (
          <span className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded ${msg === "Saved" ? "bg-shGreen/15 text-shGreen border border-shGreen/30" : "bg-red-500/15 text-red-400 border border-red-500/30"}`}>
            {msg === "Saved" && <i className="fas fa-check mr-1"/>}{msg}
          </span>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Brand name (appears in the header eyebrow)"
               value={draft.brand_name}
               onChange={v => update("brand_name", v)}
               testId="brand-name"/>
        <Field label="Logo URL (publicly hosted PNG — leave blank to hide)"
               value={draft.logo_url}
               onChange={v => update("logo_url", v)}
               testId="logo-url"
               placeholder="https://yoursite.com/logo.png"/>
        <ColorField label="Accent green (eyebrow + numbers)"
                    value={draft.brand_green}
                    onChange={v => update("brand_green", v)}
                    testId="brand-green"/>
        <ColorField label="Button blue (CTA buttons)"
                    value={draft.brand_blue}
                    onChange={v => update("brand_blue", v)}
                    testId="brand-blue"/>
        <ColorField label="Header dark (top banner)"
                    value={draft.brand_dark}
                    onChange={v => update("brand_dark", v)}
                    testId="brand-dark"/>
      </div>

      <div className="mt-4">
        <label className="block text-[12px] font-black text-gray-300 uppercase tracking-widest mb-2">
          Signature
        </label>
        <p className="text-[11px] text-gray-500 mb-2">Appears above the footer of every email. Type your name, contact info, anything you&apos;d normally write at the bottom of an email.</p>
        <RichTextEditor
          value={draft.signature_html}
          onChange={v => update("signature_html", v)}
          testId="signature-html"
          rows={4}
          placeholder="— Jamie · Sit Happens · (555) 555-5555"
        />
      </div>

      <div className="mt-4">
        <label className="block text-[12px] font-black text-gray-300 uppercase tracking-widest mb-2">
          Footer text
        </label>
        <p className="text-[11px] text-gray-500 mb-2">Small fine-print text at the very bottom of every email.</p>
        <RichTextEditor
          value={draft.footer_html}
          onChange={v => update("footer_html", v)}
          testId="footer-html"
          rows={3}
          placeholder="Sit Happens · Dog Training · Daycare · Boarding"
        />
      </div>

      <BrandPreview draft={draft}/>

      <div className="mt-5 flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          data-testid="save-branding"
          className="bg-shBlue hover:bg-shBlue/80 text-white px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Branding"}
        </button>
        <button
          onClick={() => setDraft({ ...DEFAULT_BRAND })}
          data-testid="reset-branding"
          className="bg-bgHover hover:bg-bgBase text-gray-300 px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest"
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

function BrandPreview({ draft }) {
  return (
    <div className="mt-5">
      <p className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-400 mb-2">Live Preview</p>
      <div className="bg-gray-100 rounded-lg p-4">
        <div className="max-w-[480px] mx-auto bg-white rounded-lg overflow-hidden shadow-lg" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
          <div style={{ background: draft.brand_dark, padding: "20px 26px" }}>
            {draft.logo_url && (
              <img src={draft.logo_url} alt="" style={{ maxHeight: 40, maxWidth: 180, marginBottom: 8, display: "block" }}/>
            )}
            <p style={{ margin: 0, color: draft.brand_green, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.25em" }}>{draft.brand_name}</p>
            <h1 style={{ margin: "4px 0 0 0", color: "#fff", fontSize: 18, fontWeight: 900 }}>Sample email subject</h1>
          </div>
          <div style={{ padding: "20px 26px", color: "#334155", fontSize: 13, lineHeight: 1.5 }}>
            <p style={{ margin: "0 0 14px 0" }}>This is a preview of how your branded emails will look to clients.</p>
            <a href="#preview" style={{ display: "inline-block", background: draft.brand_blue, color: "#fff", textDecoration: "none", padding: "10px 20px", borderRadius: 6, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 11 }}>Sample CTA</a>
            {draft.signature_html && (
              <div style={{ marginTop: 16, color: "#334155", fontSize: 13 }}
                   dangerouslySetInnerHTML={{ __html: draft.signature_html }}/>
            )}
          </div>
          <div style={{ padding: "14px 26px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", color: "#94a3b8", fontSize: 10 }}
               dangerouslySetInnerHTML={{ __html: draft.footer_html }}/>
        </div>
      </div>
    </div>
  );
}

// ----------------------------- Templates list -----------------------------

function TemplatesCard() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = () => {
    api.get("/admin/email-templates")
      .then(r => setRows(r.data))
      .catch(e => console.error(e));
  };
  useEffect(() => { load(); }, []);

  const filtered = filter === "all" ? rows : rows.filter(r => r.category === filter);

  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-5 shadow-xl" data-testid="email-templates-card">
      <div className="flex flex-wrap items-baseline justify-between mb-3 gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen mb-1">
            <i className="fas fa-envelope mr-1.5"/>Per-email customization
          </p>
          <h3 className="text-xl font-black text-white">Email Templates</h3>
          <p className="text-xs text-gray-400 mt-1">Edit the subject, intro body, and CTA for each email Sit Happens sends. Variables like <code className="bg-bgHover px-1 rounded text-shBlue">{`{{first_name}}`}</code> are replaced automatically.</p>
        </div>
        <div className="flex gap-1">
          {[
            { id: "all", label: "All" },
            { id: "client", label: "To Clients" },
            { id: "admin", label: "To You" },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              data-testid={`template-filter-${f.id}`}
              className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest ${filter === f.id ? "bg-shBlue text-white" : "bg-bgHover text-gray-400 hover:text-white"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map(t => (
          <button
            key={t.slug}
            onClick={() => setEditing(t.slug)}
            data-testid={`template-row-${t.slug}`}
            className="w-full text-left bg-bgBase hover:bg-bgHover border border-bgHover hover:border-shBlue/50 rounded-lg px-4 py-3 transition flex items-center justify-between gap-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-black text-white truncate">{t.name}</span>
                {t.is_customized && (
                  <span className="text-[9px] font-black uppercase tracking-widest bg-shGreen/15 text-shGreen border border-shGreen/30 rounded px-1.5 py-0.5">
                    Customized
                  </span>
                )}
                <span className={`text-[9px] font-black uppercase tracking-widest rounded px-1.5 py-0.5 ${t.audience === "client" ? "bg-shBlue/15 text-shBlue border border-shBlue/30" : "bg-shOrange/15 text-shOrange border border-shOrange/30"}`}>
                  {t.audience === "client" ? "To Client" : "To You"}
                </span>
              </div>
              <div className="text-xs text-gray-400 truncate">{t.description}</div>
            </div>
            <i className="fas fa-chevron-right text-gray-500"/>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-6">No templates in this category.</div>
        )}
      </div>

      {editing && (
        <TemplateEditorModal
          slug={editing}
          onClose={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ----------------------------- Template editor modal -----------------------------

function TemplateEditorModal({ slug, onClose }) {
  const [tpl, setTpl] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    api.get(`/admin/email-templates/${slug}`)
      .then(r => {
        setTpl(r.data);
        setDraft({
          subject: r.data.override?.subject ?? "",
          title: r.data.override?.title ?? "",
          intro_html: r.data.override?.intro_html ?? "",
          cta_text: r.data.override?.cta_text ?? "",
          signoff_html: r.data.override?.signoff_html ?? "",
        });
      })
      .catch(e => setMsg(formatErr(e.response?.data?.detail) || "Load failed"));
  }, [slug]);

  if (!tpl || !draft) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
        <div className="text-white text-sm">Loading…</div>
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      // Treat empty strings as "no override" — clients want to fall back to
      // the default, not literally send an empty subject.
      const payload = {};
      for (const k of ["subject", "title", "intro_html", "cta_text", "signoff_html"]) {
        if ((draft[k] ?? "").trim() !== "") payload[k] = draft[k];
        else payload[k] = "";  // explicit empty signals "use default"
      }
      await api.put(`/admin/email-templates/${slug}`, payload);
      setMsg("Saved");
      setTimeout(() => setMsg(""), 1500);
    } catch (e) {
      setMsg(formatErr(e.response?.data?.detail) || "Save failed");
    }
    setBusy(false);
  };

  const reset = async () => {
    if (!window.confirm("Reset this template back to the default text?")) return;
    setBusy(true);
    try {
      await api.post(`/admin/email-templates/${slug}/reset`);
      setDraft({ subject: "", title: "", intro_html: "", cta_text: "", signoff_html: "" });
      setMsg("Reset to default");
      setTimeout(() => setMsg(""), 1500);
    } catch (e) {
      setMsg(formatErr(e.response?.data?.detail) || "Reset failed");
    }
    setBusy(false);
  };

  const sendTest = async () => {
    setBusy(true);
    setMsg("");
    try {
      // Save first so the test uses the current draft
      await api.put(`/admin/email-templates/${slug}`, draft);
      const r = await api.post(`/admin/email-templates/${slug}/test`,
                               testTo.trim() ? { to_email: testTo.trim() } : {});
      setMsg(r.data?.ok ? `Test sent to ${r.data.sent_to}` : "Test email queued (check Resend config)");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setMsg(formatErr(e.response?.data?.detail) || "Send test failed");
    }
    setBusy(false);
  };

  const effectiveSubject = draft.subject || tpl.defaults.subject;
  const effectiveIntro = draft.intro_html || tpl.defaults.intro_html;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="bg-bgPanel border border-bgHover rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        data-testid={`template-editor-${slug}`}
      >
        <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-6 py-4 flex items-baseline justify-between z-10">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-0.5">
              <i className="fas fa-envelope mr-1.5"/>Editing template
            </p>
            <h2 className="text-xl font-black text-white">{tpl.name}</h2>
            <p className="text-xs text-gray-400 mt-1">{tpl.description}</p>
          </div>
          <button onClick={onClose} data-testid="close-template-editor"
                  className="text-gray-400 hover:text-white text-2xl leading-none">
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {msg && (
            <div className={`text-[12px] font-black uppercase tracking-widest p-2 rounded ${msg.startsWith("Saved") || msg.startsWith("Test sent") || msg.startsWith("Reset") ? "bg-shGreen/15 text-shGreen" : "bg-red-500/15 text-red-400"}`}>
              {msg}
            </div>
          )}

          <Field
            label={`Subject  ·  default: "${tpl.defaults.subject}"`}
            value={draft.subject}
            onChange={v => setDraft({ ...draft, subject: v })}
            testId="tpl-subject"
            placeholder="Leave blank to use default"
          />

          <Field
            label={`Header title  ·  default: "${tpl.defaults.title}"`}
            value={draft.title}
            onChange={v => setDraft({ ...draft, title: v })}
            testId="tpl-title"
            placeholder="Leave blank to use default"
          />

          <div>
            <label className="block text-[12px] font-black text-gray-300 uppercase tracking-widest mb-2">
              Email body
            </label>
            <p className="text-[11px] text-gray-500 mb-2">
              The main message. Use the toolbar to bold/italicize, add lists, or insert links. Click a variable chip to drop in the client&apos;s name, dog name, etc.
            </p>
            <RichTextEditor
              value={draft.intro_html}
              onChange={v => setDraft({ ...draft, intro_html: v })}
              testId="tpl-intro"
              rows={6}
              placeholder={tpl.defaults.intro_html || "Type your message…"}
              variables={tpl.variables || []}
            />
          </div>

          <Field
            label={`Button text  ·  default: "${tpl.defaults.cta_text || '(no button)'}"`}
            value={draft.cta_text}
            onChange={v => setDraft({ ...draft, cta_text: v })}
            testId="tpl-cta"
            placeholder="Leave blank to use default"
          />

          <div>
            <label className="block text-[12px] font-black text-gray-300 uppercase tracking-widest mb-2">
              Sign-off (optional)
            </label>
            <p className="text-[11px] text-gray-500 mb-2">Extra text below the data rows — like &ldquo;Need help? Reply to this email anytime.&rdquo; Leave blank to skip.</p>
            <RichTextEditor
              value={draft.signoff_html}
              onChange={v => setDraft({ ...draft, signoff_html: v })}
              testId="tpl-signoff"
              rows={3}
              placeholder="Need help? Reply to this email anytime."
            />
          </div>

          <EmailPreview tpl={tpl} subject={effectiveSubject} intro={effectiveIntro} cta={draft.cta_text || tpl.defaults.cta_text}/>

          <div className="border-t border-bgHover pt-4">
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen mb-2">
              <i className="fas fa-paper-plane mr-1.5"/>Send a test
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                value={testTo}
                onChange={e => setTestTo(e.target.value)}
                placeholder="Recipient (blank = your admin email)"
                data-testid="tpl-test-to"
                className="flex-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white"
              />
              <button
                onClick={sendTest}
                disabled={busy}
                data-testid="tpl-send-test"
                className="bg-shGreen hover:bg-shGreen/80 text-bgDark px-4 py-2 rounded font-black text-[12px] uppercase tracking-widest disabled:opacity-50"
              >
                Send Test
              </button>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-bgPanel border-t border-bgHover px-6 py-3 flex justify-between gap-2 z-10">
          <button
            onClick={reset}
            disabled={busy || !tpl.is_customized}
            data-testid="tpl-reset"
            className="bg-bgHover hover:bg-red-500/20 text-red-400 disabled:text-gray-600 disabled:hover:bg-bgHover px-4 py-2 rounded font-black text-[12px] uppercase tracking-widest"
          >
            Reset to Default
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              data-testid="tpl-cancel"
              className="bg-bgHover hover:bg-bgBase text-gray-300 px-4 py-2 rounded font-black text-[12px] uppercase tracking-widest"
            >
              Close
            </button>
            <button
              onClick={save}
              disabled={busy}
              data-testid="tpl-save"
              className="bg-shBlue hover:bg-shBlue/80 text-white px-5 py-2 rounded font-black text-[12px] uppercase tracking-widest disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailPreview({ subject, intro, cta }) {
  return (
    <div className="border border-bgHover rounded-lg overflow-hidden">
      <div className="bg-bgHover px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
        <i className="fas fa-eye mr-1.5"/>Preview
      </div>
      <div className="bg-gray-100 p-4">
        <div className="max-w-[480px] mx-auto bg-white rounded-lg overflow-hidden shadow">
          <div className="bg-bgDark px-5 py-3" style={{ background: "#0f172a" }}>
            <p className="text-[10px]" style={{ color: "#8cc63f", letterSpacing: "0.25em", textTransform: "uppercase", fontWeight: 900, margin: 0 }}>Sit Happens</p>
            <h1 style={{ color: "#fff", margin: "4px 0 0 0", fontWeight: 900, fontSize: 17 }}>{subject || "(no subject)"}</h1>
          </div>
          <div style={{ padding: "16px 20px", color: "#334155", fontSize: 13, lineHeight: 1.5 }}>
            <div dangerouslySetInnerHTML={{ __html: intro || "<em>(empty intro)</em>" }}/>
            {cta && (
              <a href="#preview" style={{ display: "inline-block", marginTop: 12, background: "#00a9e0", color: "#fff", textDecoration: "none", padding: "8px 16px", borderRadius: 4, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>{cta}</a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------- Shared inputs -----------------------------

function Field({ label, value, onChange, testId, placeholder, type = "text" }) {
  return (
    <div>
      <label className="block text-[12px] font-black text-gray-300 uppercase tracking-widest mb-1">{label}</label>
      <input
        type={type}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ""}
        data-testid={testId}
        className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white"
      />
    </div>
  );
}

function ColorField({ label, value, onChange, testId }) {
  return (
    <div>
      <label className="block text-[12px] font-black text-gray-300 uppercase tracking-widest mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={e => onChange(e.target.value)}
          data-testid={`${testId}-picker`}
          className="h-10 w-14 bg-bgBase border border-bgHover rounded cursor-pointer"
        />
        <input
          type="text"
          value={value || ""}
          onChange={e => onChange(e.target.value)}
          data-testid={testId}
          className="flex-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white font-mono uppercase"
        />
      </div>
    </div>
  );
}
