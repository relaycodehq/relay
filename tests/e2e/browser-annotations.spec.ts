import {
  test,
  expect,
  _electron as electron,
  relayEnv,
} from "../fixtures/electron";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { openSurface } from "../fixtures/navigation";

test("browser feedback stays anchored in the page and sends as structured context", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-annotations-")),
  );
  const repo = join(root, "project");
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args]);
  git("init", "-q", "-b", "main");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "Base",
  );
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>Annotation sample</title><style>
      body{margin:32px;background:#f5f7f3;color:#203438;font:20px system-ui}h1{font-size:30px}
      section{display:flex;gap:20px}button{width:260px;height:220px;border:0;border-radius:26px;background:#254742;color:#fff;text-align:left;padding:28px;font:700 30px system-ui}
      button small{display:block;color:#c8c39e;font-size:24px;margin-bottom:80px}#map{background:radial-gradient(circle at 110% 0,#587b68,#254742 80%)}
      .space{height:1400px}
      #pane{height:90px;overflow:auto;border:1px solid}#pane div{height:600px}
      </style><div id=pane><div>Scrolls inside</div></div><h1>Your applications</h1><section><button id=map><small>MS</small>Map tiles</button><button id=gps><small>GL</small>GPS logger</button></section><div class=space></div>
      <script>window.clicked=0;document.getElementById('map').onclick=()=>window.clicked++;</script>`);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = relayEnv();
  delete env.RELAY_DEV_URL;
  const app = await electron.launch({
    env: { ...env, RELAY_TEST_DATA: join(root, "data") },
  });
  const page = await app.firstWindow();
  await page.emulateMedia({ colorScheme: "dark" });
  const query = async (expression: string) =>
    app.evaluate(
      ({ webContents }, { origin, expression }) => {
        const wc = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().startsWith(origin))!;
        return wc?.executeJavaScript(expression) ?? null;
      },
      { origin, expression },
    );
  // The inspector's root is closed to the page; only its own isolated world holds it.
  const inspector = async (expression: string) =>
    app.evaluate(
      ({ webContents }, { origin, expression }) => {
        const wc = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().startsWith(origin))!;
        return wc.executeJavaScriptInIsolatedWorld(1007, [
          {
            code: `(() => { const root = globalThis.__relayElementPicker?.shadow; return ${expression}; })()`,
          },
        ]);
      },
      { origin, expression },
    );
  const pointer = async (selector: string, move = false) => {
    const point = await inspector(
      `(() => {const el=root?.querySelector(${JSON.stringify(selector)}) ?? document.querySelector(${JSON.stringify(selector)});const b=el.getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`,
    );
    await app.evaluate(
      ({ webContents }, { origin, point, move }) => {
        const wc = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().startsWith(origin))!;
        wc.sendInputEvent({ type: "mouseMove", ...point });
        if (!move) {
          wc.sendInputEvent({
            type: "mouseDown",
            button: "left",
            clickCount: 1,
            ...point,
          });
          wc.sendInputEvent({
            type: "mouseUp",
            button: "left",
            clickCount: 1,
            ...point,
          });
        }
      },
      { origin, point, move },
    );
  };
  const press = async (keyCode: string, char?: string) =>
    app.evaluate(
      ({ webContents }, { origin, keyCode, char }) => {
        const wc = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().startsWith(origin))!;
        wc.sendInputEvent({ type: "keyDown", keyCode });
        if (char) wc.sendInputEvent({ type: "char", keyCode: char });
        wc.sendInputEvent({ type: "keyUp", keyCode });
      },
      { origin, keyCode, char },
    );
  const type = async (text: string) =>
    app.evaluate(
      ({ webContents }, { origin, text }) =>
        webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().startsWith(origin))!
          .insertText(text),
      { origin, text },
    );
  const shot = async (name: string) => {
    const base64 = await app.evaluate(
      async ({ webContents }, origin) =>
        (
          await webContents
            .getAllWebContents()
            .find((wc) => wc.getURL().startsWith(origin))!
            .capturePage({ x: 0, y: 0, width: 760, height: 380 })
        )
          .toPNG()
          .toString("base64"),
      origin,
    );
    await writeFile(join(tmpdir(), name), Buffer.from(base64, "base64"));
  };
  try {
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [dir],
      });
    }, repo);
    await page
      .getByRole("button", { name: "Add project folder", exact: true })
      .click();
    const adding = page.getByRole("dialog", {
      name: "Add a project",
      exact: true,
    });
    await adding
      .getByRole("button", { name: "Open a folder", exact: true })
      .click();
    await adding
      .getByRole("button", { name: "Choose in Finder…", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.relay.projects()).length),
      )
      .toBe(1);
    await page
      .locator('[contenteditable="true"]')
      .first()
      .fill("Keep this draft");
    await openSurface(page, "Browser");
    const address = page.getByRole("textbox", { name: "Address", exact: true });
    await address.fill(origin);
    await address.press("Enter");
    await expect.poll(() => query("document.title")).toBe("Annotation sample");
    await page
      .getByRole("button", { name: "Comment on this page", exact: true })
      .click();
    await expect
      .poll(() => query("!!document.getElementById('relay-element-inspector')"))
      .toBe(true);
    await pointer("#map", true);
    await expect
      .poll(() => inspector("root.querySelector('.details').textContent"))
      .toContain("button");
    await shot("relay-browser-inspect.png");
    await pointer("#gps");
    await app.evaluate(({ webContents }, origin) => {
      const wc = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL().startsWith(origin))!;
      wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      wc.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    }, origin);
    await expect
      .poll(() => inspector("root.querySelector('.editor').hidden"))
      .toBe(true);
    await expect(page.locator(".browser-annotation-chip")).toHaveCount(0);
    expect(
      await query(
        "document.getElementById('relay-element-inspector').shadowRoot",
      ),
    ).toBeNull();
    // The wheel scrolls a pane under the overlay, not only the page.
    const pane = await query(
      "(() => {const b=document.getElementById('pane').getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()",
    );
    await app.evaluate(
      ({ webContents }, { origin, pane }) =>
        webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().startsWith(origin))!
          .sendInputEvent({
            type: "mouseWheel",
            ...pane,
            deltaX: 0,
            deltaY: -120,
          }),
      { origin, pane },
    );
    await expect
      .poll(() => query("document.getElementById('pane').scrollTop"))
      .toBeGreaterThan(0);
    expect(await query("scrollY")).toBe(0);
    await query("document.getElementById('pane').scrollTop = 0");
    // Enter on Cancel cancels; only the comment box saves on Enter.
    await pointer("#gps");
    await type("Not this one");
    await inspector(
      "root.querySelector('[aria-label=\"Cancel comment\"]').focus()",
    );
    await press("Enter", "\r");
    await expect
      .poll(() => inspector("root.querySelector('.editor').hidden"))
      .toBe(true);
    await expect(page.locator(".browser-annotation-chip")).toHaveCount(0);

    await pointer("#map");
    await expect
      .poll(() => inspector("root.querySelector('.editor').hidden"))
      .toBe(false);
    await type("Make this card easier to read");
    // A single-page app changing its route keeps the inspector and the words typed.
    await query("history.pushState(null, '', '#route')");
    await expect(address).toHaveValue(/#route$/);
    await query("history.replaceState(null, '', location.pathname)");
    await expect(address).not.toHaveValue(/#route$/);
    expect(await inspector("root.querySelector('textarea').value")).toBe(
      "Make this card easier to read",
    );
    await shot("relay-browser-comment.png");
    expect(await query("window.clicked")).toBe(0);
    await inspector("root.querySelector('.save').click()");
    await expect(page.locator(".browser-annotation-chip")).toHaveCount(0);
    await pointer(".save");
    await expect(page.locator(".browser-annotation-chip")).toContainText(
      "Make this card easier to read",
    );
    await expect(page.locator(".browser-annotation-copy small")).toHaveText(
      "Button · MS Map tiles",
    );
    await expect
      .poll(() =>
        page
          .locator(".browser-annotation-preview img")
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await expect
      .poll(() => inspector("root?.querySelectorAll('button.pin').length"))
      .toBe(1);
    await query(
      "window.originalMap = document.getElementById('map'); const replacement = window.originalMap.cloneNode(true); replacement.textContent = 'A different card'; window.originalMap.replaceWith(replacement)",
    );
    await expect
      .poll(() => inspector("root.querySelector('button.pin').hidden"))
      .toBe(true);
    await expect(page.locator(".browser-annotation-chip")).toContainText(
      "Make this card easier to read",
    );
    await query(
      "document.getElementById('map').replaceWith(window.originalMap)",
    );
    await expect
      .poll(() => inspector("root.querySelector('button.pin').hidden"))
      .toBe(false);
    // A scroll repositions the same pin; a changed target never silently reattaches.
    const before = await inspector(
      "root.querySelector('button.pin').getBoundingClientRect().top",
    );
    await query("window.scrollBy(0, 60)");
    await expect
      .poll(() =>
        inspector(
          "root.querySelector('button.pin').getBoundingClientRect().top",
        ),
      )
      .toBeLessThan(before);
    await query("window.scrollTo(0,0)");
    await expect
      .poll(() =>
        inspector(
          "root.querySelector('button.pin').getBoundingClientRect().top",
        ),
      )
      .toBe(before);
    await pointer("button.pin");
    await expect
      .poll(() => inspector("root.querySelector('textarea').value"))
      .toBe("Make this card easier to read");
    await type(" please");
    await pointer(".save");
    await expect(page.locator(".browser-annotation-chip")).toContainText(
      "please",
    );
    await expect
      .poll(() => query("!!document.getElementById('relay-element-inspector')"))
      .toBe(true);
    await pointer(".status button");
    await expect
      .poll(() => query("!!document.getElementById('relay-element-inspector')"))
      .toBe(false);
    await pointer("#map");
    expect(await query("window.clicked")).toBe(1);
    // Browser metadata stays out of editable text; the screenshot retains its annotation on send.
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("relay-draft-images", 2);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const records = await new Promise<any[]>((resolve, reject) => {
        const r = db.transaction("drafts").objectStore("drafts").getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      db.close();
      return records.flat().find((image) => image.browser);
    });
    expect(stored.browser.selector).toBe("#map");
    expect(stored.browser.comment).toContain("please");
    expect(
      await page.locator('[contenteditable="true"]').first().innerText(),
    ).toBe("Keep this draft");
    const sent = await page.evaluate(async (image) => {
      const [project] = await window.relay.projects();
      const chat = await window.relay.createProjectChat(project.id, {
        kind: "project",
      });
      await window.relay.renameProjectChat(chat.id, "Browser feedback test");
      await window.relay.sendProjectChat(chat.id, {
        id: crypto.randomUUID(),
        body: "Browser feedback",
        to: "message",
        provider: "codex",
        choice: { model: "", reasoningEffort: "", fast: false },
        runtimeMode: "approval-required",
        interactionMode: "default",
        images: [
          {
            name: image.name,
            mimeType: image.mimeType,
            dataUrl: image.dataUrl,
            browser: image.browser,
          },
        ],
      });
      const patch = await window.relay.projectChat(chat.id);
      return patch.messages.find((m) => typeof m !== "string");
    }, stored);
    expect(
      sent && typeof sent !== "string" && sent.images?.[0].browser,
    ).toEqual(stored.browser);
    // Reopening the inspector restores the unsent comment from IndexedDB.
    await page
      .getByRole("button", { name: "Comment on this page", exact: true })
      .click();
    await expect
      .poll(() => inspector("root?.querySelectorAll('button.pin').length"))
      .toBe(1);
    await pointer("button.pin");
    await pointer('[aria-label="Delete comment"]');
    await expect(page.locator(".browser-annotation-chip")).toHaveCount(0);
    // Targets without text still show pixels and a readable type, never raw HTML.
    await query(`(() => {
      const image = document.createElement('img');
      image.id = 'logo'; image.width = 180; image.height = 180;
      image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" rx="25" fill="#254742"/><circle cx="90" cy="90" r="48" fill="#c8c39e"/></svg>');
      document.getElementById('gps').replaceWith(image);
    })()`);
    await expect
      .poll(() => query("document.getElementById('logo').naturalWidth"))
      .toBe(180);
    await pointer("#logo");
    await type("Make this image nicer");
    await pointer(".save");
    await expect(page.locator(".browser-annotation-copy small")).toHaveText(
      "Image",
    );
    await expect(page.locator(".browser-annotation-chip")).not.toContainText(
      "<img",
    );
    await expect
      .poll(() =>
        page
          .locator(".browser-annotation-preview img")
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await expect
      .poll(() => query("!!document.getElementById('relay-element-inspector')"))
      .toBe(true);
    await pointer(".status button");
    await page.locator(".browser-annotation-chip").screenshot({
      path: join(tmpdir(), "relay-browser-comment-attachment.png"),
    });
    await page
      .getByRole("button", { name: "Open screenshot: Image", exact: true })
      .click();
    await expect(page.locator(".image-viewer")).toBeVisible();
    await page
      .locator(".image-viewer")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    // Sent cards use the stored screenshot, with the same readable presentation.
    await page.locator('.sb-thread[title="Browser feedback test"]').click();
    const sentCard = page.locator(".project-message .browser-annotation-chip");
    await expect(sentCard).toContainText(
      "Make this card easier to read please",
    );
    await expect(sentCard.locator("small")).toHaveText("Button · MS Map tiles");
    await expect
      .poll(() =>
        sentCard
          .locator("img")
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await sentCard.getByRole("button", { name: /^Open screenshot:/ }).click();
    await expect(page.locator(".image-viewer")).toBeVisible();
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
