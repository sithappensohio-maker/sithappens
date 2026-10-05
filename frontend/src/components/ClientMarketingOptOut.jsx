import { useState } from "react";
import { toast } from "sonner";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";

// Why a family is off marketing email, in staff words (audit #38).
const SOURCE_LABEL = {
  unsubscribe_link: "Family unsubscribed from an email",
  portal: "Family opted out in their portal",
  staff: "Opted out by staff",
};

// Shown on the client record only when the family is off marketing email, so a family
// that gets no campaign has a visible reason. Staff clear it only when the family has
// asked for it again. Booking and account email is not affected either way.
export default function ClientMarketingOptOut({ client, canClear }) {
  // The hook lives in the child so a client who is not opted out never needs the confirm provider.
  if (!client?.marketing_email_opt_out) return null;
  return <OptOutNotice client={client} canClear={canClear} />;
}

function OptOutNotice({ client, canClear }) {
  const confirm = useConfirm();
  const [optedOut, setOptedOut] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!optedOut) return null;

  const clear = async () => {
    const ok = await confirm({
      title: "Let this family get marketing email again?",
      body: "Only do this when the family has asked for it. Booking and account emails are not affected.",
      confirmText: "Clear opt-out",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.put(`/admin/clients/${client.id}/marketing-email-preference`, { opted_out: false });
      setOptedOut(false);
      toast.success("Marketing email is on for this family again.");
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't clear the opt-out.");
    } finally {
      setBusy(false);
    }
  };

  const source = SOURCE_LABEL[client.marketing_email_opt_out_source] || "Opted out";
  const by = client.marketing_email_opt_out_source === "staff" && client.marketing_email_opt_out_by
    ? ` by ${client.marketing_email_opt_out_by}` : "";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-shAccent" data-testid="client-marketing-optout">
      <span><i className="fas fa-envelope mr-1" />Marketing email off · {source}{by}</span>
      {canClear && (
        <button onClick={clear} disabled={busy} data-testid="client-marketing-optout-clear"
                className="min-h-[36px] px-3 py-1.5 rounded bg-bgBase border border-bgHover text-gray-200 text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
          Clear opt-out
        </button>
      )}
    </div>
  );
}
