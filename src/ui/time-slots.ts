/** Actual half-hours in a local day: skip spring's missing hour and include both of autumn's. */
export function timeSlots(day: number): number[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const slots: number[] = [];
  for (let at = start.getTime(); at < end.getTime(); at += 30 * 60_000)
    slots.push(at);
  return slots;
}
