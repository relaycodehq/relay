import { shell } from "electron";

/** Opens a folder or file with the system, and says why when it can't. */
export async function openPath(path: string | Promise<string>) {
  const error = await shell.openPath(await path);
  if (error) throw new Error(error);
}
