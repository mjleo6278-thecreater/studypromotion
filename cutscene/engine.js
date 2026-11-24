// 업데이트 컷씬용 작은 복셀 3D 엔진 (라이브러리 없이 WebGL1만 씀)
// - Vox: 복셀 모델 (정수 좌표 → 색)
// - buildMesh: 보이는 면만 + 모서리 어둡게(AO)
// - Renderer: 그림자 맵 + 반구 조명 + 안개, 반투명 패스, 글자 판(텍스처) 패스
(function (global) {
  'use strict';

  // ---------- 수학 (열 우선 4x4) ----------
  const M4 = {
    ident() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    persp(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    ortho(l, r, b, t, n, f) {
      return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
    },
    lookAt(e, a, up) {
      let zx = e[0] - a[0], zy = e[1] - a[1], zz = e[2] - a[2];
      let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
    },
    // T(p) · Ry · Rx · Rz · S · T(-pivot)
    compose(p, r, s, pivot) {
      const [rx, ry, rz] = r || [0, 0, 0];
      const [sx, sy, sz] = s || [1, 1, 1];
      const cy = Math.cos(ry), sy_ = Math.sin(ry), cx = Math.cos(rx), sx_ = Math.sin(rx), cz = Math.cos(rz), sz_ = Math.sin(rz);
      // R = Ry*Rx*Rz
      const r00 = cy * cz + sy_ * sx_ * sz_, r01 = -cy * sz_ + sy_ * sx_ * cz, r02 = sy_ * cx;
      const r10 = cx * sz_, r11 = cx * cz, r12 = -sx_;
      const r20 = -sy_ * cz + cy * sx_ * sz_, r21 = sy_ * sz_ + cy * sx_ * cz, r22 = cy * cx;
      const m = new Float32Array([r00 * sx, r10 * sx, r20 * sx, 0, r01 * sy, r11 * sy, r21 * sy, 0, r02 * sz, r12 * sz, r22 * sz, 0, 0, 0, 0, 1]);
      const pv = pivot || [0, 0, 0];
      m[12] = (p ? p[0] : 0) - (m[0] * pv[0] + m[4] * pv[1] + m[8] * pv[2]);
      m[13] = (p ? p[1] : 0) - (m[1] * pv[0] + m[5] * pv[1] + m[9] * pv[2]);
      m[14] = (p ? p[2] : 0) - (m[2] * pv[0] + m[6] * pv[1] + m[10] * pv[2]);
      return m;
    },
    apply(m, v) {
      const x = v[0], y = v[1], z = v[2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    },
    // 법선 행렬 (왼쪽 위 3x3의 역전치)
    normal3(m) {
      const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
      const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
      const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
      const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
      const det = a * A + b * B + c * C || 1;
      return new Float32Array([A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det]);
    },
  };

  // ---------- 색 ----------
  const hex = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  function hash3(x, y, z) {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  // ---------- 복셀 모델 ----------
  class Vox {
    constructor(opts) { this.m = new Map(); this.jitter = (opts && opts.jitter) || 0; }
    static k(x, y, z) { return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); }
    set(x, y, z, c) { this.m.set(Vox.k(x, y, z), [x, y, z, c]); return this; }
    get(x, y, z) { const v = this.m.get(Vox.k(x, y, z)); return v ? v[3] : null; }
    has(x, y, z) { return this.m.has(Vox.k(x, y, z)); }
    del(x, y, z) { this.m.delete(Vox.k(x, y, z)); return this; }
    box(x0, y0, z0, x1, y1, z1, c) {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
      return this;
    }
    // 가운데(0,0) 기준 둥근 판 한 층
    disc(y, r, c, cx = 0, cz = 0) {
      const R = Math.ceil(r);
      for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) if (x * x + z * z <= r * r + 0.01) this.set(cx + x, y, cz + z, typeof c === 'function' ? c(cx + x, y, cz + z) : c);
      return this;
    }
    each(fn) { for (const v of this.m.values()) fn(v[0], v[1], v[2], v[3]); }
    // z 방향으로 가장 앞에 있는 칸 (얼굴 그림 붙일 때)
    frontZ(x, y) { let best = null; this.each((vx, vy, vz) => { if (vx === x && vy === y && (best === null || vz > best)) best = vz; }); return best; }
    get size() { return this.m.size; }
  }

  // 6방향: [축, 부호]
  const FACES = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  const STRIDE = 10; // pos3 nrm3 col3 ao1

  function pushQuad(out, corners, n, col, aos) {
    // aos 대각선이 더 어두운 쪽으로 나눠 AO가 자연스럽게
    const flip = aos[0] + aos[2] < aos[1] + aos[3];
    const order = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
    for (const i of order) {
      const c = corners[i];
      out.push(c[0], c[1], c[2], n[0], n[1], n[2], col[0], col[1], col[2], aos[i]);
    }
  }

  // 복셀 → 삼각형 (보이는 면만, 꼭짓점 AO)
  function buildMesh(vox, opts = {}) {
    const out = [];
    const solid = (x, y, z) => vox.has(x, y, z);
    const AO = [0.58, 0.74, 0.88, 1];
    vox.each((x, y, z, c) => {
      let col = hex(c);
      if (vox.jitter) {
        const j = (hash3(x, y, z) - 0.5) * vox.jitter;
        col = col.map((v) => Math.min(1, Math.max(0, v * (1 + j))));
      }
      for (const [ax, s] of FACES) {
        const nx = ax === 0 ? s : 0, ny = ax === 1 ? s : 0, nz = ax === 2 ? s : 0;
        if (solid(x + nx, y + ny, z + nz)) continue;
        if (opts.skip && opts.skip(nx, ny, nz, x, y, z)) continue;
        const u = (ax + 1) % 3, v = (ax + 2) % 3;
        const base = [x, y, z];
        if (s > 0) base[ax] += 1;
        const corners = [], aos = [];
        for (const [du, dv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          const p = base.slice(); p[u] += du; p[v] += dv; corners.push(p);
          // AO: 면 바깥쪽 층에서 옆 두 칸 + 대각선 칸
          const q = [x + nx, y + ny, z + nz];
          const a = q.slice(); a[u] += du ? 1 : -1;
          const b = q.slice(); b[v] += dv ? 1 : -1;
          const d = q.slice(); d[u] += du ? 1 : -1; d[v] += dv ? 1 : -1;
          const s1 = solid(a[0], a[1], a[2]) ? 1 : 0, s2 = solid(b[0], b[1], b[2]) ? 1 : 0, s3 = solid(d[0], d[1], d[2]) ? 1 : 0;
          aos.push(opts.noAO ? 1 : 1 - (1 - AO[s1 && s2 ? 0 : 3 - (s1 + s2 + s3)]) * (opts.ao == null ? 1 : opts.ao));
        }
        // 감는 방향을 법선 쪽에서 반시계로 맞춘다
        const e1 = [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1], corners[1][2] - corners[0][2]];
        const e2 = [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1], corners[2][2] - corners[0][2]];
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (cr[0] * nx + cr[1] * ny + cr[2] * nz < 0) { corners.reverse(); aos.reverse(); }
        pushQuad(out, corners, [nx, ny, nz], col, aos);
      }
    });
    return new Float32Array(out);
  }

  // 상자 목록 → 삼각형 (얇은 얼굴 그림, 입자처럼 복셀 격자에 안 맞는 것)
  function boxesToArray(boxes, out) {
    out = out || [];
    for (const bx of boxes) {
      const [x0, y0, z0, x1, y1, z1] = bx;
      const col = Array.isArray(bx[6]) ? bx[6] : hex(bx[6]);
      const ao = bx[7] == null ? 1 : bx[7];
      const P = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
      const quads = [
        [[1, 0, 0], [P(1, 0, 1), P(1, 0, 0), P(1, 1, 0), P(1, 1, 1)]],
        [[-1, 0, 0], [P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)]],
        [[0, 1, 0], [P(0, 1, 1), P(1, 1, 1), P(1, 1, 0), P(0, 1, 0)]],
        [[0, -1, 0], [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)]],
        [[0, 0, 1], [P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)]],
        [[0, 0, -1], [P(1, 0, 0), P(0, 0, 0), P(0, 1, 0), P(1, 1, 0)]],
      ];
      for (const [n, cs] of quads) {
        for (const i of [0, 1, 2, 0, 2, 3]) out.push(cs[i][0], cs[i][1], cs[i][2], n[0], n[1], n[2], col[0], col[1], col[2], ao);
      }
    }
    return out;
  }

  // ---------- 셰이더 ----------
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  const VS_MAIN = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol; attribute float aAo;
uniform mat4 uModel; uniform mat4 uVP; uniform mat4 uLightVP; uniform mat3 uNM;
varying vec3 vCol; varying vec3 vN; varying float vAo; varying vec4 vLP; varying vec3 vW;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vN = normalize(uNM * aNrm);
  vW = w.xyz; vCol = aCol; vAo = aAo;
  vLP = uLightVP * vec4(w.xyz + vN * 0.12, 1.0);
  gl_Position = uVP * w;
}`;
  const FS_MAIN = HEAD + `
