-- Phase 3 AI Ingestion Schema Updates

-- 1. Extend import_drafts
ALTER TABLE public.import_drafts 
  ADD COLUMN IF NOT EXISTS model_name TEXT,
  ADD COLUMN IF NOT EXISTS model_version TEXT,
  ADD COLUMN IF NOT EXISTS raw_ai_output JSONB,
  ADD COLUMN IF NOT EXISTS review_notes TEXT;

-- 2. Extend RLS for import_drafts to include 'manager' role
DROP POLICY IF EXISTS "admin_can_read_drafts" ON public.import_drafts;
DROP POLICY IF EXISTS "admin_can_insert_drafts" ON public.import_drafts;
DROP POLICY IF EXISTS "admin_can_update_drafts" ON public.import_drafts;

CREATE POLICY "reviewer_can_read_drafts"
  ON public.import_drafts FOR SELECT
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin', 'manager'));

CREATE POLICY "reviewer_can_insert_drafts"
  ON public.import_drafts FOR INSERT
  TO authenticated
  WITH CHECK (
    has_org_role(organization_id, 'owner', 'admin', 'manager')
    AND organization_id = get_my_organization_id()
  );

CREATE POLICY "reviewer_can_update_drafts"
  ON public.import_drafts FOR UPDATE
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin', 'manager'))
  WITH CHECK (organization_id = get_my_organization_id());

-- 3. Extend RLS for imports to include 'manager' role
DROP POLICY IF EXISTS "admin_can_read_imports" ON public.imports;
DROP POLICY IF EXISTS "admin_can_insert_imports" ON public.imports;
DROP POLICY IF EXISTS "admin_can_update_imports" ON public.imports;

CREATE POLICY "reviewer_can_read_imports"
  ON public.imports FOR SELECT
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin', 'manager'));

CREATE POLICY "reviewer_can_insert_imports"
  ON public.imports FOR INSERT
  TO authenticated
  WITH CHECK (
    has_org_role(organization_id, 'owner', 'admin', 'manager')
    AND organization_id = get_my_organization_id()
  );

CREATE POLICY "reviewer_can_update_imports"
  ON public.imports FOR UPDATE
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin', 'manager'))
  WITH CHECK (organization_id = get_my_organization_id());

-- 4. RPC: Approve Draft
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

  -- Lock draft
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

  -- Call the deterministic create procedure function (publish=false)
  _new_proc_id := atomic_create_procedure(
    _org_id,
    _title,
    _summary,
    _description,
    _priority,
    _category_id,
    _effective_date,
    _expiry_date,
    _ack_required,
    false -- do not publish
  );

  -- Update draft status
  UPDATE public.import_drafts
  SET 
    status = 'approved',
    reviewed_by = _user_id,
    reviewed_at = now(),
    published_procedure_id = _new_proc_id
  WHERE id = _draft_id;

  -- Insert audit log for draft approval
  INSERT INTO public.audit_logs (organization_id, actor_id, entity_type, entity_id, action, metadata)
  VALUES (_org_id, _user_id, 'import_draft', _draft_id, 'draft_approved', jsonb_build_object('procedure_id', _new_proc_id));

  RETURN _new_proc_id;
END;
$func$;

-- 5. RPC: Reject Draft
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

  -- Lock draft
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

  -- Update draft status
  UPDATE public.import_drafts
  SET 
    status = 'rejected',
    reviewed_by = _user_id,
    reviewed_at = now(),
    review_notes = _notes
  WHERE id = _draft_id;

  -- Insert audit log for draft rejection
  INSERT INTO public.audit_logs (organization_id, actor_id, entity_type, entity_id, action, metadata)
  VALUES (_org_id, _user_id, 'import_draft', _draft_id, 'draft_rejected', jsonb_build_object('notes', _notes));
END;
$func$;
