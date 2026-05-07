export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-b border-border-strong">
      <div className="px-6 md:px-10 py-10 md:py-12 max-w-6xl">
        {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h1 className="font-display text-4xl md:text-5xl leading-[1.05] tracking-tight">{title}</h1>
            {subtitle && (
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-soft">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </div>
      </div>
    </header>
  );
}
