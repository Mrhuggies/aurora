// World: x = east, y = up, z = north, units ≈ km. Observer at the origin on a lakeshore facing north.

export const fullscreenVert = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const common = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime;
uniform float uFlow;
uniform float uYaw;
uniform float uPitch;
uniform float uFov;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v / 0.875;
}

vec3 cameraRay(vec2 uv) {
  vec2 p = (uv * 2.0 - 1.0) * vec2(uRes.x / uRes.y, 1.0) * tan(uFov * 0.5);
  float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
  vec3 fwd = vec3(sy * cp, sp, cy * cp);
  vec3 right = vec3(cy, 0.0, -sy);
  vec3 up = cross(fwd, right);
  return normalize(fwd + p.x * right + p.y * up);
}

// Shared by both passes so the aurora buffer and the composite agree on the reflected ray.
vec3 waterReflect(vec3 rd) {
  vec2 g = rd.xz / max(-rd.y, 0.002);
  float r1 = noise(g * vec2(0.9, 3.5) + vec2(uTime * 0.25, 0.0));
  float r2 = noise(g * vec2(2.3, 9.0) - vec2(0.0, uTime * 0.4));
  vec3 n = normalize(vec3((r1 - 0.5) * 0.02, 1.0, (r2 - 0.5) * 0.05));
  vec3 r = reflect(rd, n);
  r.y = max(r.y, 0.001);
  return normalize(r);
}

float ridge(float az) {
  float h = 0.018
    + 0.075 * pow(noise(vec2(az * 2.2 + 11.0, 0.5)), 1.6)
    + 0.028 * noise(vec2(az * 7.0, 3.1))
    + 0.008 * noise(vec2(az * 26.0, 7.7));
  // Lower ground straight ahead so the northern sky stays open.
  return h * (0.45 + 0.55 * smoothstep(0.1, 0.9, abs(az)));
}
`

export const auroraFrag = /* glsl */ `
${common}
uniform float uIntensity;
uniform float uStorm;
uniform float uBt;
uniform float uCurtainZ;

const vec3 GREEN  = vec3(0.10, 1.00, 0.36);  // O 557.7 nm
const vec3 RED    = vec3(1.00, 0.08, 0.15);  // O 630.0 nm
const vec3 VIOLET = vec3(0.50, 0.16, 1.00);  // N2+ 427.8 nm lower border

float curtains(vec2 p, float t) {
  float w = 2.2 + t * 0.0055;
  float sum = 0.0;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float on = smoothstep(fk * 0.2 - 0.05, fk * 0.2 + 0.2, uIntensity);
    if (on < 0.01) break;
    float x = p.x;
    float zc = uCurtainZ + fk * (95.0 + 20.0 * fk)
      + 60.0 * sin(x * 0.0032 + fk * 2.1 + uFlow * 0.09)
      + (120.0 + 220.0 * uBt) * (fbm(vec2(x * 0.0019 + fk * 13.7, uFlow * 0.045 + fk * 3.0)) - 0.5);
    float d = p.y - zc;
    float sheet = exp(-d * d / (w * w)) + 0.02 * exp(-abs(d) / (w * 3.0));
    float r1 = noise(vec2(x * 0.06 + fk * 9.0, uTime * 0.3 + uFlow * 0.25));
    float r2 = noise(vec2(x * 0.19 + fk * 5.0, uTime * 0.7 - uFlow * 0.1));
    float rays = 0.15 + 1.9 * pow(r1, 2.0 + 2.0 * uBt) + 0.5 * pow(r2, 3.0);
    float patches = 0.35 + 0.65 * smoothstep(0.2, 0.8, noise(vec2(x * 0.0012 + fk * 4.0, uFlow * 0.02)));
    sum += sheet * rays * patches * on * (1.0 - fk * 0.18);
  }
  return sum;
}

vec3 emission(float a, float x) {
  float edge = a - 0.035 * noise(vec2(x * 0.015, uTime * 0.15));
  float lower = smoothstep(-0.012, 0.02, edge);
  float g = lower * (exp(-max(edge, 0.0) * 6.0) + 0.6 * exp(-max(edge, 0.0) * 30.0));
  float r = smoothstep(0.15, 0.5, a) * exp(-(a - 0.55) * (a - 0.55) * 5.0);
  float v = lower * exp(-max(edge, 0.0) * 38.0);
  return GREEN * g
       + RED * r * (0.03 + 0.9 * pow(uStorm, 1.5))
       + VIOLET * v * (0.04 + 1.2 * uStorm);
}

