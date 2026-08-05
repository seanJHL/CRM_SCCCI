import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Fixed corner attribution shown on every page. Mounted once in the root
 * route so it survives across the desktop, mobile (/m/*), and standalone
 * (login/privacy) layouts without needing to be added per-route.
 */
export function BuiltWithBadge() {
  return (
    <Badge
      variant="outline"
      className={cn(
        "fixed bottom-4 right-4 z-50 gap-2 border-primary/40 bg-primary px-4 py-2",
        "text-base font-semibold text-primary-foreground shadow-lg",
        "pointer-events-none select-none",
        // Bottom-nav clears the screen on mobile — lift the badge above it
        // (plus the safe-area inset) so it never sits behind or on top of
        // the nav bar's tap targets.
        "max-[820px]:bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] max-[820px]:right-3 max-[820px]:px-3 max-[820px]:py-1.5 max-[820px]:text-sm",
      )}
    >
      <img
        src="/Images/Qoder.png"
        alt=""
        className="h-6 w-6 shrink-0 rounded-full max-[820px]:h-5 max-[820px]:w-5"
      />
      Built with Qwen Qoder
    </Badge>
  );
}
