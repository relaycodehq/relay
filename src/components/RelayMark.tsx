import ribbon from "../../assets/relay-mark.svg";
import "./relay-mark.css";

/** Decorative wordmark companion; the adjacent Relay label supplies its name. */
export function RelayMark({ size = 32 }: { size?: number }) {
  return (
    <img
      className="relay-mark"
      src={ribbon}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
