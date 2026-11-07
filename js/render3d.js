/* 초능력자: 각성 — 2.5D 로우폴리 렌더러 (Three.js r160 UMD)
 * 풀 해상도 (devicePixelRatio ≤ 1.5), 안티앨리어싱, 플랫 셰이딩 로우폴리 장면.
 * 좌표 규약: 게임 평면 = z 0, Three X = 게임 x, Three Y = −게임 y, 1 단위 = 게임 1px.
 * 카메라는 회전 없는 PerspectiveCamera. z=0 평면은 2D 오버레이(translate(−camX,−camY))와 정확히 일치.
 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};
  var THREE = window.THREE;

  var R = {
    available: !!(THREE && THREE.WebGLRenderer),
    ownsPlayers: true,
    init: init,
    resize: resize,
    rebuild: rebuild,
    render: render,
    // 설정: 최대 픽셀 비율 (성능)
    maxPixelRatio: 1.5
  };
  G.Render3D = R;
  if (!R.available) return;

  // ===========================================================================
  // 상수 / 팔레트
  // ===========================================================================
  var WORLD_W = 4200, MID = 2100;
  var FOV = 40;
  var CHUNK = 700;

  var C = {
    rust: 0xb5541c, rustHi: 0xe07a35, rustDk: 0x5a2a10,
    steel: 0x2e3433, steelDk: 0x1a1f1e, steelHi: 0x4a5452,
    moss: 0x4fae8c, mossHi: 0x7fe0b8, mossDk: 0x4c6a28, mossMid: 0x5f7f30,
    toxic: 0x8dff3c,
    concrete: 0x77756a, concreteDk: 0x56554c, concreteHi: 0x8f8b7c,
    asphalt: 0x2b2d2c, asphaltHi: 0x363836, asphaltDk: 0x222423,
    glassDk: 0x121614, wood: 0x6b5236, woodDk: 0x4a3a2a
  };
  var SKY_TOP = '#16142a', SKY_MID = '#3d2944', SKY_LOW = '#8a4636', SKY_HOR = '#e0884a';
  var FOG_COL = 0x5a3a40;

  // ===========================================================================
  // 유틸
  // ===========================================================================
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function hexToInt(h) {
    if (typeof h === 'number') return h;
    if (typeof h !== 'string') return 0xffffff;
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h.slice(0, 6), 16);
    return isNaN(v) ? 0xffffff : v;
  }
  function shade(c, k) {
    var r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
    else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
    return (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255);
  }
  function mix(a, b, t) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }
  function jitter(r, c, amt) { return shade(c, (r() - 0.5) * 2 * amt); }

  // ===========================================================================
  // 지오메트리 빌더 (게임 좌표 입력, 정점색, 플랫 노멀)
  // ===========================================================================
  function Builder() { this.p = []; this.n = []; this.c = []; }
  Builder.prototype.tri = function (a, b, c, col) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    var r = ((col >> 16) & 255) / 255, g = ((col >> 8) & 255) / 255, bl = (col & 255) / 255;
    var P = this.p, N = this.n, Cc = this.c;
    P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    N.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    Cc.push(r, g, bl, r, g, bl, r, g, bl);
  };
  // 세 공간 좌표의 사각형 (바깥에서 볼 때 CCW)
  Builder.prototype.quad = function (a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); };
  // 박스: 게임 좌표 x0..x1, y0(위)..y1(아래), z0..z1. 뒷면(-Z)은 생략(카메라는 항상 +Z).
  // cols: 숫자 하나 또는 {f, t, s, b}
  Builder.prototype.box = function (x0, y0, x1, y1, z0, z1, col, noBottom) {
    var t = -y0, b = -y1;
    var cf = col, ct = col, cs = col, cb = col;
    if (typeof col === 'object') { cf = col.f; ct = col.t != null ? col.t : col.f; cs = col.s != null ? col.s : col.f; cb = col.b != null ? col.b : cs; }
    this.quad([x0, b, z1], [x1, b, z1], [x1, t, z1], [x0, t, z1], cf);
    this.quad([x1, b, z1], [x1, b, z0], [x1, t, z0], [x1, t, z1], cs);
    this.quad([x0, b, z0], [x0, b, z1], [x0, t, z1], [x0, t, z0], cs);
    this.quad([x0, t, z1], [x1, t, z1], [x1, t, z0], [x0, t, z0], ct);
    if (!noBottom) this.quad([x0, b, z0], [x1, b, z0], [x1, b, z1], [x0, b, z1], cb);
  };
  // 볼록 다각형 [[x,y],...] (게임 좌표)을 z0..z1로 돌출
  Builder.prototype.poly = function (pts, z0, z1, col, sideCol) {
    var n = pts.length, i, area = 0;
    var q = [];
    for (i = 0; i < n; i++) q.push([pts[i][0], -pts[i][1]]);
    for (i = 0; i < n; i++) { var a = q[i], b = q[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) q.reverse();
    var sc = sideCol != null ? sideCol : col;
    for (i = 1; i < n - 1; i++) this.tri([q[0][0], q[0][1], z1], [q[i][0], q[i][1], z1], [q[i + 1][0], q[i + 1][1], z1], col);
    for (i = 0; i < n; i++) {
      var p0 = q[i], p1 = q[(i + 1) % n];
      this.quad([p0[0], p0[1], z1], [p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], sc);
    }
  };
  // 두 점을 잇는 각재 (xy 평면에서 기울어짐)
  Builder.prototype.beam = function (x0, y0, x1, y1, th, z0, z1, col) {
    var dx = x1 - x0, dy = y1 - y0, l = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / l * th / 2, ny = dx / l * th / 2;
    this.poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], z0, z1, col);
  };
  // 정면 납작 사각형 (z 고정, +Z 방향)
  Builder.prototype.face = function (x0, y0, x1, y1, z, col) {
    this.quad([x0, -y1, z], [x1, -y1, z], [x1, -y0, z], [x0, -y0, z], col);
  };
  // 수평 사각형 (윗면, y 고정)
  Builder.prototype.flat = function (x0, x1, y, z0, z1, col) {
    this.quad([x0, -y, z1], [x1, -y, z1], [x1, -y, z0], [x0, -y, z0], col);
  };
  // 옆면 (x 고정, +X 또는 -X 방향)
  Builder.prototype.side = function (x, y0, y1, z0, z1, col, dir) {
    if (dir > 0) this.quad([x, -y1, z1], [x, -y1, z0], [x, -y0, z0], [x, -y0, z1], col);
    else this.quad([x, -y1, z0], [x, -y1, z1], [x, -y0, z1], [x, -y0, z0], col);
  };
  // 팔각 기둥 (바퀴/드럼) - 중심 (cx, cy), 반지름 r
  Builder.prototype.wheel = function (cx, cy, rad, z0, z1, col, seg) {
    seg = seg || 8;
    var pts = [];
    for (var i = 0; i < seg; i++) {
      var a = (i + 0.5) / seg * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
    this.poly(pts, z0, z1, col);
  };
  // 세로 원통 (드럼통) - 바닥 중심 (cx, by, cz)
  Builder.prototype.drum = function (cx, by, cz, rad, h, col, topCol, seg) {
    seg = seg || 8;
    var t = -(by - h), b = -by, i;
    for (i = 0; i < seg; i++) {
      var a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      var x0 = cx + Math.cos(a0) * rad, z0 = cz + Math.sin(a0) * rad;
      var x1 = cx + Math.cos(a1) * rad, z1 = cz + Math.sin(a1) * rad;
      this.quad([x1, b, z1], [x0, b, z0], [x0, t, z0], [x1, t, z1], col);
      this.tri([cx, t, cz], [x1, t, z1], [x0, t, z0], topCol != null ? topCol : col);
    }
  };
  Builder.prototype.toMesh = function (mat) {
    if (!this.p.length) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    var m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  };

  // 청크별 빌더 묶음: lit(조명), emi(발광, MeshBasic)
  function Chunks() { this.map = {}; }
  Chunks.prototype.get = function (layer, x) {
    var k = layer + ':' + Math.floor(x / CHUNK);
    var c = this.map[k];
    if (!c) c = this.map[k] = { lit: new Builder(), emi: new Builder() };
    return c;
  };

  // ===========================================================================
  // 상태
  // ===========================================================================
  var renderer = null, canvas = null, scene = null, camera = null;
  var staticGroup = null, dynGroup = null, shadowGroup = null, playerScene = null;
  var matLit = null, matEmi = null;
  var anim = { neon: [], blink: [], toxic: [] };
  var vw = 1, vh = 1, camD = 1000;
  var builtGy = null, builtSig = '';
  var pool = {}, weakList = [], poolWeak = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var frameNo = 0, lastTime = 0;
  var texCache = {};

  // ===========================================================================
  // init / resize
  // ===========================================================================
  function init(canvasEl) {
    if (!R.available) return false;
    try {
      canvas = canvasEl || document.getElementById('game3d');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'game3d';
        document.body.insertBefore(canvas, document.body.firstChild);
      }
      if (THREE.ColorManagement) THREE.ColorManagement.enabled = false;
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
      if (!renderer.getContext()) throw new Error('no gl');
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      renderer.sortObjects = true;

      scene = new THREE.Scene();
      scene.background = makeSkyTexture();
      scene.fog = new THREE.Fog(FOG_COL, 900, 4200);
      camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 10, 9000);

      var hemi = new THREE.HemisphereLight(0x9a86b8, 0x4a3022, 2.1);
      scene.add(hemi);
      var sun = new THREE.DirectionalLight(0xffb27a, 2.6);
      sun.position.set(-0.55, 0.62, 0.75);
      scene.add(sun);
      var rim = new THREE.DirectionalLight(0x5fd8c0, 0.7);
      rim.position.set(0.7, 0.2, -0.3);
      scene.add(rim);

      matLit = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      matEmi = new THREE.MeshBasicMaterial({ vertexColors: true });

      staticGroup = new THREE.Group();
      shadowGroup = new THREE.Group();
      dynGroup = new THREE.Group();
      scene.add(staticGroup);
      scene.add(shadowGroup);
      // 플레이어는 별도 패스: 정적 장면 위에 깊이 초기화 후 그림 (차/버스 안에 파묻히지 않게)
      playerScene = new THREE.Scene();
      playerScene.fog = scene.fog;
      playerScene.add(new THREE.HemisphereLight(0xb8a8d0, 0x5a4030, 2.6));
      var pSun = new THREE.DirectionalLight(0xffc090, 2.6);
      pSun.position.set(-0.4, 0.7, 0.9);
      playerScene.add(pSun);
      var pRim = new THREE.DirectionalLight(0x8ff5e2, 1.4);
      pRim.position.set(0.8, 0.3, -0.6);
      playerScene.add(pRim);
      playerScene.add(dynGroup);
      renderer.autoClear = false;

      canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); R.available = false; }, false);
      resize(window.innerWidth || 800, window.innerHeight || 600, 1);
      R.renderer = renderer; R.scene = scene; R.camera = camera;
      return true;
    } catch (err) {
      R.available = false;
      if (window.console) console.warn('[Render3D] WebGL 사용 불가 → 2D 대체', err);
      try { if (renderer) renderer.dispose(); } catch (e2) { /* 무시 */ }
      renderer = null;
      return false;
    }
  }

  function setCanvasStyle(W, H) {
    if (!canvas || !canvas.style) return;
    var s = canvas.style;
    s.width = W + 'px';
    s.height = H + 'px';
    s.imageRendering = 'auto';
  }

  // pixelScale 인자는 호환용으로만 받고 무시 (풀 해상도 렌더)
  function resize(W, H, pixelScale) {
    if (!renderer) return;
    void pixelScale;
    W = W || G.width || window.innerWidth || 800;
    H = H || G.height || window.innerHeight || 600;
    vw = W; vh = H;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, R.maxPixelRatio));
    renderer.setSize(W, H, false);
    setCanvasStyle(W, H);
    camera.aspect = W / H;
    camera.fov = FOV;
    camD = (vh / 2) / Math.tan(FOV * Math.PI / 360);
    camera.near = 10;
    camera.far = camD + 7000;
    camera.updateProjectionMatrix();
    scene.fog.near = camD + 250;
    scene.fog.far = camD + 3600;
  }

  // ===========================================================================
  // 하늘 / 텍스트 텍스처
  // ===========================================================================
  function makeSkyTexture() {
    var W = 512, H = 256;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(0.28, SKY_MID);
    g.addColorStop(0.44, SKY_LOW);
    g.addColorStop(0.52, SKY_HOR);
    g.addColorStop(0.6, '#7a4a42');
    g.addColorStop(1, '#3a2830');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // 지는 해 글로우
    var sg = c.createRadialGradient(W * 0.3, H * 0.5, 2, W * 0.3, H * 0.5, H * 0.45);
    sg.addColorStop(0, 'rgba(255,214,140,0.95)');
    sg.addColorStop(0.08, 'rgba(255,170,90,0.7)');
    sg.addColorStop(0.35, 'rgba(230,110,60,0.25)');
    sg.addColorStop(1, 'rgba(230,110,60,0)');
    c.fillStyle = sg;
    c.fillRect(0, 0, W, H);
    // 낮은 폴리 구름 띠
    var r = makeRng(4711);
    for (var i = 0; i < 26; i++) {
      var y = H * (0.08 + r() * 0.36), x = r() * W, w = 60 + r() * 160, h = 2 + r() * 5;
      var warm = y > H * 0.3;
      c.fillStyle = warm ? 'rgba(240,140,90,' + (0.18 + r() * 0.2) + ')' : 'rgba(120,90,140,' + (0.15 + r() * 0.2) + ')';
      c.beginPath();
      c.moveTo(x, y); c.lineTo(x + w * 0.2, y - h); c.lineTo(x + w * 0.8, y - h * 0.8); c.lineTo(x + w, y); c.closePath();
      c.fill();
      c.fillStyle = 'rgba(40,24,40,0.18)';
      c.fillRect(x + w * 0.1, y, w * 0.8, 1.2);
    }
    var t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    return t;
  }

  // 부드러운 텍스트 텍스처 (TS배 해상도로 그림) → {tex, w, h} (w,h = 월드 단위)
  var TS = 3;
  function smoothText(text, opt) {
    opt = opt || {};
    var size = opt.size || 12;
    var font = (opt.bold !== false ? 'bold ' : '') + (size * TS) + 'px ' + (opt.font || '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif');
    var cv = document.createElement('canvas');
    var c = cv.getContext('2d');
    c.font = font;
    var tw = c.measureText(text).width / TS;
    var pad = opt.pad != null ? opt.pad : 4;
    var w = Math.ceil(tw + pad * 2), h = Math.ceil(size * 1.25 + pad * 2);
    cv.width = w * TS; cv.height = h * TS;
    c = cv.getContext('2d');
    c.scale(TS, TS);
    if (opt.bg) {
      c.fillStyle = opt.bg;
      var r0 = Math.min(h / 2, 6);
      c.beginPath();
      c.moveTo(r0, 0); c.lineTo(w - r0, 0); c.quadraticCurveTo(w, 0, w, r0); c.lineTo(w, h - r0);
      c.quadraticCurveTo(w, h, w - r0, h); c.lineTo(r0, h); c.quadraticCurveTo(0, h, 0, h - r0);
      c.lineTo(0, r0); c.quadraticCurveTo(0, 0, r0, 0); c.closePath(); c.fill();
    }
    c.font = (opt.bold !== false ? 'bold ' : '') + size + 'px ' + (opt.font || '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif');
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    if (opt.glow) { c.shadowColor = opt.glow; c.shadowBlur = opt.glowBlur || 6; }
    if (opt.outline) {
      c.lineJoin = 'round';
      c.lineWidth = opt.outlineW || 3;
      c.strokeStyle = opt.outline;
      c.strokeText(text, w / 2, h / 2 + 0.5);
      c.shadowBlur = 0;
    }
    c.fillStyle = opt.color || '#ffffff';
    c.fillText(text, w / 2, h / 2 + 0.5);
    var tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    return { tex: tex, w: w, h: h };
  }
  function cssHex(c) { return '#' + ('000000' + c.toString(16)).slice(-6); }
  function rgbArr(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }

  // ===========================================================================
  // 정적 월드
  // ===========================================================================
  function clearStatic() {
    var i;
    for (i = staticGroup.children.length - 1; i >= 0; i--) {
      var m = staticGroup.children[i];
      staticGroup.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material && m.material !== matLit && m.material !== matEmi) {
        if (m.material.map && !m.material.map._keep) m.material.map.dispose();
        m.material.dispose();
      }
    }
    anim.neon.length = 0; anim.blink.length = 0; anim.toxic.length = 0;
  }

  function worldSig() {
    var w = G.world || {}, pl = w.platforms || [], s = (w.groundY || 0) + '|';
    for (var i = 0; i < pl.length; i++) s += pl[i].kind + pl[i].x + ',' + pl[i].y + ',' + pl[i].w + ';';
    return s;
  }

  function rebuild() {
    if (!renderer) return;
    var world = G.world || { groundY: 590, platforms: [] };
    var gy = world.groundY || Math.round((G.height || 720) * 0.82);
    clearStatic();
    var ch = new Chunks();
    // 결정적 배치: 왼쪽 절반 생성 후 x=2100 기준 미러
    buildRoad(ch, gy);
    buildFacades(ch, gy, makeRng(20240611));
    buildMidRow(ch, gy, makeRng(777001));
    buildFarRows(ch, gy, makeRng(990017));
    buildProps(ch, gy, makeRng(5150));
    buildBarricades(ch, gy);
    var plats = world.platforms || [];
    for (var i = 0; i < plats.length; i++) buildPlatform(ch, plats[i], gy);
    // 메쉬화
    for (var k in ch.map) {
      if (!ch.map.hasOwnProperty(k)) continue;
      var a = ch.map[k].lit.toMesh(matLit), b = ch.map[k].emi.toMesh(matEmi);
      if (a) staticGroup.add(a);
      if (b) staticGroup.add(b);
    }
    buildSigns(gy);
    builtGy = gy;
    builtSig = worldSig();
  }

  // 미러 헬퍼: fn(builderGetter, mirrorSign, xmap) 두 번 호출
  function mirrored(fn) {
    fn(function (x) { return x; }, 1);
    fn(function (x) { return WORLD_W - x; }, -1);
  }
  function mbox(b, mx, x0, y0, x1, y1, z0, z1, col, nb) {
    var a = mx(x0), c = mx(x1);
    b.box(Math.min(a, c), y0, Math.max(a, c), y1, z0, z1, col, nb);
  }

  // --- 도로 (타일 단위 색 변화, z-fighting 없음)
  function buildRoad(ch, gy) {
    var r = makeRng(31337);
    var TX = 42, x, zi;
    var rows = [-150, -128, -100, -72, -50, -20, 10, 45, 85, 130, 180, 240, 320, 420, 560];
    // 인도 (뒤, 약간 높음)
    var SW = 5;
    for (x = -900; x < WORLD_W + 900; x += TX) {
      var L = ch.get('road', x).lit;
      var cs = jitter(r, 0x5d5b52, 0.08);
      if (r() < 0.15) cs = jitter(r, C.mossMid, 0.1);
      L.box(x, gy - SW, x + TX, gy, -150, -62, { f: 0x46443d, t: cs }, true);
      // 연석
      L.box(x, gy - SW - 1, x + TX, gy, -64, -58, { f: 0x6a675c, t: 0x7a776a }, true);
    }
    // 차도
    var half = [];
    for (zi = 0; zi < rows.length - 1; zi++) {
      var z0 = rows[zi] < -58 ? -58 : rows[zi], z1 = rows[zi + 1];
      if (z1 <= -58) continue;
      half.push([z0, z1]);
    }
    for (x = -900; x < WORLD_W + 900; x += TX) {
      var Lb = ch.get('road', x).lit;
      for (zi = 0; zi < half.length; zi++) {
        var za = half[zi][0], zb = half[zi][1];
        var col = jitter(r, C.asphalt, 0.07);
        var q = r();
        if (q < 0.06) col = jitter(r, C.mossDk, 0.12);
        else if (q < 0.09) col = 0x2a3446; // 웅덩이(하늘 반사)
        else if (q < 0.16) col = C.asphaltDk;
        else if (q < 0.2) col = C.asphaltHi;
        // 차선 (점선)
        if (za >= 85 && za < 130 && (Math.floor(x / TX) % 3) === 0) col = 0x9a8a4a;
        if (za >= -58 && za < -50) col = 0x6e6a58;
        Lb.flat(x, x + TX, gy, za, zb, col);
      }
      // 균열 + 풀
      if (r() < 0.35) {
        var cx = x + r() * TX, cz = -40 + r() * 140;
        Lb.box(cx, gy - 3 - r() * 5, cx + 3, gy, cz, cz + 3, pick(r, [C.mossMid, C.mossDk, C.moss]), true);
        Lb.box(cx + 4, gy - 2 - r() * 4, cx + 6, gy, cz + 4, cz + 6, pick(r, [C.mossMid, C.mossDk]), true);
      }
    }
  }

  // --- 근경 건물 외벽 (z -260..-150)
  function buildFacades(ch, gy, r) {
    var list = [];
    // 중앙 건물 (대칭)
    var cw = 260;
    list.push({ x: MID - cw / 2, w: cw, h: 420, seed: 4242, type: 'concrete', broken: false, center: true });
    var x = MID - cw / 2;
    while (x > -700) {
      var w = 170 + r() * 200;
      var h = 290 + r() * 270;
      x -= w - 2;
      var b = { x: x, w: w, h: h, seed: Math.floor(r() * 1e9), type: r() < 0.5 ? 'steel' : 'concrete', broken: r() < 0.5, tone: r() };
      b.bc = b.x + b.w * (0.2 + r() * 0.6);
      b.bd = b.broken ? 50 + r() * 150 : 0;
      list.push(b);
    }
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var plats = (G.world && G.world.platforms) || [];
      for (var k = 0; k < plats.length; k++) {
        var p = plats[k];
        if (p.x > MID) continue;
        var dy = gy - p.y;
        if ((p.kind === 'balcony' || p.kind === 'overpass') && f.x < p.x + p.w + 40 && f.x + f.w > p.x - 40) {
          f.h = Math.max(f.h, dy + (p.kind === 'balcony' ? 190 : 130));
          if (p.kind === 'balcony') { f.bd = 0; f.broken = false; }
        }
      }
      if (f.center) { facade(ch, f, gy, function (v) { return v; }); continue; }
      (function (ff) { mirrored(function (mx) { facade(ch, ff, gy, mx); }); })(f);
    }
  }

  function facade(ch, b, gy, mx) {
    var r = makeRng(b.seed);
    var Z0 = -270, Z1 = -150;
    var steel = b.type === 'steel';
    var base = steel ? pick(r, [0x3e4744, 0x34403e, 0x47504a]) : pick(r, [0x6f6a5c, 0x7b7564, 0x625f54, 0x6a5e50]);
    var dark = shade(base, -0.35);
    var cxw = mx(b.x + b.w / 2);
    var B = ch.get('near', cxw);
    var L = B.lit, E = B.emi;
    var sliceW = 14, sx, i;
    function off(xx) { return b.bd ? b.bd * Math.max(0, 1 - Math.abs(xx - b.bc) / (b.w * 0.45)) : 0; }
    // 본체 (슬라이스로 부서진 지붕 실루엣)
    var tops = [];
    for (sx = b.x; sx < b.x + b.w - 0.01; sx += sliceW) {
      var ex = Math.min(b.x + b.w, sx + sliceW);
      var top = gy - b.h + off((sx + ex) / 2) + (b.broken ? r() * 14 : 0);
      tops.push([sx, ex, top]);
      var col = jitter(r, base, 0.04);
      mbox(L, mx, sx, top, ex, gy, Z0, Z1, { f: col, t: shade(col, 0.12), s: shade(col, -0.2) }, true);
      // 지붕 위 이끼
      if (r() < 0.55) mbox(L, mx, sx - 1, top - 3 - r() * 4, ex + 1, top + 2, Z0 + 10, Z1 + 2, { f: pick(r, [C.mossDk, C.mossMid, C.moss]), t: pick(r, [C.mossMid, C.moss, C.mossHi]) }, true);
    }
    // 처마/층 띠 (부서진 구간에서는 끊김)
    var floorH = 64 + Math.floor(r() * 3) * 6;
    for (var fy = gy - 92; fy > gy - b.h + 30; fy -= floorH) {
      var x0 = b.x + 2, x1 = b.x + b.w - 2;
      var bandCol = { f: shade(base, 0.18), t: shade(base, 0.3) };
      for (i = 0; i < tops.length; i++) {
        if (tops[i][2] < fy - 6) mbox(L, mx, Math.max(x0, tops[i][0]), fy, Math.min(x1, tops[i][1]), fy + 4, Z1, Z1 + 4, bandCol, false);
      }
      // 띠 위 이끼
      if (r() < 0.5) {
        var mx0 = x0 + r() * (x1 - x0) * 0.6, mw = 20 + r() * 50;
        if (gy - b.h + off(mx0) > fy - 8 || gy - b.h + off(mx0 + mw) > fy - 8) continue;
        mbox(L, mx, mx0, fy - 3, Math.min(x1, mx0 + mw), fy, Z1, Z1 + 5, { f: C.mossDk, t: pick(r, [C.moss, C.mossMid]) }, true);
        // 늘어진 덩굴
        var vines = 1 + Math.floor(r() * 3);
        for (i = 0; i < vines; i++) {
          var vx = mx0 + r() * mw, vl = 10 + r() * 40;
          mbox(L, mx, vx, fy, vx + 2, fy + vl, Z1 + 3, Z1 + 5, pick(r, [C.mossDk, C.mossMid]), false);
        }
      }
    }
    // 창문
    var cols = Math.max(2, Math.floor((b.w - 24) / 42));
    var gapX = (b.w - cols * 24) / (cols + 1);
    for (var wy = gy - 92 - floorH + 14; wy > gy - b.h + 20; wy -= floorH) {
      for (var cI = 0; cI < cols; cI++) {
        var wx = b.x + gapX + cI * (24 + gapX);
        var wTop = wy, wBot = wy + 32;
        if (wTop < gy - b.h + off(wx + 12) + 8) continue;
        var q = r(), wc;
        // 창틀
        mbox(L, mx, wx - 2, wBot, wx + 26, wBot + 3, Z1, Z1 + 3, shade(base, 0.22), false);
        if (q < 0.1) { wc = pick(r, [0xffc86a, 0xffb04a, 0xffd890]); mbox(E, mx, wx, wTop, wx + 24, wBot, Z1, Z1 + 0.8, wc, true); }
        else if (q < 0.14) { wc = pick(r, [0x58f0c8, 0x8dff3c]); mbox(E, mx, wx, wTop, wx + 24, wBot, Z1, Z1 + 0.8, shade(wc, -0.3), true); }
        else {
          mbox(L, mx, wx, wTop, wx + 24, wBot, Z1, Z1 + 0.8, jitter(r, C.glassDk, 0.2), true);
          if (q > 0.8) mbox(L, mx, wx + 3, wTop + 3, wx + 9, wTop + 12, Z1, Z1 + 1.2, 0x3a4a48, true); // 깨진 유리 반사
          if (q > 0.6 && q < 0.7) mbox(L, mx, wx, wTop + 10, wx + 24, wTop + 12, Z1, Z1 + 1.2, shade(base, -0.1), true); // 판자
        }
        // 녹 흘러내림
        if (r() < 0.3) mbox(L, mx, wx + 8 + r() * 8, wBot + 3, wx + 12 + r() * 8, wBot + 20 + r() * 30, Z1, Z1 + 0.6, pick(r, [C.rust, C.rustDk, 0x8a4a22]), true);
      }
    }
    // 1층 상점: 셔터/출입구/차양
    var sh = 70;
    var sx0 = b.x + 14, sx1 = b.x + b.w - 14;
    var shutterCol = steel ? 0x4a4f4a : pick(r, [0x5a5850, 0x6a4a36, 0x4c5450]);
    var openSh = r();
    mbox(L, mx, sx0, gy - sh, sx1, gy, Z1, Z1 + 1, shade(shutterCol, -0.4), true);
    var shutterBottom = gy - sh + 8 + (openSh < 0.5 ? openSh * 80 : sh - 8);
    for (var ry = gy - sh; ry < shutterBottom - 0.1; ry += 5) {
      mbox(L, mx, sx0 + 2, ry, sx1 - 2, Math.min(shutterBottom, ry + 4), Z1, Z1 + 2, { f: jitter(r, shutterCol, 0.05), t: shade(shutterCol, 0.25) }, true);
    }
    if (r() < 0.6) {
      var rx0 = sx0 + r() * (sx1 - sx0) * 0.6;
      mbox(L, mx, rx0, gy - sh + 4, rx0 + 30 + r() * 30, gy - sh + 30 + r() * 30, Z1, Z1 + 2.2, pick(r, [C.rust, C.rustDk]), true);
    }
    // 차양 (기울어진 판)
    if (r() < 0.65) {
      var acol = pick(r, [0x6e3a28, 0x2e5a50, 0x6a5a30, C.rust]);
      var ay = gy - sh - 6;
      var tilt = (r() - 0.5) * 10;
      L.beam(mx(sx0 - 4), ay + tilt, mx(sx1 + 4), ay - tilt, 5, Z1, Z1 + 26, shade(acol, -0.1));
      L.poly([[mx(sx0 - 4), ay + tilt - 2], [mx(sx1 + 4), ay - tilt - 2], [mx(sx1 + 4), ay - tilt + 3], [mx(sx0 - 4), ay + tilt + 3]], Z1 + 22, Z1 + 26, acol);
    }
    // 간판 띠
    if (r() < 0.6) {
      var sgW = 40 + r() * Math.min(120, b.w - 60);
      var sgx = b.x + 20 + r() * Math.max(1, b.w - 40 - sgW);
      var sgy = gy - sh - 30;
      mbox(L, mx, sgx, sgy, sgx + sgW, sgy + 18, Z1, Z1 + 5, { f: pick(r, [0x3a2a1e, 0x2e3433, 0x4a3a28]), t: 0x5a4a38 }, false);
      if (r() < 0.45) {
        var nc = pick(r, [0xff5a3c, 0x58f0c8, 0xffb04a, 0x8dff3c, 0xff4fa0]);
        var nb = new Builder();
        nb.box(Math.min(mx(sgx + 4), mx(sgx + sgW - 4)), sgy + 6, Math.max(mx(sgx + 4), mx(sgx + sgW - 4)), sgy + 10, Z1 + 5, Z1 + 6, 0xffffff, true);
        addNeonMesh(nb, nc, r() * 10, 0.3 + r() * 0.5);
      }
    }
    // 녹슨 배관 / 실외기
    if (r() < 0.6) {
      var px = b.x + 10 + r() * (b.w - 20);
      var ptop = gy - b.h + off(px) + 20;
      mbox(L, mx, px, ptop, px + 5, gy - 4, Z1, Z1 + 6, { f: pick(r, [C.rust, 0x8a4a22, C.steelHi]), s: C.rustDk }, false);
    }
    for (i = 0; i < 2; i++) {
      if (r() < 0.45) {
        var ax = b.x + 20 + r() * (b.w - 60), ayy = gy - 140 - r() * (b.h - 200);
        if (ayy < gy - b.h + off(ax) + 20) continue;
        mbox(L, mx, ax, ayy, ax + 26, ayy + 18, Z1, Z1 + 14, { f: 0x8a8a7c, t: 0xa0a090, s: 0x5a5a50 }, false);
        mbox(L, mx, ax + 4, ayy + 4, ax + 22, ayy + 14, Z1 + 14, Z1 + 14.5, 0x2a2c2a, true);
      }
    }
    // 부서진 지붕 철근
    if (b.bd) {
      for (i = 0; i < 6; i++) {
        var rbx = b.bc + (r() - 0.5) * b.w * 0.7;
        var rtop = gy - b.h + off(rbx);
        L.beam(mx(rbx), rtop + 6, mx(rbx + (r() - 0.5) * 16), rtop - 10 - r() * 20, 2, Z1 - 20, Z1 - 18, C.rust);
      }
    } else if (!b.center && r() < 0.5) {
      // 물탱크 / 안테나
      var tx = b.x + 20 + r() * (b.w - 70), tTop = gy - b.h;
      mbox(L, mx, tx, tTop - 34, tx + 40, tTop - 6, Z0 + 30, Z0 + 70, { f: pick(r, [C.rust, 0x7a6a50, C.steelHi]), t: 0x8a5a30 }, true);
      mbox(L, mx, tx + 4, tTop - 6, tx + 8, tTop, Z0 + 40, Z0 + 44, C.steelDk, true);
      mbox(L, mx, tx + 32, tTop - 6, tx + 36, tTop, Z0 + 40, Z0 + 44, C.steelDk, true);
    }
    if (r() < 0.4 && !b.bd) {
      var antx = b.x + b.w * (0.3 + r() * 0.4), anTop = gy - b.h;
      mbox(L, mx, antx, anTop - 60, antx + 2, anTop, Z0 + 60, Z0 + 62, C.steelDk, true);
      var bl = new Builder();
      bl.box(Math.min(mx(antx - 1), mx(antx + 3)), anTop - 63, Math.max(mx(antx - 1), mx(antx + 3)), anTop - 59, Z0 + 59, Z0 + 63, 0xffffff, false);
      addBlinkMesh(bl, 0xff3a2a, r() * 3);
    }
    // 아이비 (바닥에서 위로 구불구불)
    if (r() < 0.6) ivyAt(L, mx(b.x + r() * b.w), gy, 60 + r() * 150, Z1 + 1, r);
  }

  // 덩굴: 구불구불한 줄기 + 잎 뭉치 (z 평면 앞쪽에 얇게)
  function ivyAt(L, x, baseY, height, z, r) {
    var sx = x, y = baseY, leafCols = [C.mossDk, C.mossMid, 0x3b5520, C.moss, 0x6f8f3a];
    while (y > baseY - height) {
      var ny = y - 8 - r() * 6, nx = sx + (r() - 0.5) * 8;
      L.beam(sx, y, nx, ny, 2, z, z + 1.5, 0x3a4a20);
      var k = 1 + Math.floor(r() * 3), t = 1 - (baseY - y) / height;
      for (var i = 0; i < k; i++) {
        var lx = nx + (r() - 0.5) * (10 + 14 * t), ly = ny + (r() - 0.5) * 8, ls = 3 + r() * 4;
        L.box(lx - ls / 2, ly - ls / 2, lx + ls / 2, ly + ls / 2, z, z + 1.5 + r() * 2.5, { f: pick(r, leafCols), t: C.mossHi }, true);
      }
      sx = nx; y = ny;
    }
  }

  // --- 중경 건물 열 (z -700..-520)
  function buildMidRow(ch, gy, r) {
    var x = MID + 80, list = [];
    while (x > -1600) {
      var w = 140 + r() * 220, h = 360 + r() * 380;
      x -= w + r() * 30;
      list.push({ x: x, w: w, h: h, seed: Math.floor(r() * 1e9), bd: r() < 0.55 ? 60 + r() * 220 : 0, bc: x + w * (0.2 + r() * 0.6) });
    }
    for (var i = 0; i < list.length; i++) {
      (function (b) {
        mirrored(function (mx) { blockBuilding(ch, 'mid', b, gy, mx, -720, -540, 0.1); });
      })(list[i]);
    }
  }

  // --- 원경 (z -1500, -2600)
  function buildFarRows(ch, gy, r) {
    var rows = [
      { z0: -1650, z1: -1450, from: -3600, hMin: 420, hMax: 900, wMin: 120, wMax: 260, lit: 0.06 },
      { z0: -2900, z1: -2600, from: -6400, hMin: 700, hMax: 1500, wMin: 200, wMax: 420, lit: 0.03 }
    ];
    for (var k = 0; k < rows.length; k++) {
      var row = rows[k], x = MID + 60, list = [];
      while (x > row.from) {
        var w = row.wMin + r() * (row.wMax - row.wMin), h = row.hMin + r() * (row.hMax - row.hMin);
        x -= w + r() * 60;
        list.push({ x: x, w: w, h: h, seed: Math.floor(r() * 1e9), bd: r() < 0.5 ? 80 + r() * 300 : 0, bc: x + w * (0.2 + r() * 0.6), crane: r() < 0.08 });
      }
      for (var i = 0; i < list.length; i++) {
        (function (b, rw) {
          mirrored(function (mx) { blockBuilding(ch, 'far' + k, b, gy, mx, rw.z0, rw.z1, rw.lit); });
        })(list[i], row);
      }
    }
  }

  function blockBuilding(ch, layer, b, gy, mx, Z0, Z1, litP) {
    var r = makeRng(b.seed);
    var far = Z1 < -1000;
    var base = far ? pick(r, [0x3a3236, 0x2e2c32, 0x403438]) : pick(r, [0x4a4440, 0x3e4240, 0x564a40, 0x45403c]);
    var B = ch.get(layer, mx(b.x + b.w / 2));
    var L = B.lit, E = B.emi;
    var sw = far ? 30 : 20, sx;
    function off(xx) { return b.bd ? b.bd * Math.max(0, 1 - Math.abs(xx - b.bc) / (b.w * 0.45)) : 0; }
    for (sx = b.x; sx < b.x + b.w - 0.01; sx += sw) {
      var ex = Math.min(b.x + b.w, sx + sw);
      var top = gy - b.h + off((sx + ex) / 2) + (b.bd ? r() * 24 : 0);
      var col = jitter(r, base, 0.05);
      mbox(L, mx, sx, top, ex, gy, Z0, Z1, { f: col, t: shade(col, 0.1), s: shade(col, -0.25) }, true);
      if (!far && r() < 0.3) mbox(L, mx, sx, top - 4, ex, top + 2, Z0 + 20, Z1 + 2, { f: C.mossDk, t: C.mossMid }, true);
    }
    // 층 띠 + 창문 (발광 일부)
    var fh = far ? 46 : 52;
    var cols = Math.max(1, Math.floor(b.w / (far ? 34 : 30)));
    var gx = b.w / cols;
    for (var wy = gy - 60; wy > gy - b.h + 20; wy -= fh) {
      if (!far) mbox(L, mx, b.x, wy + 22, b.x + b.w, wy + 25, Z1, Z1 + 2, shade(base, 0.15), true);
      for (var c = 0; c < cols; c++) {
        var wx = b.x + c * gx + gx * 0.25, ww = gx * 0.5;
        if (wy < gy - b.h + off(wx) + 14) continue;
        var q = r();
        if (q < litP) {
          mbox(E, mx, wx, wy, wx + ww, wy + 18, Z1, Z1 + 1, pick(r, [0xffb04a, 0xffc070, 0xe07a35, 0x58f0c8]), true);
        } else if (q < 0.7) {
          mbox(L, mx, wx, wy, wx + ww, wy + 18, Z1, Z1 + 1, shade(base, -0.45), true);
        }
      }
    }
    if (b.crane) {
      var cx = b.x + b.w / 2, ctop = gy - b.h - 260;
      mbox(L, mx, cx, ctop, cx + 10, gy - b.h, Z0 + 80, Z0 + 90, C.rustDk, true);
      mbox(L, mx, cx - 160, ctop, cx + 90, ctop + 8, Z0 + 80, Z0 + 90, C.rustDk, true);
      mbox(L, mx, cx - 130, ctop + 8, cx - 128, ctop + 90, Z0 + 84, Z0 + 86, C.steelDk, true);
      var bl = new Builder();
      bl.box(Math.min(mx(cx - 2), mx(cx + 12)), ctop - 10, Math.max(mx(cx - 2), mx(cx + 12)), ctop - 2, Z0 + 80, Z0 + 92, 0xffffff, false);
      addBlinkMesh(bl, 0xff3a2a, b.seed % 7);
    }
  }

  // --- 발광 메쉬 (애니메이션용 개별 재질)
  function addNeonMesh(builder, color, phase, flick) {
    var mat = new THREE.MeshBasicMaterial({ color: color, fog: true });
    var m = builder.toMesh(mat);
    if (!m) return;
    staticGroup.add(m);
    anim.neon.push({ mat: mat, base: new THREE.Color(color), phase: phase, flick: flick || 0 });
  }
  function addBlinkMesh(builder, color, phase) {
    var mat = new THREE.MeshBasicMaterial({ color: color, fog: true });
    var m = builder.toMesh(mat);
    if (!m) return;
    staticGroup.add(m);
    anim.blink.push({ mat: mat, base: new THREE.Color(color), phase: phase });
  }

  // --- 지면 소품 (인도 위 z -140..-70 / 앞쪽 z +60..+120 작은 것만)
  function buildProps(ch, gy, r) {
    var plats = (G.world && G.world.platforms) || [];
    function blocked(x, pad) {
      for (var i = 0; i < plats.length; i++) if (x > plats[i].x - pad && x < plats[i].x + plats[i].w + pad) return true;
      return x < 130 + pad || x > WORLD_W - 130 - pad;
    }
    var kinds = ['barrel', 'barrel', 'rubble', 'rubble', 'tires', 'barrier', 'lamp', 'cone', 'shrub', 'shrub', 'wreck', 'toxic'];
    var x = 150, list = [];
    while (x < MID - 60) {
      var kind = pick(r, kinds);
      if (kind === 'wreck' && (blocked(x, 80) || x > MID - 200)) kind = 'rubble';
      list.push({ kind: kind, x: x, seed: Math.floor(r() * 1e9), s: 0.85 + r() * 0.3, back: kind === 'lamp' || kind === 'wreck' || r() < 0.75 });
      x += kind === 'wreck' ? 220 + r() * 120 : 70 + r() * 150;
    }
    list.push({ kind: 'trafficlight', x: 700, seed: 777, s: 1, back: true });
    for (var i = 0; i < list.length; i++) {
      (function (pr) { mirrored(function (mx, sgn) { prop(ch, pr, gy, mx, sgn); }); })(list[i]);
    }
  }

  function prop(ch, pr, gy, mx, sgn) {
    var r = makeRng(pr.seed);
    var cx = mx(pr.x), s = pr.s;
    var B = ch.get('props', cx), L = B.lit, E = B.emi;
    var zc = pr.back ? -100 - r() * 30 : 70 + r() * 40;
    var by = pr.back ? gy - 5 : gy;
    var i;
    switch (pr.kind) {
      case 'barrel':
      case 'toxic': {
        var n = 1 + Math.floor(r() * 3);
        for (i = 0; i < n; i++) {
          var bx = cx + (i - (n - 1) / 2) * 26 * s, bz = zc + (r() - 0.5) * 16;
          var col = pr.kind === 'toxic' ? 0x4a5a3a : pick(r, [0x7a4426, 0x5d4a2e, C.rust, 0x8a5a26]);
          L.drum(bx, by, bz, 11 * s, 34 * s, col, shade(col, 0.15), 8);
          L.drum(bx, by - 12 * s, bz, 11.6 * s, 3, shade(col, -0.35), shade(col, -0.2), 8);
          L.drum(bx, by - 24 * s, bz, 11.6 * s, 3, shade(col, -0.35), shade(col, -0.2), 8);
          if (pr.kind === 'toxic') {
            var tb = new Builder();
            tb.drum(bx, by - 34 * s + 0.5, bz, 9 * s, 1, 0xffffff, 0xffffff, 8);
            tb.flat(bx - 10, bx + 30, by - 0.3, bz - 6, bz + 10, 0xffffff);
            addNeonMesh(tb, C.toxic, r() * 6, 0);
            anim.toxic.push(anim.neon[anim.neon.length - 1]);
          }
        }
        break;
      }
      case 'rubble': {
        var m = 4 + Math.floor(r() * 5);
        for (i = 0; i < m; i++) {
          var rx = cx + (r() - 0.5) * 60 * s, rz = zc + (r() - 0.5) * 30, rw = 6 + r() * 16 * s, rh = 4 + r() * 12 * s;
          L.box(rx - rw / 2, by - rh, rx + rw / 2, by, rz - rw / 2, rz + rw / 2, { f: jitter(r, C.concreteDk, 0.15), t: jitter(r, C.concrete, 0.1) }, true);
        }
        if (r() < 0.6) L.box(cx - 8, by - 4, cx + 10, by, zc - 4, zc + 8, { f: C.mossDk, t: C.mossMid }, true);
        if (r() < 0.5) L.beam(cx - 20, by - 3, cx + 16, by - 18, 2, zc, zc + 2, C.rust);
        break;
      }
      case 'tires': {
        var t = 2 + Math.floor(r() * 3);
        for (i = 0; i < t; i++) L.drum(cx + (r() - 0.5) * 4, by - i * 9, zc, 14 * s, 9, 0x1c1c1a, 0x2a2a26, 8);
        break;
      }
      case 'barrier': {
        L.poly([[cx - 30, by], [cx + 30, by], [cx + 22, by - 10], [cx + 10, by - 30], [cx - 10, by - 30], [cx - 22, by - 10]], zc - 10, zc + 10, jitter(r, 0x8a877a, 0.06), 0x6a675c);
        for (i = 0; i < 3; i++) L.face(cx - 24 + i * 18, by - 22, cx - 16 + i * 18, by - 14, zc + 10.5, i % 2 ? 0xd8c040 : 0x1a1a18);
        break;
      }
      case 'cone': {
        L.poly([[cx - 8, by], [cx + 8, by], [cx + 2, by - 22], [cx - 2, by - 22]], zc - 6, zc + 6, 0xe0602a);
        L.box(cx - 10, by - 3, cx + 10, by, zc - 9, zc + 9, 0xc0501f, true);
        L.face(cx - 5, by - 14, cx + 5, by - 10, zc + 6.5, 0xe8e0c0);
        break;
      }
      case 'shrub': {
        var sc = [C.mossDk, C.mossMid, 0x3b5520, C.moss];
        for (i = 0; i < 6; i++) {
          var ox = (r() - 0.5) * 40 * s, oh = 10 + r() * 22 * s, ow = 10 + r() * 14;
          L.box(cx + ox - ow / 2, by - oh, cx + ox + ow / 2, by, zc - 8 + r() * 6, zc + 8 + r() * 6, { f: pick(r, sc), t: pick(r, [C.moss, C.mossHi, C.mossMid]) }, true);
        }
        break;
      }
      case 'lamp': {
        var lz = -96, lh = 210;
        L.box(cx - 3, by - lh, cx + 3, by, lz - 3, lz + 3, { f: C.steel, s: C.steelDk }, true);
        L.box(cx - 6, by - 14, cx + 6, by, lz - 6, lz + 6, C.steelDk, true);
        var dir = (cx < MID ? 1 : -1);
        L.box(Math.min(cx, cx + dir * 40), by - lh, Math.max(cx, cx + dir * 40), by - lh + 4, lz - 3, lz + 3, C.steel, false);
        L.box(Math.min(cx + dir * 30, cx + dir * 48), by - lh + 2, Math.max(cx + dir * 30, cx + dir * 48), by - lh + 8, lz - 6, lz + 6, C.steelDk, false);
        if (r() < 0.6) {
          var lb = new Builder();
          lb.box(Math.min(cx + dir * 32, cx + dir * 46), by - lh + 8, Math.max(cx + dir * 32, cx + dir * 46), by - lh + 10, lz - 4, lz + 4, 0xffffff, false);
          addNeonMesh(lb, 0xffd890, r() * 10, 0.6);
        }
        // 기둥 녹 + 덩굴
        L.box(cx - 3.5, by - 60 - r() * 40, cx + 3.5, by - 20, lz + 3, lz + 3.6, C.rust, true);
        break;
      }
      case 'wreck': {
        var wz0 = -150, wz1 = -80, col2 = pick(r, [0x4d5f66, 0x6e4a3c, 0x7d7660, 0x56604a]);
        L.box(cx - 70, by - 40, cx + 70, by - 12, wz0, wz1, { f: col2, t: shade(col2, 0.12), s: shade(col2, -0.25) }, false);
        L.poly([[cx - 42, by - 40], [cx - 26, by - 62], [cx + 28, by - 62], [cx + 46, by - 40]], wz0 + 6, wz1 - 6, shade(col2, -0.05), shade(col2, 0.1));
        L.face(cx - 34, by - 58, cx - 2, by - 42, wz1 - 5.5, C.glassDk);
        L.face(cx + 4, by - 58, cx + 34, by - 42, wz1 - 5.5, C.glassDk);
        L.wheel(cx - 44, by - 12, 12, wz1 - 10, wz1 + 1, 0x1a1a17);
        L.wheel(cx + 44, by - 12, 12, wz1 - 10, wz1 + 1, 0x1a1a17);
        L.face(cx - 40, by - 34, cx - 10, by - 22, wz1 + 0.6, C.rust);
        L.box(cx - 30, by - 66, cx + 20, by - 62, wz0 + 10, wz1 - 10, { f: C.mossDk, t: C.mossMid }, true);
        break;
      }
      case 'trafficlight': {
        var tz = -98, th = 220, d2 = sgn;
        L.box(cx - 3, by - th, cx + 3, by, tz - 3, tz + 3, { f: C.steel, s: C.steelDk }, true);
        L.box(Math.min(cx, cx + d2 * 90), by - th, Math.max(cx, cx + d2 * 90), by - th + 5, tz - 3, tz + 3, C.steel, false);
        var hx = cx + d2 * 70;
        L.box(hx - 22, by - th + 5, hx + 22, by - th + 21, tz - 6, tz + 6, { f: 0x22261f, s: 0x181a16 }, false);
        var lb2 = new Builder();
        lb2.box(hx - 18, by - th + 9, hx - 8, by - th + 17, tz + 6, tz + 7, 0xffffff, true);
        addBlinkMesh(lb2, 0xff5a3c, pr.seed % 5);
        L.face(hx - 5, by - th + 9, hx + 5, by - th + 17, tz + 6.5, 0x3a3a20);
        L.face(hx + 8, by - th + 9, hx + 18, by - th + 17, tz + 6.5, 0x203a30);
        L.box(cx - 4, by - 80, cx + 4, by - 40, tz + 3, tz + 6, { f: C.mossDk, t: C.mossMid }, true);
        break;
      }
    }
  }

  // --- 맵 끝 바리케이드 (x=0, x=4200)
  function buildBarricades(ch, gy) {
    mirrored(function (mx, sgn) {
      var r = makeRng(8800);
      var B = ch.get('wall', mx(-50)), L = B.lit, E = B.emi;
      // 컨테이너 더미 (벽면은 x=0, 깊이 z -500..+300)
      var stack = [
        { z0: -520, z1: -300, h0: 0, h1: 120, col: C.rust },
        { z0: -300, z1: -60, h0: 0, h1: 130, col: 0x3e5a54 },
        { z0: -60, z1: 200, h0: 0, h1: 120, col: 0x7a4a2a },
        { z0: -420, z1: -180, h0: 120, h1: 240, col: 0x5a5a50 },
        { z0: -180, z1: 80, h0: 130, h1: 250, col: C.rust },
        { z0: -300, z1: -60, h0: 250, h1: 370, col: 0x46504a }
      ];
      for (var i = 0; i < stack.length; i++) {
        var s = stack[i];
        var X0 = -260, X1 = 0;
        var col = s.col;
        mbox(L, mx, X0, gy - s.h1, X1, gy - s.h0, s.z0, s.z1, { f: shade(col, -0.2), t: shade(col, 0.1), s: col }, false);
        // 골판 리브 (벽면 쪽 세로줄)
        for (var z = s.z0 + 10; z < s.z1 - 6; z += 16) {
          var side = sgn > 0 ? 1 : -1;
          L.side(mx(0) + side * 0.8, gy - s.h1 + 6, gy - s.h0 - 6, z, z + 6, shade(col, (z / 16) % 2 ? -0.18 : 0.12), side);
        }
        // 녹 / 이끼
        L.side(mx(0) + sgn * 1.2, gy - s.h1 + 10 + r() * 30, gy - s.h0 - 10, s.z0 + 30 + r() * 60, s.z0 + 60 + r() * 80, C.rustDk, sgn);
        mbox(L, mx, -260, gy - s.h1 - 4, 2, gy - s.h1, s.z0 + 20, s.z0 + 40 + r() * 100, { f: C.mossDk, t: pick(r, [C.moss, C.mossMid]) }, true);
      }
      // 위험 줄무늬 띠
      for (var zz = -500; zz < 300; zz += 24) {
        L.side(mx(0) + sgn * 1.6, gy - 70, gy - 52, zz, zz + 12, 0xd8b030, sgn);
        L.side(mx(0) + sgn * 1.6, gy - 70, gy - 52, zz + 12, zz + 24, 0x1c1c1a, sgn);
      }
      // 철조망 기둥
      for (var bz = -480; bz < 260; bz += 70) {
        mbox(L, mx, -10, gy - 400, -6, gy - 250, bz, bz + 4, C.steelDk, true);
      }
      // 경고등
      var wb = new Builder();
      wb.box(Math.min(mx(-4), mx(4)), gy - 140, Math.max(mx(-4), mx(4)), gy - 132, -40, -30, 0xffffff, false);
      addBlinkMesh(wb, 0xff7a2a, sgn > 0 ? 0 : 1.3);
      void E;
      // 바깥 폐허 (벽 너머)
      for (var k = 0; k < 6; k++) {
        var bx = -300 - k * 160 - r() * 60, bw2 = 100 + r() * 120, bh2 = 250 + r() * 300;
        mbox(L, mx, bx - bw2, gy - bh2, bx, gy, -520, -320, { f: jitter(r, 0x4a4440, 0.06), t: 0x5a5048 }, true);
      }
    });
  }

  // --- 발판 소품 (윗면 = p.y 정확히, z -60..+40)
  function buildPlatform(ch, p, gy) {
    var r = makeRng((p.seed || Math.floor(p.x * 7 + p.w)) + 1);
    var B = ch.get('plat', p.x + p.w / 2), L = B.lit, E = B.emi;
    var x0 = p.x, x1 = p.x + p.w, y = p.y, i;
    var side = p.side != null ? p.side : (p.x + p.w / 2 < MID - 50 ? -1 : (p.x + p.w / 2 > MID + 50 ? 1 : 0));
    var ZF = 40, ZB = -60;
    switch (p.kind) {
      case 'car': {
        var col = pick(r, [0x4d5f66, 0x6e4a3c, 0x7d7660]);
        var bx0 = x0 - 34, bx1 = x1 + 34, bodyTop = gy - 58;
        // 바퀴
        L.wheel(bx0 + 40, gy - 13, 14, ZF - 14, ZF + 1, 0x161614);
        L.wheel(bx1 - 40, gy - 13, 14, ZF - 14, ZF + 1, 0x161614);
        L.wheel(bx0 + 40, gy - 13, 6, ZF + 1, ZF + 2, 0x6a4024);
        L.wheel(bx1 - 40, gy - 13, 6, ZF + 1, ZF + 2, 0x6a4024);
        // 차체 하부 (앞뒤 사선)
        L.poly([[bx0 + 4, bodyTop], [bx1 - 4, bodyTop], [bx1, bodyTop + 12], [bx1, gy - 20], [bx1 - 8, gy - 14], [bx0 + 8, gy - 14], [bx0, gy - 20], [bx0, bodyTop + 12]], ZB + 4, ZF - 2, col, shade(col, -0.15));
        L.box(bx0 + 2, bodyTop - 0.01, bx1 - 2, bodyTop + 1, ZB + 4, ZF - 2, { f: shade(col, 0.1), t: shade(col, 0.15) }, true);
        // 캐빈 (윗면 = y)
        L.poly([[bx0 + 22, bodyTop], [x0, y], [x1, y], [bx1 - 22, bodyTop]], ZB + 8, ZF - 6, shade(col, 0.05), shade(col, -0.1));
        // 지붕 윗면 보강 (정확한 y에서 z -60..+40 전체)
        L.box(x0, y, x1, y + 4, ZB, ZF, { f: shade(col, -0.05), t: shade(col, 0.2) }, false);
        // 창문
        var midx = (x0 + x1) / 2;
        L.poly([[bx0 + 32, bodyTop - 2], [x0 + 6, y + 8], [midx - 4, y + 8], [midx - 4, bodyTop - 2]], ZF - 6, ZF - 5.4, C.glassDk);
        L.poly([[midx + 4, bodyTop - 2], [midx + 4, y + 8], [x1 - 6, y + 8], [bx1 - 32, bodyTop - 2]], ZF - 6, ZF - 5.4, C.glassDk);
        L.poly([[x0 + 10, y + 10], [x0 + 30, y + 10], [x0 + 14, y + 26]], ZF - 5.4, ZF - 5, 0x6a8a84);
        // 녹 + 이끼
        L.face(bx0 + 14, bodyTop + 10, bx0 + 54, bodyTop + 26, ZF - 1.4, mix(col, C.rust, 0.55));
        L.face(bx1 - 70, bodyTop + 8, bx1 - 30, bodyTop + 20, ZF - 1.4, mix(col, C.rustDk, 0.5));
        L.face(midx - 1, bodyTop + 2, midx + 1, gy - 16, ZF - 1.4, 0x1a1614);
        L.box(bx0 - 4, gy - 32, bx0 + 6, gy - 22, ZB + 10, ZF, C.steelDk, false);
        L.box(bx1 - 6, gy - 32, bx1 + 4, gy - 22, ZB + 10, ZF, C.steelDk, false);
        for (i = 0; i < 3; i++) {
          var mxx = x0 + 10 + r() * (p.w - 40);
          L.box(mxx, y - 3, mxx + 14 + r() * 20, y, ZB + 4 + r() * 40, ZB + 50 + r() * 40, { f: C.mossDk, t: pick(r, [C.moss, C.mossMid]) }, true);
        }
        var hb = new Builder();
        hb.box(bx0 - 1, bodyTop + 6, bx0 + 3, bodyTop + 12, ZF - 18, ZF - 6, 0xffffff, false);
        addNeonMesh(hb, 0xb0a070, 3, 0.2);
        break;
      }
      case 'bus': {
        var bcol = 0x7d6a3a;
        var X0 = x0 - 8, X1 = x1 + 8;
        var wheels = [X0 + 52, (X0 + X1) / 2, X1 - 52];
        for (i = 0; i < 3; i++) { L.wheel(wheels[i], gy - 14, 15, ZF - 14, ZF + 1, 0x161614); L.wheel(wheels[i], gy - 14, 6, ZF + 1, ZF + 2, 0x6a4024); }
        // 본체 (윗면 = y)
        L.box(X0, y, X1, gy - 16, ZB, ZF, { f: bcol, t: 0x8d7a46, s: 0x5a4a28, b: 0x2a2416 }, false);
        // 하부 어두운 띠 + 청록 띠
        L.face(X0, gy - 40, X1, gy - 16, ZF + 0.6, 0x3a3020);
        L.face(X0, y + 58, X1, y + 66, ZF + 0.6, 0x2e5a50);
        // 창문 줄
        for (var wx = X0 + 16; wx < X1 - 50; wx += 46) {
          var q = r();
          if (q < 0.2) L.face(wx, y + 14, wx + 36, y + 50, ZF + 0.6, 0x1c2624);
          else {
            L.face(wx, y + 14, wx + 36, y + 50, ZF + 0.6, C.glassDk);
            if (q > 0.7) L.poly([[wx + 4, y + 16], [wx + 18, y + 16], [wx + 6, y + 34]], ZF + 0.6, ZF + 1, 0x5a7a74);
          }
        }
        var frontX = side > 0 ? X0 + 12 : X1 - 40;
        L.face(frontX, y + 12, frontX + 28, y + 58, ZF + 1, 0x0e1210);
        // 행선판 (발광)
        var db = new Builder();
        var dX = side > 0 ? X1 - 84 : X0 + 14;
        db.face(dX, y + 74, dX + 70, y + 88, ZF + 0.8, 0xffffff);
        addNeonMesh(db, 0xc06a2a, 1.7, 0.4);
        // 문
        var dx = X0 + (X1 - X0) * 0.62;
        L.face(dx, y + 70, dx + 30, gy - 18, ZF + 0.8, 0x1a1d1a);
        // 녹
        for (i = 0; i < 9; i++) {
          var rx = X0 + r() * (X1 - X0 - 30), ry = y + 20 + r() * (gy - y - 50);
          L.face(rx, ry, rx + 10 + r() * 24, ry + 6 + r() * 12, ZF + 1.2, mix(bcol, pick(r, [C.rust, C.rustDk, 0x8a4a22]), 0.4 + r() * 0.3));
        }
        // 지붕 수풀
        for (i = 0; i < 5; i++) {
          var sx = x0 + 10 + r() * (p.w - 40), sw = 10 + r() * 24;
          L.box(sx, y - 4 - r() * 8, sx + sw, y, ZB + 6 + r() * 30, ZB + 50 + r() * 40, { f: C.mossDk, t: pick(r, [C.moss, C.mossMid, C.mossHi]) }, true);
        }
        // 지붕 환기구
        L.box(x0 + p.w * 0.3, y - 8, x0 + p.w * 0.3 + 40, y, ZB + 20, ZB + 60, { f: 0x5a4a30, t: 0x6a5a38 }, true);
        // 덩굴 (옆면 타고)
        for (i = 0; i < 3; i++) ivyAt(L, X0 + 10 + r() * (X1 - X0 - 20), gy - 16, 30 + r() * 60, ZF + 1.2, r);
        break;
      }
      case 'balcony': {
        // 뒤 건물 벽 (발코니가 붙어 있는 곳)
        var wcol = pick(r, [0x7a5a48, 0x6e5446, 0x806050]);
        var WX0 = x0 - 46, WX1 = x1 + 46, WT = y - 150;
        L.box(WX0, WT, WX1, gy, -150, -62, { f: wcol, t: shade(wcol, 0.15), s: shade(wcol, -0.25) }, true);
        // 벽돌 줄눈 느낌의 색 띠 + 처마
        for (var by3 = WT + 14; by3 < gy - 6; by3 += 9) {
          var bxs = WX0 + ((by3 / 9) % 2 ? 0 : 12);
          for (var bx3 = bxs; bx3 < WX1 - 4; bx3 += 24) if (r() < 0.35) L.face(Math.max(WX0, bx3), by3, Math.min(WX1, bx3 + 22), by3 + 7, -61.7, jitter(r, wcol, 0.12));
        }
        L.box(WX0 - 4, WT - 6, WX1 + 4, WT + 4, -154, -56, { f: shade(wcol, 0.2), t: shade(wcol, 0.3) }, false);
        L.box(WX0 - 2, WT - 10, WX0 + (WX1 - WX0) * 0.55, WT - 6, -150, -60, { f: C.mossDk, t: C.moss }, true);
        for (i = 0; i < 5; i++) { var hv = WX0 + r() * (WX1 - WX0) * 0.55; L.box(hv, WT + 4, hv + 2.5, WT + 14 + r() * 40, -58, -56, pick(r, [C.mossDk, C.mossMid]), false); }
        // 출입구
        var dX2 = x0 + p.w * (side < 0 ? 0.55 : 0.2);
        L.box(dX2 - 5, y - 86, dX2 + 55, y, -62, -57, { f: 0x5a5a50, t: 0x6a6a5e }, true);
        L.face(dX2, y - 80, dX2 + 50, y, -56.5, 0x101412);
        L.beam(dX2 + 50, y - 80, dX2 + 62, y - 2, 5, -56, -50, 0x5a4a36);
        var lb = new Builder();
        lb.face(dX2 + 6, y - 30, dX2 + 22, y - 6, -56.2, 0xffffff);
        addNeonMesh(lb, 0x8a5a2a, 2.2, 0.5);
        // 아래층 창문 (틀 + 창턱)
        var nW = Math.max(2, Math.floor((WX1 - WX0) / 70));
        for (i = 0; i < nW; i++) {
          var wx2 = WX0 + 20 + i * ((WX1 - WX0 - 40 - 28) / Math.max(1, nW - 1));
          for (var fl = 0; fl < 2; fl++) {
            var wy2 = y + 44 + fl * 74;
            if (wy2 + 34 > gy - 20) continue;
            L.box(wx2 - 3, wy2 - 3, wx2 + 31, wy2 + 37, -62, -60, shade(wcol, 0.25), true);
            var lit = r() < 0.2;
            if (lit) { var wb2 = new Builder(); wb2.face(wx2, wy2, wx2 + 28, wy2 + 34, -59.5, 0xffffff); addNeonMesh(wb2, 0xffc070, r() * 9, 0.15); }
            else L.face(wx2, wy2, wx2 + 28, wy2 + 34, -59.5, jitter(r, C.glassDk, 0.25));
            L.face(wx2 + 13, wy2, wx2 + 15, wy2 + 34, -59.2, shade(wcol, 0.15));
            L.box(wx2 - 5, wy2 + 34, wx2 + 33, wy2 + 38, -62, -55, { f: shade(wcol, 0.3), t: shade(wcol, 0.4) }, false);
            if (r() < 0.5) L.face(wx2 + 6, wy2 + 38, wx2 + 10, wy2 + 60, -61.6, C.rustDk);
          }
        }
        // 실외기
        L.box(WX1 - 44, y + 22, WX1 - 14, y + 42, -62, -46, { f: 0x8a8a7c, t: 0xa0a090, s: 0x5a5a50 }, false);
        L.face(WX1 - 40, y + 25, WX1 - 18, y + 39, -45.6, 0x2a2c2a);
        // 슬래브 (윗면 = y)
        L.box(x0, y, x1, y + 12, ZB, ZF, { f: 0x77776b, t: 0x8a897a, s: 0x5a5a50, b: 0x4a4a42 }, false);
        L.poly([[x0 + 10, y + 12], [x1 - 30, y + 12], [x1 - 14, y + 16]], ZF - 10, ZF, 0x5a5a50);
        // 받침 브래킷
        L.beam(x0 + 16, y + 12, x0 + 4, y + 60, 5, ZB + 2, ZB + 10, C.rustDk);
        L.beam(x1 - 16, y + 12, x1 - 4, y + 60, 5, ZB + 2, ZB + 10, C.rustDk);
        L.face(x0 + 40, y + 12.5, x0 + 52, y + 60, ZF + 0.5, C.rust);
        // 뒤 + 옆 난간 (플레이어를 가리지 않게)
        L.box(x0 + 2, y - 32, x1 - 2, y - 28, ZB + 4, ZB + 8, C.rust, false);
        for (var rx2 = x0 + 6; rx2 < x1 - 4; rx2 += 16) L.box(rx2, y - 30, rx2 + 2.5, y, ZB + 4, ZB + 8, C.rustDk, true);
        var ex = side > 0 ? x0 : x1;
        L.box(ex - 2, y - 30, ex + 2, y - 26, ZB + 4, ZF - 2, C.rust, false);
        L.box(ex - 2, y - 30, ex + 2, y, ZF - 6, ZF - 2, C.rustDk, true);
        // 화분 + 이끼
        L.box(x0 + 8, y - 14, x0 + 26, y, ZB + 10, ZB + 26, { f: 0x8a4a2a, t: 0x3b5520 }, true);
        L.box(x0 + 6, y - 24, x0 + 28, y - 14, ZB + 8, ZB + 28, { f: C.mossMid, t: C.moss }, true);
        L.box(x0, y + 12, x0 + p.w * 0.6, y + 15, ZF - 3, ZF + 1, C.mossDk, true);
        for (i = 0; i < 4; i++) {
          var vx = x0 + 10 + r() * (p.w - 20), vl = 20 + r() * 60;
          L.box(vx, y + 12, vx + 2, y + 12 + vl, ZF - 2, ZF, pick(r, [C.mossDk, C.mossMid]), false);
        }
        break;
      }
      case 'overpass': {
        var th = 28;
        // 교각
        var pxm = x0 + p.w * (side < 0 ? 0.62 : (side > 0 ? 0.38 : 0.5));
        L.box(pxm - 29, y + th, pxm + 29, gy, -50, 10, { f: 0x5e5f55, s: 0x3e3f38 }, true);
        L.box(pxm - 40, y + th, pxm + 40, y + th + 14, -56, 16, { f: 0x6a6b60, s: 0x4a4b43, b: 0x3a3b34 }, false);
        L.face(pxm - 14, y + 50, pxm - 6, y + 170, 10.5, C.rustDk);
        L.face(pxm + 8, y + 46, pxm + 14, y + 120, 10.5, C.rust);
        for (i = 0; i < 8; i++) L.face(pxm - 26 + r() * 30, gy - 10 - i * 10, pxm - 10 + r() * 30, gy - i * 10, 10.6, pick(r, [C.mossDk, C.mossMid, 0x3b5520]));
        // 상판 (윗면 = y), 양 끝 부서짐
        L.poly([[x0 + 4, y], [x1 - 4, y], [x1 + 6, y + 6], [x1 - 2, y + 12], [x1 + 4, y + 20], [x1 - 10, y + th], [x0 + 12, y + th], [x0 - 4, y + 22], [x0 + 3, y + 15], [x0 - 6, y + 8]], ZB, ZF, 0x626358, 0x4e4f46);
        // 비볼록 다각형 대비: 중앙 몸통 보강
        L.box(x0 + 4, y, x1 - 4, y + th, ZB, ZF, { f: 0x626358, t: 0x3a3b35, s: 0x4e4f46, b: 0x45463e }, false);
        L.face(x0 + 4, y, x1 - 4, y + 5, ZF + 0.5, 0x7a7a6e);
        // 차선
        for (var lx = x0 + 20; lx < x1 - 30; lx += 60) L.box(lx, y - 0.01, lx + 26, y + 0.5, -14, -6, { f: 0x8a7a48, t: 0x9a8a50 }, true);
        // 노출 철근
        for (i = 0; i < 4; i++) {
          var yy = y + 8 + i * 5;
          L.beam(x1, yy, x1 + 16 + r() * 14, yy + 8 + r() * 12, 2, ZF - 30 + i * 12, ZF - 28 + i * 12, C.rust);
          L.beam(x0, yy, x0 - 14 - r() * 12, yy + 10 + r() * 10, 2, ZF - 30 + i * 12, ZF - 28 + i * 12, C.rust);
        }
        // 가드레일 (뒤, 기울고 끊김)
        L.beam(x0 + 10, y - 18, x0 + p.w * 0.55, y - 18, 4, ZB + 2, ZB + 6, 0x6e5038);
        L.beam(x0 + p.w * 0.62, y - 14, x1 - 14, y - 20, 4, ZB + 2, ZB + 6, 0x6e5038);
        for (var gxx = x0 + 14; gxx < x1 - 10; gxx += 28) {
          if (gxx > x0 + p.w * 0.55 && gxx < x0 + p.w * 0.62) continue;
          L.box(gxx, y - 19, gxx + 3, y, ZB + 2, ZB + 6, C.rustDk, true);
        }
        // 녹 + 이끼 드리움
        for (i = 0; i < 5; i++) { var rsx = x0 + 10 + r() * (p.w - 30); L.face(rsx, y + 6, rsx + 8, y + 22, ZF + 0.6, C.rust); }
        for (i = 0; i < 9; i++) {
          var mx2 = x0 + 10 + r() * (p.w - 20), ml = 4 + r() * 26;
          L.box(mx2, y + th - 2, mx2 + 4 + r() * 8, y + th + ml, ZF - 4, ZF + 0.8, pick(r, [C.mossDk, C.mossMid, C.moss]), false);
        }
        for (i = 0; i < 4; i++) {
          var tx = x0 + 10 + r() * (p.w - 50);
          L.box(tx, y - 4, tx + 14 + r() * 26, y, ZB + 8 + r() * 20, ZB + 40 + r() * 30, { f: C.mossDk, t: pick(r, [C.moss, C.mossMid]) }, true);
        }
        break;
      }
      case 'scaffold': {
        var poles = [x0 + 4, x0 + p.w / 2, x1 - 4];
        for (i = 0; i < poles.length; i++) {
          L.box(poles[i] - 2.5, y + 4, poles[i] + 2.5, gy, ZF - 8, ZF - 3, { f: 0x6e4a2e, s: 0x4a3020 }, true);
          L.box(poles[i] - 2.5, y + 4, poles[i] + 2.5, gy, ZB + 4, ZB + 9, { f: 0x5c3e26, s: 0x4a3020 }, true);
          L.box(poles[i] - 8, gy - 4, poles[i] + 8, gy, ZF - 12, ZF + 1, C.steelDk, true);
        }
        for (var ly = y + 50; ly < gy - 10; ly += 50) {
          L.box(x0 + 4, ly, x1 - 4, ly + 3, ZF - 8, ZF - 4, 0x5c3e26, false);
          L.box(x0 + 4, ly, x1 - 4, ly + 3, ZB + 4, ZB + 8, 0x4a3020, false);
        }
        L.beam(x0 + 6, y + 6, x0 + p.w / 2, gy, 2.5, ZF - 7, ZF - 4, 0x7a5434);
        L.beam(x1 - 6, y + 6, x0 + p.w / 2, gy, 2.5, ZF - 7, ZF - 4, 0x7a5434);
        // 상판 판자 (윗면 = y)
        var plank = x0;
        while (plank < x1 - 0.01) {
          var pw = 26 + r() * 20;
          if (plank + pw > x1) pw = x1 - plank;
          var pc = pick(r, [0x6b5236, 0x5a4430, 0x73583a]);
          L.box(plank, y, plank + pw - 1.5, y + 7, ZB, ZF, { f: pc, t: shade(pc, 0.15), s: shade(pc, -0.25) }, false);
          plank += pw;
        }
        L.box(x0 - 3, y + 7, x1 + 3, y + 10, ZB, ZF, 0x7a5434, false);
        // 찢어진 방수포 (뒤)
        var ts = side > 0 ? x1 - 6 : x0 + 6, td = side > 0 ? -1 : 1;
        L.poly([[ts, y + 8], [ts + td * 70, y + 8], [ts + td * 64, y + 60], [ts + td * 38, y + 84], [ts, y + 90]], ZB + 1, ZB + 3, 0x46604f);
        L.box(Math.min(ts, ts + td * 70), y + 8, Math.max(ts, ts + td * 70), y + 12, ZB + 1, ZB + 4, 0x2e3a33, true);
        // 공구함 + 이끼
        L.box(x1 - 50, y - 14, x1 - 24, y, ZB + 8, ZB + 30, { f: C.rust, t: C.rustHi }, true);
        L.box(poles[0] - 3, gy - 60, poles[0] + 3, gy, ZF - 2, ZF - 1.5, C.mossDk, true);
        break;
      }
      case 'billboard': {
        // 다리
        L.box(x0 + 36, y, x0 + 44, gy, ZB + 4, ZB + 12, { f: 0x4a3a2c, s: 0x3a2a1e }, true);
        L.box(x1 - 44, y, x1 - 36, gy, ZB + 4, ZB + 12, { f: 0x4a3a2c, s: 0x3a2a1e }, true);
        for (var by2 = y + 20; by2 < gy - 30; by2 += 60) {
          L.beam(x0 + 40, by2, x1 - 40, by2 + 40, 2, ZB + 6, ZB + 9, 0x5a4030);
          L.beam(x1 - 40, by2, x0 + 40, by2 + 40, 2, ZB + 6, ZB + 9, 0x5a4030);
        }
        // 철망 통로 (윗면 = y)
        L.box(x0 - 6, y, x1 + 6, y + 9, ZB + 10, ZF - 10, { f: 0x4b3a2c, t: 0x5a4636, s: 0x3a2a1e, b: 0x2a1e14 }, false);
        L.box(x0, y, x1, y + 2, ZB, ZF, { f: 0x5a4636, t: 0x5a4636 }, false);
        for (var mxx2 = x0 - 4; mxx2 < x1 + 4; mxx2 += 6) L.face(mxx2, y + 2, mxx2 + 2, y + 8, ZF - 9.4, 0x22180f);
        // 뒤 난간
        L.box(x0 - 6, y - 24, x1 + 6, y - 21, ZB + 2, ZB + 5, 0x6e4a2e, false);
        for (var rr = x0 - 6; rr <= x1 + 6; rr += 26) L.box(rr, y - 22, rr + 2, y, ZB + 2, ZB + 5, 0x5a3a24, true);
        // 간판 패널 (뒤쪽, 텍스처)
        var bxa = x0 - 24, bwa = p.w + 48, bt = y - 150, bha = 132;
        L.box(bxa - 3, bt - 3, bxa + bwa + 3, bt + bha + 3, -76, -66, { f: 0x6e4a2e, t: 0x7a5434 }, false);
        L.box(bxa + 30, bt + bha, bxa + 36, y, -72, -68, 0x4b3424, true);
        L.box(bxa + bwa - 36, bt + bha, bxa + bwa - 30, y, -72, -68, 0x4b3424, true);
        billboardPanel(bxa, bt, bwa, bha, -65.5, p.seed || 1);
        for (i = 0; i < 3; i++) {
          var lx2 = bxa + 40 + i * (bwa - 80) / 2;
          L.box(lx2 - 2, bt - 16, lx2 + 2, bt, -70, -66, 0x2a2622, true);
          L.box(lx2 - 8, bt - 20, lx2 + 8, bt - 14, -74, -58, 0x2a2622, false);
        }
        // 이끼 드리움
        for (i = 0; i < 12; i++) {
          var dmx = bxa + r() * bwa * 0.7, dl = 4 + r() * 30;
          L.box(dmx, bt - 4, dmx + 5 + r() * 8, bt + dl, -66, -64, pick(r, [C.mossDk, C.mossMid, C.moss]), false);
        }
        L.box(bxa - 3, bt - 8, bxa + bwa * 0.7, bt - 3, -78, -62, { f: C.mossDk, t: C.moss }, false);
        break;
      }
      default: {
        L.box(x0, y, x1, y + 14, ZB, ZF, { f: C.steel, t: C.steelHi }, false);
      }
    }
    void E;
  }

  // 광고판 텍스처 패널
  function billboardPanel(x, yTop, w, h, z, seed) {
    var key = 'bb';
    var tex = texCache[key];
    if (!tex) {
      var cw = 96, chh = 48;
      var cv = document.createElement('canvas');
      cv.width = cw * 4; cv.height = chh * 4;
      var c = cv.getContext("2d"); c.scale(4, 4);
      c.fillStyle = '#9a9070'; c.fillRect(0, 0, cw, chh);
      c.fillStyle = '#8a8466'; c.fillRect(0, chh * 0.6, cw, chh * 0.4);
      c.fillStyle = '#a0502a'; c.beginPath(); c.arc(18, 24, 12, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#e07a35'; c.fillRect(12, 18, 6, 6);
      c.fillStyle = '#3c3228';
      c.font = "bold 11px \"Malgun Gothic\",sans-serif";
      c.textBaseline = 'middle';
      c.fillText('새 도시,', 34, 14);
      c.fillText('새 희망', 38, 28);
      c.font = "bold 6px \"Malgun Gothic\",sans-serif";
      c.fillText('재개발 2031', 36, 40);
      // 찢어짐 + 녹
      var rr = makeRng(seed + 99);
      c.fillStyle = '#3a2a1e';
      c.beginPath(); c.moveTo(cw * 0.66, 0);
      for (var i = 0; i < 6; i++) c.lineTo(cw * 0.66 + 4 + rr() * 12, i * 9 + rr() * 4);
      c.lineTo(cw, chh); c.lineTo(cw, 0); c.closePath(); c.fill();
      c.fillStyle = 'rgba(150,70,30,0.55)';
      for (i = 0; i < 6; i++) c.fillRect(Math.floor(rr() * cw), 0, 2, 8 + Math.floor(rr() * 20));
      tex = new THREE.CanvasTexture(cv);
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4;
      tex._keep = true;
      texCache[key] = tex;
    }
    var mat = new THREE.MeshLambertMaterial({ map: tex });
    var geo = new THREE.PlaneGeometry(w - 12, h - 12);
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x + w / 2, -(yTop + h / 2), z);
    staticGroup.add(m);
  }

  // 네온 간판 ('모텔' / '약국')
  function buildSigns(gy) {
    var signs = [
      { x: 1580, dy: 250, text: '모텔', color: 0xff5a3c },
      { x: WORLD_W - 1580 - 70, dy: 250, text: '약국', color: 0x58f0c8 }
    ];
    for (var i = 0; i < signs.length; i++) {
      var s = signs[i];
      var key = 'neon' + s.text;
      var z = -146;
      var bx = s.x, by = gy - s.dy;
      // 세로 간판 틀
      var frame = new Builder();
      frame.box(bx + 26, by - 8, bx + 44, by + 84, z - 4, z + 3, { f: 0x1a1d1c, t: 0x2a2e2c }, false);
      frame.box(bx + 33, by - 20, bx + 37, by - 8, z - 3, z, C.steelDk, false);
      var fm = frame.toMesh(matLit);
      if (fm) staticGroup.add(fm);
      // 텍스트 (세로로 두 글자)
      for (var k = 0; k < 2; k++) {
        var ch1 = s.text.charAt(k);
        var key2 = key + k;
        var tt = texCache[key2];
        if (!tt) {
          tt = smoothText(ch1, { size: 14, color: cssHex(shade(s.color, 0.35)), glow: cssHex(s.color), glowBlur: 4, pad: 1, bg: '#121414' });
          tt.tex._keep = true;
          texCache[key2] = tt;
        }
        var mat = new THREE.MeshBasicMaterial({ map: tt.tex, color: 0xffffff, transparent: false });
        var sc = Math.min(16 / tt.w, 36 / tt.h);
        var geo = new THREE.PlaneGeometry(tt.w * sc, tt.h * sc);
        var m = new THREE.Mesh(geo, mat);
        m.position.set(bx + 35, -(by + 18 + k * 40), z + 3.5);
        staticGroup.add(m);
        anim.neon.push({ mat: mat, base: new THREE.Color(0xffffff), phase: i * 3.1 + k, flick: 0.8 });
      }
    }
  }

  // ===========================================================================
  // 플레이어 (블록형 후드 영웅)
  // ===========================================================================
  // 로컬 좌표(y 위쪽) 6면 박스를 빌더에 추가
  function cube(B, w, h, d, x, y, z, col) {
    var x0 = x - w / 2, x1 = x + w / 2, b = y - h / 2, t = y + h / 2, z0 = z - d / 2, z1 = z + d / 2;
    var cs = shade(col, -0.06), ct = shade(col, 0.06);
    B.quad([x0, b, z1], [x1, b, z1], [x1, t, z1], [x0, t, z1], col);
    B.quad([x1, b, z0], [x0, b, z0], [x0, t, z0], [x1, t, z0], cs);
    B.quad([x1, b, z1], [x1, b, z0], [x1, t, z0], [x1, t, z1], cs);
    B.quad([x0, b, z0], [x0, b, z1], [x0, t, z1], [x0, t, z0], cs);
    B.quad([x0, t, z1], [x1, t, z1], [x1, t, z0], [x0, t, z0], ct);
    B.quad([x0, b, z0], [x1, b, z0], [x1, b, z1], [x0, b, z1], shade(col, -0.2));
  }
  function pivot(x, y, z, parent) {
    var g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  function derivePal(p) {
    if (p.pal && p.pal.cloak) return p.pal;
    var c = hexToInt(p.color || '#e0702a');
    return {
      cloak: cssHex(c), cloakDark: cssHex(shade(c, -0.45)), suit: '#35302c', suitHi: '#4b433d',
      trim: cssHex(shade(c, 0.45)), skin: '#e9c39b', eye: cssHex(shade(c, 0.8)), glow: cssHex(shade(c, 0.3))
    };
  }

  function palKey(pal) { return [pal.cloak, pal.cloakDark, pal.suit, pal.suitHi, pal.trim, pal.skin, pal.eye, pal.glow].join(','); }

  // 블록형 후드 영웅: 관절(피벗)마다 정점색 메쉬 1개 (+발광 1개) → 플레이어당 ~10 드로우콜
  function makeHero(p) {
    var pal = derivePal(p);
    var o = { root: new THREE.Group(), geos: [], pk: palKey(pal), name: null, walk: Math.random() * 6, seen: frameNo, flow: 0 };
    var cl = hexToInt(pal.cloak), cd = hexToInt(pal.cloakDark), su = hexToInt(pal.suit), sh2 = hexToInt(pal.suitHi || pal.suit);
    var tr = hexToInt(pal.trim), sk = hexToInt(pal.skin), ey = hexToInt(pal.eye), gl = hexToInt(pal.glow), bt = 0x1f1c1a;
    o.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    o.mGlow = new THREE.MeshBasicMaterial({ vertexColors: true });
    o.mHand = new THREE.MeshBasicMaterial({ color: gl, transparent: true, opacity: 0.85 });
    o.glowBase = gl;
    function finish(group, lit, emi) {
      var m = lit.toMesh(o.mat); if (m) { m.matrixAutoUpdate = true; group.add(m); o.geos.push(m.geometry); }
      if (emi) { var e = emi.toMesh(o.mGlow); if (e) { e.matrixAutoUpdate = true; group.add(e); o.geos.push(e.geometry); } }
    }
    var root = o.root, B, E;
    var body = o.body = pivot(0, 0, 0, root);
    // 다리 (엉덩이 피벗 y=24)
    o.legL = pivot(-4.6, 24, 0, body); o.legR = pivot(4.6, 24, 0, body);
    B = new Builder(); cube(B, 7, 17, 8, 0, -8.5, 0, su); cube(B, 7.6, 3, 8.6, 0, -11, 0, shade(su, -0.25));
    cube(B, 8.4, 7, 12, 0, -20.5, 1.6, bt); cube(B, 8.6, 2, 12.4, 0, -17.2, 1.6, tr); finish(o.legL, B);
    B = new Builder(); cube(B, 7, 17, 8, 0, -8.5, 0, sh2); cube(B, 7.6, 3, 8.6, 0, -11, 0, shade(sh2, -0.25));
    cube(B, 8.4, 7, 12, 0, -20.5, 1.6, bt); cube(B, 8.6, 2, 12.4, 0, -17.2, 1.6, tr); finish(o.legR, B);
    // 몸통
    o.torso = pivot(0, 24, 0, body);
    B = new Builder(); E = new Builder();
    cube(B, 18, 21, 11, 0, 10.5, 0, su);
    cube(B, 9, 14, 1, 2.5, 12, 5.8, sh2);
    cube(B, 19, 3, 12, 0, 2.5, 0, tr);              // 벨트
    cube(B, 4, 4, 1, 0, 2.5, 6.4, shade(tr, 0.3));  // 버클
    cube(B, 7, 6, 3, -6, -1.5, 4.5, cd);            // 허리 주머니
    cube(B, 24, 7, 15, 0, 19.5, -0.5, cl);          // 어깨 망토
    cube(B, 25, 2, 15.6, 0, 16.2, -0.5, cd);
    cube(B, 12, 4, 4, 0, 21.5, 6.5, tr);            // 목 장식
    cube(E, 4, 5, 1, -3.5, 13, 6.2, gl);            // 가슴 문양 (발광)
    cube(E, 1.5, 8, 1, -3.5, 7.5, 6.2, gl);
    finish(o.torso, B, E);
    // 망토 (어깨 피벗, 뒤쪽)
    o.cape = pivot(0, 20, -7, o.torso);
    B = new Builder();
    cube(B, 22, 33, 2.4, 0, -16.5, 0, cl);
    cube(B, 18, 29, 1, 0, -15, 1.6, cd);
    cube(B, 6, 6, 2.4, -8, -35, 0, cl); cube(B, 6, 4, 2.4, 0, -34, 0, cl); cube(B, 6, 7, 2.4, 8, -35.5, 0, cl); // 찢어진 끝단
    cube(B, 22.4, 2, 2.8, 0, -28, 0, tr);
    finish(o.cape, B);
    // 팔 (어깨 피벗)
    o.armL = pivot(-12.5, 18, 0, o.torso); o.armR = pivot(12.5, 18, 0, o.torso);
    B = new Builder(); cube(B, 6.4, 14, 7, 0, -6.5, 0, cd); cube(B, 6.8, 2, 7.4, 0, -12, 0, tr); cube(B, 5.4, 5, 5.4, 0, -16, 0, sk); finish(o.armL, B);
    B = new Builder(); cube(B, 6.4, 14, 7, 0, -6.5, 0, cd); cube(B, 6.8, 2, 7.4, 0, -12, 0, tr); cube(B, 5.4, 5, 5.4, 0, -16, 0, sk); finish(o.armR, B);
    o.handGlow = new THREE.Mesh(new THREE.OctahedronGeometry(6, 0), o.mHand);
    o.handGlow.position.set(0, -18, 0);
    o.handGlow.visible = false;
    o.armR.add(o.handGlow);
    o.geos.push(o.handGlow.geometry);
    // 머리 + 후드
    o.head = pivot(0, 45, 0, body);
    B = new Builder(); E = new Builder();
    cube(B, 18, 16, 17, 0, 8.5, -0.8, cl);          // 후드
    cube(B, 14, 3, 2, 0, 15, 7.6, cl);              // 후드 앞챙
    cube(B, 2.4, 12, 2, -6.8, 7.5, 7.6, cl); cube(B, 2.4, 12, 2, 6.8, 7.5, 7.6, cl);
    cube(B, 12, 11, 1, 0, 7.5, 7.9, shade(cd, -0.35));  // 얼굴 그늘
    cube(B, 9, 4, 1, 0, 3.4, 8.3, sk);                 // 턱
    cube(B, 6, 6, 6, 0, 17.5, -7, cl);                 // 후드 끝
    cube(B, 4, 4, 4, 0, 19, -10.5, cd);
    cube(B, 18.6, 2, 17.6, 0, 1.2, -0.8, tr);          // 후드 테두리
    cube(E, 3.4, 2.6, 1, -3.2, 8.6, 8.6, ey); cube(E, 3.4, 2.6, 1, 3.2, 8.6, 8.6, ey);
    finish(o.head, B, E);
    // 그림자 (정적 패스, 지면과 깊이 비교)
    var sh = new THREE.Mesh(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    sh.rotation.x = -Math.PI / 2;
    o.shadow = sh;
    shadowGroup.add(sh);
    dynGroup.add(root);
    return o;
  }

  function disposeHero(o) {
    dynGroup.remove(o.root); shadowGroup.remove(o.shadow);
    for (var i = 0; i < o.geos.length; i++) o.geos[i].dispose();
    o.mat.dispose(); o.mGlow.dispose(); o.mHand.dispose();
    o.shadow.geometry.dispose(); o.shadow.material.dispose();
    if (o.name) { dynGroup.remove(o.name.mesh); o.name.mesh.geometry.dispose(); o.name.mesh.material.dispose(); o.name.tex.dispose(); }
  }

  function heroFor(p) {
    var o = null, key = p.id;
    if (key != null) o = pool[key];
    else if (poolWeak) o = poolWeak.get(p);
    var pk = palKey(derivePal(p));
    if (o && o.pk !== pk) { disposeHero(o); o = null; if (key != null) delete pool[key]; }
    if (!o) {
      o = makeHero(p);
      if (key != null) pool[key] = o;
      else if (poolWeak) { poolWeak.set(p, o); o.weak = true; weakList.push(o); }
      o.weakRef = p;
    }
    return o;
  }

  function nameTag(o, p, pal) {
    var nm = p.name != null ? String(p.name) : '';
    if (o.name && o.name.text === nm) return o.name;
    if (o.name) { dynGroup.remove(o.name.mesh); o.name.mesh.geometry.dispose(); o.name.mesh.material.dispose(); o.name.tex.dispose(); o.name = null; }
    if (!nm) return null;
    var t = smoothText(nm, { size: 12, color: cssHex(shade(hexToInt(pal.trim || '#ffffff'), 0.25)), outline: 'rgba(12,10,14,0.92)', outlineW: 3.2, pad: 3 });
    var mat = new THREE.MeshBasicMaterial({ map: t.tex, transparent: true, depthTest: false, depthWrite: false, fog: false });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 20;
    dynGroup.add(mesh);
    o.name = { text: nm, mesh: mesh, tex: t.tex, w: t.w, h: t.h };
    return o.name;
  }

  function surfaceBelow(p) {
    var world = G.world || {};
    var best = world.groundY || 0;
    var by = p.y + p.h, plats = world.platforms || [];
    for (var i = 0; i < plats.length; i++) {
      var pl = plats[i];
      if (p.x + p.w <= pl.x || p.x >= pl.x + pl.w) continue;
      if (pl.y >= by - 1 && pl.y < best) best = pl.y;
    }
    return best;
  }

  function updateHero(o, p, time, dt, camX, camY) {
    var pal = derivePal(p);
    o.seen = frameNo;
    var alive = p.alive !== false;
    var w = p.w || 34, h = p.h || 62;
    var cx = p.x + w / 2, feet = p.y + h;
    var blink = p.invulnTimer > 0 && Math.floor(time * 18) % 2 === 0;
    o.root.visible = alive && !blink;
    o.shadow.visible = alive;
    if (o.name) o.name.mesh.visible = alive;
    if (!alive) return;

    var sk = clamp(Math.abs(p.vx || 0) / 360, 0, 1);
    var air = p.onGround === false;
    var casting = p.anim === 'cast' || p.castTimer > 0;
    if (!air) o.walk += Math.abs(p.vx || 0) * dt * 0.042;
    var sw = air ? 0 : Math.sin(o.walk) * 0.75 * sk;
    var bob = air ? 0 : Math.abs(Math.sin(o.walk)) * 2.2 * sk;
    var facing = p.facing < 0 ? -1 : 1;

    o.root.position.set(cx, -feet, 0);
    o.root.rotation.y = facing * (Math.PI / 2 - 0.62);
    o.body.position.y = bob;
    o.body.rotation.x = 0;
    o.torso.rotation.x = clamp((p.vx || 0) * facing / 360, -1, 1) * 0.12;

    if (air) {
      var up = (p.vy || 0) < 0;
      o.legL.rotation.x = up ? -0.9 : -0.35;
      o.legR.rotation.x = up ? 0.45 : 0.25;
      o.armL.rotation.x = up ? -2.4 : -1.2; o.armL.rotation.z = -0.35;
      o.armR.rotation.x = up ? -2.6 : -1.4; o.armR.rotation.z = 0.35;
    } else {
      o.legL.rotation.x = sw; o.legR.rotation.x = -sw;
      o.armL.rotation.x = -sw * 0.9; o.armR.rotation.x = sw * 0.9;
      o.armL.rotation.z = -0.06; o.armR.rotation.z = 0.06;
    }
    if (casting) {
      o.armR.rotation.x = -Math.PI / 2 - 0.25; o.armR.rotation.z = 0.15;
      o.handGlow.visible = true;
      var gs = 1 + Math.sin(time * 30) * 0.15;
      o.handGlow.scale.set(gs, gs, gs); o.handGlow.rotation.y = time * 6;
    } else o.handGlow.visible = false;
    // 망토 흩날림
    var flow = 0.18 + sk * 0.75 + (air ? 0.35 : 0);
    o.flow += (flow - o.flow) * Math.min(1, dt * 8);
    o.cape.rotation.x = o.flow + Math.sin(time * 9 + o.walk) * 0.06 * (0.5 + o.flow) + (air && (p.vy || 0) > 0 ? -0.25 : 0);
    // 피격 섬광 / 빙결
    var em = 0, emc = 0xffffff;
    if (p.hitFlash > 0) { em = 1; }
    else if (p.frozen) { em = 0.45; emc = 0x7fd8ff; }
    o.mat.emissive.setHex(emc);
    o.mat.emissiveIntensity = em;
    var pulse = p.hitFlash > 0 ? 1 : 0.7 + Math.sin(time * 5 + (p.slot || 0)) * 0.3;
    o.mGlow.color.setScalar(pulse);
    if (casting) o.mHand.opacity = 0.6 + Math.sin(time * 25) * 0.25;

    // 그림자
    var surf = surfaceBelow(p);
    var hgt = Math.max(0, surf - feet);
    var k = Math.max(0.25, 1 - hgt / 300);
    o.shadow.position.set(cx, -surf + 0.6, 6);
    o.shadow.scale.set(w * 0.62 * k, 9 * k, 1);
    o.shadow.material.opacity = 0.38 * k;

    // 이름표 (머리 위, 정수 픽셀에 스냅해 선명하게)
    var tag = nameTag(o, p, pal);
    if (tag) {
      tag.mesh.scale.set(tag.w, tag.h, 1);
      var left = Math.round(cx - tag.w / 2 - camX) + camX, top = Math.round(p.y - 8 - tag.h - camY) + camY;
      tag.mesh.position.set(left + tag.w / 2, -(top + tag.h / 2), 0);
    }
  }

  // ===========================================================================
  // 렌더
  // ===========================================================================
  function render(camX, camY, players, time) {
    if (!renderer || !R.available) return;
    frameNo++;
    time = time || 0;
    var dt = clamp(time - lastTime, 0, 0.1);
    lastTime = time;
    camX = camX || 0; camY = camY || 0;
    if (builtGy === null || (G.world && G.world.groundY !== builtGy) || (frameNo % 30 === 0 && worldSig() !== builtSig)) rebuild();

    camera.position.set(camX + vw / 2, -(camY + vh / 2), camD);
    camera.updateMatrixWorld();

    // 플레이어
    var list = players || (G.players && G.players.all ? G.players.all() : []);
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p) continue;
      updateHero(heroFor(p), p, time, dt, camX, camY);
    }
    // 오래 안 보인 플레이어 정리
    for (var id in pool) {
      if (!pool.hasOwnProperty(id)) continue;
      var o = pool[id];
      if (o.seen !== frameNo) {
        o.root.visible = false; o.shadow.visible = false;
        if (o.name) o.name.mesh.visible = false;
        if (frameNo - o.seen > 300) { disposeHero(o); delete pool[id]; }
      }
    }
    // id 없는 플레이어 (WeakMap 키)
    for (i = weakList.length - 1; i >= 0; i--) {
      var wo = weakList[i];
      if (wo.seen !== frameNo) {
        wo.root.visible = false; wo.shadow.visible = false;
        if (wo.name) wo.name.mesh.visible = false;
        if (frameNo - wo.seen > 300) { disposeHero(wo); if (poolWeak && wo.weakRef) poolWeak.delete(wo.weakRef); weakList.splice(i, 1); }
      }
    }

    // 네온 깜빡임
    for (i = 0; i < anim.neon.length; i++) {
      var n = anim.neon[i];
      var f = 1;
      if (n.flick > 0) {
        var s = Math.sin(time * 1.3 + n.phase) + Math.sin(time * 7.7 + n.phase * 3);
        if (s > 1.65 * (1.2 - n.flick * 0.5)) f = 0.25;
      }
      n.mat.color.copy(n.base).multiplyScalar(f);
    }
    for (i = 0; i < anim.toxic.length; i++) {
      var tx = anim.toxic[i];
      tx.mat.color.copy(tx.base).multiplyScalar(0.7 + Math.sin(time * 3 + tx.phase) * 0.3);
    }
    for (i = 0; i < anim.blink.length; i++) {
      var b = anim.blink[i];
      var on = ((time * 0.9 + b.phase) % 1.6) < 0.55;
      b.mat.color.copy(b.base).multiplyScalar(on ? 1 : 0.18);
    }

    renderer.setRenderTarget(null);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(playerScene, camera);
  }

  // 디버그/테스트용: 월드 좌표 → 백버퍼 픽셀
  R.project = function (x, y, z) {
    var v = new THREE.Vector3(x, -y, z || 0).project(camera);
    return { u: (v.x + 1) / 2 * vw, v: (1 - v.y) / 2 * vh };  // CSS px (화면 좌표)
  };
  R.info = function () { return renderer ? renderer.info : null; };
})();
