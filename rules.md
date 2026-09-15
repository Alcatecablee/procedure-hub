# Procedure Hub Rules and Conventions

These rules apply to all work on the Procedure Hub codebase.

## Absolute Prohibitions

0. **MOST IMPORTANT RULE:** No guesswork or assumptions. Ever. If you do not know, stop and verify before touching any file. Every mistake in this codebase will trace back to this rule being broken.
1. **No generic tech language.** The app uses a strict "Editorial Ledger" brand voice ("Folio", "Article I", "The Record"). Never use terms like "enterprise-grade", "air-gapped", or "cryptographically invisible."
2. **Use precise architectural terms.**
   - Say **"write-path isolation"** NOT "air-gapped AI".
   - Say **"database-enforced authorization"** NOT "cryptographically invisible".
   - Say **"AI isolated from the production write path"** NOT "AI is air-gapped".
3. **No direct AI writes.** AI must never publish business rules or procedures directly. The sequence is always: AI proposes (Draft) → Human reviews/approves → System enforces and records (Active).
4. **No silent fallbacks or swallowed errors.** Every mutation must have an onError handler (e.g., oast.error(e.message)). Never fail silently.
5. **No missing organization scoping.** Every database read/write query MUST be isolated to the current tenant via .eq("organization_id", org.organization.id) or explicitly handled via secure RPC parameters.
6. **No feature creep.** The core promise is "AI proposes. Humans decide. The system enforces and records." Phases 1–3 are locked. Do not build new deferred features (Slack, Live Graph, SSO). Bug fixes, security patches, and gap remediation are allowed.

## Process Rules

1. **Research first, code second.** Before editing any file, read all files that will be affected.
2. **Verify after every change.** Check that the affected component renders and no new errors appear in the Vite console (run un run build).
3. **Minimal footprint.** Prefer editing existing files over creating new ones. Keep components strictly focused on single responsibilities.
4. **One concern at a time.** Do not add extra features while fixing a bug.

## Architecture & State Machine

- **Tech Stack:** TanStack Start (SSR), React Query, Supabase (Postgres + Auth + RLS), Bun, Tailwind CSS.
- **Auth Pattern:** All server functions (createServerFn) require the Supabase JWT. It MUST be passed exactly as headers: { authorization: "Bearer " + session.access_token } from the client. Without this, requests will fail.
- **Routing:** Route files must follow the strict TanStack Start convention (e.g., pp.procedures.$id.index.tsx instead of pp.procedures.$id.tsx to prevent swallowing child layouts like /edit).
- **Audit Logging:** The udit_logs table is insert-only from the application role. Never attempt to delete or update an audit log. Real-time logging relies on PostgreSQL RLS and trigger functions.
- **Role Hierarchy:** owner > admin > manager > member/staff. Visibility of Draft procedures is strictly enforced at the server tier-only admins/managers/owners can read drafts.

## Design Tokens & UX

- **Editorial Aesthetic:** The UI should feel like a formal journal or ledger. Use structured typography, distinct eyebrow text (e.g., "Folio 01 - Dashboard"), and clear hierarchical lines.
- **Typography Standards:** NO EM DASHES PERIOD!!!! Do not use em dashes anywhere in the codebase. Always use standard hyphens (`-`).
- **Destructive Actions:** Any action that discards data, rejects drafts, or changes active sessions MUST be preceded by a confirmation dialog (e.g., window.confirm).
