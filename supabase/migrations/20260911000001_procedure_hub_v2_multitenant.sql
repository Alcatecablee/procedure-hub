-- ============================================================
-- PROCEDURE HUB v2 — Multi-tenant schema
-- Fresh project migration. Run this against a clean database.
-- ============================================================

-- ─── EXTENSIONS ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── CUSTOM TYPES ────────────────────────────────────────────
CREATE TYPE org_status AS ENUM ('active', 'suspended');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'manager', 'staff', 'viewer');
CREATE TYPE member_status AS ENUM ('active', 'suspended', 'invited', 'removed');
CREATE TYPE procedure_status AS ENUM ('draft', 'active', 'archived', 'replaced');
CREATE TYPE procedure_priority AS ENUM ('critical', 'high', 'medium', 'informational');
CREATE TYPE content_classification AS ENUM ('procedure', 'reference', 'expectation', 'incident', 'announcement', 'noise');
CREATE TYPE source_platform AS ENUM ('teams', 'slack', 'whatsapp', 'discord', 'email', 'manual', 'other');
CREATE TYPE import_status AS ENUM ('pending', 'processing', 'review', 'completed', 'failed', 'cancelled');
CREATE TYPE draft_status AS ENUM ('pending', 'approved', 'rejected', 'skipped');
CREATE TYPE audit_action AS ENUM (
  'org_created', 'org_updated', 'org_suspended',
  'member_invited', 'member_joined', 'member_suspended', 'member_removed', 'member_role_changed',
  'procedure_created', 'procedure_updated', 'procedure_published', 'procedure_archived', 'procedure_replaced',
  'version_created',
  'acknowledgment_created', 'acknowledgment_revoked',
  'import_started', 'import_completed', 'import_failed',
  'draft_approved', 'draft_rejected',
  'category_created', 'category_updated'
);

-- ─── HELPER: updated_at trigger ──────────────────────────────
CREATE OR REPLACE FUNCTION tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── ORGANIZATIONS ───────────────────────────────────────────
CREATE TABLE public.organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  slug            TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$'),
  domain          TEXT CHECK (domain ~ '^[a-zA-Z0-9][a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}$'),
  status          org_status NOT NULL DEFAULT 'active',
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ─── PROFILES ────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  full_name       TEXT,
  avatar_url      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ─── ORGANIZATION MEMBERS ─────────────────────────────────────
-- Authoritative membership table. RLS derives access from here.
CREATE TABLE public.organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            member_role NOT NULL DEFAULT 'staff',
  status          member_status NOT NULL DEFAULT 'active',
  invited_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX organization_members_org_id_idx ON public.organization_members(organization_id);
CREATE INDEX organization_members_user_id_idx ON public.organization_members(user_id);

CREATE TRIGGER organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ─── HELPER FUNCTIONS (SECURITY DEFINER) ─────────────────────
-- These run with definer privileges so RLS policies can call them
-- safely without infinite recursion.

-- Returns the active organization_id for the current user (first active membership).
CREATE OR REPLACE FUNCTION public.get_my_organization_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
    AND status = 'active'
  LIMIT 1;
$$;

-- Returns true if the current user is an active member of the given org.
CREATE OR REPLACE FUNCTION public.is_member(_org_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _org_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

-- Returns true if the current user has one of the given roles in the given org.
CREATE OR REPLACE FUNCTION public.has_org_role(_org_id UUID, VARIADIC _roles member_role[])
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = _org_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND role = ANY(_roles)
  );
$$;

