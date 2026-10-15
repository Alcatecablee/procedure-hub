-- Migration: 20261015000001_acknowledgment_audience.sql
-- Description: Introduce explicit acknowledgment_audience ('staff' vs 'all_active_members')
-- Authoritative compliance view filtering and atomic RPC updates.

-- 1. Create acknowledgment_audience enum type
DO $$ BEGIN
  CREATE TYPE public.acknowledgment_audience AS ENUM ('staff', 'all_active_members');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Add acknowledgment_audience column to procedures and procedure_versions
-- Backfill Policy: Defaults existing procedures to 'staff' so frontline operational procedures
-- do not inflate their denominator with managers, admins, or owners.
-- Organization-wide policies (e.g. InfoSec, Code of Conduct) can be updated to 'all_active_members'.
ALTER TABLE public.procedures
  ADD COLUMN IF NOT EXISTS acknowledgment_audience public.acknowledgment_audience NOT NULL DEFAULT 'staff';

ALTER TABLE public.procedure_versions
  ADD COLUMN IF NOT EXISTS acknowledgment_audience public.acknowledgment_audience NOT NULL DEFAULT 'staff';

-- 3. Update atomic_create_procedure with _ack_audience parameter
DROP FUNCTION IF EXISTS atomic_create_procedure;
CREATE OR REPLACE FUNCTION atomic_create_procedure(
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

-- 4. Update atomic_update_procedure with _ack_audience parameter
DROP FUNCTION IF EXISTS atomic_update_procedure;
CREATE OR REPLACE FUNCTION atomic_update_procedure(
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

-- 5. Update authoritative procedure_member_compliance view
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
  -- Department Scope: If procedure has a department, only members of that dept are required.
  -- If procedure is global (no dept), all active members are eligible.
  AND (p.department_id IS NULL OR p.department_id = m.department_id)
  -- Audience Scope:
  -- If audience is 'staff', only active members with role 'staff' are required.
  -- If audience is 'all_active_members', all active roles (owner, admin, manager, staff, viewer) within scope are required.
  AND (
    p.acknowledgment_audience = 'all_active_members' 
    OR (p.acknowledgment_audience = 'staff' AND m.role = 'staff')
  );
