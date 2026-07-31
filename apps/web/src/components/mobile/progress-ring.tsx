import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ProgressRingProps {
  /** 0..1 fraction of the ring that is filled */
  progress: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Progress ring — clean monochrome SVG circular gauge.
 * Black progress stroke on a light gray track.
 */
export function ProgressRing({
  progress,
  size = 200,
  strokeWidth = 10,
  className,
  children,
}: ProgressRingProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  const [animated, setAnimated] = useState(circumference);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      const t = requestAnimationFrame(() => setAnimated(offset));
      return () => cancelAnimationFrame(t);
    }
    setAnimated(offset);
  }, [offset]);

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label="Today's progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(0 0% 93%)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(0 0% 7%)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={animated}
          style={{
            transition: "stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
