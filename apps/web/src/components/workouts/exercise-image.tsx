import { Dumbbell } from "lucide-react";
import { useEffect, useState } from "react";
import { getExerciseImageCandidates } from "@/lib/exercise-data";
import { cn } from "@/lib/utils";

interface ExerciseImageProps {
  name: string;
  frame?: 0 | 1;
  alt: string;
  className?: string;
}

/**
 * Exercise images are mirrored across public hosts. The wrapper always renders
 * a useful movement placeholder, so failed image hosts never expose a broken
 * browser image or an empty white tile.
 */
export function ExerciseImage({
  name,
  frame = 0,
  alt,
  className,
}: ExerciseImageProps) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const sources = getExerciseImageCandidates(name, frame);

  useEffect(() => {
    setSourceIndex(0);
    setLoaded(false);
  }, [frame, name]);

  const source = sources[sourceIndex];
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  return (
    <span
      role="img"
      aria-label={alt}
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-[linear-gradient(145deg,hsl(0_0%_100%),hsl(0_0%_94%))]",
        className,
      )}
    >
      <span className="flex flex-col items-center gap-1 text-muted-foreground/45">
        <Dumbbell
          width={16}
          height={16}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span
          className="text-[8px] font-semibold tracking-[0.08em]"
          aria-hidden="true"
        >
          {initials}
        </span>
      </span>
      {source && (
        <img
          key={source}
          src={source}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setSourceIndex((current) => current + 1);
          }}
        />
      )}
    </span>
  );
}
