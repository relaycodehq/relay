import { afterEach, expect, it, vi } from "vitest";
import { createServer, request } from "node:http";
import { once } from "node:events";
import type { ProjectChat } from "../../shared/projects";
import type { ProjectTask } from "../../shared/tasks";
import { projectTasks } from "../terminal/tasks";
import { LocalUrls } from "./local-urls";
import * as runningServers from "./running-server";
import { nameLocalLinks, ServerLinks } from "./server-links";

vi.mock("../git/git", () => ({
  currentBranchOr: async () => "feat/how-it-works",
}));
const clean: (() => void)[] = [];
afterEach(() => {
  clean
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  vi.restoreAllMocks();
});
async function server(label: string) {
  const s = createServer((req, res) => res.end(label + req.url));
  clean.push(() => {
    s.closeAllConnections();
    s.close();
  });
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  return { server: s, port: (s.address() as { port: number }).port };
}
function task(folder: string, ports: number[]): ProjectTask {
  return {
    id: folder,
    folder,
    ports,
    command: "npm run dev",
    kind: "server",
    title: "Dev server",
    origin: "detached",
    pids: 1,
    started: 1,
  };
}
function setup(tasks: ProjectTask[]) {
  const scan = vi.spyOn(projectTasks, "list").mockResolvedValue(tasks);
  const urls = new LocalUrls(0);
  clean.push(() => urls.dispose());
  const links = new ServerLinks(urls, async () => ({
    project: "Autago",
    root: "/repo",
    worktrees: [{ path: "/repo/worktree", chatId: "thread" }],
    allowed: ["/repo", "/repo/worktree"],
  }));
  return { scan, links, urls, chat: { id: "thread" } as ProjectChat };
}
function response(url: string) {
  const p = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    request(
      {
        hostname: "127.0.0.1",
        port: p.port,
        path: p.pathname + p.search,
        headers: { host: p.host },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.once("end", () => resolve({ status: res.statusCode!, body }));
        res.once("error", reject);
      },
    )
      .once("error", reject)
      .end();
  });
}
async function get(url: string) {
  return (await response(url)).body;
}
function destination(body: string) {
  return body.match(/\]\((http:[^)]+)\)/)![1]!;
}

it("names clickable links and references, preserves code and unowned ports", async () => {
  const url = "http://localhost:3000/how-it-works?q=1#details";
  const named =
    "http://fix-login.app.relay.localhost:1377/how-it-works?q=1#details";
  const body = `[Page](${url})\n\n<${url}>\n\n${url}\n\n[Reference][page]\n\n[page]: ${url}\n\n\`${url}\`\n\n\`\`\`sh\ncurl ${url}\n\`\`\`\n\n[Other](http://localhost:8000/)\n\n[Remote](https://example.com/)`;
  const calls: string[] = [];
  const result = await nameLocalLinks(body, async (source) => {
    calls.push(source);
    return source === url ? named : undefined;
  });
  expect(result).toBe(
    `[Page](${named})\n\n<${named}>\n\n${named}\n\n[Reference][page]\n\n[page]: ${named}\n\n\`${url}\`\n\n\`\`\`sh\ncurl ${url}\n\`\`\`\n\n[Other](http://localhost:8000/)\n\n[Remote](https://example.com/)`,
  );
  expect(calls).toEqual([url, "http://localhost:8000/"]);
});

it("changes the destination without replacing an explicit localhost label", async () => {
  expect(
    await nameLocalLinks(
      "[http://localhost:3000/](http://localhost:3000/)",
      async () => "http://worktree.app.relay.localhost:1377/",
    ),
  ).toBe("[http://localhost:3000/](http://worktree.app.relay.localhost:1377/)");
});

it.each([
  "http://localhost",
  "http://127.0.0.1",
  "http://[::1]",
  "http://localhost:80",
  "http://localhost/settings?q=1#details",
  "http://localhost?q=1#details",
])(
  "names port 80 links including an implicit default port: %s",
  async (source) => {
    vi.spyOn(runningServers, "runningServerPorts").mockResolvedValue([80]);
    const { links, chat } = setup([task("/repo/worktree", [80])]);
    const named = new URL(
      destination(await links.answer(chat, `[Page](${source})`)),
    );
    const original = new URL(source);
    expect(named.hostname).toMatch(/\.autago\.relay\.localhost$/);
    expect(named.pathname + named.search + named.hash).toBe(
      original.pathname + original.search + original.hash,
    );
  },
);

