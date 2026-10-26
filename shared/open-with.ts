import { z } from "zod";

/** An editor or IDE on this computer that a project's files can open in. */
export interface OpenWithApp {
  id: string;
  name: string;
  /** Its icon as a data URL; "" when the system gave none. */
  icon: string;
}

export const openWithAppIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

/** The ways a project's file opens outside Relay: an editor, the default app, the file manager. */
export interface OpenWithApi {
  /** Opens a folder in the file manager, or selects a file in its folder; "" is the root. */
  revealProjectPath(where: string, path: string): Promise<void>;
  /** Opens a file in the app the system picks for it. */
  openProjectPath(where: string, path: string): Promise<void>;
  /** The editors and IDEs found on this computer, in the order to offer them. */
  openWithApps(): Promise<OpenWithApp[]>;
  /** Opens a file in one of `openWithApps`, by its id. */
  openProjectPathWith(
    where: string,
    path: string,
    appId: string,
  ): Promise<void>;
}
