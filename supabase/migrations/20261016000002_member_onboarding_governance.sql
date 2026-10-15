-- Migration: 20261016000002_member_onboarding_governance.sql
-- Description: Enforce administrator-controlled department assignment during member onboarding,
-- explicit onboarding completion state, and atomic profile + membership + audit log writes.

-- 1. Add explicit onboarding tracking columns to organization_members
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requested_department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;

-- 2. Backfill onboarded_at for existing fully configured members, owners/admins, and invited members
UPDATE public.organization_members
SET onboarded_at = COALESCE(joined_at, created_at)
WHERE onboarded_at IS NULL
  AND (
    role IN ('owner', 'admin')
    OR invited_by IS NOT NULL
    OR (department_id IS NOT NULL AND designation IS NOT NULL AND trim(designation) <> '')
  );

-- 3. Clear onboarded_at if an administrator explicitly assigns a department via update
CREATE OR REPLACE FUNCTION public.atomic_complete_member_onboarding(
  _full_name TEXT,
  _designation TEXT,
  _requested_department_id UUID DEFAULT NULL,
  _is_global BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _user_id UUID := auth.uid();
  _member RECORD;
  _dept_name TEXT := NULL;
  _clean_name TEXT := trim(coalesce(_full_name, ''));
  _clean_designation TEXT := trim(coalesce(_designation, ''));
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required';
  END IF;

  -- 1. Fetch caller's active membership
  SELECT id, organization_id, role, department_id, designation, onboarded_at
  INTO _member
  FROM public.organization_members
  WHERE user_id = _user_id AND status = 'active'
  LIMIT 1;

  IF _member IS NULL THEN
    RAISE EXCEPTION 'Forbidden: No active organization membership found';
  END IF;

  -- 2. Prevent replay / post-onboarding tampering
  IF _member.onboarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Forbidden: Member onboarding has already been completed';
  END IF;

  -- 3. Validate inputs BEFORE any writes (no silent fallback to generic 'Staff')
  IF char_length(_clean_name) < 2 OR char_length(_clean_name) > 100 THEN
    RAISE EXCEPTION 'Validation failed: Full name must be between 2 and 100 characters';
  END IF;

  IF char_length(_clean_designation) < 2 OR char_length(_clean_designation) > 100 THEN
    RAISE EXCEPTION 'Validation failed: Job title / designation is required (2-100 characters)';
  END IF;

  -- 4. Validate department selection before any writes
  IF _requested_department_id IS NOT NULL THEN
    SELECT name INTO _dept_name
    FROM public.departments
    WHERE id = _requested_department_id AND organization_id = _member.organization_id;

    IF _dept_name IS NULL THEN
      RAISE EXCEPTION 'Forbidden: Selected department does not exist in your organization';
    END IF;
  ELSIF _member.department_id IS NULL AND NOT _is_global THEN
    RAISE EXCEPTION 'Validation failed: Department selection is required';
  END IF;

  -- 5. Update user profile atomically
  UPDATE public.profiles
  SET full_name = _clean_name,
      updated_at = now()
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile record not found for authenticated user';
  END IF;

  -- 6. Update membership record:
  -- IMPORTANT SECURITY BOUNDARY: Never overwrite trusted department_id from self-service onboarding.
  -- Trusted department_id is strictly administrator-controlled.
  -- Self-service records requested_department_id for admin review and sets onboarded_at.
  UPDATE public.organization_members
  SET designation = _clean_designation,
      requested_department_id = COALESCE(_requested_department_id, requested_department_id),
      onboarded_at = now(),
      updated_at = now()
  WHERE id = _member.id;

  -- 7. Record audit event using valid schema enum 'member_joined'
  -- Any failure here aborts and rolls back the entire transaction.
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
    'member_joined'::public.audit_action,
    'organization_members',
    _member.id,
    jsonb_build_object(
      'action', 'onboarding_completed',
      'designation', _clean_designation,
      'requested_department_id', _requested_department_id,
      'requested_department_name', _dept_name,
      'is_global_request', _is_global
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'memberId', _member.id,
    'departmentId', _member.department_id,
    'requestedDepartmentId', _requested_department_id,
    'requestedDepartmentName', _dept_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_complete_member_onboarding(text, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atomic_complete_member_onboarding(text, text, uuid, boolean) TO authenticated, service_role;
