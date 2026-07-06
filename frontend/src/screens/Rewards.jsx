import { useEffect, useState } from "react";
import PageHero from "../components/PageHero";
import { api } from "../lib/api";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const credits = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function Stat({ label, value, icon, color = "text-shGreen" }) {
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
      <div className={`text-xl ${color} mb-2`}><i className={`fas ${icon}`} /></div>
      <div className="text-2xl font-black text-white">{value}</div>
      <div className="text-[11px] font-black uppercase tracking-widest text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="bg-bgBase border border-bgHover rounded-xl p-4 text-sm text-gray-400">{children}</div>;
}

export default function Rewards() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const r = await api.get("/admin/rewards/center");
      setData(r.data || {});
    } catch (e) {
      setErr(e.response?.data?.detail || "Could not load rewards center");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const grantReferral = async (clientId) => {
    setBusy(`ref-${clientId}`); setErr("");
    try { await api.post(`/admin/rewards/referrals/${clientId}/grant`); await load(); }
    catch (e) { setErr(e.response?.data?.detail || "Could not grant referral credit"); }
    finally { setBusy(""); }
  };

  const redeemTrivia = async (m, awardCredits = 0) => {
    setBusy(`tri-${m.client_id}-${m.days}-${m.earned_on}`); setErr("");
    try {
      const payload = { client_id: m.client_id, days: Number(m.days), earned_on: m.earned_on };
      if (awardCredits > 0) {
        payload.award_service = "daycare";
        payload.award_credits = awardCredits;
        payload.note = `Trivia reward — ${m.days}-day streak`;
      }
      await api.post("/admin/trivia/milestones/redeem", payload);
      await load();
    } catch (e) { setErr(e.response?.data?.detail || "Could not redeem trivia reward"); }
    finally { setBusy(""); }
  };

  const downloadCredits = async () => {
    const r = await api.get("/admin/rewards/credits-audit.csv", { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([r.data], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "credits-audit.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const summary = data?.summary || {};
  return (
    <div className="space-y-6 animate-slide-in" data-testid="rewards-center-screen">
      <PageHero
        eyebrow={{ icon: "fa-gift", text: "Rewards center", color: "text-shOrange" }}
        title="Rewards."
        highlight="Referrals, trivia, credits."
        subtitle="One place to see pending referral bonuses, trivia perks, reward credit grants, and client credit balances."
        right={<button onClick={load} className="bg-shGreen text-black px-4 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest"><i className="fas fa-rotate mr-2"/>Refresh</button>}
        testid="rewards-center-hero"
      />

      {err && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl p-3 text-sm font-semibold">{err}</div>}
      {loading && <div className="text-gray-400 text-sm">Loading rewards…</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon="fa-user-plus" label="Real pending referrals" value={summary.pending_referrals || 0} color="text-shOrange" />
            <Stat icon="fa-check-circle" label="Ready to grant" value={summary.ready_referrals || 0} />
            <Stat icon="fa-question" label="Trivia perks pending" value={summary.pending_trivia || 0} color="text-shBlue" />
            <Stat icon="fa-ticket" label="Clients with credits" value={summary.clients_with_credits || 0} color="text-shGreen" />
          </div>

          <section className="bg-bgPanel border border-bgHover rounded-2xl p-4" data-testid="rewards-referrals-section">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-white font-black uppercase italic"><i className="fas fa-user-plus text-shOrange mr-2"/>Referral rewards</h3>
                <p className="text-sm text-gray-400">Garrett rule: referral reward = 1 free daycare credit. Only real referral-code matches show here. Rewards are non-cash and do not count as income.</p>
                {(summary.invalid_referral_codes_hidden || summary.self_referrals_hidden) ? (
                  <p className="text-xs text-shOrange font-bold mt-1">
                    Hidden cleanup: {summary.invalid_referral_codes_hidden || 0} old/invalid referral-code value(s) and {summary.self_referrals_hidden || 0} self-referral value(s) were ignored so fake credits are not granted.
                  </p>
                ) : null}
              </div>
            </div>
            {(data.pending_referrals || []).length === 0 ? <Empty>No real pending referrals right now. Clients only appear here after a valid referral code is attached to their profile.</Empty> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead><tr className="text-gray-500 uppercase text-[11px] tracking-widest border-b border-bgHover"><th className="text-left py-2">Status</th><th className="text-left py-2">Referrer</th><th className="text-left py-2">Referred client</th><th className="text-left py-2">Completed</th><th className="text-right py-2">Action</th></tr></thead>
                  <tbody>
                    {data.pending_referrals.map((r) => (
                      <tr key={r.referred_id} className="border-b border-bgHover/60 text-gray-300">
                        <td className="py-2"><span className={`px-2 py-1 rounded-full text-[11px] font-black uppercase ${r.status === "ready" ? "bg-shGreen/15 text-shGreen" : "bg-shOrange/15 text-shOrange"}`}>{r.status}</span></td>
                        <td className="py-2">{r.referrer_name}<div className="text-xs text-gray-500">Code {r.referral_code}</div></td>
                        <td className="py-2">{r.referred_name}<div className="text-xs text-gray-500">{r.referred_email}</div></td>
                        <td className="py-2">{r.completed_bookings || 0}</td>
                        <td className="py-2 text-right"><button disabled={!r.referrer_id || busy} onClick={()=>grantReferral(r.referred_id)} className="bg-shGreen text-black px-3 py-1.5 rounded text-[11px] font-black uppercase disabled:opacity-40">Grant daycare credit</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="bg-bgPanel border border-bgHover rounded-2xl p-4" data-testid="rewards-trivia-section">
            <h3 className="text-white font-black uppercase italic mb-1"><i className="fas fa-brain text-shBlue mr-2"/>Trivia rewards</h3>
            <p className="text-sm text-gray-400 mb-3">Pending streak rewards show here. Mark manual prizes redeemed, or grant a small daycare-credit prize when needed.</p>
            {(data.pending_trivia || []).length === 0 ? <Empty>No pending trivia perks.</Empty> : (
              <div className="grid gap-3">
                {data.pending_trivia.map((m) => (
                  <div key={`${m.client_id}-${m.days}-${m.earned_on}`} className="bg-bgBase border border-bgHover rounded-xl p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <div className="text-white font-black">{m.client_name} · {m.days}-day streak</div>
                      <div className="text-sm text-gray-400">{m.label}</div>
                      <div className="text-xs text-gray-500 mt-1">Earned {m.earned_on} · Perk type: {m.perk_type || "manual"}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busy} onClick={()=>redeemTrivia(m, 0)} className="bg-bgPanel border border-bgHover text-gray-200 px-3 py-2 rounded text-[11px] font-black uppercase">Mark redeemed</button>
                      <button disabled={busy} onClick={()=>redeemTrivia(m, 0.5)} className="bg-shGreen text-black px-3 py-2 rounded text-[11px] font-black uppercase">Redeem + 0.5 daycare credit</button>
                      <button disabled={busy} onClick={()=>redeemTrivia(m, 1)} className="bg-shOrange text-black px-3 py-2 rounded text-[11px] font-black uppercase">Redeem + 1 daycare credit</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-bgPanel border border-bgHover rounded-2xl p-4" data-testid="rewards-credit-audit-section">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-white font-black uppercase italic"><i className="fas fa-ticket text-shGreen mr-2"/>Credits audit</h3>
                <p className="text-sm text-gray-400">Outstanding service credits. Referral/trivia credits are grants, not cash income.</p>
              </div>
              <button onClick={downloadCredits} className="bg-bgBase border border-bgHover text-gray-200 px-3 py-2 rounded text-[11px] font-black uppercase"><i className="fas fa-download mr-2"/>CSV</button>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Stat icon="fa-dog" label="Daycare credits" value={credits(summary.daycare_credits_outstanding)} />
              <Stat icon="fa-bed" label="Boarding credits" value={credits(summary.boarding_credits_outstanding)} color="text-shBlue" />
              <Stat icon="fa-graduation-cap" label="Training credits" value={credits(summary.training_credits_outstanding)} color="text-shOrange" />
            </div>
            {(data.credit_audit || []).length === 0 ? <Empty>No outstanding credits.</Empty> : (
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-bgPanel"><tr className="text-gray-500 uppercase text-[11px] tracking-widest border-b border-bgHover"><th className="text-left py-2">Client</th><th className="text-right py-2">Daycare</th><th className="text-right py-2">Boarding</th><th className="text-right py-2">Training</th></tr></thead>
                  <tbody>{data.credit_audit.slice(0, 200).map((r)=><tr key={r.client_id} className="border-b border-bgHover/60 text-gray-300"><td className="py-2">{r.client_name}<div className="text-xs text-gray-500">{r.email}</div></td><td className="py-2 text-right">{credits(r.daycare)}</td><td className="py-2 text-right">{credits(r.boarding)}</td><td className="py-2 text-right">{credits(r.training)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="bg-bgPanel border border-bgHover rounded-2xl p-4" data-testid="rewards-ledger-section">
            <h3 className="text-white font-black uppercase italic mb-3"><i className="fas fa-clock-rotate-left text-shOrange mr-2"/>Recent reward credit grants</h3>
            {(data.recent_rewards || []).length === 0 ? <Empty>No reward credits logged yet.</Empty> : (
              <div className="grid gap-2">
                {data.recent_rewards.slice(0, 20).map((r)=><div key={r.id} className="bg-bgBase border border-bgHover rounded-lg p-3 text-sm text-gray-300 flex justify-between gap-3"><div><b className="text-white">{r.client_name}</b><div className="text-xs text-gray-500">{r.reason}</div></div><div className="text-right"><div className="font-black text-shGreen">+{credits(r.amount)} {r.service}</div><div className="text-xs text-gray-500">{(r.created_at || "").slice(0,10)}</div></div></div>)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
