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
        // In dev surface the raw message; in prod show generic.
        const isDev = import.meta.env.DEV;
        toast.error(isDev ? `Error: ${msg}` : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background paper-grain grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between border-r border-border-strong p-10 bg-surface">
        <Link to="/" className="font-display text-xl">
          Procedure Hub
        </Link>
        <div className="max-w-md">
          <div className="eyebrow mb-4">Volume I - Folio 02</div>
          <h2 className="font-display text-4xl leading-[1.05]">
            The record begins
            <span className="block italic text-ink-soft">when the first hand signs it.</span>
          </h2>
          <p className="mt-6 text-sm leading-relaxed text-ink-soft">
            Procedure Hub is your team's operational ledger - quiet, structured, and shared. Sign in
            to consult or contribute to the record.
          </p>
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          Compiled Â· Bound Â· Held in common
        </div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <div className="md:hidden mb-8">
            <Link to="/" className="font-display text-2xl">
              Procedure Hub
            </Link>
          </div>

          {mode === "reset" && resetSent ? (
            <div>
              <div className="eyebrow mb-2">Folio 02 Â· Password reset</div>
              <h1 className="font-display text-3xl mb-4">Check your inbox</h1>
              <p className="text-sm text-muted-foreground mb-6">
                We've sent a password reset link to <strong>{email}</strong>. Follow the link in the
                email to set a new password.
              </p>
              <button
                onClick={() => {
                  setMode("signin");
                  setResetSent(false);
                }}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <div className="eyebrow mb-2">
                {mode === "signin"
                  ? "Folio 02 - Sign in"
                  : mode === "signup"
                    ? "Folio 02 - Open the record"
                    : mode === "update-password"
                      ? "Folio 02 - Update password"
                      : "Folio 02 - Reset password"}
              </div>
              <h1 className="font-display text-3xl mb-8">
                {mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : mode === "update-password"
                      ? "Set new password"
                      : "Reset your password"}
              </h1>

              <form onSubmit={submit} className="space-y-4" aria-label="Authentication form">
                {mode === "signup" && (
                  <div>
                    <label className="eyebrow block mb-1.5" htmlFor="name">
                      Full name
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={busy}
                      required
                      className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                    />
                  </div>
                )}

                {mode !== "update-password" && (
                  <div>
                    <label className="eyebrow block mb-1.5" htmlFor="email">
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy}
                      required
                      autoComplete="email"
                      className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                    />
                  </div>
                )}

                {mode !== "reset" && (
                  <div>
                    <label className="eyebrow block mb-1.5" htmlFor="password">
                      {mode === "update-password" ? "New password" : "Password"}
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                      required
                      minLength={8}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                    />
                    {mode === "signin" && (
                      <button
                        type="button"
                        onClick={() => setMode("reset")}
                        className="mt-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium rounded-sm hover:bg-primary/90 disabled:opacity-60 transition-colors"
                >
                  {busy
                    ? "..."
                    : mode === "signin"
                      ? "Sign in"
                      : mode === "signup"
                        ? "Create account"
                        : mode === "update-password"
                          ? "Save new password"
                          : "Send reset link"}
                </button>
              </form>

              <div className="mt-6 text-sm text-muted-foreground space-y-1">
                {mode === "signin" ? (
                  <p>
                    No account?{" "}
                    <button
                      onClick={() => setMode("signup")}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      Create one
                    </button>
                  </p>
                ) : mode === "update-password" ? (
                  <p>
                    <button
                      onClick={() => setMode("signin")}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      Back to sign in
                    </button>
                  </p>
                ) : (
                  <p>
                    Already have one?{" "}
                    <button
                      onClick={() => setMode("signin")}
                      className="text-foreground underline-offset-4 hover:underline"
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
  );
}
