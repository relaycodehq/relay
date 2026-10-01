import type { Handlers } from "./context";

/** Method names more than one group handles. */
type HandledTwice<
  G extends readonly unknown[],
  Seen extends PropertyKey = never,
> = G extends readonly [infer Head, ...infer Rest]
  ? (keyof Head & Seen) | HandledTwice<Rest, Seen | keyof Head>
  : never;

type Merged<G extends readonly unknown[]> = G extends readonly [
  infer Head,
  ...infer Rest,
]
  ? Head & Merged<Rest>
  : unknown;

/**
 * One table from the domain groups. A spread would let the last group that
 * names a method quietly win, so a method two groups handle doesn't compile.
 */
export function combine<const G extends readonly Handlers[]>(
  groups: G &
    ([HandledTwice<G>] extends [never]
      ? unknown
      : { handledTwice: HandledTwice<G> }),
): Merged<G> {
  return Object.assign({}, ...groups);
}
