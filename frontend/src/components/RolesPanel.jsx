/* Sprint 110ex — Phase 7: Roles & permissions
   Compact panel for the Staff screen — assign one of 7 roles to each non-
   owner employee + a quick-reference matrix of what each role can do. */
import { useEffect, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";

const ROLE_LABELS = {
  owner: "Owner / Admin",
  manager: "Manager",
  trainer: "Trainer",
  daycare_staff: "Daycare Staff",
  boarding_staff: "Boarding Staff",
  front_desk: "Front Desk",
  read_only: "Read-only",
};

const PERM_LABELS = {
  settings: "Settings",
  finance_reports: "Finance",
  pricing: "Pricing",
  clients_view: "Clients · view",
  clients_edit: "Clients · edit",
  dogs_view: "Dogs · view",
  dogs_edit: "Dogs · edit",
  incidents: "Incidents",
  care_complete: "Care logging",
  booking_edit: "Booking edits",
  payroll: "Payroll",
  data_export: "Data export",
  delete_records: "Delete records",
  messages: "Client messages",
  take_payments: "Take payments",
  friends_family_bookings: "Friends & family bookings (dogs from different families, one paying)",
  view_shop_categories: "Shop org · view",
  manage_shop_categories: "Shop org · manage",
  reorder_shop_categories: "Shop org · reorder",
  delete_shop_categories: "Shop org · remove",
  manage_receipt_settings: "Receipt settings",
  audit_log: "Audit log",
  manage_communications: "Communications",
  manage_staff_scheduling: "Staff scheduling",
  manage_training_content: "Training content",
  manage_training_sessions: "Training sessions",
  assign_training_staff: "Assign training staff (who owns which dog's training)",
  manage_engagement_content: "Engagement content",
  manage_shop_media: "Shop media",
  sell_credits: "Sell prepaid visits",
  manage_events: "Run public events (check-in, walk-ins, exports)",
  edit_events: "Create and edit public events",
};

export default function RolesPanel() {
  const { isOwner } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [open, setOpen] = useState(true);
  const [showMatrix, setShowMatrix] = useState(false);
  const [loading, setLoading] = useState(true);
  const [overridesOpenFor, setOverridesOpenFor] = useState(() => new Set());

  // Security checkpoint — editing/viewing the role-permission matrix
  // (GET/PUT /staff/roles*, PUT /staff/{id}/role) is now owner-only on the
  // backend (un-delegatable, so an override can never grant a manager
  // enough rope to edit the matrix itself). Skip that fetch entirely for a
  // non-owner viewing the Staff screen rather than firing a request that
  // will just 403 — the employee list itself (payroll-gated) still loads
  // for a manager.
  const load = useCallback(async () => {
    try {
      const [m, e] = await Promise.all([
        isOwner() ? api.get("/staff/roles") : Promise.resolve(null),
        api.get("/admin/employees"),
      ]);
      if (m) setMatrix(m.data);
      setEmployees(e.data || []);
    } catch (err) { /* silent — show empty state */ }
    setLoading(false);
  }, [isOwner]);
  useEffect(() => { load(); }, [load]);

  const setRole = async (userId, newRole) => {
    try {
      await api.put(`/staff/${userId}/role`, { staff_role: newRole });
      toast.success("Role updated");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const toggleOverridesFor = (empId) => {
    setOverridesOpenFor(prev => {
      const next = new Set(prev);
      if (next.has(empId)) next.delete(empId); else next.add(empId);
      return next;
    });
  };

  const setPermissionOverride = async (emp, key, checked) => {
    const roleDefault = !!matrix.matrix[emp.staff_role || "read_only"]?.[key];
    const next = { ...(emp.permission_overrides || {}) };
    if (checked === roleDefault) delete next[key];
    else next[key] = checked;
    try {
      await api.put(`/staff/${emp.id}/permission-overrides`, { overrides: next });
      toast.success("Permission updated");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const resetOverrides = async (emp) => {
    try {
      await api.put(`/staff/${emp.id}/permission-overrides`, { overrides: {} });
      toast.success("Reset to role defaults");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  if (loading) return null;

  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl shadow-lg mb-6" data-testid="roles-panel">
      <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center justify-between p-5 text-left">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shSecondary mb-1">
            <i className="fas fa-key mr-1.5"/>Phase 7 · Roles & permissions
          </p>
          <h3 className="text-lg font-black text-shText uppercase italic tracking-tight">Staff Roles</h3>
          <p className="text-[13px] text-shTextMuted mt-1">
            Assign a role to each staff member to control what they can see and do.
          </p>
        </div>
        <i className={`fas fa-chevron-${open?"up":"down"} text-shTextMuted`}/>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3">
          {employees.length === 0 ? (
            <p className="text-[13px] text-shTextMuted italic">Add staff members below first, then come back here to assign roles.</p>
          ) : (
            <div className="space-y-2" data-testid="roles-employee-list">
              {employees.map(emp => (
                <div key={emp.id}>
                  <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-3 flex items-center gap-3 flex-wrap"
                       data-testid={`role-row-${emp.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-shText font-black uppercase tracking-tight">
                        {emp.display_name || emp.name}
                        {emp.is_owner && <span className="text-[10px] font-black text-shPrimary uppercase tracking-widest ml-2">Owner</span>}
                      </p>
                      <p className="text-[12px] text-shTextMuted truncate">{emp.email}</p>
                    </div>
                    {matrix ? (
                      <select value={emp.staff_role || "read_only"}
                              onChange={(e)=>setRole(emp.id, e.target.value)}
                              disabled={emp.is_owner}
                              data-testid={`role-select-${emp.id}`}
                              className={`bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm font-black uppercase tracking-widest ${emp.is_owner?"opacity-50 cursor-not-allowed":""}`}>
                        {matrix.roles.filter(r => r !== "owner" || emp.is_owner).map(r => (
                          <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                        ))}
                      </select>
                    ) : (
                      // Non-owner viewer — role assignment is owner-only on the
                      // backend, so show the current role read-only instead of
                      // a control that would just 403 on change.
                      <span className="text-shTextMuted text-sm font-black uppercase tracking-widest px-2" data-testid={`role-readonly-${emp.id}`}>
                        {ROLE_LABELS[emp.staff_role || "read_only"] || emp.staff_role}
                      </span>
                    )}
                    {matrix && !emp.is_owner && (
                      <button onClick={()=>toggleOverridesFor(emp.id)}
                              data-testid={`toggle-overrides-${emp.id}`}
                              className="text-[11px] font-black uppercase tracking-widest text-shSecondary hover:text-shSecondary/80 px-2">
                        {Object.keys(emp.permission_overrides || {}).length === 0
                          ? "Extra permissions"
                          : `${Object.keys(emp.permission_overrides).length} extra`}
                      </button>
                    )}
                  </div>

                  {matrix && !emp.is_owner && overridesOpenFor.has(emp.id) && (
                    <div className="bg-[var(--sh-card-base)] border border-shBorder border-t-0 rounded-b-lg p-3 -mt-1"
                         data-testid={`overrides-panel-${emp.id}`}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {matrix.permission_keys.map(key => {
                          const roleDefault = !!matrix.matrix[emp.staff_role || "read_only"]?.[key];
                          const isOverridden = Object.prototype.hasOwnProperty.call(emp.permission_overrides || {}, key);
                          const value = isOverridden ? !!emp.permission_overrides[key] : roleDefault;
                          return (
                            <label key={key} data-testid={`override-${emp.id}-${key}`}
                                   className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide">
                              <input type="checkbox" checked={value}
                                     onChange={(e)=>setPermissionOverride(emp, key, e.target.checked)} />
                              <span className={isOverridden ? "text-shPrimary" : "text-shTextMuted"}>
                                {PERM_LABELS[key] || key}
                                {isOverridden && <span className="ml-1 text-[9px] text-shSecondary">(custom)</span>}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {Object.keys(emp.permission_overrides || {}).length > 0 && (
                        <button onClick={()=>resetOverrides(emp)}
                                data-testid={`reset-overrides-${emp.id}`}
                                className="mt-3 text-[11px] font-black uppercase tracking-widest text-shSecondary hover:text-shSecondary/80">
                          Reset to role defaults
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {matrix && (
          <div>
            <button onClick={()=>setShowMatrix(s=>!s)} data-testid="toggle-matrix"
                    className="text-[12px] font-black uppercase tracking-widest text-shSecondary hover:text-shSecondary/80">
              <i className={`fas fa-table mr-1`}/>{showMatrix ? "Hide" : "Show"} permission matrix
            </button>

            {showMatrix && (
              <div className="mt-3 overflow-x-auto" data-testid="permission-matrix">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr>
                      <th className="text-left p-2 text-shTextMuted font-black uppercase tracking-widest">Permission</th>
                      {matrix.roles.map(r => (
                        <th key={r} className="p-2 text-shTextMuted font-black uppercase tracking-widest text-center" title={r}>
                          {(ROLE_LABELS[r] || r).split(" / ")[0].split(" ")[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.permission_keys.map(k => (
                      <tr key={k} className="border-t border-shBorder">
                        <td className="p-2 text-shTextMuted">{PERM_LABELS[k] || k}</td>
                        {matrix.roles.map(r => (
                          <td key={r} className="p-2 text-center">
                            {matrix.matrix[r]?.[k]
                              ? <i className="fas fa-check text-shPrimary"/>
                              : <i className="fas fa-minus text-gray-600 text-[9px]"/>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}
