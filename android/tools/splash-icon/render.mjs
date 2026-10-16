// Renders the system splash's still of the ribbon R (res/drawable*-nodpi/splash_mark.png) with the
// app's own shaders (res/raw/splash_ribbon_*.glsl), and the guide samples GuideParityTest checks
// RibbonGuide.kt against. Rerun after changing either, or the splash jumps when the app takes over:
//   node android/tools/splash-icon/render.mjs
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMERA_DISTANCE, ICON_PX, iconViewProjection, pullGuide, restStrip, span } from './ribbon.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '../../app/src');
const shader = (name) => readFileSync(join(app, 'main/res/raw', `${name}.glsl`), 'utf8');

const samples = [];
for (let i = 0; i <= 40; i++) {
  const u = (pullGuide.length + 4) * (i / 40) - 2;
  const g = pullGuide.sample(u);
  samples.push({ u, p: g.p, t: g.t, b: g.b, twist: g.twist, width: g.width, boost: g.boost });
}
const parity = { span, length: pullGuide.length, samples };
mkdirSync(join(app, 'test/resources'), { recursive: true });
writeFileSync(join(app, 'test/resources/splash-guide.json'), JSON.stringify(parity, null, 1) + '\n');

const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
for (const [folder, light] of [['drawable-nodpi', true], ['drawable-night-nodpi', false]]) {
  const png = await page.evaluate(
    ({ vs, fs, strip, vp, size, cam, light, span }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
      }
      gl.linkProgram(p);
      gl.useProgram(p);
      const data = new Float32Array(strip);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      for (const [loc, n, off] of [[0, 3, 0], [1, 3, 3], [2, 3, 6], [3, 2, 9], [4, 1, 11], [5, 1, 12]]) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 52, off * 4);
      }
      const u = (n) => gl.getUniformLocation(p, n);
      gl.uniformMatrix4fv(u('uVP'), false, new Float32Array(vp));
      gl.uniform3f(u('uCam'), 0, 0, cam);
      gl.uniform1f(u('uSpan'), span);
      gl.uniform1i(u('uLightBg'), light ? 1 : 0);
      gl.uniform1i(u('uMode'), 0);
      gl.viewport(0, 0, size, size);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, data.length / 13);
      return canvas.toDataURL('image/png');
    },
    { vs: shader('splash_ribbon_vs'), fs: shader('splash_ribbon_fs'), strip: Array.from(restStrip()), vp: Array.from(iconViewProjection()), size: ICON_PX, cam: CAMERA_DISTANCE, light, span },
  );
  const out = join(app, 'main/res', folder, 'splash_mark.png');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log(out);
}
await browser.close();
