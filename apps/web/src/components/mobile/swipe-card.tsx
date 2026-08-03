import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface SwipeCardProps {
  children: React.ReactNode;
  /** Fired once the card is swiped past the completion threshold. */
  onComplete: () => void;
  /** If true the card is already done — renders settled, no swipe. */
  completed?: boolean;
  disabled?: boolean;
  className?: string;
}

const THRESHOLD = 96;
const FLY_OFF = 480;

/**
 * SwipeCard — drag right to complete. Clean shadcn card styling.
 */
export function SwipeCard({ children, onComplete, completed, disabled, className }: SwipeCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragX = useRef(0);
  const startX = useRef(0);
  const dragging = useRef(false);
  const [particles, setParticles] = useState<{ id: number; x: number; y: number }[]>([]);

  const setTransform = (x: number, animate: boolean) => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.35s var(--m-spring), opacity 0.3s ease" : "none";
    el.style.transform = `translateX(${x}px)`;
  };

  const revealDone = (x: number) => {
    const el = cardRef.current?.parentElement?.querySelector<HTMLElement>("[data-done-layer]");
    if (el) el.style.opacity = String(Math.min(1, Math.max(0, x / THRESHOLD)));
  };

  const burst = () => {
    const id = Date.now();
    const parts = Array.from({ length: 6 }, (_, i) => ({
      id: id + i,
      x: (Math.random() - 0.2) * 80,
      y: -(20 + Math.random() * 50),
    }));
    setParticles(parts);
    window.setTimeout(() => setParticles([]), 600);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (completed || disabled) return;
    dragging.current = true;
    dragX.current = 0;
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || completed || disabled) return;
    dragX.current = Math.max(0, e.clientX - startX.current);
    setTransform(dragX.current, false);
    revealDone(dragX.current);
  };

  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragX.current > THRESHOLD) {
      setTransform(FLY_OFF, true);
      if (cardRef.current) cardRef.current.style.opacity = "0";
      burst();
      window.setTimeout(onComplete, 200);
    } else {
      setTransform(0, true);
      revealDone(0);
    }
    dragX.current = 0;
  };

  return (
    <div className={cn("relative", className)}>
      {/* Done layer */}
      <div
        data-done-layer
        className="absolute inset-0 flex items-center gap-3 rounded-xl border border-[var(--m-border)] bg-[var(--m-surface-2)] px-5 opacity-0"
        style={{ transition: "opacity 0.15s linear" }}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--m-primary)] text-[var(--m-primary-fg)]">
          <Check width={14} height={14} strokeWidth={3} />
        </span>
        <span className="text-sm font-medium text-[var(--m-text)]">Done</span>
      </div>

      {/* Particle burst */}
      {particles.map((p) => (
        <span
          key={p.id}
          className="pointer-events-none absolute right-6 top-1/2 h-1.5 w-1.5 rounded-full bg-[var(--m-text-3)]"
          style={
            {
              "--m-px": `${p.x}px`,
              "--m-py": `${p.y}px`,
              animation: "m-particle 0.55s var(--m-ease) forwards",
            } as React.CSSProperties
          }
        />
      ))}

      {/* The draggable card */}
      <div
        ref={cardRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-disabled={disabled || completed}
        className={cn(
          "m-card relative touch-pan-y select-none px-4 py-3.5",
          !completed && !disabled && "cursor-grab active:cursor-grabbing",
          completed && "opacity-50",
        )}
        style={{ willChange: "transform" }}
      >
        {children}
        {!completed && !disabled && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--m-text-3)]">
            <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
              <path d="M2 2l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
}
