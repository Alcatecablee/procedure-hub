import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { OrgOnboarding } from "@/components/org-onboarding";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading, unauthenticated, needsOnboarding } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Only redirect once loading is fully resolved.
    if (!loading && unauthenticated) {
      void navigate({ to: "/login" });
    }
  }, [loading, unauthenticated, navigate]);

  // Phase 1: loading (session + membership + role all resolving)
  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          Consulting the record...
        </div>
      </div>
    );
  }

  // Phase 2: unauthenticated - useEffect will redirect, show nothing
  if (unauthenticated || !user) {
    return null;
  }

  // Phase 3: authenticated but no organization - show onboarding
  if (needsOnboarding) {
    return <OrgOnboarding />;
  }

  // Phase 4: fully resolved - render app
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
