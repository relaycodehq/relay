/** Set at build time from the release tag; see scripts/build-headless.mjs. */
export const headlessVersion =
  process.env.RELAY_HEADLESS_VERSION || "0.0.0-dev";
