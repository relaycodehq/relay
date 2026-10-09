/** Data URLs cost two bytes per JS character; keep at most 32 MiB between mounts. */
const maxCharacters = 16 * 1024 * 1024;

export class ImageCache {
  private data = new Map<string, string>();
  private loading = new Map<string, Promise<string>>();
  private characters = 0;

  get(key: string) {
    const data = this.data.get(key);
    if (data !== undefined) {
      this.data.delete(key);
      this.data.set(key, data);
    }
    return data;
  }

  load(key: string, fetch: () => Promise<string>): Promise<string> {
    const cached = this.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = this.loading.get(key);
    if (pending) return pending;
    const request = Promise.resolve()
      .then(fetch)
      .then((data) => {
        if (data.length <= maxCharacters) {
          while (this.characters + data.length > maxCharacters) {
            const oldest = this.data.keys().next().value!;
            this.characters -= this.data.get(oldest)!.length;
            this.data.delete(oldest);
          }
          this.data.set(key, data);
          this.characters += data.length;
        }
        return data;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, request);
    return request;
  }
}
