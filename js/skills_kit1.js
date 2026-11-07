/* 초능력자: 각성 — 능력 키트 1: 물 · 풀 · 전기 · 얼음 (신규 기술 12종 + 키트 선언)  v4
 *
 * 키트 구성 [J 가벼운 견제, K 이동/유틸, L 중위력, I 궁극기]
 *   물   : water_bubble  · watercannon(기존) · water_whirlpool · water_tsunami
 *   풀   : grass_leaf    · vinebind(기존)    · grass_bloom     · grass_thorns
 *   전기 : elec_spark    · elec_blink        · chainbolt(기존) · elec_storm
 *   얼음 : iceshard(기존) · ice_wall          · ice_nova        · ice_blizzard
 *
 * 멀티플레이 규칙 (계약 §3): 각 클라이언트는 자기 자신만 피해 — 영역 효과는 안에 있는 사람이 맞고,
 * 돌연변이 피해는 시전자(owner 'local')만, 상태이상은 S.status* 헬퍼(권한측)로. 원격 시전은 prepare() 데이터로
 * 재현하므로 판정에 영향을 주는 무작위 값(뇌우 낙뢰 위치 등)은 모두 prepare() 에서 정한다.
 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};
  var S = G.Skills;
  if (!S || typeof S.register !== 'function') {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[skills_kit1] Game.Skills 가 없어 키트 1 을 등록하지 않습니다.');
    }
    return;
  }

  var TAU = Math.PI * 2;

  // =====================================================================
  // 공통 유틸 (이 파일 전용)
  // =====================================================================
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function dirOf(f) { return f < 0 ? -1 : 1; }
  function pw(p) { return (p && p.w) || 34; }
  function ph(p) { return (p && p.h) || 62; }
  function gy() {
    if (typeof S.groundY === 'function') { return S.groundY(); }
    return (G.world && G.world.groundY) || 600;
  }
  function relY(y) { return typeof S.rel === 'function' ? S.rel(y) : y - gy(); }
  function absY(r) { return typeof S.abs === 'function' ? S.abs(r) : gy() + (+r || 0); }
  function worldW() { return (G.world && G.world.width) || 4200; }
  function localP() { return (G.players && G.players.local) || null; }
  function othersP() { return typeof S.remotePlayers === 'function' ? S.remotePlayers() : []; }
  function isAlive(e) { return !!e && e.alive !== false; }
  function mutList() { return (G.Mutants && G.Mutants.list) || []; }
  function rectsHit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function circleRect(cx, cy, r, e) {
    var nx = clamp(cx, e.x, e.x + (e.w || 34)), ny = clamp(cy, e.y, e.y + (e.h || 62));
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }
  function boxOf(e) { return { x: e.x, y: e.y, w: e.w || 34, h: e.h || 62 }; }
  function anyMutantIn(rect) {
    var L = mutList();
    for (var i = 0; i < L.length; i++) { if (isAlive(L[i]) && rectsHit(rect, L[i])) { return true; } }
    return false;
  }
  function surf(x, fromY) {
    if (typeof S.surfaceBelow === 'function') { return S.surfaceBelow(x, fromY); }
    return gy();
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
  function burstOn(e, n, colors, speed) {
    if (e) { burst(e.x + pw(e) / 2, e.y + ph(e) / 2, n, colors, speed || 240); }
  }
  function shake(a) { if (typeof G.shake === 'function') { G.shake(a); } }
  // 내 시전이면 강하게, 남의 시전이면 가까울 때만
  function shakeNear(fx, x, amt) {
    if (fx.owner === 'local') { shake(amt); return; }
    var lp = localP();
    if (lp && Math.abs(lp.x + pw(lp) / 2 - x) < 420) { shake(amt * 0.6); }
  }
  function mk(id, ctx, o) {
    o.skill = id; o.owner = ctx.owner; o.castId = ctx.castId;
    if (ctx.casterId != null) { o.casterId = ctx.casterId; }
    o.t = 0;
    var r = S.addFx(o);
    return r || o;
  }
  // 부모 fx 의 시전 정보(owner/castId/casterId)를 물려받는 자식 효과
  function mkFrom(parent, o) {
    return mk(parent.skill, { owner: parent.owner, castId: parent.castId, casterId: parent.casterId }, o);
  }
  function attacker(fx) { return typeof S.attackerOf === 'function' ? S.attackerOf(fx) : fx.casterId; }
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
      burstOn(rp, n || 10, colors, 220);
    }
  }
  function circBox(x, y, r) { return { x: x - r * 0.75, y: y - r * 0.75, w: r * 1.5, h: r * 1.5 }; }

  // ---------- 글로우 (프레임워크 스프라이트 사용, 없으면 원) ----------
  function gl(ctx, x, y, r, color, a) {
    if (!(r > 0.5) || !(a > 0.01)) { return; }
    if (typeof S.glow === 'function') { S.glow(ctx, x, y, r, color, a); return; }
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, TAU); ctx.fill();
  }

  // ---------- fx 내부 파티클 (fx 마다 상한) ----------
  function addPart(fx, o, cap) {
    var L = fx.parts || (fx.parts = []);
    if (L.length < (cap || 40)) { o.max = o.life; L.push(o); }
  }
  function stepParts(fx, dt) {
    var L = fx.parts;
    if (!L) { return; }
    for (var i = L.length - 1; i >= 0; i--) {
      var q = L[i];
      q.life -= dt;
      if (q.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
      if (q.drag) { var dr = Math.max(0, 1 - q.drag * dt); q.vx *= dr; q.vy *= dr; }
      q.vy += (q.g || 0) * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
  }
  // mode: 'glow' (lighter 글로우) | 'dot' (채운 원) | 'shard' (회전하는 삼각 파편)
  function drawParts(ctx, fx, color, mode) {
    var L = fx.parts;
    if (!L || !L.length) { return; }
    if (mode !== 'glow') { ctx.fillStyle = color; }
    for (var i = 0; i < L.length; i++) {
      var q = L[i], a = clamp(q.life / q.max, 0, 1);
      if (mode === 'glow') { gl(ctx, q.x, q.y, q.r * (0.5 + 0.5 * a), q.c || color, a); continue; }
      ctx.globalAlpha = a;
      if (q.c) { ctx.fillStyle = q.c; }
      if (mode === 'shard') {
        var ang = (q.spin || 0) * (q.max - q.life) + (q.a0 || 0), s = q.r;
        ctx.beginPath();
        ctx.moveTo(q.x + Math.cos(ang) * s, q.y + Math.sin(ang) * s);
        ctx.lineTo(q.x + Math.cos(ang + 2.4) * s * 0.5, q.y + Math.sin(ang + 2.4) * s * 0.5);
        ctx.lineTo(q.x + Math.cos(ang + 3.9) * s * 0.5, q.y + Math.sin(ang + 3.9) * s * 0.5);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.fill();
      }
    }
  }

  // ---------- 번개 (지그재그 선) ----------
  function boltPts(x0, y0, x1, y1, n, amp) {
    var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len, pts = [x0, y0];
    for (var k = 1; k < n; k++) {
      var s = k / n, o = rnd(-1, 1) * amp * Math.sin(Math.PI * s);
      pts.push(x0 + dx * s + nx * o, y0 + dy * s + ny * o);
    }
    pts.push(x1, y1);
    return pts;
  }
  function strokePts(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) { ctx.lineTo(pts[i], pts[i + 1]); }
    ctx.stroke();
  }
  function drawBolt(ctx, pts, a, outer, wScale) {
    var w = wScale || 1;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.globalAlpha = clamp(a * 0.35, 0, 1); ctx.strokeStyle = outer || 'rgba(255,210,60,1)'; ctx.lineWidth = 10 * w; strokePts(ctx, pts);
    ctx.globalAlpha = clamp(a * 0.85, 0, 1); ctx.strokeStyle = 'rgba(255,240,150,1)'; ctx.lineWidth = 3.4 * w; strokePts(ctx, pts);
    ctx.globalAlpha = clamp(a, 0, 1); ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 1.4 * w; strokePts(ctx, pts);
  }

  // ---------- 짧은 섬광 (렌더 전용 자식 효과) ----------
  function flashRender(f, ctx) {
    var k = clamp(f.t / f.life, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    gl(ctx, f.x, f.y, f.r * (0.6 + 0.6 * k), f.color, (1 - k) * 0.9);
    ctx.globalAlpha = (1 - k) * 0.8;
    ctx.strokeStyle = f.ring || '#ffffff';
    ctx.lineWidth = 2.5 * (1 - k) + 0.5;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 0.3 + f.r * 0.7 * k, 0, TAU); ctx.stroke();
  }
  function flash(parent, x, y, r, color, ring) {
    mkFrom(parent, { x: x, y: y, r: r, color: color, ring: ring, life: 0.22, render: flashRender });
  }

  // 원격 데이터 정수화
  function ri(v) { return Math.round(v); }

  // =====================================================================
  // 물 (water) — 색: #3fa9ff
  // =====================================================================
  var WATER_COLS = ['#bfe6ff', '#5fb4ff', '#ffffff'];

  // ---------- J. 물방울탄 ----------
  var WB = { vx: 680, vy: -170, grav: 640, fly: 1.1, r: 11, splash: 50, dmgP: 8, dmgM: 14, kx: 240, ky: -170 };
  function wbPop(fx) {
    if (fx.popped) { return; }
    fx.popped = true;
    fx.projectile = false;
    fx.popT = fx.t;
    fx.life = fx.t + 0.38;
    var d = fx.dir, knock = { kx: d * WB.kx, ky: WB.ky };
    S.hitMutantsCircle(fx, fx.x, fx.y, WB.splash, WB.dmgM, knock);
    if (S.hitPlayerCircle(fx, fx.x, fx.y, WB.splash, WB.dmgP, knock)) { burstOn(localP(), 10, WATER_COLS, 240); }
    remoteFx(fx, circBox(fx.x, fx.y, WB.splash), WATER_COLS, 10, 0);
    for (var i = 0; i < 14; i++) {
      var a = -Math.PI * rnd(0.05, 0.95);
      addPart(fx, { x: fx.x, y: fx.y, vx: Math.cos(a) * rnd(80, 260), vy: Math.sin(a) * rnd(120, 320), g: 900,
        life: rnd(0.25, 0.38), r: rnd(1.6, 3.6) }, 20);
    }
    burst(fx.x, fx.y, 6, WATER_COLS, 200);
  }
  function wbUpdate(fx, dt) {
    stepParts(fx, dt);
    if (fx.popped) { return; }
    var prevY = fx.y;
    fx.hist.unshift(fx.x, fx.y);
    if (fx.hist.length > 14) { fx.hist.length = 14; }
    fx.vy += WB.grav * dt;
    fx.x += fx.vx * dt; fx.y += fx.vy * dt;
    var r = WB.r, rect = { x: fx.x - r, y: fx.y - r, w: r * 2, h: r * 2 };
    var hit = anyMutantIn(rect);
    if (!hit && fx.owner === 'remote') { var lp = localP(); hit = isAlive(lp) && circleRect(fx.x, fx.y, r, lp); }
    if (!hit && typeof S.remoteTouchRect === 'function' && S.remoteTouchRect(rect, fx)) { hit = true; }
    if (!hit && fx.vy > 0 && fx.y + r >= surf(fx.x, prevY + r)) { fx.y = surf(fx.x, prevY + r) - r * 0.6; hit = true; }
    if (!hit && (fx.t >= WB.fly || fx.x < -40 || fx.x > worldW() + 40)) { hit = true; }
    if (hit) { wbPop(fx); }
  }
  function wbEnd(fx) { if (!fx.popped) { burst(fx.x, fx.y, 8, WATER_COLS, 200); } } // 얼음 벽 등에 막힘
  function wbRender(fx, ctx) {
    var i;
    ctx.globalCompositeOperation = 'lighter';
    if (fx.popped) {
      var k = clamp((fx.t - fx.popT) / 0.38, 0, 1);
      gl(ctx, fx.x, fx.y, WB.splash * (0.5 + 0.7 * k), '#3fa9ff', 0.55 * (1 - k));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.8 * (1 - k);
      ctx.strokeStyle = 'rgba(220,245,255,1)';
      ctx.lineWidth = 3 * (1 - k) + 0.6;
      ctx.beginPath();
      if (ctx.ellipse) { ctx.ellipse(fx.x, fx.y, WB.splash * (0.3 + 0.8 * k), WB.splash * (0.12 + 0.3 * k), 0, 0, TAU); }
      ctx.stroke();
      drawParts(ctx, fx, 'rgba(170,220,255,0.95)', 'dot');
      return;
    }
    var h = fx.hist;
    for (i = h.length - 2; i >= 0; i -= 2) {
      var f = 1 - i / h.length;
      gl(ctx, h[i], h[i + 1], WB.r * (0.5 + 0.9 * f), '#3fa9ff', 0.35 * f);
    }
    gl(ctx, fx.x, fx.y, WB.r * 2.6, '#5fb4ff', 0.55);
    ctx.globalCompositeOperation = 'source-over';
    var wob = Math.sin(fx.t * 32) * 0.1;
    var rx = WB.r * (1 + wob), ry = WB.r * (1 - wob);
    var g = ctx.createRadialGradient(fx.x - 3, fx.y - 4, 1, fx.x, fx.y, WB.r * 1.1);
    g.addColorStop(0, 'rgba(240,252,255,0.95)');
    g.addColorStop(0.45, 'rgba(110,190,255,0.75)');
    g.addColorStop(1, 'rgba(30,100,210,0.85)');
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = g;
    ctx.beginPath();
    if (ctx.ellipse) { ctx.ellipse(fx.x, fx.y, rx, ry, 0, 0, TAU); } else { ctx.arc(fx.x, fx.y, WB.r, 0, TAU); }
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,248,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(fx.x - rx * 0.38, fx.y - ry * 0.4, 2.6, 0, TAU); ctx.fill();
  }
  S.register({
    id: 'water_bubble', element: 'water', elementName: '물', name: '물방울탄', icon: '🫧', rarity: 'easy',
    cost: 10, cooldown: 0.4, color: '#3fa9ff',
    desc: '포물선으로 날아가 터지는 물방울을 던져 주변 적에게 물보라 피해를 줍니다.',
    cast: function (ctx) {
      var h = handOf(ctx);
      mk('water_bubble', ctx, { x: h.x, y: h.y, dir: h.d, vx: h.d * WB.vx, vy: WB.vy, life: WB.fly + 0.4,
        r: WB.r, projectile: true, hist: [], parts: [], update: wbUpdate, render: wbRender, end: wbEnd });
    }
  });

  // ---------- L. 소용돌이 ----------
  var WP = { off: 210, life: 2.1, r: 120, pull: 1500, rehit: 0.5, dmgP: 4, dmgM: 8, slow: 0.4,
    gW: 120, gH: 210, gDmgP: 8, gDmgM: 16, gKy: -820 };
  function wpBase(fx) { return absY(fx.sy); }
  function wpUpdate(fx, dt) {
    var base = wpBase(fx), cy = base - 40, x = fx.x;
    fx.y = cy;
    stepParts(fx, dt);
    var ending = fx.t >= fx.life - 0.32;
    if (!ending) {
      var k = clamp(fx.t / 0.3, 0, 1);
      S.pullMutants(fx, x, cy, WP.r * 1.25, WP.pull * k, dt);
      S.pullPlayer(fx, x, cy, WP.r * 1.25, WP.pull * k, dt);
      if (fx.t > 0.2) {
        S.hitMutantsCircle(fx, x, cy, WP.r * 0.8, WP.dmgM, 0);
        if (S.hitPlayerCircle(fx, x, cy, WP.r * 0.8, WP.dmgP, 0)) { burstOn(localP(), 6, WATER_COLS, 160); }
        remoteFx(fx, circBox(x, cy, WP.r * 0.8), WATER_COLS, 6, WP.rehit);
      }
      fx.stT -= dt;
      if (fx.stT <= 0) {
        fx.stT = 0.15;
        S.statusMutantsCircle(fx, x, cy, WP.r, 'slow', WP.slow);
        S.statusPlayerCircle(fx, x, cy, WP.r, 'slow', WP.slow);
      }
      if (Math.random() < 0.5) {
        var a = rnd(0, TAU), rr = rnd(0.5, 1) * WP.r;
        addPart(fx, { x: x + Math.cos(a) * rr, y: base - 6 + Math.sin(a) * rr * 0.3, vx: -Math.sin(a) * 160, vy: rnd(-90, -30),
          life: rnd(0.3, 0.5), r: rnd(1.5, 3) }, 30);
      }
    } else if (!fx.geyser) {
      fx.geyser = true;
      mkFrom(fx, { x: x, y: base - WP.gH / 2, sy: fx.sy, life: 0.55, update: wpGeyserUpdate, render: wpGeyserRender, parts: [] });
      shakeNear(fx, x, 5);
    }
  }
  function wpGeyserUpdate(fx, dt) {
    stepParts(fx, dt);
    var base = absY(fx.sy);
    if (fx.t < 0.25) {
      var rise = clamp(fx.t / 0.1, 0, 1);
      var rect = { x: fx.x - WP.gW / 2, y: base - WP.gH * rise, w: WP.gW, h: WP.gH * rise };
      S.hitMutantsRect(fx, rect, WP.gDmgM, 0, WP.gKy);
      if (S.hitPlayerRect(fx, rect, WP.gDmgP, 0, WP.gKy)) { burstOn(localP(), 12, WATER_COLS, 280); }
      remoteFx(fx, rect, WATER_COLS, 12, 0);
      for (var i = 0; i < 2; i++) {
        addPart(fx, { x: fx.x + rnd(-30, 30), y: base - WP.gH * rise * rnd(0.6, 1), vx: rnd(-160, 160), vy: rnd(-380, -120),
          g: 900, life: rnd(0.3, 0.5), r: rnd(2, 4) }, 36);
      }
    }
  }
  function wpGeyserRender(fx, ctx) {
    var base = absY(fx.sy);
    var up = clamp(fx.t / 0.1, 0, 1), down = clamp((fx.life - fx.t) / 0.3, 0, 1);
    var H = WP.gH * up * (0.4 + 0.6 * down), hw = WP.gW / 2 * (0.6 + 0.4 * down);
    if (H > 2) {
      var g = ctx.createLinearGradient(0, base - H, 0, base);
      g.addColorStop(0, 'rgba(230,248,255,' + (0.9 * down) + ')');
      g.addColorStop(0.4, 'rgba(90,175,255,' + (0.75 * down) + ')');
      g.addColorStop(1, 'rgba(25,85,195,' + (0.8 * down) + ')');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      var wob = Math.sin(fx.t * 40) * 5;
      ctx.beginPath();
      ctx.moveTo(fx.x - hw, base);
      ctx.quadraticCurveTo(fx.x - hw * 0.4 + wob, base - H * 0.6, fx.x - hw * 0.7, base - H);
      ctx.quadraticCurveTo(fx.x, base - H - 26 * down, fx.x + hw * 0.7, base - H);
      ctx.quadraticCurveTo(fx.x + hw * 0.4 - wob, base - H * 0.6, fx.x + hw, base);
      ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      gl(ctx, fx.x, base - H, hw * 1.2, '#7fc8ff', 0.6 * down);
      ctx.globalCompositeOperation = 'source-over';
    }
    drawParts(ctx, fx, 'rgba(190,230,255,0.95)', 'dot');
  }
  function wpRender(fx, ctx) {
    var base = wpBase(fx), x = fx.x, i;
    var k = clamp(fx.t / 0.3, 0, 1) * clamp((fx.life - fx.t) / 0.35, 0, 1);
    if (k <= 0) { return; }
    var R = WP.r * (0.5 + 0.5 * k);
    // 바닥 소용돌이 (납작한 원)
    ctx.save();
    ctx.translate(x, base - 4);
    ctx.scale(1, 0.3);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, 'rgba(8,30,80,' + (0.85 * k) + ')');
    g.addColorStop(0.55, 'rgba(30,110,210,' + (0.6 * k) + ')');
    g.addColorStop(1, 'rgba(90,180,255,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.lineCap = 'round';
    for (i = 0; i < 6; i++) {
      var rr = R * (0.25 + i * 0.13);
      var sp = 9 / (0.6 + i * 0.5);
      var a0 = -fx.t * sp + i * 1.1;
      ctx.globalAlpha = k * (0.85 - i * 0.08);
      ctx.strokeStyle = i % 2 ? 'rgba(220,245,255,1)' : 'rgba(120,200,255,1)';
      ctx.lineWidth = (i % 2 ? 4 : 6);
      ctx.beginPath(); ctx.arc(0, 0, rr, a0, a0 + 2.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, rr, a0 + Math.PI, a0 + Math.PI + 1.6); ctx.stroke();
    }
    ctx.restore();
    // 솟아오르는 물기둥 깔때기
    var H = 95 * k, n = 8;
    ctx.globalAlpha = 0.35 * k;
    ctx.fillStyle = 'rgba(80,170,255,1)';
    ctx.beginPath();
    for (i = 0; i <= n; i++) {
      var s = i / n, yy = base - H * s, rw = 10 + 46 * s * s + 6;
      var sx = Math.sin(fx.t * 7 + s * 4) * 6 * s;
      if (i === 0) { ctx.moveTo(x + sx - rw, yy); } else { ctx.lineTo(x + sx - rw, yy); }
    }
    for (i = n; i >= 0; i--) {
      var s2 = i / n, rw2 = 10 + 46 * s2 * s2 + 6, sx2 = Math.sin(fx.t * 7 + s2 * 4) * 6 * s2;
      ctx.lineTo(x + sx2 + rw2, base - H * s2);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(225,246,255,1)';
    ctx.lineWidth = 2;
    for (var st = 0; st < 3; st++) {
      ctx.globalAlpha = 0.6 * k;
      ctx.beginPath();
      for (i = 0; i <= 18; i++) {
        var s3 = i / 18, rw3 = 10 + 46 * s3 * s3, ang = -fx.t * 12 + st * 2.1 + s3 * 6;
        var px = x + Math.sin(fx.t * 7 + s3 * 4) * 6 * s3 + Math.cos(ang) * rw3;
        var py = base - H * s3 + Math.sin(ang) * rw3 * 0.15;
        if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    gl(ctx, x, base - 10, R * 0.8, '#3fa9ff', 0.35 * k);
    ctx.globalCompositeOperation = 'source-over';
    drawParts(ctx, fx, 'rgba(210,240,255,0.9)', 'dot');
  }
  S.register({
    id: 'water_whirlpool', element: 'water', elementName: '물', name: '소용돌이', icon: '🌀', rarity: 'easy',
    cost: 40, cooldown: 5, color: '#3fa9ff',
    desc: '앞쪽에 소용돌이를 만들어 적을 빨아들이고 느리게 한 뒤, 물기둥으로 띄워 올립니다.',
    prepare: function (c) {
      var d = dirOf(c.facing), cx = c.x + pw(c.p) / 2, feet = c.y + ph(c.p);
      var tx = clamp(cx + d * WP.off, 60, worldW() - 60);
      return { tx: ri(tx), sy: ri(relY(surf(tx, feet))) };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), feet = ctx.y + ph(ctx.p), data = ctx.data || {};
      var tx = clamp(num(data.tx, ctx.x + pw(ctx.p) / 2 + d * WP.off), 60, worldW() - 60);
      var sy = num(data.sy, relY(feet));
      mk('water_whirlpool', ctx, { x: tx, y: absY(sy) - 40, sy: sy, life: WP.life, rehit: WP.rehit, stT: 0, parts: [],
        update: wpUpdate, render: wpRender });
    }
  });

  // ---------- I. 해일 ----------
  var TS = { speed: 600, dist: 700, life: 1.5, w: 130, h: 180, dmgP: 26, dmgM: 45, kx: 760, ky: -460, ride: 0.55, back: 50 };
  function tsK(fx) { return clamp(fx.t / 0.2, 0, 1) * clamp((fx.life - fx.t) / 0.3, 0, 1); }
  function tsUpdate(fx, dt) {
    stepParts(fx, dt);
    var d = fx.dir, base = absY(fx.sy);
    var travel = Math.min(TS.dist, TS.speed * fx.t);
    fx.x = clamp(fx.x0 + d * travel, 0, worldW());
    var k = tsK(fx), H = TS.h * k;
    fx.y = base - H / 2;
    var rect = { x: fx.x - TS.w / 2, y: base - H, w: TS.w, h: H };
    if (H > 20) {
      S.hitMutantsRect(fx, rect, TS.dmgM, d * TS.kx, TS.ky);
      if (S.hitPlayerRect(fx, rect, TS.dmgP, d * TS.kx, TS.ky)) { burstOn(localP(), 16, WATER_COLS, 320); }
      remoteFx(fx, rect, WATER_COLS, 14, 0);
    }
    // 시전자 파도 타기 (로컬만 — 위치는 상태 동기화로 다른 사람에게 보임)
    if (fx.owner === 'local' && !fx.rideDone) {
      var lp = localP();
      if (!isAlive(lp)) { fx.rideDone = true; }
      else if (fx.t < TS.ride) {
        lp.x = clamp(fx.x + d * TS.w * 0.12 - pw(lp) / 2, 0, worldW() - pw(lp));
        lp.y = Math.min(lp.y, base - H * 0.62 - ph(lp));
        lp.vx = 0; lp.vy = 0; lp.onGround = false;
        lp.frozen = Math.max(lp.frozen || 0, 0.05);
      } else {
        fx.rideDone = true;
        lp.vx = d * 380; lp.vy = -320;
      }
    }
    if (H > 30) {
      for (var i = 0; i < 2; i++) {
        addPart(fx, { x: fx.x + d * rnd(20, TS.w * 0.5), y: base - H * rnd(0.55, 1), vx: d * rnd(120, 360), vy: rnd(-300, -60),
          g: 800, life: rnd(0.3, 0.55), r: rnd(2, 4.5) }, 44);
      }
    }
    if (!fx.boomed) { fx.boomed = true; shakeNear(fx, fx.x, 8); }
  }
  function tsRender(fx, ctx) {
    var d = fx.dir, base = absY(fx.sy), k = tsK(fx), H = TS.h * k, w = TS.w;
    if (H < 2) { drawParts(ctx, fx, 'rgba(210,240,255,0.95)', 'dot'); return; }
    ctx.save();
    ctx.translate(fx.x, base);
    ctx.scale(d, 1);
    // 뒤쪽 물살 꼬리
    var tail = ctx.createLinearGradient(-w * 2.2, 0, -w * 0.3, 0);
    tail.addColorStop(0, 'rgba(40,120,220,0)');
    tail.addColorStop(1, 'rgba(40,120,220,' + (0.55 * k) + ')');
    ctx.globalAlpha = 1;
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(-w * 2.2, 0); ctx.quadraticCurveTo(-w * 1.2, -H * 0.18, -w * 0.3, -H * 0.4); ctx.lineTo(-w * 0.3, 0);
    ctx.closePath(); ctx.fill();
    // 파도 본체
    var wob = Math.sin(fx.t * 18) * 4;
    var g = ctx.createLinearGradient(0, -H * 1.05, 0, 0);
    g.addColorStop(0, 'rgba(235,250,255,0.98)');
    g.addColorStop(0.22, 'rgba(120,200,255,0.95)');
    g.addColorStop(0.6, 'rgba(40,125,225,0.92)');
    g.addColorStop(1, 'rgba(15,60,160,0.95)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w * 0.8, 0);
    ctx.quadraticCurveTo(-w * 0.55, -H * 0.35, -w * 0.18, -H * 0.86);
    ctx.quadraticCurveTo(w * 0.12, -H * 1.12 + wob, w * 0.42, -H * 0.95);
    ctx.bezierCurveTo(w * 0.62, -H * 0.85, w * 0.66, -H * 0.62, w * 0.5, -H * 0.56);
    ctx.quadraticCurveTo(w * 0.38, -H * 0.6, w * 0.36, -H * 0.72);
    ctx.quadraticCurveTo(w * 0.26, -H * 0.45, w * 0.55, 0);
    ctx.closePath(); ctx.fill();
    // 물마루 거품선
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-w * 0.18, -H * 0.86);
    ctx.quadraticCurveTo(w * 0.12, -H * 1.12 + wob, w * 0.42, -H * 0.95);
    ctx.bezierCurveTo(w * 0.62, -H * 0.85, w * 0.66, -H * 0.62, w * 0.5, -H * 0.56);
    ctx.stroke();
    // 내부 물결 무늬
    ctx.strokeStyle = 'rgba(200,235,255,0.55)';
    ctx.lineWidth = 2;
    for (var i = 1; i <= 3; i++) {
      var yy = -H * (0.2 + i * 0.16);
      ctx.beginPath();
      ctx.moveTo(-w * (0.55 - i * 0.08), yy);
      ctx.quadraticCurveTo(-w * 0.1, yy - 10 + Math.sin(fx.t * 14 + i) * 5, w * (0.25 - i * 0.03), yy + 4);
      ctx.stroke();
    }
    // 거품 방울
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (i = 0; i < 9; i++) {
      var s = i / 8, fxp = -w * 0.18 + s * w * 0.6;
      var fyp = -H * (0.88 + 0.16 * Math.sin(Math.PI * s)) + Math.sin(fx.t * 20 + i * 2) * 4;
      ctx.beginPath(); ctx.arc(fxp, fyp, 3 + (i % 3) * 1.6, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    gl(ctx, w * 0.2, -H * 0.8, H * 0.55, '#5fb4ff', 0.35 * k);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    drawParts(ctx, fx, 'rgba(215,242,255,0.95)', 'dot');
  }
  S.register({
    id: 'water_tsunami', element: 'water', elementName: '물', name: '해일', icon: '🌊', rarity: 'easy',
    cost: 70, cooldown: 10, color: '#3fa9ff',
    desc: '거대한 해일을 일으켜 그 위에 올라탄 채 앞의 모든 적을 휩쓸어 날려 버립니다.',
    prepare: function (c) {
      var p = c.p, d = dirOf(c.facing), cx = p.x + pw(p) / 2, feet = p.y + ph(p);
      var x0 = clamp(cx - d * TS.back, 0, worldW());
      p.frozen = Math.max(p.frozen || 0, TS.ride);
      p.invulnTimer = Math.max(p.invulnTimer || 0, TS.ride + 0.15);
      if (typeof S.lockCast === 'function') { S.lockCast(TS.ride); }
      return { x0: ri(x0), sy: ri(relY(surf(cx, feet))) };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), data = ctx.data || {};
      var x0 = clamp(num(data.x0, ctx.x + pw(ctx.p) / 2 - d * TS.back), 0, worldW());
      var sy = num(data.sy, relY(ctx.y + ph(ctx.p)));
      mk('water_tsunami', ctx, { x: x0, x0: x0, y: absY(sy) - TS.h / 2, sy: sy, dir: d, life: TS.life, parts: [],
        update: tsUpdate, render: tsRender });
    }
  });

  // =====================================================================
  // 풀 (grass) — 색: #4fc24a
  // =====================================================================
  var GRASS_COLS = ['#5fcf4a', '#a6f07a', '#2f8a2a'];

  // ---------- J. 나뭇잎 부메랑 ----------
  var GL = { dist: 300, out: 0.42, life: 1.25, r: 15, dmgP: 6, dmgM: 11, kx: 160, ky: -120, rehit: 0.4, back: 980 };
  function glUpdate(fx, dt) {
    stepParts(fx, dt);
    var ox = fx.x;
    if (fx.t < GL.out) {
      var u = fx.t / GL.out, e = 1 - (1 - u) * (1 - u);
      fx.x = fx.x0 + fx.dir * GL.dist * e;
      fx.y = fx.y0 - 24 * Math.sin(Math.PI * u * 0.5);
    } else {
      var c = typeof S.casterOf === 'function' ? S.casterOf(fx) : null;
      var tx = c ? c.x + pw(c) / 2 : fx.x0, ty = c ? c.y + ph(c) * 0.42 : fx.y0;
      var dx = tx - fx.x, dy = ty - fx.y, dd = Math.sqrt(dx * dx + dy * dy) || 1;
      var sp = GL.back * clamp((fx.t - GL.out) / 0.2, 0.25, 1);
      var st = Math.min(dd, sp * dt);
      fx.x += dx / dd * st; fx.y += dy / dd * st;
      if (dd < 22 && fx.t > GL.out + 0.08) { fx.dead = true; burst(fx.x, fx.y, 4, GRASS_COLS, 120); return; }
    }
    var mv = fx.x - ox;
    if (Math.abs(mv) > 0.01) { fx.vdir = mv < 0 ? -1 : 1; }
    var r = GL.r, rect = { x: fx.x - r, y: fx.y - r, w: r * 2, h: r * 2 }, kd = fx.vdir || fx.dir;
    var ms = S.hitMutantsRect(fx, rect, GL.dmgM, kd * GL.kx, GL.ky);
    for (var i = 0; i < ms.length; i++) { burstOn(ms[i], 6, GRASS_COLS, 180); }
    if ((fx.meHits || 0) < 2 && S.hitPlayerRect(fx, rect, GL.dmgP, kd * GL.kx, GL.ky)) {
      fx.meHits = (fx.meHits || 0) + 1;
      burstOn(localP(), 8, GRASS_COLS, 200);
    }
    remoteFx(fx, rect, GRASS_COLS, 6, GL.rehit);
    if (Math.random() < 0.35) {
      addPart(fx, { x: fx.x, y: fx.y, vx: rnd(-40, 40), vy: rnd(-30, 50), g: 120, life: rnd(0.3, 0.5), r: rnd(2.5, 4),
        a0: rnd(0, TAU), spin: rnd(-9, 9), c: Math.random() < 0.5 ? '#6fd650' : '#3d9a30' }, 18);
    }
  }
  function leafShape(ctx, len, wid) {
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.quadraticCurveTo(-len * 0.1, -wid, len, 0);
    ctx.quadraticCurveTo(-len * 0.1, wid, -len, 0);
    ctx.closePath();
  }
  function glRender(fx, ctx) {
    ctx.globalCompositeOperation = 'lighter';
    gl(ctx, fx.x, fx.y, 30, '#4fc24a', 0.45);
    ctx.globalCompositeOperation = 'source-over';
    drawParts(ctx, fx, '#4fae3a', 'shard');
    ctx.save();
    ctx.translate(fx.x, fx.y);
    ctx.rotate(fx.t * 22 * fx.dir);
    // 잔상 날
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#a6f07a';
    ctx.save(); ctx.rotate(-0.5 * fx.dir); leafShape(ctx, 16, 7); ctx.fill(); ctx.restore();
    ctx.globalAlpha = 1;
    var g = ctx.createLinearGradient(0, -7, 0, 7);
    g.addColorStop(0, '#b8f58a'); g.addColorStop(0.5, '#4fc24a'); g.addColorStop(1, '#25701f');
    ctx.fillStyle = g;
    leafShape(ctx, 16, 7); ctx.fill();
    ctx.strokeStyle = '#1f5a1c'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(230,255,200,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(14, 0);
    ctx.moveTo(-4, 0); ctx.lineTo(2, -4); ctx.moveTo(-4, 0); ctx.lineTo(2, 4);
    ctx.moveTo(5, 0); ctx.lineTo(10, -3); ctx.moveTo(5, 0); ctx.lineTo(10, 3);
    ctx.stroke();
    ctx.restore();
  }
  S.register({
    id: 'grass_leaf', element: 'grass', elementName: '풀', name: '나뭇잎 부메랑', icon: '🍃', rarity: 'easy',
    cost: 10, cooldown: 0.6, color: '#4fc24a',
    desc: '날카로운 나뭇잎을 던집니다. 적을 꿰뚫고 날아갔다가 다시 손으로 돌아오며 한 번 더 벱니다.',
    cast: function (ctx) {
      var h = handOf(ctx);
      mk('grass_leaf', ctx, { x: h.x, y: h.y, x0: h.x, y0: h.y, dir: h.d, vdir: h.d, life: GL.life, rehit: GL.rehit,
        projectile: true, r: GL.r, parts: [], update: glUpdate, render: glRender });
    }
  });

  // ---------- L. 치유의 꽃 ----------
  var GB = { life: 4.2, open: 0.35, r: 125, tick: 0.5, heal: 2.5, dmgP: 2, dmgM: 5, slow: 0.4 };
  function gbUpdate(fx, dt) {
    stepParts(fx, dt);
    var base = absY(fx.sy), cy = base - 30, x = fx.x;
    fx.y = cy;
    if (fx.healPulse > 0) { fx.healPulse -= dt; }
    if (fx.t < GB.open || fx.t > fx.life - 0.2) { return; }
    // 시전자 회복 (로컬 시전자만 자기 체력에 적용 — 체력은 상태 동기화로 전파)
    if (fx.owner === 'local') {
      var lp = localP();
      if (isAlive(lp) && circleRect(x, cy, GB.r, lp)) {
        fx.healT -= dt;
        if (fx.healT <= 0) {
          fx.healT = GB.tick;
          var mx = lp.maxHp || 100;
          if (lp.hp < mx) {
            lp.hp = Math.min(mx, lp.hp + GB.heal);
            fx.healPulse = 0.35;
            for (var i = 0; i < 3; i++) {
              addPart(fx, { x: lp.x + rnd(4, pw(lp) - 4), y: lp.y + rnd(20, ph(lp)), vx: rnd(-10, 10), vy: rnd(-90, -50),
                life: rnd(0.5, 0.8), r: rnd(5, 8), c: '#9dff7a', plus: true }, 30);
            }
          }
        }
      }
    }
    S.hitMutantsCircle(fx, x, cy, GB.r, GB.dmgM, 0);
    if (S.hitPlayerCircle(fx, x, cy, GB.r, GB.dmgP, 0)) { burstOn(localP(), 4, ['#ffd0ec', '#ffe680'], 120); }
    remoteFx(fx, circBox(x, cy, GB.r), ['#ffd0ec', '#ffe680'], 4, GB.tick);
    fx.stT -= dt;
    if (fx.stT <= 0) {
      fx.stT = 0.2;
      S.statusMutantsCircle(fx, x, cy, GB.r, 'slow', GB.slow);
      S.statusPlayerCircle(fx, x, cy, GB.r, 'slow', GB.slow);
    }
  }
  function gbRender(fx, ctx) {
    var base = absY(fx.sy), x = fx.x, i;
    var open = clamp(fx.t / GB.open, 0, 1), fade = clamp((fx.life - fx.t) / 0.4, 0, 1);
    open = 1 - (1 - open) * (1 - open);
    var k = open * fade;
    if (k <= 0) { return; }
    // 바닥 치유 원
    ctx.save();
    ctx.translate(x, base - 2);
    ctx.scale(1, 0.24);
    ctx.globalCompositeOperation = 'lighter';
    gl(ctx, 0, 0, GB.r * 1.15 * open, '#4fc24a', 0.5 * k);
    ctx.globalAlpha = (0.55 + 0.25 * Math.sin(fx.t * 5)) * k;
    ctx.strokeStyle = 'rgba(170,255,140,1)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, GB.r * open, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.5 * k;
    ctx.strokeStyle = 'rgba(255,170,220,1)';
    ctx.lineWidth = 3;
    var ra = fx.t * 0.8;
    for (i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.arc(0, 0, GB.r * 0.72 * open, ra + i * 1.047, ra + i * 1.047 + 0.5); ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    // 풀잎 (결정적 위치)
    ctx.lineCap = 'round';
    for (i = 0; i < 16; i++) {
      var u = ((i * 0.618034) % 1) * 2 - 1;
      var bx = x + u * GB.r * 0.95 * open;
      var bh = (10 + (i * 7) % 12) * k;
      var sw = Math.sin(fx.t * 3 + i) * 3;
      ctx.globalAlpha = 0.9 * fade;
      ctx.strokeStyle = i % 2 ? '#3d9a30' : '#6fd650';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(bx, base); ctx.quadraticCurveTo(bx + sw * 0.5, base - bh * 0.6, bx + sw, base - bh); ctx.stroke();
    }
    // 줄기 + 꽃
    var stemH = 42 * k, fyc = base - stemH;
    ctx.strokeStyle = '#2f8a2a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x, base); ctx.quadraticCurveTo(x - 6, base - stemH * 0.5, x, fyc); ctx.stroke();
    ctx.fillStyle = '#4fae3a';
    ctx.save(); ctx.translate(x - 2, base - stemH * 0.4); ctx.rotate(-0.7); leafShape(ctx, 10 * k, 5 * k); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(x + 2, base - stemH * 0.55); ctx.rotate(0.7 + Math.PI); leafShape(ctx, 9 * k, 4.5 * k); ctx.fill(); ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    gl(ctx, x, fyc, 40 * k + (fx.healPulse > 0 ? 14 : 0), '#ff8fc8', 0.5 * k);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(x, fyc);
    ctx.rotate(fx.t * 0.6);
    var pr = 16 * k;
    for (i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate(i * TAU / 8);
      var pg = ctx.createLinearGradient(0, 0, pr * 1.6, 0);
      pg.addColorStop(0, '#fff2fa'); pg.addColorStop(0.5, '#ff9ad0'); pg.addColorStop(1, '#e0509a');
      ctx.globalAlpha = fade;
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(pr * 0.8, -pr * 0.55, pr * 1.6, 0);
      ctx.quadraticCurveTo(pr * 0.8, pr * 0.55, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath(); ctx.arc(0, 0, 5.5 * k, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c98a10';
    for (i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(Math.cos(i * 1.26) * 2.6 * k, Math.sin(i * 1.26) * 2.6 * k, 0.9, 0, TAU); ctx.fill(); }
    ctx.restore();
    // 꽃가루 (결정적 경로)
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < 14; i++) {
      var ph2 = (fx.t * 0.45 + i * 0.0714) % 1;
      var px = x + Math.sin(i * 2.3 + fx.t * 1.5) * GB.r * 0.8 * ((i * 0.37) % 1);
      var py = base - ph2 * 110;
      gl(ctx, px, py, 7, i % 3 ? '#ffe680' : '#ff9ad0', k * (1 - ph2) * 0.8);
    }
    // 회복 표시 (+)
    var L = fx.parts || [];
    ctx.globalCompositeOperation = 'source-over';
    for (i = 0; i < L.length; i++) {
      var q = L[i], a = clamp(q.life / q.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#b8ff8a';
      ctx.fillRect(q.x - q.r / 2, q.y - 1.2, q.r, 2.4);
      ctx.fillRect(q.x - 1.2, q.y - q.r / 2, 2.4, q.r);
    }
    if (fx.healPulse > 0) {
      var c = typeof S.casterOf === 'function' ? S.casterOf(fx) : null;
      if (c) {
        ctx.globalCompositeOperation = 'lighter';
        gl(ctx, c.x + pw(c) / 2, c.y + ph(c) / 2, 44, '#7fe06a', fx.healPulse * 1.2);
      }
    }
  }
  S.register({
    id: 'grass_bloom', element: 'grass', elementName: '풀', name: '치유의 꽃', icon: '🌸', rarity: 'easy',
    cost: 35, cooldown: 7, color: '#4fc24a',
    desc: '발밑에 꽃을 피워 4초간 그 안에 있는 나를 회복시키고, 들어온 적은 꽃가루로 느리게 하며 깎아냅니다.',
    prepare: function (c) {
      var cx = c.x + pw(c.p) / 2;
      return { x: ri(cx), sy: ri(relY(surf(cx, c.y + ph(c.p)))) };
    },
    cast: function (ctx) {
      var data = ctx.data || {};
      var x = clamp(num(data.x, ctx.x + pw(ctx.p) / 2), 0, worldW());
      var sy = num(data.sy, relY(ctx.y + ph(ctx.p)));
      mk('grass_bloom', ctx, { x: x, y: absY(sy) - 30, sy: sy, life: GB.life, rehit: GB.tick, healT: 0, healPulse: 0,
        stT: 0, parts: [], update: gbUpdate, render: gbRender });
      burst(x, absY(sy) - 10, 10, ['#ff9ad0', '#a6f07a', '#ffe680'], 200);
    }
  });

  // ---------- I. 가시 숲 ----------
  var GT = { n: 6, start: 80, gap: 72, step: 0.09, dur: 0.85, act: 0.35, w: 72, h: 140,
    dmgP: 22, dmgM: 38, ky: -460, root: 1.2, rootM: 2.2 };
  function gtRise(fx) {
    var at = fx.t - fx.delay;
    if (at < 0) { return 0; }
    var up = clamp(at / 0.09, 0, 1), down = clamp((fx.life - fx.t) / 0.18, 0, 1);
    up = 1 - (1 - up) * (1 - up);
    return Math.min(up, down);
  }
  function gtUpdate(fx) {
    if (fx.t < fx.delay) { return; }
    var g = gy();
    if (!fx.popped) {
      fx.popped = true;
      burst(fx.x, g - 4, 10, ['#2f8a2a', '#7a5a34', '#a6f07a'], 280);
      if (fx.idx === 0) { shakeNear(fx, fx.x, 7); }
    }
    var rise = gtRise(fx), at = fx.t - fx.delay;
    if (rise < 0.35 || at > GT.act) { return; }
    var rect = { x: fx.x - GT.w / 2, y: g - GT.h * rise, w: GT.w, h: GT.h * rise };
    // hitSet 을 숲 전체가 공유 → 한 대상은 한 번만 맞는다 (최대 22)
    var ms = S.hitMutantsRect(fx, rect, GT.dmgM, 0, GT.ky);
    for (var i = 0; i < ms.length; i++) { burstOn(ms[i], 8, GRASS_COLS, 220); }
    S.statusMutantsRect(fx, rect, 'root', GT.rootM);
    if (S.hitPlayerRect(fx, rect, GT.dmgP, 0, GT.ky)) {
      S.statusPlayerRect(fx, rect, 'root', GT.root);
      burstOn(localP(), 12, ['#2f8a2a', '#c0303a', '#a6f07a'], 260);
    }
    remoteFx(fx, rect, ['#2f8a2a', '#a6f07a'], 10, 0);
  }
  function gtRender(fx, ctx) {
    var g = gy(), i, k;
    if (fx.t < fx.delay) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = 'rgba(70,50,28,1)';
      ctx.beginPath();
      if (ctx.ellipse) { ctx.ellipse(fx.x, g, GT.w * 0.4, 4, 0, 0, TAU); }
      ctx.fill();
      return;
    }
    var rise = gtRise(fx);
    if (rise <= 0.01) { return; }
    // 흙 둔덕
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(78,56,32,1)';
    ctx.beginPath();
    ctx.moveTo(fx.x - GT.w / 2 - 8, g);
    ctx.quadraticCurveTo(fx.x, g - 18 * rise, fx.x + GT.w / 2 + 8, g);
    ctx.closePath(); ctx.fill();
    ctx.lineCap = 'round';
    for (i = 0; i < fx.spikes.length; i++) {
      var sp = fx.spikes[i];
      var bx = fx.x + sp.ox, H = GT.h * sp.hm * rise;
      var tx = bx + sp.lean * rise, ty = g - H;
      var cx1 = bx + sp.c1, cy1 = g - H * 0.5;
      // 덩굴 줄기 (어두운 테두리 + 밝은 속)
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#173f14'; ctx.lineWidth = sp.wd + 3;
      ctx.beginPath(); ctx.moveTo(bx, g); ctx.quadraticCurveTo(cx1, cy1, tx, ty); ctx.stroke();
      ctx.strokeStyle = i % 2 ? '#3d8a2c' : '#4f9e36'; ctx.lineWidth = sp.wd;
      ctx.beginPath(); ctx.moveTo(bx, g); ctx.quadraticCurveTo(cx1, cy1, tx, ty); ctx.stroke();
      // 가시
      ctx.fillStyle = '#e8e0b0';
      for (k = 1; k <= 4; k++) {
        var s = k / 5, u = 1 - s;
        var px = u * u * bx + 2 * u * s * cx1 + s * s * tx;
        var py = u * u * g + 2 * u * s * cy1 + s * s * ty;
        var side = k % 2 ? 1 : -1, ln = 7 * (1 - s * 0.4);
        ctx.beginPath();
        ctx.moveTo(px, py - 3); ctx.lineTo(px + side * ln, py - ln * 0.6); ctx.lineTo(px, py + 3);
        ctx.closePath(); ctx.fill();
      }
      // 끝 가시
      ctx.fillStyle = '#f4efd0';
      var ang = Math.atan2(ty - cy1, tx - cx1);
      ctx.beginPath();
      ctx.moveTo(tx + Math.cos(ang) * 12, ty + Math.sin(ang) * 12);
      ctx.lineTo(tx + Math.cos(ang + 1.6) * 4, ty + Math.sin(ang + 1.6) * 4);
      ctx.lineTo(tx + Math.cos(ang - 1.6) * 4, ty + Math.sin(ang - 1.6) * 4);
      ctx.closePath(); ctx.fill();
      if (sp.berry) {
        ctx.fillStyle = '#c0303a';
        ctx.beginPath(); ctx.arc(cx1 * 0.5 + tx * 0.5 + 4, cy1 * 0.5 + ty * 0.5, 3.2, 0, TAU); ctx.fill();
      }
    }
    if (fx.t - fx.delay < 0.25) {
      ctx.globalCompositeOperation = 'lighter';
      gl(ctx, fx.x, g - 20, GT.w, '#7fe06a', 0.5 * (1 - (fx.t - fx.delay) / 0.25));
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  S.register({
    id: 'grass_thorns', element: 'grass', elementName: '풀', name: '가시 숲', icon: '🌲', rarity: 'easy',
    cost: 70, cooldown: 10, color: '#4fc24a',
    desc: '앞쪽 땅을 따라 가시덤불 숲을 연달아 솟구치게 해 적을 꿰뚫고 그 자리에 묶어 둡니다.',
    cast: function (ctx) {
      var d = dirOf(ctx.facing), cx0 = ctx.x + pw(ctx.p) / 2;
      var sharedHits = {};
      for (var i = 0; i < GT.n; i++) {
        var tx = cx0 + d * (GT.start + GT.gap * i);
        if (tx < 10 || tx > worldW() - 10) { break; }
        var spikes = [];
        for (var k = 0; k < 5; k++) {
          spikes.push({ ox: -GT.w / 2 + 8 + k * ((GT.w - 16) / 4) + rnd(-5, 5), hm: rnd(0.6, 1), lean: rnd(-22, 22),
            c1: rnd(-20, 20), wd: rnd(4, 6.5), berry: Math.random() < 0.3 });
        }
        mk('grass_thorns', ctx, { x: tx, y: gy() - GT.h / 2, idx: i, dir: d, delay: i * GT.step,
          life: i * GT.step + GT.dur, hitSet: sharedHits, spikes: spikes, update: gtUpdate, render: gtRender });
      }
    }
  });

  // =====================================================================
  // 전기 (electric) — 색: #ffe14a
  // =====================================================================
  var ELEC_COLS = ['#ffffff', '#fff3a0', '#ffe14a'];

  // ---------- J. 스파크 ----------
  var ES = { speed: 1150, life: 0.34, r: 9, dmgP: 7, dmgM: 13, kx: 170, ky: -90 };
  function esPop(fx) {
    fx.dead = true; fx._popped = true;
    burst(fx.x, fx.y, 6, ELEC_COLS, 240);
    flash(fx, fx.x, fx.y, 34, '#ffe14a', '#fff6c0');
  }
  function esUpdate(fx, dt) {
    fx.hist.unshift(fx.x, fx.y);
    if (fx.hist.length > 12) { fx.hist.length = 12; }
    fx.x += fx.dir * ES.speed * dt;
    var r = ES.r, rect = { x: fx.x - r, y: fx.y - r, w: r * 2, h: r * 2 }, d = fx.dir;
    if (anyMutantIn(rect)) {
      S.hitMutantsRect(fx, rect, ES.dmgM, d * ES.kx, ES.ky);
      esPop(fx); return;
    }
    if (fx.owner === 'remote' && S.hitPlayerRect(fx, rect, ES.dmgP, d * ES.kx, ES.ky)) { esPop(fx); return; }
    if (typeof S.remoteTouchRect === 'function' && S.remoteTouchRect(rect, fx)) { esPop(fx); return; }
    if (fx.x < -40 || fx.x > worldW() + 40) { fx.dead = true; fx._popped = true; return; }
    if (fx.t >= fx.life - 0.02) { esPop(fx); }
  }
  function esEnd(fx) { if (!fx._popped) { burst(fx.x, fx.y, 5, ELEC_COLS, 200); } }
  function esRender(fx, ctx) {
    ctx.globalCompositeOperation = 'lighter';
    var h = fx.hist;
    if (h.length >= 4) {
      var pts = [fx.x, fx.y];
      for (var i = 0; i < h.length; i += 2) { pts.push(h[i], h[i + 1] + rnd(-7, 7)); }
      drawBolt(ctx, pts, 0.9, 'rgba(255,200,40,1)', 0.75);
    }
    gl(ctx, fx.x, fx.y, 30 * (0.9 + 0.2 * Math.random()), '#ffe14a', 0.85);
    gl(ctx, fx.x, fx.y, 12, '#ffffff', 1);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#fffbe0';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (var k = 0; k < 3; k++) {
      var a = Math.random() * TAU, l = rnd(8, 16);
      ctx.moveTo(fx.x, fx.y);
      ctx.lineTo(fx.x + Math.cos(a) * l * 0.5 + rnd(-3, 3), fx.y + Math.sin(a) * l * 0.5 + rnd(-3, 3));
      ctx.lineTo(fx.x + Math.cos(a) * l, fx.y + Math.sin(a) * l);
    }
    ctx.stroke();
  }
  S.register({
    id: 'elec_spark', element: 'electric', elementName: '전기', name: '스파크', icon: '💫', rarity: 'easy',
    cost: 10, cooldown: 0.32, color: '#ffe14a',
    desc: '번개처럼 빠른 짧은 사거리 전기탄을 쏩니다.',
    cast: function (ctx) {
      var h = handOf(ctx);
      mk('elec_spark', ctx, { x: h.x, y: h.y, dir: h.d, life: ES.life, r: ES.r, projectile: true, hist: [],
        update: esUpdate, render: esRender, end: esEnd });
    }
  });

  // ---------- K. 번개 이동 ----------
  var EB = { dist: 250, life: 0.45, h: 70, dmgP: 8, dmgM: 15, stun: 0.35, stunM: 0.7, inv: 0.25 };
  function ebRect(fx) {
    var lo = Math.min(fx.x0, fx.x1), hi = Math.max(fx.x0, fx.x1);
    return { x: lo - 10, y: fx.y - EB.h / 2, w: hi - lo + 20, h: EB.h };
  }
  function ebUpdate(fx, dt) {
    stepParts(fx, dt);
    fx.jagT -= dt;
    if (fx.jagT <= 0) {
      fx.jagT = 0.04;
      fx.pts = boltPts(fx.x0, fx.y, fx.x1, fx.y, 12, 16);
      fx.pts2 = boltPts(fx.x0, fx.y - 14, fx.x1, fx.y + 10, 9, 22);
    }
    if (fx.t > 0.12) { return; }
    var r = ebRect(fx), d = fx.dir;
    var ms = S.hitMutantsRect(fx, r, EB.dmgM, d * 160, -220);
    for (var i = 0; i < ms.length; i++) { burstOn(ms[i], 8, ELEC_COLS, 240); }
    S.statusMutantsRect(fx, r, 'stun', EB.stunM);
    if (S.hitPlayerRect(fx, r, EB.dmgP, d * 160, -220)) {
      S.statusPlayerRect(fx, r, 'stun', EB.stun);
      burstOn(localP(), 10, ELEC_COLS, 260);
    }
    remoteFx(fx, r, ELEC_COLS, 10, 0);
  }
  function ebRender(fx, ctx) {
    if (!fx.pts) { return; }
    var a = clamp(1 - fx.t / fx.life, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    drawBolt(ctx, fx.pts, a * (0.8 + 0.2 * Math.random()), 'rgba(255,200,40,1)', 1.1);
    drawBolt(ctx, fx.pts2, a * 0.5, 'rgba(140,180,255,1)', 0.6);
    // 출발점 잔상 (실루엣 글로우)
    var ox = fx.x0, oy = fx.y;
    gl(ctx, ox, oy - 4, 46, '#ffe14a', a * 0.6);
    ctx.globalAlpha = a * 0.55;
    ctx.fillStyle = 'rgba(255,235,140,1)';
    ctx.fillRect(ox - 13, oy - 31, 26, 50);
    ctx.beginPath(); ctx.arc(ox, oy - 38, 10, 0, TAU); ctx.fill();
    // 도착점 섬광
    var b = clamp(fx.t / 0.1, 0, 1);
    gl(ctx, fx.x1, fx.y, 60 * (0.6 + 0.4 * b), '#fff3a0', a * 0.9);
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(fx.x1, fx.y, 14 + 40 * b, 0, TAU); ctx.stroke();
  }
  S.register({
    id: 'elec_blink', element: 'electric', elementName: '전기', name: '번개 이동', icon: '🌩️', rarity: 'easy',
    cost: 25, cooldown: 3, color: '#ffe14a',
    desc: '번개가 되어 앞으로 순간이동합니다. 지나간 궤적에 있던 적은 감전되어 잠시 기절합니다.',
    prepare: function (c) {
      var p = c.p, d = dirOf(c.facing), w = pw(p), h = ph(p);
      var ex = clamp(p.x + d * EB.dist, 0, worldW() - w);
      if (Math.abs(ex - p.x) < 24) { return false; }   // 맵 끝: 시전 취소 (에너지 소모 없음)
      var x0 = p.x + w / 2, y = p.y + h * 0.5;
      p.x = ex;
      p.vx = d * 160;
      if (p.vy > 0) { p.vy = 0; }
      p.invulnTimer = Math.max(p.invulnTimer || 0, EB.inv);
      return { x0: ri(x0), x1: ri(ex + w / 2), ry: ri(relY(y)) };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), data = ctx.data || {}, w = pw(ctx.p);
      var x0 = num(data.x0, ctx.x + w / 2), x1 = num(data.x1, x0 + d * EB.dist);
      var y = absY(num(data.ry, relY(ctx.y + ph(ctx.p) * 0.5)));
      mk('elec_blink', ctx, { x: x1, y: y, x0: x0, x1: x1, dir: d, life: EB.life, jagT: 0, parts: [],
        update: ebUpdate, render: ebRender });
      burst(x1, y, 10, ELEC_COLS, 280);
      shakeNear({ owner: ctx.owner }, x1, 3);
    }
  });

  // ---------- I. 뇌우 ----------
  var ST = { off: 210, w: 500, form: 0.5, n: 9, every: 0.27, cloudH: 300, bw: 26, dmgP: 9, dmgM: 16, cap: 36,
    stun: 0.2, stunM: 0.5 };
  function stStrike(fx, x) {
    var top = fx.y + 18, bot = surf(x, top);
    if (bot - top < 20) { bot = top + 20; }
    var rect = { x: x - ST.bw, y: top, w: ST.bw * 2, h: bot - top };
    var ms = S.hitMutantsRect(fx, rect, ST.dmgM, 0, -220);
    for (var i = 0; i < ms.length; i++) { burstOn(ms[i], 8, ELEC_COLS, 260); }
    S.statusMutantsRect(fx, rect, 'stun', ST.stunM);
    if (fx.myDmg + ST.dmgP <= ST.cap && S.hitPlayerRect(fx, rect, ST.dmgP, 0, -240)) {
      fx.myDmg += ST.dmgP;
      S.statusPlayerRect(fx, rect, 'stun', ST.stun);
      burstOn(localP(), 10, ELEC_COLS, 280);
    }
    remoteFx(fx, rect, ELEC_COLS, 8, 0.2);
    fx.bolts.push({ x: x, top: top, bot: bot, t: 0, pts: boltPts(x + rnd(-30, 30), top, x, bot, 14, 26) });
    burst(x, bot - 4, 8, ELEC_COLS, 300);
    fx.flashT = 0.12;
    shakeNear(fx, x, 3);
  }
  function stUpdate(fx, dt) {
    fx.y = absY(fx.cy);
    if (fx.flashT > 0) { fx.flashT -= dt; }
    for (var i = fx.bolts.length - 1; i >= 0; i--) {
      var b = fx.bolts[i];
      b.t += dt;
      if (b.t > 0.3) { fx.bolts.splice(i, 1); continue; }
      if (Math.random() < 0.5) { b.pts = boltPts(b.pts[0], b.top, b.x, b.bot, 14, 26); }
    }
    while (fx.next < fx.xs.length && fx.t >= ST.form + fx.next * ST.every) {
      stStrike(fx, fx.xs[fx.next]);
      fx.next++;
    }
  }
  function stRender(fx, ctx) {
    var i;
    var k = clamp(fx.t / ST.form, 0, 1) * clamp((fx.life - fx.t) / 0.4, 0, 1);
    if (k <= 0) { return; }
    var cx = fx.x, cy = fx.y, hw = ST.w / 2;
    // 빗줄기 (결정적)
    ctx.globalAlpha = 0.35 * k;
    ctx.strokeStyle = 'rgba(170,200,255,1)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    var gB = gy();
    for (i = 0; i < 34; i++) {
      var u = ((i * 0.618034) % 1), v = ((fx.t * 2.2 + i * 0.3819) % 1);
      var rx = cx - hw * 0.9 + u * hw * 1.8, ry = cy + 20 + v * (gB - cy - 20);
      ctx.moveTo(rx, ry); ctx.lineTo(rx - 4, ry + 16);
    }
    ctx.stroke();
    // 구름 (어두운 덩어리)
    var flick = fx.flashT > 0 ? fx.flashT / 0.12 : 0;
    for (i = 0; i < fx.puffs.length; i++) {
      var p = fx.puffs[i];
      var px = cx + p.u * hw + Math.sin(fx.t * 0.9 + p.ph) * 8, py = cy + p.v * 34 + Math.cos(fx.t * 1.1 + p.ph) * 4;
      var pr = p.r * (0.6 + 0.4 * k);
      var g = ctx.createRadialGradient(px, py - pr * 0.3, pr * 0.1, px, py, pr);
      g.addColorStop(0, 'rgba(' + (88 + flick * 120 | 0) + ',' + (96 + flick * 110 | 0) + ',' + (118 + flick * 60 | 0) + ',0.95)');
      g.addColorStop(0.7, 'rgba(46,52,68,0.9)');
      g.addColorStop(1, 'rgba(30,34,46,0)');
      ctx.globalAlpha = k;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    // 구름 속 번쩍임
    for (i = 0; i < 3; i++) {
      var fu = Math.sin(fx.t * 7.3 + i * 2.1), fv = Math.cos(fx.t * 5.1 + i * 1.7);
      gl(ctx, cx + fu * hw * 0.7, cy + fv * 12, 50, '#ffe14a', k * (0.15 + 0.25 * Math.max(0, Math.sin(fx.t * 23 + i * 4))));
    }
    if (flick > 0) { gl(ctx, cx, cy, hw * 1.1, '#fff3a0', flick * 0.35); }
    // 낙뢰
    for (i = 0; i < fx.bolts.length; i++) {
      var b = fx.bolts[i], a = clamp(1 - b.t / 0.3, 0, 1);
      drawBolt(ctx, b.pts, a, 'rgba(255,200,40,1)', 1.4);
      gl(ctx, b.x, b.bot, 70, '#ffe14a', a * 0.8);
      ctx.save();
      ctx.translate(b.x, b.bot);
      ctx.scale(1, 0.25);
      gl(ctx, 0, 0, 110, '#fff3a0', a * 0.7);
      ctx.restore();
    }
  }
  S.register({
    id: 'elec_storm', element: 'electric', elementName: '전기', name: '뇌우', icon: '⛈️', rarity: 'easy',
    cost: 70, cooldown: 11, color: '#ffe14a',
    desc: '앞쪽 하늘에 뇌운을 불러 2초 넘게 낙뢰를 떨어뜨립니다. 낙뢰는 적이 있던 곳을 노립니다.',
    prepare: function (c) {
      var d = dirOf(c.facing), cx = clamp(c.x + pw(c.p) / 2 + d * ST.off, ST.w / 2, worldW() - ST.w / 2);
      var left = cx - ST.w / 2, right = cx + ST.w / 2, cand = [], i;
      var os = othersP();
      for (i = 0; i < os.length; i++) {
        var q = os[i];
        if (!isAlive(q)) { continue; }
        var qx = q.x + pw(q) / 2;
        if (qx >= left && qx <= right) { cand.push(qx); }
      }
      var ms = mutList();
      for (i = 0; i < ms.length && cand.length < 6; i++) {
        var m = ms[i];
        if (!isAlive(m)) { continue; }
        var mx = m.x + (m.w || 40) / 2;
        if (mx >= left && mx <= right) { cand.push(mx); }
      }
      var xs = [];
      for (i = 0; i < ST.n; i++) {
        var x = (i % 2 === 0 && cand.length) ? cand[(i / 2 | 0) % cand.length] + rnd(-16, 16) : left + rnd(0.06, 0.94) * ST.w;
        xs.push(ri(clamp(x, left, right)));
      }
      var feet = c.y + ph(c.p);
      return { cx: ri(cx), cy: ri(relY(Math.min(feet, gy()) - ST.cloudH)), xs: xs };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), data = ctx.data || {};
      var cx = clamp(num(data.cx, ctx.x + pw(ctx.p) / 2 + d * ST.off), 0, worldW());
      var cy = num(data.cy, relY(ctx.y + ph(ctx.p) - ST.cloudH));
      var xs = [], raw = data.xs;
      if (Object.prototype.toString.call(raw) === '[object Array]') {
        for (var i = 0; i < raw.length && xs.length < ST.n; i++) {
          if (typeof raw[i] === 'number' && isFinite(raw[i])) { xs.push(clamp(raw[i], cx - ST.w / 2, cx + ST.w / 2)); }
        }
      }
      if (!xs.length) { for (var j = 0; j < ST.n; j++) { xs.push(cx - ST.w / 2 + ((j * 0.618034) % 1) * ST.w); } }
      var puffs = [];
      for (var k = 0; k < 11; k++) {
        puffs.push({ u: -0.95 + k * 0.19 + rnd(-0.05, 0.05), v: rnd(-0.6, 0.5), r: rnd(42, 66), ph: rnd(0, TAU) });
      }
      mk('elec_storm', ctx, { x: cx, y: absY(cy), cy: cy, xs: xs, next: 0, myDmg: 0, bolts: [], flashT: 0,
        puffs: puffs, rehit: 0.2, life: ST.form + xs.length * ST.every + 0.45, update: stUpdate, render: stRender });
    }
  });

  // =====================================================================
  // 얼음 (ice) — 색: #7fd8ff
  // =====================================================================
  var ICE_COLS = ['#ffffff', '#cdf2ff', '#7fd4ff'];

  // ---------- K. 얼음 벽 ----------
  var IW = { off: 95, w: 46, h: 150, rise: 0.15, stand: 3.0, brk: 0.35, dmgP: 6, dmgM: 12, kx: 380, ky: -380 };
  function iwRect(fx) {
    var base = absY(fx.sy), k = clamp(fx.t / IW.rise, 0, 1);
    k = 1 - (1 - k) * (1 - k);
    return { x: fx.x - IW.w / 2, y: base - IW.h * k, w: IW.w, h: IW.h * k };
  }
  function iwKnock(e, dx) { return { kx: (dx < 0 ? -1 : 1) * IW.kx, ky: IW.ky }; }
  function iwPushOut(e, rect, cx) {
    if (!rectsHit(rect, boxOf(e))) { return false; }
    if (e.y + ph(e) <= rect.y + 12) { return false; }   // 위에 올라탄 경우는 통과
    var ec = e.x + pw(e) / 2;
    if (ec < cx) { e.x = rect.x - pw(e); if (e.vx > 0) { e.vx = 0; } }
    else { e.x = rect.x + rect.w; if (e.vx < 0) { e.vx = 0; } }
    return true;
  }
  function iwUpdate(fx, dt) {
    stepParts(fx, dt);
    var rect = iwRect(fx), i;
    fx.y = rect.y + rect.h / 2;
    if (fx.t < IW.rise + 0.1) {
      var ms = S.hitMutantsRect(fx, rect, IW.dmgM, iwKnock);
      for (i = 0; i < ms.length; i++) { burstOn(ms[i], 8, ICE_COLS, 220); }
      if (S.hitPlayerRect(fx, rect, IW.dmgP, iwKnock)) { burstOn(localP(), 10, ICE_COLS, 240); }
      remoteFx(fx, rect, ICE_COLS, 10, 0);
      return;
    }
    if (fx.t < IW.stand) {
      // 장벽: 시전자를 제외한 모두를 막는다 (각자 자기 몸만 — 돌연변이는 권한측)
      if (fx.owner === 'remote') {
        var lp = localP();
        if (isAlive(lp)) { iwPushOut(lp, rect, fx.x); }
      }
      if (typeof S.isAuthority === 'function' && S.isAuthority()) {
        var L = mutList();
        for (i = 0; i < L.length; i++) { if (isAlive(L[i])) { iwPushOut(L[i], rect, fx.x); } }
      }
      // 투사체 차단 (시전자 본인 것은 통과) — 모든 클라이언트가 같은 판정을 한다
      var me = attacker(fx), list = S.fx;
      for (i = 0; i < list.length; i++) {
        var f = list[i];
        if (!f || f === fx || f.dead || !f.projectile || typeof f.x !== 'number' || typeof f.y !== 'number') { continue; }
        if (attacker(f) === me) { continue; }
        var fr = +f.r || 8;
        if (f.x + fr > rect.x && f.x - fr < rect.x + rect.w && f.y + fr > rect.y && f.y - fr < rect.y + rect.h) {
          f.dead = true;
          fx.blocked = (fx.blocked || 0) + 1;
          flash(fx, f.x, f.y, 30, '#7fd8ff', '#e8fbff');
          burst(f.x, f.y, 6, ICE_COLS, 200);
        }
      }
      return;
    }
    if (!fx.broke) {
      fx.broke = true;
      for (i = 0; i < 16; i++) {
        addPart(fx, { x: fx.x + rnd(-IW.w / 2, IW.w / 2), y: rect.y + rnd(0, rect.h), vx: rnd(-220, 220), vy: rnd(-320, -40),
          g: 1100, life: rnd(0.25, 0.4), r: rnd(4, 9), a0: rnd(0, TAU), spin: rnd(-14, 14),
          c: Math.random() < 0.5 ? '#e8fbff' : '#8fd8ff' }, 20);
      }
      burst(fx.x, rect.y + rect.h / 2, 10, ICE_COLS, 260);
    }
  }
  function iwRender(fx, ctx) {
    var i;
    if (fx.broke) { drawParts(ctx, fx, '#cdf2ff', 'shard'); return; }
    var r = iwRect(fx), base = r.y + r.h;
    if (r.h < 2) { return; }
    var jag = fx.jag, x0 = r.x, x1 = r.x + r.w;
    var warn = fx.t > IW.stand - 0.6 ? (0.5 + 0.5 * Math.sin(fx.t * 30)) : 0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.save(); ctx.translate(fx.x, base); ctx.scale(1, 0.25);
    gl(ctx, 0, 0, IW.w * 1.6, '#7fd8ff', 0.6);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    var g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(225,248,255,0.92)');
    g.addColorStop(0.45, 'rgba(140,210,245,0.82)');
    g.addColorStop(1, 'rgba(60,140,210,0.88)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - 4, base);
    ctx.lineTo(x0, r.y + jag[0] * r.h);
    ctx.lineTo(x0 + r.w * 0.22, r.y + jag[1] * r.h);
    ctx.lineTo(x0 + r.w * 0.45, r.y);
    ctx.lineTo(x0 + r.w * 0.7, r.y + jag[2] * r.h);
    ctx.lineTo(x1, r.y + jag[3] * r.h);
    ctx.lineTo(x1 + 4, base);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,252,255,0.95)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // 결정면
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + r.w * 0.45, r.y); ctx.lineTo(x0 + r.w * 0.38, base);
    ctx.moveTo(x0 + r.w * 0.22, r.y + jag[1] * r.h); ctx.lineTo(x0 + r.w * 0.12, r.y + r.h * 0.6);
    ctx.moveTo(x0 + r.w * 0.7, r.y + jag[2] * r.h); ctx.lineTo(x0 + r.w * 0.8, r.y + r.h * 0.55);
    ctx.stroke();
    // 하이라이트 띠
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x0 + 5, base - 4); ctx.lineTo(x0 + 9, r.y + r.h * 0.2); ctx.lineTo(x0 + 13, r.y + r.h * 0.22); ctx.lineTo(x0 + 10, base - 4);
    ctx.closePath(); ctx.fill();
    // 금 (막은 투사체 수 + 끝나갈 때)
    var cracks = Math.min(4, (fx.blocked || 0) + (fx.t > IW.stand - 0.8 ? 2 : 0));
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = 'rgba(30,80,130,0.8)';
    ctx.lineWidth = 1.2;
    for (i = 0; i < cracks; i++) {
      var cy0 = r.y + r.h * (0.2 + i * 0.18), cxs = x0 + r.w * (0.3 + (i % 2) * 0.35);
      ctx.beginPath();
      ctx.moveTo(cxs, cy0); ctx.lineTo(cxs + 6, cy0 + 9); ctx.lineTo(cxs - 2, cy0 + 16); ctx.lineTo(cxs + 4, cy0 + 26);
      ctx.stroke();
    }
    if (warn > 0) {
      ctx.globalCompositeOperation = 'lighter';
      gl(ctx, fx.x, r.y + r.h / 2, IW.h * 0.55, '#bfefff', 0.25 * warn);
    }
    // 솟아오를 때 섬광
    if (fx.t < IW.rise + 0.15) {
      ctx.globalCompositeOperation = 'lighter';
      gl(ctx, fx.x, r.y + 10, 60, '#e8fbff', 1 - fx.t / (IW.rise + 0.15));
    }
    ctx.globalCompositeOperation = 'source-over';
    // 서리 김
    ctx.fillStyle = 'rgba(230,250,255,1)';
    for (i = 0; i < 5; i++) {
      var ph2 = (fx.t * 0.7 + i * 0.2) % 1;
      ctx.globalAlpha = 0.5 * (1 - ph2);
      ctx.beginPath(); ctx.arc(x0 + r.w * ((i * 0.37) % 1) + Math.sin(fx.t * 2 + i) * 4, r.y + 6 - ph2 * 26, 2.2, 0, TAU); ctx.fill();
    }
  }
  S.register({
    id: 'ice_wall', element: 'ice', elementName: '얼음', name: '얼음 벽', icon: '🧊', rarity: 'easy',
    cost: 30, cooldown: 6, color: '#7fd8ff',
    desc: '앞에 3초간 얼음 벽을 세웁니다. 솟을 때 적을 밀쳐 내고, 적의 이동과 투사체를 막습니다.',
    prepare: function (c) {
      var d = dirOf(c.facing), cx = c.x + pw(c.p) / 2;
      var wx = clamp(cx + d * IW.off, IW.w, worldW() - IW.w);
      return { wx: ri(wx), sy: ri(relY(surf(wx, c.y + ph(c.p)))) };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), data = ctx.data || {};
      var wx = clamp(num(data.wx, ctx.x + pw(ctx.p) / 2 + d * IW.off), IW.w, worldW() - IW.w);
      var sy = num(data.sy, relY(ctx.y + ph(ctx.p)));
      mk('ice_wall', ctx, { x: wx, y: absY(sy) - IW.h / 2, sy: sy, dir: d, life: IW.stand + IW.brk, blocked: 0, parts: [],
        jag: [rnd(0.12, 0.22), rnd(0.03, 0.1), rnd(0.05, 0.14), rnd(0.15, 0.28)], update: iwUpdate, render: iwRender });
      burst(wx, absY(sy) - 6, 10, ICE_COLS, 240);
      shakeNear({ owner: ctx.owner }, wx, 3);
    }
  });

  // ---------- L. 서리 폭발 ----------
  var IN = { charge: 0.2, expand: 0.28, r: 165, dmgP: 12, dmgM: 22, freeze: 0.8, stunM: 1.4, ky: -140 };
  function inUpdate(fx, dt) {
    stepParts(fx, dt);
    if (fx.t < IN.charge) {
      if (Math.random() < 0.8) {
        var a = rnd(0, TAU), rr = rnd(70, 130), life = rnd(0.15, 0.2);
        addPart(fx, { x: fx.x + Math.cos(a) * rr, y: fx.y + Math.sin(a) * rr, vx: -Math.cos(a) * rr / life,
          vy: -Math.sin(a) * rr / life, life: life, r: rnd(6, 10) }, 30);
      }
      return;
    }
    var e = clamp((fx.t - IN.charge) / IN.expand, 0, 1);
    if (!fx.boomed) {
      fx.boomed = true;
      shakeNear(fx, fx.x, 6);
      burst(fx.x, fx.y, 14, ICE_COLS, 420);
    }
    if (fx.t - IN.charge > IN.expand + 0.02) { return; }
    var rad = IN.r * (1 - (1 - e) * (1 - e));
    var knock = function (m, dx) { return { kx: (dx < 0 ? -1 : 1) * 120, ky: IN.ky }; };
    var ms = S.hitMutantsCircle(fx, fx.x, fx.y, rad, IN.dmgM, knock);
    for (var i = 0; i < ms.length; i++) { burstOn(ms[i], 8, ICE_COLS, 200); }
    S.statusMutantsCircle(fx, fx.x, fx.y, rad, 'stun', IN.stunM);
    if (S.hitPlayerCircle(fx, fx.x, fx.y, rad, IN.dmgP, knock)) {
      S.statusPlayerCircle(fx, fx.x, fx.y, rad + 6, 'freeze', IN.freeze);
      burstOn(localP(), 12, ICE_COLS, 240);
    }
    remoteFx(fx, circBox(fx.x, fx.y, rad), ICE_COLS, 10, 0);
  }
  // 얼어붙은 플레이어 위에 얼음 덩어리 표시
  function drawIceBlock(ctx, p, a) {
    var x = p.x - 5, y = p.y - 6, w = pw(p) + 10, h = ph(p) + 8;
    ctx.globalAlpha = 0.45 * a;
    ctx.fillStyle = 'rgba(170,225,255,1)';
    ctx.beginPath();
    ctx.moveTo(x, y + h); ctx.lineTo(x - 3, y + h * 0.3); ctx.lineTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.8, y + 4);
    ctx.lineTo(x + w + 3, y + h * 0.4); ctx.lineTo(x + w, y + h);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.85 * a;
    ctx.strokeStyle = 'rgba(240,252,255,1)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.45, y + h * 0.5); ctx.lineTo(x + w * 0.4, y + h); ctx.stroke();
  }
  function inRender(fx, ctx) {
    var i;
    ctx.globalCompositeOperation = 'lighter';
    if (fx.t < IN.charge) {
      var pr = fx.t / IN.charge;
      gl(ctx, fx.x, fx.y, 30 + 40 * pr, '#7fd8ff', 0.5 + 0.4 * pr);
      drawParts(ctx, fx, '#bfefff', 'glow');
      return;
    }
    var tt = fx.t - IN.charge, e = clamp(tt / IN.expand, 0, 1);
    var rad = IN.r * (1 - (1 - e) * (1 - e));
    var a = clamp(1 - (tt - IN.expand) / 0.35, 0, 1);
    if (a > 0) {
      var g = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, Math.max(1, rad));
      g.addColorStop(0, 'rgba(230,250,255,' + (0.5 * a) + ')');
      g.addColorStop(0.7, 'rgba(110,200,255,' + (0.35 * a) + ')');
      g.addColorStop(1, 'rgba(60,150,230,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, Math.max(1, rad), 0, TAU); ctx.fill();
      ctx.globalAlpha = a;
      ctx.strokeStyle = 'rgba(220,248,255,1)';
      ctx.lineWidth = 4 * a + 1;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, Math.max(1, rad), 0, TAU); ctx.stroke();
      // 바깥으로 뻗는 얼음 가시
      ctx.globalCompositeOperation = 'source-over';
      for (i = 0; i < fx.spk.length; i++) {
        var s = fx.spk[i], an = s.a;
        var r0 = rad * 0.55, r1 = rad * (0.95 + s.l * 0.25);
        var bx = fx.x + Math.cos(an) * r0, by = fx.y + Math.sin(an) * r0;
        var tx = fx.x + Math.cos(an) * r1, ty = fx.y + Math.sin(an) * r1;
        var nx = -Math.sin(an) * 6, ny = Math.cos(an) * 6;
        var sg = ctx.createLinearGradient(bx, by, tx, ty);
        sg.addColorStop(0, 'rgba(90,170,230,0.8)'); sg.addColorStop(1, 'rgba(240,252,255,0.95)');
        ctx.globalAlpha = a;
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.moveTo(bx + nx, by + ny); ctx.lineTo(tx, ty); ctx.lineTo(bx - nx, by - ny); ctx.closePath(); ctx.fill();
      }
    }
    // 얼어붙은 대상 표시 (시전자 제외)
    var c = typeof S.casterOf === 'function' ? S.casterOf(fx) : null;
    var all = (G.players && typeof G.players.all === 'function') ? G.players.all() : [];
    ctx.globalCompositeOperation = 'source-over';
    for (i = 0; i < all.length; i++) {
      var p = all[i];
      if (!p || p === c || !isAlive(p) || !(p.frozen > 0.05)) { continue; }
      if (!circleRect(fx.x, fx.y, IN.r + 30, p)) { continue; }
      drawIceBlock(ctx, p, clamp(p.frozen / 0.2, 0, 1));
    }
  }
  S.register({
    id: 'ice_nova', element: 'ice', elementName: '얼음', name: '서리 폭발', icon: '💠', rarity: 'easy',
    cost: 40, cooldown: 5, color: '#7fd8ff',
    desc: '냉기를 모아 주변으로 서리를 폭발시켜 닿은 적을 잠시 얼려 버립니다.',
    prepare: function (c) {
      c.p.frozen = Math.max(c.p.frozen || 0, IN.charge);
      c.p.vx = 0;
      return {};
    },
    cast: function (ctx) {
      var w = pw(ctx.p), h = ph(ctx.p), spk = [];
      for (var i = 0; i < 16; i++) { spk.push({ a: i * TAU / 16 + rnd(-0.08, 0.08), l: Math.random() }); }
      mk('ice_nova', ctx, { x: ctx.x + w / 2, y: ctx.y + h / 2, life: IN.charge + IN.expand + IN.freeze + 0.2, spk: spk,
        parts: [], update: inUpdate, render: inRender });
    }
  });

  // ---------- I. 눈보라 ----------
  var BZ = { w: 480, h: 260, life: 3.0, start: 0.3, rehit: 0.5, dmgP: 4, dmgM: 7, slow: 0.5,
    endP: 10, endM: 18, freeze: 1.0, stunM: 1.5 };
  var bzStamp = null;
  function bzRect(fx) { var base = absY(fx.sy); return { x: fx.x - BZ.w / 2, y: base - BZ.h, w: BZ.w, h: BZ.h }; }
  function bzUpdate(fx, dt) {
    var r = bzRect(fx);
    fx.y = r.y + r.h / 2;
    var lp = localP();
    fx.inside = fx.owner === 'remote' && isAlive(lp) && rectsHit(r, boxOf(lp));
    if (fx.t >= BZ.life) {
      if (!fx.ended) {
        fx.ended = true;
        mkFrom(fx, { x: fx.x, y: fx.y, sy: fx.sy, life: 0.7, sp: fx.sp || [], update: bzEndUpdate, render: bzEndRender, parts: [] });
      }
      return;
    }
    if (fx.t < BZ.start) { return; }
    S.hitMutantsRect(fx, r, BZ.dmgM, 0, 0);
    S.hitPlayerRect(fx, r, BZ.dmgP, 0, 0);
    remoteFx(fx, r, ICE_COLS, 5, BZ.rehit);
    fx.stT -= dt;
    if (fx.stT <= 0) {
      fx.stT = 0.15;
      S.statusMutantsRect(fx, r, 'slow', BZ.slow);
      S.statusPlayerRect(fx, r, 'slow', BZ.slow);
    }
  }
  function bzEndUpdate(fx, dt) {
    stepParts(fx, dt);
    if (fx.done) { return; }
    fx.done = true;
    var r = bzRect(fx);
    var ms = S.hitMutantsRect(fx, r, BZ.endM, 0, -260);
    for (var i = 0; i < ms.length; i++) { burstOn(ms[i], 8, ICE_COLS, 240); }
    S.statusMutantsRect(fx, r, 'stun', BZ.stunM);
    if (S.hitPlayerRect(fx, r, BZ.endP, 0, -260)) {
      S.statusPlayerRect(fx, r, 'freeze', BZ.freeze);
      burstOn(localP(), 14, ICE_COLS, 280);
    }
    remoteFx(fx, r, ICE_COLS, 12, 0);
    for (i = 0; i < 24; i++) {
      addPart(fx, { x: r.x + rnd(0, r.w), y: r.y + r.h - rnd(0, 60), vx: rnd(-120, 120), vy: rnd(-420, -150), g: 1000,
        life: rnd(0.35, 0.6), r: rnd(4, 9), a0: rnd(0, TAU), spin: rnd(-12, 12), c: Math.random() < 0.5 ? '#ffffff' : '#9fdcff' }, 26);
    }
    shakeNear(fx, fx.x, 7);
  }
  function bzEndRender(fx, ctx) {
    var r = bzRect(fx), base = r.y + r.h, k = clamp(fx.t / 0.12, 0, 1), a = clamp((fx.life - fx.t) / 0.35, 0, 1), i;
    ctx.globalCompositeOperation = 'lighter';
    gl(ctx, fx.x, base - 60, BZ.w * 0.55, '#bfefff', 0.5 * a * (1 - fx.t / fx.life));
    ctx.globalCompositeOperation = 'source-over';
    for (i = 0; i < fx.sp.length; i++) {
      var s = fx.sp[i], H = s.h * k * a, bx = r.x + s.u * r.w;
      if (H < 2) { continue; }
      var g = ctx.createLinearGradient(0, base - H, 0, base);
      g.addColorStop(0, 'rgba(245,253,255,0.95)'); g.addColorStop(1, 'rgba(70,150,220,0.85)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(bx - s.w, base); ctx.lineTo(bx + s.lean, base - H); ctx.lineTo(bx + s.w, base); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx, base); ctx.lineTo(bx + s.lean, base - H); ctx.stroke();
    }
    drawParts(ctx, fx, '#e8fbff', 'shard');
  }
  function bzRender(fx, ctx) {
    var r = bzRect(fx), i;
    var a = clamp(fx.t / BZ.start, 0, 1) * clamp((BZ.life + 0.15 - fx.t) / 0.4, 0, 1);
    if (a <= 0) { return; }
    var d = fx.dir;
    // 안개 덩어리
    for (i = 0; i < fx.puffs.length; i++) {
      var q = fx.puffs[i];
      var px = r.x + ((q.u * BZ.w + fx.t * q.sp * d) % BZ.w + BZ.w) % BZ.w;
      var py = r.y + BZ.h * q.v + Math.sin(fx.t * 1.7 + q.ph) * 10;
      gl(ctx, px, py, q.r, '#cdeeff', a * q.al);
    }
    // 바닥 서리
    var fg = ctx.createLinearGradient(0, r.y + r.h - 14, 0, r.y + r.h);
    fg.addColorStop(0, 'rgba(220,245,255,0)'); fg.addColorStop(1, 'rgba(220,245,255,' + (0.55 * a) + ')');
    ctx.globalAlpha = 1;
    ctx.fillStyle = fg;
    ctx.fillRect(r.x, r.y + r.h - 14, r.w, 14);
    // 바람 줄기
    ctx.strokeStyle = 'rgba(235,250,255,1)';
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.45 * a;
    ctx.beginPath();
    for (i = 0; i < 16; i++) {
      var su = ((i * 0.7548776 + fx.t * (1.6 + (i % 4) * 0.3) * d) % 1 + 1) % 1;
      var sv = (i * 0.5698403) % 1;
      var sx = r.x + su * r.w, sy2 = r.y + 10 + sv * (r.h - 20);
      ctx.moveTo(sx, sy2); ctx.lineTo(sx - d * 34, sy2 - 6);
    }
    ctx.stroke();
    // 눈송이
    ctx.fillStyle = '#ffffff';
    for (i = 0; i < 70; i++) {
      var u = ((i * 0.618034 + fx.t * (0.55 + (i % 5) * 0.12) * d) % 1 + 1) % 1;
      var v = ((i * 0.381966 + fx.t * (0.35 + (i % 3) * 0.1)) % 1 + 1) % 1;
      var fxp = r.x + u * r.w + Math.sin(fx.t * 3 + i) * 5, fyp = r.y + v * r.h;
      var sz = 1.2 + (i % 4) * 0.6;
      ctx.globalAlpha = a * (0.6 + 0.4 * ((i * 0.37) % 1));
      ctx.fillRect(fxp - sz / 2, fyp - sz / 2, sz, sz);
    }
    // 가장자리 경계선 (영역 표시)
    ctx.globalAlpha = 0.25 * a;
    ctx.strokeStyle = 'rgba(200,240,255,1)';
    ctx.lineWidth = 2;
    ctx.setLineDash && ctx.setLineDash([8, 10]);
    ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x, r.y + 30); ctx.moveTo(r.x + r.w, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + 30);
    ctx.stroke();
    ctx.setLineDash && ctx.setLineDash([]);
    // 안에 갇힌 사람 화면 서리 필터
    if (fx.inside) {
      var stamp = typeof G.time === 'number' ? G.time : null;
      if (stamp === null || stamp !== bzStamp) {
        bzStamp = stamp;
        var cam = G.camera || { x: 0, y: 0 }, W = G.width || 1280, H = G.height || 720;
        ctx.globalAlpha = 0.22 * a;
        ctx.fillStyle = 'rgb(190,230,255)';
        ctx.fillRect(cam.x - 80, cam.y - 80, W + 160, H + 160);
      }
    }
  }
  S.register({
    id: 'ice_blizzard', element: 'ice', elementName: '얼음', name: '눈보라', icon: '🌨️', rarity: 'easy',
    cost: 70, cooldown: 11, color: '#7fd8ff',
    desc: '주변에 3초간 눈보라를 일으켜 적을 느리게 하며 깎아내고, 마지막에 남은 적을 통째로 얼려 버립니다.',
    prepare: function (c) {
      var cx = clamp(c.x + pw(c.p) / 2, 0, worldW());
      return { cx: ri(cx), sy: ri(relY(surf(cx, c.y + ph(c.p)))) };
    },
    cast: function (ctx) {
      var d = dirOf(ctx.facing), data = ctx.data || {};
      var cx = clamp(num(data.cx, ctx.x + pw(ctx.p) / 2), 0, worldW());
      var sy = num(data.sy, relY(ctx.y + ph(ctx.p)));
      var puffs = [], sp = [], i;
      for (i = 0; i < 18; i++) {
        puffs.push({ u: Math.random(), v: rnd(0.1, 0.95), r: rnd(40, 70), ph: rnd(0, TAU), sp: rnd(60, 140), al: rnd(0.2, 0.38) });
      }
      for (i = 0; i < 14; i++) { sp.push({ u: (i + 0.5) / 14 + rnd(-0.02, 0.02), h: rnd(40, 95), w: rnd(8, 14), lean: rnd(-10, 10) }); }
      mk('ice_blizzard', ctx, { x: cx, y: absY(sy) - BZ.h / 2, sy: sy, dir: d, life: BZ.life + 0.15, rehit: BZ.rehit,
        stT: 0, inside: false, ended: false, puffs: puffs, sp: sp, update: bzUpdate, render: bzRender });
    }
  });

  // =====================================================================
  // 키트 선언 — G.Skills.kit 이 아직 없으면(LOADOUT 작업 전) G.pendingKits 에 보관하고 나중에 재시도
  // =====================================================================
  var KITS = [
    { element: 'water', elementName: '물', icon: '💧', ids: ['water_bubble', 'watercannon', 'water_whirlpool', 'water_tsunami'],
      meta: { color: '#3fa9ff', rarity: 'easy', desc: '물을 자유자재로 다뤄 적을 밀어내고 빨아들이며 해일로 휩쓸어 버립니다.' } },
    { element: 'grass', elementName: '풀', icon: '🌿', ids: ['grass_leaf', 'vinebind', 'grass_bloom', 'grass_thorns'],
      meta: { color: '#4fc24a', rarity: 'easy', desc: '식물을 키워 적을 묶고 꿰뚫으며, 꽃을 피워 스스로를 치유합니다.' } },
    { element: 'electric', elementName: '전기', icon: '⚡', ids: ['elec_spark', 'elec_blink', 'chainbolt', 'elec_storm'],
      meta: { color: '#ffe14a', rarity: 'easy', desc: '번개처럼 빠르게 움직이며 감전과 기절로 적을 몰아붙입니다.' } },
    { element: 'ice', elementName: '얼음', icon: '❄️', ids: ['iceshard', 'ice_wall', 'ice_nova', 'ice_blizzard'],
      meta: { color: '#7fd8ff', rarity: 'easy', desc: '냉기로 적을 느리게 하고 얼려 붙이며, 얼음 벽으로 공격을 막아 냅니다.' } }
  ];
  var pend = G.pendingKits = Array.isArray(G.pendingKits) ? G.pendingKits : [];
  for (var pk = 0; pk < KITS.length; pk++) {
    var kd = KITS[pk];
    pend.push({ element: kd.element, elementName: kd.elementName, icon: kd.icon, ids: kd.ids.slice(), meta: kd.meta,
      args: [kd.element, kd.elementName, kd.icon, kd.ids.slice(), kd.meta], from: 'skills_kit1' });
  }
  var kitsDone = false;
  function declareKits() {
    if (kitsDone) { return true; }
    var SK = G.Skills;
    if (!SK || typeof SK.kit !== 'function') { return false; }
    for (var i = 0; i < KITS.length; i++) {
      var k = KITS[i];
      try { SK.kit(k.element, k.elementName, k.icon, k.ids.slice(), k.meta); }
      catch (e) { if (typeof console !== 'undefined' && console.error) { console.error('[skills_kit1] kit ' + k.element, e); } }
    }
    kitsDone = true;
    return true;
  }
  if (!declareKits()) {
    if (G.events && typeof G.events.on === 'function') { G.events.on('matchStart', declareKits); }
    if (typeof setTimeout === 'function') {
      setTimeout(declareKits, 0);
      setTimeout(declareKits, 500);
    }
  }

  // 테스트/디버그용
  S._kit1 = { kits: KITS, declare: declareKits, nums: { WB: WB, WP: WP, TS: TS, GL: GL, GB: GB, GT: GT, ES: ES, EB: EB, ST: ST, IW: IW, IN: IN, BZ: BZ } };
})();
