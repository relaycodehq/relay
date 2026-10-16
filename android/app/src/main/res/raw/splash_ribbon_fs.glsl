#version 300 es
precision highp float;
in vec3 vPos; in vec3 vN; in vec3 vT; in vec2 vUV; in float vWake; in float vWidth;
uniform vec3 uCam;
uniform float uSpan;
uniform bool uLightBg;
// 0 draws the satin; 1 draws the wake, the trail that wipes the splash away.
uniform int uMode;
out vec4 o;

float hash(float n) { return fract(sin(n * 91.345) * 47453.5453); }

void main() {
  if (uMode == 1) {
    float e = 1.0 - abs(vUV.y * 2.0 - 1.0);
    o = vec4(0.0, 0.0, 0.0, vWake * smoothstep(0.0, 0.3, e));
    return;
  }
  vec3 V = normalize(uCam - vPos);
  vec3 N = normalize(vN);
  bool front = dot(N, V) >= 0.0;
  if (!front) N = -N;
  vec3 T = normalize(vT);

  vec3 L1 = normalize(vec3(-0.45, 0.7, 0.6));
  vec3 L2 = normalize(vec3(0.75, -0.35, 0.35));
  float ndl = max(dot(N, L1), 0.0);
  float wrap = ndl * 0.75 + 0.25;

  vec3 deep = vec3(0.42, 0.38, 0.6);
  vec3 lilac = vec3(0.79, 0.75, 0.96);
  vec3 pale = vec3(0.96, 0.945, 1.0);
  vec3 base = front
    ? mix(mix(deep, lilac, smoothstep(0.0, 0.72, wrap)), pale, smoothstep(0.7, 1.0, wrap))
    : mix(deep * 0.6, lilac * 0.66, smoothstep(0.1, 1.0, wrap));

  // Satin: threads along the ribbon, visible only when the camera is close.
  float th = vUV.y * vWidth * 520.0;
  float fw = fwidth(th);
  float detail = clamp(1.0 - fw * 1.4, 0.0, 1.0);
  float thread = 0.5 + 0.5 * sin(th * 6.2831853);
  float slub = hash(floor(th)) * 0.5 + 0.5 * hash(floor(th) + floor(vUV.x * uSpan * 9.0));
  float weave = mix(1.0, 0.86 + 0.22 * thread * (0.7 + 0.3 * slub), detail);

  // Kajiya-Kay sheen: the highlight sits where the threads run across the light.
  vec3 H1 = normalize(L1 + V);
  float d1 = dot(T, H1);
  float s1 = pow(sqrt(max(0.0, 1.0 - d1 * d1)), front ? 70.0 : 10.0) * (front ? 0.95 : 0.1);
  vec3 H2 = normalize(L2 + V);
  float d2 = dot(T, H2);
  float s2 = pow(sqrt(max(0.0, 1.0 - d2 * d2)), 48.0) * (front ? 0.26 : 0.05);
  float sheen = mix(1.0, 0.55 + 0.9 * thread, detail);

  float edge = smoothstep(0.0, 0.06, vUV.y) * smoothstep(1.0, 0.94, vUV.y);
  // On white the pale side would vanish into the page: darker cloth, less shine.
  float onWhite = uLightBg ? 1.0 : 0.0;
  base *= mix(1.0, 0.8, onWhite);
  vec3 col = base * weave * (0.84 + 0.16 * edge);
  col += sheen * mix(1.0, 0.55, onWhite) * (
    s1 * smoothstep(0.0, 0.25, ndl) * vec3(1.0, 0.985, 1.0) + s2 * vec3(0.7, 0.62, 1.0));
  // A soft studio box overhead, so tilted stretches catch a broad sheen.
  float env = smoothstep(0.4, 1.0, dot(reflect(-V, N), normalize(vec3(-0.3, 0.85, 0.45))));
  col += env * (front ? 0.18 : 0.04) * vec3(0.95, 0.93, 1.0);
  // Soft shoulder: sheen piles up into white at grazing angles otherwise.
  vec3 over = max(col - 0.86, 0.0);
  col = min(col, 0.86) + over / (1.0 + over * 7.0);
  o = vec4(col, 1.0);
}
