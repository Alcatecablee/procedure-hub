-- Migration 003: Lifecycle and Security Hardening

-- Drop old RPCs that accepted client-controlled _user_id
DROP FUNCTION IF EXISTS public.atomic_create_procedure(uuid, uuid, text, text, text, procedure_priority, uuid, date, date, boolean, boolean);
DROP FUNCTION IF EXISTS public.atomic_update_procedure(uuid, uuid, uuid, text, text, text, procedure_priority, uuid, date, date, boolean, boolean, integer);
DROP FUNCTION IF EXISTS public.atomic_acknowledge_procedure(uuid, uuid, uuid, uuid);

-- 1. Create Procedure (Atomic, Hardened)
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
  _publish BOOLEAN
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _proc_id UUID := gen_random_uuid();
  _ver_id UUID := gen_random_uuid();
  _status procedure_status := 'draft';
  _version_num INTEGER := 0;
  _user_id UUID := auth.uid();
BEGIN
  -- Security: Enforce authentication
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  -- Security: Enforce organization boundary and role
  IF NOT has_org_role(_org_id, ARRAY['owner', 'admin', 'manager']::member_role[]) THEN
    RAISE EXCEPTION 'Unauthorized: Insufficient role in organization';
  END IF;

  -- Input validation
  IF char_length(_title) < 1 OR char_length(_title) > 250 THEN RAISE EXCEPTION 'Invalid title length'; END IF;

  IF _publish THEN
    _status := 'active';
    _version_num := 1;
  END IF;

  INSERT INTO procedures (
    id, organization_id, title, summary, description, priority, category_id,
    effective_date, expiry_date, acknowledgment_required, status,
    version_number, created_by, updated_by
  ) VALUES (
    _proc_id, _org_id, _title, _summary, _description, _priority, _category_id,
    _effective_date, _expiry_date, _ack_required, _status,
    _version_num, _user_id, _user_id
  );

  INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_org_id, _user_id, 'procedure_created', 'procedure', _proc_id, jsonb_build_object('title', _title));

  IF _publish THEN
    INSERT INTO procedure_versions (
      id, procedure_id, organization_id, version_number, title, summary,
      description, priority, category_id, effective_date, expiry_date,
      acknowledgment_required, published_by
    ) VALUES (
      _ver_id, _proc_id, _org_id, 1, _title, _summary,
      _description, _priority, _category_id, _effective_date, _expiry_date,
      _ack_required, _user_id
    );

    UPDATE procedures SET current_version_id = _ver_id WHERE id = _proc_id;

    INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
    VALUES (_org_id, _user_id, 'procedure_published', 'procedure_version', _ver_id, jsonb_build_object('version', 1));
  END IF;

  RETURN _proc_id;
END;
$$;

-- 2. Update Procedure (Atomic, Hardened)
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
  _publish BOOLEAN,
  _expected_version INTEGER
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current procedures%ROWTYPE;
  _has_changes BOOLEAN;
  _next_version INTEGER;
  _ver_id UUID := gen_random_uuid();
  _user_id UUID := auth.uid();
BEGIN
  -- Security: Enforce authentication
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  -- Security: Enforce organization boundary and role
  IF NOT has_org_role(_org_id, ARRAY['owner', 'admin', 'manager']::member_role[]) THEN
    RAISE EXCEPTION 'Unauthorized: Insufficient role in organization';
  END IF;

  SELECT * INTO _current FROM procedures WHERE id = _proc_id AND organization_id = _org_id FOR UPDATE;
  
  IF NOT FOUND THEN RAISE EXCEPTION 'Procedure not found'; END IF;
  IF _current.status IN ('archived', 'replaced') THEN RAISE EXCEPTION 'Cannot update archived or replaced procedure'; END IF;
  IF _current.version_number <> _expected_version THEN RAISE EXCEPTION 'Conflict: Procedure was modified by someone else.'; END IF;

  _has_changes := (
    COALESCE(_current.title, '') <> COALESCE(_title, '') OR
    COALESCE(_current.summary, '') <> COALESCE(_summary, '') OR
    COALESCE(_current.description, '') <> COALESCE(_description, '') OR
    COALESCE(_current.priority::text, '') <> COALESCE(_priority::text, '') OR
    COALESCE(_current.category_id, '00000000-0000-0000-0000-000000000000'::uuid) <> COALESCE(_category_id, '00000000-0000-0000-0000-000000000000'::uuid) OR
    COALESCE(_current.effective_date, '1970-01-01'::date) <> COALESCE(_effective_date, '1970-01-01'::date) OR
    COALESCE(_current.expiry_date, '1970-01-01'::date) <> COALESCE(_expiry_date, '1970-01-01'::date) OR
    COALESCE(_current.acknowledgment_required, false) <> COALESCE(_ack_required, false)
  );

  IF NOT _has_changes AND NOT _publish THEN
    RETURN jsonb_build_object('procedureId', _proc_id, 'published', false, 'skipped', true);
  END IF;

  _next_version := _current.version_number;
  IF _publish AND (_has_changes OR _current.status = 'draft') THEN
    _next_version := CASE WHEN _current.status = 'draft' AND NOT _has_changes THEN 1 ELSE _current.version_number + 1 END;
  ELSIF _publish AND NOT _has_changes THEN
    RETURN jsonb_build_object('procedureId', _proc_id, 'published', true, 'skipped', true);
  END IF;

  UPDATE procedures SET
    title = _title,
    summary = _summary,
    description = _description,
    priority = _priority,
    category_id = _category_id,
    effective_date = _effective_date,
    expiry_date = _expiry_date,
    acknowledgment_required = _ack_required,
    status = CASE WHEN _publish THEN 'active'::procedure_status ELSE 'draft'::procedure_status END,
    version_number = _next_version,
    updated_by = _user_id,
    updated_at = now()
  WHERE id = _proc_id;

  INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_org_id, _user_id, 'procedure_updated', 'procedure', _proc_id, jsonb_build_object('version', _next_version));

  IF _publish AND (_has_changes OR _current.status = 'draft') THEN
    INSERT INTO procedure_versions (
      id, procedure_id, organization_id, version_number, title, summary,
      description, priority, category_id, effective_date, expiry_date,
      acknowledgment_required, published_by
    ) VALUES (
      _ver_id, _proc_id, _org_id, _next_version, _title, _summary,
      _description, _priority, _category_id, _effective_date, _expiry_date,
      _ack_required, _user_id
    );

    UPDATE procedures SET current_version_id = _ver_id WHERE id = _proc_id;

    INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
    VALUES (_org_id, _user_id, 'procedure_published', 'procedure_version', _ver_id, jsonb_build_object('version', _next_version));
  END IF;

  RETURN jsonb_build_object('procedureId', _proc_id, 'published', _publish, 'skipped', false);
