import { readFileSync } from "node:fs";
import { RoomsDatabase } from "./database";
import { createRoomsServer } from "./http";
const secret = process.env.RELAY_ROOMS_SETUP_KEY_FILE
  ? readFileSync(process.env.RELAY_ROOMS_SETUP_KEY_FILE, "utf8").trim()
  : (process.env.RELAY_ROOMS_SETUP_KEY ?? "");
if (!/^[A-Za-z0-9_-]{43}$/.test(secret))
  throw new Error(
    "Set RELAY_ROOMS_SETUP_KEY_FILE to a file containing a 32-byte base64url secret. See server/README.md.",
  );
const db = new RoomsDatabase(
  process.env.RELAY_ROOMS_DB ?? "./room-data/rooms.sqlite",
);
const server = createRoomsServer(db, secret);
server.listen(
  Number(process.env.PORT ?? 4319),
  process.env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      `Review Relay room server listening on ${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 4319}`,
    ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
