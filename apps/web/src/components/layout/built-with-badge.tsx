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
      className="fixed bottom-2 right-2 z-50 bg-background/80 backdrop-blur-sm shadow-sm pointer-events-none select-none"
    >
      Built with Qwen Qoder
    </Badge>
  );
}
