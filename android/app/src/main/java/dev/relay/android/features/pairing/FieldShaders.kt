package dev.relay.android.features.pairing

// The pairing screen's field, as the iPhone's Ripples.metal draws it: rows of dots on a gently
// swelling floor, rings going out from the phone and the computer. Scanning, the whole of it folds
// into the viewfinder and takes the camera's light, the picture develops out across the screen in
// dots, the dots lock onto the code, and the code bursts back out into the whole field.
// Geometry follows Ripples.metal; the GL shaders skip work once its contribution is invisible.

private const val COMMON = """#version 300 es
precision highp float;
precision highp int;

/** Wide enough to fill a disc round the computer, so the view can turn all the way round it. */
const int COLS = 118;
/** Rows running away from you, then a few in front of the first, filling the disc on the near side. */
const int AWAY = 128;
const int ROWS = AWAY + 12;
/** The computer, which the view turns round. */
const vec2 COMPUTER = vec2(0.0, -13.0);
const float STEP = 0.36;
/** Specks a dot of the field is drawn as. */
const int SPECKS = 24;
/** Ring slots, room for a finger's too, then the two packets. */
const int SLOTS = 24;
/** Places a side of the viewfinder's grid. */
const int GRID = 50;
/** The stretch of the field, as you face it, that folds into the viewfinder. */
const vec2 SCAN_LO = vec2(-12.5, -22.0);
const vec2 SCAN_HI = vec2(12.5, 3.0);
/** How far the viewfinder's corner marks run along its edges, in dots. */
const int BRACKET = 11;
/** Points a cell of the camera's dots: the landed grid's own pitch, two to a module of the code. */
const float PITCH = 5.0;
const float PI = 3.14159265;

float rand(uint i, uint salt) {
    uint s = i * 747796405u + salt * 2891336453u + 1u;
    s = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    s = (s >> 22u) ^ s;
    return float(s) / 4294967295.0;
}

float ease(float x) { return x * x * (3.0 - 2.0 * x); }

/** How far the landed dot at `cell` (points from the viewfinder's middle) has taken the camera's light. */
float developed(float develop, vec2 cell) {
    return clamp((develop * 1.35 - length(cell) / 177.0) / 0.35, 0.0, 1.0);
}

/** More of its hue where specks add up as light. */
vec3 richer(vec3 c, float glow) {
    float grey = dot(c, vec3(0.299, 0.587, 0.114));
    return max(mix(c, grey + (c - grey) * 1.5, glow), 0.0);
}
"""

private const val FIELD_UNIFORMS = """
uniform mat4 viewProjection;
/** The code's square (0..1, top left first) to the screen, NDC. */
uniform mat3 code;
/** The viewfinder's centre and half size, NDC. */
uniform vec4 window;
uniform vec3 eye;
uniform vec3 base;
uniform vec3 hot;
uniform vec3 scan;
uniform vec2 screen;
uniform float time;
uniform float px;
uniform float unit;
uniform float baseAlpha;
uniform float gather;
uniform float clear;
uniform float lock;
uniform float charge;
uniform float burst;
uniform int modules;
uniform float entering;
uniform float develop;
uniform float turn;
uniform float glow;
uniform vec4 waves[SLOTS + 2];

out vec4 vColor;
out float vFade;
out float vSoft;

/** As FieldRenderer's swell. */
float swellAt(vec2 xz, float t) {
    return 0.11 * sin(xz.x * 0.55 + t * 0.6) * cos(xz.y * 0.42 - t * 0.45)
         + 0.05 * sin(xz.y * 0.9 + xz.x * 0.2 + t * 0.8);
}

/** How far the rings lift the floor at `xz`, and how lit they've left it. */
vec2 ringsAt(vec2 xz, float t) {
    float lift = 0.0;
    float wash = 0.0;
    for (int i = 0; i < SLOTS; i++) {
        vec4 p = waves[i];
        float age = t - p.z;
        if (age < 0.0 || p.w <= 0.0) continue;
        float ring = distance(xz, p.xy) - age * 3.4;
        float fade = p.w * exp(-age * 0.28);
        lift += fade * exp(-ring * ring / (0.12 + age * 0.06));
        wash += fade * exp(min(ring, 0.0) / 1.6) * step(ring, 0.0) * exp(-age * 0.9) * 0.5;
    }
    for (int i = 0; i < 2; i++) {
        vec4 k = waves[SLOTS + i];
        vec2 d = xz - k.xy;
        wash += k.w * exp(-dot(d, d) / (0.35 + k.z * 0.5)) * (1.0 - k.z * 0.3);
    }
    return vec2(lift, wash);
}
"""

