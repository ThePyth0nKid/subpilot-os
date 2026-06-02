import type { RunStatus } from "@/lib/orchestrator/types";
import { PHASES } from "@/lib/ui/meta";

interface KernelStripProps {
  readonly status: RunStatus;
}

/** The OS-kernel state machine, rendered as a live progress rail. */
export function KernelStrip({ status }: KernelStripProps) {
  const errored = status === "error";
  const currentIndex =
    status === "done"
      ? PHASES.length
      : PHASES.findIndex((p) => p.key === status);

  return (
    <div className="flex items-center gap-1 overflow-x-auto scroll-thin py-1">
      {PHASES.map((phase, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex && !errored;
        const color = done
          ? "var(--green)"
          : active
            ? "var(--cyan)"
            : "var(--ink-faint)";
        return (
          <div key={phase.key} className="flex items-center gap-1 shrink-0">
            <div className="flex items-center gap-2 px-1">
              <span
                className={`dot ${active ? "dot-live" : ""}`}
                style={{ color }}
              />
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: done || active ? "var(--ink)" : "var(--ink-faint)",
                }}
              >
                {phase.label}
              </span>
            </div>
            {i < PHASES.length - 1 && (
              <span
                style={{
                  width: 26,
                  height: 1,
                  background: done ? "var(--green)" : "var(--line-strong)",
                  opacity: done ? 0.7 : 1,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
