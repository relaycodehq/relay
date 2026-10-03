import { clamp, hash, type Mat4, type Vec3 } from "./math";
import type { Path } from "./path";
import {
  MAX_OCCLUDERS,
  backdropFragment,
  fullscreenVertex,
  moteFragment,
  moteVertex,
  ribbonFragment,
  ribbonVertex,
} from "./shaders";

export type Rgb = readonly [number, number, number];

/** One visible length of ribbon along a path. */
export interface Strand {
  path: Path;
  /** Tail and head, as distances along the path. */
  from: number;
  to: number;
  /** Multiplies the path's own width. */
  width?: number;
  /** How far the ends take to narrow to a point. */
  taperTail?: number;
  taperHead?: number;
  alpha?: number;
  /** Multiplies the satin colour; a function tints by distance along the path. */
  tint?: Rgb | ((distance: number) => Rgb);
  /** Bands of light travelling along the ribbon. */
  glints?: Glint[];
  /** Draws only the glints, as light laid over whatever is underneath. */
  glintOnly?: boolean;
  /** 0 lights the reverse side like the face; 1 (the default) shades it darker. */
  reverse?: number;
  /** Scales the light the ribbon throws around itself; 1 by default. */
  halo?: number;
}

export interface Glint {
  /** Where its centre is, as a distance along the path. */
  at: number;
  width?: number;
  strength: number;
  color?: Rgb;
}

/** A panel the ribbon can pass behind. */
export interface Occluder {
  center: Vec3;
  right: Vec3;
  up: Vec3;
  halfWidth: number;
  halfHeight: number;
}

export interface Backdrop {
  base: Rgb;
  glowA: Rgb;
  glowB: Rgb;
  /** Light coming up from below the frame: dawn. */
  horizon: Rgb;
  drift: readonly [number, number];
  motes: Rgb;
}

export interface Scene {
  viewProj: Mat4;
  eye: Vec3;
  light: Vec3;
  time: number;
  exposure: number;
  strands: Strand[];
  occluders: Occluder[];
  backdrop: Backdrop;
}

const STRIDE = 18;
const STEP = 7;
const MAX_SAMPLES = 2400;
const MOTES = 1100;

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "shader failed");
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? "program failed");
  return program;
}

/**
 * One canvas. The film stacks two around the DOM panels: the back one draws
 * the room and every ribbon, the front one draws only the ribbon that no
 * panel covers, so a ribbon can pass behind a panel and come out in front.
 */
