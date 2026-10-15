import { useEffect, useMemo, useRef, useState } from "react";
import { Toast } from "@base-ui/react/toast";
import { ArrowDownToLine, Check, TriangleAlert, X } from "lucide-react";
import { api } from "../../lib/api";
import { releasesPage } from "../../../shared/updates";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { useCrashOffer } from "../bug-report/useCrashOffer";
import { RelayMark } from "../../ui/RelayMark";
import { Spinner } from "../../ui/ui";
import { useUpdates } from "./updates";
import {
  updateAgent,
  useAgentUpdateChecks,
  useAgentVersions,
} from "./agent-updates";
import { useRecent } from "./useRecent";
import {
  crashItem,
  doneFor,
  shortVersion,
  updateItems,
  type UpdateItem,
} from "./update-items";
import "./update-toasts.css";

/**
 * Relay's and the agents' updates as a stack of one-line toasts rising from
 * the sidebar footer: hover fans them out, × or a swipe left puts one off
 * until it has something new to say, and a dot brings them back. An offer to
 * report the last run's crash leads the stack; putting it off drops it.
 */
export function UpdateToasts({ onAgentDetails }: { onAgentDetails: () => void }) {
  return (
    <Toast.Provider timeout={0} limit={8}>
      <Stack onAgentDetails={onAgentDetails} />
    </Toast.Provider>
  );
}

function Stack({ onAgentDetails }: { onAgentDetails: () => void }) {
  const { state } = useUpdates();
  const crash = useCrashOffer();
  const agents = useAgentVersions()?.agents;
  const notices = useAgentUpdateChecks() === true;
  const lastUpdated = Math.max(
    0,
    ...(agents ?? []).map((a) => (a.update?.status === "updated" ? a.update.at : 0)),
  );
  // Re-renders when the last check mark is due to go.
  const justUpdated = useRecent(lastUpdated || undefined, doneFor);
  const items = useMemo(() => {
    const updates = updateItems(state, agents ?? [], notices, Date.now());
    const crashed = crashItem(crash.offer);
    return crashed ? [crashed, ...updates] : updates;
  }, [crash.offer, state, agents, notices, justUpdated]);

  const manager = Toast.useToastManager();
  const [putOff, setPutOff] = useState<ReadonlySet<string>>(new Set());
  /** Toasts this closes because their update went, not because you put them off. */
  const going = useRef(new Set<string>());
  const shown = useMemo(() => items.filter((i) => !putOff.has(i.key)), [items, putOff]);

  /** Bumped to bring the crash offer back in front as a new toast. */
  const crashTurn = useRef(0);
  const toastId = (item: UpdateItem) =>
    item.subject === "crash" ? `${item.id}:${crashTurn.current}` : item.id;

  useEffect(() => {
    const showing = new Set(manager.toasts.map((t) => t.id));
    // The crash offer stays in front: an update arriving after it would bury
    // it, so it comes back on top. Base UI can't reorder toasts, and one
    // added again under its id stays invisible, hence a new one.
    const crashed = shown.find((i) => i.subject === "crash");
    if (
      crashed &&
      showing.has(toastId(crashed)) &&
      shown.some((i) => !showing.has(toastId(i)))
    )
      crashTurn.current += 1;
    const ids = new Set(shown.map(toastId));
    for (const toast of manager.toasts)
      if (!ids.has(toast.id) && !going.current.has(toast.id)) {
        going.current.add(toast.id);
        manager.close(toast.id);
      }
    // The newest toast stacks in front; of those arriving together, Relay's.
    for (const item of [...shown].reverse()) {
      const id = toastId(item);
      going.current.delete(id);
      manager.add<UpdateItem>({
        id,
        data: item,
        onClose: () => {
          if (going.current.has(id)) return;
          if (item.subject === "crash") return crash.dismiss();
          setPutOff((keys) => new Set(keys).add(item.key));
        },
        onRemove: () => going.current.delete(id),
      });
    }
    // manager is a fresh object every render; its toasts are what's read.
  }, [shown]);

  const run = (item: UpdateItem) => {
    switch (item.run) {
      case "download":
        return void api.downloadUpdate();
      case "releases":
        return void api.openExternal(releasesPage);
      case "install":
        return void api.installUpdate();
      case "update-agent":
        return updateAgent(item.subject as Exclude<UpdateItem["subject"], "relay" | "crash">);
      case "agent-details":
        return onAgentDetails();
      case "report-crash":
        return crash.report();
    }
  };

  const waiting = items.filter((i) => putOff.has(i.key)).length;
  return (
    <>
      <Toast.Viewport className="update-toasts" aria-label="Updates">
        {manager.toasts.map((toast) => {
          const item = toast.data as UpdateItem;
          return (
            <Toast.Root
              key={toast.id}
              toast={toast}
              swipeDirection={["left", "down"]}
              className="update-toast"
            >
              <Toast.Content className="update-toast-content">
                {item.subject === "relay" ? (
                  <RelayMark size={15} />
                ) : item.subject === "crash" ? (
                  <TriangleAlert size={14} className="update-toast-warning" />
                ) : (
                  <ProviderIcon provider={item.subject} />
                )}
                <Toast.Title className="update-toast-title" title={item.title}>
                  <span className="update-toast-name">{item.name}</span>
                  <span className={item.failed ? "update-toast-version failed" : "update-toast-version"}>
                    {item.failed ? "Failed" : item.version && shortVersion(item.version)}
                  </span>
                </Toast.Title>
                <UpdateAction item={item} onRun={() => run(item)} />
                <Toast.Close
                  className="update-toast-close"
                  aria-label={item.subject === "crash" ? "Not now" : "Later"}
                  title={item.subject === "crash" ? "Not now" : "Later"}
                >
                  <X size={10} />
                </Toast.Close>
              </Toast.Content>
            </Toast.Root>
          );
        })}
      </Toast.Viewport>
      {waiting > 0 && manager.toasts.length === 0 && (
        <button
          type="button"
          className="update-toasts-later"
          title={`${waiting} update${waiting > 1 ? "s" : ""} put off`}
          aria-label="Show updates"
          onClick={() => setPutOff(new Set())}
        >
          <ArrowDownToLine size={13} />
          <i />
        </button>
      )}
    </>
  );
}

/** Keeps its label's width while busy or done, so nothing beside it moves. */
function UpdateAction({ item, onRun }: { item: UpdateItem; onRun: () => void }) {
  return (
    <button
      type="button"
      className="update-toast-action"
      data-phase={item.phase}
      disabled={item.phase !== "idle" || !item.run}
      onClick={onRun}
    >
      <span className="update-toast-label">{item.label}</span>
      {item.phase !== "idle" && (
        <span className="update-toast-overlay">
          {item.phase === "busy" ? <Spinner size={10} /> : <Check size={12} />}
        </span>
      )}
    </button>
  );
}
