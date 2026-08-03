import { ChevronLeft } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

interface MobileCrmHeaderProps {
  title: string;
  subtitle?: string;
  /** When set, renders a back button that navigates here on tap. */
  backTo?: string;
  /** Icon buttons rendered on the right side of the header, in order. */
  actionsRight?: React.ReactNode;
}

/**
 * Shared header chrome for the three mobile CRM routes (Inbox, Thread
 * Detail, Settings) — consistent back-button/title placement without
 * forcing identical structure between them.
 */
export function MobileCrmHeader({ title, subtitle, backTo, actionsRight }: MobileCrmHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="m-anim-slide-up">
      <div className="flex items-center gap-2">
        {backTo && (
          <button
            type="button"
            onClick={() => void navigate({ to: backTo })}
            className="m-icon-button m-press shrink-0"
            aria-label="Back"
          >
            <ChevronLeft width={18} height={18} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="m-eyebrow truncate">{subtitle ?? "CRM"}</p>
          <h1 className="truncate text-[20px] font-semibold tracking-tight text-[var(--m-text)]">
            {title}
          </h1>
        </div>
        {actionsRight && (
          <div className="flex shrink-0 items-center gap-1.5">{actionsRight}</div>
        )}
      </div>
    </header>
  );
}
