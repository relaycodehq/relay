#include <metal_stdlib>
using namespace metal;

// The pairing screen's field: rows of dots on a gently swelling floor, rings going out from the
// phone and the computer. Scanning, the near middle of it lands in the viewfinder and takes the
// camera's light, the picture develops out across the screen in dots, the dots lock onto the code,
// and the code bursts back out into the whole field.

/// Wide enough to fill a disc round the computer, so the view can turn all the way round it.
constant int COLS = 118;
/// Rows running away from you, then a few in front of the first, filling the disc on the near side.
constant int AWAY = 128;
constant int ROWS = AWAY + 12;
/// The computer, which the view turns round.
constant float2 COMPUTER = float2(0.0, -13.0);
constant float STEP = 0.36;
/// Ring slots, room for a finger's too, then the two packets.
constant int SLOTS = 24;
/// The near middle of the field: a dot for each place in the viewfinder.
constant int GRID = 50;
constant int G0 = (COLS - GRID) / 2;
/// How far the viewfinder's corner marks run along its edges, in dots.
constant int BRACKET = 11;
/// Points a cell of the camera's dots: the landed grid's own pitch, two to a module of the code.
constant float PITCH = 5.0;

/// Laid out as RippleRenderer's FieldUniforms.
struct FieldUniforms {
    float4x4 viewProjection;
    /// The code's square (0..1, top left first) to the screen, NDC.
    float3x3 code;
    /// The viewfinder's centre and half size, NDC.
    float4 window;
    float3 eye;
    float3 base;
    float3 hot;
    /// The scanner's dots: the accent, lighter over the camera.
    float3 scan;
    float2 screen;
    float time;
    /// Pixels a unit at distance 1 covers.
    float px;
    /// Pixels to a point.
    float unit;
    float baseAlpha;
    float gather;
    float clear;
    float rest;
    float lock;
    float charge;
    /// Seconds since the code burst; below 0 when it hasn't.
    float burst;
    /// Modules a side of the code; 0 before one's seen.
    int modules;
    /// The halftone's front, points from the viewfinder's edge, and whether the way in or out is playing.
    float front;
    float entering;
    /// How far the viewfinder's landed dots have taken the camera's light, 0..1.
    float develop;
};

struct DotOut {
    float4 position [[position]];
    float4 color;
    float2 corner;
    float fade;
    float soft;
};

static float rand(uint i, uint salt) {
    uint s = i * 747796405u + salt * 2891336453u + 1u;
    s = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    s = (s >> 22u) ^ s;
    return float(s) / 4294967295.0;
}

static float2 onCode(float3x3 h, float2 m) {
    float3 p = h * float3(m, 1.0);
    return p.xy / p.z;
}

static float ease(float x) { return x * x * (3.0 - 2.0 * x); }

/// How far a viewfinder dot has got from the field to its place, near rows first.
static float landing(float gather, uint iid, float gy) {
    return ease(clamp(gather * 1.6 - gy * 0.45 - rand(iid, 1u) * 0.15, 0.0, 1.0));
}

/// How far the landed dot at `cell` (points from the viewfinder's middle) has taken the camera's
/// light: from the middle out, the corners last.
static float developed(float develop, float2 cell) {
    return clamp((develop * 1.35 - length(cell) / 177.0) / 0.35, 0.0, 1.0);
}

/// Points from the viewfinder's edge, negative inside; p from its middle. Rounder at the corners
/// than the viewfinder, so the front running out of it turns round as the field's ripples are.
static float frontDistance(float2 p) {
    float2 q = abs(p) - float2(45.0);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 80.0;
}

