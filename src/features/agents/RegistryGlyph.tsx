import type { CSSProperties } from "react";
import { Bot } from "lucide-react";
import type { RegistryProvider } from "../../../shared/agents";
import { registryIcon, useRegistryAgents } from "./registry-agents";
import "./acp-registry.css";

/**
 * A registry agent's mark: its one-colour SVG from the registry, drawn as a
 * mask in the text colour like Relay's own logos. A robot when it has none.
 */
export function RegistryGlyph({
  provider,
  icon,
  className,
  size,
  style,
}: {
  provider?: RegistryProvider;
  /** The mark itself, when it isn't an installed agent's. */
  icon?: string;
  className?: string;
  size?: number;
  style?: CSSProperties;
}) {
  useRegistryAgents();
  const mark = icon ?? (provider && registryIcon(provider));
  const box = size ? { width: size, height: size } : {};
  if (!mark)
    return <Bot className={className} style={{ ...box, ...style }} aria-hidden />;
  const url = `url("${mark}")`;
  return (
    <span
      className={`registry-glyph ${className ?? ""}`}
      style={{ ...box, maskImage: url, WebkitMaskImage: url, ...style }}
      aria-hidden
    />
  );
}
