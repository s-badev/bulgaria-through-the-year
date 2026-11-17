// Live cars are photographs: sprites cut from the scene's own photos, drawn in ONE instanced call from one atlas into an
// image-space layer. The base pass composites that layer into the day photograph BEFORE relighting, so a live car gets
// exactly the same sun, ambient, night gain, fog, wetness, parallax, grade and grain as the baked ones.
// Every fragment is multiplied by the strict asphalt mask: a car can not be drawn on anything that is not road.
const VS = `#version 300 es
layout(location=0) in vec4 aDst;   // x, y, w, h in image px (top-left + size)
layout(location=1) in vec4 aSrc;   // u, v, w, h in atlas px (w < 0 mirrors)
layout(location=2) in vec4 aCol;   // tint rgb, alpha
uniform vec2 uSize, uAtlas;
out vec2 vTex; out vec2 vImg; flat out vec4 vCol;
void main(){
  vec2 q = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 img = (aDst.xy + q * aDst.zw) / uSize;
  vTex = (aSrc.xy + q * aSrc.zw) / uAtlas; vImg = img; vCol = aCol;
  gl_Position = vec4(img * 2. - 1., 0., 1.);   // target space: image row 0 = texel row 0
}`;
const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vTex; in vec2 vImg; flat in vec4 vCol; out vec4 o;
uniform sampler2D tAtlas, tRoad; uniform float uAutumn;
void main(){
  vec4 t = texture(tAtlas, vTex);
  vec2 rd = texture(tRoad, vImg).rg;
  float a = t.a * vCol.a * smoothstep(0.5, 0.8, mix(rd.r, rd.g, uAutumn));   // strictly inside the asphalt mask
  if (a < 0.004) discard;
  o = vec4(sqrt(max(t.rgb * vCol.rgb, 0.)) * a, a);                          // premultiplied, gamma-encoded (decoded in the base pass)
}`;
const STRIDE = 12;
export class TrafficLayer {
  constructor(gl, scene, max = 600) {
    this.gl = gl; this.scene = scene; this.max = max; this.data = new Float32Array(max * STRIDE); this.n = 0; this.drawn = 0;
    const [W, H] = scene.size; this.W = W; this.H = H;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Traffic shader: ' + gl.getShaderInfoLog(s)); return s; };
    const p = this.prog = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Traffic program: ' + gl.getProgramInfoLog(p));
    this.u = {}; for (const k of ['uSize', 'uAtlas', 'tAtlas', 'tRoad', 'uAutumn']) this.u[k] = gl.getUniformLocation(p, k);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, STRIDE * 4, i * 16); gl.vertexAttribDivisor(i, 1); }
    gl.bindVertexArray(null);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.rects = scene.traffic.rects; this.dirty = true; this.hadCars = false;
  }
  begin() { this.n = 0; }
  /** One sprite: destination rect in image px, source rect in atlas px (negative width mirrors), tint and alpha. */
  add(dx, dy, dw, dh, su, sv, sw, sh, r, g, b, a) {
    if (this.n >= this.max) return; const d = this.data, i = this.n++ * STRIDE;
    d[i] = dx; d[i + 1] = dy; d[i + 2] = dw; d[i + 3] = dh; d[i + 4] = su; d[i + 5] = sv; d[i + 6] = sw; d[i + 7] = sh; d[i + 8] = r; d[i + 9] = g; d[i + 10] = b; d[i + 11] = a;
  }
  /** Render the layer (only inside the road rectangles). Leaves the default framebuffer unbound: callers rebind what they need. */
  flush(autumn) {
    const gl = this.gl;
    if (!this.n && !this.hadCars) return;              // nothing to draw and nothing to erase
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, this.W, this.H);
    gl.enable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0);
    for (const [x, y, w, h] of this.rects) { gl.scissor(x, y, w, h); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.disable(gl.SCISSOR_TEST);
    if (this.n) {
      gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * STRIDE);
      gl.uniform2f(this.u.uSize, this.W, this.H); gl.uniform2f(this.u.uAtlas, this.scene.traffic.atlas[0], this.scene.traffic.atlas[1]); gl.uniform1f(this.u.uAutumn, autumn ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex.cars); gl.uniform1i(this.u.tAtlas, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex.road); gl.uniform1i(this.u.tRoad, 1);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
      gl.disable(gl.BLEND); gl.bindVertexArray(null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this.hadCars = this.n > 0; this.drawn = this.n; this.dirty = true;
  }
  /** QA: read the layer back (RGBA, image rows top to bottom). */
  read() { const gl = this.gl, px = new Uint8Array(this.W * this.H * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return px; }
}
