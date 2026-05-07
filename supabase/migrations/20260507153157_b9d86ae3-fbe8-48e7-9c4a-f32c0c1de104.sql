
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');
CREATE TYPE public.procedure_priority AS ENUM ('critical', 'high', 'medium', 'informational');
CREATE TYPE public.procedure_status AS ENUM ('active', 'archived', 'replaced', 'draft');
CREATE TYPE public.source_platform AS ENUM ('teams', 'slack', 'whatsapp', 'discord', 'email', 'manual', 'other');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles (separate table; never on profiles)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer role check
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Categories
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Procedures
CREATE TABLE public.procedures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  priority procedure_priority NOT NULL DEFAULT 'medium',
  status procedure_status NOT NULL DEFAULT 'draft',
  source_platform source_platform NOT NULL DEFAULT 'manual',
  source_reference TEXT,
  effective_date DATE,
  expiry_date DATE,
  version INT NOT NULL DEFAULT 1,
  supersedes_id UUID REFERENCES public.procedures(id) ON DELETE SET NULL,
  acknowledgment_required BOOLEAN NOT NULL DEFAULT FALSE,
  effective_immediately BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_procedures_status ON public.procedures(status);
CREATE INDEX idx_procedures_category ON public.procedures(category_id);
CREATE INDEX idx_procedures_priority ON public.procedures(priority);
CREATE INDEX idx_procedures_search ON public.procedures USING gin (to_tsvector('english', title || ' ' || description));

-- Versions
CREATE TABLE public.procedure_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id UUID NOT NULL REFERENCES public.procedures(id) ON DELETE CASCADE,
  version INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority procedure_priority NOT NULL,
  status procedure_status NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  change_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.procedure_versions ENABLE ROW LEVEL SECURITY;

-- Acknowledgments
CREATE TABLE public.acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id UUID NOT NULL REFERENCES public.procedures(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  procedure_version INT NOT NULL DEFAULT 1,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(procedure_id, user_id, procedure_version)
);
ALTER TABLE public.acknowledgments ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ack_user ON public.acknowledgments(user_id);
CREATE INDEX idx_ack_procedure ON public.acknowledgments(procedure_id);

-- Activity logs
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_activity_created ON public.activity_logs(created_at DESC);

-- Imports
CREATE TABLE public.imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source_platform source_platform NOT NULL DEFAULT 'manual',
  raw_text TEXT NOT NULL,
  extracted_drafts JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER set_updated_at_profiles BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER set_updated_at_procedures BEFORE UPDATE ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-create profile + role on signup; first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE user_count INT;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)));

  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'staff');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ====== RLS POLICIES ======

-- profiles
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admins view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- user_roles
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- categories
CREATE POLICY "Authenticated view categories" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage categories" ON public.categories FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- procedures
CREATE POLICY "Authenticated view non-draft procedures" ON public.procedures FOR SELECT TO authenticated USING (status <> 'draft' OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage procedures" ON public.procedures FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- procedure_versions
CREATE POLICY "Authenticated view versions" ON public.procedure_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins write versions" ON public.procedure_versions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- acknowledgments
CREATE POLICY "Users view own acks" ON public.acknowledgments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins view all acks" ON public.acknowledgments FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users create own acks" ON public.acknowledgments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- activity_logs
CREATE POLICY "Admins view activity" ON public.activity_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated write activity" ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id);

-- imports
CREATE POLICY "Admins manage imports" ON public.imports FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed categories
INSERT INTO public.categories (name, slug, sort_order) VALUES
  ('Call Handling', 'call-handling', 1),
  ('Omni Channel', 'omni-channel', 2),
  ('Escalations', 'escalations', 3),
  ('Customer Commitments', 'customer-commitments', 4),
  ('Remote Support', 'remote-support', 5),
  ('Communication Standards', 'communication-standards', 6),
  ('Onsite Dispatch', 'onsite-dispatch', 7),
  ('Database Restrictions', 'database-restrictions', 8),
  ('Attendance & Accountability', 'attendance-accountability', 9),
  ('Training', 'training', 10),
  ('Security', 'security', 11),
  ('Operations', 'operations', 12);