vertex DotOut dotVertex(
    uint vid [[vertex_id]], uint iid [[instance_id]], constant FieldUniforms &u [[buffer(0)]],
    constant float4 *waves [[buffer(1)]], constant uchar *modules [[buffer(2)]]
) {
    int ci = int(iid) % COLS;
    int ri = int(iid) / COLS;
    float c = float(ci);
    float r = ri < AWAY ? float(ri) : float(AWAY - 1 - ri);
    float2 xz = float2((c - float(COLS - 1) * 0.5 + fmod(abs(r), 2.0) * 0.5) * STEP, 5.5 - r * STEP * 0.866);
    float swell = 0.11 * sin(xz.x * 0.55 + u.time * 0.6) * cos(xz.y * 0.42 - u.time * 0.45)
                + 0.05 * sin(xz.y * 0.9 + xz.x * 0.2 + u.time * 0.8);
    float lift = 0.0;
    float wash = 0.0;
    for (int i = 0; i < SLOTS; i++) {
        float4 p = waves[i];
        float age = u.time - p.z;
        if (age < 0.0 || p.w <= 0.0) continue;
        float ring = distance(xz, p.xy) - age * 3.4;
        float fade = p.w * exp(-age * 0.28);
        lift += fade * exp(-ring * ring / (0.12 + age * 0.06));
        // What the ring has passed stays lit for a moment behind it.
        wash += fade * exp(min(ring, 0.0) / 1.6) * step(ring, 0.0) * exp(-age * 0.9) * 0.5;
    }
    // The field glows under a packet as it passes over.
    for (int i = 0; i < 2; i++) {
        float4 k = waves[SLOTS + i];
        float2 d = xz - k.xy;
        wash += k.w * exp(-dot(d, d) / (0.35 + k.z * 0.5)) * (1.0 - k.z * 0.3);
    }
    float h = clamp(lift * 1.3 + wash, 0.0, 1.0);
    float3 pos = float3(xz.x, swell + lift * 0.5 + wash * 0.08, xz.y);
    float4 clip = u.viewProjection * float4(pos, 1.0);
    float dist = distance(pos, u.eye);
    float fog = (1.0 - smoothstep(15.0, 31.0, dist)) * (1.0 - smoothstep(17.0, 21.0, distance(xz, COMPUTER)))
              * smoothstep(0.4, 1.6, clip.w);
    float size = min(u.px * (0.042 + 0.07 * h) / max(clip.w, 0.01), 30.0 * u.unit);
    float4 col = float4(mix(u.base, u.hot, h), 1.0) * (u.baseAlpha + (1.0 - u.baseAlpha) * h) * fog;
    float4 home = col;
    float homeSize = size;

    int gx = ci - G0;
    bool chosen = gx >= 0 && gx < GRID && ri < GRID;
    float2 g = (float2(float(gx), r) + 0.5) / float(GRID);
    // The module each chosen dot lands on, (0,0) top left; dots sharing one sit on its middle.
    float2 m = float2(g.x, 1.0 - g.y);
    int n = max(u.modules, 1);
    int2 cell = clamp(int2(m * float(n)), 0, n - 1);
    bool dark = chosen && u.modules > 0 && modules[cell.y * n + cell.x] != 0;
    float2 mid = onCode(u.code, float2(0.5));
    float modulePx = length((onCode(u.code, float2(1.0, 0.0)) - onCode(u.code, float2(0.0))) * u.screen * 0.5) / float(n);
    float fade = 1.0;
    float soft = 0.0;
    float4 at = clip;
    if (chosen) {
        float p = landing(u.gather, iid, g.y);
        int ex = min(gx, GRID - 1 - gx), ey = min(ri, GRID - 1 - ri);
        bool bracket = min(ex, ey) == 0 && max(ex, ey) < BRACKET;
        float cleared = clamp(u.clear * 1.6 - length(g - 0.5) * 0.85, 0.0, 1.0);
        float2 win = u.window.xy + (g * 2.0 - 1.0) * u.window.zw;
        float4 onWin = float4(u.scan, 1.0) * (bracket ? 1.0 : 0.4 * (1.0 - cleared));
        float l = ease(clamp(u.lock * 1.8 - (m.x + m.y) * 0.4, 0.0, 1.0));

        float2 from = clip.w > 0.2 ? clip.xy / clip.w : float2(sign(clip.x) * 0.3, -1.3);
        float2 xy = mix(from, win, p);
        xy = mix(mix(xy, onCode(u.code, (float2(cell) + 0.5) / float(n)), l), mid, 0.06 * u.charge);
        col = mix(col, onWin, p);
        // White-hot as each dot lands, so the read sweeps across the code; white again as it draws in to burst.
        float white = max(0.6 * sin(M_PI_F * l), 0.55 * u.charge);
        col = mix(col, dark ? mix(float4(u.scan, 1.0), float4(1.0), white) : float4(0.0), l);
        float winPx = u.window.z * u.screen.x / float(GRID) * (bracket ? 0.75 : 0.55);
        size = mix(size, winPx, p) * (1.0 + 1.6 * sin(M_PI_F * p));
        size = mix(size, modulePx * 0.95, l) * (1.0 - 0.15 * u.charge);
        // Landed, it holds until the camera's dot in its cell takes over from it.
        if (u.entering > 0.5 && l == 0.0 && !bracket) col *= 1.0 - smoothstep(0.2, 0.9, developed(u.develop, (g - 0.5) * 250.0));
        if (p + l > 0.0) at = float4(xy, 0.0, 1.0);
        fade = 1.0 - p;
    } else if (u.entering > 0.5) {
        // The halftone's front reaches each dot of the field: it catches the light, then goes.
        float2 pt = clip.w > 0.2 ? (clip.xy / clip.w - u.window.xy) * u.screen / (2.0 * u.unit) : float2(0.0, -2000.0);
        float behind = u.front - frontDistance(pt);
        float glint = exp(-(behind + 6.0) * (behind + 6.0) / 300.0);
        col = mix(col, float4(u.scan, 1.0) * fog, 0.85 * glint);
        size *= 1.0 + 0.7 * glint;
        col *= 1.0 - smoothstep(0.0, 26.0, behind);
    } else {
        col *= 1.0 - u.rest;
    }

    // The code bursts and every dot of the field comes out of it: those on its dark modules from
    // where they sit, the rest out of nothing inside it. Each flies out, bows toward you, and drops
    // back into its place.
    if (u.burst >= 0.0) {
        float2 s0 = dark ? (float2(cell) + 0.5) / float(n) : float2(rand(iid, 2u), rand(iid, 3u));
        float2 hs = u.screen * 0.5;
        float2 S = mix(onCode(u.code, s0), mid, dark ? 0.06 : 0.0) * hs;
        float2 E = (clip.w > 0.2 ? clip.xy / clip.w : float2(sign(clip.x) * 2.0, -2.0)) * hs;
        float2 away = S - mid * hs;
        away = length(away) > 1.0 ? normalize(away) : float2(cos(float(iid)), sin(float(iid)));
        float turn = (rand(iid, 4u) - 0.5) * 1.6;
        away = float2x2(float2(cos(turn), sin(turn)), float2(-sin(turn), cos(turn))) * away;
        float2 P1 = S + away * (70.0 + 300.0 * pow(rand(iid, 5u), 1.6)) * u.unit;
        float2 P2 = E + float2(0.0, (40.0 + 110.0 * rand(iid, 6u)) * u.unit);
        float delay = rand(iid, 7u) * 0.16;
        float dur = 0.85 + 0.55 * clamp(distance(S, E) / (560.0 * u.unit), 0.0, 1.0) + 0.2 * rand(iid, 8u);
        float t = clamp((u.burst - delay) / dur, 0.0, 1.0);
        float q = 1.0 - pow(1.0 - t, 3.0);
        float iq = 1.0 - q;
        float2 B = iq * iq * iq * S + 3.0 * iq * iq * q * P1 + 3.0 * iq * q * q * P2 + q * q * q * E;
        at = float4(B / hs, 0.0, 1.0);

        // Hot out of the code, cooling to where it lands, where it glints once and settles.
        float4 landed = mix(home, float4(u.hot, 1.0) * fog, 0.75);
        float4 start = dark ? mix(float4(u.scan, 1.0), float4(1.0), 0.55) : float4(u.scan, 1.0);
        float after = u.burst - delay - dur;
        col = after > 0.0 ? mix(home, landed, exp(-after * 3.0)) : mix(start, landed, smoothstep(0.25, 1.0, t));
        col *= dark ? 1.0 : smoothstep(0.0, 0.1, t);
        // A few come right at you, big and out of focus.
        float toward = pow(rand(iid, 9u), 5.0) * 3.5 * sin(M_PI_F * t);
        soft = clamp(toward / 2.0, 0.0, 1.0);
        col *= 1.0 - 0.55 * soft;
        float glint = after > 0.0 ? exp(-after * 3.0) : 1.0;
        size = mix(modulePx * (dark ? 0.85 : 0.6), homeSize * (1.0 + 0.5 * glint), q) * (1.0 + toward);
        fade = smoothstep(0.6, 1.0, t);
    }

    float2 corner = float2(vid & 1u ? 1.0 : -1.0, vid & 2u ? 1.0 : -1.0);
    size = max(size, 1.5 * u.unit * 0.5);
    DotOut out;
    out.position = at + float4(corner * size / u.screen * at.w, 0.0, 0.0);
    out.color = col * min(1.0, size / (1.5 * u.unit * 0.5));
    out.corner = corner;
    out.fade = fade;
    out.soft = soft;
    return out;
}

