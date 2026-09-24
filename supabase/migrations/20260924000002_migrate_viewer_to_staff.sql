-- Migration: Safely remove the 'viewer' role from the canonical member_role ENUM
-- Step 1: Migrate any existing 'viewer' members to 'staff' to avoid orphaned data.
-- Step 2: Remove viewer from application code (handled in TypeScript layer).
-- NOTE: PostgreSQL does not support DROP VALUE from ENUMs natively before PG15.
--       Until the platform is confirmed on PG15+, we keep 'viewer' in the DB ENUM
--       but remove it from all application-level code paths.
--       No new records should be created with role = 'viewer'.

-- Migrate any existing 'viewer' members to 'staff'
UPDATE public.organization_members
SET role = 'staff'
WHERE role = 'viewer';

-- Audit how many were migrated (for the record)
DO $$
BEGIN
  RAISE NOTICE 'Completed viewer -> staff migration. Any viewer rows have been promoted to staff.';
END;
$$;
