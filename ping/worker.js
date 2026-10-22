// Counts the daily pings from electron/app/daily-ping.ts: one row per UTC
// day, kind, version and platform, holding how many copies said they ran.
// Nothing else is kept, not even the address a ping came from.

const kinds = new Set(["desktop", "headless"]);
const platform = /^(darwin|win32|linux)-(arm64|x64)$/;
const version = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    let ping;
    try {
      ping = await request.json();
    } catch {
      return new Response(null, { status: 400 });
    }
    if (
      !kinds.has(ping?.kind) ||
      !version.test(ping?.version) ||
      !platform.test(ping?.platform)
    )
      return new Response(null, { status: 400 });
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      `INSERT INTO pings (day, kind, version, platform, count) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (day, kind, version, platform) DO UPDATE SET count = count + 1`,
    )
      .bind(day, ping.kind, ping.version, ping.platform)
      .run();
    return new Response(null, { status: 204 });
  },
};
