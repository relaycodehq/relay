// The splash ribbon, ported from Android's res/raw/splash_ribbon_*.glsl and
// splash_backdrop_*.glsl. The launch still (LaunchMark) is Android's render of those shaders:
// change one side and the handoff from the launch screen jumps.
#include <metal_stdlib>
using namespace metal;

struct RibbonVertex {
    packed_float3 pos;
    packed_float3 normal;
    packed_float3 tangent;
    packed_float2 uv;
    float wake;
    float width;
};

struct RibbonUniforms {
    float4x4 viewProjection;
    float3 camera;
    float span;
    int lightBackground;
    // 0 draws the satin; 1 draws the wake, the trail that wipes the splash away.
    int mode;
};

struct RibbonOut {
    float4 position [[position]];
    float3 pos;
    float3 normal;
    float3 tangent;
    float2 uv;
    float wake;
    float width;
};

vertex RibbonOut ribbonVertex(
    uint id [[vertex_id]], const device RibbonVertex *vertices [[buffer(0)]],
    constant RibbonUniforms &u [[buffer(1)]]
) {
    RibbonVertex v = vertices[id];
    RibbonOut o;
    o.pos = float3(v.pos);
    o.normal = float3(v.normal);
    o.tangent = float3(v.tangent);
    o.uv = float2(v.uv);
    o.wake = v.wake;
    o.width = v.width;
    o.position = u.viewProjection * float4(o.pos, 1.0);
    return o;
}

static float hash(float n) { return fract(sin(n * 91.345) * 47453.5453); }

fragment float4 ribbonFragment(RibbonOut in [[stage_in]], constant RibbonUniforms &u [[buffer(1)]]) {
    if (u.mode == 1) {
        float e = 1.0 - abs(in.uv.y * 2.0 - 1.0);
        return float4(0.0, 0.0, 0.0, in.wake * smoothstep(0.0, 0.3, e));
    }
    float3 V = normalize(u.camera - in.pos);
    float3 N = normalize(in.normal);
    bool front = dot(N, V) >= 0.0;
    if (!front) N = -N;
    float3 T = normalize(in.tangent);

    float3 L1 = normalize(float3(-0.45, 0.7, 0.6));
    float3 L2 = normalize(float3(0.75, -0.35, 0.35));
    float ndl = max(dot(N, L1), 0.0);
    float wrap = ndl * 0.75 + 0.25;

    float3 deep = float3(0.42, 0.38, 0.6);
    float3 lilac = float3(0.79, 0.75, 0.96);
    float3 pale = float3(0.96, 0.945, 1.0);
    float3 base = front
        ? mix(mix(deep, lilac, smoothstep(0.0, 0.72, wrap)), pale, smoothstep(0.7, 1.0, wrap))
        : mix(deep * 0.6, lilac * 0.66, smoothstep(0.1, 1.0, wrap));

    // Satin: threads along the ribbon, visible only when the camera is close.
    float th = in.uv.y * in.width * 520.0;
    float fw = fwidth(th);
    float detail = clamp(1.0 - fw * 1.4, 0.0, 1.0);
    float weft = 0.5 + 0.5 * sin(th * 6.2831853);
    float slub = hash(floor(th)) * 0.5 + 0.5 * hash(floor(th) + floor(in.uv.x * u.span * 9.0));
    float weave = mix(1.0, 0.86 + 0.22 * weft * (0.7 + 0.3 * slub), detail);

    // Kajiya-Kay sheen: the highlight sits where the threads run across the light.
    float3 H1 = normalize(L1 + V);
    float d1 = dot(T, H1);
    float s1 = pow(sqrt(max(0.0, 1.0 - d1 * d1)), front ? 70.0 : 10.0) * (front ? 0.95 : 0.1);
    float3 H2 = normalize(L2 + V);
    float d2 = dot(T, H2);
    float s2 = pow(sqrt(max(0.0, 1.0 - d2 * d2)), 48.0) * (front ? 0.26 : 0.05);
    float sheen = mix(1.0, 0.55 + 0.9 * weft, detail);

    float edge = smoothstep(0.0, 0.06, in.uv.y) * smoothstep(1.0, 0.94, in.uv.y);
    // On white the pale side would vanish into the page: darker cloth, less shine.
    float onWhite = u.lightBackground != 0 ? 1.0 : 0.0;
    base *= mix(1.0, 0.8, onWhite);
    float3 col = base * weave * (0.84 + 0.16 * edge);
    col += sheen * mix(1.0, 0.55, onWhite)
        * (s1 * smoothstep(0.0, 0.25, ndl) * float3(1.0, 0.985, 1.0) + s2 * float3(0.7, 0.62, 1.0));
    // A soft studio box overhead, so tilted stretches catch a broad sheen.
    float env = smoothstep(0.4, 1.0, dot(reflect(-V, N), normalize(float3(-0.3, 0.85, 0.45))));
    col += env * (front ? 0.18 : 0.04) * float3(0.95, 0.93, 1.0);
    // Soft shoulder: sheen piles up into white at grazing angles otherwise.
    float3 over = max(col - 0.86, 0.0);
    col = min(col, 0.86) + over / (1.0 + over * 7.0);
    return float4(col, 1.0);
}

struct BackdropUniforms {
    float3 background;
    float alpha;
    float2 resolution;
};

struct BackdropOut {
    float4 position [[position]];
};

vertex BackdropOut backdropVertex(uint id [[vertex_id]]) {
    float2 p = float2((id << 1) & 2, id & 2);
    BackdropOut o;
    o.position = float4(p * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

// The splash's background, minus wherever the ribbon's wake has been.
fragment float4 backdropFragment(
    BackdropOut in [[stage_in]], constant BackdropUniforms &u [[buffer(0)]], texture2d<float> mask [[texture(0)]]
) {
    constexpr sampler linear(filter::linear, address::clamp_to_edge);
    float a = u.alpha * (1.0 - mask.sample(linear, in.position.xy / u.resolution).a);
    return float4(u.background * a, a);
}
