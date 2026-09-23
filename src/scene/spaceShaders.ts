const geo = /* glsl */ `
// Object space follows THREE.SphereGeometry's UV layout: lon 0 on +X, lon +90 on −Z.
vec2 lonLat(vec3 n) {
  return vec2(atan(-n.z, n.x), asin(clamp(n.y, -1.0, 1.0)));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
`

export const earthVert = /* glsl */ `
out vec3 vObjN;
out vec3 vWorldN;
out vec3 vWorldPos;
void main() {
  vObjN = normalize(position);
  vWorldN = normalize(mat3(modelMatrix) * position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const earthFrag = /* glsl */ `
out highp vec4 fragColor;
in vec3 vObjN;
in vec3 vWorldN;
in vec3 vWorldPos;
uniform sampler2D tLand;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform vec3 uAuroraTint;
${geo}
void main() {
  vec2 ll = lonLat(normalize(vObjN));
  vec2 uv = vec2(ll.x / 6.2831853 + 0.5, ll.y / 3.1415927 + 0.5);
  vec2 land = texture(tLand, uv).rg;
  vec3 n = normalize(vWorldN);
  vec3 v = normalize(uCamPos - vWorldPos);
  float sun = dot(n, uSunDir);
  float day = smoothstep(-0.12, 0.25, sun);

  vec3 ocean = vec3(0.012, 0.030, 0.060);
  vec3 ground = vec3(0.060, 0.085, 0.100);
  vec3 dayCol = mix(ocean, ground, land.r) * (0.25 + 1.2 * max(sun, 0.0));
  vec3 nightCol = mix(vec3(0.002, 0.004, 0.009), vec3(0.006, 0.010, 0.016), land.r);
  nightCol += uAuroraTint * 0.05 * land.r;
  vec3 col = mix(nightCol, dayCol, day);

  col += vec3(0.20, 0.55, 0.65) * land.g * mix(0.10, 0.18, day);

  vec3 h = normalize(uSunDir + v);
  col += vec3(0.8, 0.85, 0.9) * pow(max(dot(n, h), 0.0), 60.0) * 0.25 * (1.0 - land.r) * day;

  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += vec3(0.20, 0.45, 1.0) * rim * (0.08 + 0.6 * day);
  fragColor = vec4(col, 1.0);
}
`

export const atmosphereFrag = /* glsl */ `
out highp vec4 fragColor;
in vec3 vObjN;
in vec3 vWorldN;
in vec3 vWorldPos;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
void main() {
  vec3 n = normalize(vWorldN);
  vec3 v = normalize(uCamPos - vWorldPos);
  float edge = 1.0 - abs(dot(n, v));
  float glow = pow(edge, 4.0);
  float lit = smoothstep(-0.3, 0.5, dot(n, uSunDir));
  vec3 col = vec3(0.25, 0.55, 1.0) * glow * (0.12 + 1.1 * lit);
  fragColor = vec4(col, glow);
}
`

export const auroraShellFrag = /* glsl */ `
out highp vec4 fragColor;
in vec3 vObjN;
in vec3 vWorldN;
in vec3 vWorldPos;
uniform vec3 uSunDir;
uniform vec3 uDipole;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uIntensity;
uniform float uStorm;
uniform float uEdge;
uniform float uLayer;
uniform float uLive;
uniform sampler2D tOvation;
${geo}
void main() {
  vec3 n = normalize(vWorldN);
  float mlat = degrees(asin(clamp(dot(n, uDipole), -1.0, 1.0)));
  float hemi = sign(mlat);
  float alat = abs(mlat);

  // Magnetic local time: angle from the noon meridian around the dipole axis.
  vec3 pn = normalize(n - uDipole * dot(n, uDipole));
  vec3 ps = normalize(uSunDir - uDipole * dot(uSunDir, uDipole));
  float cosPhi = dot(pn, ps);
  float night = 0.5 - 0.5 * cosPhi;
  float side = sign(dot(cross(ps, pn), uDipole));
  float mlt = atan(side * sqrt(max(0.0, 1.0 - cosPhi * cosPhi)), cosPhi);

  float equatorward = uEdge + mix(8.0, 0.0, night);
  float width = mix(3.0, 7.0 + 7.0 * uIntensity, night);
  float centre = equatorward + width * 0.5;
  float d = (alat - centre) / (width * 0.5);

  float structure = 0.55 + 0.45 * noise(vec2(mlt * 9.0 + uTime * 0.25 * hemi, alat * 0.6 + uTime * 0.1));
  structure *= 0.6 + 0.4 * noise(vec2(mlt * 31.0 - uTime * 0.6, uTime * 0.2));
  float band = exp(-d * d * 2.2) * structure;
  band *= mix(0.35, 1.0, smoothstep(0.1, 0.9, night));
  band *= 0.5 + 2.6 * uIntensity;

  vec2 ll = lonLat(normalize(vObjN));
  float ov = texture(tOvation, vec2(ll.x / 6.2831853, (degrees(ll.y) + 90.0) / 181.0 + 0.5 / 181.0)).r * 2.55;
  ov = smoothstep(0.02, 0.6, ov) * (0.8 + 0.4 * structure);
  band = mix(band, ov * 1.6, uLive);

  vec3 green = vec3(0.12, 1.0, 0.4);
  vec3 red = vec3(1.0, 0.12, 0.2);
  float poleward = smoothstep(-0.3, 1.2, d);
  vec3 col = uLayer < 0.5
    ? mix(green, mix(green, red, 0.4), uStorm * poleward)
    : red * (0.15 + 1.2 * uStorm);

  vec3 v = normalize(uCamPos - vWorldPos);
  float limb = 0.6 + 0.8 * pow(1.0 - abs(dot(n, v)), 2.0);
  float dayDim = mix(0.25, 1.0, 1.0 - smoothstep(-0.3, -0.05, dot(n, uSunDir)));
  float a = band * limb * dayDim * (uLayer < 0.5 ? 1.0 : 0.45);
  fragColor = vec4(col * a, a);
}
`

export const shellVert = earthVert

export const magnetopauseFrag = /* glsl */ `
out highp vec4 fragColor;
in vec3 vObjN;
in vec3 vWorldN;
in vec3 vWorldPos;
uniform vec3 uCamPos;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
void main() {
  vec3 n = normalize(vWorldN);
  vec3 v = normalize(uCamPos - vWorldPos);
  float f = pow(1.0 - abs(dot(n, v)), 2.5);
  float lines = 0.5 + 0.5 * sin(vWorldPos.x * 2.2 - uTime * 1.5);
  float a = uOpacity * (f * 0.9 + 0.1 + 0.12 * lines * f);
  fragColor = vec4(uColor * a, a);
}
`

export const windVert = /* glsl */ `
in vec3 aSeed;
out float vAlpha;
out float vHeat;
uniform float uFlow;
uniform float uShock;
uniform float uPixel;
uniform float uDensity;
uniform float uVisible;
void main() {
  float b = aSeed.x;
  float phi = aSeed.y;
  float x = 60.0 - mod(aSeed.z * 120.0 + uFlow, 120.0);
  // Rankine-half-body style deflection around a paraboloid bow shock.
  float k = 1.15;
  float surf2 = x < uShock ? 2.0 * uShock * k * (uShock - x) : 0.0;
  float rho = sqrt(b * b + surf2);
  vec3 p = vec3(x, rho * cos(phi), rho * sin(phi));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float fade = (1.0 - smoothstep(45.0, 60.0, x)) * smoothstep(-60.0, -40.0, x);
  vHeat = surf2 > 0.0 ? exp(-b * 0.35) * smoothstep(uShock - 8.0, uShock, x) : 0.0;
  vAlpha = fade * (0.45 + 0.55 * uDensity) * uVisible;
  gl_PointSize = max(1.5, uPixel * (1.0 + vHeat * 1.5) * 260.0 / -mv.z);
}
`

export const windFrag = /* glsl */ `
out highp vec4 fragColor;
in float vAlpha;
in float vHeat;
uniform vec3 uColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha;
  vec3 col = mix(uColor, vec3(1.0, 0.75, 0.5), vHeat);
  fragColor = vec4(col * a, a);
}
`
