import { Popover } from "@base-ui/react/popover";
import { AlertCircle, RefreshCw } from "lucide-react";
import { errorMessage } from "../../../shared/error-message";
import { pullHostName } from "../../../shared/source-control";

/** What the warning lists: each host that failed to answer, with how to ask it again. */
export function loadProblems(
  failures: { server: string; error: unknown }[],
  hostError: unknown,
  onRecheckHosts: () => void,
  retry: (server: string) => void,
) {
  return [
    ...failures.map(({ server, error }) => ({
      provider: pullHostName(server),
      error,
      reload: () => {
        onRecheckHosts();
        retry(server);
      },
    })),
    ...(hostError
      ? [{ provider: "Provider", error: hostError, reload: onRecheckHosts }]
      : []),
  ];
}

/** Connection issues take one small title control; details only open on request. */
export function PullLoadWarnings({
  problems,
}: {
  problems: { provider: string; error: unknown; reload: () => void }[];
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className="pulls-host-warning"
        aria-label="Pull request connection issues"
        title="Some pull requests may be missing. Click for details and reload."
      >
        <AlertCircle size={13} aria-hidden="true" />
        <span>
          {problems.length === 1
            ? `${problems[0].provider} unavailable`
            : `${problems.length} providers unavailable`}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="pulls-host-positioner"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup
            className="pulls-host-popup"
            aria-label="Pull request connection issues"
          >
            {problems.map(({ provider, error, reload }, i) => (
              <section className="pulls-host-problem" key={i}>
                <header>
                  <strong>{provider} unavailable</strong>
                  <button
                    type="button"
                    onClick={reload}
                    aria-label={`Reload ${provider} pull requests`}
                  >
                    <RefreshCw size={12} aria-hidden="true" />
                    Reload
                  </button>
                </header>
                <p>{errorMessage(error)}</p>
              </section>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
