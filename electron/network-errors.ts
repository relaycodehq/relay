/** Return useful connection failures without echoing URLs, headers, or credentials. */
export function networkError(error: unknown, server: string): Error {
  const value = error as {
    message?: unknown;
    code?: unknown;
    cause?: { code?: unknown };
  };
  const detail = [value?.message, value?.code, value?.cause?.code]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  const host = new URL(server).host;
  if (/CERT_|ISSUER_CERT|SELF_SIGNED|CERTIFICATE_VERIFY/.test(detail))
    return new Error(
      `Cannot verify the certificate for ${host}. Check the server’s certificate and your operating system’s certificate trust settings.`,
    );
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/.test(detail))
    return new Error(
      `Cannot find ${host}. Check the server address and connect to your company VPN if required.`,
    );
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(detail))
    return new Error(
      `${host} refused the connection. Check that Gitea is running and reachable from this network.`,
    );
  if (/ERR_PROXY|ERR_TUNNEL/.test(detail))
    return new Error(
      `The system proxy could not connect to ${host}. Check your proxy or VPN connection.`,
    );
  return new Error(
    `Could not connect to ${host}. Check your network or VPN connection and try again.`,
  );
}
