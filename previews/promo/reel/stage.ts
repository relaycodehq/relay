import {
  basis,
  cross,
  dot,
  multiply,
  norm,
  scale,
  sub,
  type Mat4,
  type Vec3,
} from "./math";
import type { Occluder } from "./ribbon-gl";

/**
 * Panels lay out at this multiple of their size and are scaled back down in
 * space. A layer under a perspective transform is rasterised at 1:1, so
 * without it every close-up of the interface would be soft.
 */
const SHARPNESS = 2;

/** A piece of interface standing in the film's space. */
export class Panel {
  /** What the stage moves about. */
  readonly frame = document.createElement("div");
  /** Where the interface goes; `width` by `height` CSS pixels to its content. */
  readonly el = document.createElement("div");
  /** Centre, in world units. */
  pos: Vec3 = [0, 0, 0];
  right: Vec3 = [1, 0, 0];
  up: Vec3 = [0, 1, 0];
  /** World units per CSS pixel. */
  scale = 1;
  opacity = 1;
  /** Whether a ribbon behind it is hidden. */
  solid = true;
  /** Occluder inset in CSS pixels, for panels with soft or rounded edges. */
  inset = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    className = "",
  ) {
    this.frame.className = "reel-panel";
    this.el.className = `reel-panel-body ${className}`.trim();
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
    this.el.style.zoom = String(SHARPNESS);
    this.frame.append(this.el);
  }

  /** Centre of a descendant, in the panel's own CSS pixels. */
  centre(child: HTMLElement): [number, number] {
    let x = child.offsetWidth / 2;
    let y = child.offsetHeight / 2;
    for (
      let node: HTMLElement | null = child;
      node && node !== this.el;
      node = node.offsetParent as HTMLElement | null
    ) {
      x += node.offsetLeft;
      y += node.offsetTop;
    }
    // Browsers disagree on whether offsets count the zoom; the panel's own
    // measured width says which this one does.
    const k = this.width / this.el.offsetWidth;
    return [x * k, y * k];
  }

  get normal(): Vec3 {
    return norm(cross(this.right, this.up));
  }

  /** Turns the panel around its vertical and horizontal axes, in radians. */
  turn(yaw: number, pitch = 0) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    this.right = [cy, 0, -sy];
    this.up = [sy * sp, cp, cy * sp];
  }

  /** World position of a point given in the panel's own CSS pixels. */
  point(x: number, y: number, lift = 0): Vec3 {
    const dx = (x - this.width / 2) * this.scale;
    const dy = (this.height / 2 - y) * this.scale;
    const n = this.normal;
    return [
      this.pos[0] + this.right[0] * dx + this.up[0] * dy + n[0] * lift,
      this.pos[1] + this.right[1] * dx + this.up[1] * dy + n[1] * lift,
      this.pos[2] + this.right[2] * dx + this.up[2] * dy + n[2] * lift,
    ];
  }
}

export class Stage {
  private readonly panels: Panel[] = [];

  constructor(
    private readonly layer: HTMLElement,
    readonly width: number,
    readonly height: number,
  ) {}

  add<T extends Panel>(panel: T): T {
    this.panels.push(panel);
    this.layer.append(panel.frame);
    return panel;
  }

  /** Stands every panel where the camera sees it; returns what hides ribbon. */
  place(viewProj: Mat4, eye: Vec3): Occluder[] {
    const occluders: Occluder[] = [];
    // Clip space to stage pixels. Depth is kept so the matrix stays
    // invertible (a singular transform would stop the element painting), and
    // negated because CSS counts z towards the viewer.
    const viewport = [
      this.width / 2, 0, 0, 0,
      0, -this.height / 2, 0, 0,
      0, 0, -1, 0,
      this.width / 2, this.height / 2, 0, 1,
    ];
    const screen = multiply(viewport, viewProj);
    for (const panel of this.panels) {
      const el = panel.frame;
      const n = panel.normal;
      const toEye = sub(eye, panel.pos);
      const distance = Math.hypot(toEye[0], toEye[1], toEye[2]);
      const shown = panel.opacity > 0.004 && dot(n, toEye) > 0;
      if (!shown) {
        // Not `visibility`: children that set their own would show through.
        if (el.style.display !== "none") el.style.display = "none";
        continue;
      }
      // Panel pixels (y down, origin top-left) to world.
      const s = panel.scale;
      const z = s / SHARPNESS;
      const local = multiply(
        basis(scale(panel.right, z), scale(panel.up, z), scale(n, z), panel.pos),
        [
          1, 0, 0, 0,
          0, -1, 0, 0,
          0, 0, 1, 0,
          (-panel.width * SHARPNESS) / 2, (panel.height * SHARPNESS) / 2, 0, 1,
        ],
      );
      const m = multiply(screen, local);
      if (el.style.display) el.style.display = "";
      el.style.transform = `matrix3d(${m.map((v) => +v.toFixed(6)).join(",")})`;
      el.style.opacity = panel.opacity >= 0.996 ? "" : panel.opacity.toFixed(3);
      el.style.zIndex = String(Math.round(200000 - distance));
      if (panel.solid && panel.opacity > 0.5)
        occluders.push({
          center: panel.pos,
          right: panel.right,
          up: panel.up,
          halfWidth: (panel.width / 2 - panel.inset) * s,
          halfHeight: (panel.height / 2 - panel.inset) * s,
        });
    }
    return occluders;
  }
}
