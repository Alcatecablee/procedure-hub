# Goal: Manual Invites & Team Management UI

Implement the Manual Invites and Team Management UI for Procedure Hub without reopening the locked Phase 1-3 architecture. This focuses on building the necessary server-side authorization and frontend interfaces for Owners and Admins to invite users, manage roles, and track invitations.

## User Review Required

- I will use the existing organization_members table as the source of truth for invitations (using status = 'invited').
- I will leverage Supabase's uth.admin.inviteUserByEmail which automatically creates the user record and sends an invite email.
- Are we good to proceed with modifying the OrgOnboarding screen to also show pending invitations to newly signed-in users so they can accept them?

## Proposed Changes

### 1. Server Functions: src/lib/team.server.ts

[NEW] src/lib/team.server.ts
Create a new server-tier module to handle all team operations using the Service Role Key for elevated queries, while strictly enforcing authorization via the caller's JWT:

- getTeamMembers(): Returns active members for the caller's org.
- getPendingInvitations(): Returns invited members.
- createInvitation({ email, role }): Invites a user via uth.admin.inviteUserByEmail, creates the organization_members row, and logs an udit_logs event.
- esendInvitation({ memberId }): Re-triggers the Supabase invite email.
- cancelInvitation({ memberId }): Sets member status to
  emoved or deletes the pending row, preventing acceptance.
- updateMemberRole({ memberId, role }): Updates role with strict checks preventing the demotion of the final owner.
- emoveMember({ memberId }): Sets member status to
  emoved to preserve audit history while revoking access.
- cceptInvitation({ memberId }): Allows an authenticated user to accept an invite, setting their status to ctive.

### 2. Team Management UI

[NEW] src/routes/app.settings.team.tsx

- Build a new route under the existing Settings layout.
- Restrict visibility to owner and dmin roles.
- **Header**: "Folio 05 - Team Management"
- **Members List**: Table showing active members, their roles, and actions to change roles or remove them.
- **Invitations List**: Table showing pending invites, expiry, and actions to resend or cancel.
- **Invite Modal**: A dialog to enter an email address and select a role (preventing owner selection).

### 3. Invitation Acceptance / Onboarding

[MODIFY] src/components/org-onboarding.tsx

- Modify the onboarding screen to fetch pending invitations for the authenticated user.
- If the user has pending invitations, display an "Invitations" section above the "Create Workspace" form, allowing them to click "Accept" to join an existing organization.

### 4. Route Security & Sidebar

[MODIFY] src/components/app-shell.tsx

- Add a "Team" link in the sidebar that is only visible to owner and dmin users.

## Verification Plan

### Automated Tests

I will add tests to verify the server-side isolation:

- un scripts/test_team.ts: New script to verify that STAFF cannot create invitations, cross-tenant role changes are blocked, and final OWNER demotion fails.

### Manual Verification

- Sign in as Owner.
- Navigate to Settings -> Team.
- Invite a test email address as STAFF.
- Open an incognito window, sign up with that test email.
- Verify the Onboarding screen shows the pending invite.
- Accept the invite, verify access as STAFF.
- Verify STAFF cannot access the Team management page.
- Owner removes the STAFF member, verify access is revoked.
