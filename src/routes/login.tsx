import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

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
    <div className="min-h-screen bg-background paper-grain grid md:grid-cols-2">
      {/* Left Column: Authentic Editorial Brand Panel */}
      <div className="hidden md:flex flex-col justify-between border-r border-border p-10 lg:p-14 bg-surface">
        <div>
          <Link to="/" className="font-display text-2xl tracking-tight text-foreground">
            Procedure Hub
          </Link>
        </div>

        <div className="max-w-md my-auto py-8">
          <div className="eyebrow mb-4">Volume I - Folio 02</div>
          <h1 className="font-display text-4xl lg:text-5xl leading-[1.08] tracking-tight text-foreground">
            The record begins
            <span className="block italic text-ink-soft mt-1">when the first hand signs it.</span>
          </h1>
          <p className="mt-6 text-sm leading-relaxed text-ink-soft">
            Procedure Hub is your team's operational ledger - quiet, structured, and shared. Sign in
            to consult the active record or verify compliance obligations.
          </p>

          <div className="rule mt-8 pt-8">
            <div className="eyebrow mb-2">Protocol Note</div>
            <p className="text-xs text-muted-foreground leading-relaxed italic">
              "A message in chat is an announcement. A procedure in the ledger is an authoritative commitment."
            </p>
          </div>
        </div>

        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Compiled - Bound - Held in Common
        </div>
      </div>

      {/* Right Column: Clean, Structured Form Card */}
      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          {/* Mobile Header */}
          <div className="md:hidden mb-8">
            <Link to="/" className="font-display text-2xl tracking-tight text-foreground">
              Procedure Hub
            </Link>
          </div>

          <div className="bg-card border border-border p-8 sm:p-10 rounded-sm shadow-xs">
            {mode === "reset" && resetSent ? (
              <div>
                <div className="eyebrow mb-2">Folio 02 - Password Reset</div>
                <h2 className="font-display text-3xl font-normal text-foreground mb-4">Check your inbox</h2>
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
                  className="text-sm text-foreground underline underline-offset-4 hover:text-ink-soft transition-colors"
                >
                  Return to sign in
                </button>
              </div>
            ) : (
              <>
                <div className="eyebrow mb-2">
                  {mode === "signin"
                    ? "Folio 02 - Sign In"
                    : mode === "signup"
                      ? "Folio 02 - Open Account"
                      : mode === "update-password"
                        ? "Folio 02 - Set Password"
                        : "Folio 02 - Password Recovery"}
                </div>

                <h2 className="font-display text-3xl font-normal text-foreground mb-6">
                  {mode === "signin"
                    ? "Sign in"
                    : mode === "signup"
                      ? "Create account"
                      : mode === "update-password"
                        ? "Set new password"
                        : "Reset or set password"}
                </h2>

                {mode === "reset" && (
                  <p className="text-xs text-muted-foreground -mt-3 mb-6 leading-relaxed">
                    Enter your email address to receive a secure link. If you accepted an invitation
                    without setting a password, this link will allow you to establish one.
                  </p>
                )}

                <form onSubmit={submit} className="space-y-4" aria-label="Authentication form">
                  {mode === "signup" && (
                    <div>
                      <label className="eyebrow block mb-1.5" htmlFor="name">
                        Full Name
                      </label>
                      <input
                        id="name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={busy}
                        required
                        className="w-full bg-background border border-border px-3.5 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-60 transition-colors"
                      />
                    </div>
                  )}

                  {mode !== "update-password" && (
                    <div>
                      <label className="eyebrow block mb-1.5" htmlFor="email">
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
                        className="w-full bg-background border border-border px-3.5 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-60 transition-colors"
                      />
                    </div>
                  )}

                  {mode !== "reset" && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="eyebrow" htmlFor="password">
                          {mode === "update-password" ? "New Password" : "Password"}
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors uppercase"
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
                        className="w-full bg-background border border-border px-3.5 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-60 transition-colors"
                      />

                      {mode === "signin" && (
                        <div className="flex items-center justify-between mt-2.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setMode("reset")}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Forgot password?
                          </button>
                          <button
                            type="button"
                            onClick={() => setMode("reset")}
                            className="text-primary hover:underline font-medium"
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
                    className="w-full bg-primary text-primary-foreground py-2.5 px-4 text-sm font-medium rounded-sm hover:bg-primary/95 disabled:opacity-60 transition-colors cursor-pointer"
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
                        className="text-foreground underline underline-offset-4 hover:text-ink-soft transition-colors"
                      >
                        Create one
                      </button>
                    </p>
                  ) : mode === "update-password" ? (
                    <p>
                      <button
                        type="button"
                        onClick={() => setMode("signin")}
                        className="text-foreground underline underline-offset-4 hover:text-ink-soft transition-colors"
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
                        className="text-foreground underline underline-offset-4 hover:text-ink-soft transition-colors"
                      >
                        Sign in
                      </button>
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
