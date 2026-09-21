import { describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  roomInvitation,
  roomAppUrl,
  parseRoomInvitation,
} from "../../shared/rooms";
import { readHostingSetup } from "../../electron/rooms/provision";
import { createRoomsServer } from "../../server/http";
import { RoomsDatabase, token } from "../../server/database";
import { RoomService } from "../../electron/rooms/service";
import { Store } from "../../electron/store";
import type { Gitea } from "../../electron/gitea";

const target = {
  project: { server: "https://gitea.test/gitea", owner: "Web", name: "portal" },
  number: 7,
};
describe("desktop invitations", () => {
  it("preserves the repository, PR and proxy prefix without sending invitation credentials in HTTP URLs", () => {
    const input = {
      server: "https://rooms.test/review-relay",
      projectId: randomUUID(),
      secret: token(),
    };
    const link = roomInvitation(input, target);
    expect(parseRoomInvitation(link)).toEqual({ ...input, ...target });
    expect(parseRoomInvitation(roomAppUrl(link))).toEqual({
      ...input,
      ...target,
    });
    const request = new URL(link);
    request.hash = "";
    expect(request.href).toBe(input.server + "/");
  });
  it("rejects malformed or ambiguous invitation targets and credential-bearing URLs", () => {
    const link = roomInvitation(
      {
        server: "https://rooms.test",
        projectId: randomUUID(),
        secret: token(),
      },
      target,
    );
    const appLink = roomAppUrl(link);
    for (const invalid of [
      link + "&pr=8",
      link + "&unknown=1",
      link.replace("&pr=7", "&pr=-1"),
      link.replace("&pr=7", ""),
      link.replace("https://rooms.test", "https://user:pass@rooms.test"),
      appLink.replace("//join?", "//evil?"),
      appLink.replace("//join?", "//join/path?"),
      appLink.replace("#join=", "&server=https%3A%2F%2Fevil.test#join="),
      appLink.replace("server=https", "server=http"),
    ])
      expect(() => parseRoomInvitation(invalid)).toThrow("invitation link");
  });
  it("bounds provisioning input and never includes secret input in validation errors", async () => {
    const secret = token();
    await expect(
      readHostingSetup(
        Readable.from([
          JSON.stringify({ server: "https://rooms.test", secret }),
        ]),
      ),
    ).resolves.toEqual({ server: "https://rooms.test", secret });
    for (const input of [
      secret,
      JSON.stringify({ server: "http://public.test", secret }),
      "x".repeat(8193),
    ]) {
      await expect(readHostingSetup(Readable.from([input]))).rejects.toThrow(
        "JSON on stdin",
      );
    }
  });
  it("validates hosting once, creates invitations automatically, and restores hosting without storing its plaintext key", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-hosting-"));
    const database = new RoomsDatabase(":memory:"),
      secret = token();
    const server = createRoomsServer(database, secret);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    const store = new Store(root);
    await store.load();
    // This fake vault lets the test prove the storage boundary without opening the OS Keychain.
    const vault = new Map<string, string>();
    const encrypt = async (value: string) => {
      const id = randomUUID();
      vault.set(id, value);
      return id;
    };
    const decrypt = async (id: string) => vault.get(id)!;
    const service = new RoomService(store, fetch, encrypt, decrypt);
    const context = {
      key: "project",
      ref: { owner: "Web", name: "portal", number: 7 },
      client: {
        account: { server: target.project.server, user: { login: "Alice" } },
        pull: async () => ({ title: "Fixture PR" }),
      } as unknown as Gitea,
    };
    try {
      await expect(
        service.saveHosting({ server: url, secret: token() }),
      ).rejects.toThrow("Invalid server setup key");
      expect(store.get().roomHosting).toBeUndefined();
      const insecure = new RoomService(store, fetch, async () => null, decrypt);
      await expect(
        insecure.saveHosting({ server: url, secret }),
      ).rejects.toThrow("Secure credential storage");
      await service.saveHosting({ server: url, secret });
      await store.flush();
      expect(await readFile(join(root, "state.json"), "utf8")).not.toContain(
        secret,
      );
      const restored = new RoomService(store, fetch, encrypt, decrypt);
      expect(await restored.hostingStatus()).toEqual({ server: url });
      const invitation = await restored.invite(context);
      expect(parseRoomInvitation(invitation.code)).toMatchObject(target);
      expect(invitation.code).not.toContain(secret);
      expect((await restored.state(context)).connection?.member.owner).toBe(
        true,
      );
      await restored.saveHosting(null);
      expect(await restored.hostingStatus()).toEqual({ server: null });
      expect((await restored.state(context)).connection).not.toBeNull();
      await restored.dispose();
    } finally {
      await service.dispose();
      await new Promise<void>((r) => server.close(() => r()));
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("serves a credential-free landing page with hashed CSP while keeping setup and room APIs authenticated", async () => {
    const database = new RoomsDatabase(":memory:"),
      secret = token();
    const server = createRoomsServer(database, secret);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      const response = await fetch(url + "/");
      const html = await response.text(),
        csp = response.headers.get("content-security-policy")!;
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(html).toContain("Open Review Relay");
      expect(html).not.toContain(secret);
      for (const tag of ["style", "script"]) {
        const content = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(
          html,
        )![1];
        expect(csp).toContain(
          "sha256-" + createHash("sha256").update(content).digest("base64"),
        );
      }
      expect((await fetch(url + "/v1/setup")).status).toBe(401);
      expect(
        (
          await fetch(url + "/v1/setup", {
            headers: { Authorization: `Bearer ${secret}` },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(url + "/v1/setup", {
            headers: {
              Authorization: `Bearer ${secret}`,
              Origin: "https://evil.test",
            },
          })
        ).status,
      ).toBe(403);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      database.close();
    }
  });
});
