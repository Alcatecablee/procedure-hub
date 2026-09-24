-- Fix infinite recursion in RLS caused by querying the same table directly

CREATE OR REPLACE FUNCTION public.get_my_department_id(_org_id UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id
  FROM public.organization_members
  WHERE organization_id = _org_id
    AND user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_department_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_department_id(UUID) TO authenticated;

DROP POLICY IF EXISTS "member_can_read_own_org_members" ON public.organization_members;

CREATE POLICY "member_can_read_own_org_members"
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (
    -- Must be in the caller's active organization
    organization_id = get_my_organization_id()
    AND status = 'active'
    AND (
      -- 1. STAFF / EVERYONE: can read their own membership record
      user_id = auth.uid()
      OR
      -- 2. OWNER/ADMIN: can read all members in the organization
      has_org_role(organization_id, 'owner', 'admin')
      OR
      -- 3. MANAGER: can read members belonging to their own department
      (
        has_org_role(organization_id, 'manager')
        AND department_id = public.get_my_department_id(organization_id)
      )
    )
  );

-- Also update procedures and procedure_versions policies to use the secure function for performance/safety
DROP POLICY IF EXISTS "member_can_read_procedures" ON public.procedures;
CREATE POLICY "member_can_read_procedures"
  ON public.procedures FOR SELECT
  TO authenticated
  USING (
    is_member(organization_id)
    AND (
      has_org_role(organization_id, 'owner', 'admin')
      OR
      department_id IS NULL
      OR 
      department_id = public.get_my_department_id(organization_id)
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
      department_id IS NULL
      OR 
      department_id = public.get_my_department_id(organization_id)
    )
  );
