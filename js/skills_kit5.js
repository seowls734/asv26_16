/* 초능력자: 각성 — 히든 능력 키트 2종 (유령 / 시간의 낫) 신규 기술 8개  v1
 * 규칙(계약 §3): 각 클라이언트는 자기 자신만 피해 (S.hitPlayer*), 돌연변이 피해는 로컬 시전 fx 만 (S.hitMutants*).
 * 돌연변이 상태이상은 권한측에서 시전 1회당 한 번 (S.statusMutants* 내부 mutAuth), 플레이어 상태이상은 원격 fx → 나.
 * 모든 fx 는 prepare() 데이터와 시전 위치·경과 시간으로 움직이는 결정적 fx (skills_kit4 와 같은 규약).
 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};
  var S = G.Skills;
  if (!S || typeof S.register !== 'function') {
    if (window.console && console.warn) console.warn('[skills_kit5] Game.Skills 가 없어 등록하지 않습니다.');
    return;
  }

  var TAU = Math.PI * 2;

  // ------------------------------------------------------------ 유틸 (skills_kit4 와 동일)
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function gy() { return S.groundY(); }
  function worldW() { return (G.world && G.world.width) || 4200; }
  function shake(a) { if (typeof G.shake === 'function') G.shake(a); }
  function burst(x, y, n, colors, speed) { if (typeof S.burst === 'function') S.burst(x, y, n, colors, speed); }
  function alive(e) { return !!e && e.alive !== false; }
  function center(e) { return { x: e.x + (e.w || 34) / 2, y: e.y + (e.h || 62) / 2 }; }
  function localP() { return (G.players && G.players.local) || null; }
  function playerById(id) { return typeof S.playerById === 'function' ? S.playerById(id) : null; }
  function findMutant(id) {
    var l = ((G.Mutants && G.Mutants.list) || []).filter(function (q) { return !(q && q.under); });
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function pw(p) { return (p && p.w) || 34; }
  function ph(p) { return (p && p.h) || 62; }
  function castCenter(ctx) { return { x: ctx.x + pw(ctx.p) / 2, y: ctx.y + ph(ctx.p) / 2 }; }
  function handOf(ctx) {
    var d = ctx.facing >= 0 ? 1 : -1;
    return { x: ctx.x + pw(ctx.p) / 2 + d * (pw(ctx.p) / 2 + 6), y: ctx.y + ph(ctx.p) * 0.42, d: d };
  }
  function mine(fx) { var lp = localP(); return fx.owner === 'local' && fx.p === lp && alive(lp) ? lp : null; }
  function casterCenter(fx) {
    var p = typeof S.casterOf === 'function' ? S.casterOf(fx) : null;
    if (p && alive(p)) { fx._cx = p.x + pw(p) / 2; fx._cy = p.y + ph(p) / 2; }
    return { x: fx._cx, y: fx._cy };
  }
  function mk(id, ctx, o) {
    o.skill = id; o.owner = ctx.owner; o.castId = ctx.castId;
    if (ctx.casterId != null) o.casterId = ctx.casterId;
    o.p = ctx.p;
    o.t = 0;
    return S.addFx(o) || o;
  }
  function child(fx, o) {
    o.skill = fx.skill; o.owner = fx.owner; o.castId = fx.castId;
    if (fx.casterId != null) o.casterId = fx.casterId;
    o.p = fx.p; o.t = 0;
    return S.addFx(o) || o;
  }
  function feetOf(ctx) {
    var d = ctx.data || {};
    var y = typeof d.ry === 'number' ? S.abs(d.ry) : ctx.y;
    return Math.min(gy(), y + ph(ctx.p));
  }
  function mutList() { return ((G.Mutants && G.Mutants.list) || []).filter(function (q) { return !(q && q.under); }); }

  // ------------------------------------------------------------ fx 파티클
  function pAdd(fx, x, y, vx, vy, life, size, col, drag, grav) {
    var L = fx.parts || (fx.parts = []);
    if (L.length >= (fx.pmax || 40)) return;
    L.push({ x: x, y: y, vx: vx, vy: vy, life: life, max: life, size: size, col: col, drag: drag || 0, grav: grav || 0 });
  }
  function pUpdate(fx, dt) {
    var L = fx.parts; if (!L) return;
    for (var i = L.length - 1; i >= 0; i--) {
      var q = L[i];
      q.life -= dt;
      if (q.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
      var d = Math.max(0, 1 - q.drag * dt);
      q.vx *= d; q.vy *= d; q.vy += q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
  }
  function pDraw(fx, ctx) {
    var L = fx.parts; if (!L || !L.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < L.length; i++) {
      var q = L[i], f = q.life / q.max;
      S.glow(ctx, q.x, q.y, q.size * (0.4 + 0.6 * f), q.col, f);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ 대상 (prepare 전용)
  function findTargets(p, facing, range, back, max) {
    var c = center(p), out = [];
    function consider(k, id, e) {
      if (!alive(e) || id == null) return;
      var ec = center(e), dx = ec.x - c.x, dy = ec.y - c.y;
      if (facing && dx * facing < -back) return;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= range) out.push({ k: k, id: id, d: d, x: ec.x, y: ec.y });
    }
    var ms = mutList();
    for (var i = 0; i < ms.length; i++) consider('m', ms[i].id, ms[i]);
    if (!G.bossMode) {
      var os = S.remotePlayers ? S.remotePlayers() : [];
      for (var j = 0; j < os.length; j++) if (os[j] && os[j] !== p) consider('p', os[j].id, os[j]);
    }
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, max || 1);
  }
  function targetEnt(k, id) {
    var e = k === 'm' ? findMutant(id) : (k === 'p' ? playerById(id) : null);
    return alive(e) ? e : null;
  }

  // ------------------------------------------------------------ 공용 직선 투사체 (kit4 와 동일)
  function projStep(fx, dt) {
    var H = fx.hist || (fx.hist = []);
    H.unshift(fx.x, fx.y);
    if (H.length > (fx.histN || 12)) H.length = fx.histN || 12;
    fx.x += Math.cos(fx.ang) * fx.speed * dt;
    fx.y += Math.sin(fx.ang) * fx.speed * dt;
    if (fx.x < -60 || fx.x > worldW() + 60 || fx.y > gy() - 2) return 'end';
    var r = fx.r, box = { x: fx.x - r, y: fx.y - r, w: r * 2, h: r * 2 };
    var dir = Math.cos(fx.ang) >= 0 ? 1 : -1;
    var kn = { kx: dir * (fx.kx || 0), ky: fx.ky || 0 };
    if (fx.owner === 'local') {
      if (S.hitMutantsCircle(fx, fx.x, fx.y, r, fx.dmgM, kn).length) return 'hit';
      if (S.remoteTouchRect(box)) return 'hit';
    } else {
      if (S.hitPlayerCircle(fx, fx.x, fx.y, r, fx.dmgP, kn)) return 'hit';
      if (S.remoteTouchRect(box, fx)) return 'hit';
      if (S.mutantsInCircle(fx.x, fx.y, r).length) return 'hit';
    }
    return null;
  }
  function fade(fx, inT, outT) { return Math.min(1, fx.t / (inT || 0.08)) * clamp((fx.life - fx.t) / (outT || 0.25), 0, 1); }
  function outward(k, ky) { return function (e, dx) { return { kx: (dx < 0 ? -1 : 1) * k, ky: ky }; }; }

  // ================================================================ 유령 (ghost)
  var GH = '#b8c8ff', GH_L = '#eef2ff', GH_V = '#c49cff', GH_D = '#5a4a9a';
  function ghostDef(o) { o.element = 'ghost'; o.elementName = '유령'; o.rarity = 'hard'; o.color = GH; return S.register(o); }

  // 작은 유령(위습): 몸통 + 꼬리 + 눈
  function drawWisp(ctx, x, y, s, a, t, dir) {
    if (a <= 0.01) return;
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, x, y, 26 * s, GH, 0.5 * a);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.translate(x, y); ctx.scale((dir || 1) * s, s);
    ctx.globalAlpha = 0.75 * a;
    var w = Math.sin(t * 12) * 3;
    ctx.fillStyle = 'rgba(225,232,255,0.9)';
    ctx.beginPath();
    ctx.arc(0, -2, 10, Math.PI, 0);
    ctx.quadraticCurveTo(10, 10, -6, 12 + w);
    ctx.quadraticCurveTo(-18, 16 - w, -26, 10 + w);
    ctx.quadraticCurveTo(-14, 8, -10, -2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(170,150,255,0.9)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.globalAlpha = 0.9 * a;
    ctx.fillStyle = '#2a2050';
    ctx.beginPath(); ctx.ellipse(2, -3, 1.8, 3, 0, 0, TAU); ctx.ellipse(6.5, -3, 1.8, 3, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4.5, 3.5, 2, 2.6, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // J 영혼 구슬 — 느리게 날아가며 가까운 적을 쫓는 위습
  var GO = { speed: 430, turn: 4.2, r: 13, dmgP: 7, dmgM: 13, slow: 0.8, life: 1.9, range: 650 };
  function orbUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.done) { if (!fx.parts || !fx.parts.length) fx.dead = true; return; }
    var e = fx.tk ? targetEnt(fx.tk, fx.tid) : null;
    if (e && fx.t > 0.12) {
      var c = center(e), want = Math.atan2(c.y - fx.y, c.x - fx.x);
      var da = want - fx.ang;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      var mx = GO.turn * dt;
      fx.ang += clamp(da, -mx, mx);
    }
    fx.speed = Math.min(GO.speed * 1.35, fx.speed + 120 * dt);
    if (Math.random() < 0.6) pAdd(fx, fx.x + rnd(-6, 6), fx.y + rnd(-6, 6), -Math.cos(fx.ang) * rnd(30, 80), rnd(-50, -10), rnd(0.3, 0.5), rnd(5, 9), Math.random() < 0.5 ? GH : GH_V, 2);
    var r = projStep(fx, dt);
    if (r === 'hit') {
      S.statusMutantsCircle(fx, fx.x, fx.y, GO.r + 8, 'slow', GO.slow);
      S.statusPlayerCircle(fx, fx.x, fx.y, GO.r + 8, 'slow', GO.slow);
    }
    if (r || fx.t > GO.life - 0.4) {
      fx.done = true; fx.life = fx.t + 0.45;
      for (var i = 0; i < 10; i++) { var a = i / 10 * TAU; pAdd(fx, fx.x, fx.y, Math.cos(a) * 170, Math.sin(a) * 170, 0.35, 8, i % 2 ? GH : GH_V, 4, -60); }
    }
  }
  function orbRender(fx, ctx) {
    if (!fx.done) {
      ctx.globalCompositeOperation = 'lighter';
      var H = fx.hist || [];
      for (var k = 0; k < H.length; k += 2) { var f = 1 - k / H.length; S.glow(ctx, H[k], H[k + 1], 12 * f + 3, GH_V, 0.35 * f); }
      drawWisp(ctx, fx.x, fx.y, 0.9, Math.min(1, fx.t / 0.1), fx.t, Math.cos(fx.ang) >= 0 ? 1 : -1);
    }
    pDraw(fx, ctx);
  }
  ghostDef({
    id: 'ghost_orb', name: '영혼 구슬', icon: '🔮', cost: 10, cooldown: 0.5,
    desc: '느리게 떠가는 영혼 구슬을 날립니다. 구슬은 가장 가까운 적을 따라가 맞히고 잠시 둔화시킵니다.',
    ai: { kind: 'proj', range: 560 },
    prepare: function (c) {
      var t = findTargets(c.p, c.facing, GO.range, 60, 1)[0];
      return t ? { tk: t.k, tid: t.id } : {};
    },
    cast: function (c) {
      var d = c.data || {}, h = handOf(c);
      mk('ghost_orb', c, { x: h.x, y: h.y - 4, ang: h.d > 0 ? -0.12 : Math.PI + 0.12, speed: GO.speed * 0.7, r: GO.r,
        dmgP: GO.dmgP, dmgM: GO.dmgM, kx: 140, ky: -80, tk: d.tk || null, tid: d.tid != null ? d.tid : null,
        life: GO.life, projectile: true, pmax: 30, histN: 16, update: orbUpdate, render: orbRender });
    }
  });

  // K 유체 이탈 — 1.8초 동안 무적 + 이동 속도 증가, 스치는 적은 한기에 둔화
  var GP = { dur: 1.8, r: 42, dmgP: 4, dmgM: 7, slow: 1.0, rehit: 0.5 };
  function phaseUpdate(fx, dt) {
    pUpdate(fx, dt);
    var p = mine(fx);
    if (p && fx.t < GP.dur) {
      p.invulnTimer = Math.max(p.invulnTimer || 0, 0.15);
      p.boostTimer = Math.max(p.boostTimer || 0, Math.min(0.2, GP.dur - fx.t));
    }
    var c = casterCenter(fx);
    if (c.x == null) return;
    var H = fx.ghosts || (fx.ghosts = []);
    fx.gt = (fx.gt || 0) + dt;
    if (fx.gt > 0.06) { fx.gt = 0; H.unshift({ x: c.x, y: c.y }); if (H.length > 6) H.length = 6; }
    if (fx.t < GP.dur) {
      S.hitMutantsCircle(fx, c.x, c.y, GP.r, GP.dmgM, 0);
      S.hitPlayerCircle(fx, c.x, c.y, GP.r, GP.dmgP, 0);
      S.statusMutantsCircle(fx, c.x, c.y, GP.r, 'slow', GP.slow);
      S.statusPlayerCircle(fx, c.x, c.y, GP.r, 'slow', GP.slow);
      if (Math.random() < 0.5) pAdd(fx, c.x + rnd(-16, 16), c.y + rnd(-28, 28), rnd(-20, 20), rnd(-70, -30), rnd(0.4, 0.7), rnd(5, 9), Math.random() < 0.5 ? GH : GH_V, 1, -40);
    }
  }
  function phaseRender(fx, ctx) {
    var c = casterCenter(fx);
    if (c.x == null) return;
    var a = Math.min(1, fx.t / 0.12) * clamp((GP.dur + 0.2 - fx.t) / 0.35, 0, 1), t = fx.t;
    var H = fx.ghosts || [];
    ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < H.length; k++) {
      var f = 1 - k / H.length;
      ctx.globalAlpha = 0.18 * f * a; ctx.fillStyle = GH;
      ctx.beginPath(); ctx.ellipse(H[k].x, H[k].y, 16, 30, 0, 0, TAU); ctx.fill();
    }
    // 반투명 유령 껍질 (몸을 감싸는 창백한 막)
    S.glow(ctx, c.x, c.y, 62 + Math.sin(t * 7) * 4, GH, 0.45 * a);
    ctx.globalAlpha = 0.35 * a;
    var g = ctx.createLinearGradient(0, c.y - 40, 0, c.y + 34);
    g.addColorStop(0, 'rgba(235,240,255,0.95)'); g.addColorStop(1, 'rgba(160,130,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y - 14, 20, Math.PI, 0);
    for (var s = 0; s <= 4; s++) ctx.lineTo(c.x + 20 - s * 10, c.y + 30 + (s % 2 ? -6 : 2) + Math.sin(t * 10 + s) * 3);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.7 * a; ctx.strokeStyle = GH_L; ctx.lineWidth = 1.5; ctx.stroke();
    // 주위를 도는 혼불 2개
    for (var i = 0; i < 2; i++) {
      var an = t * 4 + i * Math.PI;
      S.glow(ctx, c.x + Math.cos(an) * 30, c.y + Math.sin(an) * 14 - 6, 12, GH_V, 0.8 * a);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  ghostDef({
    id: 'ghost_phase', name: '유체 이탈', icon: '🌫️', cost: 20, cooldown: 6,
    desc: '1.8초 동안 몸을 벗어나 유령이 됩니다. 그동안 피해를 받지 않고 빠르게 움직이며, 스쳐 지나간 적을 한기로 둔화시킵니다.',
    ai: { kind: 'buff' },
    prepare: function (c) {
      c.p.invulnTimer = Math.max(c.p.invulnTimer || 0, 0.3);
      return {};
    },
    cast: function (c) {
      var cc = castCenter(c);
      mk('ghost_phase', c, { _cx: cc.x, _cy: cc.y, life: GP.dur + 0.25, rehit: GP.rehit, pmax: 30, update: phaseUpdate, render: phaseRender });
      burst(cc.x, cc.y, 14, [GH, GH_V, GH_L], 220);
    }
  });

  // L 빙의 — 앞의 가장 가까운 적을 꿰뚫고 지나가며 피해 + 기절
  var PS = { range: 380, min: 160, max: 440, t: 0.22, dmgP: 12, dmgM: 24, stunM: 1.4, rootP: 1.0, stunP: 0.35 };
  function possPos(fx, t) { var u = clamp(t / PS.t, 0, 1); return { u: u, x: lerp(fx.x0, fx.x1, ease(u)) }; }
  function possUpdate(fx, dt) {
    pUpdate(fx, dt);
    var pp = possPos(fx, fx.t);
    var p = mine(fx);
    if (p && !fx.released) {
      p.x = pp.x - pw(p) / 2; p.vx = 0; p.vy = Math.min(p.vy || 0, 0);
      if (pp.u >= 1) { fx.released = true; p.vx = fx.dir * 200; }
    }
    if (fx.t < PS.t + 0.03) {
      var xp = fx.xPrev != null ? fx.xPrev : fx.x0;
      fx.xPrev = pp.x;
      var xa = Math.min(xp, pp.x) - 22, xb = Math.max(xp, pp.x) + 22;
      var r = { x: xa, y: fx.fy - 70, w: xb - xa, h: 70 }, kx = fx.dir * 160, ky = -140;
      S.hitMutantsRect(fx, r, PS.dmgM, kx, ky);
      S.statusMutantsRect(fx, r, 'stun', PS.stunM);
      if (S.hitPlayerRect(fx, r, PS.dmgP, kx, ky)) {
        S.statusPlayerRect(fx, r, 'root', PS.rootP);
        S.statusPlayerRect(fx, r, 'stun', PS.stunP);
      }
      for (var i = 0; i < 2; i++) pAdd(fx, pp.x + rnd(-10, 10), fx.fy - rnd(10, 60), -fx.dir * rnd(60, 180), rnd(-60, 20), rnd(0.3, 0.5), rnd(6, 10), Math.random() < 0.5 ? GH : GH_V, 2, -40);
    }
  }
  function possRender(fx, ctx) {
    var pp = possPos(fx, fx.t), a = clamp((fx.life - fx.t) / 0.3, 0, 1), y = fx.fy - 34;
    ctx.globalCompositeOperation = 'lighter';
    var xa = fx.x0, xb = pp.x;
    var lg = ctx.createLinearGradient(xa, 0, xb, 0);
    lg.addColorStop(0, 'rgba(160,130,255,0)'); lg.addColorStop(1, 'rgba(225,232,255,' + (0.7 * a) + ')');
    ctx.globalAlpha = 1; ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(xa, y); ctx.quadraticCurveTo((xa + xb) / 2, y - 26, xb, y - 18);
    ctx.lineTo(xb, y + 18); ctx.quadraticCurveTo((xa + xb) / 2, y + 26, xa, y);
    ctx.fill();
    if (pp.u < 1) {
      S.glow(ctx, pp.x, y, 60, GH_V, 0.6 * a);
      drawWisp(ctx, pp.x, y, 1.6, a, fx.t, fx.dir);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  // 빙의된 대상 위의 유령 가면 (시각 전용)
  function maskRender(fx, ctx) {
    var e = targetEnt(fx.tk, fx.tid);
    if (!e || fx.t < PS.t * 0.8) return;
    var c = center(e), a = Math.min(1, (fx.t - PS.t * 0.8) / 0.1) * clamp((fx.life - fx.t) / 0.3, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, c.x, c.y, (e.w || 40) * 0.9 + 20, GH_V, 0.35 * a);
    for (var i = 0; i < 3; i++) {
      var an = fx.t * 3 + i / 3 * TAU;
      S.glow(ctx, c.x + Math.cos(an) * ((e.w || 40) * 0.5 + 10), e.y - 8 + Math.sin(an) * 6, 9, GH_L, 0.8 * a);
    }
    drawWisp(ctx, c.x, e.y - 22 + Math.sin(fx.t * 5) * 3, 1.1, a, fx.t, 1);
  }
  ghostDef({
    id: 'ghost_possess', name: '빙의', icon: '👤', cost: 26, cooldown: 5,
    desc: '앞에 있는 가장 가까운 적의 몸을 꿰뚫고 지나가며 빙의합니다. 꿰뚫린 적은 피해를 입고 잠시 움직이지 못합니다.',
    ai: { kind: 'dash', range: 340 },
    prepare: function (c) {
      var p = c.p, dir = c.facing >= 0 ? 1 : -1, cc = center(p);
      var t = findTargets(p, dir, PS.range, 0, 1)[0];
      var dist = t ? clamp((t.x - cc.x) * dir + 70, PS.min, PS.max) : 260;
      var ex = clamp(p.x + dir * dist, 0, worldW() - pw(p));
      p.frozen = Math.max(p.frozen || 0, PS.t); p.invulnTimer = Math.max(p.invulnTimer || 0, PS.t + 0.2);
      if (S.lockCast) S.lockCast(PS.t);
      var out = { x0: Math.round(p.x), ex: Math.round(ex), ry: Math.round(S.rel(p.y)) };
      if (t) { out.tk = t.k; out.tid = t.id; }
      return out;
    },
    cast: function (c) {
      var d = c.data || {}, w = pw(c.p), dir = c.facing >= 0 ? 1 : -1;
      var x0 = num(d.x0, c.x), ex = num(d.ex, clamp(x0 + dir * 260, 0, worldW() - w));
      var fy = feetOf(c);
      mk('ghost_possess', c, { x0: x0 + w / 2, x1: ex + w / 2, fy: fy, dir: dir, life: PS.t + 0.5, pmax: 36,
        update: possUpdate, render: possRender });
      if (d.tk) mk('ghost_possess', c, { tk: d.tk, tid: d.tid, life: PS.t + PS.stunM, render: maskRender });
      burst(x0 + w / 2, fy - 34, 10, [GH, GH_V], 220);
    }
  });

  // I 망령의 비명 — 주위에 망령의 고리를 불러내 두 번 비명을 지름 (큰 피해 + 공포: 밀려나며 둔화, 둘째 비명은 기절)
  var GW = { charge: 0.45, w2: 1.3, grow: 0.5, R: 340, R2: 260, dmg1P: 18, dmg1M: 42, dmg2P: 9, dmg2M: 20,
             slow: 2.5, stunM: 0.9, stunP: 0.6, life: 2.3, n: 10 };
  function wailWaveUpdate(fx, dt) {
    pUpdate(fx, dt);
    var k = fx.t - fx.delay;
    if (k < 0 || k > GW.grow) return;
    var R = lerp(40, fx.R, easeOut(k / GW.grow)), cx = fx.x, cy = fx.y;
    if (!fx.boom) {
      fx.boom = true;
      shake(fx.owner === 'local' ? fx.sh : fx.sh * 0.5);
      burst(cx, cy, 16, [GH, GH_V, GH_L], 380);
    }
    var kn = outward(fx.kb, -260);
    S.hitMutantsCircle(fx, cx, cy, R, fx.dmgM, kn);
    S.hitPlayerCircle(fx, cx, cy, R, fx.dmgP, kn);
    S.statusMutantsCircle(fx, cx, cy, R, fx.kind, fx.secsM);
    S.statusPlayerCircle(fx, cx, cy, R, fx.kind, fx.secsP);
  }
  function wailWaveRender(fx, ctx) {
    var k = fx.t - fx.delay;
    if (k < 0) return;
    var u = clamp(k / GW.grow, 0, 1), R = lerp(40, fx.R, easeOut(u)), a = 1 - u;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a; ctx.strokeStyle = fx.col; ctx.lineWidth = 12 * a + 2;
    ctx.beginPath();
    for (var i = 0; i <= 48; i++) {
      var an = i / 48 * TAU, rr = R + Math.sin(an * 7 + fx.t * 30) * 8 * a;
      if (i === 0) ctx.moveTo(fx.x + Math.cos(an) * rr, fx.y + Math.sin(an) * rr * 0.8);
      else ctx.lineTo(fx.x + Math.cos(an) * rr, fx.y + Math.sin(an) * rr * 0.8);
    }
    ctx.closePath(); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(fx.x, fx.y, R * 0.9, R * 0.72, 0, 0, TAU); ctx.stroke();
    S.glow(ctx, fx.x, fx.y, R * 0.6, fx.col, 0.3 * a);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  function wailUpdate(fx, dt) {
    pUpdate(fx, dt);
    var p = mine(fx);
    if (p && fx.t < GW.charge + 0.2) { p.invulnTimer = Math.max(p.invulnTimer || 0, 0.12); p.vx *= 0.7; }
    if (fx.t < GW.charge && Math.random() < 0.9) {
      var a = rnd(0, TAU);
      pAdd(fx, fx.x + Math.cos(a) * 160, fx.y + Math.sin(a) * 120, -Math.cos(a) * 300, -Math.sin(a) * 230, 0.45, rnd(6, 10), Math.random() < 0.5 ? GH : GH_V, 0);
    }
  }
  function wailRender(fx, ctx) {
    var t = fx.t, a = Math.min(1, t / 0.2) * clamp((fx.life - t) / 0.5, 0, 1);
    var x = fx.x, y = fx.y;
    // 화면 물들이기 (옅은 청보라)
    ctx.globalCompositeOperation = 'source-over';
    var tint = 0.22 * a * (t > GW.charge ? 1 : t / GW.charge);
    var rg = ctx.createRadialGradient(x, y, 60, x, y, 1100);
    rg.addColorStop(0, 'rgba(150,140,255,' + (tint * 0.6) + ')');
    rg.addColorStop(0.5, 'rgba(70,60,150,' + tint + ')');
    rg.addColorStop(1, 'rgba(30,20,70,' + (tint * 1.3) + ')');
    ctx.fillStyle = rg;
    ctx.fillRect(x - 1100, y - 1100, 2200, 2200);
    // 망령의 고리
    var spread = t < GW.charge ? lerp(40, 120, ease(t / GW.charge)) : lerp(120, 230, easeOut((t - GW.charge) / 0.8));
    for (var i = 0; i < GW.n; i++) {
      var an = i / GW.n * TAU + t * 1.6;
      var sx = x + Math.cos(an) * spread, sy = y + Math.sin(an) * spread * 0.7 - Math.sin(t * 3 + i) * 8;
      drawWisp(ctx, sx, sy, 1.15 + 0.2 * Math.sin(t * 5 + i), a, t + i, Math.cos(an + Math.PI / 2) >= 0 ? 1 : -1);
      // 비명 입 (열린 검은 타원) — 비명 순간 크게
      var scream = (t > GW.charge && t < GW.charge + 0.35) || (t > GW.w2 && t < GW.w2 + 0.35);
      if (scream) {
        ctx.globalAlpha = 0.8 * a; ctx.fillStyle = '#1a1030';
        ctx.beginPath(); ctx.ellipse(sx + 5, sy + 4, 2.6, 5, 0, 0, TAU); ctx.fill();
      }
    }
    // 중심의 거대한 해골 망령
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, x, y - 30, 120, GH_V, 0.45 * a);
    ctx.globalCompositeOperation = 'source-over';
    var rise = ease(t / GW.charge), hy = y - 60 - rise * 50;
    ctx.globalAlpha = 0.5 * a;
    var g = ctx.createLinearGradient(0, hy - 60, 0, hy + 90);
    g.addColorStop(0, 'rgba(235,240,255,0.95)'); g.addColorStop(1, 'rgba(120,90,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, hy, 48, Math.PI, 0);
    ctx.quadraticCurveTo(x + 60, hy + 60, x + 30, hy + 100);
    ctx.quadraticCurveTo(x, hy + 80, x - 30, hy + 100);
    ctx.quadraticCurveTo(x - 60, hy + 60, x - 48, hy);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.85 * a; ctx.fillStyle = '#1a1030';
    ctx.beginPath(); ctx.ellipse(x - 17, hy - 4, 8, 12, 0, 0, TAU); ctx.ellipse(x + 17, hy - 4, 8, 12, 0, 0, TAU); ctx.fill();
    var mouth = (t > GW.charge && t < GW.charge + 0.5) || (t > GW.w2 && t < GW.w2 + 0.4) ? 18 : 6;
    ctx.beginPath(); ctx.ellipse(x, hy + 30, 10, mouth, 0, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, x - 17, hy - 4, 10, GH_V, a); S.glow(ctx, x + 17, hy - 4, 10, GH_V, a);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  ghostDef({
    id: 'ghost_wail', name: '망령의 비명', icon: '👻', cost: 70, cooldown: 12,
    desc: '주위에 망령의 고리를 불러내 두 번 비명을 지릅니다. 첫 비명은 큰 피해와 함께 적을 공포에 질려 밀려나게(둔화) 하고, 두 번째 비명은 적을 얼어붙게(기절) 합니다.',
    ai: { kind: 'zone', range: 320 },
    prepare: function (c) {
      c.p.invulnTimer = Math.max(c.p.invulnTimer || 0, GW.charge + 0.2);
      if (S.lockCast) S.lockCast(GW.charge);
      return {};
    },
    cast: function (c) {
      var cc = castCenter(c);
      var f = mk('ghost_wail', c, { x: cc.x, y: cc.y, life: GW.life, pmax: 40, update: wailUpdate, render: wailRender });
      child(f, { x: cc.x, y: cc.y, delay: GW.charge, R: GW.R, dmgP: GW.dmg1P, dmgM: GW.dmg1M, kb: 420, sh: 12,
        kind: 'slow', secsM: GW.slow, secsP: GW.slow, col: GH, life: GW.charge + GW.grow + 0.3, pmax: 20,
        update: wailWaveUpdate, render: wailWaveRender });
      child(f, { x: cc.x, y: cc.y, delay: GW.w2, R: GW.R2, dmgP: GW.dmg2P, dmgM: GW.dmg2M, kb: 200, sh: 8,
        kind: 'stun', secsM: GW.stunM, secsP: GW.stunP, col: GH_V, life: GW.w2 + GW.grow + 0.3, pmax: 20,
        update: wailWaveUpdate, render: wailWaveRender });
      if (c.owner === 'local') shake(5);
    }
  });

  // ================================================================ 시간의 낫 (scythe)
  var SC = '#ffd27a', SC_L = '#fff6dc', SC_B = '#7ad0ff', SC_D = '#2a3a6a';
  function scytheDef(o) { o.element = 'scythe'; o.elementName = '시간의 낫'; o.rarity = 'hard'; o.color = SC; return S.register(o); }

  // 시간의 낫 그리기: (x,y) 손잡이 잡은 곳, dir 방향, ang 자루 각도(오른쪽 기준, 시계 방향 +), len 자루 길이
  function drawScythe(ctx, x, y, dir, ang, len, a, t) {
    if (a <= 0.01) return;
    ctx.save();
    ctx.translate(x, y); ctx.scale(dir, 1); ctx.rotate(ang);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    var L0 = -len * 0.3, L1 = len * 0.7;
    // 자루 (짙은 남색 + 금 고리)
    ctx.strokeStyle = SC_D; ctx.lineWidth = Math.max(3, len * 0.05); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(L0, 0); ctx.lineTo(L1, 0); ctx.stroke();
    ctx.strokeStyle = SC; ctx.lineWidth = Math.max(1, len * 0.015);
    ctx.beginPath(); ctx.moveTo(L0, 0); ctx.lineTo(L1, 0); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = SC;
    for (var r = 0; r < 3; r++) { var rx = lerp(L0, L1, 0.15 + r * 0.32); ctx.fillRect(rx - len * 0.012, -len * 0.035, len * 0.024, len * 0.07); }
    // 날 (금빛 초승달, 푸른 날끝)
    var bx = L1, bl = len * 0.62, bw = len * 0.42;
    var g = ctx.createLinearGradient(bx, 0, bx - bl, bw);
    g.addColorStop(0, '#fff2c0'); g.addColorStop(0.45, SC); g.addColorStop(1, '#c08a2a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(bx + len * 0.02, -len * 0.03);
    ctx.quadraticCurveTo(bx + len * 0.06, bw * 0.95, bx - bl, bw);
    ctx.quadraticCurveTo(bx - len * 0.08, bw * 0.55, bx - len * 0.02, len * 0.04);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#6a4a10'; ctx.lineWidth = 1.2; ctx.stroke();
    // 푸른 날끝 (바깥쪽 호)
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(140,220,255,0.95)'; ctx.lineWidth = Math.max(1.5, len * 0.02);
    ctx.beginPath(); ctx.moveTo(bx + len * 0.03, 0); ctx.quadraticCurveTo(bx + len * 0.07, bw * 0.97, bx - bl, bw); ctx.stroke();
    // 날 뿌리의 시계 장식
    var cr = len * 0.085;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#1a2850'; ctx.beginPath(); ctx.arc(bx, 0, cr, 0, TAU); ctx.fill();
    ctx.strokeStyle = SC; ctx.lineWidth = Math.max(1, len * 0.014); ctx.stroke();
    ctx.strokeStyle = SC_B; ctx.lineWidth = Math.max(1, len * 0.01);
    ctx.beginPath();
    ctx.moveTo(bx, 0); ctx.lineTo(bx + Math.cos(t * 6) * cr * 0.8, Math.sin(t * 6) * cr * 0.8);
    ctx.moveTo(bx, 0); ctx.lineTo(bx + Math.cos(t * 0.5) * cr * 0.5, Math.sin(t * 0.5) * cr * 0.5);
    ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, x, y, len * 0.25, SC_B, 0.2 * a);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  // 시계판
  function drawClock(ctx, x, y, R, a, t, spin) {
    if (a <= 0.01) return;
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, x, y, R * 1.25, SC_B, 0.3 * a);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.45 * a;
    var g = ctx.createRadialGradient(x, y, R * 0.1, x, y, R);
    g.addColorStop(0, 'rgba(60,110,200,0.25)'); g.addColorStop(1, 'rgba(20,40,110,0.75)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.95 * a;
    ctx.strokeStyle = SC; ctx.lineWidth = Math.max(2, R * 0.035);
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = Math.max(1, R * 0.012); ctx.strokeStyle = SC_B;
    ctx.beginPath(); ctx.arc(x, y, R * 0.86, 0, TAU); ctx.stroke();
    ctx.strokeStyle = SC_L;
    for (var i = 0; i < 12; i++) {
      var an = i / 12 * TAU - Math.PI / 2, big = i % 3 === 0;
      ctx.lineWidth = big ? Math.max(2, R * 0.03) : Math.max(1, R * 0.012);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(an) * R * (big ? 0.7 : 0.76), y + Math.sin(an) * R * (big ? 0.7 : 0.76));
      ctx.lineTo(x + Math.cos(an) * R * 0.84, y + Math.sin(an) * R * 0.84);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    var hA = t * spin * 0.12 - Math.PI / 2, mA = t * spin - Math.PI / 2;
    ctx.strokeStyle = SC; ctx.lineWidth = Math.max(2, R * 0.04);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(hA) * R * 0.45, y + Math.sin(hA) * R * 0.45); ctx.stroke();
    ctx.strokeStyle = SC_B; ctx.lineWidth = Math.max(1.5, R * 0.022);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(mA) * R * 0.72, y + Math.sin(mA) * R * 0.72); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = SC; ctx.beginPath(); ctx.arc(x, y, Math.max(3, R * 0.05), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 시전자 손 위치 (시전자를 따라감)
  function gripOf(fx) {
    var c = casterCenter(fx);
    if (c.x == null) return null;
    return { x: c.x + fx.dir * 8, y: c.y - 2 };
  }
  // 베기 궤적 (초승달 호)
  function slashArc(ctx, x, y, dir, R, a0, a1, w, a, col) {
    if (a <= 0.01 || Math.abs(a1 - a0) < 0.01) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, R, a0, a1, a1 < a0);
    ctx.arc(w * 0.3, 0, R - w, a1, a0, a1 >= a0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * a) + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, R, a0, a1, a1 < a0); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // J 낫 베기 — 앞쪽을 넓게 베어 냄
  var SL = { life: 0.36, w0: 0.05, w1: 0.17, sw: 0.18, a0: -2.1, a1: 1.0, dmgP: 9, dmgM: 16, w: 130, h: 120 };
  function slashUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.t < SL.w0 || fx.t > SL.w1) return;
    var g = gripOf(fx); if (!g) return;
    var r = { x: fx.dir > 0 ? g.x - 10 : g.x + 10 - SL.w, y: g.y - SL.h * 0.62, w: SL.w, h: SL.h }, kx = fx.dir * 360, ky = -200;
    if (S.hitMutantsRect(fx, r, SL.dmgM, kx, ky).length || S.hitPlayerRect(fx, r, SL.dmgP, kx, ky)) {
      if (!fx.sp) { fx.sp = true; for (var i = 0; i < 8; i++) pAdd(fx, r.x + r.w / 2, g.y, rnd(-200, 200), rnd(-200, 120), 0.3, rnd(5, 8), i % 2 ? SC : SC_B, 4); }
    }
  }
  function slashRender(fx, ctx) {
    var g = gripOf(fx); if (!g) return;
    var u = easeOut(clamp(fx.t / SL.sw, 0, 1)), ang = lerp(SL.a0, SL.a1, u);
    var a = clamp((fx.life - fx.t) / 0.15, 0, 1);
    var ta = clamp(1 - (fx.t - SL.sw) / 0.18, 0, 1);
    slashArc(ctx, g.x, g.y, fx.dir, 108, SL.a0 + 0.3, ang + 0.35, 26, 0.55 * ta, 'rgba(255,210,120,0.8)');
    slashArc(ctx, g.x, g.y, fx.dir, 112, SL.a0 + 0.6, ang + 0.35, 8, 0.6 * ta, 'rgba(122,208,255,0.9)');
    drawScythe(ctx, g.x, g.y, fx.dir, ang, 78, a, fx.t + 3);
    pDraw(fx, ctx);
  }
  scytheDef({
    id: 'scythe_slash', name: '낫 베기', icon: '🌙', cost: 10, cooldown: 0.45,
    desc: '시간의 낫을 크게 휘둘러 앞쪽의 적을 넓게 베어 밀쳐 냅니다.',
    ai: { kind: 'melee', range: 130 },
    cast: function (c) {
      var cc = castCenter(c), dir = c.facing >= 0 ? 1 : -1;
      mk('scythe_slash', c, { _cx: cc.x, _cy: cc.y, dir: dir, life: SL.life, pmax: 16, update: slashUpdate, render: slashRender });
    }
  });

  // K 시간 회전베기 — 몸 주위로 낫을 회전시켜 3번 벰, 맞은 적 둔화
  var SP = { life: 0.95, hitEnd: 0.82, rehit: 0.27, R: 125, dmgP: 5, dmgM: 10, slow: 0.9, spin: 3 * TAU / 0.82 };
  function spinUpdate(fx, dt) {
    pUpdate(fx, dt);
    var c = casterCenter(fx);
    if (c.x == null || fx.t > SP.hitEnd) return;
    var kn = outward(220, -160);
    S.hitMutantsCircle(fx, c.x, c.y, SP.R, SP.dmgM, kn);
    S.hitPlayerCircle(fx, c.x, c.y, SP.R, SP.dmgP, kn);
    S.statusMutantsCircle(fx, c.x, c.y, SP.R, 'slow', SP.slow);
    S.statusPlayerCircle(fx, c.x, c.y, SP.R, 'slow', SP.slow);
    if (Math.random() < 0.8) {
      var an = fx.t * SP.spin * fx.dir;
      pAdd(fx, c.x + Math.cos(an) * SP.R * 0.9, c.y + Math.sin(an) * SP.R * 0.6, -Math.sin(an) * 120, Math.cos(an) * 80, 0.3, rnd(5, 8), Math.random() < 0.5 ? SC : SC_B, 3);
    }
  }
  function spinRender(fx, ctx) {
    var c = casterCenter(fx); if (c.x == null) return;
    var a = fade(fx, 0.08, 0.2), t = fx.t, an = t * SP.spin;
    // 바닥의 시계 고리
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6 * a; ctx.strokeStyle = SC_B; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, SP.R, SP.R * 0.62, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = SC;
    for (var i = 0; i < 12; i++) {
      var ta = i / 12 * TAU;
      ctx.beginPath();
      ctx.moveTo(c.x + Math.cos(ta) * SP.R * 0.9, c.y + Math.sin(ta) * SP.R * 0.56);
      ctx.lineTo(c.x + Math.cos(ta) * SP.R, c.y + Math.sin(ta) * SP.R * 0.62);
      ctx.stroke();
    }
    // 잔상 호
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(1, 0.62);
    for (var k = 0; k < 3; k++) {
      var b = an * fx.dir - k * 0.5 * fx.dir;
      ctx.globalAlpha = (0.5 - k * 0.14) * a; ctx.strokeStyle = k ? 'rgba(122,208,255,0.9)' : 'rgba(255,220,140,0.95)'; ctx.lineWidth = 14 - k * 4;
      ctx.beginPath(); ctx.arc(0, 0, SP.R - 8, b - 1.1 * fx.dir, b, fx.dir < 0); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // 회전하는 낫 (평면으로 눌린 회전 → 각도로 표현)
    var g = { x: c.x + fx.dir * 4, y: c.y };
    var dirNow = Math.cos(an) >= 0 ? fx.dir : -fx.dir;
    drawScythe(ctx, g.x, g.y, dirNow, -0.25 + Math.sin(an) * 0.35, 92, a, t * 4);
    pDraw(fx, ctx);
  }
  scytheDef({
    id: 'scythe_spin', name: '시간 회전베기', icon: '🌀', cost: 22, cooldown: 5,
    desc: '몸 주위로 시간의 낫을 빠르게 회전시켜 주변의 적을 세 번 베고, 맞은 적의 시간을 늦춰 둔화시킵니다.',
    ai: { kind: 'zone', range: 120 },
    cast: function (c) {
      var cc = castCenter(c), dir = c.facing >= 0 ? 1 : -1;
      mk('scythe_spin', c, { _cx: cc.x, _cy: cc.y, dir: dir, rehit: SP.rehit, life: SP.life, pmax: 30, update: spinUpdate, render: spinRender });
      burst(cc.x, cc.y, 10, [SC, SC_B], 220);
    }
  });

  // L 시간 균열 — 초승달 참격을 던져, 닿은 곳(또는 끝)에 시간 균열을 엶: 열릴 때 기절, 이후 둔화
  var RF = { speed: 780, life: 0.6, r: 20, dmgP: 10, dmgM: 18, zone: 2.2, R: 95, stunM: 1.0, stunP: 0.6, slow: 0.6, openW: 0.15, dmgZP: 4, dmgZM: 8 };
  function riftZoneUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.t > fx.life - 0.25) return;
    if (fx.t < RF.openW) {
      S.hitMutantsCircle(fx, fx.x, fx.y, RF.R, RF.dmgZM, 0);
      S.hitPlayerCircle(fx, fx.x, fx.y, RF.R, RF.dmgZP, 0);
      S.statusMutantsCircle(fx, fx.x, fx.y, RF.R, 'stun', RF.stunM);
      S.statusPlayerCircle(fx, fx.x, fx.y, RF.R, 'stun', RF.stunP);
    } else {
      S.statusMutantsCircle(fx, fx.x, fx.y, RF.R, 'slow', RF.slow);
      S.statusPlayerCircle(fx, fx.x, fx.y, RF.R, 'slow', RF.slow);
    }
    if (Math.random() < 0.5) { var a = rnd(0, TAU); pAdd(fx, fx.x + Math.cos(a) * RF.R, fx.y + Math.sin(a) * RF.R * 0.8, -Math.cos(a) * 60, -Math.sin(a) * 60, 0.6, rnd(4, 7), Math.random() < 0.5 ? SC_B : SC, 0.5); }
  }
  function riftZoneRender(fx, ctx) {
    var a = fade(fx, 0.12, 0.3), t = fx.t, x = fx.x, y = fx.y;
    drawClock(ctx, x, y, RF.R * easeOut(t / 0.15), 0.55 * a, t, -9);
    // 갈라진 균열
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.9 * a; ctx.fillStyle = '#060a20';
    var hh = RF.R * 0.95 * easeOut(t / 0.12);
    ctx.beginPath();
    ctx.moveTo(x, y - hh);
    ctx.lineTo(x + 8, y - hh * 0.4); ctx.lineTo(x + 3, y); ctx.lineTo(x + 10, y + hh * 0.5); ctx.lineTo(x, y + hh);
    ctx.lineTo(x - 7, y + hh * 0.4); ctx.lineTo(x - 2, y); ctx.lineTo(x - 9, y - hh * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(140,220,255,' + a + ')'; ctx.lineWidth = 2; ctx.stroke();
    if (t < RF.openW + 0.1) S.glow(ctx, x, y, RF.R * 1.4, SC_L, 0.7 * (1 - t / (RF.openW + 0.1)));
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  function crescentUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.done) { if (!fx.parts || !fx.parts.length) fx.dead = true; return; }
    if (Math.random() < 0.7) pAdd(fx, fx.x, fx.y + rnd(-14, 14), -fx.dir * rnd(60, 140), rnd(-30, 30), 0.25, rnd(5, 8), Math.random() < 0.5 ? SC : SC_B, 3);
    var r = projStep(fx, dt);
    if (r || fx.t > RF.life) {
      fx.done = true; fx.life = fx.t + 0.35;
      child(fx, { x: fx.x, y: Math.min(fx.y, gy() - 40), life: RF.zone, pmax: 24, update: riftZoneUpdate, render: riftZoneRender });
      burst(fx.x, fx.y, 10, [SC, SC_B, SC_L], 260);
      if (fx.owner === 'local') shake(3);
    }
  }
  function crescentRender(fx, ctx) {
    if (!fx.done) {
      ctx.globalCompositeOperation = 'lighter';
      var H = fx.hist || [];
      for (var k = 0; k < H.length; k += 2) { var f = 1 - k / H.length; S.glow(ctx, H[k], H[k + 1], 22 * f + 4, SC_B, 0.3 * f); }
      S.glow(ctx, fx.x, fx.y, 44, SC, 0.5);
      ctx.save(); ctx.translate(fx.x, fx.y); ctx.scale(fx.dir, 1); ctx.rotate(Math.sin(fx.t * 20) * 0.08);
      ctx.globalAlpha = 0.95;
      var g = ctx.createLinearGradient(-10, -30, 10, 30);
      g.addColorStop(0, SC_L); g.addColorStop(0.5, SC); g.addColorStop(1, SC_B);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(-14, 0, 34, -1.2, 1.2);
      ctx.arc(-26, 0, 30, 1.05, -1.05, true);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    pDraw(fx, ctx);
  }
  function throwRender(fx, ctx) {
    var g = gripOf(fx); if (!g) return;
    var u = easeOut(clamp(fx.t / 0.16, 0, 1)), a = clamp((fx.life - fx.t) / 0.15, 0, 1);
    drawScythe(ctx, g.x, g.y, fx.dir, lerp(-1.9, 0.5, u), 76, a, fx.t + 1);
  }
  scytheDef({
    id: 'scythe_rift', name: '시간 균열', icon: '⌛', cost: 28, cooldown: 7,
    desc: '초승달 참격을 날립니다. 참격이 닿은 곳(또는 날아간 끝)에 2.2초 동안 시간 균열이 열려, 열리는 순간 적을 기절시키고 이후 안의 적을 둔화시킵니다.',
    ai: { kind: 'proj', range: 460 },
    cast: function (c) {
      var h = handOf(c), cc = castCenter(c);
      mk('scythe_rift', c, { _cx: cc.x, _cy: cc.y, dir: h.d, life: 0.32, render: throwRender });
      mk('scythe_rift', c, { x: h.x, y: h.y, dir: h.d, ang: h.d > 0 ? 0 : Math.PI, speed: RF.speed, r: RF.r,
        dmgP: RF.dmgP, dmgM: RF.dmgM, kx: 200, ky: -120, life: RF.life + 0.6, projectile: true, pmax: 24, histN: 10,
        update: crescentUpdate, render: crescentRender });
    }
  });

  // I 영겁의 수확 — 거대한 시계판이 떠오르고, 시간의 낫이 앞쪽 화면을 쓸어 벰 (큰 피해 + 기절)
  var RP = { charge: 0.6, sweep: 0.3, life: 1.9, reach: 660, back: 50, h: 300, dmgP: 24, dmgM: 55, stunM: 1.2, stunP: 1.0, len: 420 };
  function reapUpdate(fx, dt) {
    pUpdate(fx, dt);
    var p = mine(fx);
    if (p && fx.t < RP.charge + RP.sweep) { p.invulnTimer = Math.max(p.invulnTimer || 0, 0.12); p.vx *= 0.6; }
    if (fx.t < RP.charge && Math.random() < 0.9) {
      var a = rnd(0, TAU);
      pAdd(fx, fx.kx + Math.cos(a) * fx.R, fx.ky + Math.sin(a) * fx.R, -Math.cos(a) * 160, -Math.sin(a) * 160, 0.5, rnd(5, 9), Math.random() < 0.5 ? SC : SC_B, 0);
    }
    var k = fx.t - RP.charge;
    if (k >= 0 && k <= RP.sweep + 0.03) {
      if (!fx.boom) { fx.boom = true; shake(fx.owner === 'local' ? 16 : 8); }
      // 낫 끝이 지나간 부분까지 앞쪽을 차례로 벰
      var u = clamp(k / RP.sweep, 0, 1), fy = fx.fy;
      var x0 = fx.x - fx.dir * RP.back, x1 = fx.x + fx.dir * RP.reach * ease(u);
      var r = { x: Math.min(x0, x1), y: fy - RP.h, w: Math.abs(x1 - x0) + 1, h: RP.h + 10 };
      var kn = { kx: fx.dir * 420, ky: -320 };
      S.hitMutantsRect(fx, r, RP.dmgM, kn.kx, kn.ky);
      S.hitPlayerRect(fx, r, RP.dmgP, kn.kx, kn.ky);
      S.statusMutantsRect(fx, r, 'stun', RP.stunM);
      if (!fx.pst && S.statusPlayerRect(fx, r, 'stun', RP.stunP)) fx.pst = true;
      for (var i = 0; i < 3; i++) pAdd(fx, x1 + rnd(-20, 20), fy - rnd(0, RP.h), fx.dir * rnd(80, 260), rnd(-120, 60), rnd(0.3, 0.6), rnd(6, 11), Math.random() < 0.5 ? SC : SC_L, 2);
    }
  }
  function reapRender(fx, ctx) {
    var t = fx.t, a = Math.min(1, t / 0.15) * clamp((fx.life - t) / 0.45, 0, 1);
    var grow = easeOut(t / 0.4);
    // 옅은 시간의 색
    ctx.globalCompositeOperation = 'source-over';
    var tint = 0.16 * a;
    ctx.globalAlpha = 1;
    var rg = ctx.createRadialGradient(fx.kx, fx.ky, 40, fx.kx, fx.ky, 1000);
    rg.addColorStop(0, 'rgba(255,220,140,' + (tint * 0.5) + ')');
    rg.addColorStop(1, 'rgba(20,40,100,' + tint + ')');
    ctx.fillStyle = rg; ctx.fillRect(fx.kx - 1000, fx.ky - 1000, 2000, 2000);
    // 거대한 시계판 (바늘이 미친 듯이 돌다가 낫이 지나가면 멈춤)
    drawClock(ctx, fx.kx, fx.ky, fx.R * grow, 0.85 * a, Math.min(t, RP.charge + RP.sweep), 14);
    // 낫: 머리 위로 치켜들었다가 → 앞쪽으로 크게 휩씀
    var g = gripOf(fx) || { x: fx.x, y: fx.fy - 34 };
    var k = t - RP.charge, ang, len;
    if (k < 0) { ang = lerp(-0.6, -2.3, ease(t / RP.charge)); len = lerp(90, RP.len, ease(t / RP.charge)); }
    else { var u = ease(clamp(k / RP.sweep, 0, 1)); ang = lerp(-2.3, 0.9, u); len = RP.len; }
    if (k >= 0) {
      var ta = clamp(1 - (k - RP.sweep) / 0.5, 0, 1);
      var a1 = ang + 0.5;
      slashArc(ctx, g.x, g.y, fx.dir, RP.len * 1.05, -2.0, a1, 70, 0.5 * ta * a, 'rgba(255,210,120,0.85)');
      slashArc(ctx, g.x, g.y, fx.dir, RP.len * 1.08, -1.8, a1, 18, 0.7 * ta * a, 'rgba(122,208,255,0.95)');
    }
    var post = k > RP.sweep ? clamp((k - RP.sweep) / 0.6, 0, 1) : 0;
    drawScythe(ctx, g.x, g.y, fx.dir, ang, lerp(len, 90, post), a, t * 3);
    pDraw(fx, ctx);
  }
  scytheDef({
    id: 'scythe_reap', name: '영겁의 수확', icon: '🕰️', cost: 70, cooldown: 13,
    desc: '등 뒤에 거대한 시계판을 띄우고 시간의 낫을 거대하게 키워, 앞쪽 화면을 한 번에 쓸어 벱니다. 베인 적은 큰 피해를 입고 시간이 멈춘 듯 기절합니다.',
    ai: { kind: 'zone', range: 600 },
    prepare: function (c) {
      c.p.invulnTimer = Math.max(c.p.invulnTimer || 0, RP.charge + RP.sweep);
      if (S.lockCast) S.lockCast(RP.charge + 0.1);
      return { ry: Math.round(S.rel(c.p.y)) };
    },
    cast: function (c) {
      var cc = castCenter(c), dir = c.facing >= 0 ? 1 : -1, fy = feetOf(c);
      mk('scythe_reap', c, { x: cc.x, _cx: cc.x, _cy: cc.y, fy: fy, dir: dir, kx: cc.x + dir * 280, ky: fy - 210, R: 200,
        life: RP.life, pmax: 50, update: reapUpdate, render: reapRender });
      burst(cc.x, cc.y, 14, [SC, SC_B, SC_L], 260);
      if (c.owner === 'local') shake(4);
    }
  });

  // ================================================================ 키트 선언
  var KITS = [
    { element: 'ghost', elementName: '유령', icon: '👻', ids: ['ghost_orb', 'ghost_phase', 'ghost_possess', 'ghost_wail'],
      meta: { color: GH, desc: '몸을 벗어난 영혼이 되어 적을 꿰뚫고 빙의하며, 망령들의 비명으로 공포에 빠뜨립니다.', rarity: 'hard' } },
    { element: 'scythe', elementName: '시간의 낫', icon: '🌙', ids: ['scythe_slash', 'scythe_spin', 'scythe_rift', 'scythe_reap'],
      meta: { color: SC, desc: '시계탑 뒤에 숨겨져 있던 전설의 무기. 시간을 베어 적을 늦추고 멈춰 세웁니다.', rarity: 'hard' } }
  ];
  for (var ki = 0; ki < KITS.length; ki++) {
    var K = KITS[ki];
    if (typeof S.kit === 'function') {
      try { S.kit(K.element, K.elementName, K.icon, K.ids, K.meta); } catch (e) { if (window.console) console.error('[skills_kit5] kit', e); }
    } else {
      G.pendingKits = G.pendingKits || [];
      G.pendingKits.push(K);
    }
  }
})();
