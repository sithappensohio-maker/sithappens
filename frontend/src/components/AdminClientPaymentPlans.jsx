import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

const fmt = (n) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_META = {
  pending_signature: { label: "Awaiting signature", color: "#f59e0b", icon: "fa-pen-clip" },
  active: { label: "Active", color: "#8cc63f", icon: "fa-play" },
  completed: { label: "Paid in full", color: "#00a9e0", icon: "fa-check-circle" },
  cancelled: { label: "Cancelled", color: "#64748b", icon: "fa-ban" },
};

/**
 * Sprint 110ch — Admin "Payment Plans" widget rendered inside each client
 * expansion. Shows existing plans + lets the operator create a new one with
 * a preset cadence (weekly / biweekly / monthly / N installments).
 */
export default function AdminClientPaymentPlans({ clientId }) {
  const [plans, setPlans] = useState([]);
  const [creating, setCreating] = useState(false);

  const load = () => {
    api.get("/admin/payment-plans", { params: { client_id: clientId } })
      .then(r => setPlans(r.data || []))
      .catch(() => setPlans([]));
  };
  useEffect(() => { if (clientId) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  const markPaid = async (planId, instId, method) => {
    try {
      await api.post(`/admin/payment-plans/${planId}/installments/${instId}/mark-paid`,
                     { method });
      toast.success("Payment recorded");
      load();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Failed");
    }
  };

  const cancelPlan = async (planId) => {
    if (!window.confirm("Cancel this payment plan? Unpaid installments will be voided.")) return;
    try {
      await api.post(`/admin/payment-plans/${planId}/cancel`);
      load();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Failed");
    }
  };

  return (
    <div className="bg-bgBase/40 border border-bgHover rounded-lg p-4"
         data-testid={`admin-plans-${clientId}`}>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen">
          <i className="fas fa-file-signature mr-1.5"/>Payment Plans · {plans.length}
        </p>
        <button onClick={() => setCreating(true)}
                data-testid="create-plan-btn"
                className="text-[11px] font-black uppercase tracking-widest text-shGreen border border-shGreen/40 rounded px-3 py-1.5 hover:bg-shGreen/20">
          <i className="fas fa-plus mr-1"/>New plan
        </button>
      </div>

      {plans.length === 0 ? (
        <p className="text-gray-500 text-xs italic">No plans yet.</p>
      ) : (
        <div className="space-y-2">
          {plans.map(p => <AdminPlanRow key={p.id} plan={p} onMarkPaid={markPaid} onCancel={cancelPlan} />)}
        </div>
      )}

      {creating && (
        <CreatePlanModal
          clientId={clientId}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}
    </div>
  );
}

function AdminPlanRow({ plan, onMarkPaid, onCancel }) {
  const sm = STATUS_META[plan.status] || STATUS_META.active;
  return (
    <div className="bg-bgPanel border border-bgHover rounded p-3" data-testid={`admin-plan-row-${plan.id}`}>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-black text-white">{plan.program_name}</p>
          <p className="text-[12px] text-gray-400">
            {fmt(plan.paid_total)} of {fmt(plan.total_amount)}
            {plan.overdue_count > 0 && (
              <span className="ml-2 text-red-400 font-black uppercase text-[11px] tracking-widest">
                · {plan.overdue_count} overdue
              </span>
            )}
          </p>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded"
              style={{ color: sm.color, background: sm.color + "15", border: `1px solid ${sm.color}40` }}>
          <i className={`fas ${sm.icon} mr-1`}/>{sm.label}
        </span>
      </div>
      <div className="space-y-1">
        {plan.installments.map(i => (
          <div key={i.id} className="flex items-center justify-between text-[12px]"
               data-testid={`admin-inst-${i.id}`}>
            <span className={i.status === "paid" ? "text-gray-500 line-through" : "text-gray-300"}>
              {i.due_date} · {fmt(i.amount)}
              {i.paid_method && <span className="text-gray-500 ml-1">· {i.paid_method}</span>}
            </span>
            {i.status === "due" && plan.status === "active" && (
              <div className="flex gap-1">
                {["cash", "card", "venmo", "check"].map(m => (
                  <button key={m} onClick={() => onMarkPaid(plan.id, i.id, m)}
                          data-testid={`mark-paid-${i.id}-${m}`}
                          className="text-[10px] font-black uppercase tracking-widest text-shGreen border border-shGreen/40 rounded px-1.5 py-0.5 hover:bg-shGreen/20">
                    {m}
                  </button>
                ))}
              </div>
            )}
            {i.status === "paid" && <i className="fas fa-check-circle text-shGreen text-xs"/>}
          </div>
        ))}
      </div>
      {plan.status !== "cancelled" && plan.status !== "completed" && (
        <button onClick={() => onCancel(plan.id)}
                data-testid={`cancel-plan-${plan.id}`}
                className="mt-2 text-[10px] font-black uppercase tracking-widest text-red-400 hover:text-red-300">
          <i className="fas fa-ban mr-1"/>Cancel plan
        </button>
      )}
    </div>
  );
}

function CreatePlanModal({ clientId, onClose, onCreated }) {
  const [programName, setProgramName] = useState("");
  const [total, setTotal] = useState("");
  const [cadence, setCadence] = useState("biweekly");
  const [n, setN] = useState(4);
  const [start, setStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const installments = (() => {
    const t = Number(total) || 0;
    const count = Math.max(1, Math.min(24, Number(n) || 1));
    const each = Math.floor((t / count) * 100) / 100;
    const startDate = start ? new Date(start + "T00:00:00") : new Date();
    const stepDays = cadence === "weekly" ? 7 : cadence === "biweekly" ? 14 : 30;
    const rows = [];
    let acc = 0;
    for (let i = 0; i < count; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i * stepDays);
      const amt = i === count - 1 ? Math.round((t - acc) * 100) / 100 : each;
      acc += amt;
      rows.push({ due_date: d.toISOString().slice(0, 10), amount: amt });
    }
    return rows;
  })();

  const submit = async () => {
    if (!programName) { setError("Program name required"); return; }
    if (!total || Number(total) <= 0) { setError("Total must be > 0"); return; }
    setBusy(true);
    setError("");
    try {
      await api.post("/admin/payment-plans", {
        client_id: clientId,
        program_name: programName,
        total_amount: Number(total),
        cadence,
        installments,
        source_kind: "training_program",
      });
      toast.success("Payment plan created · client emailed for signature");
      onCreated?.();
    } catch (e) {
      setError(formatErr(e.response?.data?.detail) || "Create failed");
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-bgPanel border border-bgHover rounded-xl w-full max-w-lg shadow-2xl"
           onClick={e => e.stopPropagation()}
           data-testid="create-plan-modal">
        <div className="px-6 py-4 border-b border-bgHover flex items-baseline justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen mb-0.5">
              <i className="fas fa-plus mr-1.5"/>New payment plan
            </p>
            <h2 className="text-xl font-black text-white">Big-ticket installment plan</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <label className="block">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Program / Item Name</span>
            <input value={programName} onChange={e => setProgramName(e.target.value)}
                   data-testid="plan-name"
                   placeholder="e.g. Service Dog Foundation Program"
                   className="mt-1 w-full bg-bgInput border border-bgHover rounded px-3 py-2 text-sm text-white" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Total amount</span>
              <input type="number" min={0} step="0.01" value={total} onChange={e => setTotal(e.target.value)}
                     data-testid="plan-total"
                     placeholder="2000.00"
                     className="mt-1 w-full bg-bgInput border border-bgHover rounded px-3 py-2 text-sm text-white" />
            </label>
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400"># of installments</span>
              <input type="number" min={1} max={24} value={n} onChange={e => setN(e.target.value)}
                     data-testid="plan-count"
                     className="mt-1 w-full bg-bgInput border border-bgHover rounded px-3 py-2 text-sm text-white" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Cadence</span>
              <select value={cadence} onChange={e => setCadence(e.target.value)}
                      data-testid="plan-cadence"
                      className="mt-1 w-full bg-bgInput border border-bgHover rounded px-3 py-2 text-sm text-white">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">First payment date</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)}
                     data-testid="plan-start"
                     className="mt-1 w-full bg-bgInput border border-bgHover rounded px-3 py-2 text-sm text-white" />
            </label>
          </div>

          {installments.length > 0 && total && (
            <div className="bg-bgBase/60 border border-bgHover rounded p-2"
                 data-testid="plan-preview">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-1">
                <i className="fas fa-eye mr-1"/>Preview · {installments.length} payments
              </p>
              <div className="space-y-0.5 text-[12px] text-gray-300">
                {installments.map((i, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span>{idx + 1}. {i.due_date}</span>
                    <span className="font-black">{fmt(i.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-red-400 text-[12px] font-black uppercase tracking-widest"
               data-testid="create-plan-error">
              <i className="fas fa-circle-exclamation mr-1"/>{error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={onClose}
                    className="flex-1 text-gray-400 hover:text-white py-2 text-[12px] font-black uppercase tracking-widest">
              Cancel
            </button>
            <button onClick={submit} disabled={busy}
                    data-testid="create-plan-submit"
                    className="flex-1 bg-shGreen hover:bg-shGreen/80 text-bgDark py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
              {busy ? "Creating…" : "Create Plan & Email Client"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