const val DOT_VERTEX = COMMON + FIELD_UNIFORMS + """
uniform highp usampler2D moduleMap;

vec2 onCode(mat3 h, vec2 m) {
    vec3 p = h * vec3(m, 1.0);
    return p.xy / p.z;
}

vec2 facing(vec2 xz, float a) {
    vec2 d = xz - COMPUTER;
    return COMPUTER + vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
}

vec2 unfacing(vec2 v, float a) {
    vec2 d = v - COMPUTER;
    return COMPUTER + vec2(d.x * cos(a) + d.y * sin(a), -d.x * sin(a) + d.y * cos(a));
}

/** The dot (column, instance row) nearest a point of the field. */
ivec2 nearestDot(vec2 xz) {
    float r = round((5.5 - xz.y) / (STEP * 0.866));
    float c = round(xz.x / STEP + float(COLS - 1) * 0.5 - mod(abs(r), 2.0) * 0.5);
    return ivec2(int(c), r >= 0.0 ? int(r) : AWAY - 1 - int(r));
}

float landing(float g, uint iid, float gy) {
    return ease(clamp(g * 1.6 - gy * 0.45 - rand(iid, 1u) * 0.15, 0.0, 1.0));
}

void main() {
    uint iid = uint(gl_VertexID);
    int spray = gl_VertexID / SPECKS;
    int k = gl_VertexID % SPECKS;
    int ci = spray % COLS;
    int ri = spray / COLS;
    float c = float(ci);
    float r = ri < AWAY ? float(ri) : float(AWAY - 1 - ri);
    vec2 site = vec2((c - float(COLS - 1) * 0.5 + mod(abs(r), 2.0) * 0.5) * STEP, 5.5 - r * STEP * 0.866);
    // Keep the original vertex IDs and landing curve, including when the scan closes again.
    vec2 span = SCAN_HI - SCAN_LO;
    vec2 b = (facing(site, turn) - SCAN_LO) / span;
    ivec2 place = clamp(ivec2(floor(vec2(b.x, 1.0 - b.y) * float(GRID))), ivec2(0), ivec2(GRID - 1));
    vec2 g = (vec2(place) + 0.5) / float(GRID);
    bool keeps = k == 0 && all(equal(nearestDot(unfacing(SCAN_LO + vec2(g.x, 1.0 - g.y) * span, turn)), ivec2(ci, ri)));
    float p = landing(gather, iid, g.y);
    // These specks have faded to exactly zero; avoid their waves and their rasterization.
    if (burst < 0.0 && !keeps && p >= 1.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 1.0;
        vColor = vec4(0.0);
        vFade = 0.0;
        vSoft = 0.0;
        return;
    }
    bool loose = rand(iid, 20u) < 0.25;
    vec2 spread = loose ? vec2(STEP * 1.2, STEP * 1.1) : vec2(STEP * 0.55, 0.06);
    vec2 xz = site + (vec2(rand(iid, 21u), rand(iid, 22u)) * 2.0 - 1.0) * spread;
    float swell = swellAt(xz, time);
    vec2 rings = ringsAt(xz, time);
    float lift = rings.x, wash = rings.y;
    float h = clamp(lift * 1.3 + wash, 0.0, 1.0);
    vec3 pos = vec3(xz.x, swell + lift * 0.5 + wash * 0.08 + (loose ? (rand(iid, 23u) - 0.3) * 0.5 : 0.0), xz.y);
    vec4 clip = viewProjection * vec4(pos, 1.0);
    float dist = distance(pos, eye);
    float fog = (1.0 - smoothstep(15.0, 31.0, dist)) * (1.0 - smoothstep(17.0, 21.0, distance(xz, COMPUTER)))
              * smoothstep(0.4, 1.6, clip.w);
    float grain = rand(iid, 24u);
    bool big = grain > 0.993;
    float size = big ? min(px * 0.045 / max(clip.w, 0.01), 30.0 * unit)
                     : unit * (0.5 + 0.5 * grain) * clamp(7.0 / max(clip.w, 0.01), 0.7, 1.8);
    size *= 1.0 + 1.5 * h;
    vec3 tint = richer(mix(hot, vec3(1.0), 0.2 * pow(rand(iid, 25u), 3.0)), glow);
    float crest = smoothstep(-0.12, 0.16, swell);
    float twinkle = 0.55 + 0.45 * sin(time * (1.0 + 2.5 * rand(iid, 26u)) + 6.283 * rand(iid, 27u));
    float bright = (0.2 + 0.8 * crest) * twinkle * (0.35 + 0.65 * rand(iid, 28u)) * (loose ? 0.6 : 1.0) * (big ? 0.35 : 1.0);
    vec4 col = vec4(mix(mix(base, tint, 0.5 + 0.5 * glow), tint, h), 1.0)
             * (baseAlpha * bright * (3.0 + 8.0 * glow) + (1.0 - baseAlpha) * h) * fog;
    float soft = big ? 1.0 : 0.0;
    vec4 home = col;
    float homeSize = size;

    // Every dot folds into the viewfinder, onto the place of the grid it was over as the field faced
    // you when the scan began. One dot a place stays; the rest melt into it.
    vec2 m = vec2(g.x, 1.0 - g.y);
    int n = max(modules, 1);
    ivec2 cell = clamp(ivec2(m * float(n)), ivec2(0), ivec2(n - 1));
    bool dark = modules > 0 && texelFetch(moduleMap, cell, 0).r != 0u;
    vec2 mid = onCode(code, vec2(0.5));
    float modulePx = length((onCode(code, vec2(1.0, 0.0)) - onCode(code, vec2(0.0))) * screen * 0.5) / float(n);
    float fade = 1.0;
    vec4 at = clip;
    int ex = min(place.x, GRID - 1 - place.x), ey = min(place.y, GRID - 1 - place.y);
    bool bracket = min(ex, ey) == 0 && max(ex, ey) < BRACKET;
    float cleared = clamp(clear * 1.6 - length(g - 0.5) * 0.85, 0.0, 1.0);
    vec2 win = window.xy + (g * 2.0 - 1.0) * window.zw;
    vec4 onWin = vec4(scan, 1.0) * (bracket ? 1.0 : 0.4 * (1.0 - cleared));
    float l = ease(clamp(lock * 1.8 - (m.x + m.y) * 0.4, 0.0, 1.0));

    vec2 from = clip.w > 0.2 ? clip.xy / clip.w : vec2(sign(clip.x) * 0.3, -1.3);
    vec2 xy = mix(from, win, p);
    xy = mix(mix(xy, onCode(code, (vec2(cell) + 0.5) / float(n)), l), mid, 0.06 * charge);
    col = mix(col, onWin, p);
    float white = max(0.6 * sin(PI * l), 0.55 * charge);
    col = mix(col, dark ? mix(vec4(scan, 1.0), vec4(1.0), white) : vec4(0.0), l);
    float winPx = window.z * screen.x / float(GRID) * (bracket ? 0.75 : 0.55);
    size = mix(size, winPx, p) * (1.0 + 1.6 * sin(PI * p));
    size = mix(size, modulePx * 0.95, l) * (1.0 - 0.15 * charge);
    if (entering > 0.5 && l == 0.0 && !bracket) col *= 1.0 - smoothstep(0.2, 0.9, developed(develop, (g - 0.5) * 250.0));
    // Those that melt stay the specks they were and fade on the way.
    if (!keeps) {
        col = home * (1.0 - smoothstep(0.3, 1.0, p));
        size = homeSize;
    }
    if (p + l > 0.0) at = vec4(xy, 0.0, 1.0);
    fade = 1.0 - p;

    // The code bursts and every dot of the field comes out of it.
    if (burst >= 0.0) {
        bool inCode = dark && keeps;
        vec2 s0 = inCode ? (vec2(cell) + 0.5) / float(n) : vec2(rand(iid, 2u), rand(iid, 3u));
        vec2 hs = screen * 0.5;
        vec2 S = mix(onCode(code, s0), mid, inCode ? 0.06 : 0.0) * hs;
        vec2 E = (clip.w > 0.2 ? clip.xy / clip.w : vec2(sign(clip.x) * 2.0, -2.0)) * hs;
        vec2 away = S - mid * hs;
        away = length(away) > 1.0 ? normalize(away) : vec2(cos(float(iid)), sin(float(iid)));
        float bend = (rand(iid, 4u) - 0.5) * 1.6;
        away = mat2(vec2(cos(bend), sin(bend)), vec2(-sin(bend), cos(bend))) * away;
        vec2 P1 = S + away * (70.0 + 300.0 * pow(rand(iid, 5u), 1.6)) * unit;
        vec2 P2 = E + vec2(0.0, (40.0 + 110.0 * rand(iid, 6u)) * unit);
        float delay = rand(iid, 7u) * 0.16;
        float dur = 0.85 + 0.55 * clamp(distance(S, E) / (560.0 * unit), 0.0, 1.0) + 0.2 * rand(iid, 8u);
        float t = clamp((burst - delay) / dur, 0.0, 1.0);
        float q = 1.0 - pow(1.0 - t, 3.0);
        float iq = 1.0 - q;
        vec2 B = iq * iq * iq * S + 3.0 * iq * iq * q * P1 + 3.0 * iq * q * q * P2 + q * q * q * E;
        at = vec4(B / hs, 0.0, 1.0);

        vec4 landed = mix(home, vec4(hot, 1.0) * fog, 0.75);
        vec4 start = inCode ? mix(vec4(scan, 1.0), vec4(1.0), 0.55) : vec4(scan, 1.0);
        float after = burst - delay - dur;
        col = after > 0.0 ? mix(home, landed, exp(-after * 3.0)) : mix(start, landed, smoothstep(0.25, 1.0, t));
        col *= inCode ? 1.0 : smoothstep(0.0, 0.1, t);
        float toward = pow(rand(iid, 9u), 5.0) * 3.5 * sin(PI * t);
        soft = clamp(toward / 2.0, 0.0, 1.0);
        col *= 1.0 - 0.55 * soft;
        float glint = after > 0.0 ? exp(-after * 3.0) : 1.0;
        size = mix(modulePx * (inCode ? 0.85 : 0.6), homeSize * (1.0 + 0.5 * glint), q) * (1.0 + toward);
        fade = smoothstep(0.6, 1.0, t);
    }

    // Smaller than a speck can be drawn, it dims instead of shrinking.
    gl_Position = all(equal(col, vec4(0.0))) ? vec4(2.0, 2.0, 2.0, 1.0) : at;
    gl_PointSize = max(size, 1.2);
    vColor = col * min(1.0, size / 1.2);
    vFade = fade;
    vSoft = soft;
}
"""

