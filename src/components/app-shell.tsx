import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth, useIsAdmin, useIsManager } from "@/lib/auth";

const links = [
  { to: "/app", label: "Dashboard", num: "01" },
  { to: "/app/procedures", label: "Procedures", num: "02" },
  { to: "/app/acknowledgments", label: "Acknowledgments", num: "03" },
] as const;

const managerLinks = [
  { to: "/app/import", label: "Import", num: "04" },
  { to: "/app/department", label: "My Department", num: "05" },
  { to: "/app/compliance", label: "Compliance", num: "06" },
] as const;

const adminLinks = [
  { to: "/app/import", label: "Import", num: "04" },
  { to: "/app/team", label: "Team", num: "05" },
  { to: "/app/settings", label: "Settings", num: "06" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, org, signOut } = useAuth();
  const isAdmin = useIsAdmin();
  const isManager = useIsManager();
  const path = useRouterState({ select: (r) => r.location.pathname });

  const isActive = (to: string) =>
    to === "/app" ? path === "/app" || path === "/app/" : path.startsWith(to);

  return (
    <div className="min-h-screen flex w-full bg-background paper-grain">
      <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-border bg-sidebar h-screen sticky top-0">
        <div className="px-6 py-8 pb-4">
          <Link to="/app" className="block">
            <div className="eyebrow mb-1.5 truncate" title={org?.organization.name}>
              {org?.organization.name ?? "Procedure Hub"}
            </div>
            <div className="font-display text-2xl leading-none text-sidebar-foreground">
              Operations
              <span className="block italic font-normal">Record</span>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-6 overflow-y-auto">
          <div>
            <div className="eyebrow px-3 mb-2">Section I</div>
            <ul className="space-y-px">
              {links.map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    className={`group flex items-baseline gap-3 px-3 py-2 text-[15px] rounded-md transition-all duration-200 ${
                      isActive(l.to)
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                    }`}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">{l.num}</span>
                    <span>{l.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {isManager && (
            <div>
              <div className="eyebrow px-3 mb-2 mt-6">Section II - Management</div>
              <ul className="space-y-px">
                {managerLinks.map((l) => (
                  <li key={l.to}>
                    <Link
                      to={l.to}
                      className={`group flex items-baseline gap-3 px-3 py-2 text-[15px] rounded-md transition-all duration-200 ${
                        isActive(l.to)
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                      }`}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">{l.num}</span>
                      <span>{l.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isAdmin && (
            <div>
              <div className="eyebrow px-3 mb-2 mt-6">Section III - Admin</div>
              <ul className="space-y-px">
                {adminLinks.map((l) => (
                  <li key={l.to}>
                    <Link
                      to={l.to}
                      className={`group flex items-baseline gap-3 px-3 py-2 text-[15px] rounded-md transition-all duration-200 ${
                        isActive(l.to)
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                      }`}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">{l.num}</span>
                      <span>{l.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>

        <div className="px-6 py-6 shrink-0">
          <div className="eyebrow mb-1">Signed in</div>
          <div className="text-sm truncate text-sidebar-foreground">{user?.email}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-0.5">
            {org?.role ?? "-"}
          </div>
          <button
            onClick={() => {
              if (window.confirm("Are you sure you want to sign out?")) {
                void signOut();
              }
            }}
            className="mt-3 w-full text-left text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out â†’
          </button>
        </div>
      </aside>

      <main id="main-content" className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden border-b border-border px-4 py-3 flex items-center justify-between shrink-0 bg-background z-10">
          <Link to="/app" className="font-display text-lg truncate">
            {org?.organization.name ?? "Procedure Hub"}
          </Link>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (window.confirm("Are you sure you want to sign out?")) {
                  void signOut();
                }
              }}
              className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto relative">{children}</div>
      </main>
    </div>
  );
}
