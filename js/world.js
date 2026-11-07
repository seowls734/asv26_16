/* 초능력자: 각성 — 월드 v2 (온라인 대전판)
 * 녹슬고 이끼 낀 폐허 도시 맵, 한 방향 발판, 로컬/원격 플레이어, 카메라, 파티클,
 * 화면 흔들림, KO/점수/승리 판정, 상태 동기화(state/ko), 게임 루프.
 * window.Game 은 덮어쓰지 않고 확장만 한다.
 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};

  // ===========================================================================
  // 유틸
  // ===========================================================================
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // 결정적 해시 → [0,1)
  function hash(i, seed) {
    var h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  // 시드 난수 생성기 (mulberry32)
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }

  function roundRect(c, x, y, w, h, r) {
    if (w < 0) { x += w; w = -w; }
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function makeCanvas(w, h) {
    if (!document.createElement) return null;
    var cv = document.createElement('canvas');
    if (!cv || !cv.getContext) return null;
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    return cv;
  }

  // ===========================================================================
  // 상수
  // ===========================================================================
  var WORLD_W = 4200;
  var GAME_KEYS = {
    KeyA: 1, KeyD: 1, KeyW: 1, KeyS: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1,
    Space: 1, KeyJ: 1, KeyK: 1, KeyL: 1, KeyI: 1
  };
  var JUMP_KEYS = { KeyW: 1, Space: 1, ArrowUp: 1 };

  var PW = 34, PH = 62;
  var MAX_SPEED = 360;
  var BOOST_SPEED = 1.4, BOOST_JUMP = 1.2, BOOST_ARMOR = 0.6;   // 신체강화
  var ACCEL_GROUND = 2700, ACCEL_AIR = 1650;
  var DECEL_GROUND = 3100, DECEL_AIR = 650;
  var JUMP_VY = -860;
  var COYOTE = 0.09, JUMP_BUFFER = 0.13;
  var DROP_TIME = 0.25;
  var ENERGY_REGEN = 14;
  var RESPAWN_TIME = 3;
  var STATE_INTERVAL = 1 / 20;
  var MAX_PARTICLES = 1500;
  var TILE = 512;

  var PAL = {
    orange: {
      cloak: '#e0702a', cloakDark: '#93421a', suit: '#35302c', suitHi: '#4b433d',
      trim: '#ffb04a', skin: '#e9c39b', eye: '#fff0c0', glow: '#ff9a2a'
    },
    teal: {
      cloak: '#2fb8a8', cloakDark: '#16695f', suit: '#2b3533', suitHi: '#3c4a47',
      trim: '#8ff5e2', skin: '#e9c39b', eye: '#e6fffb', glow: '#3ff0d8'
    }
  };
  PAL.purple = {
    cloak: '#9a5ad8', cloakDark: '#55287e', suit: '#302c35', suitHi: '#463f4e',
    trim: '#d6b0ff', skin: '#e9c39b', eye: '#f6ecff', glow: '#b77aff'
  };
  PAL.yellow = {
    cloak: '#e8c43a', cloakDark: '#8a6c14', suit: '#34322a', suitHi: '#4a473b',
    trim: '#fff08a', skin: '#e9c39b', eye: '#fffbe0', glow: '#ffe04a'
  };
  PAL.red = {
    cloak: '#d23a2e', cloakDark: '#7a1812', suit: '#352b2a', suitHi: '#4b3c3a',
    trim: '#ff9a84', skin: '#e9c39b', eye: '#ffe6de', glow: '#ff5a3c'
  };
  PAL.blue = {
    cloak: '#3a78e0', cloakDark: '#1a3c82', suit: '#2a2f38', suitHi: '#3c4350',
    trim: '#9cc8ff', skin: '#e9c39b', eye: '#e6f2ff', glow: '#5aa0ff'
  };
  PAL.pink = {
    cloak: '#e85aa8', cloakDark: '#8a2460', suit: '#352a31', suitHi: '#4c3c46',
    trim: '#ffb4dc', skin: '#e9c39b', eye: '#ffeef8', glow: '#ff7ac4'
  };
  PAL.lime = {
    cloak: '#8ccf38', cloakDark: '#4a7a14', suit: '#2e332a', suitHi: '#42493b',
    trim: '#d4ff8a', skin: '#e9c39b', eye: '#f4ffe0', glow: '#b4ff4a'
  };
  // 슬롯(0~7) → 이름 / 팔레트
  var SLOT_INFO = [
    { name: '주황', pal: PAL.orange },
    { name: '청록', pal: PAL.teal },
    { name: '보라', pal: PAL.purple },
    { name: '노랑', pal: PAL.yellow },
    { name: '빨강', pal: PAL.red },
    { name: '파랑', pal: PAL.blue },
    { name: '분홍', pal: PAL.pink },
    { name: '연두', pal: PAL.lime }
  ];
  // 슬롯별 스폰 위치 (4200px 맵에 고르게 퍼짐)
  var SLOT_SPAWN_X = [500, 3660, 2080, 1240, 2920, 170, 3990, 1660];
  function slotInfo(slot) { return SLOT_INFO[((slot | 0) % 8 + 8) % 8]; }
  function palOf(p) { return (p && p.pal) || PAL.orange; }

  // 맵 색
  var RUST = ['#8a4a22', '#a35628', '#6e3a1d', '#b8642e', '#7d4424'];
  var MOSS = ['#4c6a28', '#5f7f30', '#3b5520', '#6f8f3a', '#567a2c'];
  var MOSS_HI = '#90ad4e';

  // ===========================================================================
  // 캔버스 / Game 확장
  // ===========================================================================
  var canvas = document.getElementById ? document.getElementById('game') : null;
  var canvas3d = document.getElementById ? document.getElementById('game3d') : null;
  var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  var PIXEL_SCALE = 1;       // 픽셀 효과 없음 (G.pixelScale = 1, 원래 해상도)
  var dpr = 1;
  var cacheScale = 1;
  var bufW = 1, bufH = 1;    // 오버레이 백버퍼 크기 (기기 픽셀)

  // ---- 플레이어 레지스트리 ----
  // pov: 권한측에서 봇 시점으로 기술을 시뮬레이션하는 동안 local 을 그 봇으로 잠시 바꾼다 (withPov).
  //      그동안 list()/byId() 는 그 봇을 제외하고 진짜 로컬 플레이어를 포함한다.
  var povReal = null;   // pov 중 진짜 로컬 플레이어
  var muteDepth = 0;    // >0 이면 파티클/흔들림/토스트/이벤트 무음 (그림자 시뮬레이션)
  var povParticles = [];
  var players = {
    local: null,
    others: {},
    pov: null,
    list: function () {
      var out = [];
      var pv = players.pov;
      for (var k in players.others) {
        if (Object.prototype.hasOwnProperty.call(players.others, k) && players.others[k] && players.others[k] !== pv) out.push(players.others[k]);
      }
      if (pv && povReal) out.unshift(povReal);
      return out;
    },
    all: function () {
      var out = players.list();
      if (players.local) out.unshift(players.local);
      return out;
    },
    byId: function (id) {
      if (id == null) return null;
      if (players.local && players.local.id === id) return players.local;
      if (players.pov && povReal && povReal.id === id) return povReal;
      return Object.prototype.hasOwnProperty.call(players.others, id) ? (players.others[id] || null) : null;
    },
    // 진짜 로컬 플레이어 (pov 중에도)
    real: function () { return players.pov ? povReal : players.local; },
    // p 의 시점으로 fn 실행: local = p, 시각/이벤트 무음, G.particles 는 임시 배열
    withPov: function (p, fn) {
      if (!p || typeof fn !== 'function') return undefined;
      if (players.pov === p || (!players.pov && p === players.local)) return fn();
      var prevLocal = players.local, prevPov = players.pov, prevReal = povReal, prevParts = G.particles;
      if (!prevPov) povReal = prevLocal;
      players.local = p; players.pov = p;
      muteDepth++;
      povParticles.length = 0;
      G.particles = povParticles;
      try { return fn(); }
      finally {
        muteDepth--;
        G.particles = prevParts;
        players.local = prevLocal; players.pov = prevPov; povReal = prevReal;
      }
    }
  };

  Object.assign(G, {
    canvas: canvas,
    ctx: ctx,
    width: 0,
    height: 0,
    mode: null,
    running: false,
    matchOver: false,
    time: 0,
    world: { width: WORLD_W, groundY: 0, platforms: [], platformsLocked: false },
    bossMode: false,
    gravity: 2200,
    camera: { x: 0, y: 0 },
    keys: new Set(),
    players: players,
    particles: [],
    score: { me: 0, opp: 0 },   // 호환용: me = 내 킬, opp = 다른 플레이어 최고 킬
    scores: {},                 // id → 킬 수
    winScore: 5,
    pixelScale: PIXEL_SCALE,
    canvas3d: canvas3d,
    slotInfo: slotInfo,
    playerName: playerName,
    start: start,
    restartMatch: restartMatch,
    update: update,
    render: render,
    spawnParticles: spawnParticles,
    damagePlayer: damagePlayer,
    shake: shake,
    toast: toast,
    rectHit: rectHit,
    stepPlayer: stepPlayer,       // (p, input, dt) — 입력 기반 물리 (로컬 플레이어와 봇 공용)
    awardPoint: awardPoint,       // (id, n, reason) — 권한측 전용 점수 추가
    fxMuted: function () { return muteDepth > 0; },
    unmuted: function (fn) {      // pov 무음 중에도 시각효과/이벤트를 내야 할 때
      var d = muteDepth; muteDepth = 0;
      try { return fn(); } finally { muteDepth = d; }
    }
  });

  // 그림자 시뮬레이션(pov) 중에는 이벤트 버스도 무음 (미션/킬피드 중복 방지)
  (function wrapEvents() {
    var ev = G.events;
    if (!ev || typeof ev.emit !== 'function' || ev._povWrapped) return;
    var orig = ev.emit;
    ev.emit = function (name, data) {
      if (muteDepth > 0) return;
      return orig.call(ev, name, data);
    };
    ev._povWrapped = true;
  })();

  // 내부 상태
  var realParticles = G.particles;
  var loopStarted = false;
  var lastTs = 0;
  var bgTime = 0;
  var shakeAmt = 0, shakeX = 0, shakeY = 0;
  var coyoteTimer = 0, jumpBufferTimer = 0;
  var stateTimer = 0;
  var matchEndSent = false;
  var toastTimer = null;
  var netBound = false;
  var hudCache = {};
  var lastAttacker = null;     // { id, t } — 6초 이내 마지막으로 나를 때린 플레이어
  var KO_CREDIT_TIME = 6;
  var r3Tried = false;         // Render3D.init 시도 여부
  var r3On = false;            // 3D 배경 활성

  // ===========================================================================
  // 맵 데이터 (결정적)
  // ===========================================================================
  // 발판 정의 — 왼쪽 절반, 오른쪽은 미러. dy = groundY 위 높이(발판 윗면).
  var PLATFORM_LEFT = [
    { kind: 'car', x: 290, w: 170, dy: 100 },
    { kind: 'balcony', x: 570, w: 190, dy: 220 },
    { kind: 'overpass', x: 870, w: 300, dy: 320 },
    { kind: 'scaffold', x: 1270, w: 170, dy: 140 }
  ];
  var PLATFORM_CENTER = [
    { kind: 'bus', x: 1930, w: 340, dy: 125 },
    { kind: 'billboard', x: 2000, w: 200, dy: 265 }
  ];
  var platformDefs = [];
  (function buildPlatformDefs() {
    var i, d, n = 0;
    for (i = 0; i < PLATFORM_LEFT.length; i++) {
      d = PLATFORM_LEFT[i];
      platformDefs.push({ kind: d.kind, x: d.x, w: d.w, dy: d.dy, side: -1, seed: 7001 + i * 31 });
    }
    for (i = 0; i < PLATFORM_CENTER.length; i++) {
      d = PLATFORM_CENTER[i];
      platformDefs.push({ kind: d.kind, x: d.x, w: d.w, dy: d.dy, side: 0, seed: 8101 + i * 31 });
    }
    for (i = PLATFORM_LEFT.length - 1; i >= 0; i--) {
      d = PLATFORM_LEFT[i];
      platformDefs.push({ kind: d.kind, x: WORLD_W - d.x - d.w, w: d.w, dy: d.dy, side: 1, seed: 9201 + i * 31 });
    }
    n = platformDefs.length;
    return n;
  })();

  function rebuildPlatforms() {
    var gy = G.world.groundY;
    var arr = G.world.platforms;
    arr.length = 0;
    for (var i = 0; i < platformDefs.length; i++) {
      var d = platformDefs[i];
      arr.push({ x: d.x, y: gy - d.dy, w: d.w, h: 16, dy: d.dy, kind: d.kind, side: d.side, seed: d.seed });
    }
  }

  // 구조물이 차지하는 x 범위 (소품 배치 회피용)
  function blockedAt(x, pad) {
    for (var i = 0; i < platformDefs.length; i++) {
      var d = platformDefs[i];
      var a = d.x - pad, b = d.x + d.w + pad;
      if (d.kind === 'car') { a -= 40; b += 40; }
      if (x > a && x < b) return true;
    }
    if (x < 130 + pad || x > WORLD_W - 130 - pad) return true;
    return false;
  }

  var facades = [];   // 근경 건물 외벽
  var props = [];     // 지면 소품
  var cracks = [];    // 도로 균열
  var puddles = [];
  var vines = [];     // 동적으로 흔들리는 매달린 덩굴
  var neons = [];     // 깜빡이는 간판

  function roofOff(b, xx) {
    if (!b.bd) return 0;
    return b.bd * Math.max(0, 1 - Math.abs(xx - b.bc) / (b.w * 0.45));
  }

  (function buildScenery() {
    var r = makeRng(20240611);
    var i, x;

    // --- 건물 외벽 (끊김 없이 이어짐)
    x = -60;
    while (x < WORLD_W + 60) {
      var w = 170 + r() * 200;
      var h = 290 + r() * 270;
      var b = {
        x: x, w: w, h: h, seed: Math.floor(r() * 1e9),
        type: r() < 0.5 ? 'steel' : 'concrete',
        broken: r() < 0.5, tone: r(), recess: r() < 0.22
      };
      b.bc = b.x + b.w * (0.2 + r() * 0.6);
      b.bd = b.broken ? 50 + r() * 150 : 0;
      facades.push(b);
      x += w - 2;
    }
    // 발코니 뒤 건물은 충분히 높고 멀쩡하게
    for (i = 0; i < facades.length; i++) {
      var f = facades[i];
      for (var k = 0; k < platformDefs.length; k++) {
        var d = platformDefs[k];
        if ((d.kind === 'balcony' || d.kind === 'overpass') && f.x < d.x + d.w + 40 && f.x + f.w > d.x - 40) {
          f.h = Math.max(f.h, d.dy + (d.kind === 'balcony' ? 190 : 130));
          f.recess = false;
          if (d.kind === 'balcony') { f.bd = 0; f.broken = false; }
        }
      }
    }
    // 덩굴: 건물 지붕/처마에서 매달림
    for (i = 0; i < facades.length; i++) {
      var fb = facades[i];
      var n = 1 + Math.floor(r() * 3);
      for (k = 0; k < n; k++) {
        var vx = fb.x + 14 + r() * (fb.w - 28);
        var top = fb.h - roofOff(fb, vx) - 4;
        vines.push({ x: vx, dy: top, len: 40 + r() * Math.min(170, top - 120), seed: Math.floor(r() * 1e6), thick: 1.6 + r() * 1.2 });
      }
    }
    // 네온 간판 (대칭 비슷한 위치 두 곳)
    neons.push({ x: 1580, dy: 250, text: '모텔', color: '#ff5a3c', seed: 11 });
    neons.push({ x: WORLD_W - 1580 - 70, dy: 250, text: '약국', color: '#58f0c8', seed: 23 });

    // --- 발판 아래 덩굴
    for (i = 0; i < platformDefs.length; i++) {
      var p = platformDefs[i];
      var cnt = p.kind === 'overpass' ? 7 : (p.kind === 'balcony' ? 4 : (p.kind === 'billboard' ? 3 : (p.kind === 'scaffold' ? 2 : 0)));
      var under = p.kind === 'overpass' ? 30 : (p.kind === 'balcony' ? 14 : 10);
      for (k = 0; k < cnt; k++) {
        var px = p.x + 10 + r() * (p.w - 20);
        vines.push({ x: px, dy: p.dy - under, len: 30 + r() * Math.min(110, p.dy - under - 30), seed: Math.floor(r() * 1e6), thick: 1.4 + r() * 1.4 });
      }
    }

    // --- 지면 소품
    var kinds = ['barrel', 'barrel', 'rubble', 'rubble', 'tires', 'barrier', 'lamp', 'sign', 'wreck', 'trafficlight', 'cone', 'shrub', 'shrub'];
    x = 150;
    while (x < WORLD_W - 150) {
      if (!blockedAt(x, 30)) {
        var kind = pick(r, kinds);
        if ((kind === 'wreck' || kind === 'trafficlight') && blockedAt(x + 120, 30)) kind = 'barrel';
        props.push({ kind: kind, x: x, seed: Math.floor(r() * 1e9), s: 0.85 + r() * 0.3, flip: r() < 0.5 ? -1 : 1 });
        x += (kind === 'wreck' || kind === 'trafficlight') ? 200 + r() * 120 : 70 + r() * 150;
      } else {
        x += 40;
      }
    }
    // 반드시 들어갈 대표 소품 (좌우 대칭)
    props.push({ kind: 'trafficlight', x: 700, seed: 777, s: 1, flip: 1 });
    props.push({ kind: 'trafficlight', x: WORLD_W - 700, seed: 778, s: 1, flip: -1 });
    props.sort(function (a, b) { return a.x - b.x; });

    // --- 도로 균열
    x = 40;
    while (x < WORLD_W) {
      var pts = [];
      var cy = 4 + r() * 10, cx = x;
      var segs = 3 + Math.floor(r() * 5);
      pts.push([cx, cy]);
      for (k = 0; k < segs; k++) {
        cx += 10 + r() * 26;
        cy += (r() - 0.35) * 18;
        if (cy < 2) cy = 2;
        pts.push([cx, cy]);
      }
      cracks.push({ pts: pts, grass: r() < 0.7, seed: Math.floor(r() * 1e6) });
      x += 90 + r() * 220;
    }

    // --- 웅덩이
    x = 200;
    while (x < WORLD_W - 200) {
      puddles.push({ x: x, w: 50 + r() * 90, dy: 16 + r() * 22, seed: Math.floor(r() * 1e6) });
      x += 380 + r() * 520;
    }
  })();

  // ===========================================================================
  // 캐시 (리사이즈 시 재생성)
  // ===========================================================================
  var skyCache = null;
  var farLayers = [];
  var vignetteCache = null;
  var tiles = {};
  var tileCount = Math.ceil(WORLD_W / TILE);
  var tileH = 0, tileTop = -80;

  function invalidateCaches() {
    skyCache = null;
    farLayers = [];
    vignetteCache = null;
    tiles = {};
  }

  // ===========================================================================
  // 리사이즈
  // ===========================================================================
  function resize() {
    var w = window.innerWidth || 800;
    var h = window.innerHeight || 600;
    dpr = window.devicePixelRatio || 1;
    cacheScale = Math.min(dpr, 1.25);
    bufW = Math.max(1, Math.round(w * dpr));
    bufH = Math.max(1, Math.round(h * dpr));
    if (canvas) {
      canvas.width = bufW;
      canvas.height = bufH;
      if (canvas.style) {
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
      }
    }
    G.width = w;
    G.height = h;

    var oldG = G.world.groundY;
    var newG = Math.round(h * 0.82);
    G.world.groundY = newG;
    rebuildPlatforms();
    if (oldG && oldG !== newG) {
      var d = newG - oldG;
      shiftEntity(G.players.local, d);
      var os = players.list();
      for (var oi = 0; oi < os.length; oi++) {
        shiftEntity(os[oi], d);
        if (typeof os[oi]._ty === 'number') os[oi]._ty += d;
      }
      for (var k = 0; k < G.particles.length; k++) G.particles[k].y += d;
      if (G.Mutants && G.Mutants.list) {
        for (var m = 0; m < G.Mutants.list.length; m++) {
          var mm = G.Mutants.list[m];
          if (mm && typeof mm.y === 'number') mm.y += d;
        }
      }
    }
    invalidateCaches();
    tileH = h - tileTop + 80;
    clampCamera();
    if (r3On) {
      try {
        G.Render3D.resize(w, h, PIXEL_SCALE);
        G.Render3D.rebuild();
      } catch (err) { if (window.console) console.error('[world] Render3D resize', err); }
    }
  }

  // Render3D 지연 초기화 (render3d.js 는 world.js 뒤에 로드됨)
  function ensure3D() {
    if (r3Tried) return;
    var R = G.Render3D;
    if (!R) return;
    r3Tried = true;
    r3On = false;
    try {
      if (typeof R.init === 'function' && canvas3d) R.init(canvas3d);
      if (R.available) {
        R.resize(G.width, G.height, PIXEL_SCALE);
        R.rebuild();
        r3On = true;
      }
    } catch (err) {
      r3On = false;
      if (window.console) console.error('[world] Render3D init 실패 → 2D 배경 사용', err);
    }
    if (canvas && canvas.style) canvas.style.background = r3On ? 'transparent' : '';
    if (canvas3d && canvas3d.style && !r3On) canvas3d.style.display = 'none';
    if (document.body && document.body.classList) document.body.classList.toggle('r3d', r3On);
  }
  function r3Owns() { return r3On && !!G.Render3D.ownsPlayers; }

  function shiftEntity(p, d) {
    if (!p) return;
    p.y += d;
    if (p.y + p.h > G.world.groundY) p.y = G.world.groundY - p.h;
  }

  function clampCamera() {
    var maxX = Math.max(0, G.world.width - G.width);
    G.camera.x = clamp(G.camera.x, 0, maxX);
    G.camera.y = 0;
  }

  // ===========================================================================
  // 입력
  // ===========================================================================
  function inputFocused() {
    var ae = document.activeElement;
    if (!ae) return false;
    var tag = ae.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || !!ae.isContentEditable;
  }

  window.addEventListener('keydown', function (e) {
    if (inputFocused()) return;
    var code = e.code;
    if (G.running && GAME_KEYS[code] && e.preventDefault) e.preventDefault();
    if (JUMP_KEYS[code] && !G.keys.has(code)) jumpBufferTimer = JUMP_BUFFER;
    G.keys.add(code);
    var lp = G.players.local;
    if (G.running && !G.matchOver && lp && lp.alive && !e.repeat) {
      if (G.Powers && G.Powers.onKeyDown) G.Powers.onKeyDown(code);
    }
  });
  window.addEventListener('keyup', function (e) {
    G.keys.delete(e.code);
    if (inputFocused()) return;
    if (G.running && GAME_KEYS[e.code] && e.preventDefault) e.preventDefault();
  });
  window.addEventListener('blur', function () { G.keys.clear(); });
  window.addEventListener('resize', resize);

  // ===========================================================================
  // 네트워크 핸들러 (한 번만 등록)
  // ===========================================================================
  function bindNet() {
    if (netBound) return;
    if (!G.Net || typeof G.Net.on !== 'function') return;
    netBound = true;
    G.Net.on('state', onRemoteState);
    G.Net.on('ko', onRemoteKo);
    G.Net.on('matchEnd', onRemoteMatchEnd);
    G.Net.on('bots', onRemoteBots);
    G.Net.on('score', onRemoteScore);
    G.Net.on('lives', onRemoteLives);
    G.Net.on('bossOver', onRemoteBossOver);
  }

  window.addEventListener('net:peerleave', function (e) {
    var id = e && e.detail ? e.detail.id : null;
    if (id != null) removeOther(id);
  });
  window.addEventListener('net:roster', function (e) {
    // 로스터에 없는 원격 플레이어 정리 (안전망)
    var peers = (e && e.detail && e.detail.peers) || [];
    var keep = {};
    for (var i = 0; i < peers.length; i++) if (peers[i]) keep[peers[i].id] = 1;
    var os = players.list();
    for (var k = 0; k < os.length; k++) if (!os[k].isBot && !keep[os[k].id]) removeOther(os[k].id);
  });

  function isOnline() { return G.mode === 'host' || G.mode === 'guest'; }
  function isHost() { return G.mode === 'host'; }

  function myId() {
    if (isOnline() && G.Net && G.Net.myId != null) return G.Net.myId;
    return 'h';
  }

  function netSend(msg, toId) {
    if (G.Net && typeof G.Net.send === 'function') {
      if (toId != null) G.Net.send(msg, toId); else G.Net.send(msg);
    }
  }

  function slotFor(id) {
    var s = -1;
    if (G.Net && typeof G.Net.slotOf === 'function') {
      try { s = G.Net.slotOf(id); } catch (err) { s = -1; }
    }
    if (typeof s === 'number' && s >= 0 && s < 8) return s;
    // 모르면 비어 있는 가장 낮은 슬롯
    var used = {};
    var all = players.all();
    for (var i = 0; i < all.length; i++) used[all[i].slot] = 1;
    for (var k = 0; k < 8; k++) if (!used[k]) return k;
    return 0;
  }

  function playerName(id) {
    var p = players.byId(id);
    if (p) return p.name;
    if (id == null) return '';
    var s = -1;
    if (G.Net && typeof G.Net.slotOf === 'function') { try { s = G.Net.slotOf(id); } catch (err) { s = -1; } }
    return s >= 0 ? slotInfo(s).name : String(id);
  }

  function addOther(id) {
    var p = makePlayer(false, slotFor(id), id);
    players.others[id] = p;
    if (!(id in G.scores)) G.scores[id] = 0;
    emit('playerJoin', { id: id, name: p.name, slot: p.slot });
    return p;
  }

  function removeOther(id) {
    var p = Object.prototype.hasOwnProperty.call(players.others, id) ? players.others[id] : null;
    if (!p) return;
    delete players.others[id];
    delete G.scores[id];
    syncScore();
    hudCache.sbKey = null;
    emit('playerLeave', { id: id, name: p.name, slot: p.slot });
  }

  function onRemoteState(m) {
    if (!m || !isOnline() || !G.running) return;
    var id = m.from;
    if (id == null || id === myId()) return;
    var r = players.others[id];
    if (!r) r = addOther(id);
    applyState(r, m, (typeof m.gy === 'number') ? (G.world.groundY - m.gy) : 0);
  }

  // 원격(또는 호스트가 보낸 봇) 상태를 플레이어 객체에 적용 — 보간 목표 설정
  function applyState(r, m, gyOff) {
    var tx = +m.x || 0, ty = (+m.y || 0) + gyOff;
    var wasAlive = r.alive;
    var nowAlive = m.alive !== false;
    r._tx = tx; r._ty = ty;
    r._tvx = +m.vx || 0; r._tvy = +m.vy || 0;
    r._age = 0;
    if (!r._hasState || (!wasAlive && nowAlive) || Math.abs(tx - r.x) > 450 || Math.abs(ty - r.y) > 450) {
      r.x = tx; r.y = ty;
    }
    var firstState = !r._hasState;
    r._hasState = true;
    r.vx = r._tvx; r.vy = r._tvy;
    r.facing = m.facing === -1 ? -1 : 1;
    r.onGround = !!m.onGround;
    if (typeof m.hp === 'number') {
      if (m.hp < r.hp && nowAlive && !firstState) r.hitFlash = 0.15;
      r.hp = m.hp;
    }
    if (typeof m.energy === 'number') r.energy = m.energy;
    if (typeof m.anim === 'string') r.anim = m.anim;
    if (typeof m.inv === 'number') r.invulnTimer = m.inv;
    if (typeof m.boost === 'number') r.boostTimer = m.boost;
    r.alive = nowAlive;
    if (!firstState) {
      if (wasAlive && !nowAlive) koBurst(r);
      if (!wasAlive && nowAlive) respawnBurst(r);
    }
  }

  // ---- 봇 (호스트가 시뮬레이션, 20Hz 묶음 방송) ----
  function setPlayerSlot(p, slot) {
    slot = ((slot | 0) % 8 + 8) % 8;
    var info = slotInfo(slot);
    p.slot = slot;
    p.pal = info.pal;
    p.color = info.pal.cloak;
    p.name = p.isBot ? 'AI ' + info.name : info.name;
    p._spawnX = SLOT_SPAWN_X[slot];
    hudCache.sbKey = null;
  }

  // 봇 플레이어 객체 생성 + 등록 (권한측 봇 생성, 게스트의 봇 표시 공용)
  function addBotPlayer(id, slot, sim) {
    var p = players.others[id];
    if (!p) {
      p = makePlayer(false, slot, id);
      p.isBot = true;
      players.others[id] = p;
      if (!(id in G.scores)) G.scores[id] = 0;
      setPlayerSlot(p, slot);
      emit('playerJoin', { id: id, name: p.name, slot: p.slot, bot: true });
    } else if (p.slot !== slot) {
      setPlayerSlot(p, slot);
    }
    p.isBot = true;
    p._sim = !!sim;
    if (sim) p._hasState = true;
    hudCache.sbKey = null;
    return p;
  }

  function onRemoteBots(m) {
    if (!m || G.mode !== 'guest' || !G.running) return;
    if (m.from != null && m.from !== 'h') return;
    var list = Array.isArray(m.list) ? m.list : [];
    var gyOff = (typeof m.gy === 'number') ? (G.world.groundY - m.gy) : 0;
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || typeof s.id !== 'string' || s.id === myId()) continue;
      seen[s.id] = 1;
      var r = addBotPlayer(s.id, s.slot, false);
      if (typeof s.el === 'string') r.element = s.el;
      applyState(r, s, gyOff);
    }
    var os = players.list();
    for (var k = 0; k < os.length; k++) if (os[k].isBot && !seen[os[k].id]) removeOther(os[k].id);
  }

  function botStateList() {
    var out = [];
    var os = players.list();
    for (var i = 0; i < os.length; i++) {
      var p = os[i];
      if (!p.isBot || !p._sim) continue;
      out.push({
        id: p.id, slot: p.slot, el: p.element || null,
        x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx), vy: Math.round(p.vy),
        facing: p.facing, onGround: p.onGround,
        hp: Math.round(p.hp * 10) / 10, energy: Math.round(p.energy), alive: p.alive, anim: p.anim,
        inv: p.invulnTimer > 0.3 ? Math.round(p.invulnTimer * 10) / 10 : 0,
        boost: p.boostTimer > 0 ? Math.round(p.boostTimer * 10) / 10 : 0
      });
    }
    return out;
  }

  var botsSentAny = false;
  function sendBots() {
    var list = botStateList();
    if (!list.length && !botsSentAny) return;
    botsSentAny = list.length > 0;
    netSend({ t: 'bots', list: list, gy: G.world.groundY });
  }

  // 봇이 있는 연습(AI 대전) — 점수판/승리 판정 사용
  function botsActive() {
    return !!(G.Bots && typeof G.Bots.count === 'function' && G.Bots.count() > 0);
  }
  function scoringOn() { return isOnline() || botsActive() || !!G.bossMode; }
  // 승패/점수 권한: 온라인 호스트, 또는 연습
  function scoreAuthority() { return isHost() || (G.mode === 'practice' && (botsActive() || !!G.bossMode)); }

  // 권한측 전용: 점수 n 추가 (보스 처치 등). 방송 + 승리 판정
  function awardPoint(id, n, reason) {
    if (id == null || !(isHost() || G.mode === 'practice') || G.matchOver) return false;
    n = (typeof n === 'number' && isFinite(n)) ? n : 1;
    G.scores[id] = (G.scores[id] || 0) + n;
    syncScore();
    hudCache.sbKey = null;
    if (isOnline()) netSend({ t: 'score', id: id, n: n, reason: reason || null, total: G.scores[id] });
    emit('score', { id: id, n: n, reason: reason || null, name: playerName(id) });
    checkWin();
    return true;
  }

  function onRemoteScore(m) {
    if (!m || !isOnline() || G.matchOver || m.from !== 'h' || m.id == null) return;
    if (typeof m.total === 'number') G.scores[m.id] = m.total;
    else G.scores[m.id] = (G.scores[m.id] || 0) + (+m.n || 0);
    syncScore();
    hudCache.sbKey = null;
    emit('score', { id: m.id, n: +m.n || 0, reason: m.reason || null, name: playerName(m.id) });
  }

  // 점수 1점 추가 (모든 클라이언트가 같은 ko 메시지로 동일하게 계산)
  function creditKill(killerId, victimId) {
    if (killerId != null && killerId !== victimId) {
      G.scores[killerId] = (G.scores[killerId] || 0) + 1;
    }
    syncScore();
    hudCache.sbKey = null;
    emit('ko', { by: killerId, victim: victimId, byName: killerId != null ? playerName(killerId) : '', victimName: playerName(victimId) });
    if (killerId != null && killerId === myId()) {
      toast('KO!');
      shake(8);
      emit('oppKO', { victim: victimId });
    }
    checkWin();
  }

  function onRemoteKo(m) {
    if (!m || !isOnline() || !G.running || G.matchOver) return;
    var victim = m.from;
    // 호스트는 봇의 KO 를 victim 필드로 알린다
    if (m.victim != null && m.victim !== '' && m.from === 'h') victim = m.victim;
    if (victim == null || victim === myId()) return;
    var by = (m.by == null || m.by === '') ? null : m.by;
    creditKill(by, victim);
    if (G.bossMode && isHost()) loseLife(victim);   // 손님(사람)의 KO → 공유 목숨 감소
  }

  function onRemoteMatchEnd(m) {
    if (!m || !isOnline()) return;
    if (m.from != null && m.from !== 'h') return;   // 호스트만 판정
    if (m.scores && typeof m.scores === 'object') applyScores(m.scores);
    endMatch(m.winner);
  }

  function applyScores(sc) {
    for (var k in sc) {
      if (Object.prototype.hasOwnProperty.call(sc, k) && typeof sc[k] === 'number') G.scores[k] = sc[k];
    }
    syncScore();
    hudCache.sbKey = null;
  }

  function syncScore() {
    var me = myId();
    G.score.me = G.scores[me] || 0;
    var best = 0;
    for (var k in G.scores) {
      if (k !== me && Object.prototype.hasOwnProperty.call(G.scores, k) && G.scores[k] > best) best = G.scores[k];
    }
    G.score.opp = best;
  }

  function emit(name, data) {
    if (G.events && G.events.emit) G.events.emit(name, data);
  }

  bindNet();

  // ===========================================================================
  // 공개 헬퍼
  // ===========================================================================
  function rectHit(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function pushParticle(p) {
    if (muteDepth > 0) return;
    var arr = (G.particles === povParticles) ? realParticles : G.particles;
    if (arr.length >= MAX_PARTICLES) arr.shift();
    arr.push(p);
  }

  function spawnParticles(x, y, count, color, speed) {
    count = count == null ? 12 : count;
    speed = speed == null ? 220 : speed;
    color = color || '#ffffff';
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = speed * (0.25 + Math.random() * 0.75);
      var life = 0.35 + Math.random() * 0.55;
      pushParticle({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life, maxLife: life,
        size: 2 + Math.random() * 3.5,
        color: color,
        gravity: 320
      });
    }
  }

  function spawnDust(x, y, n) {
    for (var i = 0; i < n; i++) {
      var life = 0.3 + Math.random() * 0.4;
      pushParticle({
        x: x + (Math.random() - 0.5) * 24, y: y - 2,
        vx: (Math.random() - 0.5) * 220, vy: -40 - Math.random() * 90,
        life: life, maxLife: life, size: 2 + Math.random() * 3,
        color: 'rgba(150,140,110,1)', gravity: 260
      });
    }
  }

  function koBurst(p) {
    var cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    var pal = palOf(p);
    spawnParticles(cx, cy, 30, '#ff5040', 460);
    spawnParticles(cx, cy, 22, pal.cloak, 380);
    spawnParticles(cx, cy, 14, '#fff1c4', 260);
    for (var i = 0; i < 18; i++) {
      var a = Math.random() * Math.PI * 2, s = 100 + Math.random() * 380;
      var life = 0.5 + Math.random() * 0.5;
      pushParticle({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: life, maxLife: life,
        size: 4 + Math.random() * 5, color: '#ffb347', gravity: 200, glow: true });
    }
    // 멀리 떨어진 다른 사람의 KO 로 화면이 흔들리지 않게
    if (p.isLocal) shake(10);
    else if (cx > G.camera.x - 80 && cx < G.camera.x + G.width + 80) shake(5);
  }

  function respawnBurst(p) {
    var cx = p.x + p.w / 2;
    var pal = palOf(p);
    for (var i = 0; i < 22; i++) {
      var a = (i / 22) * Math.PI * 2;
      var life = 0.7 + Math.random() * 0.3;
      pushParticle({ x: cx + Math.cos(a) * 26, y: p.y + p.h - 4, vx: Math.cos(a) * 50, vy: -140 - Math.random() * 140,
        life: life, maxLife: life, size: 3, color: pal.trim, glow: true });
    }
  }

  // attackerId: 나에게 피해를 준 플레이어의 net id (돌연변이/환경은 생략)
  function damagePlayer(amount, kx, ky, attackerId) {
    var p = G.players.local;
    // 봇 시점 시뮬레이션(pov) 중이면 그 봇이 맞은 것
    if (p && p.isBot) return G.Bots && typeof G.Bots.damage === 'function' ? G.Bots.damage(p, amount, kx, ky, attackerId) : false;
    if (!p || !p.alive || p.invulnTimer > 0 || G.matchOver) return false;
    var me = myId();
    if (attackerId != null && attackerId !== '' && attackerId !== me && attackerId !== 'local') {
      // 보스전: PvP 없음 — 다른 플레이어/AI 동료의 공격은 무시
      if (G.bossMode) return false;
      lastAttacker = { id: attackerId, t: G.time };
    } else {
      attackerId = null;
    }
    amount = +amount || 0;
    if (p.boostTimer > 0) amount *= BOOST_ARMOR;
    p.hp -= amount;
    p.vx += +kx || 0;
    p.vy += +ky || 0;
    p.onGround = false;
    p._plat = null;
    p.hitFlash = 0.15;
    p.invulnTimer = 0.25;
    shake(6);
    spawnParticles(p.x + p.w / 2, p.y + p.h * 0.4, 14, '#ff3b30', 260);
    emit('playerDamaged', { amount: amount, by: attackerId });
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.respawnTimer = RESPAWN_TIME;
      p.vx = 0; p.vy = 0;
      koBurst(p);
      // KO 기여: 직접 공격자 → 6초 이내 마지막 공격자 → 없음
      var killer = attackerId;
      if (killer == null && lastAttacker && G.time - lastAttacker.t <= KO_CREDIT_TIME) killer = lastAttacker.id;
      lastAttacker = null;
      toast('KO!');
      emit('playerKO', { by: killer });
      if (scoringOn()) {
        if (isOnline()) netSend({ t: 'ko', by: killer });
        creditKill(killer, me);
      }
      if (G.bossMode) loseLife(me);
    }
    return true;
  }

  // ===========================================================================
  // 보스전 — 공유 목숨 (사람 KO 10번이면 끝) · 권한측(호스트/연습)이 세고 방송
  // ===========================================================================
  var BOSS_LIVES = 10;
  var bossDefeats = 0;          // bossDefeated 이벤트 수 (Mutants.bossesKilled 가 없을 때 대비)
  G.bossLives = { left: BOSS_LIVES, max: BOSS_LIVES };
  G.bossResult = null;
  if (G.events && typeof G.events.on === 'function') {
    G.events.on('bossDefeated', function (d) {
      if (!G.bossMode) return;
      bossDefeats = Math.max(bossDefeats + 1, d && typeof d.count === 'number' ? d.count : 0);
    });
  }
  function bossKillCount() {
    var n = G.Mutants && typeof G.Mutants.bossesKilled === 'number' ? G.Mutants.bossesKilled : 0;
    return Math.max(n | 0, bossDefeats);
  }
  function resetBossState(left) {
    bossDefeats = 0;
    G.bossResult = null;
    G.bossLives.left = (typeof left === 'number' && left >= 0) ? Math.min(BOSS_LIVES, left | 0) : BOSS_LIVES;
    hudCache.lives = null;
  }
  function livesAuthority() { return isHost() || G.mode === 'practice'; }
  // 사람 플레이어(봇 제외)가 쓰러졌을 때 권한측에서 호출
  function loseLife(victimId) {
    if (!G.bossMode || G.matchOver || !livesAuthority()) return;
    var v = players.byId(victimId);
    if (v && v.isBot) return;
    G.bossLives.left = Math.max(0, G.bossLives.left - 1);
    if (isOnline()) netSend({ t: 'lives', left: G.bossLives.left });
    livesChanged();
    if (G.bossLives.left <= 0) {
      var res = { bosses: bossKillCount(), time: Math.round(G.time * 10) / 10 };
      if (isOnline()) netSend({ t: 'bossOver', bosses: res.bosses, time: res.time, scores: G.scores });
      endBossMatch(res);
    }
  }
  function livesChanged() {
    hudCache.lives = null;
    if (G.bossLives.left > 0) toast('남은 목숨 ' + G.bossLives.left + '/' + BOSS_LIVES, 'small');
    emit('livesChanged', { left: G.bossLives.left, max: BOSS_LIVES });
  }
  function onRemoteLives(m) {
    if (!m || !isOnline() || m.from !== 'h' || typeof m.left !== 'number') return;
    if (m.left === G.bossLives.left) return;
    G.bossLives.left = Math.max(0, Math.min(BOSS_LIVES, m.left | 0));
    livesChanged();
  }
  function onRemoteBossOver(m) {
    if (!m || !isOnline() || m.from !== 'h') return;
    if (m.scores && typeof m.scores === 'object') applyScores(m.scores);
    G.bossLives.left = 0;
    hudCache.lives = null;
    endBossMatch({ bosses: +m.bosses || 0, time: +m.time || G.time });
  }
  function endBossMatch(res) {
    G.matchOver = true;
    if (matchEndSent) return;
    matchEndSent = true;
    G.bossResult = res;
    var detail = { bossMode: true, won: false, winner: null, winnerName: '', bosses: res.bosses, time: res.time };
    emit('matchEnd', detail);
    try { window.dispatchEvent(new CustomEvent('game:matchend', { detail: detail })); } catch (err) { /* 무시 */ }
  }

  function shake(amount) {
    if (muteDepth > 0) return;
    shakeAmt = Math.min(40, Math.max(shakeAmt, 0) + (amount || 0));
  }

  // kind === 'small' → 작은 알림 (입/퇴장 등)
  function toast(text, kind) {
    if (muteDepth > 0) return;
    var el = document.getElementById ? document.getElementById('toast') : null;
    if (!el) return;
    el.textContent = text;
    if (el.classList) {
      el.classList.toggle('small', kind === 'small');
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (el.classList) el.classList.remove('show');
      toastTimer = null;
    }, kind === 'small' ? 2200 : 1400);
  }

  // 호스트만 승패를 판정해 방송한다
  function checkWin() {
    if (G.matchOver || !scoreAuthority() || G.bossMode) return;   // 보스전은 목숨으로만 끝남
    var winner = null, best = -1;
    for (var k in G.scores) {
      if (!Object.prototype.hasOwnProperty.call(G.scores, k)) continue;
      if (G.scores[k] >= G.winScore && G.scores[k] > best) { best = G.scores[k]; winner = k; }
    }
    if (winner == null) return;
    if (isOnline()) netSend({ t: 'matchEnd', winner: winner, scores: G.scores });
    endMatch(winner);
  }

  function endMatch(winner) {
    G.matchOver = true;
    if (matchEndSent) return;
    matchEndSent = true;
    var won = winner != null && winner === myId();
    var winnerName = winner != null ? playerName(winner) : '';
    emit('matchEnd', { won: won, winner: winner, winnerName: winnerName });
    try {
      window.dispatchEvent(new CustomEvent('game:matchend', { detail: { won: won, winner: winner, winnerName: winnerName } }));
    } catch (err) { /* 무시 */ }
  }

  // ===========================================================================
  // 플레이어
  // ===========================================================================
  function makePlayer(isLocal, slot, id) {
    slot = (slot | 0) % 8;
    var info = slotInfo(slot);
    var x = SLOT_SPAWN_X[slot];
    return {
      id: id, slot: slot, name: info.name, pal: info.pal,
      x: x, y: G.world.groundY - PH, w: PW, h: PH, vx: 0, vy: 0,
      facing: x < WORLD_W / 2 ? 1 : -1, onGround: true,
      hp: 100, maxHp: 100, energy: 100, maxEnergy: 100,
      invulnTimer: 0, frozen: 0, alive: true, respawnTimer: 0, hitFlash: 0,
      slowTimer: 0, rootTimer: 0, boostTimer: 0,
      anim: 'idle', castTimer: 0, isLocal: isLocal,
      color: info.pal.cloak,
      // 내부용
      _spawnX: x, _walk: 0, _plat: null, _drop: 0, _wasGround: true
    };
  }

  function resetPlayer(p) {
    if (!p) return;
    p.x = p._spawnX; p.y = G.world.groundY - p.h;
    p.vx = 0; p.vy = 0; p.onGround = true;
    p.facing = p._spawnX < WORLD_W / 2 ? 1 : -1;
    p.hp = p.maxHp; p.energy = p.maxEnergy;
    p.invulnTimer = 0; p.frozen = 0; p.alive = true; p.respawnTimer = 0;
    p.slowTimer = 0; p.rootTimer = 0; p.boostTimer = 0;
    p.hitFlash = 0; p.anim = 'idle'; p.castTimer = 0;
    p._plat = null; p._drop = 0; p._walk = 0;
    p._hasState = false;
  }

  function createPlayers() {
    var id = myId();
    var slot = isOnline() ? slotFor(id) : 0;
    players.others = {};
    players.local = null;
    players.local = makePlayer(true, slot, id);
  }

  function resetScores(initial) {
    G.scores = {};
    var all = players.all();
    for (var i = 0; i < all.length; i++) G.scores[all[i].id] = 0;
    if (initial) applyScores(initial);
    syncScore();
  }

  // ===========================================================================
  // 시작 / 재시작
  // ===========================================================================
  // opts: { mode, scores? } — scores 는 진행 중인 판에 늦게 들어온 경우 호스트가 보낸 현재 점수
  function start(opts) {
    opts = opts || {};
    bindNet();
    if (!G.width) resize();
    G.mode = opts.mode || 'practice';
    G.bossMode = !!opts.bossMode;          // 보스전 (PvP 없음 · 공유 목숨)
    G.world.platformsLocked = false;
    resetBossState(opts.lives);
    G.time = 0;
    G.matchOver = false;
    matchEndSent = false;
    lastAttacker = null;
    G.particles.length = 0;
    shakeAmt = 0;
    coyoteTimer = 0; jumpBufferTimer = 0; stateTimer = 0;
    G.keys.clear();
    createPlayers();
    botsSentAny = false;
    if (G.Bots && typeof G.Bots.onStart === 'function') {
      try { G.Bots.onStart(); } catch (err) { if (window.console) console.error('[world] Bots.onStart', err); }
    }
    resetScores(opts.scores);
    snapCamera();
    G.running = true;
    if (G.Mutants && G.Mutants.init) G.Mutants.init({ mode: G.mode, bossMode: !!G.bossMode });
    if (G.Items && G.Items.init) G.Items.init();
    if (G.Missions && G.Missions.init) G.Missions.init({ mode: G.mode });
    if (G.Powers && G.Powers.init) G.Powers.init();
    hudCache = {};
    updateHud();
    emit('matchStart', { mode: G.mode });
    startLoop();
  }

  function restartMatch() {
    G.matchOver = false;
    matchEndSent = false;
    lastAttacker = null;
    G.time = 0;
    G.particles.length = 0;
    resetPlayer(G.players.local);
    var os = players.list();
    for (var i = 0; i < os.length; i++) resetPlayer(os[i]);
    if (G.Bots && typeof G.Bots.onRestart === 'function') {
      try { G.Bots.onRestart(); } catch (err) { if (window.console) console.error('[world] Bots.onRestart', err); }
    }
    resetScores();
    G.world.platformsLocked = false;
    resetBossState();
    coyoteTimer = 0; jumpBufferTimer = 0;
    snapCamera();
    if (G.Mutants && G.Mutants.init) G.Mutants.init({ mode: G.mode, bossMode: !!G.bossMode });
    if (G.Items && G.Items.init) G.Items.init();
    if (G.Missions && G.Missions.init) G.Missions.init({ mode: G.mode });
    if (G.Powers && G.Powers.init) G.Powers.init();
    G.running = true;
    hudCache = {};
    updateHud();
    emit('matchStart', { mode: G.mode });
  }

  function snapCamera() {
    var p = G.players.local;
    if (!p) return;
    G.camera.x = p.x + p.w / 2 - G.width / 2;
    clampCamera();
  }

  // ===========================================================================
  // 업데이트
  // ===========================================================================
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    G.time += dt;

    // 1. 로컬 / 원격 / 파티클 / 카메라
    updateLocal(dt);
    // 봇 (권한측 시뮬레이션: AI + 같은 물리)
    if (G.Bots && typeof G.Bots.update === 'function') {
      try { G.Bots.update(dt); } catch (err) { if (window.console) console.error('[world] Bots.update', err); }
    }
    updateRemote(dt);
    updateParticles(dt);
    updateCamera(dt);

    // 2. 돌연변이
    if (G.Mutants && G.Mutants.update) G.Mutants.update(dt);
    // 2-1. 아이템
    if (G.Items && G.Items.update) G.Items.update(dt);
    // 3. 기술
    if (G.Powers && G.Powers.update) G.Powers.update(dt);
    // 4. 미션
    if (G.Missions && G.Missions.update) G.Missions.update(dt);

    // 흔들림 감쇠
    if (shakeAmt > 0.05) {
      shakeX = (Math.random() * 2 - 1) * shakeAmt;
      shakeY = (Math.random() * 2 - 1) * shakeAmt;
      shakeAmt *= Math.exp(-9 * dt);
    } else {
      shakeAmt = 0; shakeX = 0; shakeY = 0;
    }

    // 상태 송신
    if (isOnline() && G.Net && G.Net.connected) {
      stateTimer += dt;
      if (stateTimer >= STATE_INTERVAL) {
        stateTimer = stateTimer % STATE_INTERVAL;
        sendState();
      }
    }

    updateHud();
  }

  function sendState() {
    if (isHost()) sendBots();
    var p = G.players.local;
    if (!p) return;
    netSend({
      t: 'state',
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
      vx: Math.round(p.vx), vy: Math.round(p.vy),
      facing: p.facing, onGround: p.onGround,
      hp: p.hp, energy: Math.round(p.energy), alive: p.alive, anim: p.anim,
      inv: p.invulnTimer > 0.3 ? Math.round(p.invulnTimer * 10) / 10 : 0,
      gy: G.world.groundY
    });
  }

  function tickTimers(p, dt) {
    if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
    if (p.frozen > 0) p.frozen = Math.max(0, p.frozen - dt);
    if (p.castTimer > 0) p.castTimer = Math.max(0, p.castTimer - dt);
    if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt);
    if (p._drop > 0) p._drop = Math.max(0, p._drop - dt);
    if (p.slowTimer > 0) p.slowTimer = Math.max(0, p.slowTimer - dt);
    if (p.rootTimer > 0) p.rootTimer = Math.max(0, p.rootTimer - dt);
    if (p.boostTimer > 0) p.boostTimer = Math.max(0, p.boostTimer - dt);
  }

  function updateLocal(dt) {
    var p = G.players.local;
    if (!p) return;
    var keys = G.keys;

    if (!p.alive) {
      tickTimers(p, dt);
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        resetPlayer(p);
        p.invulnTimer = 1.5;
        respawnBurst(p);
      }
      return;
    }

    var dir = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dir -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dir += 1;
    var input = {
      dir: dir,
      down: keys.has('KeyS') || keys.has('ArrowDown'),
      jumpHeld: keys.has('KeyW') || keys.has('Space') || keys.has('ArrowUp'),
      jumpPressed: jumpBufferTimer > 0
    };
    jumpBufferTimer = 0;
    stepPlayer(p, input, dt);
  }

  // 입력 기반 플레이어 물리 — 로컬 플레이어와 봇이 같은 함수로 움직인다.
  // input = { dir: -1|0|1, down: bool, jumpHeld: bool, jumpPressed: bool(이번 프레임 새로 누름) }
  // 타이머 감소 + 에너지 회복 + 이동/점프/발판/지면 + 애니메이션. 리스폰은 호출측 담당.
  function stepPlayer(p, input, dt) {
    if (!p) return;
    input = input || {};
    var g = G.world.groundY;
    tickTimers(p, dt);
    if (!p.alive) return;
    var isMine = p === players.real();

    p.energy = Math.min(p.maxEnergy, p.energy + ENERGY_REGEN * dt);

    var controllable = !G.matchOver && !(p.frozen > 0);
    var rooted = p.rootTimer > 0;
    var maxSpeed = MAX_SPEED * (p.slowTimer > 0 ? 0.5 : 1) * (p.boostTimer > 0 ? BOOST_SPEED : 1);
    var dir = 0;
    if (controllable && !rooted) dir = input.dir > 0 ? 1 : (input.dir < 0 ? -1 : 0);

    if (dir !== 0) {
      p.facing = dir;
      var acc = p.onGround ? ACCEL_GROUND : ACCEL_AIR;
      if (p.vx * dir < 0) acc *= 1.8;
      if (Math.abs(p.vx) > maxSpeed) {
        var over = Math.abs(p.vx) - maxSpeed;
        p.vx = (p.vx > 0 ? 1 : -1) * (maxSpeed + over * Math.exp(-8 * dt));
      } else {
        p.vx = clamp(p.vx + dir * acc * dt, -maxSpeed, maxSpeed);
      }
    } else {
      var dec = (p.onGround ? DECEL_GROUND : DECEL_AIR) * dt;
      if (Math.abs(p.vx) <= dec) p.vx = 0;
      else p.vx -= (p.vx > 0 ? 1 : -1) * dec;
    }

    // 아래로 통과
    var downHeld = controllable && !!input.down;
    if (downHeld) {
      if (p.onGround && p._plat) { p.onGround = false; p._plat = null; p.y += 2; }
      p._drop = DROP_TIME;
    }

    // 점프 (코요테 + 버퍼, 플레이어별)
    if (input.jumpPressed) p._jbuf = JUMP_BUFFER;
    if (p.onGround) p._coyote = COYOTE; else p._coyote = (p._coyote || 0) - dt;
    if (p._jbuf > 0) p._jbuf -= dt;
    if (controllable && !rooted && p._jbuf > 0 && p._coyote > 0 && !downHeld) {
      p.vy = JUMP_VY * (p.boostTimer > 0 ? BOOST_JUMP : 1);
      p.onGround = false;
      p._plat = null;
      p._coyote = 0; p._jbuf = 0;
      spawnDust(p.x + p.w / 2, p.y + p.h, 8);
      if (isMine) emit('jump', {});
    }
    if (!input.jumpHeld && p.vy < -320) p.vy += 4000 * dt;

    p.vy += G.gravity * dt;
    if (p.vy > 1800) p.vy = 1800;

    var prevBottom = p.y + p.h;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // 맵 경계
    if (p.x < 0) { p.x = 0; if (p.vx < 0) p.vx = 0; }
    if (p.x + p.w > WORLD_W) { p.x = WORLD_W - p.w; if (p.vx > 0) p.vx = 0; }
    if (p.y < -400) { p.y = -400; if (p.vy < 0) p.vy = 0; }

    var landedVy = p.vy;
    var wasGround = p._wasGround;
    p.onGround = false;
    p._plat = null;

    // 한 방향 발판 (보스가 살아 있는 동안 봉쇄: 착지 불가 → 지면으로 떨어진다)
    if (p.vy >= 0 && !(p._drop > 0) && !G.world.platformsLocked) {
      var newBottom = p.y + p.h;
      var plats = G.world.platforms;
      var best = null;
      for (var i = 0; i < plats.length; i++) {
        var pl = plats[i];
        if (p.x + p.w <= pl.x + 2 || p.x >= pl.x + pl.w - 2) continue;
        if (prevBottom <= pl.y + 0.5 && newBottom >= pl.y) {
          if (!best || pl.y < best.y) best = pl;
        }
      }
      if (best) {
        p.y = best.y - p.h;
        p.vy = 0;
        p.onGround = true;
        p._plat = best;
      }
    }

    // 지면
    if (!p.onGround && p.y + p.h >= g) {
      p.y = g - p.h;
      if (p.vy > 0) p.vy = 0;
      p.onGround = true;
    }

    if (p.onGround && !wasGround && landedVy > 500) {
      spawnDust(p.x + p.w / 2, p.y + p.h, Math.min(16, Math.floor(landedVy / 90)));
    }
    if (p.onGround && !wasGround && isMine) emit('land', { platform: p._plat ? p._plat.kind : null });
    p._wasGround = p.onGround;

    stepWalk(p, dt);
    p.anim = p.castTimer > 0 ? 'cast' : (!p.onGround ? 'jump' : (Math.abs(p.vx) > 20 ? 'run' : 'idle'));
  }

  function stepWalk(p, dt) {
    if (p.onGround && Math.abs(p.vx) > 5) p._walk += Math.abs(p.vx) * dt * 0.045;
    else if (p.onGround) p._walk += (Math.round(p._walk / Math.PI) * Math.PI - p._walk) * Math.min(1, dt * 12);
  }

  function updateRemote(dt) {
    var os = players.list();
    for (var i = 0; i < os.length; i++) if (!os[i]._sim) updateOne(os[i], dt);
  }

  function updateOne(r, dt) {
    if (r.hitFlash > 0) r.hitFlash = Math.max(0, r.hitFlash - dt);
    if (r.invulnTimer > 0) r.invulnTimer = Math.max(0, r.invulnTimer - dt);
    if (r.castTimer > 0) r.castTimer = Math.max(0, r.castTimer - dt);
    if (r.frozen > 0) r.frozen = Math.max(0, r.frozen - dt);
    if (!r._hasState) return;
    r._age = (r._age || 0) + dt;
    if (r._age < 0.12) {
      r._tx += r._tvx * dt;
      r._ty += r._tvy * dt;
    }
    var k = 1 - Math.pow(0.75, dt * 60);
    r.x = lerp(r.x, r._tx, k);
    r.y = lerp(r.y, r._ty, k);
    if (r.y + r.h > G.world.groundY) r.y = G.world.groundY - r.h;
    stepWalk(r, dt);
  }

  function updateParticles(dt) {
    var ps = G.particles;
    var n = 0;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.gravity) p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ps[n++] = p;
    }
    ps.length = n;
  }

  function updateCamera(dt) {
    var p = G.players.local;
    if (!p) return;
    var look = p.facing * Math.min(110, G.width * 0.08);
    var target = p.x + p.w / 2 - G.width / 2 + look;
    G.camera.x += (target - G.camera.x) * (1 - Math.exp(-5 * dt));
    clampCamera();
  }

  // ===========================================================================
  // HUD
  // ===========================================================================
  function hudEl(id) {
    var el = hudCache['#' + id];
    if (!el) {
      el = document.getElementById ? document.getElementById(id) : null;
      if (el) hudCache['#' + id] = el;
    }
    return el;
  }
  function setWidth(id, ratio) {
    var v = clamp(ratio * 100, 0, 100).toFixed(1) + '%';
    if (hudCache['w' + id] === v) return;
    var el = hudEl(id);
    if (el && el.style) { el.style.width = v; hudCache['w' + id] = v; }
  }
  function setText(id, t) {
    t = String(t);
    if (hudCache['t' + id] === t) return;
    var el = hudEl(id);
    if (el) { el.textContent = t; hudCache['t' + id] = t; }
  }
  function updateHud() {
    var p = G.players.local;
    if (p) {
      setWidth('hp-fill', p.hp / p.maxHp);
      setWidth('energy-fill', p.energy / p.maxEnergy);
      if (hudCache.meSlot !== p.slot) {
        hudCache.meSlot = p.slot;
        var mn = hudEl('me-name');
        if (mn) {
          mn.textContent = '나 · ' + p.name;
          if (mn.style) {
            mn.style.color = p.pal.trim;
            mn.style.textShadow = '0 0 6px ' + p.pal.glow;
          }
        }
      }
    }
    updateLivesHud();
    updateScoreboard();
  }

  // 보스전: "남은 목숨 n/10"
  function updateLivesHud() {
    var key = G.bossMode ? G.bossLives.left : -1;
    if (hudCache.lives === key) return;
    hudCache.lives = key;
    var el = hudEl('lives-hud');
    if (!el) return;
    el.hidden = !G.bossMode;
    if (!G.bossMode) return;
    var n = hudEl('lives-n');
    if (n) n.textContent = String(G.bossLives.left);
    var mx = hudEl('lives-max');
    if (mx) mx.textContent = String(G.bossLives.max);
    if (el.classList) el.classList.toggle('low', G.bossLives.left <= 3);
  }

  // 모든 플레이어 점수판: 색 / 이름 / 킬 / 작은 HP 바 (킬 순)
  function updateScoreboard() {
    var box = hudEl('sb-rows');
    if (!box) return;
    var all = players.all();
    var me = myId();
    all.sort(function (a, b) {
      var d = (G.scores[b.id] || 0) - (G.scores[a.id] || 0);
      return d !== 0 ? d : a.slot - b.slot;
    });
    var key = '', i, q;
    for (i = 0; i < all.length; i++) {
      q = all[i];
      key += q.id + ':' + (G.scores[q.id] || 0) + ':' + (q.alive ? 1 : 0) + '|';
    }
    if (hudCache.sbKey !== key) {
      hudCache.sbKey = key;
      hudCache.sbFill = {};
      var html = '';
      for (i = 0; i < all.length; i++) {
        q = all[i];
        var isMe = q.id === me;
        html += '<div class="sb-row' + (isMe ? ' me' : '') + (q.alive ? '' : ' dead') + '">' +
          '<i class="sb-sw" style="background:' + q.pal.cloak + ';box-shadow:0 0 6px ' + q.pal.glow + '"></i>' +
          '<span class="sb-name">' + q.name + (isMe ? ' <em>나</em>' : '') + '</span>' +
          '<b class="sb-k">' + (G.scores[q.id] || 0) + '</b>' +
          '<span class="sb-hp"><span data-id="' + q.id + '"></span></span>' +
          '</div>';
      }
      box.innerHTML = html;
      var fills = box.querySelectorAll ? box.querySelectorAll('.sb-hp > span') : [];
      for (i = 0; i < fills.length; i++) hudCache.sbFill[fills[i].getAttribute('data-id')] = { el: fills[i], v: '' };
      var goal = hudEl('sb-goal');
      if (goal) goal.textContent = G.bossMode ? '보스 처치' : '먼저 ' + G.winScore + ' KO';
    }
    for (i = 0; i < all.length; i++) {
      q = all[i];
      var f = hudCache.sbFill && hudCache.sbFill[q.id];
      if (!f) continue;
      var v = (q.alive ? clamp(q.hp / q.maxHp, 0, 1) * 100 : 0).toFixed(0) + '%';
      if (f.v !== v) { f.v = v; f.el.style.width = v; }
    }
  }

  // ===========================================================================
  // 렌더 — 하늘 (캐시)
  // ===========================================================================
  function buildSky() {
    var W = G.width, H = G.height, gy = G.world.groundY;
    var s = 1;
    var cv = makeCanvas(W * s, H * s);
    if (!cv) return null;
    var c = cv.getContext('2d');
    c.setTransform(s, 0, 0, s, 0, 0);

    var grad = c.createLinearGradient(0, 0, 0, gy);
    grad.addColorStop(0, '#26383b');
    grad.addColorStop(0.35, '#3f5653');
    grad.addColorStop(0.7, '#6f8379');
    grad.addColorStop(1, '#a9ad92');
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);

    // 흐린 해
    var sx = W * 0.7, sy = H * 0.2;
    var glow = c.createRadialGradient(sx, sy, 6, sx, sy, Math.max(W, H) * 0.45);
    glow.addColorStop(0, 'rgba(238,228,180,0.55)');
    glow.addColorStop(0.15, 'rgba(220,214,170,0.25)');
    glow.addColorStop(1, 'rgba(200,200,160,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(245,238,205,0.55)';
    c.beginPath(); c.arc(sx, sy, 26, 0, Math.PI * 2); c.fill();

    // 탁한 구름층
    var r = makeRng(5150);
    for (var i = 0; i < 46; i++) {
      var cx = r() * W, cy = r() * gy * 0.55;
      var rw = 80 + r() * 260, rh = 14 + r() * 34;
      var dark = r() < 0.55;
      c.fillStyle = dark ? 'rgba(30,44,44,' + (0.08 + r() * 0.14).toFixed(3) + ')'
        : 'rgba(190,196,170,' + (0.05 + r() * 0.1).toFixed(3) + ')';
      c.beginPath(); c.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2); c.fill();
    }
    // 지평선 연무
    var haze = c.createLinearGradient(0, gy * 0.45, 0, gy);
    haze.addColorStop(0, 'rgba(170,175,150,0)');
    haze.addColorStop(1, 'rgba(170,175,150,0.45)');
    c.fillStyle = haze;
    c.fillRect(0, gy * 0.45, W, gy * 0.55 + 4);
    return cv;
  }

  // ===========================================================================
  // 렌더 — 원경 패럴랙스 (캐시)
  // ===========================================================================
  var FAR_DEFS = [
    { f: 0.07, seed: 101, color: '#7c8b82', win: '#93a093', fog: 'rgba(160,168,145,0.75)', hMin: 0.4, hMax: 0.82, wMin: 60, wMax: 140, pylon: 0, crane: 0.05, moss: 0 },
    { f: 0.17, seed: 202, color: '#556660', win: '#6e7f76', fog: 'rgba(130,142,124,0.7)', hMin: 0.28, hMax: 0.6, wMin: 70, wMax: 160, pylon: 0.1, crane: 0.06, moss: 0.3 },
    { f: 0.32, seed: 303, color: '#36423d', win: '#46534c', fog: 'rgba(95,108,95,0.65)', hMin: 0.16, hMax: 0.42, wMin: 80, wMax: 180, pylon: 0.08, crane: 0, moss: 0.8 }
  ];

  function buildFarLayer(def) {
    var W = G.width, gy = G.world.groundY;
    var maxCam = Math.max(0, WORLD_W - W);
    var LW = Math.ceil(W + def.f * maxCam + 240);
    var LH = gy + 6;
    var s = 1;
    var cv = makeCanvas(LW * s, LH * s);
    if (!cv) return null;
    var c = cv.getContext('2d');
    c.setTransform(s, 0, 0, s, 0, 0);
    var r = makeRng(def.seed);
    var x = -30;
    var pylonTops = [];
    var scale = clamp(gy / 600, 0.6, 1.6);
    while (x < LW + 40) {
      var k = r();
      if (k < def.pylon) {
        var ph = (90 + r() * 70) * scale;
        drawPylon(c, x + 30, gy, ph, def.color, r, pylonTops);
        x += 70 + r() * 60;
      } else if (k < def.pylon + def.crane) {
        var ch = gy * (def.hMax + 0.05 + r() * 0.1);
        drawCrane(c, x + 20, gy, ch, def.color, r);
        x += 60 + r() * 50;
      } else if (k < 0.93) {
        var bw = def.wMin + r() * (def.wMax - def.wMin);
        var bh = gy * (def.hMin + r() * (def.hMax - def.hMin));
        drawSilBuilding(c, x, gy, bw, bh, def, r);
        x += bw * (0.55 + r() * 0.55);
      } else {
        x += 30 + r() * 60;
      }
    }
    // 송전선
    c.strokeStyle = def.color;
    c.lineWidth = 1;
    for (var i = 1; i < pylonTops.length; i++) {
      var a = pylonTops[i - 1], b = pylonTops[i];
      if (b.x - a.x > 520) continue;
      for (var j = 0; j < 2; j++) {
        var oy = j * 12;
        if (hash(i * 7 + j, def.seed) < 0.25) {
          // 끊어져 늘어진 전선
          c.beginPath();
          c.moveTo(a.x + 14, a.y + oy);
          c.quadraticCurveTo(a.x + 60, a.y + oy + 30, a.x + 50, a.y + oy + 90);
          c.stroke();
        } else {
          c.beginPath();
          c.moveTo(a.x + 14, a.y + oy);
          c.quadraticCurveTo((a.x + b.x) / 2, Math.max(a.y, b.y) + oy + 40, b.x - 14, b.y + oy);
          c.stroke();
        }
      }
    }
    // 이끼 기운 (가까운 층)
    if (def.moss > 0) {
      c.globalCompositeOperation = 'source-atop';
      var mg = c.createLinearGradient(0, gy * 0.3, 0, gy);
      mg.addColorStop(0, 'rgba(70,95,45,' + (0.15 * def.moss).toFixed(3) + ')');
      mg.addColorStop(1, 'rgba(70,95,45,0)');
      c.fillStyle = mg;
      c.fillRect(0, 0, LW, LH);
    }
    // 연무 (아래로 갈수록 짙어짐)
    c.globalCompositeOperation = 'source-atop';
    var fg = c.createLinearGradient(0, gy * 0.35, 0, gy);
    fg.addColorStop(0, 'rgba(160,168,145,0)');
    fg.addColorStop(1, def.fog);
    c.fillStyle = fg;
    c.fillRect(0, 0, LW, LH);
    c.globalCompositeOperation = 'source-over';
    return { cv: cv, f: def.f, w: LW, h: LH };
  }

  function drawSilBuilding(c, x, base, w, h, def, r) {
    var tilt = r() < 0.16 ? (r() - 0.5) * 0.26 : 0;
    var broken = r() < 0.6;
    var bc = w * (0.15 + r() * 0.7), bd = broken ? h * (0.12 + r() * 0.3) : 0;
    function roofAt(xx) { return bd * Math.max(0, 1 - Math.abs(xx - bc) / (w * 0.5)); }
    c.save();
    c.translate(x, base);
    if (tilt) { c.translate(tilt > 0 ? 0 : w, 0); c.rotate(tilt); c.translate(tilt > 0 ? 0 : -w, 0); }
    c.fillStyle = def.color;
    c.beginPath();
    c.moveTo(0, 8);
    var n = Math.max(4, Math.floor(w / 9));
    for (var i = 0; i <= n; i++) {
      var xx = (i / n) * w;
      var yy = -h + roofAt(xx) + (broken ? r() * 10 : 0);
      c.lineTo(xx, yy);
    }
    c.lineTo(w, 8);
    c.closePath();
    c.fill();
    // 옥상 구조물
    if (!broken && r() < 0.6) {
      if (r() < 0.5) {
        c.fillRect(w * 0.2, -h - 18, 18, 18);
        c.fillRect(w * 0.2 + 3, -h - 24, 12, 6);
      } else {
        c.fillRect(w * 0.6, -h - 40, 2, 40);
        c.fillRect(w * 0.6 - 6, -h - 30, 14, 1.5);
      }
    }
    // 노출된 철골
    c.strokeStyle = def.color;
    c.lineWidth = 2;
    if (broken) {
      var ng = 2 + Math.floor(r() * 4);
      for (var g = 0; g < ng; g++) {
        var gx = bc + (r() - 0.5) * w * 0.6;
        var gt = -h + roofAt(gx);
        var gh = 12 + r() * 36;
        c.beginPath();
        c.moveTo(gx, gt + 4);
        c.lineTo(gx + (r() - 0.5) * 8, gt - gh);
        c.stroke();
      }
      c.lineWidth = 1;
      for (g = 0; g < 3; g++) {
        var fy = -h + bd + 10 + g * 18;
        c.beginPath();
        c.moveTo(bc - w * 0.3, fy);
        c.lineTo(bc + w * 0.3, fy + (r() - 0.5) * 4);
        c.stroke();
      }
    }
    // 창문 (일부는 뚫려서 하늘이 보임)
    var winW = 5 + r() * 4, winH = 7 + r() * 5;
    var cols = Math.floor((w - 10) / (winW * 2)), rows = Math.floor((h - 16) / (winH * 2));
    var ox = (w - cols * winW * 2) / 2 + winW / 2;
    for (var ry = 0; ry < rows; ry++) {
      for (var cx = 0; cx < cols; cx++) {
        var wx = ox + cx * winW * 2;
        var wy = -h + 12 + ry * winH * 2;
        if (wy < -h + roofAt(wx + winW / 2) + 10) continue;
        var q = r();
        if (q < 0.18) {
          c.globalCompositeOperation = 'destination-out';
          c.fillRect(wx, wy, winW, winH);
          c.globalCompositeOperation = 'source-over';
        } else if (q < 0.55) {
          c.fillStyle = def.win;
          c.fillRect(wx, wy, winW, winH);
        }
      }
    }
    // 큰 구멍
    if (r() < 0.25) {
      c.globalCompositeOperation = 'destination-out';
      c.beginPath();
      var hx = w * (0.2 + r() * 0.5), hy = -h * (0.3 + r() * 0.4), hr = Math.min(w, h) * (0.08 + r() * 0.1);
      for (var a = 0; a < 9; a++) {
        var ang = a / 9 * Math.PI * 2, rr = hr * (0.6 + r() * 0.6);
        if (a === 0) c.moveTo(hx + Math.cos(ang) * rr, hy + Math.sin(ang) * rr);
        else c.lineTo(hx + Math.cos(ang) * rr, hy + Math.sin(ang) * rr);
      }
      c.closePath(); c.fill();
      c.globalCompositeOperation = 'source-over';
    }
    c.restore();
  }

  function drawPylon(c, x, base, h, color, r, tops) {
    var tilt = r() < 0.3 ? (r() - 0.5) * 0.3 : 0;
    var bw = h * 0.32;
    c.save();
    c.translate(x, base);
    c.rotate(tilt);
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(-bw / 2, 0); c.lineTo(-bw * 0.08, -h);
    c.moveTo(bw / 2, 0); c.lineTo(bw * 0.08, -h);
    c.stroke();
    c.lineWidth = 0.9;
    var lv = 7;
    for (var i = 0; i < lv; i++) {
      var y0 = -h * i / lv, y1 = -h * (i + 1) / lv;
      var w0 = lerp(bw / 2, bw * 0.08, i / lv), w1 = lerp(bw / 2, bw * 0.08, (i + 1) / lv);
      c.beginPath();
      c.moveTo(-w0, y0); c.lineTo(w1, y1);
      c.moveTo(w0, y0); c.lineTo(-w1, y1);
      c.moveTo(-w1, y1); c.lineTo(w1, y1);
      c.stroke();
    }
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-h * 0.22, -h * 0.82); c.lineTo(h * 0.22, -h * 0.82);
    c.moveTo(-h * 0.16, -h * 0.66); c.lineTo(h * 0.16, -h * 0.66);
    c.stroke();
    c.restore();
    tops.push({ x: x + Math.sin(tilt) * h, y: base - h * 0.82 * Math.cos(tilt) });
  }

  function drawCrane(c, x, base, h, color, r) {
    c.save();
    c.translate(x, base);
    c.strokeStyle = color;
    c.fillStyle = color;
    var mw = 10;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(0, -h);
    c.moveTo(mw, 0); c.lineTo(mw, -h);
    c.stroke();
    c.lineWidth = 0.8;
    for (var y = 0; y > -h; y -= 14) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(mw, y - 14); c.moveTo(0, y - 14); c.lineTo(mw, y - 14); c.stroke();
    }
    var jl = 120 + r() * 120, cl = 40 + r() * 20;
    var droop = r() < 0.4 ? 0.25 + r() * 0.3 : 0;  // 부러져 처진 지브
    c.save();
    c.translate(mw / 2, -h);
    c.rotate(droop);
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(-cl, 0); c.lineTo(jl, 0);
    c.moveTo(-cl, 7); c.lineTo(jl * 0.9, 3);
    c.stroke();
    c.lineWidth = 0.7;
    for (var j = -cl; j < jl * 0.9; j += 12) {
      c.beginPath(); c.moveTo(j, 0); c.lineTo(j + 6, 6); c.lineTo(j + 12, 0); c.stroke();
    }
    c.fillRect(-cl, 0, 18, 14);
    var hx = jl * (0.4 + r() * 0.4);
    c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(hx, 2); c.lineTo(hx, 60 + r() * 80); c.stroke();
    c.restore();
    c.beginPath(); c.moveTo(mw / 2, -h); c.lineTo(mw / 2, -h - 24); c.stroke();
    c.restore();
  }

  // ===========================================================================
  // 렌더 — 근경 공통 붓
  // ===========================================================================
  function mossDrape(c, x0, x1, y, thick, r, drips) {
    if (x1 - x0 < 4) return;
    var grad = c.createLinearGradient(0, y - 4, 0, y + thick + 10);
    grad.addColorStop(0, '#6f8f3a');
    grad.addColorStop(0.5, '#4c6a28');
    grad.addColorStop(1, '#30461b');
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(x0, y);
    var xx;
    for (xx = x0; xx <= x1; xx += 5) c.lineTo(xx, y - 1 - r() * 4);
    c.lineTo(x1, y);
    for (xx = x1; xx >= x0; xx -= 4 + r() * 8) {
      var d = thick * (0.3 + r() * 0.7);
      if (drips && r() < 0.18) d += 6 + r() * 16;
      c.lineTo(xx, y + d);
    }
    c.lineTo(x0, y + thick * 0.4);
    c.closePath();
    c.fill();
    // 반점
    for (xx = x0; xx < x1; xx += 6 + r() * 10) {
      c.fillStyle = r() < 0.5 ? MOSS_HI : pick(r, MOSS);
      c.beginPath();
      c.arc(xx, y + r() * thick * 0.5, 1.5 + r() * 2.5, 0, Math.PI * 2);
      c.fill();
    }
  }

  function mossClumps(c, x0, x1, y, size, r) {
    for (var xx = x0; xx < x1; xx += size * (0.5 + r() * 1.2)) {
      if (r() < 0.35) continue;
      var rr = size * (0.4 + r() * 0.6);
      c.fillStyle = pick(r, MOSS);
      c.beginPath(); c.ellipse(xx, y, rr * 1.3, rr * 0.7, 0, Math.PI, 0); c.fill();
      if (r() < 0.4) {
        c.fillStyle = MOSS_HI;
        c.beginPath(); c.arc(xx - rr * 0.3, y - rr * 0.35, rr * 0.3, 0, Math.PI * 2); c.fill();
      }
    }
  }

  function rustStreak(c, x, y, w, len, a) {
    var g = c.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(150,72,28,' + a.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(150,72,28,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + w, y);
    c.lineTo(x + w * 0.7, y + len);
    c.lineTo(x + w * 0.3, y + len);
    c.closePath();
    c.fill();
  }

  function rustBlotch(c, x, y, rx, ry, r) {
    for (var i = 0; i < 3; i++) {
      c.fillStyle = pick(r, RUST);
      c.globalAlpha = 0.25 + r() * 0.35;
      c.beginPath();
      c.ellipse(x + (r() - 0.5) * rx, y + (r() - 0.5) * ry, rx * (0.4 + r() * 0.6), ry * (0.4 + r() * 0.6), r() * 3, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  }

  function leaf(c, x, y, s, ang, color) {
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(x, y, s, s * 0.5, ang, 0, Math.PI * 2);
    c.fill();
  }

  function ivy(c, x, baseY, height, r) {
    // 바닥에서 위로 타고 오르는 담쟁이
    var y = baseY, cx = x;
    c.strokeStyle = '#3a4a22';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(cx, y);
    var pts = [];
    while (y > baseY - height) {
      cx += (r() - 0.5) * 14;
      y -= 10 + r() * 10;
      c.lineTo(cx, y);
      pts.push([cx, y]);
    }
    c.stroke();
    for (var i = 0; i < pts.length; i++) {
      var dens = 1 - i / pts.length;
      var n = 2 + Math.floor(dens * 5);
      for (var k = 0; k < n; k++) {
        leaf(c, pts[i][0] + (r() - 0.5) * 22 * (0.5 + dens), pts[i][1] + (r() - 0.5) * 12,
          3 + r() * 3, r() * 3, pick(r, MOSS));
      }
    }
  }

  function grassTuft(c, x, y, h, r) {
    c.strokeStyle = r() < 0.5 ? '#5f7f30' : '#71913a';
    c.lineWidth = 1.3;
    c.beginPath();
    var n = 3 + Math.floor(r() * 4);
    for (var k = 0; k < n; k++) {
      var bx = x + (k - n / 2) * 2.2;
      var hh = h * (0.5 + r() * 0.6);
      c.moveTo(bx, y);
      c.quadraticCurveTo(bx + (r() - 0.5) * 4, y - hh * 0.6, bx + (r() - 0.5) * 9, y - hh);
    }
    c.stroke();
  }

  function brokenWindow(c, x, y, w, h, r) {
    var q = r();
    c.fillStyle = '#3a3a33';
    c.fillRect(x - 2, y - 2, w + 4, h + 4);
    if (q < 0.15) {
      // 판자로 막힘
      c.fillStyle = '#2a2722';
      c.fillRect(x, y, w, h);
      for (var i = 0; i < 3; i++) {
        c.fillStyle = i % 2 ? '#6b5236' : '#5a4430';
        c.save();
        c.translate(x + w / 2, y + h * (0.25 + i * 0.25));
        c.rotate((r() - 0.5) * 0.4);
        c.fillRect(-w / 2 - 2, -3, w + 4, 6);
        c.restore();
      }
      return;
    }
    c.fillStyle = q < 0.3 ? '#2b3a33' : '#151b19';
    c.fillRect(x, y, w, h);
    // 깨진 유리 조각
    c.fillStyle = 'rgba(140,165,155,0.45)';
    var corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    for (var k = 0; k < 4; k++) {
      if (r() < 0.45) continue;
      var cx = corners[k][0], cy = corners[k][1];
      var sx = k % 2 ? -1 : 1, sy = k < 2 ? 1 : -1;
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + sx * w * (0.3 + r() * 0.5), cy);
      c.lineTo(cx + sx * w * 0.1 * r(), cy + sy * h * (0.3 + r() * 0.5));
      c.closePath();
      c.fill();
    }
    // 창틀 가로대
    c.fillStyle = '#4a4a40';
    c.fillRect(x, y + h / 2 - 1, w, 2);
    if (r() < 0.3) {
      // 안쪽에서 자란 덩굴
      for (var j = 0; j < 4; j++) leaf(c, x + r() * w, y + h - r() * h * 0.6, 3, r() * 3, pick(r, MOSS));
    }
  }

  // ===========================================================================
  // 렌더 — 근경 건물 외벽
  // ===========================================================================
  function drawFacade(c, b, gy) {
    var r = makeRng(b.seed);
    var x = b.x, w = b.w, top = gy - b.h;
    var steel = b.type === 'steel';
    var baseCol = steel ? (b.tone < 0.5 ? '#4f4840' : '#545049') : (b.tone < 0.5 ? '#5d5f57' : '#666359');
    // 몸체
    c.beginPath();
    c.moveTo(x, gy + 2);
    var n = Math.max(6, Math.floor(w / 10));
    for (var i = 0; i <= n; i++) {
      var xx = x + (i / n) * w;
      c.lineTo(xx, top + roofOff(b, xx) + (b.bd ? r() * 9 : 0));
    }
    c.lineTo(x + w, gy + 2);
    c.closePath();
    var bg = c.createLinearGradient(0, top, 0, gy);
    bg.addColorStop(0, baseCol);
    bg.addColorStop(1, steel ? '#3b352f' : '#47483f');
    c.fillStyle = bg;
    c.fill();
    c.save();
    c.clip();

    // 패널/층 띠
    var floorH = 60 + Math.floor(r() * 14);
    if (steel) {
      c.strokeStyle = 'rgba(20,16,12,0.35)';
      c.lineWidth = 1;
      for (var px = x + 20; px < x + w; px += 26 + r() * 20) {
        c.beginPath(); c.moveTo(px, top - 10); c.lineTo(px, gy); c.stroke();
      }
      // 리벳
      c.fillStyle = 'rgba(30,22,16,0.5)';
      for (var ry = gy - floorH; ry > top; ry -= floorH) {
        for (var rx = x + 8; rx < x + w; rx += 14) c.fillRect(rx, ry + 3, 2, 2);
      }
    }
    // 녹 얼룩 (넓게)
    var nb = 4 + Math.floor(r() * 7) + (steel ? 6 : 0);
    for (i = 0; i < nb; i++) {
      rustBlotch(c, x + r() * w, top + r() * b.h, 10 + r() * 40, 8 + r() * 30, r);
    }
    // 1층 상가
    var shopH = 64 + r() * 16;
    var shopTop = gy - shopH;
    c.fillStyle = '#2f2c27';
    c.fillRect(x, shopTop - 8, w, 8);
    var sx = x + 10;
    while (sx < x + w - 40) {
      var sw = 50 + r() * 50;
      if (sx + sw > x + w - 8) sw = x + w - 8 - sx;
      if (r() < 0.55) {
        // 녹슨 셔터
        c.fillStyle = '#6b4a30';
        c.fillRect(sx, shopTop, sw, shopH);
        c.strokeStyle = 'rgba(30,18,10,0.55)';
        c.lineWidth = 1;
        for (var sy = shopTop + 4; sy < gy; sy += 5) {
          c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + sw, sy); c.stroke();
        }
        rustStreak(c, sx, shopTop, sw, shopH, 0.4);
        if (r() < 0.5) {
          // 찌그러져 반쯤 열린 셔터
          c.fillStyle = '#121513';
          var oh = 12 + r() * 20;
          c.beginPath();
          c.moveTo(sx, gy); c.lineTo(sx, gy - oh * 0.6); c.lineTo(sx + sw, gy - oh); c.lineTo(sx + sw, gy);
          c.closePath(); c.fill();
        }
      } else {
        brokenWindow(c, sx, shopTop + 4, sw, shopH - 8, r);
      }
      sx += sw + 10 + r() * 18;
    }

    // 층별 창문
    var winW = 20 + Math.floor(r() * 10), winH = 26 + Math.floor(r() * 10);
    var gap = 14 + Math.floor(r() * 12);
    var cols = Math.max(1, Math.floor((w - 20) / (winW + gap)));
    var ox = x + (w - cols * (winW + gap) + gap) / 2;
    for (var fy = shopTop - floorH; fy > top + 6; fy -= floorH) {
      // 층 띠 + 이끼
      c.fillStyle = steel ? 'rgba(40,32,26,0.6)' : 'rgba(120,120,108,0.5)';
      c.fillRect(x, fy + floorH - 8, w, 6);
      for (var cc = 0; cc < cols; cc++) {
        var wx = ox + cc * (winW + gap);
        var wy = fy + 12;
        if (wy < top + roofOff(b, wx + winW / 2) + 12) continue;
        if (b.recess && r() < 0.3) continue;
        brokenWindow(c, wx, wy, winW, winH, r);
        if (r() < 0.75) rustStreak(c, wx + 2, wy + winH + 2, winW - 4, 18 + r() * 50, 0.25 + r() * 0.35);
      }
      if (r() < 0.6) mossClumps(c, x, x + w, fy + floorH - 8, 7, r);
    }

    // 노출 철골 (무너진 부분)
    if (b.bd > 0) {
      c.strokeStyle = '#5a3a24';
      c.lineWidth = 4;
      for (i = 0; i < 4; i++) {
        var gx = b.bc + (r() - 0.5) * w * 0.5;
        var gt = top + roofOff(b, gx);
        c.beginPath(); c.moveTo(gx, gt + 6); c.lineTo(gx, gt + 70); c.stroke();
      }
      c.lineWidth = 3;
      for (i = 0; i < 3; i++) {
        var by = top + b.bd + 14 + i * floorH * 0.6;
        c.beginPath(); c.moveTo(b.bc - w * 0.25, by); c.lineTo(b.bc + w * 0.25, by + (r() - 0.5) * 8); c.stroke();
      }
    }
    // 아래쪽 어둡게
    var dg = c.createLinearGradient(0, gy - 120, 0, gy);
    dg.addColorStop(0, 'rgba(15,18,15,0)');
    dg.addColorStop(1, 'rgba(15,18,15,0.45)');
    c.fillStyle = dg;
    c.fillRect(x, gy - 120, w, 122);
    c.restore();

    // 지붕 철골 돌출 (clip 밖)
    if (b.bd > 0) {
      c.strokeStyle = '#4e3221';
      c.lineWidth = 3;
      for (i = 0; i < 3 + Math.floor(r() * 3); i++) {
        var ex = b.bc + (r() - 0.5) * w * 0.7;
        var et = top + roofOff(b, ex) + 4;
        c.beginPath(); c.moveTo(ex, et); c.lineTo(ex + (r() - 0.5) * 14, et - 14 - r() * 34); c.stroke();
      }
      c.lineWidth = 1.5;
      c.strokeStyle = '#6a4630';
      for (i = 0; i < 4; i++) {
        var rbx = b.bc + (r() - 0.5) * w * 0.6;
        var rbt = top + roofOff(b, rbx) + 4;
        c.beginPath(); c.moveTo(rbx, rbt); c.quadraticCurveTo(rbx + 6, rbt - 10, rbx + 3 + r() * 10, rbt - 16 - r() * 10); c.stroke();
      }
    } else {
      // 난간 / 옥상 물탱크
      c.fillStyle = steel ? '#3f3730' : '#55564d';
      c.fillRect(x - 2, top - 6, w + 4, 8);
      if (r() < 0.5) {
        var tx = x + 20 + r() * (w - 70);
        c.fillStyle = '#5c3a22';
        c.fillRect(tx + 4, top - 26, 3, 20); c.fillRect(tx + 30, top - 26, 3, 20);
        c.fillStyle = '#7a4a28';
        roundRect(c, tx, top - 52, 38, 28, 4); c.fill();
        rustBlotch(c, tx + 19, top - 40, 14, 10, r);
      }
    }
    // 지붕 이끼 덮개 + 수풀
    var segs = Math.max(4, Math.floor(w / 10));
    c.save();
    var mg = c.createLinearGradient(0, top - 8, 0, top + 30);
    mg.addColorStop(0, '#6a8a36');
    mg.addColorStop(1, '#3b5520');
    c.fillStyle = mg;
    c.beginPath();
    var st = 0;
    for (i = 0; i <= segs; i++) {
      var mx = x + (i / segs) * w;
      var my = top + roofOff(b, mx) - (b.bd ? 0 : 6) - 2 - r() * 4;
      if (i === 0) c.moveTo(mx, my); else c.lineTo(mx, my);
    }
    for (i = segs; i >= 0; i--) {
      var mx2 = x + (i / segs) * w;
      st = 6 + r() * 12;
      if (r() < 0.15) st += 12 + r() * 26;
      c.lineTo(mx2, top + roofOff(b, mx2) + st);
    }
    c.closePath();
    c.fill();
    c.restore();
    for (i = 0; i < Math.floor(w / 50); i++) {
      var bx2 = x + 10 + r() * (w - 20);
      var bt = top + roofOff(b, bx2) - (b.bd ? 0 : 6);
      var bs = 6 + r() * 10;
      c.fillStyle = pick(r, MOSS);
      c.beginPath();
      c.arc(bx2 - bs * 0.6, bt - bs * 0.3, bs * 0.7, 0, Math.PI * 2);
      c.arc(bx2 + bs * 0.6, bt - bs * 0.3, bs * 0.7, 0, Math.PI * 2);
      c.arc(bx2, bt - bs * 0.8, bs * 0.8, 0, Math.PI * 2);
      c.fill();
      if (r() < 0.4) grassTuft(c, bx2 + bs, bt, 14 + r() * 10, r);
    }
    // 벽 타는 담쟁이
    var ni = Math.floor(r() * 3);
    for (i = 0; i < ni; i++) ivy(c, x + 10 + r() * (w - 20), gy, 80 + r() * (b.h * 0.7), r);
  }

  function drawNeonFrame(c, n, gy) {
    var y = gy - n.dy;
    c.fillStyle = '#3a2a20';
    c.fillRect(n.x + 14, y + 50, 3, 26);
    c.fillRect(n.x + 54, y + 50, 3, 26);
    c.fillStyle = '#2a211b';
    roundRect(c, n.x, y, 70, 52, 4); c.fill();
    c.strokeStyle = '#7a4a28';
    c.lineWidth = 3;
    roundRect(c, n.x, y, 70, 52, 4); c.stroke();
    var r = makeRng(n.seed);
    rustBlotch(c, n.x + 50, y + 40, 16, 10, r);
    mossDrape(c, n.x - 2, n.x + 72, y, 6, r, true);
  }

  // ===========================================================================
  // 렌더 — 도로/지면
  // ===========================================================================
  function drawRoad(c, x0, x1, gy, bottom) {
    var depth = bottom - gy;
    var ag = c.createLinearGradient(0, gy, 0, bottom);
    ag.addColorStop(0, '#3b3c36');
    ag.addColorStop(0.3, '#2f302b');
    ag.addColorStop(1, '#1d1e1a');
    c.fillStyle = ag;
    c.fillRect(x0, gy, x1 - x0, depth);

    // 표면 질감
    var CELL = 22;
    var cs = Math.floor(x0 / CELL), ce = Math.ceil(x1 / CELL);
    var i, k;
    for (i = cs; i <= ce; i++) {
      for (k = 0; k < 4; k++) {
        var hx = hash(i * 4 + k, 11), hy = hash(i * 4 + k, 23), hs = hash(i * 4 + k, 37);
        var px = i * CELL + hx * CELL, py = gy + 12 + hy * Math.max(10, depth - 20);
        c.fillStyle = hs < 0.5 ? 'rgba(10,10,8,0.35)' : 'rgba(150,145,125,0.14)';
        var sz = 1.2 + hs * 2.6;
        c.fillRect(px, py, sz, sz * 0.7);
      }
      // 이끼 얼룩
      if (hash(i, 61) < 0.18) {
        c.fillStyle = 'rgba(80,105,45,' + (0.18 + hash(i, 62) * 0.22).toFixed(3) + ')';
        c.beginPath();
        c.ellipse(i * CELL + hash(i, 63) * CELL, gy + 10 + hash(i, 64) * depth * 0.6, 12 + hash(i, 65) * 26, 4 + hash(i, 66) * 6, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    // 바랜 차선
    var laneY = gy + depth * 0.42;
    for (var lx = Math.floor(x0 / 150) * 150; lx < x1; lx += 150) {
      var hz = hash(lx | 0, 91);
      if (hz < 0.2) continue;
      c.fillStyle = 'rgba(180,160,80,' + (0.12 + hz * 0.2).toFixed(3) + ')';
      c.beginPath();
      c.moveTo(lx, laneY); c.lineTo(lx + 64 - hz * 18, laneY - 1);
      c.lineTo(lx + 66 - hz * 20, laneY + 4); c.lineTo(lx + 2, laneY + 5);
      c.closePath(); c.fill();
    }
    // 연석 (윗면)
    c.fillStyle = '#5f5f55';
    c.fillRect(x0, gy, x1 - x0, 7);
    c.fillStyle = 'rgba(200,200,180,0.18)';
    c.fillRect(x0, gy, x1 - x0, 1.5);
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(x0, gy + 7, x1 - x0, 2);
    for (var bx = Math.floor(x0 / 60) * 60; bx < x1; bx += 60) {
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(bx, gy + 1, 1.5, 6);
      if (hash(bx | 0, 71) < 0.3) {
        // 깨진 연석 조각
        c.fillStyle = '#2a2b26';
        c.beginPath();
        c.moveTo(bx + 10, gy); c.lineTo(bx + 24 + hash(bx | 0, 72) * 14, gy); c.lineTo(bx + 18, gy + 7);
        c.closePath(); c.fill();
      }
    }
    // 균열 + 틈새 풀
    for (i = 0; i < cracks.length; i++) {
      var cr = cracks[i];
      var p0 = cr.pts[0][0], pn = cr.pts[cr.pts.length - 1][0];
      if (pn < x0 - 20 || p0 > x1 + 20) continue;
      c.strokeStyle = '#11120f';
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(cr.pts[0][0], gy + cr.pts[0][1]);
      for (k = 1; k < cr.pts.length; k++) c.lineTo(cr.pts[k][0], gy + cr.pts[k][1]);
      c.stroke();
      c.strokeStyle = 'rgba(150,145,125,0.12)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(cr.pts[0][0], gy + cr.pts[0][1] + 1.5);
      for (k = 1; k < cr.pts.length; k++) c.lineTo(cr.pts[k][0], gy + cr.pts[k][1] + 1.5);
      c.stroke();
      if (cr.grass) {
        var rg = makeRng(cr.seed);
        for (k = 0; k < cr.pts.length; k++) {
          if (rg() < 0.5) grassTuft(c, cr.pts[k][0], gy + cr.pts[k][1], 6 + rg() * 8, rg);
        }
        grassTuft(c, cr.pts[0][0], gy + 1, 10 + rg() * 12, rg);
      }
    }
    // 연석 위 풀/이끼
    var GB = 34;
    for (i = Math.floor(x0 / GB); i <= Math.ceil(x1 / GB); i++) {
      var h1 = hash(i, 131);
      if (h1 < 0.45) continue;
      var gx = i * GB + hash(i, 132) * GB;
      var rgg = makeRng(i * 977 + 5);
      if (h1 < 0.75) grassTuft(c, gx, gy + 1, 8 + hash(i, 133) * 14, rgg);
      else mossClumps(c, gx - 10, gx + 16, gy + 1, 6, rgg);
    }
  }

  function drawPuddle(c, pd, gy) {
    var cx = pd.x + pd.w / 2, cy = gy + pd.dy, rx = pd.w / 2, ry = 4 + pd.w * 0.04;
    c.save();
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.clip();
    var rg = c.createLinearGradient(0, cy - ry, 0, cy + ry);
    rg.addColorStop(0, '#a9ad92');
    rg.addColorStop(0.5, '#6f8379');
    rg.addColorStop(1, '#3f5653');
    c.fillStyle = rg;
    c.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    // 거꾸로 비친 건물 실루엣
    c.fillStyle = 'rgba(40,50,46,0.55)';
    var r = makeRng(pd.seed);
    for (var x = cx - rx; x < cx + rx; x += 8 + r() * 14) {
      c.fillRect(x, cy - ry, 6 + r() * 10, ry * (0.6 + r() * 1.2));
    }
    c.restore();
    c.strokeStyle = 'rgba(20,22,18,0.6)';
    c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
  }

  // ===========================================================================
  // 렌더 — 소품
  // ===========================================================================
  function drawBarrel(c, x, by, s, r, toxic) {
    var w = 30 * s, h = 44 * s;
    var col = pick(r, ['#7a4426', '#5d4a2e', '#4a5a3a', '#8a5a26']);
    var g = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, '#2a1d14');
    g.addColorStop(0.35, col);
    g.addColorStop(1, '#22180f');
    c.fillStyle = g;
    roundRect(c, x - w / 2, by - h, w, h, 4); c.fill();
    c.fillStyle = 'rgba(20,12,8,0.6)';
    c.fillRect(x - w / 2, by - h * 0.7, w, 3);
    c.fillRect(x - w / 2, by - h * 0.3, w, 3);
    rustBlotch(c, x + (r() - 0.5) * w * 0.4, by - h * r(), w * 0.4, h * 0.3, r);
    if (toxic) {
      c.fillStyle = '#e8d24a';
      c.beginPath();
      c.moveTo(x, by - h * 0.62); c.lineTo(x + 6 * s, by - h * 0.44); c.lineTo(x - 6 * s, by - h * 0.44);
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(140,220,70,0.55)';
      c.beginPath(); c.ellipse(x + w * 0.6, by + 3, w * 0.9, 3.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(140,220,70,0.75)';
      c.fillRect(x + w * 0.3, by - h * 0.32, 2.5, h * 0.32);
    }
  }

  function drawWreck(c, x, gy, s, flip, r) {
    // 낡은 폐차 (작은, 발판 아님)
    c.save();
    c.translate(x, gy);
    c.scale(flip * s, s);
    c.rotate(0.03);
    var col = pick(r, ['#4d5f66', '#6e4a3c', '#7d7660', '#56604a']);
    c.fillStyle = col;
    roundRect(c, -70, -42, 140, 30, 8); c.fill();
    c.beginPath();
    c.moveTo(-42, -42); c.lineTo(-24, -64); c.lineTo(28, -64); c.lineTo(48, -42); c.closePath(); c.fill();
    c.fillStyle = '#151a18';
    c.beginPath(); c.moveTo(-36, -44); c.lineTo(-22, -60); c.lineTo(0, -60); c.lineTo(0, -44); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(4, -44); c.lineTo(4, -60); c.lineTo(26, -60); c.lineTo(40, -44); c.closePath(); c.fill();
    rustBlotch(c, -30, -30, 30, 12, r); rustBlotch(c, 40, -24, 24, 10, r);
    c.fillStyle = '#1a1a17';
    c.beginPath(); c.arc(-42, -12, 13, 0, Math.PI * 2); c.arc(44, -12, 13, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#6a4024';
    c.beginPath(); c.arc(-42, -12, 6, 0, Math.PI * 2); c.arc(44, -12, 6, 0, Math.PI * 2); c.fill();
    mossDrape(c, -24, 28, -64, 6, r, true);
    c.restore();
  }

  function drawTrafficLight(c, x, gy, flip, r) {
    // 쓰러진 신호등: 밑동은 부러져 서 있고 나머지는 비스듬히 누움
    c.save();
    c.translate(x, gy);
    c.scale(flip, 1);
    c.fillStyle = '#3a3c37';
    c.fillRect(-5, -40, 10, 40);
    c.fillStyle = '#5a5c55';
    c.beginPath(); c.moveTo(-5, -40); c.lineTo(-1, -46); c.lineTo(3, -41); c.lineTo(5, -44); c.lineTo(5, -40); c.closePath(); c.fill();
    c.save();
    c.translate(6, -36);
    c.rotate(1.22);
    c.fillStyle = '#44463f';
    c.fillRect(-4, -4, 8, -150);
    rustBlotch(c, 0, -70, 6, 30, r);
    c.translate(0, -150);
    c.fillStyle = '#4a4c44';
    c.fillRect(-2, -2, 60, 6);
    c.fillStyle = '#2b2d28';
    roundRect(c, 52, -12, 22, 62, 4); c.fill();
    var lc = ['#4a1a14', '#4a3c14', '#163a22'];
    for (var i = 0; i < 3; i++) {
      c.fillStyle = lc[i];
      c.beginPath(); c.arc(63, -1 + i * 19, 7, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    mossClumps(c, -14, 120, 1, 8, r);
    c.restore();
  }

  function drawLamp(c, x, gy, flip, r) {
    c.save();
    c.translate(x, gy);
    c.scale(flip, 1);
    c.strokeStyle = '#3d3f39';
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(0, -150);
    c.quadraticCurveTo(4, -190, 40, -170);
    c.quadraticCurveTo(58, -158, 60, -132);
    c.stroke();
    c.fillStyle = '#2d2f2a';
    c.beginPath(); c.ellipse(60, -126, 12, 6, 0.3, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(150,72,28,0.5)';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -20); c.lineTo(0, -90); c.stroke();
    ivy(c, 0, 0, 90 + r() * 50, r);
    c.restore();
  }

  function drawRubble(c, x, gy, s, r) {
    var n = 5 + Math.floor(r() * 5);
    for (var i = 0; i < n; i++) {
      var cx = x + (r() - 0.5) * 70 * s, w = (12 + r() * 26) * s, h = (8 + r() * 20) * s;
      c.fillStyle = pick(r, ['#5e5f57', '#6b6a5f', '#4c4d46', '#73705f']);
      c.beginPath();
      c.moveTo(cx - w / 2, gy + 2);
      c.lineTo(cx - w * 0.4, gy - h * (0.6 + r() * 0.4));
      c.lineTo(cx + w * (r() - 0.5) * 0.4, gy - h);
      c.lineTo(cx + w * 0.45, gy - h * (0.4 + r() * 0.5));
      c.lineTo(cx + w / 2, gy + 2);
      c.closePath();
      c.fill();
    }
    c.strokeStyle = '#6a4024';
    c.lineWidth = 1.5;
    for (i = 0; i < 3; i++) {
      var rx = x + (r() - 0.5) * 50 * s;
      c.beginPath(); c.moveTo(rx, gy - 6); c.quadraticCurveTo(rx + 8, gy - 20, rx + 4 + r() * 16, gy - 26 - r() * 14); c.stroke();
    }
    mossClumps(c, x - 30 * s, x + 30 * s, gy - 4, 6, r);
    grassTuft(c, x + 20 * s, gy, 14, r);
  }

  function drawBarrier(c, x, gy, s, r) {
    c.fillStyle = '#6d6c62';
    c.beginPath();
    c.moveTo(x - 40 * s, gy); c.lineTo(x - 30 * s, gy - 18 * s); c.lineTo(x - 18 * s, gy - 44 * s);
    c.lineTo(x + 18 * s, gy - 44 * s); c.lineTo(x + 30 * s, gy - 18 * s); c.lineTo(x + 40 * s, gy);
    c.closePath(); c.fill();
    c.fillStyle = 'rgba(200,80,30,0.45)';
    c.fillRect(x - 28 * s, gy - 30 * s, 56 * s, 6 * s);
    rustStreak(c, x - 10 * s, gy - 30 * s, 12 * s, 26 * s, 0.4);
    mossDrape(c, x - 18 * s, x + 18 * s, gy - 44 * s, 5, r, true);
  }

  function drawTires(c, x, gy, s, r) {
    var n = 2 + Math.floor(r() * 2);
    for (var i = 0; i < n; i++) {
      var cy = gy - 9 * s - i * 15 * s;
      c.fillStyle = '#1c1c1a';
      c.beginPath(); c.ellipse(x + (r() - 0.5) * 6, cy, 24 * s, 9 * s, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2c2c28';
      c.beginPath(); c.ellipse(x, cy - 2, 11 * s, 3.5 * s, 0, 0, Math.PI * 2); c.fill();
    }
    grassTuft(c, x - 20, gy, 16, r);
  }

  function drawSign(c, x, gy, flip, r) {
    c.save();
    c.translate(x, gy);
    c.rotate(flip * 0.25);
    c.fillStyle = '#4a4c45';
    c.fillRect(-2.5, -90, 5, 90);
    c.fillStyle = '#1f5a8a';
    c.fillRect(-26, -112, 52, 32);
    c.fillStyle = 'rgba(30,20,10,0.4)';
    c.fillRect(-26, -112, 52, 32);
    rustBlotch(c, 10, -96, 14, 10, r);
    c.fillStyle = 'rgba(220,220,210,0.55)';
    c.font = 'bold 11px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('구역 폐쇄', 0, -96);
    c.restore();
  }

  function drawCone(c, x, gy, r) {
    c.fillStyle = '#a2502a';
    c.beginPath(); c.moveTo(x - 9, gy); c.lineTo(x, gy - 26); c.lineTo(x + 9, gy); c.closePath(); c.fill();
    c.fillStyle = 'rgba(220,210,190,0.5)';
    c.fillRect(x - 5, gy - 15, 10, 4);
    c.fillStyle = '#2a2a26';
    c.fillRect(x - 12, gy - 3, 24, 3);
    grassTuft(c, x + 10, gy, 10, r);
  }

  function drawShrub(c, x, gy, s, r) {
    for (var i = 0; i < 7; i++) {
      c.fillStyle = pick(r, MOSS);
      c.beginPath();
      c.arc(x + (r() - 0.5) * 40 * s, gy - 6 - r() * 18 * s, (7 + r() * 9) * s, 0, Math.PI * 2);
      c.fill();
    }
    for (i = 0; i < 3; i++) grassTuft(c, x + (r() - 0.5) * 40 * s, gy, 16 + r() * 16, r);
  }

  function drawProp(c, pr, gy) {
    var r = makeRng(pr.seed);
    switch (pr.kind) {
      case 'barrel': {
        var toxic = r() < 0.4;
        drawBarrel(c, pr.x, gy + 1, pr.s, r, toxic);
        if (r() < 0.45) drawBarrel(c, pr.x + 32 * pr.s, gy + 1, pr.s, r, false);
        if (r() < 0.25) {
          c.save(); c.translate(pr.x + 16, gy - 4); c.rotate(1.57);
          drawBarrel(c, 0, 14, pr.s * 0.9, r, false); c.restore();
        }
        grassTuft(c, pr.x - 16, gy, 12, r);
        break;
      }
      case 'rubble': drawRubble(c, pr.x, gy, pr.s, r); break;
      case 'tires': drawTires(c, pr.x, gy, pr.s, r); break;
      case 'barrier': drawBarrier(c, pr.x, gy, pr.s, r); break;
      case 'lamp': drawLamp(c, pr.x, gy, pr.flip, r); break;
      case 'sign': drawSign(c, pr.x, gy, pr.flip, r); break;
      case 'wreck': drawWreck(c, pr.x + 60, gy, pr.s * 0.9, pr.flip, r); break;
      case 'trafficlight': drawTrafficLight(c, pr.x, gy, pr.flip, r); break;
      case 'cone': drawCone(c, pr.x, gy, r); break;
      case 'shrub': drawShrub(c, pr.x, gy, pr.s, r); break;
    }
  }

  function drawEdgeBarricade(c, side, gy) {
    var r = makeRng(side > 0 ? 3131 : 4141);
    var x = side < 0 ? 0 : WORLD_W;
    var dir = side < 0 ? 1 : -1;
    // 잔해 더미
    c.fillStyle = '#3e3f39';
    c.beginPath();
    c.moveTo(x, gy + 2);
    c.lineTo(x, gy - 240);
    for (var i = 0; i <= 10; i++) {
      var t = i / 10;
      c.lineTo(x + dir * t * 120, gy - 240 * (1 - t * t) + r() * 18);
    }
    c.lineTo(x + dir * 130, gy + 2);
    c.closePath();
    c.fill();
    for (i = 0; i < 12; i++) {
      var cx = x + dir * r() * 100, cy = gy - r() * 200 * (1 - r() * 0.5);
      c.fillStyle = pick(r, ['#5e5f57', '#6b6a5f', '#4c4d46', '#6e4a30']);
      c.save(); c.translate(cx, cy); c.rotate(r() * 3);
      c.fillRect(-10 - r() * 14, -6 - r() * 8, 20 + r() * 28, 12 + r() * 14);
      c.restore();
    }
    // 철근
    c.strokeStyle = '#6a4024'; c.lineWidth = 2;
    for (i = 0; i < 7; i++) {
      var rx = x + dir * (10 + r() * 90), ry = gy - 40 - r() * 170;
      c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx + dir * (10 + r() * 30), ry - 10 - r() * 30); c.stroke();
    }
    drawBarrier(c, x + dir * 70, gy, 1.1, r);
    // 철조망
    c.strokeStyle = '#55524a'; c.lineWidth = 1;
    c.beginPath();
    for (i = 0; i < 18; i++) {
      var bx = x + dir * (20 + i * 8);
      c.moveTo(bx, gy - 52); c.lineTo(bx + dir * 8, gy - 60 + (i % 2) * 10);
    }
    c.stroke();
    mossDrape(c, side < 0 ? x : x - 120, side < 0 ? x + 120 : x, gy - 200, 14, r, true);
    ivy(c, x + dir * 60, gy, 160, r);
  }

  // ===========================================================================
  // 렌더 — 발판 구조물
  // ===========================================================================
  function platTop(c, x, y, w, r, mossy) {
    // 발판 윗면 표시선 + 이끼
    c.fillStyle = 'rgba(230,225,190,0.35)';
    c.fillRect(x, y, w, 2);
    if (mossy) mossDrape(c, x + 4, x + w - 4, y + 1, 6, r, true);
    mossClumps(c, x + 6, x + w - 6, y + 1, 7, r);
  }

  function drawPlatformBack(c, p, gy) {
    var r = makeRng(p.seed + 1);
    var i;
    if (p.kind === 'overpass') {
      // 교각
      var pxm = p.x + p.w * (p.side < 0 ? 0.62 : (p.side > 0 ? 0.38 : 0.5));
      var pw = 58;
      var pg = c.createLinearGradient(pxm - pw / 2, 0, pxm + pw / 2, 0);
      pg.addColorStop(0, '#4a4b43'); pg.addColorStop(0.4, '#6a6b60'); pg.addColorStop(1, '#3a3b34');
      c.fillStyle = pg;
      c.fillRect(pxm - pw / 2, p.y + 26, pw, gy - p.y - 24);
      c.fillStyle = '#5c5d53';
      c.fillRect(pxm - pw / 2 - 10, p.y + 26, pw + 20, 14);
      c.strokeStyle = 'rgba(15,15,12,0.7)'; c.lineWidth = 1.4;
      c.beginPath();
      var cy = p.y + 50, cx = pxm - 8;
      c.moveTo(cx, cy);
      while (cy < gy - 20) { cx += (r() - 0.5) * 16; cy += 14 + r() * 20; c.lineTo(cx, cy); }
      c.stroke();
      rustStreak(c, pxm - 14, p.y + 40, 10, 120, 0.5);
      rustStreak(c, pxm + 8, p.y + 40, 8, 80, 0.4);
      ivy(c, pxm - 12, gy, (gy - p.y) * 0.75, r);
      mossDrape(c, pxm - pw / 2, pxm + pw / 2, gy - 22, 10, r, false);
    } else if (p.kind === 'scaffold') {
      var poles = [p.x + 6, p.x + p.w / 2, p.x + p.w - 6];
      c.strokeStyle = '#6e4a2e'; c.lineWidth = 4;
      for (i = 0; i < poles.length; i++) { c.beginPath(); c.moveTo(poles[i], p.y + 4); c.lineTo(poles[i], gy); c.stroke(); }
      c.lineWidth = 2.5; c.strokeStyle = '#5c3e26';
      for (var ly = p.y + 50; ly < gy - 10; ly += 50) { c.beginPath(); c.moveTo(p.x + 6, ly); c.lineTo(p.x + p.w - 6, ly); c.stroke(); }
      c.lineWidth = 1.8; c.strokeStyle = '#7a5434';
      c.beginPath();
      c.moveTo(p.x + 6, p.y + 6); c.lineTo(p.x + p.w / 2, gy);
      c.moveTo(p.x + p.w - 6, p.y + 6); c.lineTo(p.x + p.w / 2, gy);
      c.moveTo(p.x + p.w / 2, p.y + 6); c.lineTo(p.x + p.w - 6, gy - 50);
      c.stroke();
      // 찢어진 방수포
      var tside = p.side > 0 ? p.x + p.w - 6 : p.x + 6;
      var td = p.side > 0 ? -1 : 1;
      c.fillStyle = 'rgba(70,95,85,0.75)';
      c.beginPath();
      c.moveTo(tside, p.y + 8);
      c.lineTo(tside + td * 70, p.y + 8);
      c.lineTo(tside + td * 64, p.y + 60);
      c.lineTo(tside + td * 50, p.y + 46);
      c.lineTo(tside + td * 38, p.y + 84);
      c.lineTo(tside + td * 20, p.y + 62);
      c.lineTo(tside, p.y + 90);
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(30,40,36,0.4)';
      c.fillRect(tside + (td > 0 ? 0 : -70), p.y + 8, 70, 4);
      for (i = 0; i < poles.length; i++) { c.fillStyle = '#2c2a25'; c.fillRect(poles[i] - 8, gy - 4, 16, 5); }
      ivy(c, poles[0], gy, 60, r);
    } else if (p.kind === 'billboard') {
      c.fillStyle = '#4a3a2c';
      c.fillRect(p.x + 36, p.y, 8, gy - p.y);
      c.fillRect(p.x + p.w - 44, p.y, 8, gy - p.y);
      c.strokeStyle = '#5a4030'; c.lineWidth = 2;
      c.beginPath();
      for (var by = p.y + 20; by < gy - 30; by += 60) {
        c.moveTo(p.x + 40, by); c.lineTo(p.x + p.w - 40, by + 40);
        c.moveTo(p.x + p.w - 40, by); c.lineTo(p.x + 40, by + 40);
      }
      c.stroke();
      // 간판 패널
      var bx0 = p.x - 24, bw = p.w + 48, bt = p.y - 150, bh = 132;
      c.fillStyle = '#4b3424';
      c.fillRect(bx0 + 30, bt + bh, 6, 22); c.fillRect(bx0 + bw - 36, bt + bh, 6, 22);
      c.fillStyle = '#3a2a1e';
      c.fillRect(bx0, bt, bw, bh);
      var pg2 = c.createLinearGradient(bx0, bt, bx0 + bw, bt + bh);
      pg2.addColorStop(0, '#8a8466'); pg2.addColorStop(0.5, '#a49a72'); pg2.addColorStop(1, '#6f6a55');
      c.fillStyle = pg2;
      c.fillRect(bx0 + 6, bt + 6, bw - 12, bh - 12);
      c.fillStyle = 'rgba(160,70,40,0.55)';
      c.beginPath(); c.arc(bx0 + 52, bt + 64, 34, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(60,50,40,0.75)';
      c.font = 'bold 22px sans-serif';
      c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText('새 도시,', bx0 + 98, bt + 46);
      c.fillText('새 희망', bx0 + 108, bt + 78);
      c.font = '11px sans-serif';
      c.fillText('신도심 재개발 2031', bx0 + 100, bt + 104);
      // 찢어진 포스터
      c.fillStyle = '#3a2a1e';
      c.beginPath();
      var tx = bx0 + bw * 0.62;
      c.moveTo(tx, bt + 6);
      for (i = 0; i < 7; i++) c.lineTo(tx + 10 + r() * 30, bt + 6 + i * 18 + r() * 8);
      c.lineTo(bx0 + bw - 6, bt + bh - 6); c.lineTo(bx0 + bw - 6, bt + 6);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(80,60,40,0.6)'; c.lineWidth = 1;
      for (var gx = bx0 + bw * 0.66; gx < bx0 + bw - 8; gx += 12) { c.beginPath(); c.moveTo(gx, bt + 8); c.lineTo(gx, bt + bh - 8); c.stroke(); }
      rustStreak(c, bx0 + 10, bt + 6, 40, 90, 0.35);
      rustStreak(c, bx0 + bw - 80, bt + 6, 30, 70, 0.3);
      c.strokeStyle = '#6e4a2e'; c.lineWidth = 4;
      c.strokeRect(bx0, bt, bw, bh);
      // 꺼진 조명
      for (i = 0; i < 3; i++) {
        var lx = bx0 + 40 + i * (bw - 80) / 2;
        c.fillStyle = '#2a2622'; c.fillRect(lx - 2, bt - 16, 4, 16);
        c.beginPath(); c.ellipse(lx, bt - 16, 9, 4, 0, 0, Math.PI * 2); c.fill();
      }
      mossDrape(c, bx0 - 2, bx0 + bw * 0.7, bt, 12, r, true);
    } else if (p.kind === 'balcony') {
      // 뒤쪽 출입구
      var dx = p.x + p.w * (p.side < 0 ? 0.55 : 0.2);
      c.fillStyle = '#4a4a42';
      c.fillRect(dx - 4, p.y - 82, 58, 84);
      c.fillStyle = '#121614';
      c.fillRect(dx, p.y - 78, 50, 80);
      c.fillStyle = '#5a4a36';
      c.save(); c.translate(dx + 50, p.y - 78); c.rotate(0.2); c.fillRect(-4, 0, 6, 78); c.restore();
      // 녹슨 난간 (뒤)
      c.strokeStyle = '#6e4628'; c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(p.x + 2, p.y - 30); c.lineTo(p.x + p.w * 0.6, p.y - 30);
      c.quadraticCurveTo(p.x + p.w * 0.75, p.y - 24, p.x + p.w * 0.82, p.y - 12);
      c.stroke();
      c.lineWidth = 2;
      for (var rx = p.x + 6; rx < p.x + p.w - 4; rx += 16) {
        if (rx > p.x + p.w * 0.66) {
          c.beginPath(); c.moveTo(rx, p.y); c.lineTo(rx + 6, p.y - 14); c.stroke();
        } else {
          c.beginPath(); c.moveTo(rx, p.y); c.lineTo(rx, p.y - 30); c.stroke();
        }
      }
      // 받침 브래킷
      c.strokeStyle = '#5a3a24'; c.lineWidth = 4;
      c.beginPath();
      c.moveTo(p.x + 16, p.y + 14); c.lineTo(p.x + 46, p.y + 54);
      c.moveTo(p.x + p.w - 16, p.y + 14); c.lineTo(p.x + p.w - 46, p.y + 54);
      c.stroke();
      rustStreak(c, p.x + 40, p.y + 54, 14, 80, 0.4);
    }
  }

  function drawPlatformFront(c, p, gy) {
    var r = makeRng(p.seed + 2);
    var i;
    switch (p.kind) {
      case 'car': {
        var x0 = p.x - 34, x1 = p.x + p.w + 34;
        var bodyTop = gy - 58;
        var col = pick(r, ['#4d5f66', '#6e4a3c', '#7d7660']);
        // 바퀴(바람 빠짐)
        c.fillStyle = '#161614';
        c.beginPath(); c.ellipse(x0 + 40, gy - 12, 18, 13, 0, 0, Math.PI * 2); c.ellipse(x1 - 40, gy - 12, 18, 13, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#6a4024';
        c.beginPath(); c.arc(x0 + 40, gy - 13, 7, 0, Math.PI * 2); c.arc(x1 - 40, gy - 13, 7, 0, Math.PI * 2); c.fill();
        // 차체
        var cg = c.createLinearGradient(0, bodyTop, 0, gy - 14);
        cg.addColorStop(0, col); cg.addColorStop(1, '#2a2622');
        c.fillStyle = cg;
        roundRect(c, x0, bodyTop, x1 - x0, 44, 10); c.fill();
        // 캐빈
        c.fillStyle = col;
        c.beginPath();
        c.moveTo(x0 + 22, bodyTop + 2);
        c.lineTo(p.x, p.y);
        c.lineTo(p.x + p.w, p.y);
        c.lineTo(x1 - 22, bodyTop + 2);
        c.closePath(); c.fill();
        // 깨진 창
        c.fillStyle = '#121614';
        var midx = p.x + p.w / 2;
        c.beginPath(); c.moveTo(x0 + 32, bodyTop); c.lineTo(p.x + 6, p.y + 6); c.lineTo(midx - 4, p.y + 6); c.lineTo(midx - 4, bodyTop); c.closePath(); c.fill();
        c.beginPath(); c.moveTo(midx + 4, bodyTop); c.lineTo(midx + 4, p.y + 6); c.lineTo(p.x + p.w - 6, p.y + 6); c.lineTo(x1 - 32, bodyTop); c.closePath(); c.fill();
        c.fillStyle = 'rgba(140,165,155,0.4)';
        c.beginPath(); c.moveTo(p.x + 8, p.y + 8); c.lineTo(p.x + 30, p.y + 8); c.lineTo(p.x + 10, p.y + 26); c.closePath(); c.fill();
        // 녹
        rustBlotch(c, x0 + 30, bodyTop + 22, 30, 14, r);
        rustBlotch(c, x1 - 50, bodyTop + 16, 26, 12, r);
        rustBlotch(c, midx, p.y + 4, 40, 6, r);
        c.strokeStyle = 'rgba(15,12,10,0.6)'; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(midx, bodyTop + 4); c.lineTo(midx, gy - 18); c.stroke();
        // 전조등/범퍼
        c.fillStyle = '#2a2622';
        c.fillRect(x0 - 4, gy - 30, 10, 8); c.fillRect(x1 - 6, gy - 30, 10, 8);
        c.fillStyle = 'rgba(180,170,120,0.35)';
        c.beginPath(); c.arc(x0 + 10, bodyTop + 14, 5, 0, Math.PI * 2); c.fill();
        platTop(c, p.x, p.y, p.w, r, true);
        for (i = 0; i < 4; i++) grassTuft(c, x0 + 20 + r() * (x1 - x0 - 40), gy + 1, 14 + r() * 14, r);
        break;
      }
      case 'bus': {
        var bx0 = p.x - 8, bx1 = p.x + p.w + 8, btop = p.y;
        var bcol = '#7d6a3a';
        c.fillStyle = '#161614';
        var wheels = [bx0 + 52, bx0 + (bx1 - bx0) * 0.5, bx1 - 52];
        for (i = 0; i < 3; i++) { c.beginPath(); c.ellipse(wheels[i], gy - 13, 20, 14, 0, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = '#6a4024';
        for (i = 0; i < 3; i++) { c.beginPath(); c.arc(wheels[i], gy - 14, 8, 0, Math.PI * 2); c.fill(); }
        var bgd = c.createLinearGradient(0, btop, 0, gy - 16);
        bgd.addColorStop(0, '#8d7a46'); bgd.addColorStop(0.6, bcol); bgd.addColorStop(1, '#3a3020');
        c.fillStyle = bgd;
        roundRect(c, bx0, btop, bx1 - bx0, gy - 16 - btop, 12); c.fill();
        // 띠
        c.fillStyle = 'rgba(40,90,80,0.55)';
        c.fillRect(bx0, btop + 58, bx1 - bx0, 10);
        // 창문 줄
        var wx = bx0 + 18;
        while (wx < bx1 - 50) {
          brokenWindow(c, wx, btop + 14, 36, 36, r);
          wx += 46;
        }
        // 앞유리 + 행선판
        c.fillStyle = '#121614';
        c.fillRect(bx1 - 40, btop + 12, 28, 46);
        c.fillStyle = '#20251f';
        c.fillRect(bx0 + 14, btop + 74, 70, 16);
        c.fillStyle = 'rgba(230,140,60,0.45)';
        c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('폐허행 44', bx0 + 49, btop + 82);
        // 문
        c.fillStyle = '#1a1d1a';
        c.fillRect(bx0 + (bx1 - bx0) * 0.62, btop + 70, 30, gy - 20 - btop - 70);
        // 녹
        for (i = 0; i < 9; i++) rustBlotch(c, bx0 + r() * (bx1 - bx0), btop + 20 + r() * (gy - btop - 40), 30, 16, r);
        for (i = 0; i < 6; i++) rustStreak(c, bx0 + 20 + r() * (bx1 - bx0 - 40), btop + 50, 12, 40 + r() * 40, 0.4);
        platTop(c, p.x, p.y, p.w, r, true);
        // 지붕 수풀
        for (i = 0; i < 4; i++) {
          var sx = p.x + 20 + r() * (p.w - 40);
          drawShrub(c, sx, p.y + 2, 0.45, r);
        }
        for (i = 0; i < 2; i++) ivy(c, bx0 + 10 + r() * (bx1 - bx0 - 20), gy - 14, 50 + r() * 50, r);
        for (i = 0; i < 6; i++) grassTuft(c, bx0 + r() * (bx1 - bx0), gy + 1, 14 + r() * 16, r);
        break;
      }
      case 'balcony': {
        var sg = c.createLinearGradient(0, p.y, 0, p.y + 16);
        sg.addColorStop(0, '#77776b'); sg.addColorStop(1, '#4a4a42');
        c.fillStyle = sg;
        c.beginPath();
        c.moveTo(p.x, p.y); c.lineTo(p.x + p.w, p.y);
        c.lineTo(p.x + p.w, p.y + 12); c.lineTo(p.x + p.w - 14, p.y + 16);
        c.lineTo(p.x + p.w - 30, p.y + 13); c.lineTo(p.x + 10, p.y + 16); c.lineTo(p.x, p.y + 12);
        c.closePath(); c.fill();
        rustStreak(c, p.x + p.w - 30, p.y + 12, 14, 50, 0.4);
        // 끝단 철근
        c.strokeStyle = '#6a4024'; c.lineWidth = 1.5;
        c.beginPath();
        var ex = p.side > 0 ? p.x : p.x + p.w, ed = p.side > 0 ? -1 : 1;
        c.moveTo(ex, p.y + 5); c.lineTo(ex + ed * 12, p.y + 1);
        c.moveTo(ex, p.y + 10); c.lineTo(ex + ed * 9, p.y + 14);
        c.stroke();
        platTop(c, p.x, p.y, p.w, r, true);
        break;
      }
      case 'overpass': {
        var th = 28;
        var og = c.createLinearGradient(0, p.y, 0, p.y + th);
        og.addColorStop(0, '#7a7a6e'); og.addColorStop(0.3, '#626358'); og.addColorStop(1, '#45463e');
        c.fillStyle = og;
        c.beginPath();
        c.moveTo(p.x + 4, p.y);
        c.lineTo(p.x + p.w - 4, p.y);
        // 오른쪽 부서진 끝
        c.lineTo(p.x + p.w + 6, p.y + 6); c.lineTo(p.x + p.w - 2, p.y + 12);
        c.lineTo(p.x + p.w + 4, p.y + 20); c.lineTo(p.x + p.w - 10, p.y + th);
        c.lineTo(p.x + 12, p.y + th);
        // 왼쪽 부서진 끝
        c.lineTo(p.x - 4, p.y + 22); c.lineTo(p.x + 3, p.y + 15); c.lineTo(p.x - 6, p.y + 8);
        c.closePath(); c.fill();
        // 아스팔트 윗면 + 바랜 차선
        c.fillStyle = '#3a3b35';
        c.fillRect(p.x + 4, p.y, p.w - 8, 5);
        c.fillStyle = 'rgba(190,170,90,0.3)';
        for (var lx = p.x + 20; lx < p.x + p.w - 30; lx += 60) c.fillRect(lx, p.y + 1.5, 26, 2);
        // 이음부/균열
        c.strokeStyle = 'rgba(15,15,12,0.6)'; c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(p.x + p.w * 0.35, p.y + 6); c.lineTo(p.x + p.w * 0.37, p.y + 16); c.lineTo(p.x + p.w * 0.34, p.y + th);
        c.stroke();
        // 노출 철근
        c.strokeStyle = '#7a4a2a'; c.lineWidth = 2;
        for (i = 0; i < 4; i++) {
          var yy = p.y + 8 + i * 5;
          c.beginPath(); c.moveTo(p.x + p.w, yy); c.quadraticCurveTo(p.x + p.w + 14, yy - 4, p.x + p.w + 16 + r() * 14, yy + 8 + r() * 12); c.stroke();
          c.beginPath(); c.moveTo(p.x, yy); c.quadraticCurveTo(p.x - 12, yy + 2, p.x - 14 - r() * 12, yy + 10 + r() * 10); c.stroke();
        }
        // 가드레일 (기울고 끊김)
        c.strokeStyle = '#6e5038'; c.lineWidth = 3;
        c.beginPath();
        c.moveTo(p.x + 10, p.y - 18); c.lineTo(p.x + p.w * 0.55, p.y - 18);
        c.moveTo(p.x + p.w * 0.62, p.y - 14); c.lineTo(p.x + p.w - 14, p.y - 20);
        c.stroke();
        c.lineWidth = 2;
        for (var gx = p.x + 14; gx < p.x + p.w - 10; gx += 28) {
          if (gx > p.x + p.w * 0.55 && gx < p.x + p.w * 0.62) continue;
          c.beginPath(); c.moveTo(gx, p.y); c.lineTo(gx, p.y - 19); c.stroke();
        }
        for (i = 0; i < 5; i++) rustStreak(c, p.x + 10 + r() * (p.w - 30), p.y + 10, 10, 18, 0.45);
        platTop(c, p.x + 4, p.y, p.w - 8, r, true);
        mossDrape(c, p.x + 10, p.x + p.w - 10, p.y + th - 4, 8, r, true);
        break;
      }
      case 'scaffold': {
        c.fillStyle = '#4a3a2a';
        c.fillRect(p.x, p.y + 6, p.w, 6);
        var plank = p.x;
        while (plank < p.x + p.w) {
          var pw = 26 + r() * 20;
          if (plank + pw > p.x + p.w) pw = p.x + p.w - plank;
          c.fillStyle = pick(r, ['#6b5236', '#5a4430', '#73583a']);
          c.fillRect(plank, p.y, pw - 1.5, 7);
          plank += pw;
        }
        c.fillStyle = '#7a5434';
        c.fillRect(p.x - 3, p.y + 6, p.w + 6, 3);
        rustBlotch(c, p.x + p.w * 0.3, p.y + 8, 20, 3, r);
        platTop(c, p.x, p.y, p.w, r, false);
        break;
      }
      case 'billboard': {
        // 철망 통로
        c.fillStyle = '#4b3a2c';
        c.fillRect(p.x - 6, p.y, p.w + 12, 9);
        c.strokeStyle = 'rgba(20,14,10,0.7)'; c.lineWidth = 1;
        c.beginPath();
        for (var mx = p.x - 4; mx < p.x + p.w + 6; mx += 6) { c.moveTo(mx, p.y + 1); c.lineTo(mx + 3, p.y + 8); }
        c.stroke();
        c.strokeStyle = '#6e4a2e'; c.lineWidth = 2;
        c.beginPath();
        c.moveTo(p.x - 6, p.y - 22); c.lineTo(p.x + p.w + 6, p.y - 22);
        for (var rx2 = p.x - 6; rx2 <= p.x + p.w + 6; rx2 += 26) { c.moveTo(rx2, p.y); c.lineTo(rx2, p.y - 22); }
        c.stroke();
        rustBlotch(c, p.x + p.w * 0.6, p.y + 4, 24, 4, r);
        platTop(c, p.x - 6, p.y, p.w + 12, r, false);
        break;
      }
    }
  }

  // ===========================================================================
  // 근경 타일 (월드 좌표, 캐시)
  // ===========================================================================
  function buildTile(ix) {
    var s = cacheScale;
    var tw = TILE + 2;
    var cv = makeCanvas(tw * s, tileH * s);
    if (!cv) return null;
    var c = cv.getContext('2d');
    var x0 = ix * TILE, x1 = x0 + tw;
    c.setTransform(s, 0, 0, s, -x0 * s, -tileTop * s);
    drawNearWorld(c, x0, x1);
    return cv;
  }

  function drawNearWorld(c, x0, x1) {
    var gy = G.world.groundY;
    var bottom = tileTop + tileH;
    var i, f;
    var margin = 220;
    // 건물 외벽
    for (i = 0; i < facades.length; i++) {
      f = facades[i];
      if (f.x + f.w < x0 - 40 || f.x > x1 + 40) continue;
      drawFacade(c, f, gy);
    }
    for (i = 0; i < neons.length; i++) {
      if (neons[i].x + 80 < x0 || neons[i].x > x1) continue;
      drawNeonFrame(c, neons[i], gy);
    }
    // 대기 원근 (외벽을 약간 흐리게)
    var ag = c.createLinearGradient(0, tileTop, 0, gy);
    ag.addColorStop(0, 'rgba(110,128,118,0.22)');
    ag.addColorStop(1, 'rgba(25,32,30,0.25)');
    c.fillStyle = ag;
    c.fillRect(x0, tileTop, x1 - x0, gy - tileTop);

    // 발판 뒤 구조물
    var plats = G.world.platforms;
    for (i = 0; i < plats.length; i++) {
      var p = plats[i];
      if (p.x + p.w + margin < x0 || p.x - margin > x1) continue;
      drawPlatformBack(c, p, gy);
    }
    // 도로
    drawRoad(c, x0, x1, gy, bottom);
    for (i = 0; i < puddles.length; i++) {
      var pd = puddles[i];
      if (pd.x + pd.w < x0 || pd.x > x1) continue;
      drawPuddle(c, pd, gy);
    }
    // 소품
    for (i = 0; i < props.length; i++) {
      var pr = props[i];
      if (pr.x + margin < x0 || pr.x - margin > x1) continue;
      drawProp(c, pr, gy);
    }
    // 발판 앞 구조물
    for (i = 0; i < plats.length; i++) {
      var q = plats[i];
      if (q.x + q.w + margin < x0 || q.x - margin > x1) continue;
      drawPlatformFront(c, q, gy);
    }
    // 맵 양 끝 바리케이드
    if (x0 < 260) drawEdgeBarricade(c, -1, gy);
    if (x1 > WORLD_W - 260) drawEdgeBarricade(c, 1, gy);
  }

  function getTile(ix) {
    var t = tiles[ix];
    if (t === undefined) {
      t = buildTile(ix);
      tiles[ix] = t;
    }
    return t;
  }

  // ===========================================================================
  // 렌더 — 동적 요소
  // ===========================================================================
  function drawLightShafts(c, W, H) {
    var t = bgTime;
    var off = -G.camera.x * 0.04;
    for (var i = 0; i < 4; i++) {
      var bx = ((W * (0.15 + i * 0.27) + off) % (W + 400) + W + 400) % (W + 400) - 200;
      var a = 0.05 + 0.035 * Math.sin(t * 0.25 + i * 1.7);
      var w0 = 40 + i * 14, w1 = 160 + i * 40;
      var g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(240,232,190,' + a.toFixed(3) + ')');
      g.addColorStop(0.8, 'rgba(240,232,190,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(bx, 0); c.lineTo(bx + w0, 0);
      c.lineTo(bx + w0 + H * 0.35 + w1 / 2, H); c.lineTo(bx + H * 0.35 - w1 / 2, H);
      c.closePath(); c.fill();
    }
  }

  function drawMotes(c, W, H, front) {
    var t = bgTime;
    var n = front ? 26 : 60;
    var seed = front ? 77 : 33;
    var span = W + 80;
    for (var i = 0; i < n; i++) {
      var h1 = hash(i, seed), h2 = hash(i, seed + 1), h3 = hash(i, seed + 2), h4 = hash(i, seed + 3);
      var par = front ? 1.1 + h3 * 0.4 : 0.15 + h3 * 0.5;
      var x = h1 * span + t * (6 + h4 * 16) + Math.sin(t * 0.7 + i) * 14 - G.camera.x * par;
      x = ((x % span) + span) % span - 40;
      var y = h2 * H - t * (4 + h4 * 8) + Math.sin(t * 0.9 + i * 1.3) * 10;
      y = ((y % H) + H) % H;
      var spore = h4 < 0.3;
      var sz = front ? 2 + h3 * 2.5 : 0.8 + h3 * 1.6;
      var a = (front ? 0.35 : 0.5) * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 2.1));
      if (spore) {
        c.fillStyle = 'rgba(180,230,110,' + (a * 0.35).toFixed(3) + ')';
        c.beginPath(); c.arc(x, y, sz * 2.6, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(210,245,150,' + a.toFixed(3) + ')';
      } else {
        c.fillStyle = 'rgba(220,214,185,' + (a * 0.8).toFixed(3) + ')';
      }
      c.beginPath(); c.arc(x, y, sz, 0, Math.PI * 2); c.fill();
    }
  }

  function drawVines(c, x0, x1, gy) {
    var t = bgTime;
    c.lineCap = 'round';
    for (var i = 0; i < vines.length; i++) {
      var v = vines[i];
      if (v.x < x0 - 40 || v.x > x1 + 40) continue;
      var ay = gy - v.dy;
      var segs = Math.max(4, Math.floor(v.len / 14));
      var px = v.x, py = ay;
      c.strokeStyle = '#3a5222';
      c.lineWidth = v.thick;
      c.beginPath();
      c.moveTo(px, py);
      var pts = [];
      for (var k = 1; k <= segs; k++) {
        var f = k / segs;
        var sway = Math.sin(t * 1.2 + v.seed * 0.013 + f * 2.2) * 7 * f * f + Math.sin(t * 2.3 + v.seed) * 1.5 * f;
        var nx = v.x + sway, ny = ay + v.len * f;
        c.lineTo(nx, ny);
        pts.push(nx, ny);
      }
      c.stroke();
      for (k = 0; k < pts.length; k += 2) {
        var side = ((k >> 1) % 2) ? 1 : -1;
        var col = MOSS[(v.seed + k) % MOSS.length];
        leaf(c, pts[k] + side * 3, pts[k + 1], 3.2 + hash(v.seed + k, 3) * 2, side * 0.8, col);
      }
    }
  }

  function drawNeonsDynamic(c, x0, x1, gy) {
    var tick = Math.floor(bgTime * 9);
    for (var i = 0; i < neons.length; i++) {
      var n = neons[i];
      if (n.x + 80 < x0 || n.x > x1) continue;
      var h = hash(tick, n.seed);
      var on = h > 0.18 && !(hash(Math.floor(bgTime * 0.7), n.seed + 5) < 0.2 && h < 0.6);
      var y = gy - n.dy;
      c.font = 'bold 24px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      if (on) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.35;
        c.fillStyle = n.color;
        c.beginPath(); c.ellipse(n.x + 35, y + 26, 60, 36, 0, 0, Math.PI * 2); c.fill();
        c.restore();
        c.fillStyle = n.color;
      } else {
        c.fillStyle = 'rgba(90,60,50,0.8)';
      }
      c.fillText(n.text, n.x + 35, y + 28);
    }
  }

  function drawPuddleShimmer(c, x0, x1, gy) {
    var t = bgTime;
    c.strokeStyle = 'rgba(230,235,210,0.35)';
    c.lineWidth = 1;
    for (var i = 0; i < puddles.length; i++) {
      var pd = puddles[i];
      if (pd.x + pd.w < x0 || pd.x > x1) continue;
      var cx = pd.x + pd.w / 2, cy = gy + pd.dy;
      var ph = (t * 0.6 + pd.seed * 0.001) % 1;
      var hw = pd.w * 0.18 * (0.6 + 0.4 * Math.sin(t * 1.4 + pd.seed));
      c.beginPath();
      c.moveTo(cx - pd.w * 0.3 + ph * pd.w * 0.2 - hw / 2, cy - 1);
      c.lineTo(cx - pd.w * 0.3 + ph * pd.w * 0.2 + hw / 2, cy - 1);
      c.stroke();
    }
  }

  function drawFrontFog(c, W, H) {
    var gy = G.world.groundY;
    var t = bgTime;
    var fg = c.createLinearGradient(0, gy - 120, 0, H);
    fg.addColorStop(0, 'rgba(150,168,150,0)');
    fg.addColorStop(0.5, 'rgba(150,168,150,0.12)');
    fg.addColorStop(1, 'rgba(120,140,125,0.22)');
    c.fillStyle = fg;
    c.fillRect(0, gy - 120, W, H - gy + 120);
    // 떠다니는 안개 덩어리
    for (var i = 0; i < 6; i++) {
      var span = W + 600;
      var x = hash(i, 501) * span + t * (8 + hash(i, 502) * 10) - G.camera.x * 1.15;
      x = ((x % span) + span) % span - 300;
      var y = gy - 30 + hash(i, 503) * 90;
      var rw = 180 + hash(i, 504) * 220;
      var g2 = c.createRadialGradient(x, y, 0, x, y, rw);
      g2.addColorStop(0, 'rgba(170,185,168,0.12)');
      g2.addColorStop(1, 'rgba(170,185,168,0)');
      c.fillStyle = g2;
      c.fillRect(x - rw, y - rw, rw * 2, rw * 2);
    }
  }

  function buildVignette() {
    var W = G.width, H = G.height;
    var cv = makeCanvas(W, H);
    if (!cv) return null;
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(8,14,12,0)');
    g.addColorStop(1, 'rgba(8,14,12,0.6)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // 녹슨 색감 보정 (가장자리 살짝 주황)
    var g2 = c.createLinearGradient(0, 0, 0, H);
    g2.addColorStop(0, 'rgba(60,90,85,0.10)');
    g2.addColorStop(1, 'rgba(110,60,30,0.10)');
    c.fillStyle = g2;
    c.fillRect(0, 0, W, H);
    return cv;
  }

  // ===========================================================================
  // 렌더 — 플레이어
  // ===========================================================================
  function drawShadow(c, p) {
    var cx = p.x + p.w / 2, by = p.y + p.h;
    var floor = groundBelow(p);
    var hgt = Math.max(0, floor - by);
    var k = Math.max(0.25, 1 - hgt / 300);
    c.fillStyle = 'rgba(0,0,0,' + (0.3 * k).toFixed(3) + ')';
    c.beginPath();
    c.ellipse(cx, floor + 1, p.w * 0.65 * k, 5 * k, 0, 0, Math.PI * 2);
    c.fill();
  }

  function groundBelow(p) {
    var best = G.world.groundY;
    var by = p.y + p.h;
    var plats = G.world.platforms;
    for (var i = 0; i < plats.length; i++) {
      var pl = plats[i];
      if (p.x + p.w <= pl.x || p.x >= pl.x + pl.w) continue;
      if (pl.y >= by - 1 && pl.y < best) best = pl.y;
    }
    return best;
  }

  function drawPlayer(c, p) {
    if (!p || !p.alive) return;
    drawShadow(c, p);
    var blinkOff = p.invulnTimer > 0 && Math.floor(G.time * 18) % 2 === 0;
    var pal = palOf(p);
    var flash = p.hitFlash > 0;
    function col(v) { return flash ? '#ffffff' : v; }
    var cx = p.x + p.w / 2, by = p.y + p.h;
    var t = G.time + (p.isLocal ? 0 : 1.7);
    var speedK = clamp(Math.abs(p.vx) / MAX_SPEED, 0, 1);
    var air = !p.onGround;
    var casting = p.anim === 'cast';
    var swing = air ? 0 : Math.sin(p._walk || 0) * 0.65 * speedK;
    var bob = air ? 0 : Math.abs(Math.sin(p._walk || 0)) * 2.5 * speedK;

    if (!blinkOff) {
      c.save();
      c.translate(cx, by);
      c.scale(p.facing, 1);
      if (!air) c.translate(0, -bob);
      var lean = clamp(p.vx * p.facing / MAX_SPEED, -1, 1) * 0.08;
      c.rotate(lean);

      // 망토
      var flow = 0.35 + speedK * 0.65 + (air ? 0.3 : 0);
      var w1 = Math.sin(t * 9) * 4 * (0.5 + flow);
      var w2 = Math.sin(t * 9 + 1.6) * 5 * (0.5 + flow);
      var lift = air ? (p.vy < 0 ? 10 : -6) : 0;
      c.fillStyle = col(pal.cloak);
      c.beginPath();
      c.moveTo(-6, -48);
      c.quadraticCurveTo(-16 - flow * 10, -34 + w1 + lift * 0.5, -14 - flow * 22, -8 + w2 + lift);
      c.lineTo(-10 - flow * 18, -2 + w1 * 0.5 + lift);
      c.lineTo(-4 - flow * 14, -6 + w1 + lift);
      c.quadraticCurveTo(-4, -20, 4, -46);
      c.closePath();
      c.fill();
      c.fillStyle = col(pal.cloakDark);
      c.beginPath();
      c.moveTo(-5, -46);
      c.quadraticCurveTo(-10 - flow * 6, -30 + w1 * 0.6, -9 - flow * 14, -12 + w2 * 0.8 + lift * 0.8);
      c.lineTo(-5 - flow * 12, -9 + w1 + lift);
      c.quadraticCurveTo(-4, -22, -1, -45);
      c.closePath();
      c.fill();

      // 다리
      c.lineCap = 'round';
      c.lineWidth = 7;
      var backA, frontA;
      if (air) { backA = p.vy < 0 ? -0.5 : -0.25; frontA = p.vy < 0 ? 0.7 : 0.35; }
      else if (casting) { backA = -0.35; frontA = 0.3; }
      else { backA = -swing; frontA = swing; }
      c.strokeStyle = col('#1f1c1a');
      drawLeg(c, -2, -22, backA, air, col(pal.trim));
      c.strokeStyle = col(pal.suit);
      drawLeg(c, 2, -22, frontA, air, col(pal.trim));

      // 몸통
      c.fillStyle = col(pal.suit);
      roundRect(c, -10, -48, 20, 28, 6); c.fill();
      c.fillStyle = col(pal.suitHi);
      roundRect(c, -2, -46, 10, 22, 4); c.fill();
      c.fillStyle = col(pal.trim);
      c.fillRect(-10, -25, 20, 3);
      // 가슴 문양 (빛남)
      c.save();
      if (!flash) { c.shadowColor = pal.glow; c.shadowBlur = 8; }
      c.fillStyle = col(pal.trim);
      c.beginPath();
      c.moveTo(3, -44); c.lineTo(-2, -36); c.lineTo(2, -36); c.lineTo(-1, -30); c.lineTo(6, -39); c.lineTo(2, -39);
      c.closePath(); c.fill();
      c.restore();

      // 팔
      c.lineWidth = 6;
      c.strokeStyle = col(pal.suitHi);
      var hx, hy;
      if (casting) {
        c.beginPath(); c.moveTo(2, -42); c.lineTo(20, -40); c.stroke();
        hx = 22; hy = -40;
      } else {
        var armA = air ? -2.2 : swing * 0.9;
        hx = Math.sin(armA) * 16; hy = -42 + Math.cos(armA) * 16;
        c.beginPath(); c.moveTo(0, -42); c.lineTo(Math.sin(armA) * 14, -42 + Math.cos(armA) * 14); c.stroke();
      }
      c.fillStyle = col(pal.skin);
      c.beginPath(); c.arc(hx, hy, 3.6, 0, Math.PI * 2); c.fill();
      if (casting && !flash) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        var hg = c.createRadialGradient(hx + 2, hy, 0, hx + 2, hy, 16);
        hg.addColorStop(0, 'rgba(255,250,210,0.95)');
        hg.addColorStop(0.35, 'rgba(255,170,60,0.7)');
        hg.addColorStop(1, 'rgba(255,80,20,0)');
        c.fillStyle = hg;
        c.beginPath(); c.arc(hx + 2, hy, 16, 0, Math.PI * 2); c.fill();
        c.restore();
      }

      // 머리
      c.fillStyle = col(pal.skin);
      c.beginPath(); c.arc(1, -57, 9.5, 0, Math.PI * 2); c.fill();
      // 두건/후드
      c.fillStyle = col(pal.cloakDark);
      c.beginPath();
      c.arc(0, -58, 10.5, Math.PI * 0.92, Math.PI * 2.02);
      c.quadraticCurveTo(-6, -60, -12, -50);
      c.closePath(); c.fill();
      // 마스크 띠
      c.fillStyle = col('#1a1714');
      c.fillRect(-5, -60, 16, 5);
      // 빛나는 눈
      c.save();
      if (!flash) { c.shadowColor = pal.glow; c.shadowBlur = 10; }
      c.fillStyle = col(pal.eye);
      var blink = (Math.floor(t * 10) % 37 === 0) ? 0.4 : 1.6;
      c.beginPath(); c.ellipse(6.5, -57.5, 2.1, blink, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(2, -57.5, 1.6, blink, 0, 0, Math.PI * 2); c.fill();
      c.restore();
      c.restore();
    }

    // 이름표 / HP 바
    var tagY = p.y - 12;
    c.font = 'bold 12px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var label = p.isLocal ? '나' : (p.name || '?');
    var tw = (c.measureText ? c.measureText(label).width : 14) + 12;
    if (!p.isLocal) tagY -= 8;
    c.fillStyle = 'rgba(10,14,12,0.6)';
    roundRect(c, cx - tw / 2, tagY - 8, tw, 16, 6); c.fill();
    c.fillStyle = pal.trim;
    c.fillText(label, cx, tagY);
    if (!p.isLocal) {
      var bw = 46, bh = 5, bx = cx - bw / 2, bY = p.y - 9;
      var ratio = clamp(p.hp / p.maxHp, 0, 1);
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(bx - 1, bY - 1, bw + 2, bh + 2);
      c.fillStyle = ratio > 0.5 ? '#7fd858' : (ratio > 0.25 ? '#ffc23a' : '#ff4a3a');
      c.fillRect(bx, bY, bw * ratio, bh);
    }
  }

  function drawLeg(c, hipX, hipY, ang, air, shoe) {
    var len1 = 11, len2 = 11;
    var kx = hipX + Math.sin(ang) * len1;
    var ky = hipY + Math.cos(ang) * len1;
    var knee = air ? -0.9 : Math.max(0, -ang) * 0.8;
    var fx = kx + Math.sin(ang - knee) * len2;
    var fy = ky + Math.cos(ang - knee) * len2;
    c.beginPath();
    c.moveTo(hipX, hipY);
    c.lineTo(kx, ky);
    c.lineTo(fx, fy);
    c.stroke();
    var keep = c.fillStyle;
    c.fillStyle = shoe;
    c.beginPath(); c.ellipse(fx + 2, fy, 4.5, 3, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = keep;
  }

  // ===========================================================================
  // 렌더 — 파티클
  // ===========================================================================
  function drawParticles(c) {
    var ps = G.particles;
    var x0 = G.camera.x - 60, x1 = G.camera.x + G.width + 60;
    var i, p, a, s;
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      if (p.glow || p.x < x0 || p.x > x1) continue;
      a = clamp(p.life / (p.maxLife || 1), 0, 1);
      c.globalAlpha = a;
      c.fillStyle = p.color || '#ffffff';
      s = (p.size || 3) * (0.4 + 0.6 * a);
      c.beginPath(); c.arc(p.x, p.y, s, 0, Math.PI * 2); c.fill();
    }
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      if (!p.glow || p.x < x0 || p.x > x1) continue;
      a = clamp(p.life / (p.maxLife || 1), 0, 1);
      s = (p.size || 3) * (0.4 + 0.6 * a);
      c.globalAlpha = a * 0.35;
      c.fillStyle = p.color || '#ffffff';
      c.beginPath(); c.arc(p.x, p.y, s * 2.4, 0, Math.PI * 2); c.fill();
      c.globalAlpha = a;
      c.beginPath(); c.arc(p.x, p.y, s, 0, Math.PI * 2); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  // ===========================================================================
  // 렌더 (공개)
  // ===========================================================================
  var prewarmIdx = 0;

  // 기기 픽셀 격자에 맞춤 (원래 dpr 반올림 방식)
  function snapPx(v) { return Math.round(v * dpr) / dpr; }

  function render() {
    if (!ctx || !G.width) return;
    ensure3D();
    var c = ctx;
    var W = G.width, H = G.height;
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';

    // 카메라 (흔들림 포함)
    var camX = snapPx(G.camera.x - shakeX);
    var camY = snapPx(G.camera.y - shakeY);

    if (r3On) {
      // 3D 배경/플레이어는 #game3d 가 그림 → 오버레이는 투명하게 비움
      try {
        G.Render3D.render(camX, camY, G.running ? players.all() : [], G.running ? G.time : bgTime);
      } catch (err) {
        if (window.console) console.error('[world] Render3D.render', err);
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, bufW, bufH);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!skyCache) skyCache = buildSky();
      if (!farLayers.length) {
        for (var d = 0; d < FAR_DEFS.length; d++) {
          var L = buildFarLayer(FAR_DEFS[d]);
          if (L) farLayers.push(L);
        }
      }
      if (!vignetteCache) vignetteCache = buildVignette();

      // --- 배경 (화면 좌표, 흔들림 일부)
      c.save();
      c.translate(snapPx(shakeX * 0.3), snapPx(shakeY * 0.3));
      if (skyCache) c.drawImage(skyCache, -2, -2, W + 4, H + 4);
      drawLightShafts(c, W, H);
      for (var li = 0; li < farLayers.length; li++) {
        var ly = farLayers[li];
        var lx = -snapPx(G.camera.x * ly.f) - 120;
        c.drawImage(ly.cv, lx, 0, ly.w, ly.h);
        if (li === 0) drawMotes(c, W, H, false);
      }
      c.restore();
    }

    // --- 월드 좌표
    c.save();
    c.translate(-camX, -camY);
    var vx0 = G.camera.x - 60, vx1 = G.camera.x + W + 60;
    var gy = G.world.groundY;
    if (!r3On) {
      var t0 = Math.max(0, Math.floor(vx0 / TILE)), t1 = Math.min(tileCount - 1, Math.floor(vx1 / TILE));
      for (var ti = t0; ti <= t1; ti++) {
        var tile = getTile(ti);
        if (tile) c.drawImage(tile, ti * TILE, tileTop, TILE + 2, tileH);
      }
      // 보이지 않는 타일 미리 생성 (프레임당 1개)
      for (var tries = 0; tries < tileCount; tries++) {
        prewarmIdx = (prewarmIdx + 1) % tileCount;
        if (tiles[prewarmIdx] === undefined) { getTile(prewarmIdx); break; }
      }
      drawPuddleShimmer(c, vx0, vx1, gy);
      drawNeonsDynamic(c, vx0, vx1, gy);
      drawVines(c, vx0, vx1, gy);
    }

    if (G.running) {
      if (G.Missions && G.Missions.render) G.Missions.render(c);
      if (G.Items && G.Items.render) G.Items.render(c);
      if (G.Mutants && G.Mutants.render) G.Mutants.render(c);
      if (!r3Owns()) {
        var os = players.list();
        for (var oi = 0; oi < os.length; oi++) drawPlayer(c, os[oi]);
        drawPlayer(c, players.local);
      }
      if (G.Powers && G.Powers.render) G.Powers.render(c);
    }
    drawParticles(c);
    c.restore();
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';

    // --- 전경 안개 / 비네트
    drawMotes(c, W, H, true);
    if (!r3On) {
      drawFrontFog(c, W, H);
      if (vignetteCache) c.drawImage(vignetteCache, 0, 0, W, H);
    }
  }

  // ===========================================================================
  // 루프
  // ===========================================================================
  function frame(ts) {
    var dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    if (!(dt >= 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    bgTime += dt;
    if (G.running) {
      G.update(dt);
    } else {
      // 타이틀 뒤: 천천히 도시를 훑는 카메라
      var maxCam = Math.max(0, WORLD_W - G.width);
      G.camera.x = (0.5 - 0.5 * Math.cos(bgTime * 0.035)) * maxCam;
      G.camera.y = 0;
      updateParticles(dt);
    }
    try {
      G.render();
    } catch (err) {
      if (window.console && console.error) console.error(err);
    }
    window.requestAnimationFrame(frame);
  }

  function startLoop() {
    if (loopStarted) return;
    if (typeof window.requestAnimationFrame !== 'function') return;
    loopStarted = true;
    lastTs = 0;
    window.requestAnimationFrame(frame);
  }

  // 봇 모듈(bots.js)용 내부 훅 — 다른 모듈은 쓰지 말 것
  G._botHooks = {
    addBotPlayer: addBotPlayer,
    removePlayer: removeOther,
    setPlayerSlot: setPlayerSlot,
    resetPlayer: resetPlayer,
    koBurst: koBurst,
    respawnBurst: respawnBurst,
    creditKill: creditKill,
    netSend: netSend,
    isOnline: isOnline,
    isHost: isHost,
    myId: myId,
    slotSpawnX: function (slot) { return SLOT_SPAWN_X[((slot | 0) % 8 + 8) % 8]; },
    respawnTime: RESPAWN_TIME,
    koCreditTime: KO_CREDIT_TIME,
    boostArmor: BOOST_ARMOR,
    jumpVy: JUMP_VY
  };

  // 초기 화면: 시작 전에도 배경을 그림
  resize();
  startLoop();
})();
