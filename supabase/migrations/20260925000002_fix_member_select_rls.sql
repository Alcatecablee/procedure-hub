-- Migration: Fix organization_members SELECT RLS policy to enforce role-based boundaries.
-- Drops the old overly permissive policy and replaces it.

DROP POLICY IF EXISTS "member_can_read_own_org_members" ON public.organization_members;

CREATE POLICY "member_can_read_own_org_members"
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (
    -- Must be in the caller's active organization
    organization_id = get_my_organization_id()
    AND status = 'active'
    AND (
      -- 1. Everyone (including STAFF) can read their own membership record
      -- (Required by the frontend useAuth/resolveMembership to determine org context)
      user_id = auth.uid()
      
      OR
      
      -- 2. OWNER/ADMIN can read all members in the organization
      has_org_role(organization_id, 'owner', 'admin')
      
      OR
      
      -- 3. MANAGER can read members belonging to their own department
      (
        has_org_role(organization_id, 'manager')
        AND
        department_id = (
          SELECT m.department_id 
          FROM public.organization_members m 
          WHERE m.organization_id = organization_members.organization_id 
            AND m.user_id = auth.uid() 
            AND m.status = 'active' 
          LIMIT 1
        )
      )
    )
  );
