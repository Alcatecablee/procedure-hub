-- Drop existing policy
DROP POLICY IF EXISTS "member_can_read_procedures" ON public.procedures;

-- Recreate policy to hide drafts from non-admins
CREATE POLICY "member_can_read_procedures"
  ON public.procedures FOR SELECT
  TO authenticated
  USING (
    is_member(organization_id) 
    AND (
      status != 'draft' 
      OR has_org_role(organization_id, 'owner', 'admin', 'manager')
    )
  );