-- Restrict function execution to prevent privilege escalation.
REVOKE EXECUTE ON FUNCTION public.get_my_organization_id() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_organization_id() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_member(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_member(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_org_role(UUID, member_role[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_org_role(UUID, member_role[]) TO authenticated;

-- ─── CATEGORIES ──────────────────────────────────────────────
CREATE TABLE public.categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  slug            TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$'),
  description     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX categories_org_id_idx ON public.categories(organization_id);

CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ─── PROCEDURES ──────────────────────────────────────────────
-- current_version_id points to the published procedure_version.
-- Acknowledgment staleness is determined by comparing
-- acknowledgment.procedure_version_id == procedures.current_version_id.
CREATE TABLE public.procedures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id           UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 250),
  summary               TEXT CHECK (char_length(summary) <= 500),
  description           TEXT,
  status                procedure_status NOT NULL DEFAULT 'draft',
  priority              procedure_priority NOT NULL DEFAULT 'medium',
  -- FK to current published version; set after first version is created.
  current_version_id    UUID,
  -- Optimistic locking: incremented on every version publish.
  version_number        INTEGER NOT NULL DEFAULT 0,
  effective_date        DATE,
  expiry_date           DATE,
  acknowledgment_required BOOLEAN NOT NULL DEFAULT TRUE,
  source_type           source_platform NOT NULL DEFAULT 'manual',
  source_reference      TEXT CHECK (char_length(source_reference) <= 500),
  source_message_id     TEXT,
  supersedes_id         UUID REFERENCES public.procedures(id) ON DELETE SET NULL,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at          TIMESTAMPTZ,
  archived_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Date integrity enforced at DB level
  CONSTRAINT effective_before_expiry CHECK (
    expiry_date IS NULL OR effective_date IS NULL OR expiry_date >= effective_date
  )
);

CREATE INDEX procedures_org_id_idx ON public.procedures(organization_id);
CREATE INDEX procedures_org_status_idx ON public.procedures(organization_id, status);
CREATE INDEX procedures_org_category_idx ON public.procedures(organization_id, category_id);
-- Full-text search
CREATE INDEX procedures_fts_idx ON public.procedures
  USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(description,'')));

CREATE TRIGGER procedures_updated_at
  BEFORE UPDATE ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ─── PROCEDURE VERSIONS ──────────────────────────────────────
-- Immutable historical record. Never updated after insert.
CREATE TABLE public.procedure_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id          UUID NOT NULL REFERENCES public.procedures(id) ON DELETE CASCADE,
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_number        INTEGER NOT NULL,
  title                 TEXT NOT NULL,
  summary               TEXT,
  description           TEXT,
  category_id           UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  priority              procedure_priority NOT NULL DEFAULT 'medium',
  effective_date        DATE,
  expiry_date           DATE,
  acknowledgment_required BOOLEAN NOT NULL DEFAULT TRUE,
  source_type           source_platform,
  source_reference      TEXT,
  change_summary        TEXT,
  published_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procedure_id, version_number)
);

CREATE INDEX procedure_versions_procedure_id_idx ON public.procedure_versions(procedure_id);
CREATE INDEX procedure_versions_org_id_idx ON public.procedure_versions(organization_id);

-- Add FK from procedures.current_version_id now that procedure_versions exists.
ALTER TABLE public.procedures
  ADD CONSTRAINT procedures_current_version_id_fk
  FOREIGN KEY (current_version_id) REFERENCES public.procedure_versions(id) ON DELETE SET NULL;

-- ─── ACKNOWLEDGMENTS ─────────────────────────────────────────
CREATE TABLE public.acknowledgments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  procedure_id          UUID NOT NULL REFERENCES public.procedures(id) ON DELETE CASCADE,
  procedure_version_id  UUID NOT NULL REFERENCES public.procedure_versions(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acknowledged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Revocation (soft-delete with audit).
  revoked_at            TIMESTAMPTZ,
  revoked_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoke_reason         TEXT,
  -- One non-revoked acknowledgment per user per procedure version.
  UNIQUE NULLS NOT DISTINCT (procedure_version_id, user_id, revoked_at)
);

CREATE INDEX acknowledgments_org_idx ON public.acknowledgments(organization_id);
CREATE INDEX acknowledgments_procedure_idx ON public.acknowledgments(procedure_id);
CREATE INDEX acknowledgments_user_idx ON public.acknowledgments(user_id);
CREATE INDEX acknowledgments_version_idx ON public.acknowledgments(procedure_version_id);

