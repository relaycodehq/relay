import { createContext, useContext, type ReactNode } from "react";

/** What a plugin's settings call after a save, so its card can say so. */
export const PluginSavedContext = createContext<() => void>(() => {});
export const usePluginSaved = () => useContext(PluginSavedContext);

/** A muted status line in a plugin card's header; `attention` while it needs setting up. */
export function PluginStatus({
  children,
  attention,
}: {
  children: ReactNode;
  attention?: boolean;
}) {
  return (
    <small className={attention ? "plugin-attention" : ""}>{children}</small>
  );
}
