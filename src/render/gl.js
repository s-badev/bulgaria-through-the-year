// Minimal WebGL2 helpers: programs with cached uniforms, textures, render targets, one fullscreen triangle.
export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) return null;
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  return gl;
}
const VS = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = vec2(p.x, 1.0 - p.y); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

// Same triangle for render targets: no flip, so image row 0 lands on texel row 0 and targets sample like photos.
const VS_TARGET = VS.replace('vUv = vec2(p.x, 1.0 - p.y);', 'vUv = p;');

export function createProgram(gl, fs, { target = false } = {}) {
  const vs = target ? VS_TARGET : VS;
  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('Shader compile failed: ' + log); }
    return s;
  };
  const p = gl.createProgram(), a = compile(gl.VERTEX_SHADER, vs), b = compile(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  gl.deleteShader(a); gl.deleteShader(b);
  const uniforms = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i), name = info.name.replace(/\[0\]$/, ''); uniforms[name] = { loc: gl.getUniformLocation(p, info.name), type: info.type }; }
  let unit = 0; const samplers = {};
  const prog = {
    program: p, uniforms,
    use() { gl.useProgram(p); unit = 0; return prog; },
    set(name, v) {
      const u = uniforms[name]; if (!u) return prog;
      if (typeof v === 'number') gl.uniform1f(u.loc, v);
      else if (v.length === 2) gl.uniform2f(u.loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(u.loc, v[0], v[1], v[2]);
      else if (v.length === 4) gl.uniform4f(u.loc, v[0], v[1], v[2], v[3]);
      return prog;
    },
    seti(name, v) { const u = uniforms[name]; if (u) gl.uniform1i(u.loc, v); return prog; },
    tex(name, texture) { // stable unit per sampler name
      const u = uniforms[name]; if (!u) return prog;
      if (!(name in samplers)) samplers[name] = Object.keys(samplers).length;
      const k = samplers[name]; gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(u.loc, k);
      return prog;
    },
  };
  return prog;
}
export function drawFullscreen(gl) { gl.drawArrays(gl.TRIANGLES, 0, 3); }

/** Texture from an ImageBitmap/HTMLImageElement. kind: 'photo' (sRGB + mipmaps), 'data' (linear, clamp), 'tile' (linear, repeat, mipmaps). */
export function createTexture(gl, source, kind = 'photo') {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  const srgb = kind === 'photo' || kind === 'atlas';
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  const wrap = kind === 'tile' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (kind === 'data' || kind === 'atlas') gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  else { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
  return t;
}
export function solidTexture(gl, rgba = [0, 0, 0, 255], srgb = false) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return t;
}
export function createTarget(gl, w, h, { filter = gl.LINEAR, mips = false } = {}) {
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, mips };
}
export function bindTarget(gl, target) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  gl.viewport(0, 0, target ? target.w : gl.drawingBufferWidth, target ? target.h : gl.drawingBufferHeight);
}
