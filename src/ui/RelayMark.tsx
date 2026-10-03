import { useMemo } from "react";
import { useAppearance } from "../lib/appearance";
import { relayMarkSvg, svgDataUrl } from "../lib/relay-icon";
import "./relay-mark.css";

/** Decorative wordmark companion; the adjacent Relay label supplies its name. */
export function RelayMark({
  size = 32,
  accent,
}: {
  size?: number;
  /** Preview a colour other than the active theme's accent. */
  accent?: string;
}) {
  const current = useAppearance().accent;
  const color = accent ?? current;
  const src = useMemo(() => svgDataUrl(relayMarkSvg(color)), [color]);
  return (
    <img
      className="relay-mark"
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
