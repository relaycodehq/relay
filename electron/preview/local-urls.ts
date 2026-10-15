/** The port of an explicit HTTP loopback URL. */
export function localPort(url: string): number | undefined {
  const parsed = URL.parse(url);
  if (
    parsed?.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  )
    return;
  return Number(parsed.port || 80);
}
