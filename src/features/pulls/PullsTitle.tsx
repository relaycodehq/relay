import { ArrowLeft } from "lucide-react";
import { IconButton } from "../../ui/ui";
import type { PullsLocation, PullsTarget } from "./pull-board";

/** The window title's trail back from a PR, a project's page or a search.
 *  Back goes up one crumb, and from the board leaves the page. A search
 *  covers the page under it, so it's the trail's end and Back returns to
 *  that page. */
export function PullsTitle({
  where,
  onNav,
  onLeave,
}: {
  where: PullsLocation;
  onNav: (target: PullsTarget) => void;
  onLeave: () => void;
}) {
  const { pull, search } = where;
  // The search shows no project, so the title doesn't name one.
  const repo = search ? null : where.repo;
  const back = () => {
    if (search)
      onNav(
        where.repo ? { to: "repo", repo: where.repo.key } : { to: "board" },
      );
    else if (pull && repo) onNav({ to: "repo", repo: repo.key });
    else if (pull || repo) onNav({ to: "board" });
    else onLeave();
  };
  return (
    <div className="project-window-title pulls-title">
      <IconButton label="Back" onClick={back}>
        <ArrowLeft size={15} />
      </IconButton>
      {repo || pull || search ? (
        <button onClick={() => onNav({ to: "board" })}>Pull requests</button>
      ) : (
        <strong>Pull requests</strong>
      )}
      {repo && (
        <>
          <span className="breadcrumb-slash">/</span>
          {pull ? (
            <button onClick={() => onNav({ to: "repo", repo: repo.key })}>
              {repo.label}
            </button>
          ) : (
            <strong>{repo.label}</strong>
          )}
        </>
      )}
      {search && (
        <>
          <span className="breadcrumb-slash">/</span>
          <strong>Search</strong>
        </>
      )}
      {pull && (
        <>
          <span className="breadcrumb-slash">/</span>
          <strong>
            #{pull.number}
            {pull.title && ` ${pull.title}`}
          </strong>
        </>
      )}
    </div>
  );
}
