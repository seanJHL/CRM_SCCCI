import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  CalendarDays,
  Bell,
  PanelLeftClose,
  PanelLeft,
  Zap,
  CircleDot,
  CheckCircle2,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Today", icon: CircleDot },
  { to: "/", label: "Calendar", icon: CalendarDays },
  { to: "/workouts", label: "Habits", icon: CheckCircle2 },
  { to: "/reminders", label: "Reminders", icon: Bell },
  { to: "/m", label: "Mobile view", icon: Smartphone },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-background transition-[width] duration-200",
        collapsed ? "w-14" : "w-56",
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-foreground" />
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Ember
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {collapsed ? (
            <PanelLeft className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-2 py-1">
        {navItems.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors",
              "hover:bg-muted/60 hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
            activeProps={{
              className: cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-semibold bg-muted text-foreground",
                collapsed && "justify-center px-0",
              ),
            }}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        ))}
      </nav>

      {/* This Week Card */}
      {!collapsed && (
        <div className="mx-2 mb-2 rounded-lg border border-border bg-muted/40 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            This Week
          </p>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-lg font-bold text-foreground">83%</span>
            <span className="text-[11px] text-muted-foreground">completed</span>
          </div>
          <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-foreground" style={{ width: "83%" }} />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Your best week this month — nice consistency.
          </p>
        </div>
      )}

      {/* User */}
      <div className="border-t border-border p-2">
        <div className={cn("flex items-center gap-2 rounded-md px-2 py-1.5", collapsed && "justify-center px-0")}>
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
            A
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-foreground">Amira</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
