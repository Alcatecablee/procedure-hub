import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Procedure Hub - Operational clarity from chat to record" },
      {
        name: "description",
        content:
          "Centralize operational procedures, updates, and expectations from Teams, Slack, and WhatsApp into one searchable source of truth.",
      },
    ],
  }),
  component: Landing,
});

const FADE_UP = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-50px" },
  transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
};

const STAGGER_CONTAINER = {
  initial: { opacity: 0 },
  whileInView: { opacity: 1 },
  viewport: { once: true, margin: "-50px" },
  transition: { staggerChildren: 0.1 },
};

const STAGGER_ITEM = {
  initial: { opacity: 0, y: 15 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
};

function Landing() {
  return (
    <div className="min-h-screen bg-background paper-grain text-foreground selection:bg-primary/10">
      {/* Masthead */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="border-b border-border relative z-10 sticky top-0 bg-background/80 backdrop-blur-md"
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 bg-primary rounded-sm" />
            <span className="font-display font-medium tracking-tight">Procedure Hub</span>
          </div>
          <nav className="flex items-center gap-6">
            <a
              href="#system"
              className="hidden sm:inline text-sm font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
            >
              The System
            </a>
            <Link
              to="/login"
              className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors group"
            >
              Sign in{" "}
              <span className="inline-block transition-transform group-hover:translate-x-0.5">
                &rarr;
              </span>
            </Link>
          </nav>
        </div>
      </motion.header>

      {/* Hero - editorial */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-6xl px-6 pt-8 pb-20 md:pt-10 md:pb-28 grid md:grid-cols-12 gap-12 items-end">
          <motion.div
            className="md:col-span-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="font-display text-6xl md:text-[5.5rem] leading-[1.02] tracking-tight text-foreground">
              Turn buried chat instructions
              <span className="block italic text-ink-soft mt-1">into operational clarity.</span>
            </h1>

            <p className="mt-8 max-w-2xl text-lg md:text-xl leading-relaxed text-ink-soft">
              Procedure Hub gathers the operational procedures, rule changes, and expectations that
              scatter across Microsoft Teams, Slack, and WhatsApp - and binds them into a single,
              searchable, acknowledged record.
            </p>

            <div className="mt-12 flex items-center gap-8">
              <Link
                to="/login"
                className="inline-flex h-12 items-center justify-center bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open the record
                <span className="ml-2" aria-hidden>
                  &rarr;
                </span>
              </Link>
              <a
                href="#system"
                className="text-sm font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors underline decoration-border underline-offset-4"
              >
                How it works
              </a>
            </div>
          </motion.div>

          <motion.aside
            className="md:col-span-4 border-l border-border pl-8 md:pl-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.2 }}
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-4">
              From the field
            </div>
            <blockquote className="font-display text-lg italic leading-snug text-ink-soft">
              &ldquo;The escalation rule was posted once, in March. By June nobody could find it.
              Half the team had a different version of the truth.&rdquo;
            </blockquote>
            <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              - Operations lead, hybrid support team
            </div>
          </motion.aside>
        </div>
      </section>

      {/* Problem ledger */}
      <section className="border-b border-border bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid md:grid-cols-12 gap-12">
            <motion.div className="md:col-span-4" {...FADE_UP}>
              <div className="eyebrow mb-4 text-muted-foreground">Article I</div>
              <h2 className="font-display text-3xl leading-tight text-foreground">
                The problem with chat as a record.
              </h2>
            </motion.div>
            <motion.div
              className="md:col-span-8"
              variants={STAGGER_CONTAINER}
              initial="initial"
              whileInView="whileInView"
              viewport={{ once: true, margin: "-50px" }}
            >
              <ul className="divide-y divide-border border-y border-border">
                {[
                  ["Important messages get buried under thousands of replies.", "Drift"],
                  ["Staff forget procedures and ask the same questions weekly.", "Repetition"],
                  ["Managers repeat reminders daily across channels.", "Fatigue"],
                  ["No one knows who has read what - accountability disappears.", "Opacity"],
                  ["Operational expectations shift quietly, without a record.", "Inconsistency"],
                ].map(([line, tag]) => (
                  <motion.li
                    key={line}
                    variants={STAGGER_ITEM}
                    className="ledger-row py-5 grid grid-cols-12 gap-4 items-baseline hover:bg-muted/10 transition-colors"
                  >
                    <span className="col-span-12 sm:col-span-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      {tag}
                    </span>
                    <span className="col-span-12 sm:col-span-9 text-base leading-relaxed text-foreground">
                      {line}
                    </span>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* The system */}
      <section id="system" className="border-b border-border scroll-mt-14">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <motion.div {...FADE_UP}>
            <div className="eyebrow mb-4 text-muted-foreground">Article II - The System</div>
            <h2 className="font-display text-3xl md:text-4xl mb-16 max-w-2xl text-foreground">
              A quiet operating record, not another channel.
            </h2>
          </motion.div>

          <motion.div
            className="grid md:grid-cols-3 gap-px bg-border border border-border rounded-sm overflow-hidden"
            variants={STAGGER_CONTAINER}
            initial="initial"
            whileInView="whileInView"
            viewport={{ once: true, margin: "-50px" }}
          >
            {[
              {
                n: "I.",
                title: "Capture",
                body: "Paste a chat export. Procedure Hub extracts only the operational instructions - escalations, rule changes, accountability - and discards the noise.",
              },
              {
                n: "II.",
                title: "Codify",
                body: "Each procedure receives a category, priority, version, and effective date. Edits are tracked. Replacements are linked. The record holds.",
              },
              {
                n: "III.",
                title: "Acknowledge",
                body: "Staff sign the record. Managers see who has read what, what is overdue, and which procedures need attention - without surveillance.",
              },
            ].map((s) => (
              <motion.article
                key={s.n}
                variants={STAGGER_ITEM}
                className="bg-card p-10 hover:bg-muted/10 transition-colors"
              >
                <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-8">
                  {s.n}
                </div>
                <h3 className="font-display text-2xl mb-4 text-foreground">{s.title}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{s.body}</p>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Principles */}
      <section id="principles" className="border-b border-border bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28 grid md:grid-cols-12 gap-12">
          <motion.div className="md:col-span-5" {...FADE_UP}>
            <div className="eyebrow mb-4 text-muted-foreground">Article III</div>
            <h2 className="font-display text-3xl leading-tight text-foreground">
              What this is - and what it is not.
            </h2>
          </motion.div>
          <motion.div
            className="md:col-span-7 space-y-8 text-base leading-relaxed"
            {...FADE_UP}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="text-foreground">
              <span className="font-display italic">Procedure Hub is</span> operational clarity
              software. It is the institutional memory for teams whose work depends on shared rules
              that change too often to remember and too quietly to find.
            </p>
            <p className="text-ink-soft">
              <span className="font-display italic">It is not</span> surveillance. It does not
              measure productivity, monitor activity, or rank performance. It records procedures,
              and it records that they were read. Nothing more.
            </p>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <motion.div className="mx-auto max-w-6xl px-6 py-28 text-center" {...FADE_UP}>
          <div className="eyebrow mb-6 text-muted-foreground">Colophon</div>
          <h2 className="font-display text-4xl md:text-5xl max-w-3xl mx-auto leading-tight tracking-tight text-foreground">
            Bind your operational record.{" "}
            <span className="italic text-ink-soft block mt-2">Begin the first volume.</span>
          </h2>
          <div className="mt-12 flex items-center justify-center gap-6">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 text-sm font-medium rounded-sm hover:bg-primary/90 transition-all hover:scale-[1.02] hover:shadow-md"
            >
              Create your workspace
              <span aria-hidden>&rarr;</span>
            </Link>
          </div>
          <div className="mt-16 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            Procedure Hub &middot; Vol. I &middot; Compiled for operations teams
          </div>
        </motion.div>
      </section>
    </div>
  );
}
