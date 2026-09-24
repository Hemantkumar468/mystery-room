import { useEffect, useMemo } from 'react';
import { useUsers } from '../app/api/usersApi.js';
import { toEmployee, setEmployeeDirectory } from '../lib/employees.js';

/**
 * The people work can be assigned to — the registered accounts from the
 * Employees section, not a hardcoded roster.
 *
 * Use this anywhere a person is listed or picked. An `id` it returns is a real
 * User `_id`, so storing one against a task means `Task.assignee` can be set
 * and the work shows up in that person's My Tasks. See lib/employees.js for why
 * that was not true before.
 *
 * Deactivated accounts are excluded: someone who can no longer sign in must not
 * be offered as an assignee. They stay resolvable for display through
 * `getEmployeeById`, so work already assigned to them still shows their name
 * rather than a bare id.
 *
 * @returns {{
 *   employees: Array, byDept: Record<string, Array>, isLoading: boolean,
 *   forDepartment: (dept: string) => Array,
 * }}
 */
export function useEmployees() {
  const { data: users, isLoading } = useUsers();

  // Everyone, including deactivated — this is what primes the display cache,
  // so a task assigned to someone since deactivated still renders their name.
  const all = useMemo(() => (users || []).map(toEmployee), [users]);
  const employees = useMemo(() => all.filter((e) => e.isAvailable), [all]);

  useEffect(() => { setEmployeeDirectory(all); }, [all]);

  const byDept = useMemo(() => employees.reduce((acc, e) => {
    if (!e.department) return acc;
    (acc[e.department] ||= []).push(e);
    return acc;
  }, {}), [employees]);

  /**
   * The pick list for a department: its own people first, then everyone else.
   *
   * Deliberately not filtered to the department. The old roster invented three
   * people for each of eight departments so a department-only list was always
   * populated; a real company has departments with nobody registered in them
   * yet, and filtering would leave those dropdowns empty with no way to assign
   * anyone. Ordering answers "who normally does this" without making the rest
   * unreachable.
   */
  const forDepartment = useMemo(() => (dept) => {
    if (!dept) return employees;
    const mine = byDept[dept] || [];
    return [...mine, ...employees.filter((e) => e.department !== dept)];
  }, [employees, byDept]);

  /**
   * Resolve a stored assignee to a person — by User id, or by the retired
   * roster id a template saved before real accounts were adopted.
   *
   * Components should use this rather than the module-level `getEmployeeById`:
   * the cache that backs it is filled by an effect, so a render-time read can
   * run before it is populated and there is nothing to re-render it when it is.
   * This is derived from the query result, so it is correct on first paint and
   * updates when the directory does.
   */
  const resolve = useMemo(() => {
    const byId = new Map();
    for (const e of all) {
      byId.set(e.id, e);
      if (e.employeeId) byId.set(e.employeeId, e);
    }
    return (id) => (id ? byId.get(String(id)) || null : null);
  }, [all]);

  return { employees, byDept, forDepartment, resolve, isLoading };
}

export default useEmployees;
