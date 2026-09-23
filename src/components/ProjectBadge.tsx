import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/** Stable hue per project so the activity cards are scannable by colour. */
function projectHue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

/** The project's own icon from its repository; null keeps the fallback. */
export function useProjectIcon(id: string | undefined) {
  return (
    useQuery({
      queryKey: ["project-icon", id],
      queryFn: () => api.projectIcon(id!),
      enabled: !!id,
      staleTime: 300_000,
    }).data ?? null
  );
}

export function ProjectBadge({ id, name }: { id?: string; name: string }) {
  const icon = useProjectIcon(id);
  if (icon)
    return (
      <img className="sb-project-badge icon" src={icon} alt="" aria-hidden />
    );
  return (
    <span
      className="sb-project-badge"
      style={{ "--hue": projectHue(name) } as React.CSSProperties}
      aria-hidden
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
