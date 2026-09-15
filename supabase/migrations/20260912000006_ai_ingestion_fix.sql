CREATE OR REPLACE FUNCTION atomic_approve_draft(
  _draft_id UUID,
  _org_id UUID,
  _title TEXT,
  _summary TEXT,
  _description TEXT,
  _priority procedure_priority,
  _category_id UUID,
  _effective_date DATE,
  _expiry_date DATE,
  _ack_required BOOLEAN
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  _v_draft public.import_drafts%ROWTYPE;
  _new_proc_id UUID;
  _user_id UUID := auth.uid();
BEGIN
  IF NOT has_org_role(_org_id, 'owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Forbidden: Insufficient organization role' USING ERRCODE = 'INSUF';
  END IF;

  SELECT * INTO _v_draft FROM public.import_drafts 
  WHERE id = _draft_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found' USING ERRCODE = 'P0002';
  END IF;

  IF _v_draft.organization_id != _org_id THEN
    RAISE EXCEPTION 'Forbidden: Tenant mismatch' USING ERRCODE = 'TENAN';
  END IF;

  IF _v_draft.status != 'pending' THEN
    RAISE EXCEPTION 'Draft is already %', _v_draft.status USING ERRCODE = 'P0001';
  END IF;

  _new_proc_id := atomic_create_procedure(
    _org_id, _title, _summary, _description, _priority, _category_id, _effective_date, _expiry_date, _ack_required, false
  );

  UPDATE public.import_drafts
  SET status = 'approved', reviewed_by = _user_id, reviewed_at = now(), published_procedure_id = _new_proc_id
  WHERE id = _draft_id;

  INSERT INTO public.audit_logs (organization_id, actor_id, entity_type, entity_id, event_type, metadata)
  VALUES (_org_id, _user_id, 'import_draft', _draft_id, 'draft_approved', jsonb_build_object('procedure_id', _new_proc_id));

  RETURN _new_proc_id;
END;
$func$;

CREATE OR REPLACE FUNCTION atomic_reject_draft(
  _draft_id UUID,
  _org_id UUID,
  _notes TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  _v_draft public.import_drafts%ROWTYPE;
  _user_id UUID := auth.uid();
BEGIN
  IF NOT has_org_role(_org_id, 'owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Forbidden: Insufficient organization role' USING ERRCODE = 'INSUF';
  END IF;

  SELECT * INTO _v_draft FROM public.import_drafts 
  WHERE id = _draft_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found' USING ERRCODE = 'P0002';
  END IF;

  IF _v_draft.organization_id != _org_id THEN
    RAISE EXCEPTION 'Forbidden: Tenant mismatch' USING ERRCODE = 'TENAN';
  END IF;

  IF _v_draft.status != 'pending' THEN
    RAISE EXCEPTION 'Draft is already %', _v_draft.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.import_drafts
  SET status = 'rejected', reviewed_by = _user_id, reviewed_at = now(), review_notes = _notes
  WHERE id = _draft_id;

  INSERT INTO public.audit_logs (organization_id, actor_id, entity_type, entity_id, event_type, metadata)
  VALUES (_org_id, _user_id, 'import_draft', _draft_id, 'draft_rejected', jsonb_build_object('notes', _notes));
END;
$func$;