class Layer {
  private readonly gl: WebGL2RenderingContext;
  private readonly ribbon: WebGLProgram;
  private readonly backdrop: WebGLProgram | null = null;
  private readonly motes: WebGLProgram | null = null;
  private readonly ribbonArray: WebGLVertexArrayObject;
  private readonly ribbonBuffer: WebGLBuffer;
  private readonly moteArray: WebGLVertexArrayObject | null = null;
  private readonly emptyArray: WebGLVertexArrayObject;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly front: boolean,
    motes: Float32Array,
  ) {
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("This film needs WebGL 2.");
    this.gl = gl;
    this.ribbon = compile(gl, ribbonVertex, ribbonFragment);
    this.emptyArray = gl.createVertexArray()!;

    this.ribbonArray = gl.createVertexArray()!;
    this.ribbonBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.ribbonArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffer);
    const bytes = STRIDE * 4;
    const layout: [string, number, number][] = [
      ["aPos", 3, 0],
      ["aNormal", 3, 3],
      ["aTangent", 3, 6],
      ["aUV", 2, 9],
      ["aColor", 4, 11],
      ["aGlint", 3, 15],
    ];
    for (const [name, size, offset] of layout) {
      const at = gl.getAttribLocation(this.ribbon, name);
      if (at < 0) continue;
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, size, gl.FLOAT, false, bytes, offset * 4);
    }

    if (!front) {
      this.backdrop = compile(gl, fullscreenVertex, backdropFragment);
      this.motes = compile(gl, moteVertex, moteFragment);
      this.moteArray = gl.createVertexArray()!;
      gl.bindVertexArray(this.moteArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, motes, gl.STATIC_DRAW);
      const at = gl.getAttribLocation(this.motes, "aMote");
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, 4, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(null);
  }

  draw(scene: Scene, vertices: Float32Array, runs: Run[], pixelScale: number) {
    const gl = this.gl;
    const { width, height } = this.canvas;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (this.backdrop) {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.backdrop);
      const u = (name: string) => gl.getUniformLocation(this.backdrop!, name);
      gl.uniform2f(u("uRes"), width, height);
      gl.uniform1f(u("uTime"), scene.time);
      gl.uniform3fv(u("uBase"), scene.backdrop.base);
      gl.uniform3fv(u("uGlowA"), scene.backdrop.glowA);
      gl.uniform3fv(u("uGlowB"), scene.backdrop.glowB);
      gl.uniform3fv(u("uHorizon"), scene.backdrop.horizon);
      gl.uniform2fv(u("uDrift"), scene.backdrop.drift);
      gl.uniform1f(u("uSeed"), Math.floor(scene.time * 60) % 997);
      gl.bindVertexArray(this.emptyArray);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    if (this.motes && this.moteArray) {
      gl.useProgram(this.motes);
      const u = (name: string) => gl.getUniformLocation(this.motes!, name);
      gl.uniformMatrix4fv(u("uViewProj"), false, scene.viewProj);
      gl.uniform1f(u("uScale"), pixelScale);
      gl.uniform1f(u("uTime"), scene.time);
      gl.uniform3fv(u("uTint"), scene.backdrop.motes);
      gl.bindVertexArray(this.moteArray);
      gl.drawArrays(gl.POINTS, 0, MOTES);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(this.ribbon);
    const u = (name: string) => gl.getUniformLocation(this.ribbon, name);
    gl.uniformMatrix4fv(u("uViewProj"), false, scene.viewProj);
    gl.uniform3fv(u("uEye"), scene.eye);
    gl.uniform3fv(u("uLight"), scene.light);
    gl.uniform1f(u("uFront"), this.front ? 1 : 0);
    gl.uniform1f(u("uExposure"), scene.exposure);
    gl.uniform3fv(u("uFog"), scene.backdrop.base.map((c) => c * 1.6));
    const count = Math.min(scene.occluders.length, MAX_OCCLUDERS);
    gl.uniform1i(u("uOccCount"), count);
    if (count) {
      const centers: number[] = [];
      const rights: number[] = [];
      const ups: number[] = [];
      const halves: number[] = [];
      for (const o of scene.occluders.slice(0, count)) {
        centers.push(...o.center);
        rights.push(...o.right);
        ups.push(...o.up);
        halves.push(o.halfWidth, o.halfHeight);
      }
      gl.uniform3fv(u("uOccCenter"), centers);
      gl.uniform3fv(u("uOccRight"), rights);
      gl.uniform3fv(u("uOccUp"), ups);
      gl.uniform2fv(u("uOccHalf"), halves);
    }
    gl.bindVertexArray(this.ribbonArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    const reverse = u("uReverse");
    const halo = u("uHalo");
    if (!this.front) {
      // Behind everything else: no depth, and it only ever adds light.
      gl.disable(gl.DEPTH_TEST);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform1f(halo, 64);
      for (const run of runs)
        if (run.halo) gl.drawArrays(gl.TRIANGLE_STRIP, run.first, run.count);
      gl.enable(gl.DEPTH_TEST);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.uniform1f(halo, 0);
    // Solid ribbon first, writing depth; then whatever is fading, blended
    // over it without, so a see-through ribbon never punches a hole.
    for (const solid of [true, false]) {
      gl.depthMask(solid);
      for (const run of runs) {
        if (run.solid !== solid) continue;
        gl.uniform1f(reverse, run.reverse);
        gl.drawArrays(gl.TRIANGLE_STRIP, run.first, run.count);
      }
    }
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }
}

interface Run {
  first: number;
  count: number;
  reverse: number;
  halo: boolean;
  solid: boolean;
}

const point = (k: number) => Math.pow(Math.sin((k * Math.PI) / 2), 0.8);

const WHITE: Rgb = [1, 1, 1];
const GLINT: Rgb = [1, 0.97, 1];

export class RibbonRenderer {
  private readonly back: Layer;
  private readonly front: Layer;
  private vertices = new Float32Array(STRIDE * 2 * 4096);
  private pixelScale = 1;

  constructor(back: HTMLCanvasElement, front: HTMLCanvasElement) {
    const motes = new Float32Array(MOTES * 4);
    for (let i = 0; i < MOTES; i++) {
      motes[i * 4] = -3800 + hash(i * 3.1) * 22500;
      motes[i * 4 + 1] = -1700 + hash(i * 7.7 + 1) * 4900;
      motes[i * 4 + 2] = -2800 + hash(i * 5.3 + 2) * 4600;
      motes[i * 4 + 3] = hash(i * 11.9 + 3);
    }
    this.back = new Layer(back, false, motes);
    this.front = new Layer(front, true, motes);
  }

  /** Backing size in device pixels; `pixelScale` is device pixels per stage pixel. */
  resize(width: number, height: number, pixelScale: number) {
    this.pixelScale = pixelScale;
    for (const { canvas } of [this.back, this.front]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
  }

  render(scene: Scene) {
    const runs: Run[] = [];
    let cursor = 0;
    for (const strand of scene.strands) {
      const alpha = strand.alpha ?? 1;
      const length = strand.to - strand.from;
      if (alpha <= 0.003 || length <= 1) continue;
      const samples = clamp(Math.ceil(length / STEP), 8, MAX_SAMPLES) + 1;
      const need = (cursor + samples * 2) * STRIDE;
      if (need > this.vertices.length) {
        const grown = new Float32Array(Math.max(need, this.vertices.length * 2));
        grown.set(this.vertices);
        this.vertices = grown;
      }
      const out = this.vertices;
      const scaleWidth = strand.width ?? 1;
      const taperTail = Math.min(strand.taperTail ?? 0, length * 0.5);
      const taperHead = Math.min(strand.taperHead ?? 0, length * 0.5);
      const glints = strand.glints ?? [];
      const stride = length / (samples - 1);
      let before = strand.path.at(strand.from).t;
      for (let i = 0; i < samples; i++) {
        const d = strand.from + (length * i) / (samples - 1);
        const f = strand.path.at(d);
        // How sharply it turns here, as one over the radius of the turn.
        const bend =
          Math.hypot(f.t[0] - before[0], f.t[1] - before[1], f.t[2] - before[2]) / stride;
        before = f.t;
        // Ends narrow like the mark's: a long point that swells smoothly
        // into the full width, with no shoulder where the taper stops.
        let taper = 1;
        if (taperTail > 0) taper *= point(clamp((d - strand.from) / taperTail));
        if (taperHead > 0) taper *= point(clamp((strand.to - d) / taperHead));
        const half = (f.width * scaleWidth * taper) / 2;
        // A thin ribbon throws a narrow light.
        // And none round a tight turn, where the wider strip would fan into spikes.
        const glow =
          taper *
          clamp((f.width * scaleWidth) / 54, 0.2, 1) *
          clamp(1 - bend * 110) *
          (strand.halo ?? 1);
        const tint =
          typeof strand.tint === "function"
            ? strand.tint(d)
            : (strand.tint ?? WHITE);
        let gr = 0;
        let gg = 0;
        let gb = 0;
        for (const glint of glints) {
          const k = (d - glint.at) / (glint.width ?? 220);
          if (k < -1.6 || k > 1.6) continue;
          const light = Math.exp(-k * k * 4) * glint.strength;
          const color = glint.color ?? GLINT;
          gr += color[0] * light;
          gg += color[1] * light;
          gb += color[2] * light;
        }
        // Laid over the crisp mark, a glint is all there is to draw.
        const only = strand.glintOnly ? Math.min(1, Math.max(gr, gg, gb)) : -1;
        for (let side = -1; side <= 1; side += 2) {
          const o = (cursor + i * 2 + (side + 1) / 2) * STRIDE;
          out[o] = f.p[0] + f.b[0] * half * side;
          out[o + 1] = f.p[1] + f.b[1] * half * side;
          out[o + 2] = f.p[2] + f.b[2] * half * side;
          out[o + 3] = f.n[0];
          out[o + 4] = f.n[1];
          out[o + 5] = f.n[2];
          out[o + 6] = f.t[0];
          out[o + 7] = f.t[1];
          out[o + 8] = f.t[2];
          out[o + 9] = glow;
          out[o + 10] = side;
          out[o + 11] = only < 0 ? tint[0] : 0;
          out[o + 12] = only < 0 ? tint[1] : 0;
          out[o + 13] = only < 0 ? tint[2] : 0;
          out[o + 14] = only < 0 ? alpha : alpha * only;
          out[o + 15] = gr;
          out[o + 16] = gg;
          out[o + 17] = gb;
        }
      }
      runs.push({
        first: cursor,
        count: samples * 2,
        reverse: strand.reverse ?? 1,
        halo: !strand.glintOnly && (strand.halo ?? 1) > 0.01,
        solid: !strand.glintOnly && alpha >= 0.999,
      });
      cursor += samples * 2;
    }
    const used = this.vertices.subarray(0, cursor * STRIDE);
    this.back.draw(scene, used, runs, this.pixelScale);
    this.front.draw(scene, used, runs, this.pixelScale);
  }
}
