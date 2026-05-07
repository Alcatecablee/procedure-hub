import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Procedure Hub — Operational clarity from chat to record" },
      { name: "description", content: "Centralize operational procedures, updates, and expectations from Teams, Slack, and WhatsApp into one searchable source of truth." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background paper-grain text-foreground">
      {/* Masthead */}
      <header className="border-b border-border-strong">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl">Procedure Hub</span>
            <span className="eyebrow hidden sm:inline">Vol. I — Operations Record</span>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            <a href="#principles" className="hidden sm:inline text-muted-foreground hover:text-foreground transition-colors">Principles</a>
            <a href="#system" className="hidden sm:inline text-muted-foreground hover:text-foreground transition-colors">The System</a>
            <Link to="/login" className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
              Sign in →
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero — editorial */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28 grid md:grid-cols-12 gap-10 items-end">
          <div className="md:col-span-8">
            <div className="eyebrow mb-6">Issue 01 · Operational Knowledge, Held in Common</div>
            <h1 className="font-display text-5xl md:text-7xl leading-[1.02] tracking-tight">
              Turn buried chat instructions
              <span className="block italic text-ink-soft">into operational clarity.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-ink-soft">
              Procedure Hub gathers the operational procedures, rule changes, and expectations
              that scatter across Microsoft Teams, Slack, and WhatsApp — and binds them into a
              single, searchable, acknowledged record.
            </p>
            <div className="mt-10 flex items-center gap-6">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-3 text-sm font-medium rounded-sm hover:bg-primary/90 transition-colors"
              >
                Open the record
                <span aria-hidden>→</span>
              </Link>
              <a href="#system" className="text-sm font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
                How it works
              </a>
            </div>
          </div>

          <aside className="md:col-span-4 border-l border-border pl-8 md:pl-10">
            <div className="eyebrow mb-3">From the field</div>
            <blockquote className="font-display text-lg italic leading-snug text-ink-soft">
              “The escalation rule was posted once, in March. By June nobody could find it.
              Half the team had a different version of the truth.”
            </blockquote>
            <div className="mt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              — Operations lead, hybrid support team
            </div>
          </aside>
        </div>
      </section>

      {/* Problem ledger */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid md:grid-cols-12 gap-10">
            <div className="md:col-span-4">
              <div className="eyebrow mb-3">Article I</div>
              <h2 className="font-display text-3xl leading-tight">The problem with chat as a record.</h2>
            </div>
            <div className="md:col-span-8">
              <ul className="divide-y divide-border border-y border-border">
                {[
                  ["Important messages get buried under thousands of replies.", "Drift"],
                  ["Staff forget procedures and ask the same questions weekly.", "Repetition"],
                  ["Managers repeat reminders daily across channels.", "Fatigue"],
                  ["No one knows who has read what — accountability disappears.", "Opacity"],
                  ["Operational expectations shift quietly, without a record.", "Inconsistency"],
                ].map(([line, tag]) => (
                  <li key={line} className="ledger-row py-4 grid grid-cols-12 gap-4 items-baseline">
                    <span className="col-span-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{tag}</span>
                    <span className="col-span-10 text-base leading-relaxed">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* The system */}
      <section id="system" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="eyebrow mb-3">Article II — The System</div>
          <h2 className="font-display text-3xl md:text-4xl mb-12 max-w-2xl">A quiet operating record, not another channel.</h2>

          <div className="grid md:grid-cols-3 gap-px bg-border border border-border">
            {[
              {
                n: "I.",
                title: "Capture",
                body: "Paste a chat export. Procedure Hub extracts only the operational instructions — escalations, rule changes, accountability — and discards the noise.",
              },
              {
                n: "II.",
                title: "Codify",
                body: "Each procedure receives a category, priority, version, and effective date. Edits are tracked. Replacements are linked. The record holds.",
              },
              {
                n: "III.",
                title: "Acknowledge",
                body: "Staff sign the record. Managers see who has read what, what is overdue, and which procedures need attention — without surveillance.",
              },
            ].map((s) => (
              <article key={s.n} className="bg-card p-8">
                <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-6">{s.n}</div>
                <h3 className="font-display text-2xl mb-3">{s.title}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{s.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Principles */}
      <section id="principles" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16 grid md:grid-cols-12 gap-10">
          <div className="md:col-span-5">
            <div className="eyebrow mb-3">Article III</div>
            <h2 className="font-display text-3xl leading-tight">What this is — and what it is not.</h2>
          </div>
          <div className="md:col-span-7 space-y-6 text-base leading-relaxed">
            <p>
              <span className="font-display italic">Procedure Hub is</span> operational clarity software.
              It is the institutional memory for teams whose work depends on shared rules
              that change too often to remember and too quietly to find.
            </p>
            <p className="text-ink-soft">
              <span className="font-display italic">It is not</span> surveillance. It does not
              measure productivity, monitor activity, or rank performance. It records procedures,
              and it records that they were read. Nothing more.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <div className="eyebrow mb-4">Colophon</div>
          <h2 className="font-display text-3xl md:text-4xl max-w-2xl mx-auto">
            Bind your operational record. <span className="italic text-ink-soft">Begin the first volume.</span>
          </h2>
          <div className="mt-8 flex items-center justify-center gap-6">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 text-sm font-medium rounded-sm hover:bg-primary/90"
            >
              Create your workspace
              <span aria-hidden>→</span>
            </Link>
          </div>
          <div className="mt-12 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            Procedure Hub · Vol. I · Compiled for operations teams
          </div>
        </div>
      </section>
    </div>
  );
}