/// Round dots; in the field they fade toward the words below.
fragment float4 dotFragment(DotOut in [[stage_in]], constant FieldUniforms &u [[buffer(0)]]) {
    float d = length(in.corner) * 0.5;
    float y = in.position.y / u.screen.y;
    float curve = y < 0.52 ? 1.0 : y < 0.7 ? mix(1.0, 0.4, (y - 0.52) / 0.18) : mix(0.4, 0.16, (y - 0.7) / 0.3);
    return in.color * (1.0 - smoothstep(mix(0.25, 0.0, in.soft), 0.5, d)) * mix(1.0, curve, in.fade);
}

/// Laid out as RippleRenderer's Glow.
struct Glow {
    float4 clip;
    /// Pixels across, and how strong.
    float2 sizeAlpha;
};

struct GlowOut {
    float4 position [[position]];
    float4 color;
    float2 corner;
};

vertex GlowOut glowVertex(
    uint vid [[vertex_id]], uint iid [[instance_id]], constant Glow *glows [[buffer(0)]],
    constant float4 &tint [[buffer(1)]], constant float2 &screen [[buffer(2)]]
) {
    Glow g = glows[iid];
    float2 corner = float2(vid & 1u ? 1.0 : -1.0, vid & 2u ? 1.0 : -1.0);
    float size = max(g.sizeAlpha.x, 2.0);
    GlowOut out;
    out.position = g.clip + float4(corner * size / screen * g.clip.w, 0.0, 0.0);
    out.color = float4(tint.rgb, 1.0) * g.sizeAlpha.y * min(1.0, size / 2.0);
    out.corner = corner;
    return out;
}

