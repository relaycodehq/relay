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

it("doesn't wake a sleeping WSL distribution for the sidebar's icon, and shows the last one it gave", async () => {
  let asleep = true;
  const client = { call: vi.fn(async () => "data:image/png;base64,AAAA") };
  const computers = {
    onEvent: () => {},
    onOnline: () => {},
    get: () => ({ id: "wsl", name: "Ubuntu" }),
    status: () => "online",
    list: () => [{ id: "wsl", name: "Ubuntu", status: "offline", asleep }],
    asleep: () => asleep,
    connected: vi.fn(async () => {
      asleep = false;
      return client;
    }),
  } as unknown as Computers;
  const projects = {
    get: () => ({
      id: "p",
      computer: { id: "wsl", name: "Ubuntu", projectId: "there" },
    }),
  } as unknown as Projects;
  const remote = new RemoteProjects(computers, projects);
  const icon = () => remote.forward("projectIcon", ["p"], () => {});
  expect(await icon()).toBeNull();
  expect(computers.connected).not.toHaveBeenCalled();
  // Anything else the project needs wakes it, and the icon is asked then.
  await remote.forward("projectBranches", ["p"], () => {});
  expect(await icon()).toBe("data:image/png;base64,AAAA");
  asleep = true;
  expect(await icon()).toBe("data:image/png;base64,AAAA");
  expect(client.call).toHaveBeenCalledTimes(2);
});
