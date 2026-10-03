import type { ReactNode } from "react";
import { Laptop, Monitor, Server } from "lucide-react";

function Glyph({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/**
 * A glyph for a computer from its name: a Mac mini from above, a Raspberry
 * Pi's board, a server, a laptop, or a plain monitor when nothing fits.
 */
export function DeviceIcon({
  name,
  size = 20,
}: {
  name: string;
  size?: number;
}) {
  if (/mini/i.test(name))
    return (
      <Glyph size={size}>
        <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
        <circle cx="12" cy="12" r="2.2" />
      </Glyph>
    );
  if (/raspberry|\bpi\b/i.test(name))
    return (
      <Glyph size={size}>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="M6.5 8.5h.01M9 8.5h.01M11.5 8.5h.01M14 8.5h.01M16.5 8.5h.01" />
        <rect x="9.5" y="11.5" width="5" height="4.5" rx="1" />
      </Glyph>
    );
  const Icon = /vps|server|hetzner|droplet|linode|ec2|nas|cloud/i.test(name)
    ? Server
    : /book|laptop|thinkpad|xps/i.test(name)
      ? Laptop
      : Monitor;
  return <Icon size={size} strokeWidth={1.7} aria-hidden />;
}