/** The computer: a ball of specks floating on the field, flaring out as a call lands. */
const val BEACON_VERTEX = COMMON + FIELD_UNIFORMS + """
uniform float beaconAlpha;
uniform float bloom;
uniform float beaconY;

void main() {
    uint iid = uint(gl_VertexID);
    vec3 mid = vec3(COMPUTER.x, beaconY, COMPUTER.y);
    float z = rand(iid, 30u) * 2.0 - 1.0;
    float a = rand(iid, 31u) * 6.283 + time * (0.25 + 0.35 * rand(iid, 32u));
    float depth = pow(rand(iid, 33u), 1.2);
    float radius = 0.34 * (1.0 + 0.9 * bloom);
    vec3 dir = vec3(sqrt(1.0 - z * z) * cos(a), z * 0.85, sqrt(1.0 - z * z) * sin(a));
    vec3 pos = mid + dir * radius * depth + 0.02 * vec3(sin(time * 1.3 + z * 9.0), cos(time * 1.1 + a), 0.0);
    vec4 clip = viewProjection * vec4(pos, 1.0);
    float twinkle = 0.55 + 0.45 * sin(time * (1.0 + 2.5 * rand(iid, 34u)) + 6.283 * rand(iid, 35u));
    vec3 tint = richer(mix(hot, vec3(1.0), 0.15 * (1.0 - depth)), glow);
    float bright = beaconAlpha * twinkle * (0.5 + 0.5 * rand(iid, 36u)) * (0.6 + 0.3 * bloom) * (0.5 + 0.2 * glow);
    float size = unit * (0.5 + 0.6 * rand(iid, 37u)) * (1.0 + 0.6 * bloom);
    gl_Position = clip;
    gl_PointSize = max(size, 1.2);
    vColor = vec4(tint, 1.0) * clamp(bright, 0.0, 1.0) * step(0.1, clip.w);
    vFade = 1.0;
    vSoft = 0.0;
}
"""