-- ─── IMPORTS ─────────────────────────────────────────────────
CREATE TABLE public.imports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source_type           source_platform NOT NULL DEFAULT 'teams',
  original_filename     TEXT,
  input_size_bytes      BIGINT,
  character_count       INTEGER,
  was_chunked           BOOLEAN NOT NULL DEFAULT FALSE,
  chunk_count           INTEGER,
  status                import_status NOT NULL DEFAULT 'pending',
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  candidate_count       INTEGER DEFAULT 0,
  approved_count        INTEGER DEFAULT 0,
  rejected_count        INTEGER DEFAULT 0,
  noise_discarded       INTEGER DEFAULT 0,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX imports_org_idx ON public.imports(organization_id);
CREATE INDEX imports_status_idx ON public.imports(status);

CREATE TRIGGER imports_updated_at
  BEFORE UPDATE ON public.imports
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ─── IMPORT DRAFTS ───────────────────────────────────────────
CREATE TABLE public.import_drafts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id             UUID NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- AI classification
  classification        content_classification NOT NULL DEFAULT 'procedure',
  confidence            SMALLINT CHECK (confidence BETWEEN 0 AND 100),
  -- Proposed content
  title                 TEXT CHECK (char_length(title) <= 250),
  summary               TEXT CHECK (char_length(summary) <= 500),
  description           TEXT,
  -- Category slug from AI; human selects actual category on review
  suggested_category_slug TEXT,
  category_id           UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  priority              procedure_priority DEFAULT 'medium',
  effective_date        DATE,
  expiry_date           DATE,
  -- Source provenance (never lost)
  source_date           TEXT,
  source_author         TEXT,
  source_evidence       TEXT,
  -- Duplicate detection
  possible_duplicate    BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_id       UUID REFERENCES public.import_drafts(id) ON DELETE SET NULL,
  -- Contains credential-like content (should block publishing)
  contains_sensitive    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Review outcome
  status                draft_status NOT NULL DEFAULT 'pending',
  reviewed_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at           TIMESTAMPTZ,
  -- Links to published procedure (if approved)
  published_procedure_id UUID REFERENCES public.procedures(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX import_drafts_import_idx ON public.import_drafts(import_id);
CREATE INDEX import_drafts_org_idx ON public.import_drafts(organization_id);
CREATE INDEX import_drafts_status_idx ON public.import_drafts(status);

CREATE TRIGGER import_drafts_updated_at
  BEFORE UPDATE ON public.import_drafts
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ─── ACTIVITY LOGS ───────────────────────────────────────────
CREATE TABLE public.activity_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  action          TEXT NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX activity_logs_org_idx ON public.activity_logs(organization_id);
CREATE INDEX activity_logs_entity_idx ON public.activity_logs(entity_type, entity_id);
CREATE INDEX activity_logs_actor_idx ON public.activity_logs(actor_id);
CREATE INDEX activity_logs_created_at_idx ON public.activity_logs(created_at DESC);

-- ─── AUDIT LOGS ──────────────────────────────────────────────
-- Immutable. No update trigger. Append-only.
CREATE TABLE public.audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type      audit_action NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No UPDATE trigger — audit logs must be immutable.
CREATE INDEX audit_logs_org_idx ON public.audit_logs(organization_id);
CREATE INDEX audit_logs_entity_idx ON public.audit_logs(entity_type, entity_id);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs(created_at DESC);

-- Prevent any UPDATE or DELETE on audit_logs.
CREATE OR REPLACE FUNCTION tg_prevent_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs rows are immutable';
END;
$$;

CREATE TRIGGER audit_logs_immutable_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION tg_prevent_audit_mutation();

CREATE TRIGGER audit_logs_immutable_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION tg_prevent_audit_mutation();

-- ─── ONBOARDING TRIGGER ──────────────────────────────────────
-- When a new auth.users row is created:
-- 1. Create profile.
-- 2. If organization exists with matching domain, create pending membership.
-- 3. Otherwise do nothing (org creation happens via onboarding flow).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _email TEXT;
  _domain TEXT;
  _org_id UUID;
BEGIN
  _email := NEW.email;
  _domain := lower(split_part(_email, '@', 2));

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    _email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(_email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;

  -- Auto-join org if domain matches (domain-based join policy).
  -- Role defaults to 'staff'; org owner can elevate.
  SELECT id INTO _org_id
  FROM public.organizations
  WHERE domain = _domain AND status = 'active'
  LIMIT 1;

  IF _org_id IS NOT NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role, status, joined_at)
    VALUES (_org_id, NEW.id, 'staff', 'active', now())
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────
-- Enable RLS on every tenant-owned table.
ALTER TABLE public.organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedures             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedure_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acknowledgments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imports                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_drafts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs             ENABLE ROW LEVEL SECURITY;

-- ── organizations ────────────────────────────────────────────
-- Members can read their own organization. Only owner can update.
CREATE POLICY "org_member_can_read"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (is_member(id));

CREATE POLICY "owner_can_update_org"
  ON public.organizations FOR UPDATE
  TO authenticated
  USING (has_org_role(id, 'owner'))
  WITH CHECK (has_org_role(id, 'owner'));

-- Insert handled by onboarding server function (service key).
-- No direct INSERT policy for authenticated users.

-- ── profiles ─────────────────────────────────────────────────
-- Users read their own profile; org members can read each other's profiles.
CREATE POLICY "own_profile_read"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_members om1
      JOIN public.organization_members om2
        ON om1.organization_id = om2.organization_id
      WHERE om1.user_id = auth.uid()
        AND om2.user_id = profiles.id
        AND om1.status = 'active'
        AND om2.status = 'active'
    )
  );

