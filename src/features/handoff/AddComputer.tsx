import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, X } from "lucide-react";
import { api } from "../../lib/api";
import { requestAddProject } from "../../lib/add-project-request";
import { fromTyped, suggestions, type Target } from "./add-targets";
import { CheckupLines } from "./CheckupLines";
import { HostList, RouteIcon } from "./HostList";
import { busy, stoppable, useCheckup } from "./useCheckup";
import { usePairedComputers } from "./usePairedComputers";

/** How many fit on the hint row before the rest go behind "more". */
const hintCount = 6;

/**
 * Adding a computer: say where, a host this computer can ssh into, a WSL
 * distribution or a pairing link, and a checkup reaches it, installs Relay
 * there when it's missing, and pairs. Its agents sign in there, from the
 * first project on it.
 */
export function AddComputer({
  focusRequest = 0,
  onStart,
}: {
  focusRequest?: number;
  /** A checkup started: the map keeps Add picked, so its end stays in view. */
  onStart?: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusRequest) field.current?.focus();
  }, [focusRequest]);
  const distros = useQuery({
    queryKey: ["wsl-distros"],
    queryFn: () => api.wslDistros(),
    staleTime: 60_000,
  });
  const hosts = useQuery({
    queryKey: ["ssh-hosts"],
    queryFn: () => api.sshHosts(),
    staleTime: 60_000,
  });
  const paired = usePairedComputers();
  const { offered, hidden } = suggestions(
    distros.data ?? [],
    hosts.data ?? [],
    paired.data ?? [],
  );
  const { checkup, check, install, again, reset, stop } = useCheckup();
  const [text, setText] = useState("");
  const [typedError, setTypedError] = useState<string>();
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = text
    .trim()
    .replace(/^ssh\s+/, "")
    .toLowerCase();
  const matching = typed
    ? offered.filter((t) =>
        `${t.name} ${t.detail}`.toLowerCase().includes(typed),
      )
    : offered;
  const working = busy(checkup?.phase);

  function start(target: Target) {
    setText(target.kind === "route" ? target.name : target.link);
    setListOpen(false);
    setActive(-1);
    setTypedError(undefined);
    onStart?.();
    void check(target);
  }
  function submit() {
    if (working) return;
    const picked = listOpen ? matching[active] : undefined;
    if (picked) return start(picked);
    const target = fromTyped(text, distros.data ?? []);
    if (!target) return;
    if ("error" in target) return setTypedError(target.error);
    start(target);
  }
  function another() {
    reset();
    setText("");
    field.current?.focus();
  }

  return (
    <div className="settings-card cm-card cm-add">
      <form
        className="cm-add-ask"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="cm-add-field">Add</label>
        <input
          id="cm-add-field"
          ref={field}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            distros.data?.length
              ? "An ssh host, a WSL distribution, or a pairing link"
              : "A host you ssh into, user@host, or a pairing link"
          }
          value={text}
          aria-invalid={!!typedError}
          onChange={(e) => {
            setText(e.target.value);
            setTypedError(undefined);
            setActive(-1);
            setListOpen(!!e.target.value.trim());
            if (checkup && !working) reset();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && stoppable(checkup)) {
              e.preventDefault();
              stop();
            } else if (e.key === "Escape" && listOpen) {
              e.preventDefault();
              setListOpen(false);
            } else if (e.key === "ArrowDown" && !checkup) {
              e.preventDefault();
              setListOpen(true);
              setActive((a) => Math.min(a + 1, matching.length - 1));
            } else if (e.key === "ArrowUp" && listOpen) {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            }
          }}
        />
        {stoppable(checkup) ? (
          <button type="button" onClick={stop}>
            <X size={13} aria-hidden /> Stop
          </button>
        ) : (
          <button
            type="submit"
            className="primary"
            disabled={!text.trim() || working}
          >
            Check <ArrowRight size={13} aria-hidden />
          </button>
        )}
      </form>
      {typedError && (
        <p className="cm-add-error" role="alert">
          {typedError}
        </p>
      )}
      {checkup ? (
        <>
          <CheckupLines checkup={checkup} onInstall={install} onAgain={again} />
          {checkup.phase === "done" && (
            <div className="cm-add-end">
              {checkup.paired && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => requestAddProject(checkup.paired!.id)}
                >
                  Add a project on {checkup.paired.name}
                </button>
              )}
              <button type="button" onClick={another}>
                Add another
              </button>
            </div>
          )}
        </>
      ) : listOpen ? (
        <HostList
          list={matching}
          hidden={hidden}
          typed={text.trim()}
          active={active}
          onActive={setActive}
          onPick={start}
          onClose={() => setListOpen(false)}
        />
      ) : (
        <>
          {!!offered.length && (
            <div className="cm-add-hints">
              {offered.slice(0, hintCount).map((t) => (
                <button key={t.name} type="button" onClick={() => start(t)}>
                  <RouteIcon route={t.route} /> {t.name}
                </button>
              ))}
              {offered.length > hintCount && (
                <button
                  type="button"
                  className="cm-add-more"
                  onClick={() => setListOpen(true)}
                >
                  {offered.length - hintCount} more{" "}
                  <ChevronDown size={12} aria-hidden />
                </button>
              )}
            </div>
          )}
          <p className="cm-add-note">
            Over Tailscale instead? On the other computer, turn on{" "}
            <em>Accept threads from other computers</em> in Settings → Computers
            and paste its link here.
          </p>
        </>
      )}
    </div>
  );
}
