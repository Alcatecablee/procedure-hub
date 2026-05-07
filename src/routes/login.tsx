import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Procedure Hub" },
      { name: "description", content: "Sign in to your Procedure Hub workspace." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) void navigate({ to: "/app" });
  }, [user, loading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
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
        toast.success("Account created. You're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      void navigate({ to: "/app" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background paper-grain grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between border-r border-border-strong p-10 bg-surface">
        <Link to="/" className="font-display text-xl">Procedure Hub</Link>
        <div className="max-w-md">
          <div className="eyebrow mb-4">Volume I — Folio 02</div>
          <h2 className="font-display text-4xl leading-[1.05]">
            The record begins
            <span className="block italic text-ink-soft">when the first hand signs it.</span>
          </h2>
          <p className="mt-6 text-sm leading-relaxed text-ink-soft">
            Procedure Hub is your team's operational ledger — quiet, structured, and
            shared. Sign in to consult or contribute to the record.
          </p>
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          Compiled · Bound · Held in common
        </div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <div className="md:hidden mb-8">
            <Link to="/" className="font-display text-2xl">Procedure Hub</Link>
          </div>
          <div className="eyebrow mb-2">{mode === "signin" ? "Folio 02 · Sign in" : "Folio 02 · Open the record"}</div>
          <h1 className="font-display text-3xl mb-8">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="eyebrow block mb-1.5">Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>
            )}
            <div>
              <label className="eyebrow block mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
                required
              />
            </div>
            <div>
              <label className="eyebrow block mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
                required
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium rounded-sm hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="mt-6 text-sm text-muted-foreground">
            {mode === "signin" ? (
              <>
                No account?{" "}
                <button onClick={() => setMode("signup")} className="text-foreground underline-offset-4 hover:underline">
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have one?{" "}
                <button onClick={() => setMode("signin")} className="text-foreground underline-offset-4 hover:underline">
                  Sign in
                </button>
              </>
            )}
          </div>

          <div className="mt-12 rule pt-4 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
            The first account becomes administrator.
          </div>
        </div>
      </div>
    </div>
  );
}
