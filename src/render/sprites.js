// Instanced sprite layer: every light, particle and creature is one quad in a single draw call.
// Sprites live in image pixels and follow the same cover/zoom/parallax mapping as the photo, and are
// depth-tested against the scene depth map so far rain is hidden by near trees and cars by buildings.
const VS = `#version 300 es
layout(location=0) in vec4 aA;   // x, y, half-width, half-height (image px)
layout(location=1) in vec4 aB;   // rotation, shape, depth (geo units; <0 = no occlusion), param
layout(location=2) in vec4 aC;   // r, g, b, a (a<0 = additive with intensity -a)
uniform vec4 uCov; uniform vec2 uPar, uSize; uniform float uZoom;
out vec2 vQ; out vec2 vImg; flat out vec4 vB; flat out vec4 vC;
void main(){
  vec2 q = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2. - 1.;
  float cs = cos(aB.x), sn = sin(aB.x);
  vec2 off = vec2(q.x * aA.z * cs - q.y * aA.w * sn, q.x * aA.z * sn + q.y * aA.w * cs);
  vec2 img = (aA.xy + off) / uSize;
  float d = abs(aB.z);
  vec2 uv = img + uPar * 0.011 * (d - 0.3);
  uv = .5 + (uv - .5) * uZoom;
  vec2 s = (uv - uCov.xy) / uCov.zw;
  gl_Position = vec4(s.x * 2. - 1., 1. - s.y * 2., 0., 1.);
  vQ = q; vImg = img; vB = aB; vC = aC;
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vQ; in vec2 vImg; flat in vec4 vB; flat in vec4 vC; out vec4 o;
uniform sampler2D tGeo;
float box(vec2 p, vec2 b, float r){ vec2 d = abs(p) - b + r; return length(max(d, 0.)) + min(max(d.x, d.y), 0.) - r; }
void main(){
  vec2 q = vQ; float m = 0., p = vB.w; int shape = int(vB.y + .5);
  if (shape == 0) { float r2 = dot(q, q); m = max(exp(-r2 * 4.6) - 0.0101, 0.) + 0.55 * max(exp(-r2 * 26.) - 0.0, 0.) * step(r2, 1.); }       // glow with a hot core
  else if (shape == 1) { m = pow(max(1. - abs(q.x), 0.), 1.5) * smoothstep(1., 0.15, abs(q.y)); }                                    // streak (rain, reflection)
  else if (shape == 2) { m = smoothstep(1., 0.35, length(q)); }                                                                     // soft disc (snowflake, speck)
  else if (shape == 3) { float e = length(q * vec2(1., 2.1 + 3. * (1. - p))); m = smoothstep(1., 0.8, e + 0.25 * abs(q.x) * abs(q.x)); } // leaf (param = facing)
  else if (shape == 4) { float ax = abs(q.x); float wing = p * ax * 0.9 - 0.35 * sin(ax * 3.1416) ; float dd = abs(q.y - wing); m = smoothstep(0.26, 0.04, dd) * smoothstep(1., 0.85, ax) + smoothstep(0.2, 0.05, length(q * vec2(2.2, 1.5))); } // bird (param = flap -1..1)
  else if (shape == 5) { float f = smoothstep(0.12, 0.04, abs(q.y)) * smoothstep(1., 0.9, abs(q.x));                                  // aircraft seen from below/side
    float w = smoothstep(0.08, 0.0, abs(q.y - (abs(q.x + 0.1) - 0.0) * -0.0) - 0.0) * 0.;
    float wingx = q.x + 0.05, wing = smoothstep(0.16, 0.06, abs(wingx + abs(q.y) * 0.55)) * smoothstep(0.95, 0.75, abs(q.y));
    float tail = smoothstep(0.1, 0.03, abs(q.x + 0.82 + abs(q.y) * 0.4)) * smoothstep(0.4, 0.3, abs(q.y));
    m = max(max(f, wing), tail); }
  else if (shape == 6) { float t = q.y * .5 + .5; m = exp(-q.x * q.x * (3. + 5. * t)) * pow(t, 0.7) * (0.75 + 0.25 * sin(t * 18. + p)); }      // water jet: bright base (q.y=+1 is the foot)
  else if (shape == 7) { float t = q.x * .5 + .5; m = pow(t, 2.2) * exp(-q.y * q.y * 4.5); }                                          // light trail, head at +x
  else if (shape == 8) { m = exp(-q.y * q.y * 5.) * smoothstep(1., 0.96, abs(q.x)); }                                                // soft line (bolt, contrail)
  else if (shape == 9) { float r = length(q); m = smoothstep(0.22, 0.0, abs(r - 0.72)) ; }                                           // splash ring
  else if (shape == 10) { m = smoothstep(0.12, -0.08, box(q, vec2(0.92, 0.8), 0.45)); }                                              // rounded body (car by day)
  if (vB.z >= 0.) { float sd = texture(tGeo, vImg).b; m *= smoothstep(0.035, 0.008, sd - vB.z); }
  if (m <= 0.002) discard;
  o = vC.a < 0. ? vec4(vC.rgb * (-vC.a) * m, 0.) : vec4(vC.rgb * vC.a * m, vC.a * m);
}`;
const STRIDE = 12;
export class Sprites {
  constructor(gl, max = 9000) {
    this.gl = gl; this.max = max; this.data = new Float32Array(max * STRIDE); this.n = 0; this.dropped = 0;
    const compile = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Sprite shader: ' + gl.getShaderInfoLog(s)); return s; };
    const p = this.prog = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Sprite program: ' + gl.getProgramInfoLog(p));
    this.u = {}; for (const k of ['uCov', 'uPar', 'uSize', 'uZoom', 'tGeo']) this.u[k] = gl.getUniformLocation(p, k);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, STRIDE * 4, i * 16); gl.vertexAttribDivisor(i, 1); }
    gl.bindVertexArray(null);
  }
  begin() { this.n = 0; }
  /** Add one sprite. a<0 => additive light with intensity -a. depth in geo units (0 far .. 1 near); negative => never occluded. */
  add(x, y, sx, sy, rot, shape, depth, param, r, g, b, a) {
    if (this.n >= this.max) { this.dropped++; return; }
    const d = this.data, i = this.n++ * STRIDE;
    d[i] = x; d[i + 1] = y; d[i + 2] = sx; d[i + 3] = sy; d[i + 4] = rot; d[i + 5] = shape; d[i + 6] = depth; d[i + 7] = param; d[i + 8] = r; d[i + 9] = g; d[i + 10] = b; d[i + 11] = a;
  }
  /** Line segment helper (bolts, contrails): from (x0,y0) to (x1,y1) with half-thickness w. */
  line(x0, y0, x1, y1, w, depth, r, g, b, a) { const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy); if (L < 0.01) return; this.add((x0 + x1) / 2, (y0 + y1) / 2, L / 2 + w * 0.5, w, Math.atan2(dy, dx), 8, depth, 0, r, g, b, a); }
  flush(view, size, geoTex) {
    const gl = this.gl; if (!this.n) return;
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * STRIDE);
    gl.uniform4fv(this.u.uCov, view.cov); gl.uniform2fv(this.u.uPar, view.par); gl.uniform2fv(this.u.uSize, size); gl.uniform1f(this.u.uZoom, view.zoom);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, geoTex); gl.uniform1i(this.u.tGeo, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
    gl.disable(gl.BLEND); gl.bindVertexArray(null);
  }
}
