import { cn } from "@/lib/utils";

type Priority = "critical" | "high" | "medium" | "informational";
type Status = "active" | "archived" | "replaced" | "draft";

const priorityStyles: Record<Priority, string> = {
  critical: "text-priority-critical border-priority-critical/40 bg-priority-critical/5",
  high: "text-priority-high border-priority-high/40 bg-priority-high/5",
  medium: "text-priority-medium border-priority-medium/40 bg-priority-medium/5",
  informational: "text-priority-info border-priority-info/30 bg-priority-info/5",
};

const statusStyles: Record<Status, string> = {
  active: "text-status-active border-status-active/40",
  archived: "text-status-archived border-status-archived/30",
  replaced: "text-status-replaced border-status-replaced/40",
  draft: "text-status-draft border-status-draft/40",
};

export function PriorityBadge({ value, className }: { value: Priority; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[10.5px] font-mono uppercase tracking-[0.12em] rounded-sm",
        priorityStyles[value],
        className,
      )}
    >
      <span className="size-1 rounded-full bg-current" />
      {value}
    </span>
  );
}

export function StatusBadge({ value, className }: { value: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-1.5 py-0.5 text-[10.5px] font-mono uppercase tracking-[0.12em] rounded-sm",
        statusStyles[value],
        className,
      )}
    >
      {value}
    </span>
  );
}
