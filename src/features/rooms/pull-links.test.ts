import { expect, it } from "vitest";
import { isRoomInvitation } from "./pull-links";
import { roomAppUrl, roomInvitation } from "../../../shared/rooms";

const room = {
  server: "https://rooms.example.dev",
  projectId: "6f1c2a8e-3b4d-4c5e-9f60-718293a4b5c6",
  secret: "a".repeat(43),
};
const project = {
  server: "https://git.example.dev",
  owner: "web",
  name: "app",
};

it("tells PR links from room invitations, in the browser's form and Relay's own", () => {
  expect(isRoomInvitation("https://git.example.dev/web/app/pulls/7")).toBe(
    false,
  );
  const link = roomInvitation(room, { project, number: 7 });
  expect(isRoomInvitation(link)).toBe(true);
  expect(isRoomInvitation(roomAppUrl(link))).toBe(true);
});

it("turns away invitations without a PR to open, and links that aren't URLs", () => {
  expect(() => isRoomInvitation(roomInvitation(room))).toThrow(/no PR target/);
  expect(() => isRoomInvitation("git.example.dev/web/app/pulls/7")).toThrow();
});
