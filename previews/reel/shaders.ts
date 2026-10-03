export const MAX_OCCLUDERS = 8;

export const ribbonVertex = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aTangent;
in vec2 aUV;
in vec4 aColor;
in vec3 aGlint;
uniform mat4 uViewProj;
uniform float uHalo;
out vec3 vPos;
out vec3 vNormal;
out vec3 vTangent;
out vec2 vUV;
out vec4 vColor;
out vec3 vGlint;
void main() {
  // The halo pass draws the same strip, wider.
  vec3 p = aPos + cross(aTangent, aNormal) * aUV.y * uHalo * aUV.x;
  vPos = p;
  vNormal = aNormal;
  vTangent = aTangent;
  vUV = aUV;
  vColor = aColor;
  vGlint = aGlint;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

// Satin: a wrapped key light for the long soft gradients of the mark, a
// stretched highlight that runs along the weave, and a darker reverse side so
// a twist reads as a fold.
export const ribbonFragment = `#version 300 es
precision highp float;
uniform vec3 uEye;
uniform vec3 uLight;
uniform float uFront;
uniform float uExposure;
uniform float uReverse;
uniform float uHalo;
uniform vec3 uFog;
uniform int uOccCount;
uniform vec3 uOccCenter[${MAX_OCCLUDERS}];
uniform vec3 uOccRight[${MAX_OCCLUDERS}];
uniform vec3 uOccUp[${MAX_OCCLUDERS}];
uniform vec2 uOccHalf[${MAX_OCCLUDERS}];
in vec3 vPos;
in vec3 vNormal;
in vec3 vTangent;
in vec2 vUV;
in vec4 vColor;
in vec3 vGlint;
out vec4 outColor;

// True when a panel sits between the eye and this point.
bool hidden(vec3 p) {
  vec3 ray = p - uEye;
  for (int i = 0; i < ${MAX_OCCLUDERS}; i++) {
    if (i >= uOccCount) break;
    vec3 n = cross(uOccRight[i], uOccUp[i]);
    float along = dot(ray, n);
    if (abs(along) < 1e-5) continue;
    float k = dot(uOccCenter[i] - uEye, n) / along;
    if (k <= 0.0 || k >= 1.0) continue;
    vec3 hit = uEye + ray * k - uOccCenter[i];
    if (abs(dot(hit, uOccRight[i])) < uOccHalf[i].x &&
        abs(dot(hit, uOccUp[i])) < uOccHalf[i].y) return true;
  }
  return false;
}

void main() {
  if (uFront > 0.5 && hidden(vPos)) discard;
  float far = smoothstep(3000.0, 12000.0, length(uEye - vPos));
  if (uHalo > 0.0) {
    // Light the satin throws into the room around it.
    float f = 1.0 - abs(vUV.y);
    float glow = f * f * 0.22 * vUV.x * vColor.a * (1.0 - 0.7 * far);
    outColor = vec4(vec3(0.42, 0.37, 0.86) * vColor.rgb * glow, 0.0);
    return;
  }
  vec3 N = normalize(vNormal);
  vec3 T = normalize(vTangent);
  vec3 V = normalize(uEye - vPos);
  float facing = dot(N, V);
  bool flipped = facing < 0.0;
  if (flipped) N = -N;
  // How much the reverse side differs: the mark is lit alike on both.
  float reverse = flipped ? uReverse : 0.0;
  vec3 L = normalize(uLight);
  float wrap = dot(N, L) * 0.5 + 0.5;

  vec3 shade = mix(vec3(0.36, 0.33, 0.52), vec3(0.20, 0.19, 0.30), reverse);
  vec3 body = mix(vec3(0.68, 0.64, 0.89), vec3(0.40, 0.37, 0.55), reverse);
  vec3 lit = mix(vec3(0.88, 0.86, 0.99), vec3(0.62, 0.58, 0.80), reverse);
  vec3 col = mix(shade, body, smoothstep(0.22, 0.70, wrap));
  col = mix(col, lit, smoothstep(0.74, 0.99, wrap));

  vec3 H = normalize(L + V);
  float th = dot(T, H);
  float sheen = pow(max(0.0, 1.0 - th * th), 36.0) * pow(max(dot(N, H), 0.0), 6.0);
  col += sheen * mix(0.16, 0.06, reverse) * vec3(1.0, 0.98, 1.0);
  // Satin's long highlight: a soft streak that slides across the width as
  // the ribbon turns to or from the light, with the weave's fine lines in it.
  vec3 B = cross(T, N);
  float slide = clamp(dot(H, B) * 2.6, -1.3, 1.3);
  float streak = exp(-pow((vUV.y - slide) * 1.9, 2.0));
  float weave = 0.86 + 0.14 * sin(vUV.y * 46.0 + sin(vUV.y * 9.0) * 2.0);
  col += streak * weave * mix(0.15, 0.07, reverse) * smoothstep(0.3, 0.9, wrap) * vec3(0.95, 0.93, 1.0);
  // Light pools and thins along its length, as it does on cloth that isn't taut.
  col *= 0.93 + 0.07 * sin(dot(vPos, vec3(0.0041, 0.0063, 0.0052)));
  // Turned away from the eye it falls off, which is what makes a twist read.
  col *= mix(0.74, 1.0, pow(abs(facing), 0.75));
  col += pow(1.0 - abs(facing), 3.0) * 0.12 * vec3(0.78, 0.74, 1.0);
  // A faint curl: the long edges sit darker than the middle.
  col *= 1.0 - 0.15 * vUV.y * vUV.y;
  col *= vColor.rgb;
  // A glint takes the satin towards its own colour, then lifts it a little.
  float glint = max(vGlint.r, max(vGlint.g, vGlint.b));
  if (glint > 0.001) {
    vec3 hue = vGlint / glint;
    col = mix(col, hue * 1.04, clamp(glint, 0.0, 1.0) * 0.82) + vGlint * 0.12;
  }
  col *= uExposure;
  // Distance takes the ribbon towards the room's own colour.
  col = mix(col, uFog, far * 0.62);

  float alpha = vColor.a;
  outColor = vec4(col * alpha, alpha);
}`;

export const fullscreenVertex = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// The room the film happens in: near-black, with two slow fields of light
// whose colour follows the time of day.
export const backdropFragment = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uGlowA;
uniform vec3 uGlowB;
uniform vec3 uHorizon;
uniform vec2 uDrift;
uniform float uSeed;
in vec2 vUV;
out vec4 outColor;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += noise(p) * amp;
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  vec2 uv = vUV;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec2 flow = p * 0.9 + uDrift;
  float a = fbm(flow + vec2(uTime * 0.012, 0.0));
  float b = fbm(flow * 1.4 + vec2(40.0, uTime * 0.016));
  float low = smoothstep(0.75, -0.55, p.y);
  vec3 col = uBase;
  col += uGlowA * smoothstep(0.28, 0.85, a) * (0.35 + 0.65 * low);
  col += uGlowB * smoothstep(0.35, 0.9, b) * (1.0 - 0.6 * low);
  // Dawn: a clean band of light rising from below the frame.
  float rise = smoothstep(0.12, -0.6, p.y);
  col += uHorizon * rise * rise * (0.8 + 0.2 * a);
  col *= 1.0 - 0.55 * smoothstep(0.35, 1.05, length(p * vec2(0.85, 1.1)));
  float grain = hash(gl_FragCoord.xy + uSeed) + hash(gl_FragCoord.yx * 1.7 + uSeed) - 1.0;
  col += grain * (1.5 / 255.0);
  outColor = vec4(max(col, 0.0), 1.0);
}`;

export const moteVertex = `#version 300 es
in vec4 aMote;
uniform mat4 uViewProj;
uniform float uScale;
uniform float uTime;
out float vFade;
void main() {
  vec3 p = aMote.xyz;
  p.y += sin(uTime * 0.11 + aMote.w * 40.0) * 26.0;
  p.x += cos(uTime * 0.07 + aMote.w * 91.0) * 18.0;
  vec4 clip = uViewProj * vec4(p, 1.0);
  gl_Position = clip;
  float size = (2.0 + aMote.w * 5.0) * uScale * 900.0 / max(clip.w, 1.0);
  gl_PointSize = clamp(size, 0.0, 26.0 * uScale);
  // Near the lens a mote is a wide faint disc; far away it fades out.
  vFade = (0.3 + 0.6 * aMote.w) * smoothstep(6500.0, 1400.0, clip.w) *
    smoothstep(120.0, 520.0, clip.w) * mix(1.0, 0.35, smoothstep(6.0, 22.0, size / uScale));
}`;

export const moteFragment = `#version 300 es
precision highp float;
uniform vec3 uTint;
in float vFade;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.25, d) * vFade;
  outColor = vec4(uTint * a, a);
}`;