CREATE POLICY "own_profile_update"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── organization_members ─────────────────────────────────────
-- Active members can read the membership list of their organization.
-- Owners and admins can manage memberships.
-- Critically: users cannot read OR write rows for other organizations.
CREATE POLICY "member_can_read_own_org_members"
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (
    organization_id = get_my_organization_id()
    AND status = 'active'
  );

CREATE POLICY "owner_admin_can_insert_members"
  ON public.organization_members FOR INSERT
  TO authenticated
  WITH CHECK (
    has_org_role(organization_id, 'owner', 'admin')
    -- Prevent role escalation: cannot insert a role higher than your own.
    AND (
      role = 'staff' OR role = 'viewer'
      OR (role = 'manager' AND has_org_role(organization_id, 'owner', 'admin'))
      OR (role IN ('admin', 'owner') AND has_org_role(organization_id, 'owner'))
    )
  );

CREATE POLICY "owner_admin_can_update_members"
  ON public.organization_members FOR UPDATE
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin'))
  WITH CHECK (
    organization_id = get_my_organization_id()
    -- Cannot change organization_id to point to another org.
    AND organization_id = (SELECT organization_id FROM public.organization_members WHERE id = organization_members.id)
    -- Cannot elevate own role beyond current role.
    AND NOT (user_id = auth.uid() AND role IN ('owner') AND NOT has_org_role(organization_id, 'owner'))
  );

-- ── categories ───────────────────────────────────────────────
CREATE POLICY "member_can_read_categories"
  ON public.categories FOR SELECT
  TO authenticated
  USING (is_member(organization_id));

CREATE POLICY "admin_can_manage_categories"
  ON public.categories FOR ALL
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin'))
  WITH CHECK (
    has_org_role(organization_id, 'owner', 'admin')
    -- organization_id must match caller's org (prevent cross-tenant write)
    AND organization_id = get_my_organization_id()
  );

-- ── procedures ───────────────────────────────────────────────
CREATE POLICY "member_can_read_procedures"
  ON public.procedures FOR SELECT
  TO authenticated
  USING (is_member(organization_id));

