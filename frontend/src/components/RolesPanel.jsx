/* Sprint 110ex — Phase 7: Roles & permissions
   Compact panel for the Staff screen — assign one of 7 roles to each non-
   owner employee + a quick-reference matrix of what each role can do. */
import { useEffect, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
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
};

export default function RolesPanel() {
  const [employees, setEmployees] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [open, setOpen] = useState(true);
  const [showMatrix, setShowMatrix] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [m, e] = await Promise.all([
        api.get("/staff/roles"),
        api.get("/admin/employees"),
      ]);
      setMatrix(m.data);
      setEmployees(e.data || []);
    } catch (err) { /* silent — show empty state */ }
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const setRole = async (userId, newRole) => {
    try {
      await api.put(`/staff/${userId}/role`, { staff_role: newRole });
      toast.success("Role updated");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  if (loading || !matrix) return null;

  return (
    <div className="bg-bgPanel border border-bgHover rounded-2xl shadow-lg mb-6" data-testid="roles-panel">
      <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center justify-between p-5 text-left">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-1">
            <i className="fas fa-key mr-1.5"/>Phase 7 · Roles & permissions
          </p>
          <h3 className="text-lg font-black text-white uppercase italic tracking-tight">Staff Roles</h3>
          <p className="text-[13px] text-gray-400 mt-1">
            Assign a role to each staff member to control what they can see and do.
          </p>
        </div>
        <i className={`fas fa-chevron-${open?"up":"down"} text-gray-500`}/>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3">
          {employees.length === 0 ? (
            <p className="text-[13px] text-gray-500 italic">Add staff members below first, then come back here to assign roles.</p>
          ) : (
            <div className="space-y-2" data-testid="roles-employee-list">
              {employees.map(emp => (
                <div key={emp.id} className="bg-bgBase border border-bgHover rounded-lg p-3 flex items-center gap-3 flex-wrap"
                     data-testid={`role-row-${emp.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-black uppercase tracking-tight">
                      {emp.display_name || emp.name}
                      {emp.is_owner && <span className="text-[10px] font-black text-shGreen uppercase tracking-widest ml-2">Owner</span>}
                    </p>
                    <p className="text-[12px] text-gray-500 truncate">{emp.email}</p>
                  </div>
                  <select value={emp.staff_role || "read_only"}
                          onChange={(e)=>setRole(emp.id, e.target.value)}
                          disabled={emp.is_owner}
                          data-testid={`role-select-${emp.id}`}
                          className={`bg-bgPanel border border-bgHover rounded p-2 text-white text-sm font-black uppercase tracking-widest ${emp.is_owner?"opacity-50 cursor-not-allowed":""}`}>
                    {matrix.roles.filter(r => r !== "owner" || emp.is_owner).map(r => (
                      <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          <div>
            <button onClick={()=>setShowMatrix(s=>!s)} data-testid="toggle-matrix"
                    className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:text-shBlue/80">
              <i className={`fas fa-table mr-1`}/>{showMatrix ? "Hide" : "Show"} permission matrix
            </button>

            {showMatrix && (
              <div className="mt-3 overflow-x-auto" data-testid="permission-matrix">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr>
                      <th className="text-left p-2 text-gray-500 font-black uppercase tracking-widest">Permission</th>
                      {matrix.roles.map(r => (
                        <th key={r} className="p-2 text-gray-500 font-black uppercase tracking-widest text-center" title={r}>
                          {(ROLE_LABELS[r] || r).split(" / ")[0].split(" ")[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.permission_keys.map(k => (
                      <tr key={k} className="border-t border-bgHover">
                        <td className="p-2 text-gray-300">{PERM_LABELS[k] || k}</td>
                        {matrix.roles.map(r => (
                          <td key={r} className="p-2 text-center">
                            {matrix.matrix[r]?.[k]
                              ? <i className="fas fa-check text-shGreen"/>
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
        </div>
      )}
    </div>
  );
}
