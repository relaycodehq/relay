import type { Readable } from "node:stream";
import { roomHostingSchema } from "../../shared/rooms";

// Administrator provisioning uses stdin, never process arguments or a plaintext file.
export async function readHostingSetup(input: Readable) {
  const chunks: Buffer[] = [];
  let size = 0;
  const timeout = setTimeout(
    () => input.destroy(new Error("Hosting setup input timed out.")),
    15000,
  );
  try {
    for await (const chunk of input) {
      size += chunk.length;
      if (size > 8192) throw new Error("Hosting setup input is too large.");
      chunks.push(Buffer.from(chunk));
    }
    return roomHostingSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
  } catch {
    throw new Error("Provide the room server and setup key as JSON on stdin.");
  } finally {
    clearTimeout(timeout);
  }
}
