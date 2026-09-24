-- View: procedure_member_compliance
-- Provides the authoritative compliance state for every required (Procedure x Member) combination.

DROP VIEW IF EXISTS public.procedure_member_compliance CASCADE;

CREATE VIEW public.procedure_member_compliance WITH (security_invoker = true) AS
SELECT 
  p.organization_id,
  p.id AS procedure_id,
  p.title AS procedure_title,
  p.current_version_id,
  p.version_number AS current_version_number,
  p.department_id AS procedure_department_id,
  m.user_id,
  m.department_id AS member_department_id,
  -- Find the most recent non-revoked acknowledgment for this specific procedure and user
  (
    SELECT a.procedure_version_id 
    FROM public.acknowledgments a 
    WHERE a.procedure_id = p.id 
      AND a.user_id = m.user_id 
      AND a.revoked_at IS NULL 
    ORDER BY a.acknowledged_at DESC 
    LIMIT 1
  ) AS latest_ack_version_id,
  (
    SELECT a.acknowledged_at 
    FROM public.acknowledgments a 
    WHERE a.procedure_id = p.id 
      AND a.user_id = m.user_id 
      AND a.revoked_at IS NULL 
    ORDER BY a.acknowledged_at DESC 
    LIMIT 1
  ) AS latest_ack_date,
  -- Calculate authoritative status
  CASE 
    -- 1. Has acknowledged the current version
    WHEN (
      SELECT 1 FROM public.acknowledgments a 
      WHERE a.procedure_id = p.id 
        AND a.user_id = m.user_id 
        AND a.procedure_version_id = p.current_version_id 
        AND a.revoked_at IS NULL 
      LIMIT 1
    ) IS NOT NULL THEN 'ACKNOWLEDGED'
    
    -- 2. Has acknowledged SOME previous version, but not the current one
    WHEN (
      SELECT 1 FROM public.acknowledgments a 
      WHERE a.procedure_id = p.id 
        AND a.user_id = m.user_id 
        AND a.revoked_at IS NULL 
      LIMIT 1
    ) IS NOT NULL THEN 'REQUIRES_REACK'
    
    -- 3. Has never acknowledged (or all acks revoked)
    ELSE 'OUTSTANDING'
  END AS compliance_status
FROM public.procedures p
JOIN public.organization_members m 
  ON p.organization_id = m.organization_id 
  AND m.status = 'active'
WHERE p.status = 'active' 
  AND p.acknowledgment_required = TRUE
  AND p.current_version_id IS NOT NULL
  -- Assignment Model: If procedure has a department, only members of that dept are required.
  -- If procedure is global (no dept), all active members are required.
  AND (p.department_id IS NULL OR p.department_id = m.department_id);

-- Secure the view by wrapping it in RLS? 
-- Views do not inherently have RLS unless they are security invoker.
-- In Postgres 15+, we can use SECURITY INVOKER views.
-- However, Supabase runs Postgres 15. We can just set security_invoker = true.
-- But wait, this view joins tables that already have RLS. If it's a standard view (invoker by default in 15+? No, views are invoker by default in PG except for materialized views? Wait, PG 15 added `security_invoker=true` for views, default is definer? No, default is invoker since forever, but row level security on the UNDERLYING tables applies to the invoking user!).
-- YES, if a user queries `procedure_member_compliance`, they will only see procedures and members they are allowed to see via RLS on `procedures` and `organization_members`.
