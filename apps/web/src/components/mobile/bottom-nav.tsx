import { Link } from "@tanstack/react-router";
import { useRouterState } from "@tanstack/react-router";
import { CircleDot, CalendarDays, Dumbbell, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/m", label: "Today", icon: CircleDot, match: (p: string) => p === "/m" },
  { to: "/m/calendar", label: "Calendar", icon: CalendarDays, match: (p: string) => p.startsWith("/m/calendar") },
  { to: "/m/workouts", label: "Train", icon: Dumbbell, match: (p: string) => p.startsWith("/m/workouts") || p.startsWith("/m/habits") },
  { to: "/m/reminders", label: "Alerts", icon: Bell, match: (p: string) => p.startsWith("/m/reminders") },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      className="m-bottom-nav fixed inset-x-0 bottom-0 z-40"
      aria-label="Primary"
    >
      <div className="absolute inset-0 border-t border-white/10 bg-[#171d21]/95 shadow-[0_-12px_30px_rgba(0,0,0,0.28)] backdrop-blur-xl" />

      <div className="relative mx-auto grid max-w-lg grid-cols-4 px-1.5 pt-1">
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
                  className="absolute top-0 h-0.5 w-5 rounded-full bg-[#c6ff77]"
                />
              )}
              <Icon
                className={cn(
                  "relative h-[21px] w-[21px] transition-colors duration-150",
                  active ? "text-[#c6ff77]" : "text-white/40",
                )}
                strokeWidth={active ? 2.2 : 1.8}
              />
              <span
                className={cn(
                  "relative max-w-full truncate text-[10px] font-medium transition-colors duration-150",
                  active ? "text-[#c6ff77]" : "text-white/40",
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
