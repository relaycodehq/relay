import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import { openInbox } from "../fixtures/navigation";

test("shows available PRs while a search is stalled and recovers its connection without a restart", async () => {
  let phase: "pending" | "offline" | "online" = "pending";
  let available = true;
  const held = new Set<ServerResponse>();
  const searches: string[] = [];
  const issue = (number: number, title: string) => ({
    id: number,
    number,
    title,
    state: "open",
    user: { id: 2, login: "teammate" },
    repository: { owner: "team", name: "sample", full_name: "team/sample" },
    comments: 0,
    body: "Sample pull request",
    html_url: "https://example.invalid/pulls/" + number,
    updated_at: new Date().toISOString(),
    labels: [],
    pull_request: { merged: false },
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://fixture");
    const json = (value: unknown) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(value));
    };
    if (url.pathname === "/api/v1/user") return json({ id: 1, login: "me" });
    if (url.pathname === "/api/v1/repos/issues/search") {
      const filter = ["review_requested", "assigned", "created"].find((name) =>
        url.searchParams.has(name),
      )!;
      searches.push(filter);
      if (filter === "review_requested") {
        if (phase === "pending") {
          held.add(response);
          response.on("close", () => held.delete(response));
          return;
        }
        if (phase === "offline") return response.destroy();
        return json([issue(8, "Recovered PR")]);
      }
      return json(
        filter === "assigned" && available ? [issue(7, "Available PR")] : [],
      );
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const root = await mkdtemp(join(tmpdir(), "relay-pulls-offline-"));
  const app = await electron.launch({
    env: { ...relayEnv(), RELAY_TEST_DATA: join(root, "data") },
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "Open settings", exact: true }),
    ).toBeVisible();
    await page.evaluate(
      (url) => window.relay.connect(url, "sample-token"),
      address,
    );
    await page.reload();
    await openInbox(page);
    const board = page.locator(".pulls-page");
    await expect(
      board.getByRole("button", { name: /Available PR/ }).first(),
    ).toBeVisible();
    await expect(board.getByRole("status")).toHaveText("Waiting for Gitea…");
    await expect(board).toContainText("Showing available pull requests");
    await expect(board).not.toContainText("Nothing needs you");
    await page.screenshot({
      path: join(tmpdir(), "relay-pr-partial-loading.png"),
    });

    phase = "offline";
    for (const response of held) response.destroy();
    const warning = board.getByRole("alert");
    await expect(warning).toContainText(
      "Couldn’t load pull requests from Gitea",
    );
    await expect(warning).toContainText("Could not connect");
    await expect(
      board.getByRole("button", { name: /Available PR/ }).first(),
    ).toBeVisible();
    await expect(board.getByRole("status")).toHaveCount(0);
    await page.screenshot({ path: join(tmpdir(), "relay-pr-offline.png") });

    phase = "online";
    await warning.getByRole("button", { name: "Try again" }).click();
    await expect(
      board.getByRole("button", { name: /Recovered PR/ }).first(),
    ).toBeVisible();
    await expect(warning).toHaveCount(0);
    await expect(board.getByRole("status")).toHaveCount(0);
    expect(searches.filter((filter) => filter === "assigned")).toHaveLength(1);
    expect(searches.filter((filter) => filter === "created")).toHaveLength(1);
    await page.screenshot({ path: join(tmpdir(), "relay-pr-recovered.png") });
    // A failed provider mustn't turn an empty answer into "No pull requests".
    available = false;
    phase = "offline";
    await board.getByRole("radio", { name: "Closed", exact: true }).click();
    await expect(warning).toContainText(
      "Couldn’t load pull requests from Gitea",
    );
    await expect(
      board.getByRole("heading", {
        name: "No pull requests loaded",
        exact: true,
      }),
    ).toBeVisible();
    await expect(board).not.toContainText("No closed pull requests");
    await expect(board.getByRole("status")).toHaveCount(0);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});
