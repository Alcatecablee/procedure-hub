ALTER TABLE public.procedures ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.procedure_versions ADD COLUMN IF NOT EXISTS department TEXT;

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
  _department TEXT DEFAULT NULL
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
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  IF NOT has_org_role(_org_id, 'owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Unauthorized: Insufficient role in organization';
  END IF;

  IF char_length(_title) < 1 OR char_length(_title) > 250 THEN RAISE EXCEPTION 'Invalid title length'; END IF;

  IF _publish THEN
    _status := 'active';
    _version_num := 1;
  END IF;

  INSERT INTO procedures (
    id, organization_id, title, summary, description, priority, category_id,
    effective_date, expiry_date, acknowledgment_required, status,
    version_number, created_by, updated_by, department
  ) VALUES (
    _proc_id, _org_id, _title, _summary, _description, _priority, _category_id,
    _effective_date, _expiry_date, _ack_required, _status,
    _version_num, _user_id, _user_id, _department
  );

  INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (_org_id, _user_id, 'procedure_created', 'procedure', _proc_id, jsonb_build_object('title', _title));

  IF _publish THEN
    INSERT INTO procedure_versions (
      id, procedure_id, organization_id, version_number, title, summary,
      description, priority, category_id, effective_date, expiry_date,
      acknowledgment_required, published_by, department
    ) VALUES (
      _ver_id, _proc_id, _org_id, 1, _title, _summary,
      _description, _priority, _category_id, _effective_date, _expiry_date,
      _ack_required, _user_id, _department
    );

    UPDATE procedures SET current_version_id = _ver_id, published_at = now() WHERE id = _proc_id;
  END IF;

  RETURN _proc_id;
END;
$function$;

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
  _department TEXT DEFAULT NULL
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
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_org_role(_org_id, 'owner', 'admin', 'manager') THEN
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
    _current.acknowledgment_required <> _ack_required OR
    COALESCE(_current.department, '') <> COALESCE(_department, '')
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
    updated_by = _user_id,
    updated_at = now(),
    department = COALESCE(_department, department)
  WHERE id = _proc_id;

  IF _publish THEN
    INSERT INTO procedure_versions (
      id, procedure_id, organization_id, version_number, title, summary,
      description, priority, category_id, effective_date, expiry_date,
      acknowledgment_required, published_by, department
    ) VALUES (
      _ver_id, _proc_id, _org_id, _expected_version + 1,
      COALESCE(_title, _current.title), _summary, _description,
      COALESCE(_priority, _current.priority), _category_id, _effective_date, _expiry_date,
      COALESCE(_ack_required, _current.acknowledgment_required), _user_id, COALESCE(_department, _current.department)
    );

    UPDATE procedures 
    SET 
      status = 'active', 
      version_number = _expected_version + 1, 
      current_version_id = _ver_id,
      published_at = now()
    WHERE id = _proc_id;

    INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
    VALUES (_org_id, _user_id, 'procedure_published', 'procedure', _proc_id, jsonb_build_object('version', _expected_version + 1));
  ELSE
    INSERT INTO audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
    VALUES (_org_id, _user_id, 'procedure_updated', 'procedure', _proc_id, '{}'::jsonb);
  END IF;

  RETURN TRUE;
END;
$function$;

-- Update RLS for procedures
DROP POLICY IF EXISTS "member_can_read_procedures" ON public.procedures;
CREATE POLICY "member_can_read_procedures"
  ON public.procedures FOR SELECT
  TO authenticated
  USING (
    is_member(organization_id)
    AND (
      has_org_role(organization_id, 'owner', 'admin')
      OR
      department IS NULL
      OR department = (SELECT m.department FROM public.organization_members m WHERE m.organization_id = procedures.organization_id AND m.user_id = auth.uid() LIMIT 1)
    )
    AND (
      status != 'draft'
      OR has_org_role(organization_id, 'owner', 'admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "member_can_read_versions" ON public.procedure_versions;
CREATE POLICY "member_can_read_versions"
  ON public.procedure_versions FOR SELECT
  TO authenticated
  USING (
    is_member(organization_id)
    AND (
      has_org_role(organization_id, 'owner', 'admin')
      OR
      department IS NULL
      OR department = (SELECT m.department FROM public.organization_members m WHERE m.organization_id = procedure_versions.organization_id AND m.user_id = auth.uid() LIMIT 1)
    )
  );
