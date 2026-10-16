#version 300 es
// The splash ribbon. android/tools/splash-icon renders the splash's still from these same
// shaders: change them and re-render splash_mark.png, or the handoff jumps.
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aTan;
layout(location=3) in vec2 aUV;
layout(location=4) in float aWake;
layout(location=5) in float aWidth;
uniform mat4 uVP;
out vec3 vPos; out vec3 vN; out vec3 vT; out vec2 vUV; out float vWake; out float vWidth;
void main() {
  vPos = aPos; vN = aNrm; vT = aTan; vUV = aUV; vWake = aWake; vWidth = aWidth;
  gl_Position = uVP * vec4(aPos, 1.0);
}
