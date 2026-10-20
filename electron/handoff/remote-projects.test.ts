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

it("registers a remote clone with that computer's project identity and path", async () => {
  let polls = 0;
  const call = vi.fn(async (method: string) =>
    method === "computerInfo"
      ? { bridge: 29 }
      : ++polls === 1
        ? { done: false, step: "Receiving objects", progress: 0.5 }
        : {
            done: true,
            project: { id: "there", name: "Web", folder: "~/work/web" },
          },
  );
  const client = { call };
  const computers = {
    onEvent: () => {},
    onOnline: () => {},
    get: () => ({ id: "pc", name: "Studio" }),
    status: () => "online",
    list: () => [],
    connected: async () => client,
  } as unknown as Computers;
  const addRemote = vi.fn(async () => ({ id: "here" }));
  const remote = new RemoteProjects(computers, {
    addRemote,
  } as unknown as Projects);
  expect(await remote.clone("pc", "acme/web", "~/work")).toMatchObject({
    done: false,
  });
  expect(await remote.clone("pc", "acme/web", "~/work")).toEqual({
    done: true,
    project: { id: "here" },
  });
  expect(call).toHaveBeenCalledWith("cloneProject", "acme/web", "~/work");
  // The bridge is asked once per connection, not on every poll.
  expect(call.mock.calls.filter(([m]) => m === "computerInfo")).toHaveLength(1);
  expect(addRemote).toHaveBeenCalledWith(
    { id: "pc", name: "Studio" },
    { id: "there", name: "Web", path: "~/work/web", plain: undefined },
  );
});

it("refuses an older remote before cloning into a destination it would ignore", async () => {
  const call = vi.fn(async () => ({ bridge: 28 }));
  const computers = {
    onEvent: () => {},
    onOnline: () => {},
    get: () => ({ id: "pc", name: "Studio" }),
    status: () => "online",
    list: () => [],
    connected: async () => ({ call }),
  } as unknown as Computers;
  const remote = new RemoteProjects(computers, {} as Projects);
  await expect(remote.clone("pc", "acme/web", "~/work")).rejects.toThrow(
    "Update Relay",
  );
  expect(call).toHaveBeenCalledTimes(1);
});

it("clones through the receiving service with the chosen folder and forwards setup calls there", async () => {
  const { HandoffReceiver } = await import("./receiver");
  const clone = vi.fn(async (_url: string, into: string) => ({
    id: "there",
    name: "Web",
    path: `${into}/web`,
    repository: null,
    added: 0,
  }));
  const dispatch = vi.fn(async () => ({
    cloneFolder: "/srv/projects",
    home: "/home/remote",
  }));
  const receiver = new HandoffReceiver({
    version: () => "0.18.2",
    dispatch,
    root: async () => {
      throw new Error("No repository metadata in this fixture");
    },
    adding: {
      defaultFolder: async () => "/default",
      clone,
      addAt: async () => {
        throw new Error("Not adding a folder in this fixture");
      },
    },
  } as unknown as import("./receiver").ReceiverHost);
  const call = (
    method: import("../../shared/remote").ComputerMethod,
    ...args: unknown[]
  ) => receiver.handle(method, args, { id: "sender", name: "Laptop" });
  const computers = {
    onEvent: () => {},
    onOnline: () => {},
    get: () => ({ id: "pc", name: "Studio" }),
    status: () => "online",
    list: () => [],
    connected: async () => ({ call }),
  } as unknown as Computers;
  const addRemote = vi.fn(async () => ({ id: "local-record" }));
  const remote = new RemoteProjects(computers, {
    addRemote,
  } as unknown as Projects);
  expect(await remote.clone("pc", "acme/web", "/srv/projects")).toMatchObject({
    done: true,
    project: { id: "local-record" },
  });
  expect(clone).toHaveBeenCalledWith(
    "acme/web",
    "/srv/projects",
    expect.any(Function),
  );
  expect(addRemote).toHaveBeenCalledWith(
    { id: "pc", name: "Studio" },
    expect.objectContaining({ id: "there", path: "/srv/projects/web" }),
  );
  expect(await remote.ask("pc", "addingStart")).toMatchObject({
    home: "/home/remote",
  });
  expect(dispatch).toHaveBeenCalledWith("addingStart", []);
  await remote.ask("pc", "folderPreview", "/srv/projects/web");
  expect(dispatch).toHaveBeenCalledWith("folderPreview", ["/srv/projects/web"]);
  await expect(remote.clone("pc", "acme/web", "relative")).rejects.toThrow(
    "absolute folder",
  );
  expect(clone).toHaveBeenCalledTimes(1);
});
