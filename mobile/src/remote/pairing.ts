// A pairing settles on what the computer being paired says, and on nothing
// else: scanning the QR code sends the app to the background, and coming back
// wakes whichever computer was live, which may come online meanwhile.

export class PendingPairing<Client> {
  private waiting?: {
    client?: Client;
    resolve: () => void;
    reject: (e: Error) => void;
  };

  /**
   * Until the client named by `started` comes online, or `timeout()` after
   * `ms`. A pairing started meanwhile takes over, and this one never settles:
   * failing it would put the phone back on the computer it was on.
   */
  wait(ms: number, timeout: () => Error): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiting !== entry) return;
        this.waiting = undefined;
        reject(timeout());
      }, ms);
      const entry: NonNullable<typeof this.waiting> = {
        resolve: () => (clearTimeout(timer), resolve()),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
      this.waiting = entry;
    });
  }

  /** The client started with the pairing code: the only one whose answer counts. */
  started(client: Client) {
    if (this.waiting) this.waiting.client = client;
  }

  online(client: Client) {
    this.take(client)?.resolve();
  }

  denied(client: Client, why?: string) {
    this.take(client)?.reject(new Error(why ?? "Relay said no."));
  }

  private take(client: Client) {
    const waiting = this.waiting;
    if (!waiting || waiting.client !== client) return;
    this.waiting = undefined;
    return waiting;
  }
}
