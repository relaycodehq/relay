import { screenshot } from "../fixtures/screenshot";
import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "../fixtures/electron";
import { mkdtemp, mkdir, readFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

const ANSWER = [
  "Ideas, cheapest wins first:",
  "",
  "1. Open threads from the cache",
  "2. Skip the re-render on every heartbeat",
  "3. Optimistic sends with an outbox",
].join("\n");

/** Sends `body` and waits for the fixture's answer to finish. */
async function ask(page: Page, body: string) {
  const answers = page.getByRole("article", { name: "codex answer" });
  const before = await answers.count();
  await page.getByLabel("Message project").fill(body);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Stop answer", exact: true }),
  ).toHaveCount(0, { timeout: 15000 });
  return answers.last();
}

/** A Relay on its own data, with fake agents and one empty project open. */
async function start() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-notes-")));
  const bin = join(root, "bin"),
    repo = join(root, "app"),
    data = join(root, "data");
  const env = relayEnv();
  const launch = () =>
    electron.launch({
      env: {
        ...env,
        ...pathWith(env, bin),
        RELAY_TEST_DATA: data,
      },
    });
  await mkdir(bin);
  const script = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["codex", "claude"])
    await fakeCli(join(bin, name), script);
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const app = await launch();
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, repo);
  await page.evaluate(() => window.relay.addProject());
  await page.reload();
  return { root, app, page, launch };
}

