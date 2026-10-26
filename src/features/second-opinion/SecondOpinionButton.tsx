import { useState, type ReactElement } from "react";
import { MessagesSquare } from "lucide-react";
import { ComposerModelPicker } from "../agents/ComposerModelPicker";
import { useCatalogs } from "../agents/useCatalogs";
import { useOfferedAgents } from "../agents/registry-agents";
import {
  useAskSecondOpinion,
  type SecondOpinionTarget,
} from "./second-opinion-ask";
import "./second-opinion.css";

const LABEL = "Second opinion";

/**
 * Among an answer's actions: picks another agent and model to check it.
 * The picker mounts on the first click, so a long thread's answers don't
 * each carry one.
 */
export function SecondOpinionButton({
  target,
}: {
  target: SecondOpinionTarget;
}) {
  const [picking, setPicking] = useState(false);
  const button = (
    <button
      type="button"
      title={LABEL}
      aria-label="Ask another agent for a second opinion"
      onClick={picking ? undefined : () => setPicking(true)}
    >
      <MessagesSquare size={15} />
    </button>
  );
  if (!picking) return button;
  return <SecondOpinionPicker target={target} trigger={button} />;
}

function SecondOpinionPicker({
  target,
  trigger,
}: {
  target: SecondOpinionTarget;
  trigger: ReactElement;
}) {
  const catalogs = useCatalogs();
  const offered = useOfferedAgents(target.provider);
  const ask = useAskSecondOpinion(target);
  return (
    <ComposerModelPicker
      provider={target.provider}
      providers={offered}
      label={LABEL}
      // Every agent opens on its Default; none is "the one picked".
      catalogs={Object.fromEntries(
        offered.map((a) => [a, { models: catalogs.modelsOf(a), model: "" }]),
      )}
      onOpen={catalogs.refresh}
      // Mounted by the first click, it opens at once.
      openSignal={1}
      trigger={trigger}
      onSelect={(provider, model) => {
        if (provider !== "message") ask.mutate({ provider, model });
      }}
    />
  );
}