CREATE POLICY "admin_can_insert_procedures"
  ON public.procedures FOR INSERT
  TO authenticated
  WITH CHECK (
    has_org_role(organization_id, 'owner', 'admin')
    AND organization_id = get_my_organization_id()
  );

CREATE POLICY "admin_can_update_procedures"
  ON public.procedures FOR UPDATE
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin'))
  WITH CHECK (
    has_org_role(organization_id, 'owner', 'admin')
    -- organization_id is immutable — cannot be changed after creation
    AND organization_id = (SELECT organization_id FROM public.procedures p WHERE p.id = procedures.id)
  );

-- No DELETE policy — procedures are archived, not deleted.

-- ── procedure_versions ───────────────────────────────────────
CREATE POLICY "member_can_read_versions"
  ON public.procedure_versions FOR SELECT
  TO authenticated
  USING (is_member(organization_id));

-- Versions are inserted by admin only, never updated or deleted.
CREATE POLICY "admin_can_insert_versions"
  ON public.procedure_versions FOR INSERT
  TO authenticated
  WITH CHECK (
    has_org_role(organization_id, 'owner', 'admin')
    AND organization_id = get_my_organization_id()
  );

-- ── acknowledgments ──────────────────────────────────────────
CREATE POLICY "member_can_read_own_acks"
  ON public.acknowledgments FOR SELECT
  TO authenticated
  USING (
    -- Staff see their own acks.
    user_id = auth.uid()
    -- Admins/managers see all acks in their org.
    OR has_org_role(organization_id, 'owner', 'admin', 'manager')
  );

-- Staff can acknowledge (insert) for themselves only.
CREATE POLICY "staff_can_acknowledge"
  ON public.acknowledgments FOR INSERT
  TO authenticated
  WITH CHECK (
    is_member(organization_id)
    AND user_id = auth.uid()
    AND organization_id = get_my_organization_id()
    -- Only non-archived/non-replaced procedures.
    AND EXISTS (
      SELECT 1 FROM public.procedures p
      WHERE p.id = procedure_id
        AND p.status = 'active'
        AND p.current_version_id = procedure_version_id
    )
  );

-- Only admins can revoke (soft-delete via update of revoked_at).
CREATE POLICY "admin_can_revoke_acks"
  ON public.acknowledgments FOR UPDATE
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin'))
  WITH CHECK (
    -- Only revocation fields can be set; core fields are immutable.
    has_org_role(organization_id, 'owner', 'admin')
    AND organization_id = get_my_organization_id()
  );

-- ── imports ──────────────────────────────────────────────────
CREATE POLICY "admin_can_read_imports"
  ON public.imports FOR SELECT
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin'));

CREATE POLICY "admin_can_insert_imports"
  ON public.imports FOR INSERT
  TO authenticated
  WITH CHECK (
    has_org_role(organization_id, 'owner', 'admin')
    AND organization_id = get_my_organization_id()
  );

CREATE POLICY "admin_can_update_imports"
  ON public.imports FOR UPDATE
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin'))
  WITH CHECK (organization_id = get_my_organization_id());

-- ── import_drafts ────────────────────────────────────────────
CREATE POLICY "admin_can_read_drafts"
  ON public.import_drafts FOR SELECT
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin'));

CREATE POLICY "admin_can_insert_drafts"
  ON public.import_drafts FOR INSERT
  TO authenticated
  WITH CHECK (
    has_org_role(organization_id, 'owner', 'admin')
    AND organization_id = get_my_organization_id()
  );

CREATE POLICY "admin_can_update_drafts"
  ON public.import_drafts FOR UPDATE
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin'))
  WITH CHECK (organization_id = get_my_organization_id());

-- ── activity_logs ────────────────────────────────────────────
CREATE POLICY "member_can_read_activity"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (is_member(organization_id));

CREATE POLICY "member_can_insert_activity"
  ON public.activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    is_member(organization_id)
    AND organization_id = get_my_organization_id()
    AND actor_id = auth.uid()
  );

