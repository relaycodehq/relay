import type { Store } from "../app/store";
import { roomHostingSchema, type RoomHosting } from "../../shared/rooms";
import type { RoomRequest } from "./transport";

/** The room server and setup key this computer may create projects with, kept sealed in the store. */
export class Hosting {
  constructor(
    private store: Store,
    private request: RoomRequest,
    private encrypt: (s: string) => Promise<string | null>,
    private decrypt: (s: string) => Promise<string>,
  ) {}
  async get(): Promise<RoomHosting | null> {
    const saved = this.store.get().roomHosting;
    return saved
      ? roomHostingSchema.parse(JSON.parse(await this.decrypt(saved)))
      : null;
  }
  async status() {
    return { server: (await this.get())?.server ?? null };
  }
  async save(input: RoomHosting | null) {
    let encrypted: string | null = null;
    if (input) {
      const value = roomHostingSchema.parse(input);
      // Check the key with that server, without creating a project there.
      await this.request(value.server, "/v1/setup", value.secret);
      encrypted = await this.encrypt(JSON.stringify(value));
      if (!encrypted)
        throw new Error(
          "Secure credential storage is required to save room hosting access.",
        );
    }
    await this.store.update((s) => {
      if (encrypted) s.roomHosting = encrypted;
      else delete s.roomHosting;
    });
  }
}
