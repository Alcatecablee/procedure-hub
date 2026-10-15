-- Migration: 20261015000001_acknowledgment_audience.sql
-- Description: Explicit acknowledgment_audience ('staff' vs 'all_active_members')
-- Authoritative compliance view filtering, backward-compatible backfill, and clean RPC overloads.

-- ─── 1. CREATE ENUM TYPE ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.acknowledgment_audience AS ENUM ('staff', 'all_active_members');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ─── 2. ADD COLUMNS & APPLY BACKFILL ───────────────────────────────────────
ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS acknowledgment_audience public.acknowledgment_audience NOT NULL DEFAULT 'staff';

ALTER TABLE public.procedure_versions
  ADD COLUMN IF NOT EXISTS acknowledgment_audience public.acknowledgment_audience NOT NULL DEFAULT 'staff';

-- BACKFILL POLICY (CTO Mandate):
-- 1. All existing procedures in the database are explicitly backfilled to 'all_active_members'.
--    This preserves exact historical compliance behavior (which previously evaluated all active
--    roles within scope) and ensures no existing obligations are silently dropped.
-- 2. All existing procedure version snapshots are likewise backfilled to 'all_active_members'
--    for snapshot consistency with their parent procedures.
-- 3. New procedures created going forward will default to 'staff' (frontline operational default).
-- 4. An inventory view (procedure_audience_review_inventory) is provided below to identify all
--    active procedures that require operational audience review.
UPDATE public.procedures
SET acknowledgment_audience = 'all_active_members'
WHERE acknowledgment_audience = 'staff';

UPDATE public.procedure_versions
SET acknowledgment_audience = 'all_active_members'
WHERE acknowledgment_audience = 'staff';

-- ─── 3. CLEAN UP HISTORICAL RPC OVERLOADS ──────────────────────────────────
-- PostgreSQL treats different parameter counts/types as distinct function overloads.
-- To avoid ambiguous function calls or silently routing to obsolete functions,
-- explicitly drop all previous signatures across past migrations.

DROP FUNCTION IF EXISTS public.atomic_create_procedure(uuid, text, text, text, procedure_priority, uuid, date, date, boolean, boolean);
DROP FUNCTION IF EXISTS public.atomic_create_procedure(uuid, text, text, text, procedure_priority, uuid, date, date, boolean, boolean, text);
DROP FUNCTION IF EXISTS public.atomic_create_procedure(uuid, text, text, text, procedure_priority, uuid, date, date, boolean, boolean, uuid);
DROP FUNCTION IF EXISTS public.atomic_create_procedure(uuid, text, text, text, procedure_priority, uuid, date, date, boolean, boolean, uuid, acknowledgment_audience);

DROP FUNCTION IF EXISTS public.atomic_update_procedure(uuid, uuid, text, text, text, procedure_priority, uuid, date, date, boolean, integer, boolean);
DROP FUNCTION IF EXISTS public.atomic_update_procedure(uuid, uuid, text, text, text, procedure_priority, uuid, date, date, boolean, integer, boolean, text);
DROP FUNCTION IF EXISTS public.atomic_update_procedure(uuid, uuid, text, text, text, procedure_priority, uuid, date, date, boolean, integer, boolean, uuid);
DROP FUNCTION IF EXISTS public.atomic_update_procedure(uuid, uuid, text, text, text, procedure_priority, uuid, date, date, boolean, integer, boolean, uuid, acknowledgment_audience);

