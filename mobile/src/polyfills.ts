import { getRandomValues } from "expo-crypto";

const g = globalThis as { crypto?: Partial<Crypto> };
if (typeof g.crypto?.getRandomValues !== "function")
  g.crypto = {
    ...g.crypto,
    getRandomValues: getRandomValues as Crypto["getRandomValues"],
  };
