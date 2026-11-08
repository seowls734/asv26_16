/* 초능력자: 각성 — 능력 키트 2: 바람 / 바위 / 모래 / 신체강화 (각 4기술, 신규 12종) */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};
  var S = G.Skills;
  if (!S || typeof S.register !== 'function') {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[skills_kit2] Game.Skills 가 없어 키트 2 를 등록하지 않습니다.');
    }
    return;
  }

  var TAU = Math.PI * 2;

  // =====================================================================
  // 공통 유틸 (자체 포함)
  // =====================================================================
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function dirOf(f) { return f < 0 ? -1 : 1; }
  function easeOut(k) { k = clamp(k, 0, 1); return 1 - (1 - k) * (1 - k); }
  function smooth(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
  function pw(p) { return (p && p.w) || 34; }
  function ph(p) { return (p && p.h) || 62; }
  function gy() {
    if (typeof S.groundY === 'function') { return S.groundY(); }
    return (G.world && G.world.groundY) || 600;
  }
  function rel(y) { return typeof S.rel === 'function' ? S.rel(y) : y - gy(); }
  function abs(ry) { return typeof S.abs === 'function' ? S.abs(ry) : gy() + (+ry || 0); }
  function worldW() { return (G.world && G.world.width) || 4200; }
  function localP() { return (G.players && G.players.local) || null; }
  function isAlive(e) { return !!e && e.alive !== false; }
  function mutList() { return ((G.Mutants && G.Mutants.list) || []).filter(function (q) { return !(q && q.under); }); }
  function isAuth() {
    if (typeof S.isAuthority === 'function') { return !!S.isAuthority(); }
    return !!((G.Net && G.Net.isHost) || G.mode === 'practice');
  }
  function rectsHit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function boxOf(e) { return { x: e.x, y: e.y, w: e.w || 34, h: e.h || 62 }; }
  function circRect(cx, cy, r, e) {
    var nx = clamp(cx, e.x, e.x + (e.w || 34)), ny = clamp(cy, e.y, e.y + (e.h || 62));
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }
  function anyMutantIn(rect) {
    var L = mutList();
    for (var i = 0; i < L.length; i++) { if (isAlive(L[i]) && rectsHit(rect, L[i])) { return true; } }
    return false;
  }
  function handOf(ctx) {
    var d = dirOf(ctx.facing), w = pw(ctx.p), h = ph(ctx.p);
    return { x: ctx.x + w / 2 + d * (w / 2 + 6), y: ctx.y + h * 0.42, d: d };
  }
  function burst(x, y, n, colors, speed) {
    if (typeof S.burst === 'function') { S.burst(x, y, n, colors, speed); }
    else if (typeof G.spawnParticles === 'function') {
      G.spawnParticles(x, y, n, colors && colors.join ? colors[0] : colors, speed);
    }
  }
  function shake(a) { if (typeof G.shake === 'function') { G.shake(a); } }
  function casterP(fx) { return typeof S.caster === 'function' ? S.caster(fx) : (fx.owner === 'local' ? localP() : null); }
  function mk(id, ctx, o) {
    o.skill = id; o.owner = ctx.owner; o.castId = ctx.castId;
    if (ctx.casterId != null) { o.casterId = ctx.casterId; }
    o.t = 0;
    var r = S.addFx(o);
    return r || o;
  }
  // 원격 fx 가 나를 맞혔을 때 내 쪽 시각효과
  function meBurst(colors, n) {
    var lp = localP();
    if (lp) { burst(lp.x + pw(lp) / 2, lp.y + ph(lp) / 2, n || 10, colors, 240); }
  }
  // 내 효과가 다른 플레이어들에 닿을 때 시각 효과 (플레이어별 interval 초마다 한 번)
  function remoteFx(fx, rect, colors, n, interval) {
    if (fx.owner !== 'local') { return; }
    var list = typeof S.remoteTouchAll === 'function' ? S.remoteTouchAll(rect) :
      (typeof S.remoteTouchRect === 'function' && S.remoteTouchRect(rect) ? [S.remoteTouchRect(rect)] : []);
    if (!list || !list.length) { return; }
    var nx = fx._rtNext || (fx._rtNext = {});
    for (var i = 0; i < list.length; i++) {
      var rp = list[i];
      if (!rp || typeof rp !== 'object') { continue; }
      var key = rp.id != null ? String(rp.id) : ('_' + i);
      if (nx[key] && fx.t < nx[key]) { continue; }
      nx[key] = interval ? fx.t + interval : 1e9;
      burst(rp.x + pw(rp) / 2, rp.y + ph(rp) / 2, n || 10, colors, 220);
    }
  }
  // 로컬 시전자를 경로 위치로 직접 이동 (자기 자신만 움직임)
  function driveLocal(fx, x, y) {
    if (fx.owner !== 'local') { return null; }
    var p = localP();
    if (!isAlive(p)) { return null; }
    p.x = clamp(x, 0, worldW() - pw(p));
    p.y = y;
    p.vx = 0; p.vy = 0;
    p.onGround = false;
    p.frozen = Math.max(+p.frozen || 0, 0.05);
    return p;
  }

  // ---------- 스프라이트 캐시 (방사형 광원) ----------
  var SPR = {};
  function sprite(key, inner, mid) {
    if (SPR.hasOwnProperty(key)) { return SPR[key]; }
    SPR[key] = null;
    if (typeof document === 'undefined' || !document.createElement) { return null; }
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var x = c.getContext && c.getContext('2d');
    if (!x || !x.createRadialGradient) { return null; }
    var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, inner);
    g.addColorStop(0.4, mid);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    SPR[key] = c;
    return c;
  }
  function glow(ctx, key, inner, mid, x, y, r, a) {
    if (r <= 0.5 || a <= 0.01) { return; }
    var s = sprite(key, inner, mid);
    ctx.globalAlpha = clamp(a, 0, 1);
    if (s) { ctx.drawImage(s, x - r, y - r, r * 2, r * 2); }
    else { ctx.fillStyle = mid; ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, TAU); ctx.fill(); }
  }
  var GW = ['kw', 'rgba(235,255,250,0.95)', 'rgba(140,225,210,0.4)'];   // 바람
  var GR = ['kr', 'rgba(255,225,170,0.9)', 'rgba(190,130,70,0.35)'];     // 바위
  var GS = ['ks', 'rgba(255,236,190,0.9)', 'rgba(224,170,90,0.4)'];      // 모래
  var GB = ['kb', 'rgba(255,215,190,1)', 'rgba(255,70,45,0.5)'];         // 신체
  function glw(ctx, G4, x, y, r, a) { glow(ctx, G4[0], G4[1], G4[2], x, y, r, a); }
  function ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    if (ctx.ellipse) { ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); }
    else { ctx.rect(x - rx, y - ry, rx * 2, ry * 2); }
  }
  // 바위 다각형 (반지름 비율 배열)
  function rockPoly(ctx, x, y, r, shape, rot) {
    ctx.beginPath();
    for (var i = 0; i < shape.length; i++) {
      var a = rot + (i / shape.length) * TAU, rr = r * shape[i];
      if (i === 0) { ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      else { ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    }
    ctx.closePath();
  }
  function rockShape(n) { var s = []; for (var i = 0; i < n; i++) { s.push(rnd(0.78, 1.05)); } return s; }

  var C_WIND = ['#e6fbf6', '#9fe3d6', '#ffffff'];
  var C_ROCK = ['#8a7f70', '#b5a892', '#5e564b'];
  var C_SAND = ['#f0d9a6', '#e0b46a', '#c9a060'];
  var C_BODY = ['#ff5a40', '#ff9a6a', '#ffd0b0'];

  // =====================================================================
  // 바람 J — 바람 칼날 (관통 초승달 칼날)
  // =====================================================================
  var WS = { speed: 980, life: 0.48, w: 34, h: 70, dmgP: 7, dmgM: 12, kx: 260, ky: -140 };
  function wsRect(fx) { return { x: fx.x - WS.w / 2, y: fx.y - WS.h / 2, w: WS.w, h: WS.h }; }
  function wsUpdate(fx, dt) {
    fx.x += fx.dir * WS.speed * dt;
    fx.y = abs(fx.ry);
    var r = wsRect(fx), d = fx.dir;
    S.hitMutantsRect(fx, r, WS.dmgM, d * WS.kx, WS.ky);
    if (S.hitPlayerRect(fx, r, WS.dmgP, d * WS.kx, WS.ky)) { meBurst(C_WIND, 10); }
    remoteFx(fx, r, C_WIND, 8, 0);
    if (fx.x < -60 || fx.x > worldW() + 60) { fx.dead = true; }
  }
  function wsRender(fx, ctx) {
    var d = fx.dir;
    var a = clamp(fx.t / 0.05, 0, 1) * clamp((fx.life - fx.t) / 0.12, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 잔상 줄
    ctx.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      ctx.globalAlpha = a * (0.45 - i * 0.12);
      ctx.strokeStyle = 'rgba(170,240,225,1)';
      ctx.lineWidth = 2;
      var yy = fx.y + (i - 1) * 16;
      ctx.beginPath(); ctx.moveTo(fx.x - d * 8, yy); ctx.lineTo(fx.x - d * (60 + i * 20), yy); ctx.stroke();
    }
    glw(ctx, GW, fx.x, fx.y, 34, a * 0.55);
    ctx.translate(fx.x, fx.y);
    ctx.scale(d, 1);
    // 초승달
    ctx.globalAlpha = a * 0.9;
    var g = ctx.createLinearGradient(-14, 0, 14, 0);
    g.addColorStop(0, 'rgba(120,220,200,0.2)');
    g.addColorStop(1, 'rgba(240,255,252,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-6, -WS.h / 2);
    ctx.quadraticCurveTo(26, 0, -6, WS.h / 2);
    ctx.quadraticCurveTo(8, 0, -6, -WS.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-6, -WS.h / 2); ctx.quadraticCurveTo(26, 0, -6, WS.h / 2); ctx.stroke();
    ctx.restore();
  }
  S.register({
    id: 'wind_slash', element: 'wind', elementName: '바람', name: '바람 칼날', icon: '🍃', rarity: 'easy',
    cost: 10, cooldown: 0.45, color: '#9fe3d6',
    desc: '적을 꿰뚫고 날아가는 초승달 모양 바람 칼날을 날립니다.',
    cast: function (ctx) {
      var h = handOf(ctx);
      mk('wind_slash', ctx, { x: h.x + h.d * 6, y: h.y, ry: rel(h.y), dir: h.d, life: WS.life, projectile: true,
        update: wsUpdate, render: wsRender });
      burst(h.x, h.y, 4, C_WIND, 140);
    }
  });

  // =====================================================================
  // 바람 K — 상승 기류 (공중에서도 사용 가능한 이단 도약 + 활공, 발밑 돌풍)
  // =====================================================================
  var UD = { rise: 0.3, H: 190, life: 1.9, glideVy: 150, r: 85, dmgP: 4, dmgM: 8, kx: 180, ky: -620 };
  function udKnock(e, dx) { return { kx: (dx < 0 ? -1 : 1) * UD.kx, ky: UD.ky }; }
  function udUpdate(fx, dt) {
    var feet = abs(fx.feetRel);
    if (!fx.gust) {
      fx.gust = true;
      S.hitMutantsCircle(fx, fx.x, feet - 20, UD.r, UD.dmgM, udKnock);
      if (S.hitPlayerCircle(fx, fx.x, feet - 20, UD.r, UD.dmgP, udKnock)) { meBurst(C_WIND, 8); }
      remoteFx(fx, { x: fx.x - UD.r, y: feet - 20 - UD.r, w: UD.r * 2, h: UD.r * 2 }, C_WIND, 8, 0);
      burst(fx.x, feet - 4, 10, C_WIND, 260);
    }
    var c = casterP(fx);
    if (c) { fx.cx = c.x + pw(c) / 2; fx.cy = c.y + ph(c); }
    if (fx.owner !== 'local') { return; }
    var p = localP();
    if (!isAlive(p)) { fx.dead = true; return; }
    if (fx.t < UD.rise) {
      p.y = Math.max(-380, abs(fx.pry0) - UD.H * easeOut(fx.t / UD.rise));
      p.vy = 0; p.onGround = false;
    } else if (!fx.released) {
      fx.released = true;
      p.vy = -140;
    } else if (!fx.landed) {
      if (p.onGround) { fx.landed = true; fx.life = Math.min(fx.life, fx.t + 0.25); }
      else if (p.vy > UD.glideVy) { p.vy = UD.glideVy; }
    }
  }
  function udRender(fx, ctx) {
    var feet = abs(fx.feetRel), i;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 발사 지점 돌풍 고리
    if (fx.t < 0.4) {
      var k = fx.t / 0.4;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = 'rgba(200,250,240,1)';
      ctx.lineWidth = 3 * (1 - k) + 1;
      ellipse(ctx, fx.x, feet - 4, 20 + UD.r * easeOut(k), 6 + 10 * k); ctx.stroke();
      ellipse(ctx, fx.x, feet - 30 - 50 * k, 12 + 40 * k, 4 + 6 * k); ctx.stroke();
    }
    // 시전자 주위 나선 기류
    if (typeof fx.cx === 'number') {
      var a = clamp((fx.life - fx.t) / 0.3, 0, 1);
      var up = fx.t < UD.rise + 0.1 ? 1 : 0.55;
      for (var s = 0; s < 3; s++) {
        ctx.strokeStyle = s % 2 ? 'rgba(255,255,255,1)' : 'rgba(150,235,215,1)';
        ctx.lineWidth = 2;
        ctx.globalAlpha = a * 0.55 * up;
        ctx.beginPath();
        for (i = 0; i <= 18; i++) {
          var q = i / 18;
          var ang = fx.t * 18 + s * (TAU / 3) + q * 6;
          var rr = 12 + 16 * q;
          var px = fx.cx + Math.cos(ang) * rr, py = fx.cy + 10 - q * 70 + Math.sin(ang) * 4;
          if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
        }
        ctx.stroke();
      }
      glw(ctx, GW, fx.cx, fx.cy, 30, a * 0.35);
      // 깃털
      ctx.fillStyle = 'rgba(230,255,248,1)';
      for (i = 0; i < 4; i++) {
        var ph2 = (fx.t * 1.3 + i * 0.25) % 1;
        ctx.globalAlpha = a * (1 - ph2) * 0.8;
        var fxp = fx.cx + Math.sin(fx.t * 5 + i * 2) * 22, fyp = fx.cy + 20 + ph2 * 40;
        ctx.save(); ctx.translate(fxp, fyp); ctx.rotate(Math.sin(fx.t * 4 + i) * 0.8);
        ellipse(ctx, 0, 0, 6, 2); ctx.fill(); ctx.restore();
      }
    }
    ctx.restore();
  }
  S.register({
    id: 'wind_updraft', element: 'wind', elementName: '바람', name: '상승 기류', icon: '🪶', rarity: 'easy',
    cost: 20, cooldown: 3, color: '#9fe3d6',
    desc: '발밑에 돌풍을 일으켜 높이 솟구친 뒤 천천히 활공합니다. 공중에서도 쓸 수 있습니다.',
    cast: function (ctx) {
      var feet = ctx.y + ph(ctx.p);
      mk('wind_updraft', ctx, { x: ctx.x + pw(ctx.p) / 2, y: feet - 30, feetRel: rel(feet), pry0: rel(ctx.y),
        life: UD.life, update: udUpdate, render: udRender });
    }
  });

  // =====================================================================
  // 바람 I — 대폭풍 (앞으로 쓸고 가는 거대한 바람 벽, 휩쓸린 적을 계속 베고 밀어냄)
  // =====================================================================
  var GL = { speed: 640, life: 1.05, w: 170, h: 250, dmgP: 7, dmgM: 12, rehit: 0.25, push: 640 };
  function glFront(fx) { return fx.x0 + fx.dir * GL.speed * Math.min(fx.t, GL.life); }
  function glRect(fx) {
    var xf = glFront(fx), feet = abs(fx.feetRel);
    var back = fx.dir > 0 ? Math.max(fx.x0, xf - GL.w) : Math.min(fx.x0, xf + GL.w);
    var x1 = Math.min(back, xf), x2 = Math.max(back, xf);
    return { x: x1, y: feet - GL.h, w: Math.max(4, x2 - x1), h: GL.h + 8 };
  }
  function glUpdate(fx, dt) {
    var r = glRect(fx), d = fx.dir;
    fx.x = r.x + r.w / 2; fx.y = r.y + r.h / 2;
    S.hitMutantsRect(fx, r, GL.dmgM, d * 380, -160);
    if (S.hitPlayerRect(fx, r, GL.dmgP, d * 80, -120)) { meBurst(C_WIND, 8); }
    // 휩쓸림: 원격 시전자의 폭풍 안에 있는 나만 밀려남
    var lp = localP();
    if (fx.owner === 'remote' && isAlive(lp) && rectsHit(r, boxOf(lp))) {
      lp.vx += (d * GL.push - lp.vx) * Math.min(1, 10 * dt);
      if (lp.onGround) { lp.vy = Math.min(+lp.vy || 0, -200); lp.onGround = false; }
    }
    remoteFx(fx, r, C_WIND, 6, GL.rehit);
    if (fx.t < GL.life - 0.15 && Math.random() < 0.5) {
      burst(glFront(fx), abs(fx.feetRel) - 4, 1, ['#9a9283', '#cfd8d4'], 180);
    }
  }
  function glRender(fx, ctx) {
    var r = glRect(fx), d = fx.dir, xf = glFront(fx), feet = abs(fx.feetRel);
    var a = clamp(fx.t / 0.12, 0, 1) * clamp((fx.life - fx.t) / 0.25, 0, 1);
    if (a <= 0) { return; }
    var i, q;
    ctx.save();
    // 반투명 바람 벽
    var g = ctx.createLinearGradient(xf - d * GL.w, 0, xf, 0);
    g.addColorStop(0, 'rgba(160,220,210,0)');
    g.addColorStop(0.7, 'rgba(190,240,230,0.16)');
    g.addColorStop(1, 'rgba(235,255,250,0.32)');
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(xf - d * GL.w, feet);
    ctx.lineTo(xf - d * GL.w, feet - GL.h);
    ctx.quadraticCurveTo(xf + d * 30, feet - GL.h * 0.55, xf, feet);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    // 흐르는 바람 줄
    ctx.lineCap = 'round';
    for (i = 0; i < fx.lines.length; i++) {
      q = fx.lines[i];
      var u = ((q.u + fx.t * q.sp) % 1);
      var lx = xf - d * GL.w * (1 - u) - d * 20, ly = feet - GL.h * q.v + Math.sin(fx.t * 9 + q.ph) * 6;
      ctx.globalAlpha = a * q.al * Math.sin(u * Math.PI);
      ctx.strokeStyle = i % 3 ? 'rgba(170,240,225,1)' : 'rgba(255,255,255,1)';
      ctx.lineWidth = q.wd;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.quadraticCurveTo(lx - d * q.len * 0.5, ly - 6, lx - d * q.len, ly + 2);
      ctx.stroke();
    }
    // 소용돌이 고리
    for (i = 0; i < 3; i++) {
      var sy = feet - GL.h * (0.25 + i * 0.27);
      var sx = xf - d * (40 + i * 22);
      var ang = fx.t * 14 * d + i * 2;
      ctx.globalAlpha = a * 0.55;
      ctx.strokeStyle = 'rgba(220,255,248,1)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(sx, sy, 22 - i * 3, ang, ang + 4.2); ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, 11 - i, ang + 1, ang + 4.6); ctx.stroke();
    }
    glw(ctx, GW, xf - d * 30, feet - GL.h * 0.5, 90, a * 0.35);
    // 잔해/잎
    ctx.globalCompositeOperation = 'source-over';
    for (i = 0; i < fx.debris.length; i++) {
      q = fx.debris[i];
      var u2 = ((q.u + fx.t * 1.4) % 1);
      var dx = xf - d * GL.w * (1 - u2), dy = feet - GL.h * q.v + Math.sin(fx.t * 7 + q.ph) * 14;
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = q.leaf ? '#6fae4a' : '#7a7064';
      ctx.save(); ctx.translate(dx, dy); ctx.rotate(fx.t * 12 + q.ph);
      if (q.leaf) { ellipse(ctx, 0, 0, 5, 2.2); ctx.fill(); } else { ctx.fillRect(-2, -2, 4, 4); }
      ctx.restore();
    }
    ctx.restore();
  }
  S.register({
    id: 'wind_gale', element: 'wind', elementName: '바람', name: '대폭풍', icon: '🌬️', rarity: 'easy',
    cost: 70, cooldown: 11, color: '#9fe3d6',
    desc: '거대한 바람 벽을 앞으로 몰아쳐, 휩쓸린 적을 밀어내며 연속으로 베어냅니다.',
    cast: function (ctx) {
      var d = dirOf(ctx.facing), feet = ctx.y + ph(ctx.p), cx = ctx.x + pw(ctx.p) / 2;
      var lines = [], debris = [], i;
      for (i = 0; i < 22; i++) {
        lines.push({ u: Math.random(), v: rnd(0.05, 0.95), sp: rnd(1.6, 2.8), len: rnd(30, 70), wd: rnd(1, 2.6),
          al: rnd(0.35, 0.8), ph: rnd(0, TAU) });
      }
      for (i = 0; i < 10; i++) { debris.push({ u: Math.random(), v: rnd(0.05, 0.9), ph: rnd(0, TAU), leaf: i % 2 === 0 }); }
      mk('wind_gale', ctx, { x: cx, y: feet - GL.h / 2, x0: cx + d * 20, feetRel: rel(feet), dir: d,
        life: GL.life, rehit: GL.rehit, lines: lines, debris: debris, update: glUpdate, render: glRender });
      shake(ctx.owner === 'local' ? 6 : 3);
    }
  });

  // =====================================================================
  // 바위 J — 돌팔매 (포물선 돌멩이)
  // =====================================================================
  var PB = { vx: 700, vy: -330, g: 1300, r: 9, life: 1.6, dmgP: 10, dmgM: 16, kx: 240, ky: -220 };
  function pbShatter(fx) {
    burst(fx.x, fx.y, 8, C_ROCK, 220);
    fx.dead = true;
  }
  function pbUpdate(fx, dt) {
    var prevBottom = abs(fx.ry) + PB.r;
    fx.vy += PB.g * dt;
    fx.x += fx.vx * dt;
    fx.ry += fx.vy * dt;
    fx.y = abs(fx.ry);
    fx.rot += fx.dir * 14 * dt;
    var r = PB.r, rect = { x: fx.x - r, y: fx.y - r, w: r * 2, h: r * 2 }, d = fx.dir;
    if (anyMutantIn(rect)) {
      S.hitMutantsRect(fx, rect, PB.dmgM, d * PB.kx, PB.ky);
      pbShatter(fx); return;
    }
    if (fx.owner === 'remote' && S.hitPlayerRect(fx, rect, PB.dmgP, d * PB.kx, PB.ky)) { pbShatter(fx); return; }
    if (typeof S.remoteTouchRect === 'function' && S.remoteTouchRect(rect, fx)) { pbShatter(fx); return; }
    // 지면/발판 충돌
    var bottom = fx.y + r;
    if (bottom >= gy()) { fx.y = gy() - r; pbShatter(fx); return; }
    if (fx.vy > 0) {
      var pl = (G.world && G.world.platforms) || [];
      for (var i = 0; i < pl.length; i++) {
        var q = pl[i];
        if (q && fx.x > q.x && fx.x < q.x + q.w && prevBottom <= q.y + 1 && bottom >= q.y) { pbShatter(fx); return; }
      }
    }
    if (fx.x < -60 || fx.x > worldW() + 60) { fx.dead = true; return; }
    fx.trT -= dt;
    if (fx.trT <= 0) { fx.trT = 0.05; fx.trail.push({ x: fx.x, y: fx.y, t: 0 }); if (fx.trail.length > 8) { fx.trail.shift(); } }
    for (var k = 0; k < fx.trail.length; k++) { fx.trail[k].t += dt; }
  }
  function pbRender(fx, ctx) {
    ctx.save();
    // 흙먼지 꼬리
    for (var k = 0; k < fx.trail.length; k++) {
      var q = fx.trail[k];
      ctx.globalAlpha = clamp(0.35 - q.t, 0, 0.35);
      ctx.fillStyle = '#9b8a72';
      ctx.beginPath(); ctx.arc(q.x, q.y, 4 + q.t * 18, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    var g = ctx.createLinearGradient(fx.x - 8, fx.y - 8, fx.x + 8, fx.y + 8);
    g.addColorStop(0, '#c9bba3'); g.addColorStop(1, '#5e564b');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#2f2a24'; ctx.lineWidth = 1.5;
    rockPoly(ctx, fx.x, fx.y, PB.r + 1, fx.shape, fx.rot);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(40,34,28,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(fx.x + Math.cos(fx.rot) * 6, fx.y + Math.sin(fx.rot) * 6); ctx.lineTo(fx.x, fx.y);
    ctx.lineTo(fx.x + Math.cos(fx.rot + 2) * 5, fx.y + Math.sin(fx.rot + 2) * 5); ctx.stroke();
    ctx.restore();
  }
  S.register({
    id: 'rock_pebble', element: 'rock', elementName: '바위', name: '돌팔매', icon: '🥌', rarity: 'easy',
    cost: 10, cooldown: 0.5, color: '#b08a5a',
    desc: '단단한 돌멩이를 포물선으로 던집니다. 느리지만 묵직합니다.',
    cast: function (ctx) {
      var h = handOf(ctx);
      mk('rock_pebble', ctx, { x: h.x, y: h.y - 4, ry: rel(h.y - 4), vx: h.d * PB.vx, vy: PB.vy, dir: h.d,
        life: PB.life, projectile: true, rot: 0, shape: rockShape(7), trail: [], trT: 0,
        update: pbUpdate, render: pbRender });
    }
  });

  // =====================================================================
  // 바위 K — 바위 성벽 (앞에 벽을 세워 투사체를 막고 다른 플레이어의 통행을 막음)
  // =====================================================================
  var RW = { off: 74, w: 38, h: 140, rise: 0.14, life: 4, dmgP: 6, dmgM: 12, kx: 480, ky: -360 };
  function rwRise(fx) { return easeOut(fx.t / RW.rise) * clamp((fx.life - fx.t) / 0.3, 0, 1); }
  function rwRect(fx, full) {
    var surf = abs(fx.ry), hh = RW.h * (full ? 1 : rwRise(fx));
    return { x: fx.x - RW.w / 2, y: surf - hh, w: RW.w, h: Math.max(2, hh) };
  }
  function rwUpdate(fx) {
    var surf = abs(fx.ry), d = fx.dir;
    fx.y = surf - RW.h / 2;
    var r = rwRect(fx, false);
    if (!fx.popped) { fx.popped = true; burst(fx.x, surf - 4, 10, C_ROCK, 260); shake(fx.owner === 'local' ? 4 : 2); }
    if (fx.t < RW.rise + 0.06) {
      S.hitMutantsRect(fx, r, RW.dmgM, d * RW.kx, RW.ky);
      if (S.hitPlayerRect(fx, r, RW.dmgP, d * RW.kx, RW.ky)) { meBurst(C_ROCK, 8); }
      remoteFx(fx, r, C_ROCK, 8, 0);
    }
    if (fx.t < RW.rise || fx.t > fx.life - 0.25) { return; }
    // 투사체 차단 (다른 시전자의 projectile fx)
    var list = S.fx || [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f || f === fx || f.dead || !f.projectile) { continue; }
      var cid = typeof S.attackerOf === 'function' ? S.attackerOf(f) : f.casterId;
      if (cid != null && cid === fx.casterId) { continue; }
      var fr = +f.r || 10;
      if (rectsHit(r, { x: f.x - fr, y: f.y - fr, w: fr * 2, h: fr * 2 })) {
        f.dead = true;
        burst(f.x, f.y, 6, C_ROCK, 200);
        fx.blocked = (fx.blocked || 0) + 1; fx.flash = 0.15;
      }
    }
    // 원격 벽: 나를 밀어냄 (자기 자신만 이동)
    var lp = localP();
    if (fx.owner === 'remote' && isAlive(lp) && rectsHit(r, boxOf(lp))) {
      if (lp.x + pw(lp) / 2 < fx.x) { lp.x = r.x - pw(lp); if (lp.vx > 0) { lp.vx = 0; } }
      else { lp.x = r.x + r.w; if (lp.vx < 0) { lp.vx = 0; } }
    }
    // 돌연변이 밀어냄 (권한측)
    if (isAuth()) {
      var ms = mutList();
      for (var k = 0; k < ms.length; k++) {
        var m = ms[k];
        if (!isAlive(m) || !rectsHit(r, m)) { continue; }
        if (m.x + (m.w || 40) / 2 < fx.x) { m.x = r.x - (m.w || 40); if (m.vx > 0) { m.vx = 0; } }
        else { m.x = r.x + r.w; if (m.vx < 0) { m.vx = 0; } }
      }
    }
  }
  function rwRender(fx, ctx) {
    var surf = abs(fx.ry), rise = rwRise(fx), i;
    if (rise <= 0.01) { return; }
    var hw = RW.w / 2, H = RW.h;
    ctx.save();
    // 흙 둔덕
    ctx.fillStyle = 'rgba(80,62,44,0.9)';
    ctx.beginPath();
    ctx.moveTo(fx.x - hw - 16, surf);
    ctx.quadraticCurveTo(fx.x, surf - 14 * rise, fx.x + hw + 16, surf);
    ctx.closePath(); ctx.fill();
    ctx.translate(fx.x, surf);
    ctx.scale(1, rise);
    var g = ctx.createLinearGradient(-hw, 0, hw, 0);
    g.addColorStop(0, '#a89a83'); g.addColorStop(0.45, '#8a7d6a'); g.addColorStop(1, '#4f473d');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#2b2620'; ctx.lineWidth = 2;
    var pts = fx.pts;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (i = 2; i < pts.length; i += 2) { ctx.lineTo(pts[i], pts[i + 1]); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 블록 줄눈
    ctx.strokeStyle = 'rgba(40,34,28,0.75)'; ctx.lineWidth = 1.3;
    for (i = 0; i < fx.seams.length; i++) {
      var s = fx.seams[i];
      ctx.beginPath(); ctx.moveTo(-hw + 2, -H * s.y); ctx.lineTo(s.x, -H * s.y - s.dy); ctx.lineTo(hw - 2, -H * s.y + s.dy); ctx.stroke();
    }
    // 이끼
    ctx.fillStyle = 'rgba(79,174,140,0.75)';
    for (i = 0; i < fx.moss.length; i++) {
      var mo = fx.moss[i];
      ellipse(ctx, mo.x, -H * mo.y, mo.r, mo.r * 0.6); ctx.fill();
    }
    // 밝은 모서리
    ctx.strokeStyle = 'rgba(235,222,200,0.45)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pts[0] + 3, pts[1]); ctx.lineTo(pts[2] + 3, pts[3] + 3); ctx.lineTo(pts[4], pts[5] + 3); ctx.stroke();
    ctx.restore();
    if (fx.flash > 0) {
      fx.flash -= 1 / 60;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glw(ctx, GR, fx.x - fx.dir * 4, surf - H * 0.5, 50, fx.flash * 5);
      ctx.restore();
    }
  }
  S.register({
    id: 'rock_wall', element: 'rock', elementName: '바위', name: '바위 성벽', icon: '🧱', rarity: 'easy',
    cost: 25, cooldown: 6, color: '#b08a5a',
    desc: '눈앞에 바위 벽을 세워 적을 튕겨내고, 4초간 투사체와 다른 플레이어의 길을 막습니다.',
    prepare: function (ctx) {
      var d = dirOf(ctx.facing), p = ctx.p;
      var cx = clamp(p.x + pw(p) / 2 + d * RW.off, RW.w, worldW() - RW.w);
      var surf = typeof S.surfaceBelow === 'function' ? S.surfaceBelow(cx, p.y + ph(p)) : gy();
      return { x: Math.round(cx), ry: Math.round(rel(surf)) };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), dt = ctx.data || {};
      var cx = num(dt.x, ctx.x + pw(ctx.p) / 2 + d * RW.off);
      var ry = num(dt.ry, rel(ctx.y + ph(ctx.p)));
      var hw = RW.w / 2, H = RW.h;
      var pts = [-hw, 0, -hw - rnd(0, 3), -H * 0.45, -hw + rnd(1, 4), -H * 0.85, -hw * 0.3, -H - rnd(0, 6),
        hw * 0.5, -H + rnd(0, 8), hw + rnd(0, 3), -H * 0.6, hw, 0];
      var seams = [], moss = [], i;
      for (i = 0; i < 3; i++) { seams.push({ y: 0.25 + i * 0.25 + rnd(-0.04, 0.04), x: rnd(-6, 6), dy: rnd(-3, 3) }); }
      for (i = 0; i < 4; i++) { moss.push({ x: rnd(-hw + 4, hw - 4), y: rnd(0.05, 0.95), r: rnd(3, 6) }); }
      mk('rock_wall', ctx, { x: cx, y: abs(ry) - H / 2, ry: ry, dir: d, life: RW.life, pts: pts, seams: seams, moss: moss,
        flash: 0, update: rwUpdate, render: rwRender });
    }
  });

  // =====================================================================
  // 바위 I — 대지진 (지면을 따라 양쪽으로 퍼지는 진동파 + 하늘에서 떨어지는 바위)
  // =====================================================================
  var QK = { speed: 900, reach: 560, fw: 70, h: 74, dmgP: 12, dmgM: 22, stun: 0.5, ky: -480, life: 1.5,
    bN: 4, bDelay: 0.3, bStep: 0.14, bFall: 0.5, bTop: 640, bR: 28, bDmgP: 9, bDmgM: 18, bLife: 1.6 };
  function qkDist(fx) { return Math.min(QK.reach, QK.speed * fx.t); }
  function qkUpdate(fx) {
    var g = gy(), dist = qkDist(fx);
    fx.y = g - QK.h / 2;
    if (dist >= QK.reach) { return; }
    for (var s = -1; s <= 1; s += 2) {
      var fxp = fx.x + s * dist;
      var r = { x: fxp - QK.fw / 2, y: g - QK.h, w: QK.fw, h: QK.h };
      S.hitMutantsRect(fx, r, QK.dmgM, s * 160, QK.ky);
      if (S.hitPlayerRect(fx, r, QK.dmgP, s * 160, QK.ky)) {
        S.statusPlayerRect(fx, r, 'stun', QK.stun);
        meBurst(C_ROCK, 10);
      }
      if (fx.owner === 'local' && anyMutantIn(r)) { S.statusMutantsRect(fx, r, 'stun', QK.stun); }
      remoteFx(fx, r, C_ROCK, 8, 0);
    }
    fx.dustT -= 1 / 60;
    if (fx.dustT <= 0) { fx.dustT = 0.05; burst(fx.x + dist, g - 4, 1, C_ROCK, 200); burst(fx.x - dist, g - 4, 1, C_ROCK, 200); }
  }
  function qkRender(fx, ctx) {
    var g = gy(), dist = qkDist(fx), i, k;
    var a = clamp((fx.life - fx.t) / 0.4, 0, 1);
    ctx.save();
    // 균열선
    ctx.strokeStyle = 'rgba(40,30,20,' + (0.85 * a).toFixed(3) + ')';
    ctx.lineWidth = 2.5;
    for (var s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.moveTo(fx.x, g - 1);
      for (k = 0; k < fx.cr.length; k++) {
        var cx = fx.x + s * fx.cr[k].x;
        if (fx.cr[k].x > dist) { break; }
        ctx.lineTo(cx, g - 1 - fx.cr[k].y);
      }
      ctx.stroke();
    }
    // 진동파 앞머리: 솟아오른 지면 조각
    if (dist < QK.reach) {
      for (s = -1; s <= 1; s += 2) {
        var fxp = fx.x + s * dist;
        ctx.globalAlpha = 1;
        for (i = 0; i < 4; i++) {
          var ox = fxp - s * i * 16, hh = (26 - i * 6) * (0.8 + 0.2 * Math.sin(fx.t * 40 + i));
          ctx.fillStyle = i % 2 ? '#6b6153' : '#8a7d6a';
          ctx.strokeStyle = '#2f2a24'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ox - 10, g); ctx.lineTo(ox - 6 + s * 2, g - hh); ctx.lineTo(ox + 4 + s * 3, g - hh * 0.8); ctx.lineTo(ox + 10, g);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        glw(ctx, GR, fxp, g - 10, 46, 0.45);
        ctx.restore();
        // 흙먼지 구름
        ctx.fillStyle = 'rgba(150,130,105,0.35)';
        for (i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(fxp - s * (12 + i * 18), g - 14 - i * 6, 14 + i * 5, 0, TAU); ctx.fill(); }
      }
    }
    // 시전 지점 충격 고리
    if (fx.t < 0.35) {
      var q = fx.t / 0.35;
      ctx.globalAlpha = 1 - q;
      ctx.strokeStyle = 'rgba(200,170,120,1)'; ctx.lineWidth = 6 * (1 - q) + 1;
      ellipse(ctx, fx.x, g, 30 + 140 * q, 8 + 14 * q); ctx.stroke();
    }
    ctx.restore();
  }
  function bdY(fx) {   // 바위 중심 y
    var g = gy(), at = fx.t - fx.delay;
    if (at <= 0) { return g - QK.bTop; }
    var k = clamp(at / QK.bFall, 0, 1);
    return g - QK.bTop + (QK.bTop - QK.bR) * k * k;
  }
  function bdUpdate(fx) {
    var g = gy(), at = fx.t - fx.delay;
    fx.y = bdY(fx);
    if (at < 0) { return; }
    if (at < QK.bFall) {
      var r = { x: fx.x - QK.bR, y: fx.y - QK.bR, w: QK.bR * 2, h: QK.bR * 2 };
      S.hitMutantsRect(fx, r, QK.bDmgM, 0, -300);
      if (S.hitPlayerRect(fx, r, QK.bDmgP, fx.dir * 120, -300)) { meBurst(C_ROCK, 10); }
      remoteFx(fx, r, C_ROCK, 8, 0);
    } else if (!fx.landed) {
      fx.landed = true;
      burst(fx.x, g - 6, 12, C_ROCK, 300);
      shake(fx.owner === 'local' ? 5 : 3);
      var r2 = { x: fx.x - QK.bR - 14, y: g - 30, w: QK.bR * 2 + 28, h: 30 };
      S.hitMutantsRect(fx, r2, QK.bDmgM, 0, -300);
      if (S.hitPlayerRect(fx, r2, QK.bDmgP, fx.dir * 120, -300)) { meBurst(C_ROCK, 10); }
    }
  }
  function bdRender(fx, ctx) {
    var g = gy(), at = fx.t - fx.delay, y = bdY(fx);
    var k = clamp(at / QK.bFall, 0, 1);
    ctx.save();
    // 그림자 예고
    if (at < QK.bFall) {
      ctx.globalAlpha = 0.25 + 0.4 * Math.max(0, k);
      ctx.fillStyle = 'rgba(20,14,10,1)';
      ellipse(ctx, fx.x, g - 1, QK.bR * (0.5 + 0.6 * Math.max(0, k)), 5); ctx.fill();
    }
    if (at < 0) { ctx.restore(); return; }
    var fade = clamp((fx.life - fx.t) / 0.3, 0, 1);
    // 낙하 꼬리
    if (at < QK.bFall) {
      ctx.globalCompositeOperation = 'lighter';
      var tg = ctx.createLinearGradient(0, y - 90, 0, y);
      tg.addColorStop(0, 'rgba(255,170,80,0)'); tg.addColorStop(1, 'rgba(255,190,110,0.5)');
      ctx.globalAlpha = 1; ctx.fillStyle = tg;
      ctx.fillRect(fx.x - QK.bR * 0.6, y - 90, QK.bR * 1.2, 90);
      glw(ctx, GR, fx.x, y, QK.bR * 1.8, 0.35);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = fade;
    var gr = ctx.createLinearGradient(fx.x - QK.bR, y - QK.bR, fx.x + QK.bR, y + QK.bR);
    gr.addColorStop(0, '#b9ab93'); gr.addColorStop(0.5, '#857867'); gr.addColorStop(1, '#4a4239');
    ctx.fillStyle = gr; ctx.strokeStyle = '#2a251f'; ctx.lineWidth = 2;
    var rot = at < QK.bFall ? at * 6 * fx.dir : QK.bFall * 6 * fx.dir;
    rockPoly(ctx, fx.x, y, QK.bR, fx.shape, rot);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(40,34,28,0.7)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(fx.x - 8, y - 10); ctx.lineTo(fx.x + 2, y); ctx.lineTo(fx.x - 3, y + 12); ctx.stroke();
    ctx.fillStyle = 'rgba(79,174,140,0.7)';
    ellipse(ctx, fx.x + 6, y - QK.bR * 0.6, 7, 3.5); ctx.fill();
    ctx.restore();
  }
  S.register({
    id: 'rock_quake', element: 'rock', elementName: '바위', name: '대지진', icon: '🌋', rarity: 'easy',
    cost: 70, cooldown: 11, color: '#b08a5a',
    desc: '땅을 내리쳐 양옆으로 진동파를 보내 지상의 적을 기절시키고, 앞쪽에 바위를 떨어뜨립니다.',
    prepare: function (ctx) {
      var d = dirOf(ctx.facing), cx = ctx.p.x + pw(ctx.p) / 2, bx = [];
      for (var i = 0; i < QK.bN; i++) {
        bx.push(Math.round(clamp(cx + d * (110 + i * 115 + rnd(-30, 30)), 40, worldW() - 40)));
      }
      ctx.p.frozen = Math.max(ctx.p.frozen || 0, 0.2);
      ctx.p.vx = 0;
      return { bx: bx };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), cx = ctx.x + pw(ctx.p) / 2, i, cr = [], x = 0;
      while (x < QK.reach + 20) { x += rnd(14, 30); cr.push({ x: x, y: rnd(0, 4) }); }
      mk('rock_quake', ctx, { x: cx, y: gy() - QK.h / 2, dir: d, life: QK.life, cr: cr, dustT: 0,
        update: qkUpdate, render: qkRender });
      var raw = ctx.data && ctx.data.bx, bx = [];
      if (Object.prototype.toString.call(raw) === '[object Array]') {
        for (i = 0; i < raw.length && bx.length < QK.bN; i++) { if (typeof raw[i] === 'number' && isFinite(raw[i])) { bx.push(raw[i]); } }
      }
      if (!bx.length) { for (i = 0; i < QK.bN; i++) { bx.push(cx + d * (110 + i * 115)); } }
      for (i = 0; i < bx.length; i++) {
        var dl = QK.bDelay + i * QK.bStep;
        mk('rock_quake', ctx, { x: bx[i], y: gy() - QK.bTop, dir: d, delay: dl, life: dl + QK.bLife,
          shape: rockShape(8), update: bdUpdate, render: bdRender });
      }
      burst(cx, gy() - 6, 14, C_ROCK, 320);
      shake(ctx.owner === 'local' ? 12 : 5);
    }
  });

  // =====================================================================
  // 모래 J — 모래 산탄 (짧은 원뿔 범위, 둔화)
  // =====================================================================
  var SB = { w: 190, h: 74, t0: 0.03, t1: 0.16, life: 0.5, dmgP: 7, dmgM: 12, slow: 1.0, kx: 180, ky: -90 };
  function sbRect(fx) {
    return { x: fx.dir > 0 ? fx.x : fx.x - SB.w, y: fx.y - SB.h / 2, w: SB.w, h: SB.h };
  }
  function sbUpdate(fx, dt) {
    fx.y = abs(fx.ry);
    for (var i = 0; i < fx.grains.length; i++) {
      var q = fx.grains[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 2.5 * dt; q.vy += 200 * dt;
    }
    if (fx.t < SB.t0 || fx.t > SB.t1) { return; }
    var r = sbRect(fx), d = fx.dir;
    S.hitMutantsRect(fx, r, SB.dmgM, d * SB.kx, SB.ky);
    if (fx.owner === 'local' && anyMutantIn(r)) { S.statusMutantsRect(fx, r, 'slow', SB.slow + 0.5); }
    if (S.hitPlayerRect(fx, r, SB.dmgP, d * SB.kx, SB.ky)) {
      S.statusPlayerRect(fx, r, 'slow', SB.slow);
      meBurst(C_SAND, 8);
    }
    remoteFx(fx, r, C_SAND, 8, 0);
  }
  function sbRender(fx, ctx) {
    var a = clamp((fx.life - fx.t) / 0.3, 0, 1), d = fx.dir, i;
    ctx.save();
    // 원뿔 흐림
    if (fx.t < 0.25) {
      var k = fx.t / 0.25;
      ctx.globalAlpha = (1 - k) * 0.4;
      var g = ctx.createLinearGradient(fx.x, 0, fx.x + d * SB.w, 0);
      g.addColorStop(0, 'rgba(240,215,160,1)'); g.addColorStop(1, 'rgba(210,170,100,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(fx.x, fx.y - 6);
      ctx.lineTo(fx.x + d * SB.w * (0.4 + 0.6 * easeOut(k * 2)), fx.y - SB.h / 2);
      ctx.lineTo(fx.x + d * SB.w * (0.4 + 0.6 * easeOut(k * 2)), fx.y + SB.h / 2);
      ctx.lineTo(fx.x, fx.y + 6);
      ctx.closePath(); ctx.fill();
    }
    // 알갱이
    for (i = 0; i < fx.grains.length; i++) {
      var q = fx.grains[i];
      ctx.globalAlpha = a * q.al;
      ctx.fillStyle = q.c;
      ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s * 1.6, q.s);
    }
    ctx.globalCompositeOperation = 'lighter';
    glw(ctx, GS, fx.x, fx.y, 24, (1 - clamp(fx.t / 0.2, 0, 1)) * 0.7);
    ctx.restore();
  }
  S.register({
    id: 'sand_blast', element: 'sand', elementName: '모래', name: '모래 산탄', icon: '🫧', rarity: 'easy',
    cost: 12, cooldown: 0.7, color: '#e0b46a',
    desc: '가까운 앞쪽에 모래를 흩뿌려 맞은 적을 1초간 느리게 만듭니다.',
    cast: function (ctx) {
      var h = handOf(ctx), grains = [];
      var cols = ['#f0d9a6', '#e0b46a', '#c9a060', '#fff0c8'];
      for (var i = 0; i < 30; i++) {
        var sp = rnd(300, 900), an = rnd(-0.32, 0.32);
        grains.push({ x: h.x, y: h.y, vx: h.d * sp * Math.cos(an), vy: sp * Math.sin(an), s: rnd(1.5, 3.5),
          al: rnd(0.5, 1), c: cols[i % 4] });
      }
      mk('sand_blast', ctx, { x: h.x, y: h.y, ry: rel(h.y), dir: h.d, life: SB.life, grains: grains,
        update: sbUpdate, render: sbRender });
    }
  });

  // =====================================================================
  // 모래 K — 사구 잠행 (모래 속으로 파고들어 질주, 무적, 끝에서 모래 분출)
  // =====================================================================
  var SD = { dist: 280, dur: 0.32, inv: 0.45, life: 0.8, ew: 110, eh: 96, dmgP: 7, dmgM: 14, ky: -650, slow: 1.2 };
  function sdPos(fx) { return fx.x0 + (fx.x1 - fx.x0) * smooth(fx.t / SD.dur); }
  function sdUpdate(fx) {
    var px = sdPos(fx), py = abs(fx.ry);
    fx.x = px + fx.pw / 2; fx.y = py + fx.ph / 2;
    if (fx.t < SD.dur) {
      driveLocal(fx, px, py);
      if (Math.random() < 0.6) { burst(fx.x, py + fx.ph - 4, 1, C_SAND, 200); }
      return;
    }
    if (!fx.out) {
      fx.out = true;
      var p = driveLocal(fx, fx.x1, py);
      if (p) { p.vx = fx.dir * 200; p.vy = -260; p.frozen = 0; }
      var feet = py + fx.ph, ex = fx.x1 + fx.pw / 2;
      var r = { x: ex - SD.ew / 2, y: feet - SD.eh, w: SD.ew, h: SD.eh };
      S.hitMutantsRect(fx, r, SD.dmgM, 0, SD.ky);
      if (fx.owner === 'local' && anyMutantIn(r)) { S.statusMutantsRect(fx, r, 'slow', SD.slow); }
      if (S.hitPlayerRect(fx, r, SD.dmgP, fx.dir * 60, SD.ky)) { S.statusPlayerRect(fx, r, 'slow', SD.slow); meBurst(C_SAND, 10); }
      remoteFx(fx, r, C_SAND, 10, 0);
      burst(ex, feet - 10, 16, C_SAND, 340);
      shake(fx.owner === 'local' ? 4 : 2);
    }
  }
  function sdRender(fx, ctx) {
    var py = abs(fx.ry), feet = py + fx.ph, i;
    ctx.save();
    // 지나간 모래 고랑
    var xa = fx.x0 + fx.pw / 2, xb = sdPos(fx) + fx.pw / 2;
    var ta = clamp((fx.life - fx.t) / 0.4, 0, 1);
    ctx.globalAlpha = 0.7 * ta;
    ctx.fillStyle = '#b8955a';
    ctx.beginPath();
    ctx.moveTo(xa, feet);
    ctx.quadraticCurveTo((xa + xb) / 2, feet - 8, xb, feet);
    ctx.closePath(); ctx.fill();
    if (fx.t < SD.dur) {
      // 이동하는 모래 둔덕
      var mx = xb;
      ctx.globalAlpha = 1;
      var g = ctx.createLinearGradient(0, feet - 50, 0, feet);
      g.addColorStop(0, '#f2dcaa'); g.addColorStop(1, '#b8955a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(mx - 44, feet);
      ctx.quadraticCurveTo(mx - 20, feet - 50, mx + fx.dir * 6, feet - 46);
      ctx.quadraticCurveTo(mx + fx.dir * 30, feet - 30, mx + 44, feet);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,200,0.6)'; ctx.lineWidth = 1.5;
      for (i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(mx - 30 + i * 8, feet - 6 - i * 10); ctx.quadraticCurveTo(mx, feet - 14 - i * 12, mx + 26 - i * 8, feet - 6 - i * 10); ctx.stroke();
      }
      // 앞쪽 모래 물보라
      ctx.fillStyle = '#f0d9a6';
      for (i = 0; i < 10; i++) {
        var u = (fx.t * 7 + i * 0.1) % 1;
        ctx.globalAlpha = (1 - u) * 0.85;
        ctx.fillRect(mx + fx.dir * (20 + u * 30) + Math.sin(i * 3) * 6, feet - 10 - u * 40 * (0.5 + (i % 3) * 0.3), 3, 2);
      }
    } else {
      // 분출 기둥
      var k = clamp((fx.t - SD.dur) / (fx.life - SD.dur), 0, 1);
      var ex = fx.x1 + fx.pw / 2, H = SD.eh * 1.2 * (0.6 + 0.4 * easeOut(k * 3));
      ctx.globalAlpha = (1 - k) * 0.85;
      var cg = ctx.createLinearGradient(0, feet - H, 0, feet);
      cg.addColorStop(0, 'rgba(240,215,160,0)'); cg.addColorStop(0.4, 'rgba(230,195,130,0.8)'); cg.addColorStop(1, 'rgba(190,150,90,0.95)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(ex - SD.ew / 2, feet);
      ctx.quadraticCurveTo(ex - 20, feet - H * 0.6, ex - 30 - 20 * k, feet - H);
      ctx.lineTo(ex + 30 + 20 * k, feet - H);
      ctx.quadraticCurveTo(ex + 20, feet - H * 0.6, ex + SD.ew / 2, feet);
      ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      glw(ctx, GS, ex, feet - 20, 60, (1 - k) * 0.5);
    }
    ctx.restore();
  }
  S.register({
    id: 'sand_dash', element: 'sand', elementName: '모래', name: '사구 잠행', icon: '🐍', rarity: 'easy',
    cost: 25, cooldown: 3, color: '#e0b46a',
    desc: '모래 속으로 파고들어 무적 상태로 질주한 뒤, 튀어나오며 모래를 분출합니다.',
    prepare: function (ctx) {
      var p = ctx.p, d = dirOf(ctx.facing);
      var x1 = clamp(p.x + d * SD.dist, 0, worldW() - pw(p));
      p.invulnTimer = Math.max(p.invulnTimer || 0, SD.inv);
      p.frozen = Math.max(p.frozen || 0, SD.dur);
      p.vx = 0;
      if (typeof S.lockCast === 'function') { S.lockCast(SD.dur); }
      return { x0: Math.round(p.x), x1: Math.round(x1), ry: Math.round(rel(p.y)) };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), dt = ctx.data || {};
      var x0 = num(dt.x0, ctx.x), x1 = num(dt.x1, clamp(x0 + d * SD.dist, 0, worldW() - pw(ctx.p)));
      var ry = num(dt.ry, rel(ctx.y));
      mk('sand_dash', ctx, { x: x0 + pw(ctx.p) / 2, y: abs(ry), x0: x0, x1: x1, ry: ry, dir: d, pw: pw(ctx.p), ph: ph(ctx.p),
        life: SD.life, update: sdUpdate, render: sdRender });
      burst(x0 + pw(ctx.p) / 2, abs(ry) + ph(ctx.p) - 6, 12, C_SAND, 260);
    }
  });

  // =====================================================================
  // 모래 I — 개미지옥 (거대한 유사 구덩이: 끌어당기고 깎아낸 뒤 모래 간헐천 분출)
  // =====================================================================
  var SP = { off: 250, w: 400, h: 110, life: 3.0, start: 0.25, burstAt: 2.55, dmgP: 3, dmgM: 7, rehit: 0.45,
    pull: 1500, slow: 0.5, gW: 150, gH: 290, gDmgP: 13, gDmgM: 30, gKy: -980, gLife: 0.45 };
  function spRect(fx) { var g = gy(); return { x: fx.x - SP.w / 2, y: g - SP.h, w: SP.w, h: SP.h }; }
  function spUpdate(fx, dt) {
    var g = gy(), r = spRect(fx);
    fx.y = g - SP.h / 2;
    if (fx.t < SP.start || fx.t > SP.burstAt) { return; }
    S.hitMutantsRect(fx, r, SP.dmgM, 0, 0);
    if (S.hitPlayerRect(fx, r, SP.dmgP, 0, 0)) { meBurst(C_SAND, 5); }
    S.pullMutants(fx, fx.x, g - 20, SP.w / 2, SP.pull, dt);
    var lp = localP();
    if (fx.owner === 'remote' && isAlive(lp) && rectsHit(r, boxOf(lp))) {
      S.pullPlayer(fx, fx.x, g - ph(lp) / 2, SP.w / 2 + 20, SP.pull, dt);
      if (lp.vy < -200) { lp.vy = -200; }   // 구덩이에서 쉽게 못 빠져나옴
      fx.inside = true;
    } else { fx.inside = false; }
    fx.stT -= dt;
    if (fx.stT <= 0) {
      fx.stT = 0.15;
      S.statusPlayerRect(fx, r, 'slow', SP.slow);
      S.statusMutantsRect(fx, r, 'slow', SP.slow);
    }
    remoteFx(fx, r, C_SAND, 5, SP.rehit);
  }
  function spRender(fx, ctx) {
    var g = gy(), i;
    var a = clamp(fx.t / 0.3, 0, 1) * clamp((fx.life - fx.t) / 0.35, 0, 1);
    if (a <= 0) { return; }
    var R = SP.w / 2;
    ctx.save();
    ctx.translate(fx.x, g);
    // 구덩이 (납작 원근)
    ctx.scale(1, 0.18);
    var pg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    pg.addColorStop(0, 'rgba(60,40,20,' + (0.95 * a).toFixed(3) + ')');
    pg.addColorStop(0.35, 'rgba(150,110,60,' + (0.9 * a).toFixed(3) + ')');
    pg.addColorStop(0.8, 'rgba(214,176,110,' + (0.85 * a).toFixed(3) + ')');
    pg.addColorStop(1, 'rgba(224,186,120,0)');
    ctx.fillStyle = pg;
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    // 회전 나선 무늬
    ctx.strokeStyle = 'rgba(250,228,180,0.55)';
    ctx.lineWidth = 6;
    for (var s = 0; s < 4; s++) {
      ctx.beginPath();
      for (i = 0; i <= 24; i++) {
        var q = i / 24, ang = -fx.t * 3 + s * (TAU / 4) + q * 4.5, rr = R * (1 - q) * 0.95;
        var px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
        if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
      }
      ctx.globalAlpha = a * 0.8;
      ctx.stroke();
    }
    ctx.restore();
    // 흘러내리는 모래 알갱이
    ctx.save();
    ctx.fillStyle = '#f3dcae';
    for (i = 0; i < 36; i++) {
      var u = ((i * 0.618 + fx.t * 0.5) % 1);
      var an = i * 2.4 - fx.t * 3;
      var rr2 = R * (1 - u);
      ctx.globalAlpha = a * (0.4 + 0.5 * u);
      ctx.fillRect(fx.x + Math.cos(an) * rr2, g + Math.sin(an) * rr2 * 0.18 - 1, 2.5, 2);
    }
    // 가장자리 모래 언덕 테두리
    ctx.globalAlpha = a * 0.9;
    ctx.strokeStyle = 'rgba(200,160,95,1)'; ctx.lineWidth = 3;
    ellipse(ctx, fx.x, g, R, R * 0.18); ctx.stroke();
    // 분출 직전 경고 맥동
    if (fx.t > SP.burstAt - 0.45 && fx.t < SP.burstAt) {
      var w = (fx.t - (SP.burstAt - 0.45)) / 0.45;
      ctx.globalCompositeOperation = 'lighter';
      glw(ctx, GS, fx.x, g - 10, SP.gW * (0.6 + 0.4 * w), 0.25 + 0.35 * Math.abs(Math.sin(fx.t * 30)));
    }
    ctx.restore();
    // 피해자 쪽 화면 모래빛 (내가 안에 있을 때)
    if (fx.inside) {
      var cam = G.camera || { x: 0, y: 0 }, W = G.width || 1280, H = G.height || 720;
      ctx.save(); ctx.globalAlpha = 0.18 * a; ctx.fillStyle = 'rgb(196,152,84)';
      ctx.fillRect(cam.x - 80, cam.y - 80, W + 160, H + 160); ctx.restore();
    }
  }
  function gzUpdate(fx) {
    var g = gy();
    fx.y = g - SP.gH / 2;
    if (fx.t < fx.delay) { return; }
    if (!fx.boom) {
      fx.boom = true;
      burst(fx.x, g - 20, 22, C_SAND, 460);
      shake(fx.owner === 'local' ? 9 : 4);
    }
    if (fx.t > fx.delay + 0.25) { return; }
    var r = { x: fx.x - SP.gW / 2, y: g - SP.gH, w: SP.gW, h: SP.gH };
    S.hitMutantsRect(fx, r, SP.gDmgM, 0, SP.gKy);
    if (S.hitPlayerRect(fx, r, SP.gDmgP, 0, SP.gKy)) { meBurst(C_SAND, 12); }
    remoteFx(fx, r, C_SAND, 12, 0);
  }
  function gzRender(fx, ctx) {
    if (fx.t < fx.delay) { return; }
    var g = gy(), k = clamp((fx.t - fx.delay) / SP.gLife, 0, 1), i;
    var H = SP.gH * easeOut(Math.min(1, k * 3)), hw = SP.gW / 2;
    ctx.save();
    ctx.globalAlpha = 1 - k * k;
    var cg = ctx.createLinearGradient(0, g - H, 0, g);
    cg.addColorStop(0, 'rgba(245,225,175,0.2)'); cg.addColorStop(0.3, 'rgba(235,200,135,0.85)'); cg.addColorStop(1, 'rgba(180,135,75,0.95)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(fx.x - hw, g);
    ctx.quadraticCurveTo(fx.x - hw * 0.3, g - H * 0.5, fx.x - hw * (0.5 + k), g - H);
    ctx.quadraticCurveTo(fx.x, g - H - 30, fx.x + hw * (0.5 + k), g - H);
    ctx.quadraticCurveTo(fx.x + hw * 0.3, g - H * 0.5, fx.x + hw, g);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f6e3b6';
    for (i = 0; i < 14; i++) {
      var an = -Math.PI / 2 + (i - 6.5) * 0.15, sp = H * (0.8 + (i % 4) * 0.12);
      ctx.fillRect(fx.x + Math.cos(an) * sp * 0.5 * k * 2, g - H + Math.sin(an) * 20 * k + 30 * k * k + sp * 0.1 * k, 3, 3);
    }
    ctx.globalCompositeOperation = 'lighter';
    glw(ctx, GS, fx.x, g - H * 0.5, hw * 1.8, (1 - k) * 0.4);
    ctx.restore();
  }
  S.register({
    id: 'sand_pit', element: 'sand', elementName: '모래', name: '개미지옥', icon: '🕳️', rarity: 'easy',
    cost: 70, cooldown: 12, color: '#e0b46a',
    desc: '앞쪽에 거대한 유사 구덩이를 만들어 적을 끌어들이고 깎아낸 뒤, 모래 간헐천으로 날려버립니다.',
    prepare: function (ctx) {
      var d = dirOf(ctx.facing);
      return { x: Math.round(clamp(ctx.p.x + pw(ctx.p) / 2 + d * SP.off, SP.w / 2, worldW() - SP.w / 2)) };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing);
      var cx = num(ctx.data && ctx.data.x, clamp(ctx.x + pw(ctx.p) / 2 + d * SP.off, SP.w / 2, worldW() - SP.w / 2));
      mk('sand_pit', ctx, { x: cx, y: gy() - SP.h / 2, dir: d, life: SP.life, rehit: SP.rehit, stT: 0, inside: false,
        update: spUpdate, render: spRender });
      mk('sand_pit', ctx, { x: cx, y: gy() - SP.gH / 2, dir: d, delay: SP.burstAt, life: SP.burstAt + SP.gLife,
        update: gzUpdate, render: gzRender });
      burst(cx, gy() - 6, 14, C_SAND, 300);
    }
  });

  // =====================================================================
  // 신체강화 J — 연속 주먹 (2연타, 시전자를 따라감)
  // =====================================================================
  var JB = { reach: 60, h: 44, win: 0.08, life: 0.3,
    hits: [{ d: 0.04, dmgP: 4, dmgM: 7, kx: 120, ky: -60 }, { d: 0.32, dmgP: 6, dmgM: 11, kx: 460, ky: -260 }] };
  function jbBase(fx) {
    var c = casterP(fx);
    if (c && isAlive(c)) { fx.bx = c.x + pw(c) / 2; fx.by = c.y + ph(c) * 0.42; }
    return { x: fx.bx, y: fx.by };
  }
  function jbRect(fx) {
    var b = jbBase(fx), d = fx.dir;
    return { x: d > 0 ? b.x : b.x - JB.reach - 14, y: b.y - JB.h / 2, w: JB.reach + 14, h: JB.h };
  }
  function jbUpdate(fx) {
    var r = jbRect(fx);
    fx.x = r.x + r.w / 2; fx.y = r.y + r.h / 2;
    var at = fx.t - fx.delay;
    if (at < 0 || at > JB.win) { return; }
    var H = JB.hits[fx.idx], d = fx.dir;
    S.hitMutantsRect(fx, r, H.dmgM, d * H.kx, H.ky);
    if (S.hitPlayerRect(fx, r, H.dmgP, d * H.kx, H.ky)) { meBurst(C_BODY, 8); }
    remoteFx(fx, r, C_BODY, 8, 0);
    if (fx.idx === 1 && !fx.sh) { fx.sh = true; if (fx.owner === 'local') { shake(2); } }
  }
  function jbRender(fx, ctx) {
    var at = fx.t - fx.delay;
    if (at < 0) { return; }
    var b = { x: fx.bx, y: fx.by }, d = fx.dir;
    if (typeof b.x !== 'number') { return; }
    var k = clamp(at / (fx.life - fx.delay), 0, 1), big = fx.idx === 1;
    var reach = JB.reach * (big ? 1.1 : 0.85);
    var fxp = b.x + d * (14 + reach * easeOut(Math.min(1, at / 0.06))), fy = b.y + (fx.idx === 0 ? -4 : 2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 주먹 궤적
    ctx.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      ctx.globalAlpha = (1 - k) * (0.6 - i * 0.15);
      ctx.strokeStyle = i ? 'rgba(255,120,80,1)' : 'rgba(255,220,200,1)';
      ctx.lineWidth = (big ? 6 : 4) - i;
      ctx.beginPath(); ctx.moveTo(b.x + d * 8, fy + (i - 1) * 7); ctx.lineTo(fxp - d * 6, fy + (i - 1) * 5); ctx.stroke();
    }
    glw(ctx, GB, fxp, fy, (big ? 30 : 20) * (1 + k * 0.6), (1 - k) * 0.9);
    // 충격 별
    ctx.globalAlpha = (1 - k);
    ctx.strokeStyle = 'rgba(255,240,220,1)'; ctx.lineWidth = big ? 2.5 : 1.8;
    var n = big ? 8 : 6, r0 = 6 + 10 * k, r1 = (big ? 20 : 13) + 16 * k;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var an = (i / n) * TAU + fx.idx * 0.4;
      ctx.moveTo(fxp + Math.cos(an) * r0, fy + Math.sin(an) * r0);
      ctx.lineTo(fxp + Math.cos(an) * r1, fy + Math.sin(an) * r1);
    }
    ctx.stroke();
    if (big) {
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = 'rgba(255,90,60,1)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(fxp, fy, 10 + 30 * k, -1.2, 1.2); ctx.stroke();
    }
    ctx.restore();
  }
  S.register({
    id: 'body_jab', element: 'body', elementName: '신체강화', name: '연속 주먹', icon: '👊', rarity: 'easy',
    cost: 10, cooldown: 0.45, color: '#ff5a4a',
    desc: '눈앞의 적에게 빠른 2연타를 꽂습니다. 두 번째 주먹은 적을 날려버립니다.',
    cast: function (ctx) {
      var d = dirOf(ctx.facing);
      for (var i = 0; i < JB.hits.length; i++) {
        var dl = JB.hits[i].d;
        mk('body_jab', ctx, { x: ctx.x + pw(ctx.p) / 2, y: ctx.y + ph(ctx.p) * 0.42, bx: ctx.x + pw(ctx.p) / 2,
          by: ctx.y + ph(ctx.p) * 0.42, dir: d, idx: i, delay: dl, life: dl + JB.life,
          update: jbUpdate, render: jbRender });
      }
    }
  });

  // =====================================================================
  // 신체강화 L — 돌진 태클 (어깨로 들이받아 기절 + 크게 날림)
  // =====================================================================
  var TK = { dist: 300, dur: 0.26, life: 0.6, dmgP: 12, dmgM: 22, kx: 720, ky: -380, stun: 0.35 };
  function tkPos(fx) { return fx.x0 + (fx.x1 - fx.x0) * easeOut(fx.t / TK.dur); }
  function tkUpdate(fx) {
    var px = tkPos(fx), py = abs(fx.ry), d = fx.dir;
    fx.x = px + fx.pw / 2; fx.y = py + fx.ph / 2;
    if (fx.t < TK.dur) {
      driveLocal(fx, px, py);
      var r = { x: d > 0 ? px : px - 26, y: py + 4, w: fx.pw + 26, h: fx.ph - 8 };
      S.hitMutantsRect(fx, r, TK.dmgM, d * TK.kx, TK.ky);
      if (fx.owner === 'local' && anyMutantIn(r)) { S.statusMutantsRect(fx, r, 'stun', TK.stun); }
      if (S.hitPlayerRect(fx, r, TK.dmgP, d * TK.kx, TK.ky)) { S.statusPlayerRect(fx, r, 'stun', TK.stun); meBurst(C_BODY, 12); shake(5); }
      remoteFx(fx, r, C_BODY, 12, 0);
      if (Math.random() < 0.5) { burst(fx.x - d * 14, py + fx.ph - 4, 1, ['#b5a892', '#8a7f70'], 140); }
    } else if (!fx.done) {
      fx.done = true;
      var p = driveLocal(fx, fx.x1, py);
      if (p) { p.vx = d * 240; p.frozen = 0; }
    }
  }
  function tkRender(fx, ctx) {
    var d = fx.dir, py = abs(fx.ry), px = tkPos(fx), cx = px + fx.pw / 2, cy = py + fx.ph * 0.45, i;
    var a = fx.t < TK.dur ? 1 : clamp(1 - (fx.t - TK.dur) / (fx.life - TK.dur), 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 속도선
    ctx.lineCap = 'round';
    for (i = 0; i < 7; i++) {
      var yy = py + 6 + i * (fx.ph - 12) / 6, ln = 40 + ((i * 37) % 50);
      ctx.globalAlpha = a * 0.5;
      ctx.strokeStyle = i % 2 ? 'rgba(255,140,100,1)' : 'rgba(255,220,200,1)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - d * 18, yy); ctx.lineTo(cx - d * (18 + ln * (0.6 + a)), yy); ctx.stroke();
    }
    // 잔상
    for (i = 1; i <= 3; i++) {
      var ax = fx.x0 + (fx.x1 - fx.x0) * easeOut(Math.max(0, fx.t - i * 0.04) / TK.dur);
      ctx.globalAlpha = a * 0.22 / i;
      ctx.fillStyle = 'rgba(255,80,55,1)';
      ellipse(ctx, ax + fx.pw / 2, cy, fx.pw * 0.55, fx.ph * 0.5); ctx.fill();
    }
    // 어깨 충격 쐐기
    ctx.globalAlpha = a * 0.85;
    var sx = cx + d * (fx.pw / 2 + 6);
    var g = ctx.createLinearGradient(sx - d * 20, 0, sx + d * 14, 0);
    g.addColorStop(0, 'rgba(255,60,40,0)'); g.addColorStop(1, 'rgba(255,200,170,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - d * 22, cy - 30); ctx.quadraticCurveTo(sx + d * 18, cy, sx - d * 22, cy + 30);
    ctx.closePath(); ctx.fill();
    glw(ctx, GB, sx, cy, 34, a * 0.6);
    ctx.restore();
  }
  S.register({
    id: 'body_tackle', element: 'body', elementName: '신체강화', name: '돌진 태클', icon: '🐂', rarity: 'easy',
    cost: 30, cooldown: 4, color: '#ff5a4a',
    desc: '앞으로 맹렬히 돌진해 부딪힌 적을 잠시 기절시키고 멀리 날려버립니다.',
    prepare: function (ctx) {
      var p = ctx.p, d = dirOf(ctx.facing);
      var x1 = clamp(p.x + d * TK.dist, 0, worldW() - pw(p));
      p.frozen = Math.max(p.frozen || 0, TK.dur);
      p.vx = 0;
      if (typeof S.lockCast === 'function') { S.lockCast(TK.dur); }
      return { x0: Math.round(p.x), x1: Math.round(x1), ry: Math.round(rel(p.y)) };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), dt = ctx.data || {};
      var x0 = num(dt.x0, ctx.x), x1 = num(dt.x1, clamp(x0 + d * TK.dist, 0, worldW() - pw(ctx.p)));
      var ry = num(dt.ry, rel(ctx.y));
      mk('body_tackle', ctx, { x: x0 + pw(ctx.p) / 2, y: abs(ry), x0: x0, x1: x1, ry: ry, dir: d, pw: pw(ctx.p), ph: ph(ctx.p),
        life: TK.life, update: tkUpdate, render: tkRender });
      burst(x0 + pw(ctx.p) / 2, abs(ry) + ph(ctx.p) - 4, 8, ['#b5a892', '#8a7f70'], 200);
    }
  });

  // =====================================================================
  // 신체강화 I — 천붕격 (높이 도약해 내려찍는 대충격파)
  // =====================================================================
  var ME = { dist: 260, dur: 0.6, H: 230, after: 0.75, r1: 110, r2: 210, dmgIn: 26, dmgOut: 16, dmgM: 40,
    kx: 650, ky: -640, stun: 0.4 };
  function mePos(fx) {
    var k = clamp(fx.t / ME.dur, 0, 1);
    var y0 = abs(fx.ry0), yl = abs(fx.ryl);
    return { x: fx.x0 + (fx.x1 - fx.x0) * k, y: y0 + (yl - y0) * k * k - ME.H * 4 * k * (1 - k) * (1 - 0.35 * k) };
  }
  function meKnock(e, dx) { return { kx: (dx < 0 ? -1 : 1) * ME.kx, ky: ME.ky }; }
  function meUpdate(fx) {
    var p0 = mePos(fx);
    fx.x = p0.x + fx.pw / 2; fx.y = p0.y + fx.ph / 2;
    if (fx.t < ME.dur) {
      driveLocal(fx, p0.x, p0.y);
      fx.trT = (fx.trT || 0) - 1 / 60;
      if (fx.trT <= 0) { fx.trT = 0.04; fx.trail.push({ x: fx.x, y: fx.y }); if (fx.trail.length > 10) { fx.trail.shift(); } }
      return;
    }
    if (fx.landed) { return; }
    fx.landed = true;
    var bx = fx.x1 + fx.pw / 2, by = abs(fx.ryl) + fx.ph;
    fx.bx = bx; fx.by = by;
    var p = driveLocal(fx, fx.x1, abs(fx.ryl));
    if (p) { p.frozen = 0.12; p.vy = 0; }
    var cy = by - 20;
    S.hitMutantsCircle(fx, bx, cy, ME.r2, ME.dmgM, meKnock);
    var lp = localP();
    if (fx.owner === 'remote' && isAlive(lp)) {
      var inner = circRect(bx, cy, ME.r1, lp);
      if (S.hitPlayerCircle(fx, bx, cy, ME.r2, inner ? ME.dmgIn : ME.dmgOut, meKnock)) {
        if (inner) { S.statusPlayerCircle(fx, bx, cy, ME.r1, 'stun', ME.stun); }
        meBurst(C_BODY, 14);
      }
    }
    if (fx.owner === 'local') { S.statusMutantsCircle(fx, bx, cy, ME.r1, 'stun', ME.stun); }
    remoteFx(fx, { x: bx - ME.r2 * 0.75, y: cy - ME.r2 * 0.6, w: ME.r2 * 1.5, h: ME.r2 * 0.9 }, C_BODY, 12, 0);
    burst(bx, by - 6, 24, C_BODY.concat(['#b5a892']), 520);
    if (fx.owner === 'local') { shake(15); }
    else {
      var lp2 = localP(), dist = lp2 ? Math.abs(lp2.x + pw(lp2) / 2 - bx) : 9999;
      shake(dist < ME.r2 * 2.5 ? 12 : 4);
    }
  }
  function meRender(fx, ctx) {
    var i;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (!fx.landed) {
      var k = clamp(fx.t / ME.dur, 0, 1);
      // 착지 지점 경고
      var lx = fx.x1 + fx.pw / 2, ly = abs(fx.ryl) + fx.ph;
      ctx.globalAlpha = 0.3 + 0.5 * k;
      ctx.strokeStyle = 'rgba(255,90,60,1)'; ctx.lineWidth = 2;
      ellipse(ctx, lx, ly, ME.r1 * (1.2 - 0.2 * k), 10); ctx.stroke();
      glw(ctx, GB, lx, ly, 50 * k + 10, 0.3 * k);
      // 궤적
      for (i = 0; i < fx.trail.length; i++) {
        glw(ctx, GB, fx.trail[i].x, fx.trail[i].y, 14 + i * 2, 0.08 + i * 0.03);
      }
      glw(ctx, GB, fx.x, fx.y, 46, 0.55);
      // 하강 시 속도선
      if (k > 0.5) {
        ctx.strokeStyle = 'rgba(255,200,170,1)'; ctx.lineWidth = 2;
        for (i = 0; i < 5; i++) {
          ctx.globalAlpha = (k - 0.5) * 1.4;
          var sx = fx.x + (i - 2) * 9;
          ctx.beginPath(); ctx.moveTo(sx, fx.y - 30); ctx.lineTo(sx, fx.y - 60 - (i % 2) * 20); ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }
    var q = clamp((fx.t - ME.dur) / ME.after, 0, 1), e = easeOut(q);
    var bx = fx.bx, by = fx.by;
    // 충격파 고리 2개
    ctx.globalAlpha = 1 - q;
    ctx.strokeStyle = 'rgba(255,90,60,1)'; ctx.lineWidth = 12 * (1 - q) + 1;
    ellipse(ctx, bx, by - 4, ME.r2 * e, ME.r2 * e * 0.28); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,210,180,1)'; ctx.lineWidth = 5 * (1 - q) + 1;
    ellipse(ctx, bx, by - 4, ME.r1 * easeOut(q * 1.6), ME.r1 * easeOut(q * 1.6) * 0.3); ctx.stroke();
    glw(ctx, GB, bx, by - 20, ME.r1 * (0.6 + e), (1 - q) * 0.8);
    // 솟구치는 충격 기둥
    ctx.globalAlpha = (1 - q) * 0.7;
    var cg = ctx.createLinearGradient(0, by - 160, 0, by);
    cg.addColorStop(0, 'rgba(255,80,50,0)'); cg.addColorStop(1, 'rgba(255,190,150,0.9)');
    ctx.fillStyle = cg;
    ctx.fillRect(bx - 30 * (1 - q) - 6, by - 160 * (1 - q * 0.5), 60 * (1 - q) + 12, 160 * (1 - q * 0.5));
    ctx.globalCompositeOperation = 'source-over';
    // 크레이터 + 파편
    ctx.globalAlpha = clamp((fx.life - fx.t) / 0.3, 0, 1) * 0.8;
    ctx.fillStyle = 'rgba(40,28,20,1)';
    ellipse(ctx, bx, by, 60, 7); ctx.fill();
    ctx.fillStyle = '#7a6d5c'; ctx.strokeStyle = '#2f2a24'; ctx.lineWidth = 1;
    for (i = 0; i < fx.chunks.length; i++) {
      var c = fx.chunks[i], tt = fx.t - ME.dur;
      var cx = bx + c.vx * tt, cyy = by - 6 + c.vy * tt + 900 * tt * tt;
      if (cyy > by) { cyy = by - 2; }
      rockPoly(ctx, cx, cyy, c.r, c.shape, tt * c.spin);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  S.register({
    id: 'body_meteor', element: 'body', elementName: '신체강화', name: '천붕격', icon: '☄️', rarity: 'easy',
    cost: 65, cooldown: 10, color: '#ff5a4a',
    desc: '하늘 높이 도약해 앞쪽 땅을 내려찍어, 주변을 거대한 충격파로 날려버립니다. 중심일수록 강합니다.',
    prepare: function (ctx) {
      var p = ctx.p, d = dirOf(ctx.facing);
      var x1 = clamp(p.x + d * ME.dist, 0, worldW() - pw(p));
      var surf = typeof S.surfaceBelow === 'function' ? S.surfaceBelow(x1 + pw(p) / 2, p.y + ph(p)) : gy();
      p.frozen = Math.max(p.frozen || 0, ME.dur);
      p.vx = 0;
      if (typeof S.lockCast === 'function') { S.lockCast(ME.dur + 0.1); }
      return { x0: Math.round(p.x), x1: Math.round(x1), ry0: Math.round(rel(p.y)), ryl: Math.round(rel(surf) - ph(p)) };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), dt = ctx.data || {}, w = pw(ctx.p), h = ph(ctx.p);
      var x0 = num(dt.x0, ctx.x), x1 = num(dt.x1, clamp(x0 + d * ME.dist, 0, worldW() - w));
      var ry0 = num(dt.ry0, rel(ctx.y)), ryl = num(dt.ryl, rel(gy()) - h);
      var chunks = [];
      for (var i = 0; i < 8; i++) {
        chunks.push({ vx: rnd(-260, 260), vy: rnd(-520, -220), r: rnd(3, 7), shape: rockShape(5), spin: rnd(-12, 12) });
      }
      mk('body_meteor', ctx, { x: x0 + w / 2, y: abs(ry0), x0: x0, x1: x1, ry0: ry0, ryl: ryl, dir: d, pw: w, ph: h,
        life: ME.dur + ME.after, trail: [], chunks: chunks, update: meUpdate, render: meRender });
      burst(x0 + w / 2, abs(ry0) + h - 4, 12, C_BODY, 300);
    }
  });

  // =====================================================================
  // 키트 선언 [J, K, L, I]
  // =====================================================================
  var KITS = [
    ['wind', '바람', '🌪️', ['wind_slash', 'wind_updraft', 'tornado', 'wind_gale'],
      { color: '#9fe3d6', rarity: 'easy', desc: '바람을 다뤄 적을 베고 띄우며, 하늘을 활공하는 기동형 능력.' }],
    ['rock', '바위', '🪨', ['rock_pebble', 'rock_wall', 'rockspike', 'rock_quake'],
      { color: '#b08a5a', rarity: 'easy', desc: '바위를 일으켜 벽을 세우고 땅을 뒤흔드는 묵직한 방어·제압형 능력.' }],
    ['sand', '모래', '🏜️', ['sand_blast', 'sand_dash', 'sandstorm', 'sand_pit'],
      { color: '#e0b46a', rarity: 'easy', desc: '모래로 적을 느리게 하고 모래 속을 누비며 끌어들이는 방해형 능력.' }],
    ['body', '신체강화', '💪', ['body_jab', 'bodyboost', 'body_tackle', 'body_meteor'],
      { color: '#ff5a4a', rarity: 'easy', desc: '단련된 육체로 파고들어 주먹과 돌진, 내려찍기로 싸우는 근접형 능력.' }]
  ];
  var pend = G.pendingKits = G.pendingKits || [];
  for (var ki = 0; ki < KITS.length; ki++) {
    var K = KITS[ki];
    if (typeof S.kit === 'function') {
      try { S.kit(K[0], K[1], K[2], K[3], K[4]); } catch (e) {
        if (typeof console !== 'undefined' && console.error) { console.error('[skills_kit2] kit ' + K[0], e); }
      }
    } else {
      // Skills.kit 이 아직 없으면 대기열에 남김 (LOADOUT 이 읽어 감)
      pend.push({ element: K[0], elementName: K[1], icon: K[2], ids: K[3].slice(), meta: K[4], args: K });
    }
  }
})();
