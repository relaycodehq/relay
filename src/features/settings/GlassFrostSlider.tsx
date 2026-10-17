import { Snowflake } from "lucide-react";
import { Slider } from "../../ui/Slider";

/** How much of the frost shows through, under the Frosted glass switches. */
export function GlassFrostSlider({
  label,
  value,
  range,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number; default: number };
  onChange: (value: number) => void;
}) {
  return (
    <div className="chat-width-slider">
      <Slider
        min={range.min}
        max={range.max}
        defaultValue={range.default}
        icon={<Snowflake />}
        aria-label={label}
        format={(v) => `${v}%`}
        value={value}
        onChange={onChange}
      />
      <span className="settings-row-value">{value}%</span>
    </div>
  );
}
