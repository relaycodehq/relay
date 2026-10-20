import { expect, it, vi } from "vitest";
import type { Projects } from "../projects/projects";
import type { Computers } from "./computers";
import { RemoteProjects } from "./remote-projects";

const computer = (stopped: boolean) =>
  ({
    onEvent: () => {},
    onOnline: () => {},
    get: () => ({ id: "wsl", name: "Ubuntu" }),
    status: () => "offline",
    list: () => [
      {
        id: "wsl",
        name: "Ubuntu",
        status: "offline",
        ...(stopped && { stopped: true }),
      },
    ],
    connected: vi.fn(async () => {
      throw new Error("WSL stopped Ubuntu. Reconnect to start it again.");
    }),
  }) as unknown as Computers;

it("says WSL stopped a distribution rather than that it's offline", async () => {
  const stopped = new RemoteProjects(computer(true), {} as Projects);
  await expect(stopped.folders("wsl", "~")).rejects.toThrow(
    "WSL stopped Ubuntu. Reconnect to start it again.",
  );
  const offline = new RemoteProjects(computer(false), {} as Projects);
  await expect(offline.folders("wsl", "~")).rejects.toThrow(
    "Ubuntu is offline.",
  );
});
