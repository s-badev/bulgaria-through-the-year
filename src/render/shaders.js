// GLSL (ES 3.00) for the three passes: cast shadows from depth, photographic base, final composite.
// The fullscreen vertex shader flips v, so vUv is image space: (0,0) top-left. Targets are therefore stored
// "image row 0 at texel row 0" and sampled with the same vUv.
const COMMON = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv; out vec4 o;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, r = 0.; for(int i=0;i<4;i++){ r += a*vnoise(p); p = p*2.03 + 7.1; a *= .5; } return r; }
float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
float fadeDown(float high, float low, float x){ return 1. - smoothstep(low, high, x); }
`;

// ---------- cast shadows: screen-space ray march through the calibrated depth map ----------
export const SHADOW_FS = COMMON + `
uniform sampler2D tGeo;
uniform vec3 uSunCam;      // sun direction in camera space (x right, y down, z forward)
uniform vec4 uCam;         // focal px, cx, cy, z0
uniform vec2 uSize;        // image size px
uniform float uInvScale, uSteps;
float invAt(vec2 uv){ return max(texture(tGeo, uv).b * uInvScale, 0.02); }
vec3 posAt(vec2 uv, float inv){ float z = uCam.w / inv; return vec3((uv * uSize - uCam.yz) / uCam.x, 1.) * z; }
void main(){
  float inv = texture(tGeo, vUv).b * uInvScale;
  if (inv < 0.09) { o = vec4(0.); return; }
  vec3 P = posAt(vUv, inv);
  float jit = hash12(vUv * uSize), occ = 0., tmax = 1.5;
  // A fixed integer bound compiles reliably on mobile GLSL ES drivers; uSteps still selects the quality level.
  for (int step = 0; step < 30; step++) {
    if (float(step) >= uSteps) break;
    float i = float(step);
    float t = tmax * pow((i + .35 + jit * .65) / uSteps, 1.7) + 0.012;
    vec3 Q = P + uSunCam * t;
    if (Q.z < 0.08) break;
    vec2 q = (Q.xy / Q.z * uCam.x + uCam.yz) / uSize;
    if (q.x < 0. || q.x > 1. || q.y < 0. || q.y > 1.) break;
    float zs = uCam.w / invAt(q), d = Q.z - zs;
    float bias = 0.02 * Q.z + 0.012, thick = 0.22 + 0.35 * t;
    if (d > bias && d < thick) { occ = 1.; break; }
  }
  o = vec4(occ, occ, occ, 1.);
}`;

// ---------- base: blends the photographs for the current state and relights the day image ----------
export const BASE_FS = COMMON + `
uniform sampler2D tDay, tAutumn, tWinter, tSpring, tNight, tWinterNight, tRainNight, tFog, tBlue, tGold;
uniform sampler2D tMaskA, tMaskC, tMaskD, tGeo, tShadow, tTraffic;
uniform vec2 uSize;
uniform float uHasSpring;
uniform vec4 uTod;        // wDay, wGold, wBlue, wNight
uniform vec4 uSeason;     // index A, index B, t, cover
uniform vec4 uSpecial;    // wFogPhoto, wRainNight, lightsOn, winter weight
uniform vec4 uRelight;    // relight, cast strength, alpenglow, anchored side
uniform vec3 uSunCol, uAmb, uSunDir, uRefDir;
uniform vec3 uZen, uHor, uSunHor, uRefZen, uRefHor;
uniform vec4 uSkyP;       // sunX, glow, sunY, sun disc visibility
const vec3 REF_AMB = vec3(0.084, 0.137, 0.223), REF_SUN = vec3(0.916, 0.863, 0.777), OVER_REF = vec3(0.68, 0.71, 0.78), NIGHT_AMB = vec3(0.030, 0.027, 0.030);