void main() {
  vec3 rd = cameraRay(vUv);
  if (rd.y < 0.0) rd = waterReflect(rd);
  if (rd.y < 0.012) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  float jitter = fract(hash12(gl_FragCoord.xy) + uTime * 7.31);
  const int N = 36;
  const float H0 = 95.0, H1 = 420.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    float fi = (float(i) + jitter) / float(N);
    float a = fi * fi;
    float t = mix(H0, H1, a) / rd.y;
    if (t > 2600.0) break;
    vec2 p = rd.xz * t;
    float field = curtains(p, t);
    if (field < 0.003) continue;
    float ds = min((H1 - H0) * 2.0 * fi / float(N) / rd.y, 90.0);
    acc += emission(a, p.x) * field * ds * exp(-t * 0.0008) * (1.0 - smoothstep(1700.0, 2600.0, t));
  }
  fragColor = vec4(acc * 0.012 * (0.25 + uIntensity), 1.0);
}
`

export const accumulateFrag = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D tNew;
uniform sampler2D tPrev;
uniform float uBlend;
void main() {
  vec4 n = texture(tNew, vUv);
  // A single NaN would otherwise live forever in the feedback buffer.
  if (any(isnan(n)) || any(isinf(n))) n = vec4(0.0);
  fragColor = mix(texture(tPrev, vUv), n, uBlend);
}
`

export const compositeFrag = /* glsl */ `
${common}
uniform sampler2D tAurora;
uniform vec3 uAmbient;
uniform float uExposure;

vec3 stars(vec3 rd, float scale, float threshold) {
  vec3 p = rd * scale;
  vec3 id = floor(p);
  vec3 f = fract(p) - 0.5;
  float h = hash13(id);
  if (h < threshold) return vec3(0.0);
  vec3 off = (vec3(hash13(id + 1.3), hash13(id + 2.7), hash13(id + 4.1)) - 0.5) * 0.7;
  float d = length(f - off);
  float size = 0.035 + 0.05 * (h - threshold) / (1.0 - threshold);
  float s = 1.0 - smoothstep(0.0, size, d);
  float tw = 0.75 + 0.25 * sin(uTime * (1.5 + h * 4.0) + h * 91.0);
  vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hash13(id + 9.1));
  return tint * s * tw * (h - threshold) / (1.0 - threshold) * 3.0;
}

vec3 sky(vec3 rd) {
  float e = max(rd.y, 0.0);
  vec3 col = mix(vec3(0.0032, 0.0050, 0.0095), vec3(0.0002, 0.0004, 0.0016), pow(e, 0.35));
  col += vec3(0.0020, 0.0065, 0.0035) * exp(-abs(e - 0.08) * 20.0);         // airglow
  vec3 mwN = normalize(vec3(0.35, 0.55, 0.76));
  float band = exp(-pow(dot(rd, mwN), 2.0) * 14.0);
  col += vec3(0.006, 0.0065, 0.009) * band * smoothstep(0.3, 0.9, fbm(rd.xy * 5.0 + rd.z * 3.0));   // milky way
  col += stars(rd, 150.0, 0.90) + stars(rd, 380.0, 0.955) * 0.8 + band * stars(rd, 700.0, 0.93) * 0.6;
  col += uAmbient * exp(-e * 9.0) * 0.035;                                   // aurora-lit haze
  return col;
}

vec3 mountain(float e, float top, vec3 rd) {
  float depth = clamp((top - e) / max(top, 1e-3), 0.0, 1.0);
  vec3 col = vec3(0.0012, 0.0016, 0.0026);
  col += uAmbient * 0.012 * (1.0 - depth);
  float snow = smoothstep(0.55, 1.0, noise(vec2(atan(rd.x, rd.z) * 60.0, e * 200.0))) * (1.0 - smoothstep(0.0, 0.25, depth));
  col += uAmbient * 0.02 * snow;
  return col;
}

void main() {
  vec3 rd = cameraRay(vUv);
  vec3 aur = texture(tAurora, vUv).rgb;
  float az = atan(rd.x, rd.z);
  float top = ridge(az);
  vec3 col;

  if (rd.y >= 0.0) {
    col = rd.y < top ? mountain(rd.y, top, rd) : sky(rd) + aur;
  } else {
    vec3 rr = waterReflect(rd);
    float rtop = ridge(atan(rr.x, rr.z));
    vec3 refl = rr.y < rtop ? mountain(rr.y, rtop, rr) : sky(rr) + aur;
    float cosT = clamp(-rd.y, 0.0, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
    col = refl * mix(0.35, 0.9, F) + vec3(0.0003, 0.0005, 0.001);
    col *= 1.0 - smoothstep(0.0, 0.6, cosT) * 0.6;
  }

  col *= uExposure;
  col = 1.0 - exp(-col * 1.6);
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.7;
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) / 255.0 * 2.0;
  fragColor = vec4(col, 1.0);
}
`