/** Round dots; in the field they fade toward the words below. */
const val DOT_FRAGMENT = """#version 300 es
precision highp float;

uniform vec2 screen;
uniform float glow;
in vec4 vColor;
in float vFade;
in float vSoft;
out vec4 outColor;

void main() {
    float d = length(gl_PointCoord - 0.5);
    float y = 1.0 - gl_FragCoord.y / screen.y;
    float curve = y < 0.52 ? 1.0 : y < 0.7 ? mix(1.0, 0.4, (y - 0.52) / 0.18) : mix(0.4, 0.16, (y - 0.7) / 0.3);
    vec4 c = vColor * (1.0 - smoothstep(mix(0.25, 0.0, vSoft), 0.5, d)) * mix(1.0, curve, vFade);
    // In the field, specks add up as light where they bunch.
    outColor = vec4(c.rgb, c.a * (1.0 - glow * vFade));
}
"""

const val GLOW_VERTEX = """#version 300 es
precision highp float;

const int MAX_GLOWS = 72;
uniform vec4 glowClip[MAX_GLOWS];
/** Pixels across, and how strong. */
uniform vec2 glowSize[MAX_GLOWS];
uniform vec4 tint;
uniform vec2 screen;
out vec4 vColor;
out vec2 vCorner;

void main() {
    vec4 clip = glowClip[gl_InstanceID];
    vec2 sa = glowSize[gl_InstanceID];
    vec2 corner = vec2((gl_VertexID & 1) != 0 ? 1.0 : -1.0, (gl_VertexID & 2) != 0 ? 1.0 : -1.0);
    float size = max(sa.x, 2.0);
    gl_Position = clip + vec4(corner * size / screen * clip.w, 0.0, 0.0);
    vColor = vec4(tint.rgb, 1.0) * sa.y * min(1.0, size / 2.0);
    vCorner = corner;
}
"""

