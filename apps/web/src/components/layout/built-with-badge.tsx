import { Badge } from "@/components/ui/badge";

/**
 * Fixed corner attribution shown on every page. Mounted once in the root
 * route so it survives across the desktop, mobile (/m/*), and standalone
 * (login/privacy) layouts without needing to be added per-route.
 */
export function BuiltWithBadge() {
  return (
    <Badge
      variant="outline"
      className="fixed bottom-4 right-4 z-50 border-primary/40 bg-primary text-primary-foreground px-3 py-1.5 text-sm font-semibold shadow-lg pointer-events-none select-none"
    >
      Built with Qwen Qoder
    </Badge>
  );
}
