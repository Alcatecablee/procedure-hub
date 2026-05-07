import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

const links = [
  { to: "/app", label: "Dashboard", num: "01" },
  { to: "/app/procedures", label: "Procedures", num: "02" },
  { to: "/app/acknowledgments", label: "Acknowledgments", num: "03" },
] as const;

const adminLinks = [
  { to: "/app/import", label: "Import", num: "04" },
  { to: "/app/analytics", label: "Analytics", num: "05" },
  { to: "/app/settings", label: "Settings", num: "06" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, role, signOut } = useAuth();
  const path = useRouterState({ select: (r) => r.location.pathname });

  const isActive = (to: string) =>
    to === "/app" ? path === "/app" : path.startsWith(to);

  return (
    <div className="min-h-screen flex w-full bg-background paper-grain">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="px-6 py-6 border-b border-sidebar-border">
          <Link to="/app" className="block">
            <div className="eyebrow mb-1.5">Vol. I — Operations</div>
            <div className="font-display text-2xl leading-none text-sidebar-foreground">
              Procedure
              <span className="block italic font-normal">Hub</span>
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
                    className={`group flex items-baseline gap-3 px-3 py-1.5 text-sm rounded-sm transition-colors ${
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

          {role === "admin" && (
            <div>
              <div className="eyebrow px-3 mb-2">Section II — Admin</div>
              <ul className="space-y-px">
                {adminLinks.map((l) => (
                  <li key={l.to}>
                    <Link
                      to={l.to}
                      className={`group flex items-baseline gap-3 px-3 py-1.5 text-sm rounded-sm transition-colors ${
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

        <div className="border-t border-sidebar-border px-4 py-4">
          <div className="eyebrow mb-1">Signed in</div>
          <div className="text-sm truncate text-sidebar-foreground">{user?.email}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-0.5">
            {role ?? "—"}
          </div>
          <button
            onClick={() => void signOut()}
            className="mt-3 w-full text-left text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out →
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="md:hidden border-b border-border px-4 py-3 flex items-center justify-between">
          <Link to="/app" className="font-display text-lg">Procedure Hub</Link>
          <button
            onClick={() => void signOut()}
            className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground"
          >
            Sign out
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}