const val GLOW_FRAGMENT = """#version 300 es
precision highp float;

in vec4 vColor;
in vec2 vCorner;
out vec4 outColor;

void main() {
    float d = length(vCorner);
    float core = 1.0 - smoothstep(0.0, 0.32, d);
    float halo = exp(-d * d * 7.0) * 0.55;
    outColor = vColor * clamp(core + halo, 0.0, 1.0);
}
"""

const val CAMERA_VERTEX = """#version 300 es
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
    gl_Position = vec4(p, 0.0, 1.0);
}
"""

/**
 * The camera under the field. One dot a cell of the landed grid, as big as the light the camera
 * sees there (as dark, like ink, in the light theme), until the cells close up into the picture.
 */
const val CAMERA_FRAGMENT = """#version 300 es
#extension GL_OES_EGL_image_external_essl3 : require
precision highp float;

const float PITCH = 5.0;
const float PI = 3.14159265;

uniform samplerExternalOES camera;
/** The upright picture's square (0..1, top left first) to the camera texture's coordinates. */
uniform mat3 picturing;
uniform float hasPicture;
/** The screen, NDC, to the code's square (0..1, top left first). */
uniform mat3 uncode;
uniform vec4 window;
uniform vec3 accent;
uniform vec2 screen;
/** The screen's share of the picture each way, which fills it as a camera app's does. */
uniform vec2 fill;
uniform float unit;
uniform float front;
uniform float entrance;
uniform float alpha;
uniform float shade;
uniform float lifted;
uniform float light;
uniform float develop;
out vec4 outColor;

float ease(float x) { return x * x * (3.0 - 2.0 * x); }

float developed(float d, vec2 cell) {
    return clamp((d * 1.35 - length(cell) / 177.0) / 0.35, 0.0, 1.0);
}

float frontDistance(vec2 p) {
    vec2 q = abs(p) - vec2(45.0);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 80.0;
}

vec3 picture(vec2 ndc) {
    if (hasPicture < 0.5) return vec3(0.0);
    vec2 uv = clamp(vec2(ndc.x, -ndc.y) * 0.5 * fill + 0.5, 0.0, 1.0);
    return texture(camera, (picturing * vec3(uv, 1.0)).xy).rgb;
}

vec3 shaded(vec3 c, vec2 ndc) {
    c *= 1.0 - shade;
    // Once the code has burst out of the screen, a dark square is left where it was.
    if (lifted > 0.5) {
        vec3 m = uncode * vec3(ndc, 1.0);
        vec2 onCode = m.xy / m.z;
        if (m.z > 0.0 && all(greaterThanEqual(onCode, vec2(0.0))) && all(lessThanEqual(onCode, vec2(1.0)))) c = vec3(0.04);
    }
    return c;
}

void main() {
    vec2 ndc = gl_FragCoord.xy / screen * 2.0 - 1.0;
    vec2 points = screen / (2.0 * unit);
    vec2 p = (ndc - window.xy) * points;
    vec2 k = floor(p / PITCH);
    vec2 cell = (k + 0.5) * PITCH;
    float dist = frontDistance(cell);
    float born = all(lessThan(abs(cell), vec2(125.0))) ? developed(develop, cell) : clamp((front - dist) / 34.0, 0.0, 1.0);
    float closed = ease(clamp((front - dist - 120.0) / 150.0, 0.0, 1.0));
    float zoom = 1.0 + 0.05 * (1.0 - entrance) * (1.0 - entrance);
    // Ahead of the reveal nothing is visible; behind it only the full camera picture remains.
    if (born <= 0.0 && closed <= 0.0) {
        outColor = vec4(0.0);
        return;
    }
    if (closed >= 1.0) {
        outColor = vec4(shaded(picture(window.xy + (ndc - window.xy) / zoom), ndc), 1.0) * alpha;
        return;
    }
    vec2 at = window.xy + cell / points / zoom, d = 1.5 / points;
    vec3 seen = (picture(at) + picture(at + vec2(d.x, d.y)) + picture(at - vec2(d.x, d.y))
        + picture(at + vec2(d.x, -d.y)) + picture(at - vec2(d.x, -d.y))) / 5.0;
    float lum = dot(seen, vec3(0.299, 0.587, 0.114));
    float tone = sqrt(clamp(light > 0.5 ? 1.0 - lum : lum * 1.6, 0.0, 1.0));
    float pop = 1.0 + 0.45 * sin(PI * born);
    float r = mix(0.9, PITCH * (0.1 + 0.36 * tone), ease(born)) * pop;
    r = mix(r, PITCH * 0.75, closed);
    float aa = 0.75 / unit;
    float disc = (1.0 - smoothstep(r - aa, r + aa, length(p - cell))) * step(0.001, born);
    float a = max(disc, smoothstep(0.8, 1.0, closed));
    vec3 dots = mix(accent * 1.4, seen * mix(2.1, 1.0, closed), smoothstep(0.0, 0.55, born)) * mix(pop, 1.0, closed);
    vec3 c = mix(dots, picture(window.xy + (ndc - window.xy) / zoom), closed);
    outColor = vec4(shaded(c, ndc), 1.0) * a * alpha;
}
"""
