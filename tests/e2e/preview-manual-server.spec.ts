import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { createServer, connect } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { openSurface } from "../fixtures/navigation";
import { screenshot } from "../fixtures/screenshot";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

async function port() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const p = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return p;
}
async function stop(child: { pid: number }) {
  try {
    process.kill(child.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
test("discovers manual servers and keeps issued named links bound to their original ports", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-manual-preview-")),
    ),
    repo = join(root, "autago");
  await mkdir(repo);
  const bin = join(root, "bin");
  await mkdir(bin);
  const script = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["codex", "claude"])
    await fakeCli(join(bin, name), script);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  await writeFile(
    join(repo, "server.cjs"),
    `require('http').createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Manual fixture</title><h1>Port '+process.env.PORT+'</h1><p>'+req.url+'</p>')}).listen(+process.env.PORT,'127.0.0.1',()=>console.log('ready'));`,
  );
  git("add", ".");
  git("commit", "-qm", "Base");
  const launch = async (p: number, folder = repo) => {
    // Reproduce the detached server an agent's completed shell leaves behind.
    const child = spawn(
      process.execPath,
      [
        "-e",
        "const {spawn}=require('child_process');const child=spawn(process.execPath,['server.cjs'],{detached:true,stdio:'ignore'});console.log(String(child.pid));child.unref();",
      ],
      {
        cwd: folder,
        env: { ...process.env, PORT: String(p) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "",
      errors = "";
    child.stdout!.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr!.on("data", (chunk) => {
      errors += chunk;
    });
    await once(child, "exit");
    const pid = Number(out.trim());
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error(`Server fixture failed: ${out} ${errors}`);
    await expect
      .poll(
        () =>
          new Promise<boolean>((resolve) => {
            const socket = connect({ host: "127.0.0.1", port: p });
            const done = (open: boolean) => {
              socket.destroy();
              resolve(open);
            };
            socket.once("connect", () => done(true));
            socket.once("error", () => done(false));
            socket.setTimeout(500, () => done(false));
          }),
      )
      .toBe(true);
    return { pid };
  };
  const firstPort = await port();
  let server = await launch(firstPort);
  let worktreeServer: { pid: number } | undefined;
  const extraServers: { pid: number }[] = [];
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) =>
        k !== "ELECTRON_RUN_AS_NODE" &&
        k !== "RELAY_DEV_URL" &&
        v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  const external = await browser.newPage();
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog, shell }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
      shell.openExternal = async (url) => {
        (
          globalThis as typeof globalThis & { externalUrl?: string }
        ).externalUrl = url;
      };
    }, repo);
    const project = await page.evaluate(() => window.relay.addProject());
    // A normal chat answer names the server without opening a Browser surface
    // or calling an MCP preview tool. This is the shell-only workflow.
    await expect
      .poll(
        () =>
          page.evaluate(
            async (id) =>
              (await window.relay.projectTasks(id)).flatMap((t) => t.ports),
            project!.id,
          ),
        { timeout: 20_000 },
      )
      .toContain(firstPort);
    const ordinary = await page.evaluate(
      (id) => window.relay.createProjectChat(id, { kind: "project" }),
      project!.id,
    );
    await page.evaluate(
      ({ id, port }) =>
        window.relay.sendProjectChat(id, {
          id: crypto.randomUUID(),
          body: `@codex fixture echo: [How-it-works page](http://127.0.0.1:${port}/how-it-works?q=1#details)`,
          provider: "codex",
          choice: { model: "", fast: false, reasoningEffort: "" },
          runtimeMode: "full-access",
          interactionMode: "default",
        }),
      { id: ordinary.id, port: firstPort },
    );
    const answer = () =>
      page.evaluate(async (id) => {
        const chat = await window.relay.projectChat(id);
        return chat.messages
          .filter((m): m is Exclude<typeof m, string> => typeof m !== "string")
          .filter((m) => m.role === "assistant")
          .at(-1);
      }, ordinary.id);
    await expect
      .poll(async () => (await answer())?.status, { timeout: 30_000 })
      .toBe("complete");
    const automatic = (await answer())!.body.match(/\]\((http:[^)]+)\)/)![1]!;
    expect(automatic).toMatch(/\.autago\.relay\.localhost:/);
    expect(new URL(automatic).pathname).toBe("/how-it-works");
    await external.goto(automatic);
    await expect(external.getByRole("heading")).toHaveText(`Port ${firstPort}`);
    expect(
      await app.evaluate(
        ({ webContents }, port) =>
          webContents
            .getAllWebContents()
            .filter((wc) => wc.getURL().includes(`:${port}/`)).length,
        firstPort,
      ),
    ).toBe(0);
    // No saved command or dev port. The process scanner supplies the current HTTP port.
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) => window.relay.openPreview(id, null),
            project!.id,
          ),
        { timeout: 20_000 },
      )
      .toMatchObject({
        url: `http://localhost:${firstPort}/`,
        title: "Manual fixture",
      });
    await page.reload();
    await openSurface(page, "Browser");
    const panel = page.locator('[data-pane="panel"]');
    await panel
      .getByRole("button", { name: "Open in browser", exact: true })
      .click();
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as typeof globalThis & { externalUrl?: string })
              .externalUrl ?? "",
        ),
      )
      .toMatch(/^http:/);
    const named = await app.evaluate(
      () =>
        (globalThis as typeof globalThis & { externalUrl?: string })
          .externalUrl!,
    );
    await external.goto(named + "how-it-works?q=1");
    await expect(external.getByRole("heading")).toHaveText(`Port ${firstPort}`);
    await expect(external.locator("p")).toHaveText("/how-it-works?q=1");
    await stop(server);
    const nextPort = await port();
    server = await launch(nextPort);
    // Discovering a replacement must not reassign the original named link.
    await expect
      .poll(
        () =>
          page.evaluate(
            async (id) =>
              (await window.relay.projectTasks(id)).flatMap(
                (task) => task.ports,
              ),
            project!.id,
          ),
        { timeout: 15_000 },
      )
      .toContain(nextPort);
    expect((await external.reload())?.status()).toBe(502);
    expect(external.url()).toBe(named + "how-it-works?q=1");
    await page.evaluate(
      async ({ projectId, port }) => {
        const key = `draft:${projectId}`;
        await window.relay.navigatePreview(
          projectId,
          null,
          `http://localhost:${port}/`,
        );
        await window.relay.previewAction(key, "openExternal");
      },
      { projectId: project!.id, port: nextPort },
    );
    const replacement = await app.evaluate(
      () =>
        (globalThis as typeof globalThis & { externalUrl?: string })
          .externalUrl!,
    );
    expect(replacement).not.toBe(named);
    await external.goto(replacement + "how-it-works?q=1");
    await expect(external.getByRole("heading")).toHaveText(`Port ${nextPort}`);
    await expect(external.locator("p")).toHaveText("/how-it-works?q=1");
    expect((await external.goto(named))?.status()).toBe(502);

    // Checkout chats seed their cookies from the checkout, then remain isolated.
    await app.evaluate(
      async ({ session }, { projectId, port }) => {
        await session
          .fromPartition(`persist:project-${projectId}`)
          .cookies.set({
            url: `http://localhost:${port}/`,
            name: "preview-fixture",
            value: "checkout",
          });
      },
      { projectId: project!.id, port: nextPort },
    );
    await page.evaluate(
      ({ projectId, chatId }) => window.relay.openPreview(projectId, chatId),
      { projectId: project!.id, chatId: ordinary.id },
    );
    const cookie = (partition: string) =>
      app.evaluate(
        async ({ session }, partition) =>
          (
            await session
              .fromPartition(partition)
              .cookies.get({ name: "preview-fixture" })
          )[0]?.value,
        partition,
      );
    expect(await cookie(`persist:thread-${ordinary.id}`)).toBe("checkout");
    await app.evaluate(
      async ({ session }, { id, port }) => {
        await session.fromPartition(`persist:thread-${id}`).cookies.set({
          url: `http://localhost:${port}/`,
          name: "preview-fixture",
          value: "first-thread",
        });
      },
      { id: ordinary.id, port: nextPort },
    );
    const second = await page.evaluate(
      (id) => window.relay.createProjectChat(id, { kind: "project" }),
      project!.id,
    );
    await page.evaluate(
      ({ projectId, chatId }) => window.relay.openPreview(projectId, chatId),
      { projectId: project!.id, chatId: second.id },
    );
    expect(await cookie(`persist:thread-${second.id}`)).toBe("checkout");
    expect(await cookie(`persist:thread-${ordinary.id}`)).toBe("first-thread");
    expect(await cookie(`persist:project-${project!.id}`)).toBe("checkout");

    // Let the fake agent create a real worktree: the normal activity watcher
    // must credit it before both the Browser and answer links can use it.
    const manualFolder = join(root, "manual-worktree");
    await page.evaluate(
      ({ id, folder }) =>
        window.relay.sendProjectChat(id, {
          id: crypto.randomUUID(),
          body: `@codex fixture make worktree ${JSON.stringify({ folder, branch: "manual-preview" })}`,
          provider: "codex",
          choice: { model: "", fast: false, reasoningEffort: "" },
          runtimeMode: "full-access",
          interactionMode: "default",
        }),
      { id: ordinary.id, folder: manualFolder },
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ id, folder }) => {
              const chat = await window.relay.projectChat(id);
              return (
                !chat.running &&
                chat.agentWorktrees?.some((w) => w.path === folder)
              );
            },
            { id: ordinary.id, folder: manualFolder },
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const manualPort = await port();
    const manualServer = await launch(manualPort, manualFolder);
    extraServers.push(manualServer);
    await expect
      .poll(
        () =>
          page.evaluate(
            ({ projectId, chatId }) =>
              window.relay.openPreview(projectId, chatId),
            { projectId: project!.id, chatId: ordinary.id },
          ),
        { timeout: 20_000 },
      )
      .toMatchObject({
        url: `http://localhost:${manualPort}/`,
        worktree: "manual-preview",
      });

    const namedPage = async (p: number) => {
      await page.evaluate(
        async ({ projectId, id, port }) => {
          await window.relay.navigatePreview(
            projectId,
            id,
            `http://localhost:${port}/how-it-works`,
          );
          await window.relay.previewAction(id, "openExternal");
        },
        { projectId: project!.id, id: ordinary.id, port: p },
      );
      return app.evaluate(
        () =>
          (globalThis as typeof globalThis & { externalUrl?: string })
            .externalUrl!,
      );
    };
    // Issue A while it is the only server, then add B in the same worktree.
    const manualA = await namedPage(manualPort);
    const anotherPort = await port();
    extraServers.push(await launch(anotherPort, manualFolder));
    expect(await namedPage(manualPort)).toBe(manualA);
    const manualB = await namedPage(anotherPort);
    expect(new URL(manualA).hostname).not.toBe(new URL(manualB).hostname);
    await external.goto(manualB);
    await expect(external.getByRole("heading")).toHaveText(
      `Port ${anotherPort}`,
    );
    await external.goto(manualA);
    await expect(external.getByRole("heading")).toHaveText(
      `Port ${manualPort}`,
    );
    expect(manualA).toMatch(/^http:\/\/manual-preview-/);
    expect(manualB).toContain(`p-${anotherPort}.manual-preview-`);
    // Losing A cannot turn its existing link into a link to the surviving B.
    await stop(manualServer);
    expect((await external.goto(manualA))?.status()).toBe(502);
    await expect(external.locator("body")).toContainText(
      `isn't answering on port ${manualPort}`,
    );
    await external.goto(manualB);
    await expect(external.getByRole("heading")).toHaveText(
      `Port ${anotherPort}`,
    );
    expect(await namedPage(anotherPort)).toBe(manualB);
    expect((await external.goto(manualA))?.status()).toBe(502);
    // A simultaneous worktree server must not be mistaken for the checkout's.
    const chat = await page.evaluate(
      (id) =>
        window.relay.createProjectChat(
          id,
          { kind: "project" },
          "worktree",
          "feat/how-it-works",
        ),
      project!.id,
    );
    await page.evaluate(
      (id) =>
        window.relay.sendProjectChat(id, {
          id: crypto.randomUUID(),
          body: "fixture hello",
          provider: "codex",
          choice: { model: "", fast: false, reasoningEffort: "" },
          runtimeMode: "full-access",
          interactionMode: "default",
        }),
      chat.id,
    );
    const ready = () =>
      page.evaluate(
        async ({ projectId, chatId }) =>
          (await window.relay.projectChats(projectId)).find(
            (c) => c.id === chatId,
          ),
        { projectId: project!.id, chatId: chat.id },
      );
    await expect
      .poll(
        async () => {
          const chat = await ready();
          return !!chat?.worktree?.path && !chat.running;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const worktreePort = await port();
    worktreeServer = await launch(
      worktreePort,
      (await ready())!.worktree!.path!,
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            ({ projectId, chatId }) =>
              window.relay.openPreview(projectId, chatId),
            { projectId: project!.id, chatId: chat.id },
          ),
        { timeout: 20_000 },
      )
      .toMatchObject({
        url: `http://localhost:${worktreePort}/`,
        title: "Manual fixture",
        worktree: "feat/how-it-works",
      });
    await page.evaluate(
      (key) => window.relay.previewAction(key, "openExternal"),
      chat.id,
    );
    const worktreeUrl = await app.evaluate(
      () =>
        (globalThis as typeof globalThis & { externalUrl?: string })
          .externalUrl!,
    );
    expect(worktreeUrl).toMatch(
      /^http:\/\/feat-how-it-works-[a-f0-9]{8}\.autago\.relay\.localhost:/,
    );
    await external.goto(worktreeUrl);
    await expect(external).toHaveTitle("[feat/how-it-works] Manual fixture");
    await expect(external.getByRole("heading")).toHaveText(
      `Port ${worktreePort}`,
    );
    await external.goto(replacement);
    await expect(external.getByRole("heading")).toHaveText(`Port ${nextPort}`);
    await panel
      .getByRole("button", { name: "All previews in browser" })
      .click();
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as typeof globalThis & { externalUrl?: string })
              .externalUrl ?? "",
        ),
      )
      .toMatch(/^http:\/\/relay\.localhost:/);
    const index = await app.evaluate(
      () =>
        (globalThis as typeof globalThis & { externalUrl?: string })
          .externalUrl!,
    );
    await external.goto(index);
    await expect(
      external.getByRole("heading", { name: "Relay previews" }),
    ).toBeVisible();
    await expect(
      external
        .locator(`a[href="${replacement}"]`)
        .getByRole("img", { name: "Last preview of autago" }),
    ).toBeVisible();
    await screenshot(external, { path: "test-results/preview-index.png" });
    await screenshot(panel, {
      path: "test-results/preview-browser-controls.png",
    });
  } finally {
    await external.close();
    await app.close();
    await stop(server);
    if (worktreeServer) await stop(worktreeServer);
    for (const child of extraServers) await stop(child);
    await rm(root, { recursive: true, force: true });
  }
});
