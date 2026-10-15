# Acknowledgment Audience Model

Procedure Hub uses explicit acknowledgment audiences to ensure compliance is calculated only for team members who are required to acknowledge a procedure.

---

## 1. Acknowledgment Audiences

### Staff Only (`staff`) — Default for New Procedures
Frontline operational procedures generally apply to staff members responsible for carrying out daily tasks.

* **Target Audience**: When a procedure uses the `staff` audience, only active staff members (`role = 'staff'`) within its applicable departmental scope are required to acknowledge it.
* **Exclusions**: Owners, administrators, and managers are strictly excluded from that procedure's compliance denominator.
* **Default Application**: All newly created procedures default to `staff` across the database schema, RPC interface, server input validation, and user interface.

### All Active Members (`all_active_members`) — Organization-Wide Policies & Backfill
Company-wide policies, such as the Code of Conduct, Information Security Policy, or Employee Handbook, use the `all_active_members` audience.

* **Target Audience**: This audience includes all eligible active members across the following roles:
  * `owner`
  * `admin`
  * `manager`
  * `staff`
* **Historical Backfill**: All procedures created prior to migration `20261015000001_acknowledgment_audience.sql` were explicitly backfilled to `all_active_members`. This ensured zero existing acknowledgment obligations from managers or administrators were dropped when explicit audience filtering was introduced.

---

## 2. Role Eligibility & Viewer Exclusion

* **Eligible Roles**: Only active members with roles `'owner'`, `'admin'`, `'manager'`, or `'staff'` can be obligated or submit acknowledgments.
* **Viewer Exclusion**: The `viewer` role (and any inactive/suspended statuses) is intentionally and strictly excluded across all layers:
  1. **Database View (`procedure_member_compliance`)**: Filters with `m.role IN ('owner', 'admin', 'manager', 'staff')`, ensuring viewers never enter the compliance denominator.
  2. **Acknowledgment Submission (`acknowledgeProcedureCore`)**: Server-side authorization enforces `verifyOrgRole(client, orgId, ['owner', 'admin', 'manager', 'staff'], userId)`, rejecting viewer submissions with a 403 Forbidden error.
  3. **Compliance Reporting**: Aggregates, tables, and individual member rosters derive solely from the authoritative view, ensuring viewers do not appear in compliance metrics.

---

## 3. Departmental Scope Mechanics

Acknowledgment obligations are evaluated as the conjunction of **Audience** and **Departmental Scope**:

$$\text{Obligation} = (\text{Role} \in \text{Audience}) \land (\text{Member Department} \in \text{Procedure Scope})$$

### Department-Scoped Procedures (`department_id IS NOT NULL`)
* When a procedure is assigned to a specific department (e.g., Department A), only active members assigned to Department A are required to acknowledge it, subject to the procedure's audience.
* Members assigned to other departments (Department B) or unassigned members (`department_id IS NULL`) evaluate to `FALSE` under `p.department_id = m.department_id` and are excluded from the denominator.
* **Example**: A department-scoped procedure with `staff` audience requires *only* frontline staff assigned to that department.

### Global Organization Procedures (`department_id IS NULL`)
* When a procedure has no department assigned (`department_id IS NULL`), it applies across the organization.
* The SQL condition `(p.department_id IS NULL OR p.department_id = m.department_id)` evaluates to `TRUE` for all members across all departments.
* **Global `staff`**: Applies to all active frontline staff across every department in the organization.
* **Global `all_active_members`**: Applies to all active owners, admins, managers, and staff across every department.

---

## 4. Compliance Calculation & Version Integrity

A member's obligation is determined by:
1. `procedure.status = 'active'`
2. `procedure.acknowledgment_required = TRUE`
3. `procedure.current_version_id IS NOT NULL`
4. `member.status = 'active'`
5. Role eligibility and audience match
6. Departmental scope match

### Version Integrity Rules
* **Current Version Acknowledgment**: Only an acknowledgment against `procedure.current_version_id` satisfies the obligation (`ACKNOWLEDGED`).
* **Superseded / Re-Ack Required**: If a member previously acknowledged an older version of the procedure, but has not acknowledged the current version, their status is explicitly `REQUIRES_REACK`.
* **Revoked Acknowledgments**: Any acknowledgment where `revoked_at IS NOT NULL` is disregarded and cannot satisfy compliance.
* **Timestamp Precedence**: The reported acknowledgment timestamp strictly prioritizes the current version's acknowledgment timestamp over historical records.
