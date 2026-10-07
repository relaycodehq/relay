import { expect, it } from "vitest";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { controlSocket, relayHome } from "./paths";

it("keeps everything in ~/.relay unless told otherwise", () => {
  expect(relayHome({})).toBe(join(homedir(), ".relay"));
  expect(relayHome({ RELAY_HOME: "/srv/relay" })).toBe(resolve("/srv/relay"));
});

it("puts the control socket in the home folder while its path fits", () => {
  expect(controlSocket("/home/me/.relay", "linux")).toBe(
    "/home/me/.relay/relay.sock",
  );
  const deep = "/home/me/" + "nested/".repeat(20) + ".relay";
  expect(controlSocket(deep, "linux")).toMatch(
    /^\/tmp\/relay-.+-[0-9a-f]{16}\.sock$/,
  );
  expect(controlSocket("C:\\Users\\me\\.relay", "win32")).toMatch(
    /^\\\\\.\\pipe\\relay-[0-9a-f]{16}$/,
  );
});