uniform vec3 uLightDir; uniform vec3 uLightCol; uniform vec3 uSky; uniform vec3 uGround;
uniform sampler2D uShadow; uniform float uShadowOn; uniform float uTexel;
uniform vec4 uTint; uniform vec3 uAdd; uniform vec3 uFogCol; uniform vec2 uFog; uniform vec3 uEye;
uniform float uEmit;
varying vec3 vCol; varying vec3 vN; varying float vAo; varying vec4 vLP; varying vec3 vW;
float unpack(vec4 c){ return dot(c, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }
float sh(vec2 uv, float z){ return z - 0.0015 > unpack(texture2D(uShadow, uv)) ? 0.0 : 1.0; }
void main(){
  vec3 n = normalize(vN);
  float ndl = max(dot(n, uLightDir), 0.0);
  float s = 1.0;
  if (uShadowOn > 0.5 && ndl > 0.0) {
    vec3 p = vLP.xyz / vLP.w * 0.5 + 0.5;
    if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0 && p.z < 1.0) {
      float t = uTexel;
      s = (sh(p.xy + vec2(-t, -t), p.z) + sh(p.xy + vec2(t, -t), p.z) + sh(p.xy + vec2(-t, t), p.z) + sh(p.xy + vec2(t, t), p.z)) * 0.25;
    }
  }
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  float ao = vAo;
  vec3 c = vCol * (amb * ao + uLightCol * ndl * s * (0.55 + 0.45 * ao));
  c = mix(c, vCol, uEmit);
  c = c * uTint.rgb + uAdd;
  float d = distance(vW, uEye);
  c = mix(c, uFogCol, smoothstep(uFog.x, uFog.y, d));
  gl_FragColor = vec4(c, uTint.a);
}`;
  const VS_DEPTH = `
