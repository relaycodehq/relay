import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BatteryLow, BatteryMedium, BatteryFull } from "lucide-react";
import type { ProjectTask } from "../../../shared/tasks";
import { api } from "../../lib/api";
import { usePoll } from "../../lib/poll";

/** Looks kept per line: 30 at the card's 3 s is the last minute and a half. */
const KEEP = 30;

/** "37%", "4%", "<1%": a share of the whole computer. */
export function formatShare(cpu: number) {
  if (cpu < 1) return "<1%";
  return `${Math.round(cpu)}%`;
}

/** Each task's CPU over its last looks, oldest first, appended once per fetch. */
export function useCostHistory(tasks: ProjectTask[], at: number) {
  const [history, setHistory] = useState(() => new Map<string, number[]>());
  useEffect(() => {
    setHistory((before) => {
      const next = new Map<string, number[]>();
      for (const t of tasks)
        if (t.cpu !== undefined)
          next.set(t.id, [...(before.get(t.id) ?? []), t.cpu].slice(-KEEP));
      return next;
    });
    // `at` changes with every fetch; the list alone may stay equal.
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  return history;
}

/** A line of the last looks, drawn against `max`; with `area`, filled underneath. */
export function Sparkline({
  values,
  max,
  className,
  area = false,
}: {
  values: readonly number[];
  max: number;
  className?: string;
  area?: boolean;
}) {
  const h = 12;
  const points =
    values.length < 2
      ? ""
      : values
          .map(
            (v, i) =>
              `${((i * 100) / (values.length - 1)).toFixed(1)},${(h - 0.75 - (Math.min(v, max) / max) * (h - 1.5)).toFixed(2)}`,
          )
          .join(" ");
  return (
    <svg
      className={className}
      viewBox={`0 0 100 ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {area && points && (
        <path
          className="area"
          d={`M0,${h} L${points.replaceAll(" ", " L")} L100,${h} Z`}
        />
      )}
      <polyline points={points} />
    </svg>
  );
}

interface BatteryManager extends EventTarget {
  charging: boolean;
  level: number;
}

/** The battery's level while it runs the computer; undefined when plugged in or there's none. */
function useBattery() {
  const [level, setLevel] = useState<number>();
  useEffect(() => {
    const get = (
      navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }
    ).getBattery;
    if (!get) return;
    let battery: BatteryManager | undefined;
    // A computer without a battery reads as one charging at 100%.
    const sync = () =>
      setLevel(battery && !battery.charging ? battery.level : undefined);
    let gone = false;
    void get.call(navigator).then(
      (b) => {
        if (gone) return;
        battery = b;
        b.addEventListener("levelchange", sync);
        b.addEventListener("chargingchange", sync);
        sync();
      },
      () => {},
    );
    return () => {
      gone = true;
      battery?.removeEventListener("levelchange", sync);
      battery?.removeEventListener("chargingchange", sync);
    };
  }, []);
  return level;
}

const gb = (mb: number) => {
  const g = mb / 1024;
  return g < 10 ? g.toFixed(1) : String(Math.round(g));
};

function batteryIcon(level: number | undefined) {
  if (level === undefined || level > 0.6) return BatteryFull;
  if (level > 0.2) return BatteryMedium;
  return BatteryLow;
}

/** The whole computer's CPU over the last looks, its memory, and the battery while it runs on one. */
export function ComputerLoad() {
  const poll = usePoll();
  const load = useQuery({
    queryKey: ["machine-load"],
    queryFn: () => api.machineLoad(),
    refetchInterval: poll(3000),
  });
  const [cpus, setCpus] = useState<number[]>([]);
  const cpu = load.data?.cpu;
  useEffect(() => {
    if (cpu !== undefined) setCpus((c) => [...c, cpu].slice(-KEEP));
  }, [cpu, load.dataUpdatedAt]);
  const battery = useBattery();
  const m = load.data;
  // The row keeps its height before the first look, so the card doesn't grow under the reader.
  if (!m) return <div className="running-computer-load" />;
  const Battery = batteryIcon(battery);
  return (
    <div className="running-computer-load">
      <Sparkline
        values={cpus}
        max={100}
        area
        className="running-computer-spark"
      />
      {cpu !== undefined && (
        <span title="CPU, every core counted">
          <b>{formatShare(cpu)}</b> CPU
        </span>
      )}
      <span title="Memory in use">
        <b>{gb(m.usedMb)}</b>
        {`/${gb(m.totalMb)} GB`}
      </span>
      {battery !== undefined && (
        <span
          className={`running-computer-battery${battery <= 0.2 ? " low" : ""}`}
          title="On battery"
        >
          <Battery size={13} aria-hidden />
          <b>{Math.round(battery * 100)}%</b>
        </span>
      )}
    </div>
  );
}
