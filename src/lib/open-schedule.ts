// The way from a scheduled run's message to its schedule; the shell listens.
const EVENT = "relay:open-schedule";

export function openSchedule(id: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: id }));
}

export function onOpenSchedule(listener: (id: string) => void) {
  const heard = (e: Event) => listener((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, heard);
  return () => window.removeEventListener(EVENT, heard);
}
