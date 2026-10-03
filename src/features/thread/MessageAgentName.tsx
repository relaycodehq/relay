import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { agentName, type AgentProvider } from "../../../shared/agents";
import { turnModelLabel, type TurnModel } from "../../../shared/turn-model";
import { ProviderIcon } from "../agents/ComposerModelPicker";

/** An answer's agent name; hovering it points a callout at the glyph with the model it ran on. */
export function MessageAgentName({
  provider,
  model,
}: {
  provider: AgentProvider;
  model?: TurnModel;
}) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const label = model ? turnModelLabel(model) : "";
  return (
    <strong
      ref={ref}
      onMouseEnter={() => label && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <ProviderIcon provider={provider} />
      {agentName(provider)}
      {open &&
        ref.current &&
        createPortal(
          <ModelCallout anchor={ref.current} label={label} />,
          document.body,
        )}
    </strong>
  );
}

const gap = 8;

/** Left of the glyph, or right of the name when the window has no room there. */
function ModelCallout({
  anchor,
  label,
}: {
  anchor: HTMLElement;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{
    side: "left" | "right";
    left: number;
    top: number;
  }>();
  useLayoutEffect(() => {
    const width = ref.current?.offsetWidth ?? 0;
    const glyph = (
      anchor.querySelector(".provider-glyph") ?? anchor
    ).getBoundingClientRect();
    const name = anchor.getBoundingClientRect();
    const top = glyph.top + glyph.height / 2;
    setPlace(
      glyph.left - gap - width >= gap
        ? { side: "left", left: glyph.left - gap - width, top }
        : { side: "right", left: name.right + gap, top },
    );
  }, [anchor]);
  return (
    <div
      ref={ref}
      className="model-callout"
      data-side={place?.side}
      role="tooltip"
      style={
        place
          ? { left: place.left, top: place.top }
          : { visibility: "hidden", left: 0, top: 0 }
      }
    >
      {label}
    </div>
  );
}
