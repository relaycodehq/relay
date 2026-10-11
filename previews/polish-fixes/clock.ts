// A clock fixture for the isolated calendar reproductions only.
const scenario = new URLSearchParams(location.search).get("clock");
const at =
  scenario === "month-end"
    ? "2026-10-31T23:10:00+01:00"
    : scenario === "dst"
      ? "2027-03-28T00:10:00+01:00"
      : scenario === "fall"
        ? "2027-10-31T00:10:00+02:00"
        : undefined;
if (at) {
  const fixed = Date.parse(at);
  globalThis.Date = new Proxy(Date, {
    construct(target, args) {
      return Reflect.construct(target, args.length ? args : [fixed]);
    },
    get(target, key) {
      return key === "now" ? () => fixed : Reflect.get(target, key);
    },
  });
}
