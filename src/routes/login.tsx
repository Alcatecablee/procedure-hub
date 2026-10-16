import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  BookOpen,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  KeyRound,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  FileCheck2,
  Users,
} from "lucide-react";

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
      // Map Supabase error strings to human-readable messages.
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
    <div className="min-h-screen bg-background paper-grain flex flex-col md:grid md:grid-cols-12 relative overflow-hidden">
      {/* Ambient background illumination */}
      <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-primary/[0.04] rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-5%] w-[500px] h-[500px] bg-accent/25 rounded-full blur-3xl pointer-events-none" />

      {/* Left Column: Brand & Editorial Showcase */}
      <div className="hidden md:flex md:col-span-6 lg:col-span-7 flex-col justify-between border-r border-border/80 p-8 sm:p-12 lg:p-16 bg-surface/50 backdrop-blur-sm relative z-10">
        {/* Brand header */}
        <div className="flex items-center justify-between">
          <Link to="/" className="group flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center shadow-sm group-hover:bg-primary/90 transition-colors">
              <BookOpen className="h-4.5 w-4.5" />
            </div>
            <div className="flex flex-col">
              <span className="font-display text-xl font-semibold tracking-tight text-foreground leading-tight">
                Procedure Hub
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Operational Memory & Ledger
              </span>
            </div>
          </Link>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/80 bg-background/80 text-[11px] font-mono text-muted-foreground shadow-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>v2.4 Live</span>
          </div>
        </div>

        {/* Center narrative statement & preview card */}
        <div className="max-w-xl my-auto py-8">
          <div className="inline-flex items-center gap-2 eyebrow mb-4 text-primary font-medium">
            <span className="h-px w-6 bg-primary/40" />
            <span>Volume I · Folio 02 · Operational Standard</span>
          </div>

          <h2 className="font-display text-4xl sm:text-5xl leading-[1.08] tracking-tight text-foreground mb-6">
            The record begins{" "}
            <span className="italic font-normal text-ink-soft block mt-1">
              when the first hand signs it.
            </span>
          </h2>

          <p className="text-base leading-relaxed text-muted-foreground mb-8 max-w-lg">
            Procedure Hub turns scattered chat threads into an authoritative, versioned operational
            ledger. Clear departmental scope, verified staff sign-offs, and complete compliance transparency.
          </p>

          {/* Realistic Micro-Ledger Preview Card */}
          <div className="rounded-xl border border-border-strong/70 bg-card/90 shadow-lg shadow-foreground/[0.03] p-5 backdrop-blur-md relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:border-border-strong">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border/70">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-4 w-4 text-primary" />
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
                  SOP-2026-042
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span className="font-mono text-[11px] text-muted-foreground">Version 1.2</span>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Active · Enforced
              </span>
            </div>

            <h3 className="font-display text-base font-semibold text-foreground mb-1.5">
              Till Roll & Hardware Dispatch Governance
            </h3>
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-4">
              "Critical dispatch rules for regional support. Only authorized for verified merchants
              within provincial boundaries. Requires explicit customer confirmation prior to order creation."
            </p>

            <div className="flex items-center justify-between pt-3 border-t border-border/60 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground font-mono text-[11px]">
                <Users className="h-3.5 w-3.5 text-primary/70" />
                <span>Audience: Customer Care Ops</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium font-mono text-[11px]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>100% Verified Compliant</span>
              </div>
            </div>
          </div>
        </div>

        {/* Left Footer */}
        <div className="flex items-center justify-between border-t border-border/70 pt-6 text-xs text-muted-foreground font-mono">
          <div className="tracking-[0.14em] uppercase text-[10.5px]">
            Compiled · Bound · Held in Common
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <ShieldCheck className="h-3.5 w-3.5 text-primary/70" />
            <span>Immutable Audit Ledger</span>
          </div>
        </div>
      </div>

      {/* Right Column: Clean, Modern Authentication Card */}
      <div className="md:col-span-6 lg:col-span-5 flex flex-col items-center justify-center p-6 sm:p-10 lg:p-12 relative z-10">
        {/* Mobile Header */}
        <div className="md:hidden w-full max-w-md mb-8 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center shadow-xs">
              <BookOpen className="h-4 w-4" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight text-foreground">
              Procedure Hub
            </span>
          </Link>
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-muted/60 px-2 py-0.5 rounded border border-border">
            Ledger Auth
          </span>
        </div>

        {/* Elevated Form Card */}
        <div className="w-full max-w-md bg-card/95 border border-border-strong/70 rounded-2xl shadow-xl shadow-foreground/[0.03] p-7 sm:p-9 backdrop-blur-xl relative">
          {mode === "reset" && resetSent ? (
            <div className="text-center py-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center mb-5">
                <Mail className="h-6 w-6" />
              </div>
              <div className="eyebrow mb-2 text-primary font-medium">Folio 02 · Password Reset</div>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold mb-3">Check your inbox</h1>
              <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
                We've sent a secure reset link to <strong className="text-foreground">{email}</strong>.
                Follow the instructions to configure your password and access the ledger.
              </p>
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setResetSent(false);
                }}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-border bg-background hover:bg-muted/70 text-sm font-medium transition-colors"
              >
                Return to sign in
              </button>
            </div>
          ) : (
            <>
              {/* Top Navigation Mode Pills for Sign In / Sign Up */}
              {(mode === "signin" || mode === "signup") && (
                <div className="flex p-1 bg-surface-2 rounded-lg mb-7 border border-border/80">
                  <button
                    type="button"
                    onClick={() => setMode("signin")}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                      mode === "signin"
                        ? "bg-card text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("signup")}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                      mode === "signup"
                        ? "bg-card text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Create Account
                  </button>
                </div>
              )}

              {/* Header Title & Subtitle */}
              <div className="mb-6">
                <div className="eyebrow mb-1.5 text-primary/80 font-medium">
                  {mode === "signin"
                    ? "Welcome Back · Folio 02"
                    : mode === "signup"
                      ? "New Membership · Folio 02"
                      : mode === "update-password"
                        ? "Security · Update Password"
                        : "Recovery · Reset Password"}
                </div>
                <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                  {mode === "signin"
                    ? "Sign in to workspace"
                    : mode === "signup"
                      ? "Create your account"
                      : mode === "update-password"
                        ? "Set new password"
                        : "Reset your password"}
                </h1>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {mode === "signin"
                    ? "Access your organization's procedures, acknowledgments, and audit logs."
                    : mode === "signup"
                      ? "Join with your company email to access or initialize your team's ledger."
                      : mode === "update-password"
                        ? "Choose a strong password to secure your compliance credentials."
                        : "Enter your verified email. If you were invited, this link will allow you to set your initial password."}
                </p>
              </div>

              {/* Form Body */}
              <form onSubmit={submit} className="space-y-4" aria-label="Authentication form">
                {mode === "signup" && (
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5" htmlFor="name">
                      Full Name
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                        <User className="h-4 w-4" />
                      </div>
                      <input
                        id="name"
                        type="text"
                        placeholder="Sarah Jenkins"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={busy}
                        required
                        className="w-full bg-background border border-input pl-9 pr-3 py-2 text-sm rounded-lg shadow-2xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-60 placeholder:text-muted-foreground/50"
                      />
                    </div>
                  </div>
                )}

                {mode !== "update-password" && (
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5" htmlFor="email">
                      Work Email Address
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                        <Mail className="h-4 w-4" />
                      </div>
                      <input
                        id="email"
                        type="email"
                        placeholder="consultant@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={busy}
                        required
                        autoComplete="email"
                        className="w-full bg-background border border-input pl-9 pr-3 py-2 text-sm rounded-lg shadow-2xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-60 placeholder:text-muted-foreground/50"
                      />
                    </div>
                  </div>
                )}

                {mode !== "reset" && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-medium text-foreground" htmlFor="password">
                        {mode === "update-password" ? "New Password" : "Password"}
                      </label>
                      {mode === "signin" && (
                        <button
                          type="button"
                          onClick={() => setMode("reset")}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Forgot?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                        <Lock className="h-4 w-4" />
                      </div>
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={busy}
                        required
                        minLength={8}
                        autoComplete={mode === "signin" ? "current-password" : "new-password"}
                        className="w-full bg-background border border-input pl-9 pr-10 py-2 text-sm rounded-lg shadow-2xs focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    {mode === "signin" && (
                      <div className="mt-2.5 pt-2 border-t border-border/50 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Received an invite link?</span>
                        <button
                          type="button"
                          onClick={() => setMode("reset")}
                          className="text-primary hover:text-primary/90 font-medium inline-flex items-center gap-1 group"
                        >
                          <KeyRound className="h-3 w-3 group-hover:rotate-12 transition-transform" />
                          <span>Set your password</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Submit Action Button */}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full mt-2 bg-primary text-primary-foreground py-2.5 px-4 text-sm font-medium rounded-lg shadow-sm hover:bg-primary/90 active:scale-[0.99] transition-all duration-150 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : mode === "signin" ? (
                    <>
                      <span>Sign in to workspace</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  ) : mode === "signup" ? (
                    <>
                      <span>Create workspace account</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  ) : mode === "update-password" ? (
                    <span>Save new password</span>
                  ) : (
                    <span>Send password instructions</span>
                  )}
                </button>
              </form>

              {/* Bottom Mode Switcher for Reset/Update */}
              {mode !== "signin" && mode !== "signup" && (
                <div className="mt-6 pt-4 border-t border-border/70 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("signin");
                      setResetSent(false);
                    }}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
                  >
                    <span>← Back to workspace sign in</span>
                  </button>
                </div>
              )}

              {/* Enterprise Security Badge */}
              <div className="mt-7 pt-4 border-t border-border/60 flex items-center justify-center gap-2 text-[11px] font-mono text-muted-foreground/80">
                <ShieldCheck className="h-3.5 w-3.5 text-primary/70" />
                <span>Multi-Tenant Enterprise Isolation & Audit Security</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
