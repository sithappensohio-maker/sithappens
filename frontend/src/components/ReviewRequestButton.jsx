/* Sprint 110ez — Phase 9: Review request button
   Drop-in button for client/dog cards. Opens a modal that shows the saved
   Google/Facebook links, lets you copy the message template, and logs that
   you asked for a review. */
import { useEffect, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

const METHOD_META = {
  google:    { label: "Google",   icon: "fa-google",   cls: "bg-shGreen/15 text-shGreen border-shGreen/40" },
  facebook:  { label: "Facebook", icon: "fa-facebook", cls: "bg-shBlue/15 text-shBlue border-shBlue/40" },
  text:      { label: "Text",     icon: "fa-message",  cls: "bg-purple-500/15 text-purple-300 border-purple-400/40" },
  email:     { label: "Email",    icon: "fa-envelope", cls: "bg-shBlue/15 text-shBlue border-shBlue/40" },
  in_person: { label: "In-person",icon: "fa-handshake",cls: "bg-shOrange/15 text-shOrange border-shOrange/40" },
  other:     { label: "Other",    icon: "fa-ellipsis", cls: "bg-bgHover text-gray-300 border-bgHover" },
};

export default function ReviewRequestButton({ clientId, dogId = null, clientName = "", dogName = "", source = "manual", compact = false }) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState(null);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([
        api.get("/settings/review-links"),
        api.get(`/review-requests?client_id=${clientId}`),
      ]);
      setLinks(l.data);
      setCount((r.data.entries || []).length);
    } catch { /* silent */ }
  }, [clientId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [clientId]);

  const fillMessage = (tpl) => {
    if (!tpl) return "";
    const first = (clientName || "").trim().split(" ")[0] || "there";
    return tpl.replace(/\{first_name\}/g, first).replace(/\{dog_name\}/g, dogName || "your pup");
  };

  const logRequest = async (method) => {
    try {
      await api.post("/review-requests", {
        client_id: clientId, dog_id: dogId || null,
        method, source, notes: "",
      });
      toast.success(`Logged · ${METHOD_META[method]?.label || method}`);
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const openMethod = async (method, url) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    await logRequest(method);
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(fillMessage(links?.default_message));
      toast.success("Message copied — paste it into your text/email");
    } catch { toast.error("Couldn't copy — try selecting manually"); }
  };

  return (
    <>
      <button onClick={()=>setOpen(true)} data-testid={`review-btn-${clientId}`}
              className={compact
                ? "text-[12px] font-black uppercase tracking-widest text-shOrange hover:text-shOrange/80"
                : "text-[12px] font-black uppercase tracking-widest bg-shOrange/15 text-shOrange border border-shOrange/40 px-3 py-1.5 rounded hover:bg-shOrange/25"}>
        <i className="fas fa-star mr-1"/>Request review{count > 0 ? ` · ${count}` : ""}
      </button>

      {open && links && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 shadow-2xl animate-slide-in"
               data-testid={`review-modal-${clientId}`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Request a review</h4>
                <p className="text-[13px] text-gray-400">{clientName}{dogName ? ` · ${dogName}` : ""}</p>
              </div>
              <button onClick={()=>setOpen(false)} className="text-gray-500 hover:text-white"><i className="fas fa-times"/></button>
            </div>

            <p className="text-[12px] text-gray-500 mb-3">
              <i className="fas fa-circle-info mr-1"/>Click a method to open the review page (if linked) and log that you asked. The communication log gets a matching entry automatically.
            </p>

            <div className="space-y-2">
              {/* Google */}
              <button onClick={()=>openMethod("google", links.google_url)} data-testid="review-google"
                      disabled={!links.google_url}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded border ${METHOD_META.google.cls} ${!links.google_url ? "opacity-40 cursor-not-allowed" : "hover:brightness-110"}`}>
                <span className="font-black uppercase tracking-widest text-sm"><i className="fab fa-google mr-2"/>Open Google review</span>
                <i className="fas fa-arrow-up-right-from-square text-xs"/>
              </button>
              {/* Facebook */}
              <button onClick={()=>openMethod("facebook", links.facebook_url)} data-testid="review-facebook"
                      disabled={!links.facebook_url}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded border ${METHOD_META.facebook.cls} ${!links.facebook_url ? "opacity-40 cursor-not-allowed" : "hover:brightness-110"}`}>
                <span className="font-black uppercase tracking-widest text-sm"><i className="fab fa-facebook mr-2"/>Open Facebook reviews</span>
                <i className="fas fa-arrow-up-right-from-square text-xs"/>
              </button>
              {(!links.google_url && !links.facebook_url) && (
                <p className="text-[12px] text-shOrange italic">
                  <i className="fas fa-triangle-exclamation mr-1"/>No review links saved yet — drop them into <strong>Settings → Review Links</strong>.
                </p>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-bgHover">
              <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-2">Or log a non-link request</p>
              <div className="grid grid-cols-4 gap-1.5">
                {["text", "email", "in_person", "other"].map(m => (
                  <button key={m} onClick={()=>logRequest(m)} data-testid={`review-method-${m}`}
                          className={`text-[10px] font-black uppercase tracking-widest px-2 py-2 rounded border ${METHOD_META[m].cls} hover:brightness-110`}>
                    <i className={`fas ${METHOD_META[m].icon} mr-1`}/>{METHOD_META[m].label}
                  </button>
                ))}
              </div>
            </div>

            {links.default_message && (
              <div className="mt-4 pt-3 border-t border-bgHover">
                <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-1">Default message</p>
                <pre className="text-[12px] text-gray-300 bg-bgBase border border-bgHover rounded p-2 whitespace-pre-wrap font-sans">{fillMessage(links.default_message)}</pre>
                <button onClick={copyMessage} data-testid="review-copy"
                        className="mt-2 text-[11px] font-black uppercase tracking-widest text-shBlue hover:text-shBlue/80">
                  <i className="fas fa-copy mr-1"/>Copy message
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