fragment float4 glowFragment(GlowOut in [[stage_in]]) {
    float d = length(in.corner);
    float core = 1.0 - smoothstep(0.0, 0.32, d);
    float halo = exp(-d * d * 7.0) * 0.55;
    return in.color * clamp(core + halo, 0.0, 1.0);
}

/// Laid out as RippleRenderer's CameraUniforms.
struct CameraUniforms {
    /// The screen, NDC, to the code's square (0..1, top left first).
    float3x3 uncode;
    float4 window;
    float3 accent;
    float2 screen;
    /// The screen's share of the picture each way, which fills it as a camera app's does.
    float2 fill;
    float unit;
    float front;
    float entrance;
    float alpha;
    float shade;
    float lifted;
    float light;
    float develop;
};

struct CameraOut {
    float4 position [[position]];
};

vertex CameraOut cameraVertex(uint vid [[vertex_id]]) {
    float2 p = float2(float((vid << 1) & 2u), float(vid & 2u)) * 2.0 - 1.0;
    CameraOut out;
    out.position = float4(p, 0.0, 1.0);
    return out;
}

static float3 picture(texture2d<float> camera, float2 ndc, constant CameraUniforms &u) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    return camera.sample(s, float2(ndc.x, -ndc.y) * 0.5 * u.fill + 0.5).rgb;
}