-- ─── 4. RECREATE atomic_create_procedure ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_create_procedure(
  _org_id UUID,
  _title TEXT,
  _summary TEXT,
  _description TEXT,
  _priority procedure_priority,
  _category_id UUID,
  _effective_date DATE,
  _expiry_date DATE,
  _ack_required BOOLEAN,
  _publish BOOLEAN,
  _department_id UUID DEFAULT NULL,
  _ack_audience acknowledgment_audience DEFAULT 'staff'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _proc_id UUID := gen_random_uuid();
  _ver_id UUID := gen_random_uuid();
  _status procedure_status := 'draft';
  _version_num INTEGER := 0;
  _user_id UUID := auth.uid();
  _actual_dept_id UUID;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  IF NOT has_org_role(_org_id, 'owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Unauthorized: Insufficient role in organization';
  END IF;

  SELECT department_id INTO _actual_dept_id FROM organization_members WHERE user_id = _user_id AND organization_id = _org_id AND status = 'active' LIMIT 1;

  IF has_org_role(_org_id, 'manager') AND NOT has_org_role(_org_id, 'owner', 'admin') THEN
    _department_id := _actual_dept_id; 
    IF _department_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: Manager must be assigned to a department to create procedures';
    END IF;
  END IF;

  IF char_length(_title) < 1 OR char_length(_title) > 250 THEN RAISE EXCEPTION 'Invalid title length'; END IF;

  IF _publish THEN
    _status := 'active';
    _version_num := 1;
  END IF;

  INSERT INTO procedures (
    id, organization_id, title, summary, description, priority, category_id,
    effective_date, expiry_date, acknowledgment_required, acknowledgment_audience, status,
    version_number, created_by, updated_by, department_id
  ) VALUES (
    _proc_id, _org_id, _title, _summary, _description, _priority, _category_id,
    _effective_date, _expiry_date, _ack_required, COALESCE(_ack_audience, 'staff'), _status,
    _version_num, _user_id, _user_id, _department_id
  );

  INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_org_id, _user_id, 'procedure_created', 'procedure', _proc_id, jsonb_build_object('title', _title));

  IF _publish THEN
    INSERT INTO procedure_versions (
      id, procedure_id, organization_id, version_number, title, summary,
      description, priority, category_id, effective_date, expiry_date,
      acknowledgment_required, acknowledgment_audience, published_by, department_id
    ) VALUES (
      _ver_id, _proc_id, _org_id, 1, _title, _summary,
      _description, _priority, _category_id, _effective_date, _expiry_date,
      _ack_required, COALESCE(_ack_audience, 'staff'), _user_id, _department_id
    );

    UPDATE procedures SET current_version_id = _ver_id, published_at = now() WHERE id = _proc_id;
  END IF;

  RETURN _proc_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.atomic_create_procedure(uuid, text, text, text, procedure_priority, uuid, date, date, boolean, boolean, uuid, acknowledgment_audience) TO authenticated, service_role;

-- ─── 5. RECREATE atomic_update_procedure ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_update_procedure(
  _proc_id UUID,
  _org_id UUID,
  _title TEXT,
  _summary TEXT,
  _description TEXT,
  _priority procedure_priority,
  _category_id UUID,
  _effective_date DATE,
  _expiry_date DATE,
  _ack_required BOOLEAN,
  _expected_version INTEGER,
  _publish BOOLEAN,
  _department_id UUID DEFAULT NULL,
  _ack_audience acknowledgment_audience DEFAULT 'staff'
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _current RECORD;
  _has_changes BOOLEAN := false;
  _ver_id UUID := gen_random_uuid();
  _user_id UUID := auth.uid();
  _actual_dept_id UUID;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_org_role(_org_id, 'owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Unauthorized: Insufficient role in organization';
  END IF;

  SELECT department_id INTO _actual_dept_id FROM organization_members WHERE user_id = _user_id AND organization_id = _org_id AND status = 'active' LIMIT 1;

  SELECT * INTO _current FROM procedures WHERE id = _proc_id AND organization_id = _org_id FOR UPDATE;
  
  IF NOT FOUND THEN RAISE EXCEPTION 'Procedure not found'; END IF;
  IF _current.status IN ('archived', 'replaced') THEN RAISE EXCEPTION 'Cannot update archived or replaced procedure'; END IF;
  IF _current.version_number <> _expected_version THEN RAISE EXCEPTION 'Conflict: Procedure was modified by someone else.'; END IF;

  IF has_org_role(_org_id, 'manager') AND NOT has_org_role(_org_id, 'owner', 'admin') THEN
    _department_id := _actual_dept_id; 
    IF _department_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: Manager must be assigned to a department to update procedures';
    END IF;
    IF _current.department_id IS DISTINCT FROM _actual_dept_id THEN
      RAISE EXCEPTION 'Unauthorized: Manager cannot update procedures outside their department';
    END IF;
  END IF;

  _has_changes := (
    COALESCE(_current.title, '') <> COALESCE(_title, '') OR
    COALESCE(_current.summary, '') <> COALESCE(_summary, '') OR
    COALESCE(_current.description, '') <> COALESCE(_description, '') OR
    COALESCE(_current.priority::text, '') <> COALESCE(_priority::text, '') OR
    COALESCE(_current.category_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(_category_id, '00000000-0000-0000-0000-000000000000'::uuid) OR
    COALESCE(_current.effective_date, '1970-01-01'::date) <> COALESCE(_effective_date, '1970-01-01'::date) OR
    COALESCE(_current.expiry_date, '1970-01-01'::date) <> COALESCE(_expiry_date, '1970-01-01'::date) OR
    _current.acknowledgment_required <> _ack_required OR
    _current.acknowledgment_audience <> COALESCE(_ack_audience, 'staff') OR
    COALESCE(_current.department_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

  IF NOT _has_changes AND NOT _publish THEN
    RETURN TRUE;
  END IF;

  UPDATE procedures
  SET 
    title = COALESCE(_title, title),
    summary = _summary,
    description = _description,
    priority = COALESCE(_priority, priority),
    category_id = _category_id,
    effective_date = _effective_date,
    expiry_date = _expiry_date,
    acknowledgment_required = COALESCE(_ack_required, acknowledgment_required),
    acknowledgment_audience = COALESCE(_ack_audience, acknowledgment_audience),
    updated_by = _user_id,
    updated_at = now(),
    department_id = COALESCE(_department_id, department_id)
  WHERE id = _proc_id;

  IF _publish THEN
    INSERT INTO procedure_versions (
      id, procedure_id, organization_id, version_number, title, summary,
      description, priority, category_id, effective_date, expiry_date,
      acknowledgment_required, acknowledgment_audience, published_by, department_id
    ) VALUES (
      _ver_id, _proc_id, _org_id, _expected_version + 1,
      COALESCE(_title, _current.title), _summary, _description,
      COALESCE(_priority, _current.priority), _category_id, _effective_date, _expiry_date,
      COALESCE(_ack_required, _current.acknowledgment_required),
      COALESCE(_ack_audience, _current.acknowledgment_audience),
      _user_id,
      COALESCE(_department_id, _current.department_id)
    );

    UPDATE procedures 
    SET 
      status = 'active', 
      version_number = _expected_version + 1, 
      current_version_id = _ver_id,
      published_at = now()
    WHERE id = _proc_id;

    INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
    VALUES (
      _org_id, _user_id, 'procedure_published', 'procedure', _proc_id,
      jsonb_build_object('version', _expected_version + 1, 'version_id', _ver_id)
    );
  END IF;

  RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.atomic_update_procedure(uuid, uuid, text, text, text, procedure_priority, uuid, date, date, boolean, integer, boolean, uuid, acknowledgment_audience) TO authenticated, service_role;

-- ─── 6. AUTHORITATIVE COMPLIANCE VIEW ──────────────────────────────────────
DROP VIEW IF EXISTS public.procedure_member_compliance CASCADE;

CREATE VIEW public.procedure_member_compliance WITH (security_invoker = true) AS
SELECT 
  p.organization_id,
  p.id AS procedure_id,
  p.title AS procedure_title,
  p.priority AS procedure_priority,
  p.status AS procedure_status,
  p.updated_at AS procedure_updated_at,
  p.current_version_id,
  p.version_number AS current_version_number,
  p.department_id AS procedure_department_id,
  p.acknowledgment_audience,
  m.user_id,
  m.role AS member_role,
  m.department_id AS member_department_id,
  -- Find the most recent non-revoked acknowledgment for this specific procedure and user
  (
    SELECT a.procedure_version_id 
    FROM public.acknowledgments a 
    WHERE a.procedure_id = p.id 
      AND a.user_id = m.user_id 
      AND a.revoked_at IS NULL 
    ORDER BY a.acknowledged_at DESC 
    LIMIT 1
  ) AS latest_ack_version_id,
  (
    SELECT a.acknowledged_at 
    FROM public.acknowledgments a 
    WHERE a.procedure_id = p.id 
      AND a.user_id = m.user_id 
      AND a.revoked_at IS NULL 
    ORDER BY a.acknowledged_at DESC 
    LIMIT 1
  ) AS latest_ack_date,
  -- Calculate authoritative status
  CASE 
    -- 1. Has acknowledged the current version
    WHEN (
      SELECT 1 FROM public.acknowledgments a 
      WHERE a.procedure_id = p.id 
        AND a.user_id = m.user_id 
        AND a.procedure_version_id = p.current_version_id 
        AND a.revoked_at IS NULL 
      LIMIT 1
    ) IS NOT NULL THEN 'ACKNOWLEDGED'
    
    -- 2. Has acknowledged SOME previous version, but not the current one
    WHEN (
      SELECT 1 FROM public.acknowledgments a 
      WHERE a.procedure_id = p.id 
        AND a.user_id = m.user_id 
        AND a.revoked_at IS NULL 
      LIMIT 1
    ) IS NOT NULL THEN 'REQUIRES_REACK'
    
    -- 3. Has never acknowledged (or all acks revoked)
    ELSE 'OUTSTANDING'
  END AS compliance_status
FROM public.procedures p
JOIN public.organization_members m 
  ON p.organization_id = m.organization_id 
  AND m.status = 'active'
WHERE p.status = 'active' 
  AND p.acknowledgment_required = TRUE
  AND p.current_version_id IS NOT NULL
  -- Department Scope: If procedure has a department, only members of that dept are eligible.
  -- If procedure is global (no dept), all active members in scope are eligible.
  AND (p.department_id IS NULL OR p.department_id = m.department_id)
  -- Acknowledgment Eligibility & Audience Scoping:
  -- Only roles authorized to acknowledge ('owner', 'admin', 'manager', 'staff') can be obligated.
  -- 'viewer' (and any unsupported roles) are strictly excluded from the compliance denominator.
  AND m.role IN ('owner', 'admin', 'manager', 'staff')
  AND (
    (p.acknowledgment_audience = 'all_active_members' AND m.role IN ('owner', 'admin', 'manager', 'staff'))
    OR (p.acknowledgment_audience = 'staff' AND m.role = 'staff')
  );

GRANT SELECT ON public.procedure_member_compliance TO authenticated, service_role;

-- ─── 7. AUDIENCE REVIEW INVENTORY VIEW ──────────────────────────────────────
-- Provides an immediate audit inventory of active procedures requiring audience review
CREATE OR REPLACE VIEW public.procedure_audience_review_inventory WITH (security_invoker = true) AS
SELECT 
  p.organization_id,
  p.id AS procedure_id,
  p.title,
  p.status,
  p.version_number,
  p.department_id,
  d.name AS department_name,
  p.acknowledgment_required,
  p.acknowledgment_audience,
  p.created_at,
  p.updated_at,
  CASE 
    WHEN p.acknowledgment_audience = 'all_active_members' THEN 'PENDING_OPERATIONAL_REVIEW'
    ELSE 'CONFIRMED_STAFF_ONLY'
  END AS review_status
FROM public.procedures p
LEFT JOIN public.departments d ON p.department_id = d.id
WHERE p.status = 'active' AND p.acknowledgment_required = TRUE;

GRANT SELECT ON public.procedure_audience_review_inventory TO authenticated, service_role;