float shade(vec3 n, vec3 s){ return 0.62 + 0.38 * clamp(dot(n, s) * 1.2 + 0.3, 0., 1.); }
vec3 skyModel(vec2 uv, vec3 zen, vec3 hor, vec3 sunHor, float sunX, float glow){
  float t = clamp(uv.y / 0.36, 0., 1.);
  vec3 c = mix(zen, hor, pow(t, 1.6));
  float side = exp(-pow((uv.x - sunX) * 1.25, 2.));
  c = mix(c, sunHor, clamp(pow(t, 2.4) * side * glow, 0., 1.));
  return c;
}
vec3 springFrom(vec3 c, float veg, float mtn, vec2 uv){
  float l = luma(c);
  vec3 fresh = c * vec3(1.02, 1.10, 0.72) + vec3(0.004, 0.012, 0.0);
  float crown = smoothstep(0.02, 0.12, l);
  vec3 v = mix(c, fresh, veg * crown);
  float blossom = step(0.86, vnoise(uv * uSize / 9.)) * step(0.55, vnoise(uv * uSize / 60. + 3.)) * veg * smoothstep(0.05, 0.2, l);
  v = mix(v, vec3(0.80, 0.70, 0.74) * (0.55 + l), blossom * 0.55);
  float snow = mtn * fadeDown(0.250, 0.215, uv.y + (vnoise(uv * vec2(60., 34.)) - .5) * 0.03) * smoothstep(0.05, 0.22, l);
  v = mix(v, vec3(0.86, 0.90, 0.96) * (0.55 + 0.6 * l), snow * 0.8);
  return v;
}
// Explicit selection avoids GLSL vector arrays and dynamic indexing rejected by some Android drivers.
vec3 seasonColor(int index, vec3 spring, vec3 summer, vec3 autumn, vec3 winter){
  if (index == 0) return spring;
  if (index == 1) return summer;
  if (index == 2) return autumn;
  return winter;
}
void main(){
  vec2 uv = vUv;
  vec4 mA = texture(tMaskA, uv), mC = texture(tMaskC, uv), mD = texture(tMaskD, uv);
  float sky = mA.r, mtn = mA.g, veg = mA.b, bld = mC.r, bsh = mD.r;
  vec3 g = texture(tGeo, uv).rgb; vec3 n = vec3(g.xy * 2. - 1., 0.); n.z = sqrt(max(0., 1. - dot(n.xy, n.xy)));

  vec3 cDay = texture(tDay, uv).rgb, cAut = texture(tAutumn, uv).rgb, cWin = texture(tWinter, uv).rgb;
  vec3 cSpr = uHasSpring > .5 ? texture(tSpring, uv).rgb : springFrom(cDay, veg, mtn, uv);
  int iA = int(uSeason.x + .5), iB = int(uSeason.y + .5);

  // seasons change tree by tree: a crown-sized dissolve inside vegetation, a plain cross-fade elsewhere (no ghosting of regenerated trees)
  vec2 px = uv * uSize;
  float crown = vnoise(px / 46.) * 0.65 + vnoise(px / 17. + 11.) * 0.35;
  float t = uSeason.z, tv = smoothstep(crown * 0.7, crown * 0.7 + 0.3, t);
  float ts = mix(t, tv, clamp(veg * 1.4 + mtn, 0., 1.));
  vec3 D = mix(seasonColor(iA, cSpr, cDay, cAut, cWin), seasonColor(iB, cSpr, cDay, cAut, cWin), ts);
  float wWin = (iA == 3 ? 1. - ts : 0.) + (iB == 3 ? ts : 0.);
  float wSum = (iA == 1 ? 1. - ts : 0.) + (iB == 1 ? ts : 0.) + (uHasSpring > .5 ? 0. : (iA == 0 ? 1. - ts : 0.) + (iB == 0 ? ts : 0.));
  // snow that settles from the weather outside winter: whitest-in-winter places first
  float extra = clamp((uSeason.w - uSpecial.w) / max(1. - uSpecial.w, 1e-3), 0., 1.);
  float snowness = clamp((luma(cWin) - luma(D)) * 2.2 + 0.45, 0., 1.);
  float th = mix(0.8, 0.05, snowness) + (crown - .5) * 0.25;
  float cs = smoothstep(th, th + 0.22, extra * 1.25);
  D = mix(D, cWin, cs); wWin = max(wWin, cs); wSum *= 1. - cs;
  // diffuse-light photographs (overcast winter, fog)
  D = mix(D, texture(tFog, uv).rgb, uSpecial.x * (1. - wWin));
  float dif = clamp(max(wWin, uSpecial.x), 0., 1.);
  // live cars are part of the photograph: they enter here, before any relighting, so everything below treats them like baked pixels
  vec4 tr = texture(tTraffic, uv);
  if (tr.a > 0.003) {
    vec3 car = tr.rgb / tr.a; car *= car;
    float fdist = clamp(0.18 / (g.b * 1.25 + 0.07), 0., 1.);
    car = mix(car, textureLod(tFog, uv, 3.).rgb, uSpecial.x * (0.25 + 0.75 * fdist));   // the fog photo's own fog over the car
    D = mix(D, car, tr.a);
  }

  // ----- relight the day image -----
  vec2 st = 1.5 / vec2(textureSize(tShadow, 0));
  float shNew = (texture(tShadow, uv).r * 2. + texture(tShadow, uv + vec2(st.x, 0.)).r + texture(tShadow, uv - vec2(st.x, 0.)).r + texture(tShadow, uv + vec2(0., st.y)).r + texture(tShadow, uv - vec2(0., st.y)).r) / 6.;
  float visRef = 1. - bsh * (1. - dif) * 0.97;
  float ndRef = shade(n, uRefDir), ndNow = shade(n, uSunDir);
  vec3 refL = mix(REF_AMB + REF_SUN * visRef * ndRef, OVER_REF, dif);
  float r = max(uRelight.x, dif);
  float vis = mix(visRef, 1. - shNew * uRelight.y * (1. - mtn) * (1. - sky), r), nd = mix(ndRef, ndNow, r);
  vec3 newL = uAmb + uSunCol * vis * nd;
  vec3 ratio = clamp(newL / refL, 0., 6.);
  vec3 dayRelit = D * ratio;
  dayRelit = mix(vec3(luma(dayRelit)), dayRelit, 1. + 0.22 * uRelight.z * (1. - dif));                        // low sun: richer colour
  dayRelit = mix(dayRelit, dayRelit * vec3(1.22, 0.80, 0.74) + vec3(0.012, 0.002, 0.004), mtn * uRelight.z * 0.8); // alpenglow on Vitosha
  // sky of the day image: photo sky re-coloured by the analytic model (keeps real wisps); overcast winter sky is replaced
  vec3 skyNow = skyModel(uv, uZen, uHor, uSunHor, uSkyP.x, uSkyP.y), skyRef = skyModel(uv, uRefZen, uRefHor, uRefHor, 0.2, 0.);
  vec2 sd = (uv - vec2(uSkyP.x, uSkyP.z)) * vec2(uSize.x / uSize.y, 1.);
  vec3 sunDisc = uSunHor * (exp(-length(sd) * 9.) * 0.9 + fadeDown(0.016, 0.010, length(sd)) * 3.) * uSkyP.w;
  // low frequencies from the analytic sky (the photo has its bright side baked on the left), wisps and grain from the photo
  vec3 skyLo = max(textureLod(tDay, uv, 5.).rgb, vec3(0.01));
  vec3 detail = clamp(mix(vec3(1.), cDay / skyLo, smoothstep(0.03, 0.14, 0.36 - uv.y)), 0.85, 1.3);
  vec3 skyCalc = skyNow * mix(detail, vec3(1.), wWin);
  vec3 skyDay = mix(D, skyCalc, max(r, wWin)) + sunDisc;
  dayRelit = mix(dayRelit, skyDay, sky);

  // ----- anchor photographs for the other times of day, carried to the current season -----
  vec3 dayLo = max(textureLod(tDay, uv, 3.).rgb, vec3(0.004));
  float nonSummer = 1. - wSum, vmask = clamp(veg * 1.5, 0., 1.) * nonSummer;
  vec3 aN = texture(tNight, uv).rgb, gN = min(textureLod(tNight, uv, 3.).rgb / dayLo, vec3(8.)), rN = aN - gN * cDay;
  rN = mix(rN, max(rN - 0.006, 0.), vmask);
  vec3 nightImg = mix(max(gN * D + rN, 0.), aN, sky);
  nightImg = mix(nightImg, texture(tWinterNight, uv).rgb, wWin);
  nightImg = mix(nightImg, texture(tRainNight, uv).rgb, uSpecial.y);

  // computed dusk: relit day + the artificial light of the night photograph, switched on patch by patch and window by window
  vec3 albedo = D / refL;
  vec3 E = max(nightImg - albedo * NIGHT_AMB - 0.003, 0.) * (1. - sky);
  float cell = hash12(floor(px / 5.) + 3.7), patchN = vnoise(px / 70. + 5.);
  float on = uSpecial.z, onCell = smoothstep(cell * 0.75, cell * 0.75 + 0.25, on), onPatch = smoothstep(patchN * 0.6, patchN * 0.6 + 0.4, on);
  // only point sources (a pixel much brighter than its surroundings in the night photo: a window, a lamp head) switch cell by cell;
  // floodlit facades and lit ground come up smoothly in soft patches, so no square mosaic can appear
  float peaked = smoothstep(1.7, 3.2, luma(aN) / (luma(textureLod(tNight, uv, 4.).rgb) + 0.012));
  vec3 img = mix(dayRelit + E * mix(onPatch, onCell, peaked * clamp(bld * 1.3, 0., 1.)), nightImg, uTod.w);
  if (uRelight.w > .5) {
    // dawn/dusk photographs (summer scene) carried to spring and autumn; snow has a different albedo layout, so winter stays computed
    vec3 aG = texture(tGold, uv).rgb, gG = min(textureLod(tGold, uv, 3.).rgb / dayLo, vec3(8.)), rG = aG - gG * cDay;
    rG = mix(rG, max(rG - 0.006, 0.), vmask);
    vec3 goldImg = mix(max(gG * D + rG, 0.), aG, sky);
    vec3 aB = texture(tBlue, uv).rgb, gB = min(textureLod(tBlue, uv, 3.).rgb / dayLo, vec3(8.)), rB = aB - gB * cDay;
    rB = mix(rB, max(rB - 0.006, 0.), vmask);
    vec3 blueImg = mix(max(gB * D + rB, 0.), aB, sky);
    vec3 anchored = uTod.x * dayRelit + uTod.y * goldImg + uTod.z * blueImg + uTod.w * nightImg;
    img = mix(anchored, img, wWin);
  }
  o = vec4(pow(max(img, 0.), vec3(1. / 2.2)), 1.);
}`;

// ---------- composite: parallax, wind, water, wetness, fog, clouds, grade, grain ----------
export const COMPOSITE_FS = COMMON + `
uniform sampler2D tBase, tMaskA, tMaskB, tGeo, tDeck, tCumulus, tMoon;
uniform vec4 uCov;            // uv offset + scale of the visible part of the image
uniform vec2 uPar, uSize;
uniform float uZoom, uTime, uInvScale;
uniform vec4 uEnvA;           // cloud, fog, fogLine, haze
uniform vec4 uEnvB;           // wet, wind, water, storm
uniform vec4 uEnvC;           // flash, stars, flat, snowfall
uniform vec4 uMisc;           // grain, vignette, rainNight photo weight, fog photo weight
uniform vec3 uFogCol, uHazeCol, uCloudLit, uCloudDark, uSunHor, uFountCol;
uniform vec4 uSkyP;           // sunX, glow, lightsOn, boltX
uniform vec4 uCam;            // focal px, cx, cy, z0 (camera heights)
uniform vec3 uFogP;           // cos(pitch), sin(pitch), fog top height (camera heights)
uniform vec4 uMoon;           // image x, image y, lunar phase, atmospheric visibility
uniform vec3 uMoonLight;      // sky darkness, half a pixel in lunar radius units, texture LOD
uniform vec3 uMoonPhase;      // Sun direction on the horizontal cross section (x, z), Earthshine
uniform vec4 uVolcano;        // strength, quality, animation time, reduced motion
vec3 baseAt(vec2 uv){ vec3 c = texture(tBase, uv).rgb; return c * c * (c * 0.305306011 + 0.682171111) + c * 0.012522878; } // ~pow 2.2
vec3 volcanoAt(vec2 uv, float sky, float mtn, vec3 c){
  float strength = uVolcano.x;
  if (strength < 0.002) return c;
  vec2 p = uv - vec2(0.608, 0.203); // Vitosha's calibrated summit in the source photograph
  float t = uVolcano.z;
  float y = p.y;
  // Three shallow streams fan down the photographed slopes. The mountain mask
  // stops lava at the skyline and before it can wash over NDK or the city.
  if (mtn > 0.02 && y > 0.003 && y < 0.145) {
    float n = vnoise(uv * vec2(350., 240.) - vec2(0., t * 0.10)) - 0.5;
    float left = -0.72 * y + 0.17 * y * y + n * 0.004;
    float right = 0.92 * y - 0.30 * y * y + n * 0.004;
    float width = 0.0020 + y * 0.022;
    float flow = exp(-pow((p.x-left) / width, 2.)) + exp(-pow((p.x-right) / (width * 0.82), 2.));
    float fleck = (0.72 + 0.28 * vnoise(uv * vec2(900., 500.) - vec2(0., t * 0.8))) * (0.82 + 0.18 * sin(y * 180. - t * 5. + p.x * 60.));
    float lava = clamp(flow * fleck * mtn * smoothstep(0.003, 0.018, y) * (1. - smoothstep(0.105, 0.145, y)), 0., 1.);
    c += vec3(0.95, 0.15, 0.012) * lava * 0.65 * strength;
    c += vec3(1.0, 0.55, 0.09) * pow(lava, 2.) * 0.35 * strength;
  }
  float crater = exp(-pow(p.x / 0.019, 2.) - pow(p.y / 0.012, 2.));
  c += vec3(1.0, 0.26, 0.035) * crater * strength * (0.44 + 0.12 * sin(t * 5.));
  if (sky > 0.01 && p.y < 0.015 && p.y > -0.18 && abs(p.x) < 0.19) {
    float rise = max(-p.y, 0.);
    float swirl = fbm(vec2(p.x * 22. - t * 0.035, rise * 24. + t * 0.07));
    float center = 0.015 * sin(rise * 17. + t * 0.35);
    float spread = 0.021 + rise * 0.67;
    float plume = 1. - smoothstep(spread * 0.35, spread, abs(p.x - center) + (swirl - 0.5) * 0.028);
    plume *= smoothstep(0.014, 0.045, rise) * (1. - smoothstep(0.13, 0.18, rise));
    vec3 ash = mix(vec3(0.025, 0.027, 0.038), vec3(0.12, 0.075, 0.062), exp(-rise * 19.));
    c = mix(c, ash + vec3(0.06, 0.018, 0.003) * swirl, plume * sky * 0.76 * strength);
    float glow = exp(-length(p * vec2(4., 7.)) * 15.);
    c += vec3(0.34, 0.075, 0.012) * glow * sky * strength;
  }
  // Fixed loop bound and explicit quality gate are safe on older mobile drivers.
  if (uv.y < 0.36 && abs(p.x) < 0.27 && uVolcano.w < 0.5) {
    for (int i = 0; i < 10; i++) {
      if (float(i) >= 3. + uVolcano.y * 7.) break;
      float seed = float(i);
      float age = fract(t / (2.8 + hash12(vec2(seed, 3.)) * 2.2) + seed * 0.163);
      float side = hash12(vec2(seed, 8.)) * 2. - 1.;
      vec2 rock = vec2(0.608 + side * (0.045 + seed * 0.011) * age, 0.199 - (0.13 + seed * 0.004) * age + (0.22 + seed * 0.009) * age * age);
      vec2 delta = (uv - rock) * vec2(1., 1.55);
      float r = length(delta);
      float ember = exp(-pow(r / (0.0016 + 0.00035 * uVolcano.y), 2.));
      float halo = exp(-pow(r / 0.006, 2.));
      c += (vec3(1.0, 0.45, 0.045) * ember + vec3(0.28, 0.055, 0.002) * halo) * strength * (sky + mtn * 0.7);
    }
  }
  return c;
}
void main(){
  vec2 uv = uCov.xy + vUv * uCov.zw;
  uv = .5 + (uv - .5) / uZoom;
  // 2.5D parallax from depth; iterate and keep the farther depth so disocclusions stretch background, not foreground
  float d0 = texture(tGeo, uv).b;
  vec2 par = uPar * 0.011;
  vec2 u1 = uv - par * (d0 - 0.3);
  float d1 = texture(tGeo, u1).b;
  vec2 u2 = uv - par * (min(d0, d1) - 0.3);
  float d2 = texture(tGeo, u2).b;
  float dep = min(min(d0, d1), d2);
  uv = uv - par * (dep - 0.3);
  vec4 mA = texture(tMaskA, uv), mB = texture(tMaskB, uv);
  float sky = mA.r, mtn = mA.g, water = mB.r, trees = mB.g, paved = mB.b;
  float inv = texture(tGeo, uv).b * uInvScale;
  vec2 px = uv * uSize;

  // wind: crowns sway (mask-based displacement, stronger toward the crown tips)
  float wind = uEnvB.y;
  float gust = 0.6 + 0.4 * sin(uTime * 0.7 + px.x * 0.004) * sin(uTime * 0.23 + 1.);
  vec2 sway = vec2(sin(uTime * 1.9 + px.x * 0.045 + px.y * 0.02), cos(uTime * 1.3 + px.y * 0.05)) * vec2(1., .35);
  sway += vec2(sin(uTime * 4.3 + px.x * 0.21 + px.y * 0.13), 0.) * 0.35;
  vec2 suv = uv + sway * trees * wind * gust * (0.6 + inv) * 1.9 / uSize;
  // water: ripples and glitter while the fountains run
  if (water > 0.01) suv += vec2(sin(px.y * 0.9 + uTime * 6.), cos(px.x * 0.7 + uTime * 5.)) * 0.9 / uSize * water * uEnvB.z;
  vec3 c = baseAt(suv);
  // skyline band: the 1-2 px where the sky mask ends (sky just above, land just below). Used below so a low cloud deck that covers
  // the mountain also covers this band; otherwise a sliver of the brighter base sky shows as a drawn outline along the ridge.
  float skyEdge = smoothstep(0.25, 0.7, texture(tMaskA, uv - vec2(0., 2.5 / uSize.y)).r - texture(tMaskA, uv + vec2(0., 2.5 / uSize.y)).r);
  if (water > 0.01) {
    float glit = step(0.985, hash12(floor(px) + floor(uTime * 12.))) * uEnvB.z;
    c += vec3(glit * 0.28 * water * (0.25 + luma(c)));
    c += uFountCol * water * uSkyP.z * uEnvB.z * (0.10 + 0.05 * sin(uTime * 2. + px.y * 0.08));
  }
  // wet ground: darker stone, vertical smear of whatever is bright above it
  float wet = uEnvB.x * paved * (1. - uMisc.z);
  if (wet > 0.005) {
    vec3 refl = vec3(0.); float h = 1. / uSize.y;
    float wob = (vnoise(px * vec2(0.5, 0.08) + uTime * 0.6) - .5) * 3. / uSize.x;
    refl += baseAt(suv + vec2(wob, -10. * h)) * .34 + baseAt(suv + vec2(wob * 1.6, -24. * h)) * .28 + baseAt(suv + vec2(wob * 2.2, -44. * h)) * .22 + baseAt(suv + vec2(wob * 3., -72. * h)) * .16;
    c = c * (1. - 0.42 * wet) + max(refl - 0.06, 0.) * wet * 0.55 + uHazeCol * wet * 0.035;
  }
  // overcast grade: flatter, cooler; storm darker; falling snow lowers contrast
  float l = luma(c);
  c = mix(c, vec3(l) * vec3(0.97, 1.0, 1.04), uEnvC.z * 0.32 * (1. - sky));
  c *= 1. - 0.24 * uEnvB.w * (1. - sky);
  c = mix(c, mix(c, uHazeCol, 0.5), uEnvC.w * 0.08);

  // sky: photographic cloud layers (overcast deck + cumulus), gently compressed toward the horizon, drifting with the wind
  float cloud = uEnvA.x, lowCloud = smoothstep(0.6, 1., cloud) * clamp(uEnvB.w * 0.9 + uEnvC.w * 0.3 + uMisc.z, 0., 1.);
  float cmask = clamp(max(sky, skyEdge * lowCloud) + mtn * fadeDown(0.34, 0.20, uv.y + (vnoise(px / 90.) - .5) * 0.07) * lowCloud, 0., 1.);
  float calpha = 0.;
  if (cmask > 0.003 && cloud > 0.01) {
    float yy = clamp(uv.y / 0.385, 0., 1.);
    vec2 cuv = vec2((uv.x - .5) * mix(0.8, 1.3, yy), (1. - pow(1. - yy, 1.35)) * 1.5);
    float drift = uTime * (0.0025 + wind * 0.018);
    vec2 dk1 = texture(tDeck, cuv + vec2(drift, 0.)).rg, dk2 = texture(tDeck, cuv * vec2(0.53, 0.6) + vec2(drift * 0.6 + 0.43, 0.31)).rg;
    vec2 cu = texture(tCumulus, cuv * vec2(0.9, 1.) + vec2(drift * 1.3 + 0.37, 0.02)).rg;
    float big = fbm(cuv * vec2(2.4, 1.6) + vec2(drift * 2., 3.));
    float cv = cu.g * 0.6 + big * 0.75;
    float cov = smoothstep(1.18 - cloud * 1.15, 1.62 - cloud * 1.0, cv) * smoothstep(0.06, 0.3, cloud);
    float deck = smoothstep(0.62, 0.97, cloud);
    calpha = clamp(max(cov, deck), 0., 1.) * (1. - 0.8 * uMisc.z);
    float shadeV = mix(cu.r, dk1.r * 0.6 + dk2.r * 0.4, deck) * 2. - 1.;
    shadeV = clamp(0.5 + shadeV * (1.3 + 0.9 * deck) + (big - .5) * 0.6, 0., 1.);
    vec3 cc = mix(uCloudDark, uCloudLit, shadeV);
    float side = exp(-pow((uv.x - uSkyP.x) * 1.3, 2.));
    cc += uSunHor * uSkyP.y * side * smoothstep(0.10, 0.36, uv.y) * 0.35 * (1. - deck * 0.7);
    cc = mix(cc, uHazeCol, smoothstep(0.72, 1., yy) * 0.55);
    cc += uEnvC.x * vec3(0.55, 0.6, 0.8) * (0.25 + 0.9 * exp(-pow((uv.x - uSkyP.w) * 3., 2.)));
    c = mix(c, cc, calpha * cmask);
  }
  // stars (only where the night photo's sky is clear)
  vec3 starlight = vec3(0.);
  if (uEnvC.y > 0.01 && sky > 0.5) {
    vec2 sp = floor(px / 2.); float sh = hash12(sp);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + sh * 3.) + sh * 40.);
    starlight = vec3(0.75, 0.82, 1.0) * step(0.9985, sh) * uEnvC.y * tw * (1. - calpha) * sky * 0.55;
  }
  // The moon is drawn in source-photo coordinates so panning leaves it in the sky.
  // The photographed cloud layer above has already set calpha, naturally hiding it.
  if (uMoon.w > 0.003 && sky > 0.01) {
    vec2 mp = (uv - uMoon.xy) * vec2(uSize.x / uSize.y, 1.) / 0.024;
    float rr = length(mp);
    if (rr < 1.4) {
      float facing = sqrt(max(0., 1. - rr * rr));
      // Sunlight on the projected sphere. Positive X is lit when waxing.
      float lit = dot(vec2(mp.x, facing), uMoonPhase.xy);
      float terminator = smoothstep(0., 0.032, lit);
      float edge = 1. - smoothstep(1. - uMoonLight.y, 1. + uMoonLight.y, rr);
      float visible = uMoon.w * (1. - calpha) * sky;
      starlight *= 1. - edge * visible; // the lunar body also covers stars on the unlit side
      if (edge > 0. && (terminator > 0. || uMoonPhase.z > 0.001)) {
        // The mosaic is already an orthographic disk. Pull its limb inward
        // slightly so transparent source pixels do not tint the silhouette.
        vec2 texUV = .5 + mp * (.49 / max(1., rr));
        float albedo = textureLod(tMoon, texUV, uMoonLight.z).r;
        float grade = min(.8, .025 + albedo * 1.48);
        grade *= mix(.50, 1., sqrt(clamp(lit, 0., 1.)));
        vec3 lunar = grade * vec3(1.02, 1., .97);
        vec3 daylight = c * .82 + lunar * .78 + .10;
        // Reflected Earth light is faint, cool and carries the same albedo
        // detail. The limb stays circular and shares the cloud mask.
        float reflected = (.006 + .036 * sqrt(albedo)) * mix(.48, 1., facing) * uMoonPhase.z;
        vec3 shadow = c + reflected * vec3(.69, .79, .93);
        c = mix(c, mix(shadow, mix(daylight, lunar, uMoonLight.x), terminator), edge * visible);
      }
      // Thin atmospheric scatter only in a lightly hazy dark sky.
      float scatter = smoothstep(.06, .25, cloud) * (1. - smoothstep(.36, .66, cloud));
      float halo = (1. - edge) * exp(-max(rr - 1., 0.) * 13.) * (1. + uMoonPhase.y);
      c += vec3(.73, .82, 1.) * (halo * scatter * visible * uMoonLight.x * .004);
    }
  }
  c += starlight;
  // aerial haze (rain, snowfall) and fog by depth; an inversion keeps Vitosha above the fog line
  float far = 1. - clamp(inv, 0., 1.);
  c = mix(c, uHazeCol, clamp(far * far * uEnvA.w, 0., 0.9) * (1. - sky));
  float fog = uEnvA.y * (1. - uMisc.w * 0.75);
  if (fog > 0.003) {
    // height above the ground from the calibrated depth: the fog is a layer, the city sinks into it, Vitosha and tower tops stay out
    vec3 Pc = vec3((uv * uSize - uCam.yz) / uCam.x, 1.) * (uCam.w / max(inv, 0.02));
    float hgt = 1. - (Pc.y * uFogP.x + Pc.z * uFogP.y);
    hgt = mix(hgt, (0.372 - uv.y) / 0.17 * 3.2, mtn);
    float dist = clamp(0.18 / (inv + 0.07), 0., 1.);
    float wob = (fbm(vec2(uv.x * 2.4 - uTime * 0.012 * (1. + wind * 4.), uv.y * 5.5)) - .5) * 0.5;
    float layer = fadeDown(uFogP.z + 0.28 + mtn * 0.7, uFogP.z - 0.12 - mtn * 0.5, hgt + wob * (1. + mtn * 1.5));
    float fd = fog * (0.25 + 0.75 * dist) * layer * (1. - sky);
    // seen from inside the fog, the low sky is fog too
    fd = max(fd, fog * sky * smoothstep(0.75, 1.5, uFogP.z) * smoothstep(0.02, 0.36, uv.y + wob * 0.1) * 0.9);
    c = mix(c, uFogCol, clamp(fd, 0., 0.96));
  }
  // lightning: the whole scene lifts for a moment, far things more
  c += uEnvC.x * vec3(0.42, 0.47, 0.62) * (0.3 + 0.7 * far) * (1. - sky);
  c = volcanoAt(uv, sky, mtn, c);
  // vignette, soft shoulder, grain
  vec2 vv = vUv - .5; c *= 1. - uMisc.y * smoothstep(0.35, 0.95, length(vv * vec2(1.05, 1.25)));
  c = mix(c, 0.78 + 0.22 * tanh((c - 0.78) / 0.22), step(0.78, c));
  vec3 outc = pow(max(c, 0.), vec3(1. / 2.2));
  float gr = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 613.) - .5;
  outc += gr * uMisc.x * (0.6 + 0.8 * (1. - luma(outc)));
  o = vec4(outc, 1.);
}`;
