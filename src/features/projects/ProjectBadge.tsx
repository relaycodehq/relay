import { useQuery } from "@tanstack/react-query";
import type { Project } from "../../../shared/projects";
import { api } from "../../lib/api";

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

export function ProjectBadge({ project }: { project: Project | undefined }) {
  const icon = useProjectIcon(project?.scratch ? undefined : project?.id);
  if (project?.scratch)
    return <span className="sb-project-badge scratchpad" aria-hidden />;
  if (icon)
    return (
      <img className="sb-project-badge icon" src={icon} alt="" aria-hidden />
    );
  const name = project?.name ?? "?";
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
