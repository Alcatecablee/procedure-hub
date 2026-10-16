-- Migration: 20261016000003_harden_atomic_member_onboarding.sql
-- Description: Harden public.atomic_complete_member_onboarding with FOR UPDATE row-level locking,
-- explicit owner/admin role rejection, authoritative onboarding state persistence, and
-- transactional audit failure verification.

-- 1. Ensure onboarding columns exist on organization_members
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requested_department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;

-- 2. Replace 4-arg function with hardened 5-arg signature (4th & 5th args have defaults so 2-, 3-, 4-, and 5-arg RPC calls all resolve to this single function)
DROP FUNCTION IF EXISTS public.atomic_complete_member_onboarding(text, text, uuid, boolean);
DROP FUNCTION IF EXISTS public.atomic_complete_member_onboarding(text, text, uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.atomic_complete_member_onboarding(
  _full_name TEXT,
  _designation TEXT,
  _requested_department_id UUID DEFAULT NULL,
  _is_global BOOLEAN DEFAULT FALSE,
  _audit_event_override TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  _user_id UUID := auth.uid();
  _member RECORD;
  _profile RECORD;
  _dept_name TEXT := NULL;
  _clean_name TEXT := trim(coalesce(_full_name, ''));
  _clean_designation TEXT := trim(coalesce(_designation, ''));
  _effective_name TEXT;
  _effective_requested_dept_id UUID := NULL;
  _audit_event public.audit_action := 'member_joined'::public.audit_action;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required';
  END IF;

  -- 1. Fetch and lock caller's active membership row (FOR UPDATE prevents concurrent onboarding races)
  SELECT id, organization_id, role, department_id, designation, onboarded_at, requested_department_id
  INTO _member
  FROM public.organization_members
  WHERE user_id = _user_id
    AND status = 'active'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF _member IS NULL THEN
    RAISE EXCEPTION 'Forbidden: No active organization membership found';
  END IF;

  -- 2. Reject owners and administrators from self-service member onboarding (checked before onboarded_at)
  IF _member.role IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Forbidden: Owners and administrators do not use self-service member onboarding';
  END IF;

  -- 3. Reject repeat onboarding attempts
  IF _member.onboarded_at IS NOT NULL OR (
    _member.department_id IS NOT NULL
    AND _member.designation IS NOT NULL
    AND trim(_member.designation) <> ''
  ) THEN
    RAISE EXCEPTION 'Forbidden: Member onboarding has already been completed. Contact an administrator to change your department or role.';
  END IF;

  -- 4. Validate profile & full_name before any writes
  SELECT id, full_name
  INTO _profile
  FROM public.profiles
  WHERE id = _user_id
  FOR UPDATE;

  IF _profile IS NULL THEN
    RAISE EXCEPTION 'Profile record not found for authenticated user';
  END IF;

  IF char_length(_clean_name) > 0 THEN
    IF char_length(_clean_name) < 2 OR char_length(_clean_name) > 100 THEN
      RAISE EXCEPTION 'Validation failed: Full name must be between 2 and 100 characters';
    END IF;
    _effective_name := _clean_name;
  ELSE
    _effective_name := trim(coalesce(_profile.full_name, ''));
    IF char_length(_effective_name) < 2 OR char_length(_effective_name) > 100 THEN
      RAISE EXCEPTION 'Validation failed: Full name must be between 2 and 100 characters';
    END IF;
  END IF;

  -- 5. Validate designation (strictly required, no silent 'Staff' fallback)
  IF char_length(_clean_designation) < 2 OR char_length(_clean_designation) > 100 THEN
    RAISE EXCEPTION 'Validation failed: Job title / designation is required (2-100 characters)';
  END IF;

  -- 6. Validate requested department / global scope before any writes
  IF _requested_department_id IS NOT NULL THEN
    SELECT name INTO _dept_name
    FROM public.departments
    WHERE id = _requested_department_id
      AND organization_id = _member.organization_id;

    IF _dept_name IS NULL THEN
      RAISE EXCEPTION 'Forbidden: Selected department does not exist in your organization';
    END IF;

    -- Only store a pending request if an administrator has not already assigned a trusted department_id
    IF _member.department_id IS NULL AND NOT COALESCE(_is_global, FALSE) THEN
      _effective_requested_dept_id := _requested_department_id;
    END IF;
  ELSIF _member.department_id IS NULL AND NOT COALESCE(_is_global, FALSE) THEN
    RAISE EXCEPTION 'Validation failed: Department selection is required';
  END IF;

  -- 7. Update user profile within the transaction
  UPDATE public.profiles
  SET full_name = _effective_name,
      updated_at = now()
  WHERE id = _user_id;

  -- 8. Update organization_members within the transaction
  -- SECURITY INVARIANT: Never modify trusted department_id from self-service onboarding.
  -- Trusted department_id is strictly administrator-controlled.
  UPDATE public.organization_members
  SET designation = _clean_designation,
      requested_department_id = _effective_requested_dept_id,
      onboarded_at = now(),
      updated_at = now()
  WHERE id = _member.id
    AND organization_id = _member.organization_id;

  -- 9. Validate audit event type and insert immutable audit log within the SAME transaction.
  -- If _audit_event_override is provided (e.g. during fault-injection testing), cast it to public.audit_action
  -- AFTER the profile/member UPDATE statements so any invalid enum or policy error aborts the transaction
  -- and proves PostgreSQL rolls back all preceding writes atomically.
  IF _audit_event_override IS NOT NULL THEN
    _audit_event := _audit_event_override::public.audit_action;
    IF _audit_event <> 'member_joined'::public.audit_action THEN
      RAISE EXCEPTION 'Forbidden: Only member_joined is permitted for member onboarding audit logs';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    organization_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    _member.organization_id,
    _user_id,
    _audit_event,
    'organization_members',
    _member.id,
    jsonb_build_object(
      'action', 'onboarding_completed',
      'designation', _clean_designation,
      'existing_department_id', _member.department_id,
      'requested_department_id', _effective_requested_dept_id,
      'requested_department_name', CASE WHEN _effective_requested_dept_id IS NOT NULL THEN _dept_name ELSE NULL END,
      'is_global_request', COALESCE(_is_global, FALSE)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'memberId', _member.id,
    'departmentId', _member.department_id,
    'requestedDepartmentId', _effective_requested_dept_id,
    'requestedDepartmentName', CASE WHEN _effective_requested_dept_id IS NOT NULL THEN _dept_name ELSE NULL END,
    'requiresAdminDepartmentApproval', (_member.department_id IS NULL AND _effective_requested_dept_id IS NOT NULL)
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.atomic_complete_member_onboarding(text, text, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atomic_complete_member_onboarding(text, text, uuid, boolean, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
