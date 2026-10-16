#version 300 es
precision highp float;
// The splash's background, minus wherever the ribbon's wake has been.
uniform vec3 uBg;
uniform float uAlpha;
uniform vec2 uRes;
uniform sampler2D uMask;
out vec4 o;
void main() {
  float a = uAlpha * (1.0 - texture(uMask, gl_FragCoord.xy / uRes).a);
  o = vec4(uBg * a, a);
}