it("routes the owned port and leaves the original link unavailable after a port change", async () => {
  const own = await server("own "),
    other = await server("other ");
  const { links, scan, chat } = setup([
    task("/repo/worktree", [own.port]),
    task("/repo/other-worktree", [other.port]),
  ]);
  const body = await links.answer(
    chat,
    `[Page](http://127.0.0.1:${own.port}/how-it-works?q=1#details)`,
  );
  const named = destination(body);
  expect(new URL(named).hostname).toMatch(
    /^feat-how-it-works-[a-f0-9]+\.autago\.relay\.localhost$/,
  );
  expect(await get(named)).toBe("own /how-it-works?q=1");
  const unowned = `[Other](http://localhost:${other.port}/)`;
  expect(await links.answer(chat, unowned)).toBe(unowned);
  own.server.closeAllConnections();
  await new Promise<void>((r) => own.server.close(() => r()));
  const next = await server("new ");
  scan.mockResolvedValue([task("/repo/worktree", [next.port])]);
  expect((await response(named)).status).toBe(502);
  const replacement = destination(
    await links.answer(
      chat,
      `[Page](http://localhost:${next.port}/how-it-works?q=1)`,
    ),
  );
  expect(replacement).not.toBe(named);
  expect(await get(replacement)).toBe("new /how-it-works?q=1");
  expect(await links.note(chat)).toContain(`localhost:${next.port}`);
  expect((await response(named)).status).toBe(502);
});

it("gives simultaneous HTTP services distinct routes rather than replacing the first", async () => {
  const a = await server("a "),
    b = await server("b ");
  const { links, chat } = setup([task("/repo/worktree", [a.port, b.port])]);
  const namedA = destination(
    await links.answer(chat, `[A](http://localhost:${a.port}/a)`),
  );
  const namedB = destination(
    await links.answer(chat, `[B](http://localhost:${b.port}/b)`),
  );
  expect(new URL(namedA).hostname).not.toBe(new URL(namedB).hostname);
  expect(await get(namedA)).toBe("a /a");
  expect(await get(namedB)).toBe("b /b");
});

it("uses the same service routes for Browser links and completed answers", async () => {
  const a = await server("a "),
    b = await server("b ");
  const { links, urls, chat } = setup([
    task("/repo/worktree", [a.port, b.port]),
  ]);
  const first = await urls.url(
    await links.route(chat, "/repo/worktree", a.port),
  );
  const second = await urls.url(
    await links.route(chat, "/repo/worktree", b.port),
  );
  expect(new URL(first).hostname).not.toBe(new URL(second).hostname);
  expect(
    destination(await links.answer(chat, `[A](http://localhost:${a.port}/)`)),
  ).toBe(first);
  expect(await get(first)).toBe("a /");
  expect(await get(second)).toBe("b /");
  expect(await get(first)).toBe("a /");
});

it.each(["browser", "answer"] as const)(
  "keeps existing %s links bound through one server → two servers → original stops",
  async (source) => {
    const a = await server("original ");
    const { links, urls, chat, scan } = setup([
      task("/repo/worktree", [a.port]),
    ]);
    const name = async (port: number) =>
      source === "browser"
        ? urls.url(await links.route(chat, "/repo/worktree", port))
        : destination(
            await links.answer(chat, `[Page](http://localhost:${port}/)`),
          );
    const original = await name(a.port);
    expect(await get(original)).toBe("original /");

    const b = await server("second ");
    scan.mockResolvedValue([task("/repo/worktree", [a.port, b.port])]);
    const second = await name(b.port);
    expect(second).not.toBe(original);
    expect(await name(a.port)).toBe(original);
    expect(await get(original)).toBe("original /");
    expect(await get(second)).toBe("second /");

    a.server.closeAllConnections();
    await new Promise<void>((resolve) => a.server.close(() => resolve()));
    scan.mockResolvedValue([task("/repo/worktree", [b.port])]);
    // A request must not choose the surviving service during wake.
    expect((await response(original)).status).toBe(502);
    expect(await get(second)).toBe("second /");
    // Neither a fresh Browser/answer link nor context discovery may steal A's name.
    expect(await name(b.port)).toBe(second);
    await links.note(chat);
    expect((await response(original)).status).toBe(502);
    expect(await get(second)).toBe("second /");
  },
);
