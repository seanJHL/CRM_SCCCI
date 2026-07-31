import { Link } from "@tanstack/react-router";
import { useRouterState } from "@tanstack/react-router";
import { CircleDot, CalendarDays, Flame, Bell, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/m", label: "Today", icon: CircleDot, match: (p: string) => p === "/m" },
  { to: "/m/calendar", label: "Calendar", icon: CalendarDays, match: (p: string) => p.startsWith("/m/calendar") },
  { to: "/m/habits", label: "Habits", icon: Flame, match: (p: string) => p.startsWith("/m/habits") },
  { to: "/m/reminders", label: "Alerts", icon: Bell, match: (p: string) => p.startsWith("/m/reminders") },
  { to: "/m/settings", label: "Settings", icon: Settings, match: (p: string) => p.startsWith("/m/settings") },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      className="m-bottom-nav fixed inset-x-0 bottom-0 z-40"
      aria-label="Primary"
    >
      <div className="absolute inset-0 border-t border-[var(--m-border)] bg-white/95 backdrop-blur-xl" />

      <div className="relative mx-auto grid max-w-lg grid-cols-5 px-1.5 pt-1">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className="m-press group relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2"
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 h-0.5 w-5 rounded-full bg-[var(--m-text)]"
                />
              )}
              <Icon
                className={cn(
                  "relative h-[21px] w-[21px] transition-colors duration-150",
                  active ? "text-[var(--m-text)]" : "text-[var(--m-text-3)]",
                )}
                strokeWidth={active ? 2.2 : 1.8}
              />
              <span
                className={cn(
                  "relative max-w-full truncate text-[10px] font-medium transition-colors duration-150",
                  active ? "text-[var(--m-text)]" : "text-[var(--m-text-3)]",
                )}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