attribute vec3 aPos; uniform mat4 uModel; uniform mat4 uLightVP; varying float vZ;
void main(){ vec4 p = uLightVP * uModel * vec4(aPos, 1.0); vZ = p.z / p.w * 0.5 + 0.5; gl_Position = p; }`;
  const FS_DEPTH = HEAD + `
varying float vZ;
void main(){ vec4 e = fract(vZ * vec4(1.0, 255.0, 65025.0, 16581375.0)); e -= e.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0); gl_FragColor = e; }`;
  const VS_TEX = `
attribute vec3 aPos; attribute vec2 aUV; uniform mat4 uModel; uniform mat4 uVP; varying vec2 vUV;
void main(){ vUV = aUV; gl_Position = uVP * uModel * vec4(aPos, 1.0); }`;
  const FS_TEX = HEAD + `
uniform sampler2D uTex; uniform float uAlpha; uniform float uBright; varying vec2 vUV;
void main(){ vec4 c = texture2D(uTex, vUV); gl_FragColor = vec4(c.rgb * uBright, c.a * uAlpha); }`;

  function compile(gl, vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, a = {};
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) { const n = gl.getActiveAttrib(p, i).name; a[n] = gl.getAttribLocation(p, n); }
    return { p, u, a };
  }

  // ---------- 그리는 쪽 ----------
  class Renderer {
    constructor(canvas, opts = {}) {
      const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' });
      if (!gl) throw new Error('webgl');
      this.gl = gl; this.canvas = canvas;
      this.main = compile(gl, VS_MAIN, FS_MAIN);
      this.depth = compile(gl, VS_DEPTH, FS_DEPTH);
      this.tex = compile(gl, VS_TEX, FS_TEX);
      this.shadowSize = Math.min(opts.shadowSize || 2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
      this._makeShadow();
      this.dyn = gl.createBuffer();
      this.stats = { calls: 0, tris: 0 };
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
    }
    _makeShadow() {
      const gl = this.gl, S = this.shadowSize;
      this.shTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.shTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      this.shFb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shTex, 0);
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, S, S);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    mesh(arr) {
      const gl = this.gl, b = gl.createBuffer();
      const data = arr instanceof Float32Array ? arr : new Float32Array(arr);
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return { buf: b, count: data.length / STRIDE };
    }
    texture(canvas) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const tx = { t, canvas, update() { gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); } };
      tx.update();
      return tx;
    }
    // 글자 판: 가운데 기준 w×h 사각형
    quad(w, h) {
      const gl = this.gl, b = gl.createBuffer();
      const x = w / 2, y = h / 2;
      const d = new Float32Array([-x, -y, 0, 0, 1, x, -y, 0, 1, 1, x, y, 0, 1, 0, -x, -y, 0, 0, 1, x, y, 0, 1, 0, -x, y, 0, 0, 0]);
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
      return { buf: b, count: 6 };
    }
    _bindMain(prog, buf, depthOnly) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const F = 4 * STRIDE;
      gl.enableVertexAttribArray(prog.a.aPos); gl.vertexAttribPointer(prog.a.aPos, 3, gl.FLOAT, false, F, 0);
      if (depthOnly) { for (let i = 0; i < 8; i++) if (i !== prog.a.aPos) gl.disableVertexAttribArray(i); return; }
      gl.enableVertexAttribArray(prog.a.aNrm); gl.vertexAttribPointer(prog.a.aNrm, 3, gl.FLOAT, false, F, 12);
      gl.enableVertexAttribArray(prog.a.aCol); gl.vertexAttribPointer(prog.a.aCol, 3, gl.FLOAT, false, F, 24);
      gl.enableVertexAttribArray(prog.a.aAo); gl.vertexAttribPointer(prog.a.aAo, 1, gl.FLOAT, false, F, 36);
    }
    // frame = { cam:{eye,target,fov,shiftY}, light:{dir,center,radius}, bg, sky, ground, lightCol, fog, items:[{mesh,m,tint,add,alpha,shadow,emit}], dyn:[floats], glass:[...], planes:[{quad,tex,m,alpha,bright}] }
    render(frame) {
      const gl = this.gl, cv = this.canvas;
      const W = cv.width, H = cv.height;
      this.stats.calls = 0; this.stats.tris = 0;
      // 움직이는 입자 묶음 (한 번에 그림)
      let dynMesh = null;
      if (frame.dyn && frame.dyn.length) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dyn);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(frame.dyn), gl.DYNAMIC_DRAW);
        dynMesh = { buf: this.dyn, count: frame.dyn.length / STRIDE };
      }
      const items = frame.items.slice();
      if (dynMesh) items.push({ mesh: dynMesh, m: M4.ident(), shadow: frame.dynShadow !== false });
      // 빛 행렬
      const L = frame.light;
      const ld = norm(L.dir);
      const c = L.center, R = L.radius;
      const lEye = [c[0] + ld[0] * R * 2, c[1] + ld[1] * R * 2, c[2] + ld[2] * R * 2];
      const lightVP = M4.mul(M4.ortho(-R, R, -R, R, 0.5, R * 4), M4.lookAt(lEye, c, Math.abs(ld[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]));
      // 1) 그림자 맵
      const shadowOn = L.shadow !== false;
      if (shadowOn) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFb);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.depth.p);
        gl.uniformMatrix4fv(this.depth.u.uLightVP, false, lightVP);
        gl.disable(gl.CULL_FACE);
        for (const it of items) {
          if (it.shadow === false || it.hidden) continue;
          this._bindMain(this.depth, it.mesh.buf, true);
          gl.uniformMatrix4fv(this.depth.u.uModel, false, it.m);
          gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
          this.stats.calls++;
        }
        gl.enable(gl.CULL_FACE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      // 2) 화면
      gl.viewport(0, 0, W, H);
      const bg = frame.bg || [0.1, 0.1, 0.1];
      gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const cam = frame.cam;
      const vp = this.viewProj(cam, W / H);
      this.lastVP = vp;
      const P = this.main;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uVP, false, vp);
      gl.uniformMatrix4fv(P.u.uLightVP, false, lightVP);
      gl.uniform3fv(P.u.uLightDir, ld);
      gl.uniform3fv(P.u.uLightCol, frame.lightCol || [1, 1, 1]);
      gl.uniform3fv(P.u.uSky, frame.sky || [0.5, 0.5, 0.55]);
      gl.uniform3fv(P.u.uGround, frame.ground || [0.3, 0.28, 0.26]);
      gl.uniform3fv(P.u.uFogCol, frame.fogCol || bg);
      gl.uniform2fv(P.u.uFog, frame.fog || [1e4, 1e5]);
      gl.uniform3fv(P.u.uEye, cam.eye);
      gl.uniform1f(P.u.uShadowOn, shadowOn ? 1 : 0);
      gl.uniform1f(P.u.uTexel, 0.75 / this.shadowSize);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shTex);
      gl.uniform1i(P.u.uShadow, 0);
      const drawMain = (it) => {
        this._bindMain(P, it.mesh.buf);
        gl.uniformMatrix4fv(P.u.uModel, false, it.m);
        gl.uniformMatrix3fv(P.u.uNM, false, M4.normal3(it.m));
        const t = it.tint || [1, 1, 1];
        gl.uniform4f(P.u.uTint, t[0], t[1], t[2], it.alpha == null ? 1 : it.alpha);
        gl.uniform3fv(P.u.uAdd, it.add || [0, 0, 0]);
        gl.uniform1f(P.u.uEmit, it.emit || 0);
        gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
        this.stats.calls++; this.stats.tris += it.mesh.count / 3;
      };
      for (const it of items) if (!it.hidden) drawMain(it);
      // 3) 글자 판 (폰 화면 등)
      if (frame.planes && frame.planes.length) {
        const T = this.tex;
        gl.useProgram(T.p);
        gl.uniformMatrix4fv(T.u.uVP, false, vp);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        for (const pl of frame.planes) {
          gl.bindBuffer(gl.ARRAY_BUFFER, pl.quad.buf);
          gl.enableVertexAttribArray(T.a.aPos); gl.vertexAttribPointer(T.a.aPos, 3, gl.FLOAT, false, 20, 0);
          gl.enableVertexAttribArray(T.a.aUV); gl.vertexAttribPointer(T.a.aUV, 2, gl.FLOAT, false, 20, 12);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pl.tex.t);
          gl.uniform1i(T.u.uTex, 0);
          gl.uniformMatrix4fv(T.u.uModel, false, pl.m);
          gl.uniform1f(T.u.uAlpha, pl.alpha == null ? 1 : pl.alpha);
          gl.uniform1f(T.u.uBright, pl.bright == null ? 1 : pl.bright);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          this.stats.calls++;
        }
        gl.disable(gl.BLEND);
        gl.disableVertexAttribArray(T.a.aUV);
      }
      // 4) 반투명 (김·물방울): 먼 것부터, 깊이 쓰기 끔
      if (frame.glass && frame.glass.length) {
        gl.useProgram(P.p);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        const e = cam.eye;
        const g = frame.glass.slice().sort((a, b) => dist2(b.m, e) - dist2(a.m, e));
        for (const it of g) drawMain(it);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }
    viewProj(cam, aspect) {
      const proj = M4.persp(cam.fov, aspect, cam.near || 1, cam.far || 600);
      // 렌즈 이동: 아래 자막 자리를 비우려고 화면 중심을 위로
      if (cam.shiftY) proj[9] += cam.shiftY;
      if (cam.shiftX) proj[8] += cam.shiftX;
      return M4.mul(proj, M4.lookAt(cam.eye, cam.target, cam.up || [0, 1, 0]));
    }
    // 3D 점 → 화면 비율 좌표(0~1)
    project(p, vp) {
      const m = vp || this.lastVP;
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [(x / w) * 0.5 + 0.5, 1 - ((y / w) * 0.5 + 0.5), w];
    }
  }
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dist2 = (m, e) => (m[12] - e[0]) ** 2 + (m[13] - e[1]) ** 2 + (m[14] - e[2]) ** 2;

  // ---------- 움직임 도우미 ----------
  const E = {
    clamp: (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)),
    lerp: (a, b, t) => a + (b - a) * t,
    lerp3: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    back: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    elastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
    // 구간 [a,b] 안의 진행도 0~1
    seg: (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a))),
    rand: (i) => hash3(i, 7, 13),
  };

  global.Vox3D = { M4, Vox, buildMesh, boxesToArray, Renderer, hex, hash3, E, STRIDE };
})(typeof window !== 'undefined' ? window : globalThis);
