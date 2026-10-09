import { expect, it } from "vitest";
import { oneAtATime } from "../../mobile/src/remote/one-at-a-time";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
};

it("runs the rerun asked for during a fetch with what the latest caller saw", async () => {
  const fetch = oneAtATime();
  const asked: number[] = [];
  const first = gate();
  // The thread opens with the latest 100; "Load earlier" asks for 200 while that runs.
  const opening = fetch(async () => {
    asked.push(100);
    await first.opened;
  });
  const earlier = fetch(async () => void asked.push(200));
  first.open();
  await Promise.all([opening, earlier]);
  expect(asked).toEqual([100, 200]);
});

it("runs requests made during a fetch once more, not once each", async () => {
  const fetch = oneAtATime();
  let runs = 0;
  const first = gate();
  const all = [
    fetch(async () => {
      runs++;
      await first.opened;
    }),
    fetch(async () => void runs++),
    fetch(async () => void runs++),
  ];
  first.open();
  await Promise.all(all);
  expect(runs).toBe(2);
  await fetch(async () => void runs++);
  expect(runs).toBe(3);
});

it("keeps going after a job that throws", async () => {
  const fetch = oneAtATime();
  await expect(
    fetch(async () => {
      throw new Error("Not connected");
    }),
  ).rejects.toThrow("Not connected");
  let ran = false;
  await fetch(async () => void (ran = true));
  expect(ran).toBe(true);
});

it("doesn't lose a waiting rerun when the current job fails", async () => {
  const fetch = oneAtATime();
  const first = gate();
  const running = fetch(async () => {
    await first.opened;
    throw new Error("Link lost");
  });
  await Promise.resolve();
  let ran = false;
  const next = fetch(async () => void (ran = true));
  first.open();
  await expect(running).rejects.toThrow("Link lost");
  await expect(next).rejects.toThrow("Link lost");
  expect(ran).toBe(true);
});

it("can run again after a job throws synchronously", async () => {
  const fetch = oneAtATime();
  await expect(
    fetch(() => {
      throw new Error("Bad request");
    }),
  ).rejects.toThrow("Bad request");
  let ran = false;
  await fetch(async () => void (ran = true));
  expect(ran).toBe(true);
});