test("keeps lists, selections and an agent's note in the thread's notes, across a restart", async () => {
  test.setTimeout(150000);
  let root: string | undefined;
  let app: ElectronApplication | undefined;
  try {
    const started = await start();
    root = started.root;
    app = started.app;
    let page = started.page;
    const launch = started.launch;

    const answer = await ask(page, `fixture echo: ${ANSWER}`);
    const chip = page.locator(".notes-chip");
    await expect(chip).toHaveCount(0);

    // The pin on the answer's list keeps it, numbers and all.
    await answer.locator(".markdown-list").hover();
    const pin = answer.getByRole("button", { name: "Keep in notes" });
    await pin.click();
    await expect(chip).toHaveText("1");
    await expect(
      answer.getByRole("button", { name: "Remove from notes" }),
    ).toBeVisible();

    await chip.hover();
    const card = page.getByRole("dialog", { name: "Notes" });
    await expect(card).toBeVisible();
    // Just the list: the line leading into it stays in the answer.
    await expect(card.locator(".notes-lead")).toHaveCount(0);
    await expect(card.locator(".notes-items > li")).toHaveCount(3);
    await card.getByRole("checkbox").nth(1).click();
    await expect(card.getByRole("checkbox").nth(1)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await screenshot(page, {
      path: "test-results/screenshots/notes-card.png",
      animations: "disabled",
    });

    // Completed work stays pinned, but isn't offered for the next message.
    await expect(card.getByRole("status")).toHaveText("2 of 3 remaining");
    await expect(
      card.locator(".notes-items > li").nth(1).locator(".notes-ask"),
    ).toBeDisabled();
    await card
      .getByRole("button", { name: "Quote remaining items in your message" })
      .click();
    const composer = page.getByLabel("Message project");
    await expect(composer.locator(".prompt-pill.quote")).toHaveAttribute(
      "data-relay-quote",
      "1. Open threads from the cache\n\n3. Optimistic sends with an outbox",
    );
    await expect(card).toBeHidden();
    await composer.fill("");

    // Nothing to send when all are done; unticking makes it quotable again.
    await chip.click();
    await expect(card).toBeVisible();
    await card.getByRole("checkbox").nth(0).click();
    await card.getByRole("checkbox").nth(2).click();
    await expect(card.getByRole("status")).toHaveText("All done");
    await expect(
      card.getByRole("button", {
        name: "All done — uncheck an item to quote it",
      }),
    ).toBeDisabled();
    await screenshot(page, {
      path: "test-results/screenshots/notes-card-done.png",
      animations: "disabled",
    });
    await card.getByRole("checkbox").nth(0).click();
    await card.getByRole("checkbox").nth(2).click();
    await expect(
      card.getByRole("button", {
        name: "Quote remaining items in your message",
      }),
    ).toBeEnabled();

    // Ask quotes the item into the draft.
    await card.locator(".notes-items > li").nth(2).hover();
    await card
      .locator(".notes-items > li")
      .nth(2)
      .locator(".notes-ask")
      .click();
    await expect(
      page.getByLabel("Message project").locator(".prompt-pill.quote"),
    ).toContainText("3. Optimistic sends");

    // Items drop out and move by their grip, numbered again, ticks and all.
    await chip.click();
    await expect(card).toBeVisible();
    const rows = card.locator(".notes-items > li");
    await rows.nth(0).hover();
    await rows.nth(0).getByRole("button", { name: "Remove this item" }).click();
    await expect(rows).toHaveCount(2);
    const grip = (await rows.nth(1).locator(".notes-grip").boundingBox())!;
    const top = (await rows.nth(0).boundingBox())!;
    await page.mouse.move(grip.x + 6, grip.y + 8);
    await page.mouse.down();
    await page.mouse.move(grip.x + 6, top.y + 4, { steps: 10 });
    await page.mouse.up();
    await expect(card.locator(".notes-text")).toHaveText([
      "Optimistic sends with an outbox",
      "Skip the re-render on every heartbeat",
    ]);
    await expect(card.locator(".notes-n")).toHaveText(["1.", "2."]);
    await expect(card.getByRole("checkbox").nth(1)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Selecting the lead line offers Keep beside Add to chat.
    await answer
      .getByText("Ideas, cheapest wins first:", { exact: true })
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
    await page.getByRole("button", { name: "Keep", exact: true }).click();
    await expect(chip).toHaveText("2");

    // The agent keeps one when asked, through Relay's tools.
    const kept = await ask(
      page,
      `fixture relay add_note ${JSON.stringify({ text: "Run `npm test` before merging" })}`,
    );
    await expect(kept.locator(".markdown")).toHaveText("Kept as n3.");
    await expect(chip).toHaveText("3");
    await chip.click();
    await expect(card.locator(".notes-by")).toHaveText("Kept by Codex");
    await screenshot(page, {
      path: "test-results/screenshots/notes-card-three.png",
      animations: "disabled",
    });

    // A list whose items hold their own lists, bold and code reads as one.
    const nested = [
      "What you get:",
      "",
      "- **Keeping things:**",
      '  - Select any text and the popup now has **Keep** next to "Add to chat".',
      "  - Lists, code blocks and tables get a pin on hover.",
      "- **MCP:**",
      "  - `list_notes` and `tick_note`, for this thread or any other.",
    ].join("\n");
    await ask(
      page,
      `fixture relay add_note ${JSON.stringify({ text: nested })}`,
    );
    await expect(chip).toHaveText("4");
    await chip.click();
    const items = card
      .locator(".notes-note")
      .last()
      .locator(".notes-items > li");
    await expect(items).toHaveCount(2);
    await expect(items.first().locator(".notes-text li").first()).toHaveCSS(
      "display",
      "list-item",
    );
    await card.locator(".notes-card-list").evaluate((list) => {
      list.scrollTop = list.scrollHeight;
    });
    await screenshot(page, {
      path: "test-results/screenshots/notes-card-nested.png",
      animations: "disabled",
    });

    // All of it is still there after Relay restarts.
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    const reopened = page.locator(".notes-chip");
    if (!(await reopened.isVisible({ timeout: 5000 }).catch(() => false)))
      await page.locator(".sb-thread, .sb-card").first().click();
    await expect(reopened).toHaveText("4");
    await reopened.hover();
    const again = page.getByRole("dialog", { name: "Notes" });
    await expect(again.getByRole("checkbox").nth(1)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(again.locator(".notes-note")).toHaveCount(4);

    // Removing the unfinished item must not resurrect the completed last item.
    const firstNote = again.locator(".notes-note").first();
    await firstNote.locator(".notes-items > li").first().hover();
    await firstNote
      .getByRole("button", { name: "Remove this item" })
      .first()
      .click();
    await expect(firstNote.getByRole("checkbox")).toHaveCount(1);
    await expect(firstNote.getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(firstNote.getByRole("status")).toHaveText("All done");
    await expect(firstNote.locator(".notes-grip")).toHaveCount(0);
    await page.reload();
    await page.locator(".notes-chip").hover();
    await expect(firstNote.getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      firstNote.getByRole("button", {
        name: "All done — uncheck an item to quote it",
      }),
    ).toBeDisabled();
    await screenshot(page, {
      path: "test-results/screenshots/notes-last-item-done.png",
      animations: "disabled",
    });
    await firstNote.getByRole("checkbox").click();
    await firstNote
      .getByRole("button", { name: "Quote it in your message", exact: true })
      .click();
    await expect(
      page.getByLabel("Message project").locator(".prompt-pill.quote").last(),
    ).toHaveAttribute(
      "data-relay-quote",
      "1. Skip the re-render on every heartbeat",
    );
  } finally {
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("pins a whole answer as a pointer that brings you back to it", async () => {
  test.setTimeout(90000);
  let root: string | undefined;
  let app: ElectronApplication | undefined;
  try {
    const started = await start();
    root = started.root;
    app = started.app;
    const page = started.page;
    const latest = await ask(
      page,
      "fixture echo: ## Cache plan\n\nOpen threads from the cache first, then the rest.",
    );
    // That answer for good: `latest` moves on to whichever is last.
    const answer = page.locator(
      `[data-message-id="${await latest.getAttribute("data-message-id")}"]`,
    );
    const chip = page.locator(".notes-chip");
    await answer.hover();
    await answer.getByRole("button", { name: "Pin to notes" }).click();
    await expect(chip).toHaveText("1");
    await expect(
      answer.getByRole("button", { name: "Unpin from notes" }),
    ).toHaveAttribute("aria-pressed", "true");

    // A long answer after it scrolls it out of view.
    const filler = Array.from(
      { length: 80 },
      (_, i) => `Paragraph ${i + 1} of filler.`,
    ).join("\n\n");
    await ask(page, `fixture echo: ${filler}`);
    await expect(answer).not.toBeInViewport();

    await chip.hover();
    const card = page.getByRole("dialog", { name: "Notes" });
    const pinned = card.locator(".notes-pinned");
    await expect(pinned).toHaveText("Cache plan");
    await screenshot(page, {
      path: "test-results/screenshots/notes-pinned-answer.png",
      animations: "disabled",
    });
    await pinned.getByRole("button", { name: "Cache plan" }).click();
    await expect(card).toBeHidden();
    await expect(answer).toBeInViewport();
    await expect(answer).toHaveAttribute("data-flash", "");
    await expect(answer).not.toHaveAttribute("data-flash");

    // Away from the answer its row hides, all but the pin.
    await page.mouse.move(5, 5);
    await expect(answer.locator(".message-actions time")).toHaveCSS(
      "opacity",
      "0",
    );
    await expect(answer.locator(".message-pin")).toHaveCSS("opacity", "1");

    // Ask points the draft at it by its opening, not the whole answer.
    await chip.hover();
    await pinned.hover();
    await pinned
      .getByRole("button", { name: "Point your message at it" })
      .click();
    await expect(
      page.getByLabel("Message project").locator(".prompt-pill.quote"),
    ).toHaveAttribute("data-relay-quote", "Cache plan");

    // Pinning it again from the answer unpins it.
    await answer.hover();
    await answer.getByRole("button", { name: "Unpin from notes" }).click();
    await expect(chip).toHaveCount(0);

    // A pinned reply opens its side conversation when jumped to from the main one.
    await answer.hover();
    await answer.getByRole("button", { name: "Reply to message" }).click();
    const side = page.getByRole("heading", { name: "Side conversation" });
    await expect(side).toBeVisible();
    const replied = await ask(
      page,
      "fixture echo: Side answer about the cache.",
    );
    const reply = page.locator(
      `[data-message-id="${await replied.getAttribute("data-message-id")}"]`,
    );
    await reply.hover();
    await reply.getByRole("button", { name: "Pin to notes" }).click();
    await expect(chip).toHaveText("1");
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await expect(reply).toHaveCount(0);
    await chip.hover();
    await card
      .getByRole("button", { name: "Side answer about the cache." })
      .click();
    await expect(side).toBeVisible();
    await expect(reply).toBeInViewport();
    await expect(reply).toHaveAttribute("data-flash", "");
  } finally {
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