END;
$$;

-- 3. Acknowledge Procedure (Atomic, Hardened)
CREATE OR REPLACE FUNCTION atomic_acknowledge_procedure(
  _proc_id UUID,
  _ver_id UUID,
  _org_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_ver UUID;
  _user_id UUID := auth.uid();
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  IF NOT is_member(_org_id) THEN
    RAISE EXCEPTION 'Unauthorized: Not a member of this organization';
  END IF;

  SELECT current_version_id INTO _current_ver FROM procedures WHERE id = _proc_id AND organization_id = _org_id;
  IF _current_ver IS NULL OR _current_ver <> _ver_id THEN
    RAISE EXCEPTION 'This version is no longer the current version. Please refresh and review the latest version.';
  END IF;

  BEGIN
    INSERT INTO acknowledgments (organization_id, procedure_id, procedure_version_id, user_id)
    VALUES (_org_id, _proc_id, _ver_id, _user_id);
    
    INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
    VALUES (_org_id, _user_id, 'acknowledgment_created', 'procedure_version', _ver_id, '{}'::jsonb);
  EXCEPTION WHEN unique_violation THEN
    RETURN TRUE;
  END;

  RETURN TRUE;
END;
$$;

-- 4. Archive Procedure
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
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_org_role(_org_id, ARRAY['owner', 'admin', 'manager']::member_role[]) THEN
    RAISE EXCEPTION 'Unauthorized: Insufficient role in organization';
  END IF;

  SELECT * INTO _current FROM procedures WHERE id = _proc_id AND organization_id = _org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Procedure not found'; END IF;
  IF _current.status IN ('archived', 'replaced') THEN RAISE EXCEPTION 'Procedure is already archived or replaced'; END IF;

  UPDATE procedures 
  SET status = 'archived', archived_at = now(), updated_by = _user_id, updated_at = now()
  WHERE id = _proc_id;

  INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_org_id, _user_id, 'procedure_archived', 'procedure', _proc_id, '{}'::jsonb);

  RETURN TRUE;
END;
$$;

-- 5. Replace Procedure
ALTER TABLE public.procedures ADD COLUMN IF NOT EXISTS superseded_by_id UUID REFERENCES public.procedures(id) ON DELETE SET NULL;
ALTER TABLE public.procedures ADD CONSTRAINT procedures_no_self_supersede CHECK (supersedes_id <> id AND superseded_by_id <> id);

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
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_org_role(_org_id, ARRAY['owner', 'admin', 'manager']::member_role[]) THEN
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

  -- Update old procedure
  UPDATE procedures 
  SET status = 'replaced', superseded_by_id = _new_proc_id, archived_at = now(), updated_by = _user_id, updated_at = now()
  WHERE id = _old_proc_id;

  -- Update new procedure (ensure supersedes_id is set)
  UPDATE procedures
  SET supersedes_id = _old_proc_id, updated_by = _user_id, updated_at = now()
  WHERE id = _new_proc_id;

  INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_org_id, _user_id, 'procedure_replaced', 'procedure', _old_proc_id, jsonb_build_object('replaced_by', _new_proc_id));

  RETURN TRUE;
END;
$$;