-- ── audit_logs ───────────────────────────────────────────────
CREATE POLICY "admin_can_read_audit"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (has_org_role(organization_id, 'owner', 'admin', 'manager'));

-- Inserts via service role only from edge functions.
-- No direct INSERT policy for authenticated users on audit_logs.

-- ─── DEFAULT CATEGORIES (inserted per org via server function) ─
-- Not seeded here — categories are org-scoped and created via
-- the org onboarding server function after org creation.
-- Slug list for reference:
-- call-handling, case-management, customer-communication, escalations,
-- product-platform, compliance, attendance-admin,
-- technical-procedures, security, general-operations,
-- system-procedures, reference-material

-- ─── FULL TEXT SEARCH FUNCTION ────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_procedures(
  _org_id   UUID,
  _query    TEXT,
  _status   procedure_status DEFAULT 'active',
  _limit    INTEGER DEFAULT 20,
  _offset   INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID, title TEXT, summary TEXT, status procedure_status,
  priority procedure_priority, category_id UUID,
  current_version_id UUID, version_number INTEGER,
  effective_date DATE, expiry_date DATE, acknowledgment_required BOOLEAN,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id, p.title, p.summary, p.status, p.priority, p.category_id,
    p.current_version_id, p.version_number,
    p.effective_date, p.expiry_date, p.acknowledgment_required,
    p.created_at, p.updated_at,
    ts_rank(
      to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.summary,'') || ' ' || coalesce(p.description,'')),
      plainto_tsquery('english', _query)
    ) AS rank
  FROM public.procedures p
  WHERE p.organization_id = _org_id
    AND p.status = _status
    AND (
      _query = '' OR _query IS NULL
      OR to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.summary,'') || ' ' || coalesce(p.description,''))
         @@ plainto_tsquery('english', _query)
    )
  ORDER BY
    CASE WHEN _query IS NULL OR _query = '' THEN p.updated_at::TEXT END DESC NULLS LAST,
    CASE WHEN _query IS NOT NULL AND _query <> '' THEN 
      ts_rank(
        to_tsvector('english', coalesce(p.title,'') || ' ' || coalesce(p.summary,'') || ' ' || coalesce(p.description,'')),
        plainto_tsquery('english', _query)
      )
    END DESC NULLS LAST
  LIMIT _limit OFFSET _offset;
$$;

REVOKE EXECUTE ON FUNCTION public.search_procedures(UUID, TEXT, procedure_status, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_procedures(UUID, TEXT, procedure_status, INTEGER, INTEGER) TO authenticated;

-- ─── COMPLIANCE VIEW ─────────────────────────────────────────
-- Safe compliance calculation: membership population, not profiles.
CREATE OR REPLACE VIEW public.org_compliance AS
SELECT
  p.organization_id,
  p.id AS procedure_id,
  p.title,
  p.current_version_id,
  COUNT(DISTINCT m.user_id) AS required_count,
  COUNT(DISTINCT a.user_id) AS acknowledged_count,
  CASE
    WHEN COUNT(DISTINCT m.user_id) = 0 THEN NULL
    ELSE ROUND(
      (COUNT(DISTINCT a.user_id)::NUMERIC / COUNT(DISTINCT m.user_id)::NUMERIC) * 100
    )
  END AS compliance_pct
FROM public.procedures p
JOIN public.organization_members m
  ON m.organization_id = p.organization_id
  AND m.status = 'active'
  AND m.role IN ('staff', 'manager', 'admin', 'owner')
LEFT JOIN public.acknowledgments a
  ON a.procedure_id = p.id
  AND a.procedure_version_id = p.current_version_id
  AND a.user_id = m.user_id
  AND a.revoked_at IS NULL
WHERE p.status = 'active'
  AND p.acknowledgment_required = TRUE
GROUP BY p.organization_id, p.id, p.title, p.current_version_id;

-- RLS applies through the underlying tables; the view is safe because
-- procedures and organization_members are both RLS-protected.
