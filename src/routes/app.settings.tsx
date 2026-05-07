import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/app/settings")({ component: Settings });

function Settings() {
  const integrations = [
    { name: "Microsoft Teams", status: "Coming soon", body: "Auto-extract procedures from selected channels." },
    { name: "Slack", status: "Coming soon", body: "Watch channels for operational directives." },
    { name: "WhatsApp Business API", status: "Coming soon", body: "Pull instructions from operational groups." },
    { name: "Discord", status: "Coming soon", body: "Monitor server channels for procedures." },
    { name: "Email import", status: "Coming soon", body: "Forward operational emails to a hub address." },
  ];
  return (
    <div>
      <PageHeader eyebrow="Folio 06" title="Settings & integrations" subtitle="Configuration and connections to your communication platforms." />
      <div className="px-6 md:px-10 py-6 max-w-4xl space-y-8">
        <section>
          <div className="eyebrow mb-3">Integrations</div>
          <ul className="divide-y divide-border border-t border-border-strong">
            {integrations.map((i) => (
              <li key={i.name} className="py-4 grid grid-cols-12 gap-4 items-start">
                <div className="col-span-4 font-display text-lg">{i.name}</div>
                <div className="col-span-6 text-sm text-ink-soft leading-relaxed">{i.body}</div>
                <div className="col-span-2 text-right"><span className="font-mono text-[10.5px] uppercase tracking-[0.12em] border border-border px-1.5 py-0.5 rounded-sm text-muted-foreground">{i.status}</span></div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
