import type { RegistryProvider } from "./agents";

/** How Relay gets a registry agent onto this machine. */
export type RegistryVia = "download" | "npm" | "uv";

/** One agent the ACP registry lists, as Settings shows it. */
export interface RegistryListing {
  id: string;
  name: string;
  version: string;
  description: string;
  authors: string[];
  license?: string;
  website?: string;
  /** Its 16×16 one-colour mark as a `data:` URI, drawn in the ink colour. */
  icon?: string;
  /** Absent when it has no build for this machine. */
  via?: RegistryVia;
  /** The download's checksum is in the registry, so Relay checks it. */
  verified?: boolean;
}

/** A registry agent Relay installed. */
export interface InstalledRegistryAgent {
  provider: RegistryProvider;
  id: string;
  name: string;
  version: string;
  via: RegistryVia;
  icon?: string;
}

export interface RegistryAgentsState {
  installed: InstalledRegistryAgent[];
  /** Registry ids being installed or removed right now. */
  busy: Record<string, "installing" | "removing">;
}