/// The camera under the field. One dot a cell of the landed grid, as big as the light the camera
/// sees there (as dark, like ink, in the light theme), until the cells close up into the picture.
fragment float4 cameraFragment(
    CameraOut in [[stage_in]], constant CameraUniforms &u [[buffer(0)]], texture2d<float> camera [[texture(0)]]
) {
    float2 ndc = float2(in.position.x / u.screen.x * 2.0 - 1.0, 1.0 - in.position.y / u.screen.y * 2.0);
    float2 points = u.screen / (2.0 * u.unit);
    float2 p = (ndc - u.window.xy) * points;
    float2 k = floor(p / PITCH);
    float2 cell = (k + 0.5) * PITCH;
    float dist = frontDistance(cell);
    // Inside the viewfinder each dot is born from the field's dot that landed on it, the middle first.
    float born = all(abs(cell) < float2(125.0)) ? developed(u.develop, cell) : clamp((u.front - dist) / 34.0, 0.0, 1.0);
    float closed = ease(clamp((u.front - dist - 120.0) / 150.0, 0.0, 1.0));
    // The lens eases in by a few percent as the picture closes up.
    float zoom = 1.0 + 0.05 * (1.0 - u.entrance) * (1.0 - u.entrance);
    // The light over the cell, not at one pixel of it.
    float2 at = u.window.xy + cell / points / zoom, d = 1.5 / points;
    float3 seen = (picture(camera, at, u) + picture(camera, at + float2(d.x, d.y), u) + picture(camera, at - float2(d.x, d.y), u)
        + picture(camera, at + float2(d.x, -d.y), u) + picture(camera, at - float2(d.x, -d.y), u)) / 5.0;
    float lum = dot(seen, float3(0.299, 0.587, 0.114));
    float tone = sqrt(clamp(u.light > 0.5 ? 1.0 - lum : lum * 1.6, 0.0, 1.0));
    // Short of touching, so even the white of the code still reads as dots.
    float pop = 1.0 + 0.45 * sin(M_PI_F * born);
    float r = mix(0.9, PITCH * (0.1 + 0.36 * tone), ease(born)) * pop;
    r = mix(r, PITCH * 0.75, closed);
    float aa = 0.75 / u.unit;
    float disc = (1.0 - smoothstep(r - aa, r + aa, length(p - cell))) * step(0.001, born);
    float alpha = max(disc, smoothstep(0.8, 1.0, closed));
    // Born in the scanner's colour, taking the camera's as it grows, lit up like a screen of LEDs
    // until the cells close up and the picture settles.
    float3 dots = mix(u.accent * 1.4, seen * mix(2.1, 1.0, closed), smoothstep(0.0, 0.55, born)) * mix(pop, 1.0, closed);
    float3 c = mix(dots, picture(camera, u.window.xy + (ndc - u.window.xy) / zoom, u), closed);
    c *= 1.0 - u.shade;
    // Once the code has burst out of the screen, a dark square is left where it was.
    float3 m = u.uncode * float3(ndc, 1.0);
    float2 onCode = m.xy / m.z;
    if (u.lifted > 0.5 && m.z > 0.0 && all(onCode >= 0.0) && all(onCode <= 1.0)) c = float3(0.04);
    return float4(c, 1.0) * alpha * u.alpha;
}
