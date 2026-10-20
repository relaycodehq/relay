import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Circle, Copy, X } from "lucide-react";
import { api } from "../../lib/api";
import { InstallLog } from "../../ui/InstallLog";
import { Spinner } from "../../ui/ui";
import type { Checkup } from "./useCheckup";

type Mark = "todo" | "busy" | "ok" | "fix";
type Line = { mark: Mark; text: string; fix?: ReactNode };

/**
 * The checkup in three lines, reaching it, Relay there, paired, each saying
 * what it found; the one that went wrong carries what fixes it.
 */
export function CheckupLines({
  checkup: c,
  onInstall,
  onAgain,
}: {
  checkup: Checkup;
  onInstall: () => void;
  onAgain: () => void;
}) {
  const { target, phase } = c;
  const log = useQuery({
    queryKey: ["relay-install", target.kind === "route" && target.route],
    queryFn: () =>
      target.kind === "route" ? api.relayInstallOutput(target.route) : "",
    enabled: target.kind === "route" && phase === "installing",
    refetchInterval: 1000,
  });
  const again = (
    <button type="button" onClick={onAgain}>
      Check again
    </button>
  );
  const pair: Line =
    phase === "done"
      ? {
          mark: "ok",
          text: `Paired${target.kind === "link" && c.paired ? ` with ${c.paired.name}` : ""}. Its key is pinned, so this computer only ever talks to it.`,
        }
      : phase === "pairing"
        ? {
            mark: "busy",
            text:
              target.kind === "link"
                ? "Pairing with the computer in the link…"
                : "Pairing…",
          }
        : phase === "pairFailed"
          ? {
              mark: "fix",
              text:
                c.tooOld && target.kind === "route"
                  ? `The Relay on ${target.name} is too old to pair this way.`
                  : (c.error ?? "Pairing failed."),
              fix: c.tooOld ? (
                <button type="button" className="primary" onClick={onInstall}>
                  Update Relay there
                </button>
              ) : (
                <button type="button" onClick={onAgain}>
                  Try again
                </button>
              ),
            }
          : { mark: "todo", text: "Paired" };
  if (target.kind === "link") return <Lines lines={[pair]} />;

  const { name, route } = target;
  const via = route.kind === "ssh" ? "over ssh" : "through WSL";
  const newHostKey =
    phase === "unreachable" &&
    route.kind === "ssh" &&
    /host key yet/.test(c.error ?? "");
  const reach: Line =
    phase === "reaching"
      ? { mark: "busy", text: `Reaching ${name} ${via}…` }
      : phase === "unreachable"
        ? newHostKey
          ? {
              mark: "fix",
              text: `${name} answered, but its host key is new to this computer.`,
              // ssh asks about it in a terminal; nobody would see that here.
              fix: (
                <>
                  <span>Accept it once in a terminal:</span>
                  <code>ssh {route.host}</code>
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard.writeText(`ssh ${route.host}`)
                    }
                  >
                    <Copy size={12} aria-hidden /> Copy
                  </button>
                  {again}
                </>
              ),
            }
          : {
              mark: "fix",
              text: c.error ?? `Couldn't reach ${name}.`,
              fix: again,
            }
        : {
            mark: "ok",
            text: `Reached ${name} ${via}${c.ms !== undefined ? ` in ${c.ms}ms` : ""}.`,
          };
  const logButton = !!log.data && <InstallLog output={log.data} />;
  const relay: Line =
    phase === "reaching" || phase === "unreachable"
      ? { mark: "todo", text: "Relay there" }
      : phase === "missing"
        ? {
            mark: "fix",
            text: `Relay isn't on ${name} yet.`,
            fix: (
              <>
                <span>
                  It installs in your home folder there, no sudo needed, and
                  brings Node.js along if that's missing.
                </span>
                <button type="button" className="primary" onClick={onInstall}>
                  Install Relay
                </button>
              </>
            ),
          }
        : phase === "broken"
          ? {
              mark: "fix",
              text: `Relay is on ${name} but doesn't start: ${c.error}`,
              fix: (
                <button type="button" className="primary" onClick={onInstall}>
                  Reinstall Relay
                </button>
              ),
            }
          : phase === "installing"
            ? {
                mark: "busy",
                text: `${c.version ? "Updating" : "Installing"} Relay on ${name}…`,
                fix: logButton,
              }
            : phase === "installFailed"
              ? {
                  mark: "fix",
                  text: `Couldn't install Relay on ${name}: ${c.error}`,
                  fix: (
                    <>
                      {logButton}
                      <button type="button" onClick={onInstall}>
                        Try again
                      </button>
                    </>
                  ),
                }
              : {
                  mark: "ok",
                  text: !c.installed
                    ? `Relay ${c.version} runs there.`
                    : c.version
                      ? `Relay ${c.version} is installed there.`
                      : "Relay is installed there.",
                };
  return <Lines lines={[reach, relay, pair]} />;
}

function Lines({ lines }: { lines: Line[] }) {
  return (
    <ol className="cm-check-lines">
      {lines.map(({ mark, text, fix }, i) => (
        <li key={i} className={mark}>
          <span className="cm-check-mark">
            {mark === "busy" ? (
              <Spinner size={13} steady />
            ) : mark === "ok" ? (
              <Check size={13} />
            ) : mark === "fix" ? (
              <X size={13} />
            ) : (
              <Circle size={9} />
            )}
          </span>
          <div>
            <span>{text}</span>
            {fix && <div className="cm-check-fix">{fix}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
