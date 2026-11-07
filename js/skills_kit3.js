/* 초능력자: 각성 — 히든 능력 키트 4종 (염력 / 블랙홀 / 시간 / 용족) 신규 기술 12개  v4
 * 기존 기술(psychograb / blackhole / timestop / dragonsummon)은 skills_hard.js 에 있음.
 * 규칙: 각 클라이언트는 자기 자신만 피해. 지정 대상(유도) 기술은 prepare() 에 대상 id 를 담음.
 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};
  var S = G.Skills;
  if (!S || typeof S.register !== 'function') {
    if (window.console && console.warn) console.warn('[skills_kit3] Game.Skills 가 없어 등록하지 않습니다.');
    return;
  }

  var TAU = Math.PI * 2;

  // ------------------------------------------------------------ 유틸
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function gy() { return S.groundY(); }
  function worldW() { return (G.world && G.world.width) || 4200; }
  function shake(a) { if (typeof G.shake === 'function') G.shake(a); }
  function burst(x, y, n, colors, speed) { if (typeof S.burst === 'function') S.burst(x, y, n, colors, speed); }
  function alive(e) { return !!e && e.alive !== false; }
  function center(e) { return { x: e.x + (e.w || 34) / 2, y: e.y + (e.h || 62) / 2 }; }
  function localP() { return (G.players && G.players.local) || null; }
  function isMe(id) { return typeof S.isMe === 'function' ? S.isMe(id) : false; }
  function playerById(id) { return typeof S.playerById === 'function' ? S.playerById(id) : null; }
  function hash(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function findMutant(id) {
    var l = (G.Mutants && G.Mutants.list) || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }
  function toast(t) { if (typeof G.toast === 'function') G.toast(t); }
  function pw(p) { return (p && p.w) || 34; }
  function ph(p) { return (p && p.h) || 62; }
  function castCenter(ctx) { return { x: ctx.x + pw(ctx.p) / 2, y: ctx.y + ph(ctx.p) / 2 }; }
  function handOf(ctx) {
    var d = ctx.facing >= 0 ? 1 : -1;
    return { x: ctx.x + pw(ctx.p) / 2 + d * (pw(ctx.p) / 2 + 6), y: ctx.y + ph(ctx.p) * 0.42, d: d };
  }
  // 로컬 시전자 본인일 때만 자기 이동
  function mine(fx) { var lp = localP(); return fx.owner === 'local' && fx.p === lp && alive(lp) ? lp : null; }
  // 시전자 현재 위치 (원격은 동기화 위치)
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
  function rg(ctx, x, y, r, stops) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r), 0, TAU); ctx.fill();
  }

  // ------------------------------------------------------------ fx 자체 파티클
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

  // ------------------------------------------------------------ 대상 선택 (prepare 전용)
  function findTargets(p, facing, range, back, max) {
    var c = center(p), out = [];
    function consider(k, id, e) {
      if (!alive(e) || id == null) return;
      var ec = center(e), dx = ec.x - c.x, dy = ec.y - c.y;
      if (facing && dx * facing < -back) return;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= range) out.push({ k: k, id: id, d: d });
    }
    var ms = (G.Mutants && G.Mutants.list) || [];
    for (var i = 0; i < ms.length; i++) consider('m', ms[i].id, ms[i]);
    var os = S.remotePlayers ? S.remotePlayers() : [];
    for (var j = 0; j < os.length; j++) if (os[j]) consider('p', os[j].id, os[j]);
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, max || 1).map(function (o) { return { k: o.k, id: o.id }; });
  }
  function targetEnt(k, id) {
    var e = k === 'm' ? findMutant(id) : (k === 'p' ? playerById(id) : null);
    return alive(e) ? e : null;
  }

  // ------------------------------------------------------------ 공용 투사체 스텝
  // fx: x,y,ang,speed,turn,r,dmgP,dmgM,kx,ky,tk,tid,slow  → 'hit' | 'end' | null
  function projStep(fx, dt) {
    if (fx.turn > 0 && fx.tk) {
      var e = targetEnt(fx.tk, fx.tid);
      if (e) {
        var c = center(e);
        var da = angDiff(Math.atan2(c.y - fx.y, c.x - fx.x), fx.ang);
        fx.ang += clamp(da, -fx.turn * dt, fx.turn * dt);
      }
    }
    var H = fx.hist || (fx.hist = []);
    H.unshift(fx.x, fx.y);
    if (H.length > (fx.histN || 14)) H.length = fx.histN || 14;
    fx.x += Math.cos(fx.ang) * fx.speed * dt;
    fx.y += Math.sin(fx.ang) * fx.speed * dt;
    if (fx.x < -60 || fx.x > worldW() + 60 || fx.y > gy() - 2) return 'end';
    var r = fx.r, box = { x: fx.x - r, y: fx.y - r, w: r * 2, h: r * 2 };
    var dir = Math.cos(fx.ang) >= 0 ? 1 : -1;
    var kn = { kx: dir * (fx.kx || 0), ky: fx.ky || 0 };
    var onlyT = fx.tk === 'p' && fx.tid != null;
    if (fx.touch) { // 접촉만 판정 (피해는 다른 곳에서)
      if (S.mutantsInCircle(fx.x, fx.y, r).length || S.remoteTouchRect(box, fx)) return 'hit';
      var me = localP();
      if (fx.owner === 'remote' && alive(me) && S.circleRect(fx.x, fx.y, r, me)) return 'hit';
      return null;
    }
    if (fx.owner === 'local') {
      var ms = S.hitMutantsCircle(fx, fx.x, fx.y, r, fx.dmgM, kn);
      if (ms.length) {
        if (fx.slow) S.statusMutantsCircle(fx, fx.x, fx.y, r + 6, 'slow', fx.slow);
        return 'hit';
      }
      var rp = S.remoteTouchRect(box);
      if (rp && (!onlyT || rp.id === fx.tid)) return 'hit';
    } else {
      // 유도 대상이 다른 플레이어면 나는 맞지 않음 (계약 §3)
      if ((!onlyT || isMe(fx.tid)) && S.hitPlayerCircle(fx, fx.x, fx.y, r, fx.dmgP, kn)) {
        if (fx.slow) S.statusPlayerCircle(fx, fx.x, fx.y, r + 6, 'slow', fx.slow);
        return 'hit';
      }
      var rp2 = S.remoteTouchRect(box, fx);
      if (rp2 && (!onlyT || rp2.id === fx.tid)) return 'hit';
      if (!onlyT && S.mutantsInCircle(fx.x, fx.y, r).length) return 'hit';
    }
    return null;
  }

  // ================================================================ 염력 (psychic)
  var PSY = '#b06bff', PSY_L = '#e2c8ff', PSY_D = '#6a2cff';
  function psyDef(o) { o.element = 'psychic'; o.elementName = '염력'; o.rarity = 'hard'; o.color = PSY; return S.register(o); }

  // J 염동탄 — 약하게 유도되는 보라 프리즘
  function psyBoltUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.done) { if (!fx.parts || !fx.parts.length) fx.dead = true; return; }
    if (Math.random() < 0.7) pAdd(fx, fx.x, fx.y, rnd(-40, 40), rnd(-40, 40), 0.3, rnd(6, 10), Math.random() < 0.5 ? PSY : PSY_L, 2);
    var r = projStep(fx, dt);
    if (r || fx.t > 1.15) {
      fx.done = true;
      for (var i = 0; i < 12; i++) { var a = i / 12 * TAU; pAdd(fx, fx.x, fx.y, Math.cos(a) * 220, Math.sin(a) * 220, 0.35, 9, i % 2 ? PSY : PSY_L, 4); }
      fx.life = fx.t + 0.5;
    }
  }
  function psyBoltRender(fx, ctx) {
    ctx.globalCompositeOperation = 'lighter';
    if (!fx.done) {
      var H = fx.hist || [];
      for (var k = 0; k < H.length; k += 2) { var f = 1 - k / H.length; S.glow(ctx, H[k], H[k + 1], 14 * f + 4, PSY, 0.5 * f); }
      S.glow(ctx, fx.x, fx.y, 30, PSY, 0.8);
      ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(fx.x, fx.y); ctx.rotate(fx.t * 14);
      ctx.fillStyle = 'rgba(245,230,255,0.95)';
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 0); ctx.lineTo(0, 11); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(170,100,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
    pDraw(fx, ctx);
  }
  psyDef({
    id: 'psy_bolt', name: '염동탄', icon: '🔮', cost: 12, cooldown: 0.45,
    desc: '앞쪽 가장 가까운 적을 약하게 추적하는 염력 탄을 쏩니다.',
    prepare: function (c) {
      var t = findTargets(c.p, c.facing, 650, 0, 1)[0];
      return t ? { tk: t.k, tid: t.id } : {};
    },
    cast: function (c) {
      var h = handOf(c), d = c.data || {};
      mk('psy_bolt', c, { x: h.x, y: h.y, ang: h.d > 0 ? 0 : Math.PI, speed: 760, turn: 3.2, r: 11,
        dmgP: 8, dmgM: 14, kx: 220, ky: -140, tk: d.tk, tid: d.tid, life: 1.8, pmax: 30,
        update: psyBoltUpdate, render: psyBoltRender });
    }
  });

  // K 공중 부양 — 염력 파동으로 주변을 밀쳐내며 떠오르고 천천히 낙하
  var LEV_RISE = 0.3, LEV_LIFE = 1.6, LEV_R = 120;
  function levUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (!fx.waved) {
      fx.waved = true;
      var kn = function (e, dx) { return { kx: (dx < 0 ? -1 : 1) * 520, ky: -320 }; };
      S.hitMutantsCircle(fx, fx.x, fx.y, LEV_R, 12, kn);
      S.hitPlayerCircle(fx, fx.x, fx.y, LEV_R, 6, kn);
      shake(fx.owner === 'local' ? 4 : 2);
    }
    var p = mine(fx);
    if (p) {
      if (fx.t < LEV_RISE) { p.y = Math.max(-400, p.y - 640 * dt); p.vy = 0; p.onGround = false; }
      else if (fx.t < LEV_LIFE - 0.1) { p.vy = Math.min(p.vy, 70); }
    }
    var cc = casterCenter(fx);
    if (fx.t < LEV_LIFE - 0.2 && Math.random() < 0.6) pAdd(fx, cc.x + rnd(-18, 18), cc.y + 34, rnd(-20, 20), rnd(40, 90), 0.5, rnd(5, 9), Math.random() < 0.5 ? PSY : PSY_L, 1);
  }
  function levRender(fx, ctx) {
    var cc = casterCenter(fx), t = fx.t;
    ctx.globalCompositeOperation = 'lighter';
    if (t < 0.45) {
      var q = t / 0.45;
      ctx.strokeStyle = 'rgba(200,150,255,' + (1 - q) + ')';
      ctx.lineWidth = 8 * (1 - q) + 1;
      ctx.beginPath(); ctx.ellipse(fx.x, fx.y, 20 + q * LEV_R * 1.3, 6 + q * 28, 0, 0, TAU); ctx.stroke();
    }
    var a = Math.min(1, t / 0.15) * Math.min(1, (LEV_LIFE - t) / 0.3);
    if (a > 0 && cc.x != null) {
      rg(ctx, cc.x, cc.y, 54, [[0, 'rgba(220,190,255,' + (0.25 * a) + ')'], [0.8, 'rgba(150,80,255,' + (0.18 * a) + ')'], [1, 'rgba(90,20,200,0)']]);
      ctx.strokeStyle = 'rgba(210,170,255,' + (0.7 * a) + ')'; ctx.lineWidth = 2;
      for (var k = 0; k < 3; k++) {
        var yy = cc.y + 36 + k * 9, rr = 26 - k * 5 + Math.sin(t * 8 + k) * 3;
        ctx.beginPath(); ctx.ellipse(cc.x, yy, rr, rr * 0.3, 0, 0, TAU); ctx.stroke();
      }
    }
    pDraw(fx, ctx);
  }
  psyDef({
    id: 'psy_levitate', name: '공중 부양', icon: '🪶', cost: 22, cooldown: 3,
    desc: '염력 파동으로 주변을 밀쳐내고 공중으로 떠올라 천천히 내려옵니다.',
    cast: function (c) {
      var cc = castCenter(c);
      mk('psy_levitate', c, { x: cc.x, y: c.y + ph(c.p) - 8, _cx: cc.x, _cy: cc.y, life: LEV_LIFE, pmax: 40,
        update: levUpdate, render: levRender });
      burst(cc.x, c.y + ph(c.p), 12, [PSY_L, PSY], 260);
    }
  });

  // I 사념 폭풍 — 녹슨 잔해 5개를 띄워 적들에게 차례로 던짐
  var ST_N = 5, ST_HOLD = 0.55, ST_GAP = 0.28;
  function debrisUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.done) { if (!fx.parts || !fx.parts.length) fx.dead = true; return; }
    fx.rot += fx.spin * dt;
    if (fx.t < fx.launchAt) {
      var u = ease(fx.t / ST_HOLD);
      fx.x = lerp(fx.bx, fx.hx, u) + Math.sin(fx.t * 5 + fx.seed) * 4;
      fx.y = lerp(gy() - 6, fx.hy, u) + Math.cos(fx.t * 4 + fx.seed) * 5;
      if (Math.random() < 0.25) pAdd(fx, fx.x, fx.y + 14, rnd(-15, 15), rnd(30, 70), 0.4, 6, PSY, 1);
      return;
    }
    if (!fx.launched) {
      fx.launched = true;
      var e = targetEnt(fx.tk, fx.tid);
      if (e) { var c = center(e); fx.ang = Math.atan2(c.y - fx.y, c.x - fx.x); }
      else fx.ang = (fx.dir > 0 ? 0 : Math.PI) + fx.dir * fx.sp;
      fx.spin *= 3;
    }
    if (Math.random() < 0.8) pAdd(fx, fx.x, fx.y, rnd(-30, 30), rnd(-30, 30), 0.3, rnd(8, 13), Math.random() < 0.6 ? PSY : '#e07a35', 2);
    var r = projStep(fx, dt);
    if (r || fx.t > fx.launchAt + 1.5) {
      fx.done = true;
      shake(fx.owner === 'local' ? 4 : 2);
      burst(fx.x, fx.y, 10, ['#b5541c', '#5a2a10', PSY_L], 320);
      for (var i = 0; i < 10; i++) { var a = i / 10 * TAU; pAdd(fx, fx.x, fx.y, Math.cos(a) * 260, Math.sin(a) * 260, 0.35, 11, i % 2 ? PSY : PSY_L, 4); }
      fx.life = fx.t + 0.5;
    }
  }
  function debrisRender(fx, ctx) {
    if (!fx.done) {
      ctx.globalCompositeOperation = 'lighter';
      if (fx.launched) {
        var H = fx.hist || [];
        for (var k = 0; k < H.length; k += 2) { var f = 1 - k / H.length; S.glow(ctx, H[k], H[k + 1], 22 * f + 4, PSY, 0.4 * f); }
      }
      S.glow(ctx, fx.x, fx.y, 40 * fx.s, PSY, 0.6);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(fx.x, fx.y); ctx.rotate(fx.rot); ctx.scale(fx.s, fx.s);
      ctx.beginPath();
      for (var i = 0; i < 7; i++) {
        var a = i / 7 * TAU, rr = 13 + hash(fx.seed * 7 + i) * 11;
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = hash(fx.seed) > 0.5 ? '#8a4418' : '#5f3a22';
      ctx.fill();
      ctx.strokeStyle = 'rgba(210,170,255,0.95)'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = 'rgba(224,122,53,0.8)';
      ctx.fillRect(-6, -3, 9, 4);
      ctx.restore();
    }
    pDraw(fx, ctx);
  }
  function stormAuraRender(fx, ctx) {
    var cc = casterCenter(fx), t = fx.t, a = Math.min(1, t / 0.2) * Math.min(1, (fx.life - t) / 0.3);
    if (cc.x == null) return;
    ctx.globalCompositeOperation = 'lighter';
    rg(ctx, cc.x, cc.y, 120, [[0, 'rgba(230,200,255,' + (0.35 * a) + ')'], [0.5, 'rgba(150,80,255,' + (0.2 * a) + ')'], [1, 'rgba(80,0,200,0)']]);
    ctx.save(); ctx.translate(cc.x, cc.y); ctx.rotate(t * 2.5);
    ctx.strokeStyle = 'rgba(200,150,255,' + (0.8 * a) + ')'; ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.stroke();
    ctx.rotate(-t * 5);
    ctx.beginPath(); ctx.arc(0, 0, 92, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  psyDef({
    id: 'psy_storm', name: '사념 폭풍', icon: '🌀', cost: 75, cooldown: 12,
    desc: '녹슨 잔해 다섯 덩이를 염력으로 띄워 주변 적들에게 차례로 내던집니다.',
    prepare: function (c) {
      var ts = findTargets(c.p, 0, 800, 0, 3), pcs = [];
      for (var i = 0; i < ST_N; i++) {
        var t = ts.length ? ts[i % ts.length] : null;
        pcs.push({ k: t ? t.k : null, id: t ? t.id : null, ox: Math.round(rnd(-150, 150)), oy: Math.round(rnd(-40, 25)),
          s: Math.round(rnd(80, 130)) / 100, sd: Math.round(rnd(1, 999)), sp: Math.round(rnd(-35, 20)) / 100 });
      }
      c.p.frozen = Math.max(c.p.frozen || 0, ST_HOLD); c.p.vx = 0;
      if (S.lockCast) S.lockCast(ST_HOLD);
      return { pcs: pcs };
    },
    cast: function (c) {
      var cc = castCenter(c), d = c.data || {}, pcs = Array.isArray(d.pcs) ? d.pcs.slice(0, ST_N) : [];
      mk('psy_storm', c, { x: cc.x, y: cc.y, _cx: cc.x, _cy: cc.y, life: ST_HOLD + ST_GAP * ST_N + 0.3, render: stormAuraRender });
      for (var i = 0; i < pcs.length; i++) {
        var q = pcs[i] || {}, ox = num(q.ox, 0);
        var la = ST_HOLD + i * ST_GAP;
        mk('psy_storm', c, { bx: cc.x + ox, hx: cc.x + ox * 0.8, hy: cc.y - 110 + num(q.oy, 0), x: cc.x + ox, y: gy() - 6,
          s: clamp(num(q.s, 1), 0.6, 1.5), seed: num(q.sd, i), sp: clamp(num(q.sp, 0), -0.5, 0.5), dir: c.facing >= 0 ? 1 : -1,
          rot: 0, spin: rnd(-3, 3), launchAt: la, speed: 950, turn: 3.5, r: 22, dmgP: 8, dmgM: 18, kx: 380, ky: -260,
          tk: q.k === 'm' || q.k === 'p' ? q.k : null, tid: q.id, life: la + 2.2, pmax: 30, histN: 12,
          update: debrisUpdate, render: debrisRender });
      }
      shake(8);
      if (c.owner === 'remote') toast(((c.p && c.p.name) ? c.p.name + '(이)가 ' : '') + '사념 폭풍을 일으켰다!');
    }
  });

  // ================================================================ 블랙홀 (void)
  var VO = '#7b4dff', VO_L = '#c9b4ff', VO_H = '#ffb070';
  function voidDef(o) { o.element = 'void'; o.elementName = '블랙홀'; o.rarity = 'hard'; o.color = VO; return S.register(o); }

  // J 공허 구체 — 느린 검은 구체, 닿거나 사거리 끝에서 내파
  var VOR_R = 75;
  function implode(fx) {
    fx.done = true; fx.ix = fx.x; fx.iy = fx.y; fx.it = fx.t;
    var kn = function (e, dx, dy, dist) { var n = dist || 1; return { kx: -dx / n * 260, ky: -dy / n * 200 - 120 }; };
    S.hitMutantsCircle(fx, fx.x, fx.y, VOR_R, 16, kn);
    S.hitPlayerCircle(fx, fx.x, fx.y, VOR_R, 9, kn);
    for (var i = 0; i < 14; i++) { var a = i / 14 * TAU; pAdd(fx, fx.x + Math.cos(a) * 80, fx.y + Math.sin(a) * 80, -Math.cos(a) * 260, -Math.sin(a) * 260, 0.3, 8, i % 3 ? VO : VO_H, 0); }
    shake(fx.owner === 'local' ? 3 : 2);
    fx.life = fx.t + 0.45;
  }
  function voidOrbUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.done) return;
    if (Math.random() < 0.6) { var a = rnd(0, TAU); pAdd(fx, fx.x + Math.cos(a) * 34, fx.y + Math.sin(a) * 34, -Math.cos(a) * 110, -Math.sin(a) * 110, 0.3, 6, VO_L, 0); }
    // 투사체 판정은 '닿았는지'만 사용 (피해는 내파에서)
    var r = projStep(fx, dt);
    if (r || fx.t > 1.0) implode(fx);
  }
  function voidOrbRender(fx, ctx) {
    if (!fx.done) {
      ctx.globalCompositeOperation = 'lighter';
      S.glow(ctx, fx.x, fx.y, 40, VO, 0.7);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(200,170,255,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 16 + Math.sin(fx.t * 30) * 1.5, 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#05010d';
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 12, 0, TAU); ctx.fill();
    } else {
      var q = clamp((fx.t - fx.it) / 0.4, 0, 1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(190,160,255,' + (1 - q) + ')'; ctx.lineWidth = 6 * (1 - q) + 1;
      ctx.beginPath(); ctx.arc(fx.ix, fx.iy, VOR_R * (1 - q * 0.85), 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(5,1,13,' + (0.9 * (1 - q)) + ')';
      ctx.beginPath(); ctx.arc(fx.ix, fx.iy, 22 * (1 - q) + 2, 0, TAU); ctx.fill();
    }
    pDraw(fx, ctx);
  }
  voidDef({
    id: 'void_orb', name: '공허 구체', icon: '⚫', cost: 12, cooldown: 0.5,
    desc: '느린 공허 구체를 날립니다. 닿거나 사거리 끝에서 내파해 주변을 빨아들이며 피해를 줍니다.',
    cast: function (c) {
      var h = handOf(c);
      mk('void_orb', c, { x: h.x, y: h.y, ang: h.d > 0 ? 0 : Math.PI, speed: 560, turn: 0, r: 15,
        touch: true, dmgP: 0, dmgM: 0, kx: 0, ky: 0, life: 1.6, pmax: 30, update: voidOrbUpdate, render: voidOrbRender });
    }
  });

  // K 위상 이동 — 300px 순간이동, 통과한 경로의 적을 베고 둔화
  var PH_DIST = 300;
  function phaseUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (!fx.moved) {
      fx.moved = true;
      var p = mine(fx);
      if (p) { p.x = fx.ex; p.vx = fx.dir * 220; p.invulnTimer = Math.max(p.invulnTimer || 0, 0.35); }
      for (var i = 0; i < 16; i++) pAdd(fx, lerp(fx.x0, fx.x1, Math.random()), fx.y + rnd(-26, 26), rnd(-40, 40), rnd(-60, 20), rnd(0.3, 0.6), rnd(6, 10), i % 4 ? VO : VO_L, 1);
    }
    if (fx.t < 0.15) {
      var rect = { x: Math.min(fx.x0, fx.x1), y: fx.y - 31, w: Math.abs(fx.x1 - fx.x0), h: 62 };
      var kn = { kx: fx.dir * 200, ky: -220 };
      if (S.hitMutantsRect(fx, rect, 16, kn.kx, kn.ky).length) S.statusMutantsRect(fx, rect, 'slow', 1.2);
      if (S.hitPlayerRect(fx, rect, 8, kn.kx, kn.ky)) S.statusPlayerRect(fx, rect, 'slow', 1.2);
    }
  }
  function rift(ctx, x, y, a, t) {
    var hh = 44 * a;
    rg(ctx, x, y, 60 * a, [[0, 'rgba(180,140,255,0.5)'], [1, 'rgba(60,0,160,0)']]);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(4,0,12,' + (0.95 * a) + ')';
    ctx.beginPath();
    ctx.moveTo(x, y - hh);
    ctx.quadraticCurveTo(x + 9 * a + Math.sin(t * 20) * 2, y, x, y + hh);
    ctx.quadraticCurveTo(x - 9 * a, y, x, y - hh);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(210,190,255,' + a + ')'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  function phaseRender(fx, ctx) {
    var t = fx.t, a = Math.min(1, t / 0.05) * clamp((fx.life - t) / 0.35, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    if (t < 0.3) {
      var q = t / 0.3;
      var lg = ctx.createLinearGradient(fx.x0, 0, fx.x1, 0);
      lg.addColorStop(0, 'rgba(120,70,255,0)');
      lg.addColorStop(1, 'rgba(210,190,255,' + (0.8 * (1 - q)) + ')');
      ctx.fillStyle = lg;
      ctx.fillRect(Math.min(fx.x0, fx.x1), fx.y - 4 * (1 - q) - 1, Math.abs(fx.x1 - fx.x0), 8 * (1 - q) + 2);
    }
    rift(ctx, fx.x0, fx.y, a, t);
    rift(ctx, fx.x1, fx.y, a * 0.8, t + 1);
    pDraw(fx, ctx);
  }
  voidDef({
    id: 'void_phase', name: '위상 이동', icon: '🌌', cost: 25, cooldown: 3,
    desc: '공간을 찢고 앞으로 순간이동합니다. 통과한 경로의 적은 베이고 둔화됩니다.',
    prepare: function (c) {
      var p = c.p;
      var ex = clamp(p.x + c.facing * PH_DIST, 0, worldW() - pw(p));
      return { x0: Math.round(p.x), ex: Math.round(ex), ry: Math.round(S.rel(p.y + ph(p) / 2)) };
    },
    cast: function (c) {
      var d = c.data || {}, w = pw(c.p);
      var x0 = num(d.x0, c.x), ex = num(d.ex, clamp(x0 + c.facing * PH_DIST, 0, worldW() - w));
      mk('void_phase', c, { x0: x0 + w / 2, x1: ex + w / 2, ex: ex, x: x0 + w / 2,
        y: typeof d.ry === 'number' ? S.abs(d.ry) : c.y + ph(c.p) / 2, dir: c.facing >= 0 ? 1 : -1,
        life: 0.7, pmax: 30, update: phaseUpdate, render: phaseRender });
    }
  });

  // L 중력 우물 — 앞쪽 지면에 2.2초간 끌어당기고 둔화, 마지막에 붕괴
  var WL_OFF = 240, WL_PULL_R = 210, WL_CORE = 70, WL_END = 2.2, WL_BOOM = 130;
  function wellUpdate(fx, dt) {
    pUpdate(fx, dt);
    var cx = fx.x, cy = gy() - 34;
    if (fx.t > 0.25 && fx.t < WL_END) {
      S.pullMutants(fx, cx, cy, WL_PULL_R, 1300, dt);
      S.pullPlayer(fx, cx, cy, WL_PULL_R, 1300, dt);
      S.statusPlayerCircle(fx, cx, cy, WL_PULL_R - 20, 'slow', 0.3);
      S.hitMutantsCircle(fx, cx, cy, WL_CORE, 6, { kx: 0, ky: -60 });
      S.hitPlayerCircle(fx, cx, cy, WL_CORE, 3, { kx: 0, ky: -60 });
      if (Math.random() < 0.8) { var a = rnd(Math.PI, TAU), r0 = rnd(150, 220); pAdd(fx, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.5, -Math.cos(a) * 300, -Math.sin(a) * 150, 0.5, rnd(5, 9), Math.random() < 0.7 ? VO_L : VO_H, 0.5); }
    }
    if (!fx.boomed && fx.t >= WL_END) {
      fx.boomed = true;
      // 붕괴는 별도 hitSet (틱 피해와 분리)
      var b = mk('void_well', { owner: fx.owner, castId: fx.castId, casterId: fx.casterId, p: fx.p }, { x: cx, y: cy, life: 0.5,
        update: function (f) {
          if (f.done) return; f.done = true;
          var kn = function (e, dx) { return { kx: (dx < 0 ? -1 : 1) * 300, ky: -720 }; };
          S.hitMutantsCircle(f, f.x, f.y, WL_BOOM, 22, kn);
          S.hitPlayerCircle(f, f.x, f.y, WL_BOOM, 10, kn);
          shake(f.owner === 'local' ? 9 : 5);
          burst(f.x, f.y, 20, ['#ffffff', VO_L, VO, '#2a0a5a'], 520);
        },
        render: function (f, ctx) {
          var q = f.t / f.life;
          ctx.globalCompositeOperation = 'lighter';
          rg(ctx, f.x, f.y, WL_BOOM * (0.5 + q), [[0, 'rgba(255,255,255,' + (1 - q) + ')'], [0.4, 'rgba(180,140,255,' + (0.6 * (1 - q)) + ')'], [1, 'rgba(60,0,160,0)']]);
          ctx.strokeStyle = 'rgba(210,190,255,' + (1 - q) + ')'; ctx.lineWidth = 8 * (1 - q) + 1;
          ctx.beginPath(); ctx.ellipse(f.x, gy() - 4, WL_BOOM * (0.4 + q * 1.2), 14 + q * 20, 0, 0, TAU); ctx.stroke();
        } });
      b.y = cy;
    }
  }
  function wellRender(fx, ctx) {
    var t = fx.t, g0 = gy(), cx = fx.x;
    var a = Math.min(1, t / 0.25) * clamp((WL_END + 0.1 - t) / 0.2, 0, 1);
    if (a <= 0) { pDraw(fx, ctx); return; }
    ctx.save();
    ctx.translate(cx, g0 - 4); ctx.scale(1, 0.28);
    rg(ctx, 0, 0, WL_PULL_R * a, [[0, 'rgba(0,0,0,0.95)'], [0.35, 'rgba(25,8,60,0.75)'], [1, 'rgba(20,0,50,0)']]);
    ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < 4; k++) {
      ctx.strokeStyle = 'rgba(' + (150 + k * 20) + ',120,255,' + (0.5 - k * 0.08) * a + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (var i = 0; i <= 30; i++) {
        var u = i / 30, ang = u * 5 + t * (4 + k) + k * 1.57, r = (1 - u) * WL_PULL_R * 0.95 * a;
        var px = Math.cos(ang) * r, py = Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    // 위로 솟는 보랏빛 중력선
    for (var j = 0; j < 5; j++) {
      var xx = cx + (j - 2) * 22, hgt = (90 + 40 * Math.sin(t * 6 + j)) * a;
      var lg = ctx.createLinearGradient(0, g0 - hgt, 0, g0);
      lg.addColorStop(0, 'rgba(120,70,255,0)'); lg.addColorStop(1, 'rgba(190,160,255,' + (0.35 * a) + ')');
      ctx.fillStyle = lg; ctx.fillRect(xx - 3, g0 - hgt, 6, hgt);
    }
    S.glow(ctx, cx, g0 - 34, 46 * a, VO, 0.5 * a);
    ctx.globalAlpha = 1;
    pDraw(fx, ctx);
  }
  voidDef({
    id: 'void_well', name: '중력 우물', icon: '🌑', cost: 40, cooldown: 5.5,
    desc: '앞쪽 지면에 중력 우물을 열어 2초간 적을 끌어당기고 둔화시킨 뒤 붕괴시킵니다.',
    prepare: function (c) {
      return { tx: Math.round(clamp(c.x + pw(c.p) / 2 + c.facing * WL_OFF, 60, worldW() - 60)) };
    },
    cast: function (c) {
      var d = c.data || {};
      var tx = num(d.tx, clamp(c.x + pw(c.p) / 2 + c.facing * WL_OFF, 60, worldW() - 60));
      mk('void_well', c, { x: tx, y: gy() - 34, life: WL_END + 0.15, rehit: 0.5, pmax: 50, update: wellUpdate, render: wellRender });
      burst(tx, gy() - 10, 14, [VO_L, VO, '#2a0a5a'], 300);
    }
  });

  // ================================================================ 시간 (time)
  var TM = '#6fd8ff', TM_G = '#ffd98a', TM_L = '#d6f6ff';
  function timeDef(o) { o.element = 'time'; o.elementName = '시간'; o.rarity = 'hard'; o.color = TM; return S.register(o); }

  // 위치 기록 (되감기용): Powers.update 를 감싸 0.05초마다 로컬 플레이어 기록
  var hist = [], hClock = 0, hAcc = 0, H_KEEP = 2.2, RW_BACK = 1.5;
  function sampleHist(dt) {
    hClock += dt; hAcc += dt;
    if (hAcc < 0.05) return;
    hAcc = 0;
    var p = localP();
    if (!p || !alive(p)) { hist.length = 0; return; }
    hist.push({ t: hClock, x: p.x, y: p.y, hp: +p.hp || 0 });
    while (hist.length && hClock - hist[0].t > H_KEEP) hist.shift();
  }
  (function wrap() {
    var P = G.Powers;
    if (!P || typeof P.update !== 'function' || P._kit3Hist) return;
    var orig = P.update;
    P.update = function (dt) {
      var r = orig.apply(this, arguments);
      try { if (dt > 0) sampleHist(dt); } catch (e) { /* 무시 */ }
      return r;
    };
    P._kit3Hist = true;
  })();

  // J 시간 화살 — 빠른 시곗바늘 화살, 맞으면 둔화
  function tboltUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.done) return;
    fx.tick = (fx.tick || 0) + dt;
    if (fx.tick > 0.06) { fx.tick = 0; pAdd(fx, fx.x, fx.y, 0, 0, 0.35, 10, TM, 0); }
    var r = projStep(fx, dt);
    if (r || fx.t > 0.9) {
      fx.done = true; fx.ix = fx.x; fx.iy = fx.y; fx.it = fx.t; fx.life = fx.t + 0.45;
      for (var i = 0; i < 10; i++) { var a = i / 10 * TAU; pAdd(fx, fx.x, fx.y, Math.cos(a) * 200, Math.sin(a) * 200, 0.3, 8, i % 2 ? TM : TM_G, 4); }
    }
  }
  function tboltRender(fx, ctx) {
    ctx.globalCompositeOperation = 'lighter';
    if (!fx.done) {
      var d = Math.cos(fx.ang) >= 0 ? 1 : -1;
      S.glow(ctx, fx.x, fx.y, 28, TM, 0.7);
      ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(fx.x, fx.y); ctx.scale(d, 1);
      ctx.strokeStyle = 'rgba(255,225,140,1)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,200,1)';
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(4, -6); ctx.lineTo(4, 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(160,230,255,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-26, 0, 6, 0, TAU); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.restore();
    } else {
      var q = clamp((fx.t - fx.it) / 0.4, 0, 1);
      ctx.strokeStyle = 'rgba(180,240,255,' + (1 - q) + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(fx.ix, fx.iy, 10 + q * 36, -Math.PI / 2, -Math.PI / 2 + q * TAU); ctx.stroke();
    }
    pDraw(fx, ctx);
  }
  timeDef({
    id: 'time_bolt', name: '시간 화살', icon: '⏱️', cost: 10, cooldown: 0.4,
    desc: '시곗바늘 화살을 쏩니다. 맞은 적은 1.2초간 느려집니다.',
    cast: function (c) {
      var h = handOf(c);
      mk('time_bolt', c, { x: h.x, y: h.y, ang: h.d > 0 ? 0 : Math.PI, speed: 900, turn: 0, r: 10,
        dmgP: 7, dmgM: 12, kx: 160, ky: -100, slow: 1.2, life: 1.4, pmax: 30, update: tboltUpdate, render: tboltRender });
    }
  });

  // K 되감기 — 1.5초 전 위치로 돌아가고 그동안 잃은 체력의 절반(최대 15) 회복. 떠난 자리 주변 적 둔화
  var RW_SLOW_R = 100;
  function rewindUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.started) return;
    fx.started = true;
    var p = mine(fx);
    if (p) {
      p.x = fx.x1; p.y = fx.y1; p.vx = 0; p.vy = 0; p.onGround = false;
      if (fx.heal > 0) p.hp = Math.min(p.maxHp || 100, (+p.hp || 0) + fx.heal);
      p.invulnTimer = Math.max(p.invulnTimer || 0, 0.4);
      hist.length = 0;
    }
    S.statusMutantsCircle(fx, fx.x0 + 17, fx.y0 + 31, RW_SLOW_R, 'slow', 1.5);
    S.statusPlayerCircle(fx, fx.x0 + 17, fx.y0 + 31, RW_SLOW_R, 'slow', 1.5);
    for (var i = 0; i < 14; i++) { var a = i / 14 * TAU; pAdd(fx, fx.x1 + 17 + Math.cos(a) * 60, fx.y1 + 31 + Math.sin(a) * 60, -Math.cos(a) * 180, -Math.sin(a) * 180, 0.35, 8, i % 2 ? TM : TM_G, 0); }
  }
  function ghost(ctx, x, y, a) {
    ctx.fillStyle = 'rgba(140,220,255,' + a + ')';
    ctx.beginPath(); ctx.arc(x + 17, y + 12, 10, 0, TAU); ctx.fill();
    ctx.fillRect(x + 6, y + 22, 22, 26);
    ctx.fillRect(x + 8, y + 48, 7, 14); ctx.fillRect(x + 19, y + 48, 7, 14);
  }
  function clockMark(ctx, x, y, r, a, t, back) {
    ctx.strokeStyle = 'rgba(180,240,255,' + a + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    for (var i = 0; i < 12; i++) {
      var ang = i / 12 * TAU;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(ang) * r * 0.82, y + Math.sin(ang) * r * 0.82); ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r); ctx.stroke();
    }
    var h = -Math.PI / 2 + (back ? -1 : 1) * t * 14;
    ctx.strokeStyle = 'rgba(255,220,140,' + a + ')'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(h) * r * 0.75, y + Math.sin(h) * r * 0.75); ctx.stroke();
  }
  function rewindRender(fx, ctx) {
    var t = fx.t, a = clamp((fx.life - t) / 0.5, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    var pts = fx.pts;
    if (pts.length > 1) {
      ctx.strokeStyle = 'rgba(120,210,255,' + (0.6 * a) + ')'; ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]); ctx.lineDashOffset = t * 60;
      ctx.beginPath();
      for (var i = 0; i < pts.length; i++) { if (i === 0) ctx.moveTo(pts[i].x + 17, pts[i].y + 31); else ctx.lineTo(pts[i].x + 17, pts[i].y + 31); }
      ctx.stroke(); ctx.setLineDash([]);
      for (var j = 0; j < pts.length; j += 2) ghost(ctx, pts[j].x, pts[j].y, 0.22 * a * (j / pts.length + 0.3));
    }
    clockMark(ctx, fx.x0 + 17, fx.y0 + 31, 34 + t * 60, 0.8 * a, t, true);
    clockMark(ctx, fx.x1 + 17, fx.y1 + 31, 40, a, t, true);
    S.glow(ctx, fx.x1 + 17, fx.y1 + 31, 70, TM, 0.5 * a);
    ctx.globalAlpha = 1;
    pDraw(fx, ctx);
  }
  timeDef({
    id: 'time_rewind', name: '되감기', icon: '⏪', cost: 30, cooldown: 6,
    desc: '1.5초 전 위치로 시간을 되감고 그동안 잃은 체력의 절반(최대 15)을 되찾습니다. 떠난 자리의 적은 느려집니다.',
    prepare: function (c) {
      var p = c.p;
      if (hist.length < 3) { toast('되감기: 기록된 시간이 부족합니다'); return false; }
      var s = null, k;
      for (k = 0; k < hist.length; k++) { if (hClock - hist[k].t <= RW_BACK) { s = hist[k]; break; } }
      if (!s) return false;
      var path = hist.slice(k), pts = [], stepN = Math.max(1, Math.ceil(path.length / 10));
      for (var i = path.length - 1; i >= 0; i -= stepN) pts.push([Math.round(path[i].x), Math.round(S.rel(path[i].y))]);
      pts.push([Math.round(s.x), Math.round(S.rel(s.y))]);
      var heal = s.hp > (+p.hp || 0) ? Math.min(15, Math.round((s.hp - p.hp) * 0.5)) : 0;
      return { x0: Math.round(p.x), ry0: Math.round(S.rel(p.y)), x1: Math.round(s.x), ry1: Math.round(S.rel(s.y)), pts: pts, heal: heal };
    },
    cast: function (c) {
      var d = c.data || {};
      var x0 = num(d.x0, c.x), y0 = typeof d.ry0 === 'number' ? S.abs(d.ry0) : c.y;
      var x1 = num(d.x1, x0), y1 = typeof d.ry1 === 'number' ? S.abs(d.ry1) : y0;
      var pts = [], src = Array.isArray(d.pts) ? d.pts.slice(0, 12) : [];
      for (var i = 0; i < src.length; i++) if (src[i] && isFinite(src[i][0]) && isFinite(src[i][1])) pts.push({ x: +src[i][0], y: S.abs(+src[i][1]) });
      mk('time_rewind', c, { x: x1, y: y1, x0: x0, y0: y0, x1: x1, y1: y1, pts: pts, heal: clamp(num(d.heal, 0), 0, 15),
        life: 0.9, pmax: 30, update: rewindUpdate, render: rewindRender });
    }
  });

  // L 초침 베기 — 거대한 시곗바늘이 시전자 주위를 한 바퀴 휩씀
  var HD_R = 190, HD_WIND = 0.08, HD_SWEEP = 0.42;
  function sweepAng(fx) { return ease((fx.t - HD_WIND) / HD_SWEEP) * TAU; }
  function covered(fx, ex, ey) {
    if (fx.t < HD_WIND) return false;
    var a = Math.atan2(ey - fx.y, ex - fx.x);
    var d = (((fx.dir * (a - fx.a0)) % TAU) + TAU) % TAU;
    return d <= sweepAng(fx) + 0.05;
  }
  function handsUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.t < HD_WIND || fx.t > HD_WIND + HD_SWEEP + 0.05) return;
    var kn = function (e, dx, dy, dist) { var n = dist || 1; return { kx: dx / n * 420, ky: -300 }; };
    if (fx.owner === 'local') {
      var ms = S.mutantsInCircle(fx.x, fx.y, HD_R);
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i], mc = center(m);
        if (!covered(fx, mc.x, mc.y)) continue;
        var rect = { x: m.x, y: m.y, w: m.w || 30, h: m.h || 30 };
        if (S.hitMutantsRect(fx, rect, 30, kn).length) S.statusMutantsRect(fx, rect, 'slow', 1.5);
      }
    } else {
      var lp = localP();
      if (lp && alive(lp)) {
        var c = center(lp);
        if (covered(fx, c.x, c.y) && S.hitPlayerCircle(fx, fx.x, fx.y, HD_R, 16, kn)) S.statusPlayerCircle(fx, fx.x, fx.y, HD_R, 'slow', 1.5);
      }
    }
    var a = fx.a0 + fx.dir * sweepAng(fx);
    if (Math.random() < 0.9) pAdd(fx, fx.x + Math.cos(a) * HD_R * rnd(0.5, 1), fx.y + Math.sin(a) * HD_R * rnd(0.5, 1), rnd(-30, 30), rnd(-30, 30), 0.4, rnd(6, 10), Math.random() < 0.5 ? TM : TM_G, 2);
  }
  function handsRender(fx, ctx) {
    var t = fx.t, al = Math.min(1, t / 0.08) * clamp((fx.life - t) / 0.25, 0, 1);
    var sw = t < HD_WIND ? 0 : sweepAng(fx), a = fx.a0 + fx.dir * sw;
    ctx.globalCompositeOperation = 'lighter';
    // 시계판
    rg(ctx, fx.x, fx.y, HD_R, [[0, 'rgba(120,220,255,' + (0.06 * al) + ')'], [0.9, 'rgba(100,200,255,' + (0.12 * al) + ')'], [1, 'rgba(160,230,255,0)']]);
    ctx.strokeStyle = 'rgba(180,240,255,' + (0.7 * al) + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(fx.x, fx.y, HD_R, 0, TAU); ctx.stroke();
    for (var i = 0; i < 12; i++) {
      var ang = i / 12 * TAU;
      ctx.strokeStyle = 'rgba(255,225,150,' + (0.8 * al) + ')'; ctx.lineWidth = i % 3 ? 2 : 4;
      ctx.beginPath(); ctx.moveTo(fx.x + Math.cos(ang) * (HD_R - 16), fx.y + Math.sin(ang) * (HD_R - 16)); ctx.lineTo(fx.x + Math.cos(ang) * HD_R, fx.y + Math.sin(ang) * HD_R); ctx.stroke();
    }
    // 휩쓴 부채꼴
    if (sw > 0.01) {
      ctx.fillStyle = 'rgba(110,210,255,' + (0.22 * al) + ')';
      ctx.beginPath(); ctx.moveTo(fx.x, fx.y);
      var from = fx.dir > 0 ? Math.max(fx.a0, a - 1.6) : Math.min(fx.a0, a + 1.6);
      ctx.arc(fx.x, fx.y, HD_R, from, a, fx.dir < 0); ctx.closePath(); ctx.fill();
    }
    // 분침(긴 금빛) + 시침
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,230,150,' + al + ')'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(fx.x + Math.cos(a) * (HD_R - 6), fx.y + Math.sin(a) * (HD_R - 6)); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,' + al + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(fx.x + Math.cos(a) * (HD_R - 6), fx.y + Math.sin(a) * (HD_R - 6)); ctx.stroke();
    var a2 = fx.a0 + fx.dir * sw * 0.5 + Math.PI;
    ctx.strokeStyle = 'rgba(160,230,255,' + al + ')'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(fx.x, fx.y); ctx.lineTo(fx.x + Math.cos(a2) * HD_R * 0.55, fx.y + Math.sin(a2) * HD_R * 0.55); ctx.stroke();
    ctx.lineCap = 'butt';
    S.glow(ctx, fx.x + Math.cos(a) * (HD_R - 6), fx.y + Math.sin(a) * (HD_R - 6), 30, TM_G, al);
    S.glow(ctx, fx.x, fx.y, 26, TM, al);
    ctx.globalAlpha = 1;
    pDraw(fx, ctx);
  }
  timeDef({
    id: 'time_hands', name: '초침 베기', icon: '🕰️', cost: 38, cooldown: 4.5,
    desc: '거대한 시곗바늘이 주위를 한 바퀴 휩쓸어 베고, 맞은 적을 1.5초간 느리게 합니다.',
    prepare: function (c) {
      c.p.frozen = Math.max(c.p.frozen || 0, HD_WIND + HD_SWEEP); c.p.vx = 0;
      return {};
    },
    cast: function (c) {
      var cc = castCenter(c);
      mk('time_hands', c, { x: cc.x, y: cc.y, a0: -Math.PI / 2, dir: c.facing >= 0 ? 1 : -1,
        life: HD_WIND + HD_SWEEP + 0.35, pmax: 40, update: handsUpdate, render: handsRender });
    }
  });

  // ================================================================ 용족 (dragon)
  var DR = '#ff5a1f', DR_G = '#ffc04a', DR_W = '#fff2c0';
  function dragonDef(o) { o.element = 'dragon'; o.elementName = '용족'; o.rarity = 'hard'; o.color = DR; return S.register(o); }

  // J 용조 — 세 줄기 발톱 베기 (근접)
  function clawRect(fx) { return { x: fx.dir > 0 ? fx.x + 6 : fx.x - 6 - 130, y: fx.y - 46, w: 130, h: 92 }; }
  function clawUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.t < 0.05 || fx.hitDone) return;
    fx.hitDone = true;
    var r = clawRect(fx), kx = fx.dir * 320, ky = -220;
    S.hitMutantsRect(fx, r, 18, kx, ky);
    S.hitPlayerRect(fx, r, 10, kx, ky);
    for (var i = 0; i < 10; i++) pAdd(fx, r.x + rnd(0, r.w), r.y + rnd(10, r.h - 10), fx.dir * rnd(60, 200), rnd(-120, 40), rnd(0.2, 0.4), rnd(5, 9), i % 2 ? DR : DR_G, 2, 300);
  }
  function clawRender(fx, ctx) {
    var t = fx.t;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (var k = 0; k < 3; k++) {
      var lt = t - k * 0.035;
      if (lt <= 0) continue;
      var q = clamp(lt / 0.12, 0, 1), fade = clamp(1 - (lt - 0.1) / 0.18, 0, 1);
      if (fade <= 0) continue;
      var yo = (k - 1) * 24;
      var x0 = fx.x + fx.dir * 12, x1 = fx.x + fx.dir * 136;
      ctx.beginPath();
      var segs = 10, last = Math.max(1, Math.round(segs * q));
      for (var i = 0; i <= last; i++) {
        var u = i / segs;
        var px = lerp(x0, x1, u), py = fx.y + yo - 34 + u * 62 - Math.sin(u * Math.PI) * 18;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(255,120,30,' + (0.6 * fade) + ')'; ctx.lineWidth = 12; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,245,210,' + fade + ')'; ctx.lineWidth = 3.5; ctx.stroke();
    }
    ctx.lineCap = 'butt';
    pDraw(fx, ctx);
  }
  dragonDef({
    id: 'dragon_claw', name: '용조', icon: '🐾', cost: 10, cooldown: 0.45,
    desc: '불타는 용의 발톱으로 앞을 세 번 할퀴는 강력한 근접 공격입니다.',
    cast: function (c) {
      var cc = castCenter(c);
      mk('dragon_claw', c, { x: cc.x, y: cc.y, dir: c.facing >= 0 ? 1 : -1, life: 0.5, pmax: 20, update: clawUpdate, render: clawRender });
    }
  });

  // K 비룡 돌진 — 날개를 펼쳐 앞쪽으로 활공 도약, 부딪힌 적을 날려버림
  var WG_T = 0.3, WG_DIST = 300, WG_H = 60;
  function wingPos(fx, t) {
    var u = clamp(t / WG_T, 0, 1);
    return { x: lerp(fx.x0, fx.x1, ease(u)), y: fx.y0 - Math.sin(u * Math.PI) * WG_H, u: u };
  }
  function wingUpdate(fx, dt) {
    pUpdate(fx, dt);
    var wp = wingPos(fx, fx.t);
    var p = mine(fx);
    if (p && !fx.released) {
      p.x = wp.x - pw(p) / 2; p.y = wp.y - ph(p) / 2; p.vx = 0; p.vy = 0;
      if (wp.u >= 1) { fx.released = true; p.vx = fx.dir * 320; p.vy = -150; }
    }
    if (fx.t < WG_T + 0.02) {
      var r = { x: wp.x - 32, y: wp.y - 50, w: 64, h: 100 }, kx = fx.dir * 520, ky = -380;
      S.hitMutantsRect(fx, r, 16, kx, ky);
      S.hitPlayerRect(fx, r, 9, kx, ky);
      for (var i = 0; i < 2; i++) pAdd(fx, wp.x - fx.dir * rnd(0, 20), wp.y + rnd(-20, 20), -fx.dir * rnd(60, 180), rnd(-40, 40), rnd(0.3, 0.5), rnd(8, 14), Math.random() < 0.5 ? DR : DR_G, 2, -100);
    }
  }
  function drawWingShape(ctx, flap, a) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-30, -60 - 30 * flap, -110, -70 - 40 * flap);
    ctx.quadraticCurveTo(-90, -40, -120, -20 + 10 * flap);
    ctx.quadraticCurveTo(-80, -10, -95, 15);
    ctx.quadraticCurveTo(-50, 0, -40, 20);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, -100, 0, 20);
    g.addColorStop(0, 'rgba(255,200,80,' + (0.75 * a) + ')');
    g.addColorStop(1, 'rgba(220,50,10,' + (0.35 * a) + ')');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,200,' + (0.9 * a) + ')'; ctx.lineWidth = 2; ctx.stroke();
  }
  function wingRender(fx, ctx) {
    var t = fx.t, a = Math.min(1, t / 0.05) * clamp((fx.life - t) / 0.25, 0, 1);
    var wp = wingPos(fx, t);
    ctx.globalCompositeOperation = 'lighter';
    S.glow(ctx, wp.x, wp.y, 60, DR, 0.5 * a);
    ctx.globalAlpha = 1;
    var flap = Math.sin(t * 22);
    ctx.save(); ctx.translate(wp.x, wp.y - 12); ctx.scale(fx.dir, 1);
    drawWingShape(ctx, flap, a);
    ctx.scale(0.8, 0.9); ctx.translate(14, -4);
    drawWingShape(ctx, -flap, a * 0.6);
    ctx.restore();
    pDraw(fx, ctx);
  }
  dragonDef({
    id: 'dragon_wing', name: '비룡 돌진', icon: '🪽', cost: 25, cooldown: 2.8,
    desc: '불꽃 날개를 펼쳐 앞으로 활공 도약하며, 부딪힌 적을 크게 날려 보냅니다.',
    prepare: function (c) {
      var p = c.p;
      var ex = clamp(p.x + c.facing * WG_DIST, 0, worldW() - pw(p));
      p.frozen = Math.max(p.frozen || 0, WG_T); p.invulnTimer = Math.max(p.invulnTimer || 0, 0.2);
      if (S.lockCast) S.lockCast(WG_T);
      return { x0: Math.round(p.x), ex: Math.round(ex), ry: Math.round(S.rel(p.y)) };
    },
    cast: function (c) {
      var d = c.data || {}, w = pw(c.p), h = ph(c.p);
      var x0 = num(d.x0, c.x), ex = num(d.ex, clamp(x0 + c.facing * WG_DIST, 0, worldW() - w));
      var y = typeof d.ry === 'number' ? S.abs(d.ry) : c.y;
      mk('dragon_wing', c, { x0: x0 + w / 2, x1: ex + w / 2, y0: y + h / 2, x: x0 + w / 2, y: y + h / 2,
        dir: c.facing >= 0 ? 1 : -1, life: WG_T + 0.35, pmax: 30, update: wingUpdate, render: wingRender });
      burst(x0 + w / 2, y + h, 10, [DR_G, DR], 240);
    }
  });

  // L 용의 숨결 — 0.85초간 앞쪽 원뿔로 화염을 뿜음 (0.3초마다 피해)
  var BR_W0 = 0.1, BR_W1 = 0.95, BR_L = 310;
  function breathUpdate(fx, dt) {
    pUpdate(fx, dt);
    if (fx.t < BR_W0 || fx.t > BR_W1) return;
    var kx = fx.dir * 160, ky = -120;
    for (var s = 0; s < 3; s++) {
      var hh = lerp(18, 70, (s + 0.5) / 3);
      var x0 = fx.x + fx.dir * (s * BR_L / 3);
      var r = { x: fx.dir > 0 ? x0 : x0 - BR_L / 3, y: fx.y - hh, w: BR_L / 3, h: hh * 2 };
      S.hitMutantsRect(fx, r, 11, kx, ky);
      S.hitPlayerRect(fx, r, 6, kx, ky);
    }
    for (var i = 0; i < 3; i++) {
      var sp = rnd(420, 620), ang = rnd(-0.22, 0.22);
      pAdd(fx, fx.x, fx.y, fx.dir * Math.cos(ang) * sp, Math.sin(ang) * sp, rnd(0.4, 0.55), rnd(10, 18), i === 0 ? DR_W : (i === 1 ? DR_G : DR), 1.2, -120);
    }
    if (fx.owner === 'local') shake(10 * dt);
  }
  function breathRender(fx, ctx) {
    var t = fx.t;
    var k = Math.min(1, (t - BR_W0) / 0.1) * Math.min(1, (BR_W1 - t) / 0.12);
    ctx.globalCompositeOperation = 'lighter';
    if (t < BR_W0) { S.glow(ctx, fx.x, fx.y, 20 + t * 200, DR_G, 0.8); }
    if (k > 0) {
      for (var layer = 0; layer < 3; layer++) {
        var len = BR_L * (0.85 + layer * 0.08), hw = 70 - layer * 18;
        var g = ctx.createLinearGradient(fx.x, 0, fx.x + fx.dir * len, 0);
        var al = k * (0.45 + layer * 0.15);
        g.addColorStop(0, 'rgba(255,250,220,' + al + ')');
        g.addColorStop(0.3, 'rgba(255,200,70,' + al + ')');
        g.addColorStop(0.75, 'rgba(255,90,20,' + al * 0.8 + ')');
        g.addColorStop(1, 'rgba(180,20,0,0)');
        ctx.fillStyle = g;
        var wob = Math.sin(t * 40 + layer * 2) * 8;
        ctx.beginPath();
        ctx.moveTo(fx.x, fx.y - 6);
        ctx.quadraticCurveTo(fx.x + fx.dir * len * 0.5, fx.y - hw * 0.6 + wob, fx.x + fx.dir * len, fx.y - hw + wob);
        ctx.lineTo(fx.x + fx.dir * len, fx.y + hw - wob);
        ctx.quadraticCurveTo(fx.x + fx.dir * len * 0.5, fx.y + hw * 0.6 - wob, fx.x, fx.y + 6);
        ctx.closePath(); ctx.fill();
      }
      S.glow(ctx, fx.x, fx.y, 34, DR_W, k);
      ctx.globalAlpha = 1;
    }
    pDraw(fx, ctx);
  }
  dragonDef({
    id: 'dragon_breath', name: '용의 숨결', icon: '🔥', cost: 40, cooldown: 5,
    desc: '제자리에서 앞쪽으로 거센 용의 화염을 뿜어 범위 안의 적을 계속 불태웁니다.',
    prepare: function (c) {
      c.p.frozen = Math.max(c.p.frozen || 0, BR_W1); c.p.vx = 0;
      if (S.lockCast) S.lockCast(BR_W1);
      return {};
    },
    cast: function (c) {
      var h = handOf(c);
      mk('dragon_breath', c, { x: h.x, y: h.y - 4, dir: h.d, life: BR_W1 + 0.5, rehit: 0.3, pmax: 70,
        update: breathUpdate, render: breathRender });
    }
  });

  // ================================================================ 키트 선언
  var KITS = [
    { element: 'psychic', elementName: '염력', icon: '🧠', ids: ['psy_bolt', 'psy_levitate', 'psychograb', 'psy_storm'],
      meta: { color: PSY, desc: '보이지 않는 힘으로 적을 추적하고, 띄우고, 들어 올려 내던집니다.', rarity: 'hard' } },
    { element: 'void', elementName: '블랙홀', icon: '🕳️', ids: ['void_orb', 'void_phase', 'void_well', 'blackhole'],
      meta: { color: VO, desc: '공간을 찢고 중력을 비틀어 모든 것을 빨아들입니다.', rarity: 'hard' } },
    { element: 'time', elementName: '시간', icon: '⏳', ids: ['time_bolt', 'time_rewind', 'time_hands', 'timestop'],
      meta: { color: TM, desc: '시간을 늦추고, 되감고, 마침내 멈춰 세웁니다.', rarity: 'hard' } },
    { element: 'dragon', elementName: '용족', icon: '🐉', ids: ['dragon_claw', 'dragon_wing', 'dragon_breath', 'dragonsummon'],
      meta: { color: DR, desc: '용의 발톱·날개·숨결을 깨우고 끝내 진짜 용을 부릅니다.', rarity: 'hard' } }
  ];
  for (var ki = 0; ki < KITS.length; ki++) {
    var K = KITS[ki];
    if (typeof S.kit === 'function') {
      try { S.kit(K.element, K.elementName, K.icon, K.ids, K.meta); } catch (e) { if (window.console) console.error('[skills_kit3] kit', e); }
    } else {
      G.pendingKits = G.pendingKits || [];
      G.pendingKits.push(K);
    }
  }
})();
