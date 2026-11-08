/* 초능력자: 각성 — 히든 능력 키트 3종 (소환자 / 강철 / 쉴드) 신규 기술 12개  v6
 * 규칙(계약 §3): 각 클라이언트는 자기 자신만 피해 (S.hitPlayer*), 돌연변이 피해는 로컬 시전 fx 만 (S.hitMutants*).
 * 소환수는 모두 prepare() 데이터(대상 id·목표 x)와 시전 위치·경과 시간만으로 움직이는 결정적 fx 라
 * 모든 클라이언트에서 같은 경로로 시뮬레이션된다. (조준만 대상의 동기화 위치를 따름 — 기존 유도 기술과 동일)
 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};
  var S = G.Skills;
  if (!S || typeof S.register !== 'function') {
    if (window.console && console.warn) console.warn('[skills_kit4] Game.Skills 가 없어 등록하지 않습니다.');
    return;
  }

  var TAU = Math.PI * 2;

  // ------------------------------------------------------------ 유틸
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
  function attacker(f) { return typeof S.attackerOf === 'function' ? S.attackerOf(f) : f.casterId; }
  function mk(id, ctx, o) {
    o.skill = id; o.owner = ctx.owner; o.castId = ctx.castId;
    if (ctx.casterId != null) o.casterId = ctx.casterId;
    o.p = ctx.p;
    o.t = 0;
    return S.addFx(o) || o;
  }
  // 소환수/파편 등 하위 fx (부모의 소유·시전자·태그를 물려받음)
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
  function heal(p, n) { if (alive(p)) p.hp = Math.min(p.maxHp || 100, (+p.hp || 0) + n); }
  // 시각 전용 판정 제외 (봇 표시용 본체/피격 그림자는 돌연변이를 밀지 않음)
  function mutAuthFx(fx) {
    if (typeof S.isAuthority !== 'function' || !S.isAuthority()) return false;
    if (fx._bm) return false;
    if (fx._pov && !fx._cs) return false;
    return true;
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
      if (d <= range) out.push({ k: k, id: id, d: d, x: ec.x });
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

  // ------------------------------------------------------------ 공용 직선 투사체
  // fx: x,y,ang,speed,r,dmgP,dmgM,kx,ky → 'hit' | 'end' | null
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

  // 적 투사체 파괴 (시전자 본인 것 제외) — 모든 클라이언트가 같은 판정. test(x,y,r) → bool
  function killEnemyProj(fx, test, onKill, limit) {
    var me = attacker(fx), list = S.fx || [], n = 0;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f || f === fx || f.dead || !f.projectile || typeof f.x !== 'number' || typeof f.y !== 'number') continue;
      if (f.castId != null && f.castId === fx.castId) continue;
      var a = attacker(f);
      if (a != null && a === me) continue;
      if (!test(f.x, f.y, +f.r || 8)) continue;
      f.dead = true; n++;
      if (onKill) onKill(f);
      if (limit && n >= limit) break;
    }
    return n;
  }

  // ------------------------------------------------------------ 도형
  function hexPath(ctx, x, y, r, rot) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = rot + i / 6 * TAU;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function fade(fx, inT, outT) { return Math.min(1, fx.t / (inT || 0.08)) * clamp((fx.life - fx.t) / (outT || 0.25), 0, 1); }

  // ================================================================ 소환자 (summon)
  var SU = '#5fe6d0', SU_L = '#d2fff6', SU_V = '#9a7aff', RUST = '#d0763a', MOSS = '#7ccf52';
  function sumDef(o) { o.element = 'summon'; o.elementName = '소환자'; o.rarity = 'hard'; o.color = SU; return S.register(o); }

  // J 정찰 드론 — 머리 위에 녹슨 드론을 띄워 대상에게 3연사
  var DR = { life: 1.7, shots: [0.42, 0.78, 1.14], dmgP: 4, dmgM: 7, speed: 980, r: 7, range: 640 };
  function droneBoltUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.done) { if (!fx.parts || !fx.parts.length) fx.dead = true; return; }
    if (Math.random() < 0.5) pAdd(fx, fx.x, fx.y, rnd(-30, 30), rnd(-30, 30), 0.2, 6, SU, 3);
    var r = projStep(fx, dt);
    if (r || fx.t > 0.75) {
      fx.done = true; fx.life = fx.t + 0.4;
      for (var i = 0; i < 8; i++) { var a = i / 8 * TAU; pAdd(fx, fx.x, fx.y, Math.cos(a) * 180, Math.sin(a) * 180, 0.25, 7, i % 2 ? SU : RUST, 4); }
    }
  }
  function droneBoltRender(fx, ctx) {
    ctx.globalCompositeOperation = 'lighter';
    if (!fx.done) {
      var H = fx.hist || [];
      for (var k = 0; k < H.length; k += 2) { var f = 1 - k / H.length; S.glow(ctx, H[k], H[k + 1], 9 * f + 3, SU, 0.55 * f); }
      S.glow(ctx, fx.x, fx.y, 18, SU, 0.9);
      S.glow(ctx, fx.x, fx.y, 7, '#ffffff', 1);
    }
    ctx.globalAlpha = 1;
    pDraw(fx, ctx);
  }
  function dronePos(fx, t) {
    var u = easeOut(t / 0.3);
    return { x: lerp(fx.x0, fx.hx, u) + Math.sin(t * 5) * 5, y: lerp(fx.y0, fx.hy, u) + Math.sin(t * 7.3) * 5 };
  }
  function droneUpdate(fx, dt) {
    pUpdate(fx, dt);
    var dp = dronePos(fx, fx.t);
    fx.x = dp.x; fx.y = dp.y;
    if (Math.random() < 0.4) pAdd(fx, dp.x + rnd(-12, 12), dp.y + 10, 0, rnd(60, 120), 0.25, 5, RUST, 1);
    while (fx.shot < DR.shots.length && fx.t >= DR.shots[fx.shot]) {
      fx.shot++;
      var e = fx.tk ? targetEnt(fx.tk, fx.tid) : null, ang = fx.dir > 0 ? 0.08 : Math.PI - 0.08;
      if (e) { var c = center(e); ang = Math.atan2(c.y - dp.y, c.x - dp.x); }
      fx.aim = ang; fx.flash = 0.08;
      child(fx, { x: dp.x + Math.cos(ang) * 14, y: dp.y + Math.sin(ang) * 14, ang: ang, speed: DR.speed, r: DR.r,
        dmgP: DR.dmgP, dmgM: DR.dmgM, kx: 120, ky: -60, life: 1.3, projectile: true, pmax: 16,
        update: droneBoltUpdate, render: droneBoltRender });
    }
    if (fx.flash > 0) fx.flash -= dt;
  }
  function droneRender(fx, ctx) {
    var a = fade(fx, 0.1, 0.3), x = fx.x, y = fx.y, t = fx.t;
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, x, y, 34, SU, 0.35 * a);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 4) * 0.12);
    // 로터
    ctx.strokeStyle = 'rgba(220,240,255,0.55)'; ctx.lineWidth = 2;
    for (var s = -1; s <= 1; s += 2) {
      var w = 14 * Math.abs(Math.cos(t * 40 + s));
      ctx.beginPath(); ctx.moveTo(s * 16 - w, -11); ctx.lineTo(s * 16 + w, -11); ctx.stroke();
    }
    ctx.fillStyle = '#6b4a35'; ctx.fillRect(-18, -9, 36, 4);
    ctx.fillStyle = '#9a5a2e'; rrect(ctx, -12, -6, 24, 15, 5); ctx.fill();
    ctx.strokeStyle = '#3a2618'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#c8743a'; ctx.fillRect(-10, -4, 8, 3);
    // 눈 (조준 방향)
    var ea = fx.aim != null ? fx.aim : (fx.dir > 0 ? 0 : Math.PI);
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, x + Math.cos(ea) * 6, y + 2 + Math.sin(ea) * 3, 9, SU, a);
    if (fx.flash > 0) S.glow(ctx, x + Math.cos(ea) * 16, y + Math.sin(ea) * 16, 22, SU_L, a);
    ctx.globalAlpha = 1;
    pDraw(fx, ctx);
  }
  sumDef({
    id: 'sum_drone', name: '정찰 드론', icon: '🛸', cost: 14, cooldown: 0.8,
    desc: '머리 위에 녹슨 드론을 불러내 가장 가까운 적에게 영혼탄을 3번 쏩니다.',
    ai: { kind: 'proj', range: 600 },
    prepare: function (c) {
      var t = findTargets(c.p, c.facing, DR.range, 80, 1)[0];
      return t ? { tk: t.k, tid: t.id } : {};
    },
    cast: function (c) {
      var d = c.data || {}, cc = castCenter(c), dir = c.facing >= 0 ? 1 : -1;
      mk('sum_drone', c, { x0: cc.x, y0: cc.y - 10, hx: cc.x - dir * 18, hy: cc.y - 64, x: cc.x, y: cc.y,
        dir: dir, tk: d.tk || null, tid: d.tid != null ? d.tid : null, shot: 0, life: DR.life, pmax: 20,
        update: droneUpdate, render: droneRender });
      burst(cc.x, cc.y - 40, 8, [SU, RUST], 160);
    }
  });

  // K 영혼 늑대 — 짧게 돌진하며 영혼 늑대 3마리가 앞으로 질주
  var WF = { dash: 240, dashT: 0.2, run: 560, dur: 0.55, delays: [0, 0.07, 0.14], dmgP: 6, dmgM: 10 };
  function dashUpdate(fx, dt) {
    var p = mine(fx);
    var u = clamp(fx.t / WF.dashT, 0, 1);
    if (p && !fx.released) {
      p.x = lerp(fx.x0, fx.x1, easeOut(u)); p.vx = 0;
      if (u >= 1) { fx.released = true; p.vx = fx.dir * 260; }
    }
  }
  function wolfPos(fx, t) {
    var u = clamp((t - fx.delay) / WF.dur, 0, 1);
    return { u: u, x: lerp(fx.x0, fx.x1, easeOut(u)), y: fx.fy };
  }
  function wolfUpdate(fx, dt) {
    pUpdate(fx, dt);
    var wp = wolfPos(fx, fx.t);
    if (wp.u <= 0 || wp.u >= 1) return;
    var r = { x: wp.x - 28, y: wp.y - 44, w: 56, h: 44 }, kx = fx.dir * 300, ky = -220;
    S.hitMutantsRect(fx, r, WF.dmgM, kx, ky);
    S.hitPlayerRect(fx, r, WF.dmgP, kx, ky);
    if (Math.random() < 0.8) pAdd(fx, wp.x - fx.dir * rnd(10, 30), wp.y - rnd(8, 36), -fx.dir * rnd(40, 120), rnd(-60, 10), rnd(0.25, 0.45), rnd(6, 11), Math.random() < 0.5 ? SU : SU_V, 2, -80);
  }
  function drawWolf(ctx, x, y, dir, run, a) {
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
    var leg = Math.sin(run) * 8;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(120,250,230,0.45)';
    ctx.strokeStyle = 'rgba(220,255,250,0.9)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-30, -26); ctx.quadraticCurveTo(-46, -36, -52, -22); // 꼬리
    ctx.quadraticCurveTo(-40, -28, -28, -20);
    ctx.lineTo(-22 - leg, 0); ctx.lineTo(-16 - leg, 0); ctx.lineTo(-12, -16);
    ctx.lineTo(8, -16); ctx.lineTo(12 + leg, 0); ctx.lineTo(18 + leg, 0); ctx.lineTo(18, -18);
    ctx.lineTo(28, -24); ctx.lineTo(40, -24); ctx.lineTo(34, -32); ctx.lineTo(28, -42); ctx.lineTo(24, -34);
    ctx.quadraticCurveTo(0, -38, -30, -26);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, x + dir * 30, y - 30, 7, '#ffffff', a);
    S.glow(ctx, x, y - 20, 40, SU, 0.35 * a);
    ctx.globalCompositeOperation = 'source-over';
  }
  function wolfRender(fx, ctx) {
    var wp = wolfPos(fx, fx.t);
    if (wp.u > 0) {
      var a = Math.min(1, wp.u * 6) * clamp((1 - wp.u) * 5, 0, 1);
      if (wp.u >= 1) a = 0;
      ctx.globalCompositeOperation = 'lighter';
      for (var k = 1; k <= 3; k++) {
        var px = lerp(fx.x0, fx.x1, easeOut(clamp(wp.u - k * 0.06, 0, 1)));
        S.glow(ctx, px, wp.y - 22, 22, SU_V, 0.18 * a);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (a > 0.01) drawWolf(ctx, wp.x, wp.y, fx.dir, fx.t * 30, a);
      ctx.globalAlpha = 1;
    }
    pDraw(fx, ctx);
  }
  sumDef({
    id: 'sum_wolf', name: '영혼 늑대', icon: '🐺', cost: 22, cooldown: 4,
    desc: '앞으로 짧게 돌진하며 영혼 늑대 3마리를 풀어 앞쪽을 휩쓸게 합니다.',
    ai: { kind: 'dash', range: 520 },
    prepare: function (c) {
      var p = c.p, dir = c.facing >= 0 ? 1 : -1;
      var ex = clamp(p.x + dir * WF.dash, 0, worldW() - pw(p));
      p.invulnTimer = Math.max(p.invulnTimer || 0, 0.15);
      return { x0: Math.round(p.x), ex: Math.round(ex), ry: Math.round(S.rel(p.y)) };
    },
    cast: function (c) {
      var d = c.data || {}, dir = c.facing >= 0 ? 1 : -1, w = pw(c.p);
      var x0 = num(d.x0, c.x), ex = num(d.ex, clamp(x0 + dir * WF.dash, 0, worldW() - w));
      var fy = feetOf(c);
      mk('sum_wolf', c, { x0: x0, x1: ex, dir: dir, life: WF.dashT + 0.05, update: dashUpdate, render: function () {} });
      for (var i = 0; i < 3; i++) {
        var sx = x0 + w / 2 - dir * 20;
        var x1 = clamp(sx + dir * (WF.run + i * 30), 20, worldW() - 20);
        mk('sum_wolf', c, { x0: sx, x1: x1, fy: fy, lane: i, delay: WF.delays[i], dir: dir,
          life: WF.delays[i] + WF.dur + 0.45, pmax: 24, update: wolfUpdate, render: wolfRender });
      }
      burst(x0 + w / 2, fy - 20, 12, [SU, SU_V], 260);
    }
  });

  // L 이끼 골렘 — 땅에서 솟아 목표 지점까지 걸어가 주먹 3번
  var GL = { rise: 0.5, speed: 230, punch: 0.8, n: 3, wind: 0.26, hitW: 0.12, dmgP: 9, dmgM: 18, maxD: 520 };
  function golemX(fx, t) {
    if (t < GL.rise) return fx.sx;
    return lerp(fx.sx, fx.tx, clamp((t - GL.rise) / Math.max(0.01, fx.walkT), 0, 1));
  }
  function golemUpdate(fx, dt) {
    pUpdate(fx, dt);
    var gx = golemX(fx, fx.t), base = gy();
    fx.x = gx;
    var t0 = GL.rise + fx.walkT;
    if (fx.t < GL.rise && Math.random() < 0.7) pAdd(fx, gx + rnd(-40, 40), base - 4, rnd(-80, 80), rnd(-260, -120), 0.5, rnd(5, 9), MOSS, 1, 700);
    for (var k = 0; k < GL.n; k++) {
      var pk = t0 + k * GL.punch + GL.wind;
      if (fx.t >= pk && fx.t < pk + GL.hitW) {
        if (fx.pk !== k) { fx.pk = k; fx.hitSet = {}; burst(gx + fx.face * 70, base - 10, 10, [MOSS, '#b5e86a'], 260); if (fx.owner === 'local') shake(4); }
        var r = { x: fx.face > 0 ? gx + 14 : gx - 14 - 100, y: base - 104, w: 100, h: 104 };
        S.hitMutantsRect(fx, r, GL.dmgM, fx.face * 420, -300);
        S.hitPlayerRect(fx, r, GL.dmgP, fx.face * 420, -300);
      }
    }
  }
  function golemRender(fx, ctx) {
    var t = fx.t, base = gy(), gx = golemX(fx, t), face = fx.face;
    var rise = ease(t / GL.rise), a = clamp((fx.life - t) / 0.4, 0, 1);
    var walking = t > GL.rise && t < GL.rise + fx.walkT;
    var t0 = GL.rise + fx.walkT, arm = 0;
    if (t >= t0) {
      var lt = (t - t0) % GL.punch, k = Math.floor((t - t0) / GL.punch);
      if (k < GL.n) arm = lt < GL.wind ? -lt / GL.wind * 0.6 : (lt < GL.wind + 0.12 ? 1 : Math.max(0, 1 - (lt - GL.wind - 0.12) / 0.3));
    }
    var bob = walking ? Math.abs(Math.sin(t * 9)) * 4 : 0;
    var H = 112 * rise;
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, gx, base - H * 0.5, 80, MOSS, 0.22 * a);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.save();
    ctx.beginPath(); ctx.rect(gx - 160, base - 260, 320, 260); ctx.clip();
    ctx.translate(gx, base + (112 - H) - bob); ctx.scale(face, 1);
    var leg = walking ? Math.sin(t * 9) * 8 : 0;
    // 다리
    ctx.fillStyle = '#4c5a3a';
    rrect(ctx, -30 + leg, -40, 24, 40, 6); ctx.fill();
    rrect(ctx, 6 - leg, -40, 24, 40, 6); ctx.fill();
    // 몸통 (돌 + 이끼)
    var g = ctx.createLinearGradient(0, -112, 0, -30);
    g.addColorStop(0, '#7a8a66'); g.addColorStop(1, '#4e5a40');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-42, -40); ctx.lineTo(-48, -92); ctx.lineTo(-24, -112); ctx.lineTo(26, -110); ctx.lineTo(46, -88); ctx.lineTo(40, -40); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2c3424'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#6fbf4a';
    ctx.beginPath(); ctx.moveTo(-48, -92); ctx.quadraticCurveTo(-10, -128, 46, -88); ctx.quadraticCurveTo(10, -100, -48, -92); ctx.fill();
    ctx.fillStyle = '#5aa83c';
    for (var m = 0; m < 4; m++) { ctx.beginPath(); ctx.arc(-30 + m * 20, -96 + (m % 2) * 6, 7, 0, TAU); ctx.fill(); }
    // 팔 (앞팔 = 펀치)
    ctx.fillStyle = '#5e6c4a';
    rrect(ctx, -60, -92, 22, 52, 8); ctx.fill();
    var ax = 28 + arm * 46;
    rrect(ctx, ax, -90, 30 + arm * 8, 26, 9); ctx.fill();
    ctx.fillStyle = '#7e8e68';
    rrect(ctx, ax + 22 + arm * 8, -96, 28, 34, 9); ctx.fill();
    ctx.strokeStyle = '#2c3424'; ctx.stroke();
    ctx.restore();
    // 눈
    ctx.globalCompositeOperation = 'lighter';
    var ey = base + (112 - H) - bob - 82;
    S.glow(ctx, gx + face * 14, ey, 9, '#c8ff6a', a);
    S.glow(ctx, gx + face * 28, ey, 7, '#c8ff6a', a);
    if (arm >= 1) S.glow(ctx, gx + face * 110, base - 70, 50, MOSS, 0.6 * a);
    ctx.globalAlpha = 1;
    pDraw(fx, ctx);
  }
  sumDef({
    id: 'sum_golem', name: '이끼 골렘', icon: '🗿', cost: 30, cooldown: 7,
    desc: '땅에서 이끼 골렘을 불러냅니다. 골렘은 적이 있던 자리까지 걸어가 주먹을 3번 내리칩니다.',
    ai: { kind: 'summon', range: 520 },
    prepare: function (c) {
      var t = findTargets(c.p, c.facing, 640, 40, 1)[0];
      var cc = center(c.p), dir = c.facing >= 0 ? 1 : -1;
      var sx = cc.x + dir * 40;
      var tx = t ? t.x - dir * 60 : sx + dir * 300;
      var dd = clamp((tx - sx) * dir, 0, GL.maxD);
      return { sx: Math.round(sx), tx: Math.round(sx + dir * dd) };
    },
    cast: function (c) {
      var d = c.data || {}, dir = c.facing >= 0 ? 1 : -1, cc = castCenter(c);
      var sx = num(d.sx, cc.x + dir * 40), tx = clamp(num(d.tx, sx + dir * 300), 40, worldW() - 40);
      var walkT = Math.abs(tx - sx) / GL.speed;
      mk('sum_golem', c, { sx: sx, tx: tx, x: sx, face: dir, walkT: walkT, pk: -1, pmax: 40,
        life: GL.rise + walkT + GL.n * GL.punch + 0.4, update: golemUpdate, render: golemRender });
      burst(sx, gy() - 6, 16, [MOSS, '#6b5a3a'], 300);
    }
  });

  // I 수호 거신 — 거대한 영혼 수호자가 솟아 두 번 내려칩니다
  var GD = { rise: 0.9, s1: 1.15, s2: 2.15, win: 0.12, life: 3.1, w: 120, dmg1P: 20, dmg2P: 16, dmgM: 45 };
  function slamUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.t < fx.delay || fx.hitDone) return;
    if (!fx.boom) {
      fx.boom = true;
      shake(fx.owner === 'local' ? 14 : 8);
      burst(fx.x, gy() - 10, 22, [SU, SU_V, SU_L], 420);
      for (var i = 0; i < 18; i++) { var a = Math.PI + i / 17 * Math.PI; pAdd(fx, fx.x, gy() - 6, Math.cos(a) * rnd(200, 420), Math.sin(a) * rnd(160, 420), rnd(0.4, 0.7), rnd(8, 14), i % 2 ? SU : SU_V, 2, 600); }
    }
    var r = { x: fx.x - GD.w, y: gy() - 150, w: GD.w * 2, h: 150 };
    var kn = function (e, dx) { return { kx: (dx < 0 ? -1 : 1) * 520, ky: -460 }; };
    S.hitMutantsRect(fx, r, GD.dmgM, kn);
    S.hitPlayerRect(fx, r, fx.dmgP, kn);
    if (fx.t > fx.delay + GD.win) fx.hitDone = true;
  }
  function slamRender(fx, ctx) {
    if (fx.t < fx.delay) return;
    var k = fx.t - fx.delay, base = gy();
    ctx.globalCompositeOperation = 'lighter';
    var R = 40 + k * 520, a = clamp(1 - k / 0.6, 0, 1);
    ctx.globalAlpha = a; ctx.strokeStyle = SU_L; ctx.lineWidth = 6 * a + 1;
    ctx.beginPath(); ctx.ellipse(fx.x, base - 4, R, R * 0.18, 0, 0, TAU); ctx.stroke();
    S.glow(ctx, fx.x, base - 20, 140 * a + 20, SU, 0.6 * a);
    ctx.globalAlpha = 1;
    pDraw(fx, ctx);
  }
  function guardianFist(fx, t) {
    // 0: 어깨 위, 내려침 직전 들어올림 → 목표 x 로 하강
    var sh = { x: fx.gx + fx.dir * 50, y: gy() - 300 };
    function at(ts, tx) {
      var u = (t - (ts - 0.45)) / 0.45;
      if (u < 0) return null;
      if (u < 0.6) { var w = ease(u / 0.6); return { x: lerp(sh.x, tx, w), y: lerp(sh.y, gy() - 380, w) }; }
      if (u < 1) { var v = (u - 0.6) / 0.4; return { x: tx, y: lerp(gy() - 380, gy() - 40, v * v) }; }
      var back = clamp((t - ts) / 0.5, 0, 1);
      return { x: lerp(tx, sh.x, ease(back)), y: lerp(gy() - 40, sh.y, ease(back)) };
    }
    if (t < GD.s1 + 0.25) return at(GD.s1, fx.x1) || sh;
    return at(GD.s2, fx.x2) || sh;
  }
  function guardianUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.t < GD.rise && Math.random() < 0.8) pAdd(fx, fx.gx + rnd(-90, 90), gy() - rnd(0, 40), rnd(-30, 30), rnd(-220, -80), 0.7, rnd(10, 16), Math.random() < 0.5 ? SU : SU_V, 1, -60);
    var f = guardianFist(fx, fx.t);
    if (f && Math.random() < 0.5) pAdd(fx, f.x + rnd(-20, 20), f.y + rnd(-20, 20), rnd(-40, 40), rnd(-80, 0), 0.4, rnd(8, 12), SU_L, 2);
  }
  function guardianRender(fx, ctx) {
    var t = fx.t, base = gy(), x = fx.gx, dir = fx.dir;
    var rise = ease(t / GD.rise), a = Math.min(1, t / 0.2) * clamp((fx.life - t) / 0.5, 0, 1);
    var H = 330 * rise, top = base - H;
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, x, base - H * 0.5, 240 * rise + 20, SU, 0.3 * a);
    // 몸체 (반투명 영혼 갑주)
    ctx.globalAlpha = 0.5 * a;
    var g = ctx.createLinearGradient(0, top, 0, base);
    g.addColorStop(0, 'rgba(180,255,240,0.9)'); g.addColorStop(0.6, 'rgba(70,200,190,0.55)'); g.addColorStop(1, 'rgba(120,90,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 70, base); ctx.quadraticCurveTo(x - 100, top + H * 0.45, x - 80, top + 70);
    ctx.lineTo(x - 40, top + 40); ctx.quadraticCurveTo(x, top - 10, x + 40, top + 40);
    ctx.lineTo(x + 80, top + 70); ctx.quadraticCurveTo(x + 100, top + H * 0.45, x + 70, base);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.85 * a; ctx.strokeStyle = SU_L; ctx.lineWidth = 2.5; ctx.stroke();
    // 투구 + 볏
    ctx.globalAlpha = 0.7 * a; ctx.fillStyle = 'rgba(200,255,250,0.8)';
    ctx.beginPath(); ctx.moveTo(x - 32, top + 46); ctx.lineTo(x, top + 4); ctx.lineTo(x + 32, top + 46); ctx.lineTo(x, top + 36); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = a;
    S.glow(ctx, x - 12 + dir * 4, top + 58, 12, '#ffffff', a);
    S.glow(ctx, x + 12 + dir * 4, top + 58, 12, '#ffffff', a);
    // 팔과 주먹
    var f = guardianFist(fx, t);
    if (f && rise > 0.6) {
      var sx = x + dir * 70, sy = top + 90;
      ctx.globalAlpha = 0.6 * a; ctx.strokeStyle = 'rgba(150,255,235,0.9)'; ctx.lineWidth = 26; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + f.x) / 2, Math.min(sy, f.y) - 60, f.x, f.y); ctx.stroke();
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(240,255,255,0.9)'; ctx.stroke();
      ctx.lineCap = 'butt';
      S.glow(ctx, f.x, f.y, 70, SU, 0.8 * a);
      ctx.globalAlpha = 0.9 * a; ctx.fillStyle = 'rgba(220,255,250,0.85)';
      hexPath(ctx, f.x, f.y, 34, t * 2); ctx.fill();
      S.glow(ctx, f.x, f.y, 26, '#ffffff', a);
    }
    // 반대팔 (방패)
    ctx.globalAlpha = 0.45 * a; ctx.strokeStyle = SU_V; ctx.lineWidth = 4;
    hexPath(ctx, x - dir * 90, top + 140, 46, 0.5); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  sumDef({
    id: 'sum_guardian', name: '수호 거신', icon: '🗽', cost: 70, cooldown: 14,
    desc: '등 뒤에 거대한 영혼 수호자를 불러냅니다. 수호자는 가까운 적 두 곳을 차례로 내려쳐 크게 날려 보냅니다.',
    ai: { kind: 'summon', range: 650 },
    prepare: function (c) {
      var ts = findTargets(c.p, c.facing, 700, 120, 2), cc = center(c.p), dir = c.facing >= 0 ? 1 : -1;
      var x1 = ts[0] ? ts[0].x : cc.x + dir * 260;
      var x2 = ts[1] ? ts[1].x : x1;
      x1 = clamp(x1, cc.x - 650, cc.x + 650); x2 = clamp(x2, cc.x - 650, cc.x + 650);
      return { x1: Math.round(x1), x2: Math.round(x2) };
    },
    cast: function (c) {
      var d = c.data || {}, dir = c.facing >= 0 ? 1 : -1, cc = castCenter(c);
      var x1 = clamp(num(d.x1, cc.x + dir * 260), 30, worldW() - 30), x2 = clamp(num(d.x2, x1), 30, worldW() - 30);
      var g = mk('sum_guardian', c, { gx: clamp(cc.x - dir * 50, 60, worldW() - 60), x1: x1, x2: x2, dir: dir, life: GD.life, pmax: 50,
        update: guardianUpdate, render: guardianRender });
      child(g, { x: x1, delay: GD.s1, dmgP: GD.dmg1P, life: GD.s1 + 0.8, pmax: 24, update: slamUpdate, render: slamRender });
      child(g, { x: x2, delay: GD.s2, dmgP: GD.dmg2P, life: GD.s2 + 0.8, pmax: 24, update: slamUpdate, render: slamRender });
      if (c.owner === 'local') shake(6);
    }
  });

  // ================================================================ 강철 (steel)
  var ST = '#b8c6d4', ST_L = '#f2f6ff', ST_H = '#ffb04a', ST_B = '#7ab8ff';
  function steelDef(o) { o.element = 'steel'; o.elementName = '강철'; o.rarity = 'hard'; o.color = ST; return S.register(o); }

  // J 강철 주먹 — 로켓 주먹 발사
  var FI = { speed: 1040, life: 0.42, r: 14, dmgP: 8, dmgM: 14 };
  function fistUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.done) { if (!fx.parts || !fx.parts.length) fx.dead = true; return; }
    pAdd(fx, fx.x - fx.dir * 18, fx.y + rnd(-3, 3), -fx.dir * rnd(120, 260), rnd(-40, 40), rnd(0.15, 0.3), rnd(6, 10), Math.random() < 0.5 ? ST_H : '#ff7a2a', 3);
    var r = projStep(fx, dt);
    if (r || fx.t > FI.life) {
      fx.done = true; fx.life = fx.t + 0.45;
      for (var i = 0; i < 10; i++) { var a = rnd(0, TAU); pAdd(fx, fx.x, fx.y, Math.cos(a) * rnd(120, 300), Math.sin(a) * rnd(120, 300), 0.3, rnd(4, 7), i % 2 ? ST_H : ST_L, 3, 500); }
      if (r === 'hit') shake(fx.owner === 'local' ? 3 : 1);
    }
  }
  function fistRender(fx, ctx) {
    if (!fx.done) {
      ctx.globalCompositeOperation = 'lighter';
      var H = fx.hist || [];
      for (var k = 0; k < H.length; k += 2) { var f = 1 - k / H.length; S.glow(ctx, H[k] - fx.dir * 10, H[k + 1], 10 * f + 3, ST_H, 0.4 * f); }
      S.glow(ctx, fx.x, fx.y, 30, ST, 0.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(fx.x, fx.y); ctx.scale(fx.dir, 1);
      var g = ctx.createLinearGradient(0, -12, 0, 12);
      g.addColorStop(0, '#f4f8ff'); g.addColorStop(0.5, '#9aa8b8'); g.addColorStop(1, '#4a5666');
      ctx.fillStyle = g;
      rrect(ctx, -10, -12, 24, 24, 6); ctx.fill();
      ctx.fillStyle = '#6a7686'; ctx.fillRect(-22, -8, 13, 16);
      ctx.strokeStyle = '#2a3240'; ctx.lineWidth = 1.5;
      rrect(ctx, -10, -12, 24, 24, 6); ctx.stroke();
      ctx.beginPath(); for (var j = 0; j < 3; j++) { ctx.moveTo(6, -6 + j * 6); ctx.lineTo(14, -6 + j * 6); } ctx.stroke();
      ctx.restore();
    }
    pDraw(fx, ctx);
  }
  steelDef({
    id: 'steel_fist', name: '강철 주먹', icon: '👊', cost: 10, cooldown: 0.4,
    desc: '강철 주먹을 로켓처럼 날려 짧은 거리의 적을 강하게 밀어냅니다.',
    ai: { kind: 'proj', range: 420 },
    cast: function (c) {
      var h = handOf(c);
      mk('steel_fist', c, { x: h.x, y: h.y, dir: h.d, ang: h.d > 0 ? 0 : Math.PI, speed: FI.speed, r: FI.r,
        dmgP: FI.dmgP, dmgM: FI.dmgM, kx: 340, ky: -170, life: 1.2, projectile: true, pmax: 24,
        update: fistUpdate, render: fistRender });
    }
  });

  // K 강철 피부 — 4초 동안 받는 피해 50% 감소 (피해 직후 절반 환원)
  var SK = { dur: 4, cut: 0.5 };
  function skinUpdate(fx, dt) {
    pUpdate(fx, dt);
    var p = mine(fx);
    if (p) {
      if (fx.lastHp == null) fx.lastHp = p.hp;
      if (p.hp < fx.lastHp && p.hp > 0) {
        var back = (fx.lastHp - p.hp) * SK.cut;
        heal(p, back);
        fx.ping = 0.25;
        burst(p.x + pw(p) / 2, p.y + ph(p) * 0.4, 8, [ST_L, ST_H], 220);
      }
      fx.lastHp = p.hp;
    } else if (fx.owner === 'local' && fx.p === localP() && !alive(localP())) {
      fx.life = Math.min(fx.life, fx.t + 0.2);
    }
    if (fx.ping > 0) fx.ping -= dt;
    var c = casterCenter(fx);
    if (c.x != null && Math.random() < 0.35) pAdd(fx, c.x + rnd(-20, 20), c.y + rnd(-30, 30), rnd(-20, 20), rnd(-60, -20), 0.35, rnd(4, 7), Math.random() < 0.5 ? ST_L : ST_B, 2);
  }
  function skinRender(fx, ctx) {
    var c = casterCenter(fx);
    if (c.x == null) return;
    var a = fade(fx, 0.15, 0.4), t = fx.t;
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, c.x, c.y, 54 + Math.sin(t * 6) * 3, ST, 0.35 * a + (fx.ping > 0 ? 0.5 : 0));
    // 회전하는 강철 판
    for (var i = 0; i < 6; i++) {
      var ang = t * 2.4 + i / 6 * TAU, ox = Math.cos(ang) * 30, oy = Math.sin(ang) * 40;
      var front = Math.sin(ang) > 0;
      ctx.globalAlpha = a * (front ? 0.85 : 0.35);
      ctx.save(); ctx.translate(c.x + ox, c.y + oy); ctx.rotate(ang + Math.PI / 2);
      var g = ctx.createLinearGradient(-9, 0, 9, 0);
      g.addColorStop(0, 'rgba(90,110,130,0.9)'); g.addColorStop(0.5, 'rgba(240,248,255,0.95)'); g.addColorStop(1, 'rgba(90,110,130,0.9)');
      ctx.fillStyle = g; hexPath(ctx, 0, 0, 9, 0); ctx.fill();
      ctx.restore();
    }
    // 몸 윤곽 금속 광택
    ctx.globalAlpha = 0.5 * a; ctx.strokeStyle = ST_L; ctx.lineWidth = 2;
    var sweep = ((t * 1.6) % 1) * 80 - 40;
    rrect(ctx, c.x - 19, c.y - 33, 38, 66, 10); ctx.stroke();
    S.glow(ctx, c.x, c.y + sweep * 0.8, 22, ST_L, 0.5 * a);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  steelDef({
    id: 'steel_skin', name: '강철 피부', icon: '🛡️', cost: 24, cooldown: 9,
    desc: '4초 동안 몸을 강철로 덮어 받는 피해를 절반으로 줄입니다.',
    ai: { kind: 'buff' },
    prepare: function (c) {
      c.p.invulnTimer = Math.max(c.p.invulnTimer || 0, 0.3);
      return {};
    },
    cast: function (c) {
      var cc = castCenter(c);
      mk('steel_skin', c, { _cx: cc.x, _cy: cc.y, life: SK.dur, pmax: 30, update: skinUpdate, render: skinRender });
      burst(cc.x, cc.y, 14, [ST_L, ST], 260);
    }
  });

  // L 레일 돌진 — 자기장 레일을 타고 앞으로 고속 돌진, 부딪힌 적을 크게 튕겨냄
  var RL = { dist: 380, t: 0.28, dmgP: 13, dmgM: 24 };
  function railPos(fx, t) { var u = clamp(t / RL.t, 0, 1); return { u: u, x: lerp(fx.x0, fx.x1, ease(u)) }; }
  function railUpdate(fx, dt) {
    pUpdate(fx, dt);
    var rp = railPos(fx, fx.t);
    var p = mine(fx);
    if (p && !fx.released) {
      p.x = rp.x - pw(p) / 2; p.vx = 0; p.vy = Math.min(p.vy || 0, 0);
      if (rp.u >= 1) { fx.released = true; p.vx = fx.dir * 300; }
    }
    if (fx.t < RL.t + 0.02) {
      var r = { x: rp.x - 30, y: fx.fy - 70, w: 60, h: 70 }, kx = fx.dir * 640, ky = -300;
      S.hitMutantsRect(fx, r, RL.dmgM, kx, ky);
      S.hitPlayerRect(fx, r, RL.dmgP, kx, ky);
      for (var i = 0; i < 2; i++) pAdd(fx, rp.x - fx.dir * rnd(0, 20), fx.fy - rnd(0, 6), -fx.dir * rnd(100, 300), rnd(-260, -60), rnd(0.25, 0.45), rnd(3, 6), Math.random() < 0.6 ? ST_H : ST_L, 1, 900);
    }
  }
  function railRender(fx, ctx) {
    var rp = railPos(fx, fx.t), a = clamp((fx.life - fx.t) / 0.3, 0, 1), y = fx.fy;
    var xa = Math.min(fx.x0, fx.x1), xb = Math.max(fx.x0, fx.x1);
    ctx.globalCompositeOperation = 'lighter';
    // 레일 2줄
    ctx.globalAlpha = a; ctx.strokeStyle = ST_B; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(xa - 20, y - 2); ctx.lineTo(xb + 20, y - 2); ctx.moveTo(xa - 20, y - 66); ctx.lineTo(xb + 20, y - 66); ctx.stroke();
    // 자기장 호
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(190,225,255,0.8)';
    for (var k = 0; k < 6; k++) {
      var sx = lerp(xa, xb, k / 5);
      ctx.beginPath(); ctx.moveTo(sx, y - 2);
      for (var s = 1; s <= 5; s++) ctx.lineTo(sx + Math.sin(fx.t * 50 + k * 3 + s) * 7, y - 2 - s * 12.8);
      ctx.stroke();
    }
    if (rp.u < 1) {
      for (var j = 1; j <= 4; j++) { var px = lerp(fx.x0, fx.x1, ease(clamp(rp.u - j * 0.07, 0, 1))); S.glow(ctx, px, y - 34, 34, ST, 0.25 * a); }
      S.glow(ctx, rp.x + fx.dir * 18, y - 34, 58, ST_B, 0.7 * a);
      S.glow(ctx, rp.x + fx.dir * 26, y - 34, 24, '#ffffff', 0.9 * a);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  steelDef({
    id: 'steel_rail', name: '레일 돌진', icon: '🚄', cost: 26, cooldown: 4.5,
    desc: '자기장 레일을 깔고 순식간에 앞으로 돌진해 부딪힌 적을 크게 튕겨냅니다.',
    ai: { kind: 'dash', range: 380 },
    prepare: function (c) {
      var p = c.p, dir = c.facing >= 0 ? 1 : -1;
      var ex = clamp(p.x + dir * RL.dist, 0, worldW() - pw(p));
      p.frozen = Math.max(p.frozen || 0, RL.t); p.invulnTimer = Math.max(p.invulnTimer || 0, 0.25);
      if (S.lockCast) S.lockCast(RL.t);
      return { x0: Math.round(p.x), ex: Math.round(ex), ry: Math.round(S.rel(p.y)) };
    },
    cast: function (c) {
      var d = c.data || {}, w = pw(c.p), dir = c.facing >= 0 ? 1 : -1;
      var x0 = num(d.x0, c.x), ex = num(d.ex, clamp(x0 + dir * RL.dist, 0, worldW() - w));
      mk('steel_rail', c, { x0: x0 + w / 2, x1: ex + w / 2, fy: feetOf(c), dir: dir, life: RL.t + 0.5, pmax: 40,
        update: railUpdate, render: railRender });
      burst(x0 + w / 2, feetOf(c) - 30, 10, [ST_B, ST_L], 240);
    }
  });

  // I 철골 폭우 — 하늘에서 철골 7개가 떨어지고, 마지막에 자석 압착
  var GR = { n: 7, gap: 82, t0: 0.5, step: 0.16, fall: 0.34, dmgP: 8, dmgM: 22, pull0: 1.75, crush: 2.35, crushW: 150, crushP: 14, crushM: 34, life: 3.2 };
  var GR_ORDER = [3, 1, 5, 0, 6, 2, 4];
  function girderUpdate(fx, dt) {
    pUpdate(fx, dt);
    var k = fx.t - fx.delay;
    if (k < 0) return;
    var u = k / GR.fall, base = gy();
    if (!fx.landed) {
      // 이전 프레임 → 현재 위치까지 쓸어 담는 판정 (빠른 낙하가 판정을 건너뛰지 않게)
      var yb = u < 1 ? lerp(base - 760, base, u * u) : base;
      var yp = fx.yPrev != null ? fx.yPrev : yb;
      fx.yPrev = yb;
      var r = { x: fx.x - 22, y: yp - 170, w: 44, h: yb - yp + 170 };
      S.hitMutantsRect(fx, r, GR.dmgM, function (e, dx) { return { kx: (dx < 0 ? -1 : 1) * 220, ky: 120 }; });
      S.hitPlayerRect(fx, r, GR.dmgP, function (e, dx) { return { kx: (dx < 0 ? -1 : 1) * 220, ky: 120 }; });
      if (u < 1) return;
      fx.landed = true;
      shake(fx.owner === 'local' ? 6 : 3);
      for (var i = 0; i < 12; i++) pAdd(fx, fx.x + rnd(-8, 8), base - 2, rnd(-320, 320), rnd(-380, -120), rnd(0.3, 0.55), rnd(3, 6), Math.random() < 0.6 ? ST_H : ST_L, 1, 1100);
      burst(fx.x, base - 6, 8, ['#8a8a8a', ST], 260);
    }
  }
  function drawGirder(ctx, x, yb, len, a) {
    ctx.globalAlpha = a;
    var g = ctx.createLinearGradient(x - 18, 0, x + 18, 0);
    g.addColorStop(0, '#5a3a2a'); g.addColorStop(0.3, '#b86a3a'); g.addColorStop(0.5, '#d88a5a'); g.addColorStop(1, '#6a3a22');
    ctx.fillStyle = g;
    ctx.fillRect(x - 18, yb - len, 36, len);          // 플랜지
    ctx.fillStyle = '#4a2a1a'; ctx.fillRect(x - 5, yb - len, 10, len);   // 웨브 그림자
    ctx.strokeStyle = '#2a1810'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var y = yb - len + 14; y < yb; y += 28) { ctx.moveTo(x - 18, y); ctx.lineTo(x + 18, y + 14); }
    ctx.stroke();
    ctx.fillStyle = '#e8c090';
    for (var y2 = yb - len + 8; y2 < yb; y2 += 28) { ctx.fillRect(x - 14, y2, 3, 3); ctx.fillRect(x + 11, y2, 3, 3); }
  }
  function girderRender(fx, ctx) {
    var k = fx.t - fx.delay, base = gy();
    if (k < -0.35) return;
    if (k < 0) {
      // 낙하 예고: 바닥의 붉은 표식
      ctx.globalCompositeOperation = 'lighter';
      S.glow(ctx, fx.x, base - 4, 34, '#ff5030', 0.5 + 0.4 * Math.sin(fx.t * 40));
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      return;
    }
    var u = Math.min(1, k / GR.fall);
    var yb = lerp(base - 760, base, u * u);
    var a = clamp((fx.life - fx.t) / 0.35, 0, 1);
    ctx.globalCompositeOperation = 'source-over';
    drawGirder(ctx, fx.x, yb + (u >= 1 ? 10 : 0), 170, a);
    if (u < 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 * a; ctx.fillStyle = ST_L;
      ctx.fillRect(fx.x - 3, yb - 300, 6, 130);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  function crushUpdate(fx, dt) {
    pUpdate(fx, dt);
    var cy = gy() - 70;
    if (fx.t >= GR.pull0 && fx.t < GR.crush) {
      S.pullPlayer(fx, fx.cx, cy, 300, 1500, dt);
      S.pullMutants(fx, fx.cx, cy, 300, 1500, dt);
      if (Math.random() < 0.8) { var a = rnd(0, TAU); pAdd(fx, fx.cx + Math.cos(a) * 260, cy + Math.sin(a) * 90, -Math.cos(a) * 520, -Math.sin(a) * 180, 0.45, rnd(4, 7), ST_B, 0); }
    }
    if (fx.t >= GR.crush && fx.t < GR.crush + 0.12) {
      if (!fx.boom) { fx.boom = true; shake(fx.owner === 'local' ? 16 : 8); burst(fx.cx, gy() - 8, 26, [ST_H, ST_L, ST], 460); }
      var r = { x: fx.cx - GR.crushW, y: gy() - 90, w: GR.crushW * 2, h: 90 };
      S.hitMutantsRect(fx, r, GR.crushM, function (e, dx) { return { kx: (dx < 0 ? -1 : 1) * 380, ky: -420 }; });
      S.hitPlayerRect(fx, r, GR.crushP, function (e, dx) { return { kx: (dx < 0 ? -1 : 1) * 380, ky: -420 }; });
    }
  }
  function crushRender(fx, ctx) {
    var t = fx.t, base = gy(), cx = fx.cx;
    ctx.globalCompositeOperation = 'lighter';
    if (t >= GR.pull0 - 0.3 && t < GR.crush) {
      // 상공의 전자석
      var my = base - 300 + Math.max(0, t - GR.pull0) * 40;
      S.glow(ctx, cx, my, 120, ST_B, 0.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#4a5666'; rrect(ctx, cx - 70, my - 22, 140, 44, 10); ctx.fill();
      ctx.fillStyle = '#c84030'; ctx.fillRect(cx - 70, my + 12, 30, 14); ctx.fillStyle = '#3a6ad0'; ctx.fillRect(cx + 40, my + 12, 30, 14);
      ctx.strokeStyle = ST_L; ctx.lineWidth = 2; rrect(ctx, cx - 70, my - 22, 140, 44, 10); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(160,210,255,0.6)'; ctx.lineWidth = 2;
      for (var i = 0; i < 4; i++) {
        var rr = ((t * 2 + i / 4) % 1);
        ctx.globalAlpha = 1 - rr;
        ctx.beginPath(); ctx.ellipse(cx, base - 70, 300 * (1 - rr) + 20, 90 * (1 - rr) + 8, 0, 0, TAU); ctx.stroke();
      }
    }
    if (t >= GR.crush - 0.18) {
      // 거대 I빔 낙하
      var k = clamp((t - (GR.crush - 0.18)) / 0.18, 0, 1), a = clamp((fx.life - t) / 0.4, 0, 1);
      var yb = lerp(base - 420, base, k * k);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a;
      var g = ctx.createLinearGradient(0, yb - 46, 0, yb);
      g.addColorStop(0, '#d0d8e2'); g.addColorStop(0.5, '#7a8696'); g.addColorStop(1, '#3a4452');
      ctx.fillStyle = g;
      ctx.fillRect(cx - GR.crushW, yb - 46, GR.crushW * 2, 12); ctx.fillRect(cx - GR.crushW, yb - 12, GR.crushW * 2, 12);
      ctx.fillRect(cx - GR.crushW, yb - 34, GR.crushW * 2, 22);
      ctx.strokeStyle = '#1e2430'; ctx.lineWidth = 2; ctx.strokeRect(cx - GR.crushW, yb - 46, GR.crushW * 2, 46);
      if (k >= 1) {
        ctx.globalCompositeOperation = 'lighter';
        S.glow(ctx, cx, base - 10, 200 * a, ST_H, 0.6 * a);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  steelDef({
    id: 'steel_girder', name: '철골 폭우', icon: '🏗️', cost: 70, cooldown: 13,
    desc: '적이 있는 곳에 철골 7개를 쏟아붓고, 전자석으로 끌어모은 뒤 거대한 강철 빔으로 짓누릅니다.',
    ai: { kind: 'zone', range: 450 },
    prepare: function (c) {
      var t = findTargets(c.p, c.facing, 720, 120, 1)[0], cc = center(c.p), dir = c.facing >= 0 ? 1 : -1;
      return { cx: Math.round(t ? t.x : cc.x + dir * 320) };
    },
    cast: function (c) {
      var d = c.data || {}, dir = c.facing >= 0 ? 1 : -1, cc = castCenter(c);
      var cx = clamp(num(d.cx, cc.x + dir * 320), 160, worldW() - 160);
      var main = mk('steel_girder', c, { cx: cx, life: GR.life, pmax: 40, update: crushUpdate, render: crushRender });
      for (var i = 0; i < GR.n; i++) {
        var slot = GR_ORDER[i];
        child(main, { x: cx + (slot - 3) * GR.gap, delay: GR.t0 + i * GR.step, life: GR.t0 + i * GR.step + GR.fall + 1.3 - i * 0.05,
          pmax: 14, update: girderUpdate, render: girderRender });
      }
    }
  });

  // ================================================================ 쉴드 (shield)
  var SH = '#ffd35a', SH_L = '#fff4c8', SH_B = '#6ad8ff';
  function shieldDef(o) { o.element = 'shield'; o.elementName = '쉴드'; o.rarity = 'hard'; o.color = SH; return S.register(o); }
  function spark(fx, x, y) {
    for (var i = 0; i < 8; i++) { var a = rnd(0, TAU); pAdd(fx, x, y, Math.cos(a) * rnd(100, 260), Math.sin(a) * rnd(100, 260), 0.3, rnd(5, 9), i % 2 ? SH : SH_L, 4); }
  }
  function drawHexWall(ctx, x, y0, h, w, a, t, col) {
    var rows = Math.ceil(h / 22);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    for (var i = 0; i < rows; i++) {
      var y = y0 + 11 + i * 22, off = (i % 2) * 6;
      ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(t * 6 - i * 0.7));
      hexPath(ctx, x - w / 4 + off, y, 9, 0.5); ctx.stroke();
      hexPath(ctx, x + w / 4 + off - 6, y, 9, 0.5); ctx.stroke();
    }
  }

  // J 방패 강타 — 앞쪽을 방패로 후려침 (적 투사체도 부숨)
  var BS = { w0: 0.04, w1: 0.16, life: 0.4, dmgP: 9, dmgM: 15 };
  function bashRect(fx) { return { x: fx.dir > 0 ? fx.x + 4 : fx.x - 4 - 80, y: fx.y - 42, w: 80, h: 84 }; }
  function bashUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.t < BS.w0 || fx.t > BS.w1) return;
    var r = bashRect(fx), kx = fx.dir * 460, ky = -220;
    if (S.hitMutantsRect(fx, r, BS.dmgM, kx, ky).length && !fx.sp) { fx.sp = true; spark(fx, r.x + r.w / 2, fx.y); }
    if (S.hitPlayerRect(fx, r, BS.dmgP, kx, ky) && !fx.sp) { fx.sp = true; spark(fx, r.x + r.w / 2, fx.y); }
    killEnemyProj(fx, function (x, y, rr) { return x + rr > r.x && x - rr < r.x + r.w && y + rr > r.y && y - rr < r.y + r.h; },
      function (f) { spark(fx, f.x, f.y); });
  }
  function bashRender(fx, ctx) {
    var u = clamp(fx.t / BS.w1, 0, 1), a = clamp((fx.life - fx.t) / 0.2, 0, 1);
    var x = fx.x + fx.dir * (10 + 46 * easeOut(u)), y = fx.y;
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, x, y, 60, SH, 0.5 * a);
    ctx.globalAlpha = a;
    ctx.save(); ctx.translate(x, y); ctx.scale(fx.dir, 1);
    // 앞쪽 충격 호
    ctx.strokeStyle = SH_L; ctx.lineWidth = 4 * a + 1;
    ctx.beginPath(); ctx.arc(-10, 0, 46 + u * 12, -1.0, 1.0); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    var g = ctx.createLinearGradient(0, -36, 0, 36);
    g.addColorStop(0, 'rgba(255,240,170,0.95)'); g.addColorStop(1, 'rgba(200,140,30,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-6, -36); ctx.lineTo(12, -30); ctx.lineTo(14, 18); ctx.lineTo(0, 38); ctx.lineTo(-10, 18); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7a5210'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#4fae5c'; ctx.beginPath(); ctx.moveTo(2, -16); ctx.lineTo(8, -4); ctx.lineTo(2, 10); ctx.lineTo(-4, -4); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    pDraw(fx, ctx);
  }
  shieldDef({
    id: 'shield_bash', name: '방패 강타', icon: '🔰', cost: 10, cooldown: 0.45,
    desc: '방패로 앞을 후려쳐 적을 밀쳐 내고, 날아오던 적 투사체를 부숩니다.',
    ai: { kind: 'melee', range: 100 },
    cast: function (c) {
      var cc = castCenter(c), dir = c.facing >= 0 ? 1 : -1;
      mk('shield_bash', c, { x: cc.x + dir * 8, y: cc.y, dir: dir, life: BS.life, pmax: 20, update: bashUpdate, render: bashRender });
    }
  });

  // K 반사 장벽 — 앞에 1.8초 장벽. 적 투사체를 부수고 시전자의 빛 파편으로 되돌려 보냄
  var RF = { life: 1.8, w: 22, h: 130, max: 5, dmgP: 7, dmgM: 14 };
  function shardUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.done) { if (!fx.parts || !fx.parts.length) fx.dead = true; return; }
    var r = projStep(fx, dt);
    if (r || fx.t > 0.8) { fx.done = true; fx.life = fx.t + 0.35; spark(fx, fx.x, fx.y); }
  }
  function shardRender(fx, ctx) {
    if (!fx.done) {
      ctx.globalCompositeOperation = 'lighter';
      var H = fx.hist || [];
      for (var k = 0; k < H.length; k += 2) { var f = 1 - k / H.length; S.glow(ctx, H[k], H[k + 1], 9 * f + 3, SH, 0.5 * f); }
      S.glow(ctx, fx.x, fx.y, 22, SH, 0.9); S.glow(ctx, fx.x, fx.y, 8, '#ffffff', 1);
      ctx.globalAlpha = 1;
    }
    pDraw(fx, ctx);
  }
  function rfRect(fx) { return { x: fx.x - RF.w / 2, y: fx.fy - RF.h, w: RF.w, h: RF.h }; }
  function reflectUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.flash > 0) fx.flash -= dt;
    if (fx.t > fx.life - 0.2) return;
    var r = rfRect(fx);
    killEnemyProj(fx, function (x, y, rr) { return x + rr > r.x - 6 && x - rr < r.x + r.w + 6 && y + rr > r.y && y - rr < r.y + r.h; },
      function (f) {
        fx.flash = 0.18; spark(fx, f.x, f.y);
        if ((fx.refl || 0) < RF.max) {
          fx.refl = (fx.refl || 0) + 1;
          var y = clamp(f.y, r.y + 8, r.y + r.h - 8);
          child(fx, { x: fx.x + fx.dir * (RF.w / 2 + 12), y: y, ang: fx.dir > 0 ? 0 : Math.PI, speed: 900, r: 9, dmgP: RF.dmgP, dmgM: RF.dmgM,
            kx: 260, ky: -140, life: 1.2, projectile: true, pmax: 12, update: shardUpdate, render: shardRender });
        }
      });
  }
  function reflectRender(fx, ctx) {
    var r = rfRect(fx), a = fade(fx, 0.1, 0.25), t = fx.t;
    var grow = easeOut(t / 0.12);
    var h = RF.h * grow, y0 = fx.fy - h;
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, fx.x, y0 + h / 2, 90, SH, (0.3 + (fx.flash > 0 ? 0.5 : 0)) * a);
    ctx.globalAlpha = 0.35 * a;
    var g = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
    g.addColorStop(0, 'rgba(255,220,120,0)'); g.addColorStop(0.5, 'rgba(255,245,200,0.9)'); g.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(fx.x, y0 + h / 2, RF.w * 0.9, h / 2, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.9 * a; ctx.strokeStyle = SH_L; ctx.lineWidth = 2.5;
    var a0 = fx.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    ctx.beginPath(); ctx.ellipse(fx.x, y0 + h / 2, RF.w * 0.9, h / 2, 0, a0, a0 + Math.PI); ctx.stroke();
    drawHexWall(ctx, fx.x, y0, h, RF.w * 1.4, a, t, SH);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  shieldDef({
    id: 'shield_reflect', name: '반사 장벽', icon: '🪞', cost: 18, cooldown: 5,
    desc: '앞쪽에 1.8초 동안 빛의 장벽을 세웁니다. 장벽에 닿은 적 투사체는 부서지고 빛 파편이 되어 되돌아갑니다 (최대 5개).',
    ai: { kind: 'buff' },
    cast: function (c) {
      var cc = castCenter(c), dir = c.facing >= 0 ? 1 : -1;
      mk('shield_reflect', c, { x: cc.x + dir * 40, fy: feetOf(c) + 4, dir: dir, life: RF.life, pmax: 40,
        update: reflectUpdate, render: reflectRender });
      burst(cc.x + dir * 40, cc.y, 10, [SH, SH_L], 200);
    }
  });

  // L 수호 돔 — 4.5초 반구 결계: 적 투사체 차단, 적은 밖으로 밀려남, 안의 시전자(보스전: 아군 모두) 회복
  var DM = { life: 4.5, R: 150, heal: 5, push: 300 };
  function domeIn(fx, e) {
    var c = center(e), dx = c.x - fx.x, dy = c.y - fx.fy;
    return dy <= 20 && dx * dx + dy * dy <= DM.R * DM.R;
  }
  function domeUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.flash > 0) fx.flash -= dt;
    if (fx.t > fx.life - 0.2) return;
    var R = DM.R * easeOut(fx.t / 0.25);
    killEnemyProj(fx, function (x, y) { var dx = x - fx.x, dy = y - fx.fy; return dy <= 4 && dx * dx + dy * dy <= R * R; },
      function (f) { fx.flash = 0.15; spark(fx, f.x, f.y); });
    var lp = localP();
    var me = mine(fx);
    if (me && domeIn(fx, me)) { heal(me, DM.heal * dt); fx.healing = true; } else if (fx.owner === 'local') fx.healing = false;
    if (fx.owner === 'remote' && alive(lp) && domeIn(fx, lp)) {
      if (G.bossMode) heal(lp, DM.heal * dt);   // 보스전: 아군 결계
      else {
        var dx = lp.x + pw(lp) / 2 - fx.x;
        lp.x += (dx < 0 ? -1 : 1) * DM.push * dt;
      }
    }
    if (mutAuthFx(fx)) {
      var L = mutList();
      for (var i = 0; i < L.length; i++) {
        var m = L[i];
        if (!alive(m) || m.boss || !domeIn(fx, m)) continue;
        var mdx = m.x + (m.w || 40) / 2 - fx.x;
        m.x += (mdx < 0 ? -1 : 1) * DM.push * dt;
      }
    }
    if (Math.random() < 0.3) { var a = rnd(Math.PI, TAU); pAdd(fx, fx.x + Math.cos(a) * R * 0.95, fx.fy + Math.sin(a) * R * 0.95, 0, -30, 0.6, rnd(4, 7), Math.random() < 0.5 ? SH : SH_B, 1); }
    if (fx.healing && Math.random() < 0.25) pAdd(fx, fx.x + rnd(-40, 40), fx.fy - rnd(0, 60), 0, -80, 0.6, 7, '#7fe08a', 0);
  }
  function domeRender(fx, ctx) {
    var a = fade(fx, 0.15, 0.35), t = fx.t, R = DM.R * easeOut(t / 0.25), x = fx.x, y = fx.fy;
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.beginPath(); ctx.rect(x - R - 10, y - R - 10, R * 2 + 20, R + 14); ctx.clip();
    var g = ctx.createRadialGradient(x, y, R * 0.3, x, y, R);
    g.addColorStop(0, 'rgba(255,220,120,0)'); g.addColorStop(0.85, 'rgba(255,220,120,' + (0.18 * a) + ')'); g.addColorStop(1, 'rgba(255,245,200,' + (0.45 * a + (fx.flash > 0 ? 0.3 : 0)) + ')');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, Math.PI, TAU); ctx.closePath(); ctx.fill();
    // 육각 격자
    ctx.strokeStyle = 'rgba(255,240,180,0.55)'; ctx.lineWidth = 1.2;
    for (var row = 0; row < 7; row++) {
      for (var col = -7; col <= 7; col++) {
        var hx = x + col * 22 + (row % 2) * 11, hy = y - 10 - row * 19;
        var dx = hx - x, dy = hy - y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > R - 6 || d < R - 60) continue;
        ctx.globalAlpha = a * (0.4 + 0.6 * Math.max(0, Math.sin(t * 4 - d * 0.05 + col)));
        hexPath(ctx, hx, hy, 9, 0.5); ctx.stroke();
      }
    }
    ctx.globalAlpha = a; ctx.strokeStyle = SH_L; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, R, Math.PI, TAU); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 0.6 * a; ctx.strokeStyle = SH; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y - 2, R, 10, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  shieldDef({
    id: 'shield_dome', name: '수호 돔', icon: '⛺', cost: 34, cooldown: 11,
    desc: '4.5초 동안 반구형 결계를 칩니다. 적 투사체를 막고 적을 밀어내며, 안에 있으면 체력이 서서히 회복됩니다. (보스전에서는 아군도 회복)',
    ai: { kind: 'buff' },
    cast: function (c) {
      var cc = castCenter(c);
      mk('shield_dome', c, { x: cc.x, fy: feetOf(c), life: DM.life, pmax: 40, update: domeUpdate, render: domeRender });
      burst(cc.x, cc.y, 16, [SH, SH_L], 280);
    }
  });

  // I 요새 충격파 — 잠시 무적 요새가 되었다가 두 번의 육각 충격파를 퍼뜨림
  var FT = { inv: 1.1, w1: 0.45, w2: 1.25, grow: 0.5, R: 430, dmg1P: 22, dmg2P: 12, dmgM: 40, life: 2.2 };
  function waveUpdate(fx, dt) {
    pUpdate(fx, dt);
    var k = fx.t - fx.delay;
    if (k < 0 || k > FT.grow) return;
    var R = lerp(40, FT.R, easeOut(k / FT.grow)), cx = fx.x, cy = fx.fy - 40;
    var kn = function (e, dx) { return { kx: (dx < 0 ? -1 : 1) * fx.kb, ky: -380 }; };
    S.hitMutantsCircle(fx, cx, cy, R, FT.dmgM, kn);
    S.hitPlayerCircle(fx, cx, cy, R, fx.dmgP, kn);
    killEnemyProj(fx, function (x, y) { var dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= R * R; }, function (f) { spark(fx, f.x, f.y); });
    if (!fx.boom) { fx.boom = true; shake(fx.owner === 'local' ? 12 : 6); burst(cx, fx.fy - 10, 18, [SH, SH_L, SH_B], 420); }
  }
  function waveRender(fx, ctx) {
    var k = fx.t - fx.delay;
    if (k < 0) return;
    var u = clamp(k / FT.grow, 0, 1), R = lerp(40, FT.R, easeOut(u)), a = 1 - u, cx = fx.x, cy = fx.fy - 40;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a; ctx.strokeStyle = fx.col; ctx.lineWidth = 10 * a + 2;
    hexPath(ctx, cx, cy, R, fx.t * 0.6); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff';
    hexPath(ctx, cx, cy, R * 0.92, fx.t * 0.6); ctx.stroke();
    S.glow(ctx, cx, cy, R * 0.5, fx.col, 0.35 * a);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    pDraw(fx, ctx);
  }
  function fortUpdate(fx, dt) {
    pUpdate(fx, dt);
    var p = mine(fx);
    if (p && fx.t < FT.inv) { p.invulnTimer = Math.max(p.invulnTimer || 0, 0.12); p.vx *= 0.6; }
    if (fx.t < FT.w1 && Math.random() < 0.9) { var a = rnd(0, TAU); pAdd(fx, fx.x + Math.cos(a) * 120, fx.fy - 40 + Math.sin(a) * 120, -Math.cos(a) * 260, -Math.sin(a) * 260, 0.45, rnd(5, 8), Math.random() < 0.5 ? SH : SH_L, 0); }
  }
  function fortRender(fx, ctx) {
    var t = fx.t, a = Math.min(1, t / 0.15) * clamp((FT.inv + 0.3 - t) / 0.3, 0, 1);
    var c = casterCenter(fx), x = c.x != null ? c.x : fx.x, base = fx.fy;
    if (a > 0) {
      ctx.globalCompositeOperation = 'lighter';
      S.glow(ctx, x, base - 50, 110, SH, 0.45 * a);
      // 요새 성벽 (양옆 탑 + 흉벽)
      ctx.globalAlpha = 0.75 * a;
      var rise = easeOut(t / 0.3);
      ctx.fillStyle = 'rgba(255,220,120,0.35)'; ctx.strokeStyle = SH_L; ctx.lineWidth = 2;
      for (var s = -1; s <= 1; s += 2) {
        var tx = x + s * 46, th = 110 * rise;
        ctx.beginPath(); ctx.rect(tx - 13, base - th, 26, th); ctx.fill(); ctx.stroke();
        for (var b = 0; b < 3; b++) { ctx.beginPath(); ctx.rect(tx - 13 + b * 10, base - th - 8, 6, 8); ctx.fill(); ctx.stroke(); }
      }
      ctx.beginPath(); ctx.rect(x - 33, base - 70 * rise, 66, 70 * rise); ctx.fill(); ctx.stroke();
      drawHexWall(ctx, x, base - 70 * rise, 70 * rise, 50, a, t, SH_L);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    pDraw(fx, ctx);
  }
  shieldDef({
    id: 'shield_fortress', name: '요새 충격파', icon: '🏰', cost: 70, cooldown: 14,
    desc: '잠시 무적의 요새가 되었다가, 주위로 두 번의 거대한 육각 충격파를 퍼뜨려 적과 투사체를 날려 버립니다.',
    ai: { kind: 'zone', range: 380 },
    prepare: function (c) {
      c.p.invulnTimer = Math.max(c.p.invulnTimer || 0, FT.inv);
      if (S.lockCast) S.lockCast(0.45);
      return {};
    },
    cast: function (c) {
      var cc = castCenter(c), fy = feetOf(c);
      var f = mk('shield_fortress', c, { x: cc.x, _cx: cc.x, _cy: cc.y, fy: fy, life: FT.life, pmax: 40, update: fortUpdate, render: fortRender });
      child(f, { x: cc.x, fy: fy, delay: FT.w1, dmgP: FT.dmg1P, kb: 720, col: SH, life: FT.w1 + FT.grow + 0.3, pmax: 20, update: waveUpdate, render: waveRender });
      child(f, { x: cc.x, fy: fy, delay: FT.w2, dmgP: FT.dmg2P, kb: 520, col: SH_B, life: FT.w2 + FT.grow + 0.3, pmax: 20, update: waveUpdate, render: waveRender });
    }
  });

  // ================================================================ 키트 선언
  var KITS = [
    { element: 'summon', elementName: '소환자', icon: '🧿', ids: ['sum_drone', 'sum_wolf', 'sum_golem', 'sum_guardian'],
      meta: { color: SU, desc: '드론·늑대·골렘을 부리고, 끝내 거대한 영혼 수호자를 불러냅니다.', rarity: 'hard' } },
    { element: 'steel', elementName: '강철', icon: '⚙️', ids: ['steel_fist', 'steel_skin', 'steel_rail', 'steel_girder'],
      meta: { color: ST, desc: '강철 몸으로 버티고 들이받으며, 하늘에서 철골을 쏟아붓습니다.', rarity: 'hard' } },
    { element: 'shield', elementName: '쉴드', icon: '🔰', ids: ['shield_bash', 'shield_reflect', 'shield_dome', 'shield_fortress'],
      meta: { color: SH, desc: '방패와 결계로 공격을 막고 되돌려 주며, 요새의 충격파로 밀어냅니다.', rarity: 'hard' } }
  ];
  for (var ki = 0; ki < KITS.length; ki++) {
    var K = KITS[ki];
    if (typeof S.kit === 'function') {
      try { S.kit(K.element, K.elementName, K.icon, K.ids, K.meta); } catch (e) { if (window.console) console.error('[skills_kit4] kit', e); }
    } else {
      G.pendingKits = G.pendingKits || [];
      G.pendingKits.push(K);
    }
  }
})();
