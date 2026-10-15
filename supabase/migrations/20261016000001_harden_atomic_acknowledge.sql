-- Migration: 20261016000001_harden_atomic_acknowledge.sql
-- Description: Harden atomic_acknowledge_procedure with explicit audience, departmental scope,
-- and lifecycle checks to ensure database-level consistency with compliance calculation.

CREATE OR REPLACE FUNCTION public.atomic_acknowledge_procedure(
  _proc_id UUID,
  _ver_id UUID,
  _org_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _proc RECORD;
  _member RECORD;
  _user_id UUID := auth.uid();
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- 1. Verify caller active membership and eligible role
  SELECT role, department_id, status INTO _member
  FROM public.organization_members
  WHERE organization_id = _org_id AND user_id = _user_id AND status = 'active'
  LIMIT 1;

  IF _member IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Active organization membership required';
  END IF;

  IF _member.role NOT IN ('owner', 'admin', 'manager', 'staff') THEN
    RAISE EXCEPTION 'Forbidden: Insufficient permissions for role %', _member.role;
  END IF;

  -- 2. Verify procedure status, requirement, and current version
  SELECT status, current_version_id, acknowledgment_required, acknowledgment_audience, department_id
  INTO _proc
  FROM public.procedures
  WHERE id = _proc_id AND organization_id = _org_id
  LIMIT 1;

  IF _proc IS NULL THEN
    RAISE EXCEPTION 'Procedure not found';
  END IF;

  IF _proc.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot acknowledge: Procedure is not active';
  END IF;

  IF NOT _proc.acknowledgment_required THEN
    RAISE EXCEPTION 'Cannot acknowledge: Acknowledgment is not required for this procedure';
  END IF;

  IF _proc.current_version_id IS NULL OR _proc.current_version_id <> _ver_id THEN
    RAISE EXCEPTION 'This version is no longer the current version. Please refresh and review the latest version.';
  END IF;

  -- 3. Verify departmental scope
  IF _proc.department_id IS NOT NULL AND (_member.department_id IS NULL OR _proc.department_id <> _member.department_id) THEN
    RAISE EXCEPTION 'Forbidden: Member is not in the assigned department for this procedure';
  END IF;

  -- 4. Verify audience eligibility
  IF _proc.acknowledgment_audience = 'staff' AND _member.role <> 'staff' THEN
    RAISE EXCEPTION 'Forbidden: This procedure only requires and accepts acknowledgments from staff';
  END IF;

  -- 5. Record acknowledgment idempotently
  BEGIN
    INSERT INTO public.acknowledgments (organization_id, procedure_id, procedure_version_id, user_id)
    VALUES (_org_id, _proc_id, _ver_id, _user_id);
    
    INSERT INTO public.audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
    VALUES (_org_id, _user_id, 'acknowledgment_created', 'procedure_version', _ver_id, '{}'::jsonb);
  EXCEPTION WHEN unique_violation THEN
    RETURN TRUE;
  END;

  RETURN TRUE;
END;
$$;

-- Revoke execute from PUBLIC and anon, grant only to authenticated and service_role
REVOKE ALL ON FUNCTION public.atomic_acknowledge_procedure(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atomic_acknowledge_procedure(uuid, uuid, uuid) TO authenticated, service_role;
