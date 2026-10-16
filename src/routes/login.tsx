import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import operationsLedgerImg from "@/assets/operations-ledger.jpg";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { mode?: Mode } => ({
    mode: (["signin", "signup", "reset", "update-password"].includes(search.mode as string)
      ? search.mode
      : undefined) as Mode | undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in - Procedure Hub" },
      { name: "description", content: "Sign in to your Procedure Hub workspace." },
    ],
  }),
  component: LoginPage,
});

type Mode = "signin" | "signup" | "reset" | "update-password";

function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [mode, setMode] = useState<Mode>(search.mode || "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setMode("update-password");
      }
    });

    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash.includes("type=recovery") || hash.includes("type=invite")) {
        setMode("update-password");
      }
    }

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!loading && user && mode !== "update-password") {
      void navigate({ to: "/app" });
    }
  }, [user, loading, navigate, mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "update-password") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Password updated successfully.");
        void navigate({ to: "/app" });
        return;
      }

      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login?mode=update-password`,
        });
        if (error) throw error;
        setResetSent(true);
        return;
      }

      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/app`,
            data: { full_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Account created - check your email to confirm.");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      void navigate({ to: "/app" });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials")) {
        toast.error("Incorrect email or password.");
      } else if (msg.includes("Email not confirmed") || msg.includes("email_not_confirmed")) {
        toast.error("Please confirm your email before signing in.");
      } else if (
        msg.includes("User already registered") ||
        msg.includes("already been registered")
      ) {
        toast.error("An account with this email already exists. Sign in instead.");
        setMode("signin");
      } else if (
        msg.includes("email rate limit") ||
        msg.includes("over_email_send_rate_limit") ||
        msg.includes("For security purposes")
      ) {
        toast.error("Too many attempts. Please wait a moment and try again.");
      } else if (msg.includes("Password should be")) {
        toast.error("Password must be at least 8 characters.");
      } else if (msg.includes("signup_disabled")) {
        toast.error("Sign-ups are currently disabled. Contact your administrator.");
      } else {
        const isDev = import.meta.env.DEV;
        toast.error(isDev ? `Error: ${msg}` : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background paper-grain grid lg:grid-cols-12">
      {/* Left Column: Established Enterprise Masthead & Operational Showcase */}
      <div className="hidden lg:flex lg:col-span-7 flex-col justify-between border-r border-border p-10 xl:p-14 bg-surface/70">
        {/* Brand Bar */}
        <div className="flex items-center justify-between pb-6 border-b border-border">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="h-6 w-6 bg-primary rounded-sm flex items-center justify-center text-primary-foreground font-mono text-xs font-bold tracking-tight">
              P
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
              Procedure Hub
            </span>
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Operational System of Record
          </span>
        </div>

        {/* Center Editorial Showcase */}
        <div className="my-auto py-8 max-w-xl">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-3">
            Standard Work &amp; Compliance
          </div>
          <h1 className="font-display text-3xl xl:text-4xl leading-[1.18] tracking-tight text-foreground mb-4">
            From scattered conversations
            <span className="block italic font-normal text-ink-soft">
              to accountable operations.
            </span>
          </h1>

          <p className="text-sm leading-relaxed text-ink-soft mb-8">
            Procedure Hub captures operational policies and standard procedures from frontline
            communications, subjects them to mandatory human review, and maintains a verifiable,
            tamper-evident audit trail of employee acknowledgments.
          </p>

          {/* Editorial Operations Illustration */}
          <div className="border border-border bg-card p-2.5 shadow-xs rounded-lg mb-8">
            <div className="aspect-[16/10] overflow-hidden bg-muted/20 border border-border/60 rounded-md">
              <img
                src={operationsLedgerImg}
                alt="Operations and frontline procedure execution floor"
                className="w-full h-full object-cover object-[center_35%]"
                loading="eager"
              />
            </div>
            <div className="mt-2.5 px-1 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
              <span>Frontline Operations Floor</span>
              <span>Continuous Compliance</span>
            </div>
          </div>

          {/* Institutional Safeguards */}
          <div className="grid grid-cols-3 gap-6 pt-6 border-t border-border">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                Governance
              </div>
              <div className="text-xs font-semibold text-foreground">
                Human-in-the-Loop
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                Proposals require human review before publishing
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                Security
              </div>
              <div className="text-xs font-semibold text-foreground">
                Write-Path Isolation
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                Database-enforced tenant and role policies
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                Integrity
              </div>
              <div className="text-xs font-semibold text-foreground">
                Immutable Ledger
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                Audit log entries cannot be mutated or deleted
              </div>
            </div>
          </div>
        </div>

        {/* Institutional Footer */}
        <div className="pt-6 border-t border-border flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>Procedure Hub Enterprise</span>
          <span>Official System of Record</span>
        </div>
      </div>

      {/* Right Column: Clean, Structured Form Card */}
      <div className="lg:col-span-5 flex items-center justify-center p-6 sm:p-10 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile Masthead Header */}
          <div className="lg:hidden pb-6 mb-6 border-b border-border flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="h-5 w-5 bg-primary rounded-sm flex items-center justify-center text-primary-foreground font-mono text-xs font-bold">
                P
              </div>
              <span className="font-display text-lg font-bold tracking-tight text-foreground">
                Procedure Hub
              </span>
            </Link>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Sign In
            </span>
          </div>

          <div className="bg-card border border-border p-7 sm:p-9 rounded-lg shadow-xs">
            {mode === "reset" && resetSent ? (
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
                  Password Recovery
                </div>
                <h2 className="font-display text-2xl sm:text-3xl font-normal text-foreground mb-4">
                  Check your inbox
                </h2>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                  We have sent a secure link to <strong className="text-foreground">{email}</strong>.
                  Open the link in your email to configure your password and access your workspace.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setResetSent(false);
                  }}
                  className="text-sm text-foreground underline underline-offset-4 hover:text-ink-soft transition-colors cursor-pointer"
                >
                  Return to sign in
                </button>
              </div>
            ) : (
              <>
                <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
                  {mode === "signin"
                    ? "Workspace Access"
                    : mode === "signup"
                      ? "Create Account"
                      : mode === "update-password"
                        ? "Security Configuration"
                        : "Account Recovery"}
                </div>

                <h2 className="font-display text-2xl sm:text-3xl font-normal text-foreground mb-2">
                  {mode === "signin"
                    ? "Sign in to your workspace"
                    : mode === "signup"
                      ? "Create your account"
                      : mode === "update-password"
                        ? "Set new password"
                        : "Reset or set password"}
                </h2>

                <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
                  {mode === "signin"
                    ? "Enter your credentials to access your procedures and compliance ledger."
                    : mode === "signup"
                      ? "Register your work credentials to join your team's operational workspace."
                      : mode === "update-password"
                        ? "Choose a strong password with at least 8 characters."
                        : "Enter your work email address to receive a secure password configuration link."}
                </p>

                <form onSubmit={submit} className="space-y-4" aria-label="Authentication form">
                  {mode === "signup" && (
                    <div>
                      <label className="block text-xs font-medium text-foreground tracking-wide mb-1.5" htmlFor="name">
                        Full Name
                      </label>
                      <input
                        id="name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={busy}
                        required
                        placeholder="e.g. Jane Doe"
                        className="w-full bg-background border border-border px-3.5 py-2.5 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-colors"
                      />
                    </div>
                  )}

                  {mode !== "update-password" && (
                    <div>
                      <label className="block text-xs font-medium text-foreground tracking-wide mb-1.5" htmlFor="email">
                        Work Email
                      </label>
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={busy}
                        required
                        autoComplete="email"
                        placeholder="you@company.com"
                        className="w-full bg-background border border-border px-3.5 py-2.5 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-colors"
                      />
                    </div>
                  )}

                  {mode !== "reset" && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-medium text-foreground tracking-wide" htmlFor="password">
                          {mode === "update-password" ? "New Password" : "Password"}
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors uppercase cursor-pointer"
                        >
                          {showPassword ? "Hide" : "Show"}
                        </button>
                      </div>
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={busy}
                        required
                        minLength={8}
                        autoComplete={mode === "signin" ? "current-password" : "new-password"}
                        placeholder="Minimum 8 characters"
                        className="w-full bg-background border border-border px-3.5 py-2.5 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 transition-colors"
                      />

                      {mode === "signin" && (
                        <div className="flex items-center justify-between mt-2.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setMode("reset")}
                            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          >
                            Forgot password?
                          </button>
                          <button
                            type="button"
                            onClick={() => setMode("reset")}
                            className="text-primary hover:underline font-medium cursor-pointer"
                          >
                            Invited? Set password
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full bg-primary text-primary-foreground py-2.5 px-4 text-sm font-medium rounded-md hover:bg-primary/95 active:scale-[0.99] disabled:opacity-60 transition-all cursor-pointer shadow-xs"
                  >
                    {busy
                      ? "Processing..."
                      : mode === "signin"
                        ? "Sign in"
                        : mode === "signup"
                          ? "Create account"
                          : mode === "update-password"
                            ? "Save new password"
                            : "Send reset link"}
                  </button>
                </form>

                <div className="mt-6 pt-5 border-t border-border text-sm text-muted-foreground">
                  {mode === "signin" ? (
                    <p>
                      No account?{" "}
                      <button
                        type="button"
                        onClick={() => setMode("signup")}
                        className="text-foreground underline underline-offset-4 hover:text-ink-soft transition-colors cursor-pointer"
                      >
                        Create one
                      </button>
                    </p>
                  ) : mode === "update-password" ? (
                    <p>
                      <button
                        type="button"
                        onClick={() => setMode("signin")}
                        className="text-foreground underline underline-offset-4 hover:text-ink-soft transition-colors cursor-pointer"
                      >
                        Back to sign in
                      </button>
                    </p>
                  ) : (
                    <p>
                      Already have an account?{" "}
                      <button
                        type="button"
                        onClick={() => setMode("signin")}
                        className="text-foreground underline underline-offset-4 hover:text-ink-soft transition-colors cursor-pointer"
                      >
                        Sign in
                      </button>
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="mt-6 text-center text-xs text-muted-foreground font-mono">
            Protected by database-enforced authorization and session-level isolation.
          </div>
        </div>
      </div>
    </div>
  );
}
