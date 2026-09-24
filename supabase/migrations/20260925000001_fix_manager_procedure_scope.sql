-- Migration: Fix atomic_archive_procedure and atomic_replace_procedure to enforce Manager department boundaries.

DROP FUNCTION IF EXISTS atomic_archive_procedure;
CREATE OR REPLACE FUNCTION atomic_archive_procedure(
  _proc_id UUID,
  _org_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current procedures%ROWTYPE;
  _user_id UUID := auth.uid();
  _actual_dept_id UUID;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_org_role(_org_id, 'owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Unauthorized: Insufficient role in organization';
  END IF;

  SELECT * INTO _current FROM procedures WHERE id = _proc_id AND organization_id = _org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Procedure not found'; END IF;
  IF _current.status IN ('archived', 'replaced') THEN RAISE EXCEPTION 'Procedure is already archived or replaced'; END IF;

  -- ENFORCE DEPARTMENT BOUNDARY FOR MANAGERS
  IF has_org_role(_org_id, 'manager') AND NOT has_org_role(_org_id, 'owner', 'admin') THEN
    SELECT department_id INTO _actual_dept_id FROM public.organization_members
    WHERE organization_id = _org_id AND user_id = _user_id AND status = 'active' LIMIT 1;

    IF _actual_dept_id IS NULL OR (_current.department_id IS NOT NULL AND _current.department_id <> _actual_dept_id) THEN
      RAISE EXCEPTION 'Forbidden: Manager cannot archive a procedure outside their department.';
    END IF;
  END IF;

  UPDATE procedures 
  SET status = 'archived', archived_at = now(), updated_by = _user_id, updated_at = now()
  WHERE id = _proc_id;

  INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_org_id, _user_id, 'procedure_archived', 'procedure', _proc_id, '{}'::jsonb);

  RETURN TRUE;
END;
$$;


DROP FUNCTION IF EXISTS atomic_replace_procedure;
CREATE OR REPLACE FUNCTION atomic_replace_procedure(
  _old_proc_id UUID,
  _new_proc_id UUID,
  _org_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_proc procedures%ROWTYPE;
  _new_proc procedures%ROWTYPE;
  _user_id UUID := auth.uid();
  _actual_dept_id UUID;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_org_role(_org_id, 'owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Unauthorized: Insufficient role in organization';
  END IF;
  IF _old_proc_id = _new_proc_id THEN RAISE EXCEPTION 'Cannot replace a procedure with itself'; END IF;

  -- Lock both rows in a consistent order to prevent deadlocks
  IF _old_proc_id < _new_proc_id THEN
    SELECT * INTO _old_proc FROM procedures WHERE id = _old_proc_id AND organization_id = _org_id FOR UPDATE;
    SELECT * INTO _new_proc FROM procedures WHERE id = _new_proc_id AND organization_id = _org_id FOR UPDATE;
  ELSE
    SELECT * INTO _new_proc FROM procedures WHERE id = _new_proc_id AND organization_id = _org_id FOR UPDATE;
    SELECT * INTO _old_proc FROM procedures WHERE id = _old_proc_id AND organization_id = _org_id FOR UPDATE;
  END IF;

  IF _old_proc.id IS NULL OR _new_proc.id IS NULL THEN RAISE EXCEPTION 'Procedure not found or tenant boundary violated'; END IF;
  IF _old_proc.status IN ('archived', 'replaced') THEN RAISE EXCEPTION 'Target procedure is already archived or replaced'; END IF;
  IF _new_proc.status = 'draft' THEN RAISE EXCEPTION 'New procedure must be published to replace an old one'; END IF;

  -- ENFORCE DEPARTMENT BOUNDARY FOR MANAGERS
  IF has_org_role(_org_id, 'manager') AND NOT has_org_role(_org_id, 'owner', 'admin') THEN
    SELECT department_id INTO _actual_dept_id FROM public.organization_members
    WHERE organization_id = _org_id AND user_id = _user_id AND status = 'active' LIMIT 1;

    IF _actual_dept_id IS NULL THEN
      RAISE EXCEPTION 'Forbidden: Manager must be assigned to a department to replace procedures.';
    END IF;

    IF (_old_proc.department_id IS NOT NULL AND _old_proc.department_id <> _actual_dept_id) OR
       (_new_proc.department_id IS NOT NULL AND _new_proc.department_id <> _actual_dept_id) THEN
      RAISE EXCEPTION 'Forbidden: Manager cannot replace a procedure outside their department.';
    END IF;
  END IF;

  -- Update old procedure
  UPDATE procedures 
  SET status = 'replaced', superseded_by_id = _new_proc_id, archived_at = now(), updated_by = _user_id, updated_at = now()
  WHERE id = _old_proc_id;

  -- Update new procedure (ensure supersedes_id is set)
  UPDATE procedures
  SET supersedes_id = _old_proc_id, updated_by = _user_id, updated_at = now()
  WHERE id = _new_proc_id;

  INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_org_id, _user_id, 'procedure_replaced', 'procedure', _old_proc_id, jsonb_build_object('superseded_by', _new_proc_id));

  RETURN TRUE;
END;
$$;
