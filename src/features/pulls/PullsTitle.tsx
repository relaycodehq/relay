import { ArrowLeft } from "lucide-react";
import { IconButton } from "../../ui/ui";
import type { PullsLocation, PullsTarget } from "./pull-board";

/** The window title's trail back from a PR or a project's page. Back goes up
 *  one crumb, and from the board leaves the page. */
export function PullsTitle({
  where,
  onNav,
  onLeave,
}: {
  where: PullsLocation;
  onNav: (target: PullsTarget) => void;
  onLeave: () => void;
}) {
  const { repo, pull } = where;
  const back = () => {
    if (pull && repo) onNav({ to: "repo", repo: repo.key });
    else if (pull || repo) onNav({ to: "board" });
    else onLeave();
  };
  return (
    <div className="project-window-title pulls-title">
      <IconButton label="Back" onClick={back}>
        <ArrowLeft size={15} />
      </IconButton>
      {repo || pull ? (
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
