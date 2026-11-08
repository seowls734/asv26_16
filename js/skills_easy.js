/* 초능력자: 각성 — 쉬운 능력 8종 (Game.Skills.register, rarity 'easy') v3 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};
  var S = G.Skills;
  if (!S || typeof S.register !== 'function') {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[skills_easy] Game.Skills 가 없어 쉬운 능력을 등록하지 않습니다.');
    }
    return;
  }

  var TAU = Math.PI * 2;

  // ---------- 공통 유틸 ----------
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
  function worldW() { return (G.world && G.world.width) || 4200; }
  function localP() { return (G.players && G.players.local) || null; }
  function othersP() { return typeof S.remotePlayers === 'function' ? S.remotePlayers() : []; }
  function byId(id) { return typeof S.playerById === 'function' ? S.playerById(id) : null; }
  function isMe(id) { return typeof S.isMe === 'function' ? S.isMe(id) : false; }
  function isAlive(e) { return !!e && e.alive !== false; }
  function mutList() { return ((G.Mutants && G.Mutants.list) || []).filter(function (q) { return !(q && q.under); }); }
  function findMutant(id) {
    var L = mutList();
    for (var i = 0; i < L.length; i++) { if (L[i] && L[i].id === id && L[i].alive !== false) { return L[i]; } }
    return null;
  }
  function rectsHit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function boxOf(e) { return { x: e.x, y: e.y, w: e.w || 34, h: e.h || 62 }; }
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
  function mk(id, ctx, o) {
    o.skill = id; o.owner = ctx.owner; o.castId = ctx.castId;
    if (ctx.casterId != null) { o.casterId = ctx.casterId; }
    o.t = 0;
    var r = S.addFx(o);
    return r || o;
  }
  // 이 fx 에서 처음으로 영역에 들어온 대상 확인 (상태 1회 적용용)
  function newcomers(fx, rect) {
    var seen = fx._seen || (fx._seen = {});
    var res = { m: false, p: false };
    var L = mutList();
    for (var i = 0; i < L.length; i++) {
      var m = L[i];
      if (!isAlive(m) || seen['m' + m.id] || !rectsHit(rect, m)) { continue; }
      seen['m' + m.id] = 1; res.m = true;
    }
    var lp = localP();
    if (fx.owner === 'remote' && !seen.p && isAlive(lp) && rectsHit(rect, boxOf(lp))) { seen.p = 1; res.p = true; }
    return res;
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

  // =====================================================================
  // 1. 물대포 (water)
  // =====================================================================
  var WC = { len: 380, h: 40, life: 0.5, dmgP: 6, dmgM: 12, kx: 750, ky: -150, grow: 0.09 };
  function wcLen(fx) { return WC.len * clamp(fx.t / WC.grow, 0.05, 1); }
  function wcRect(fx) {
    var L = wcLen(fx);
    return { x: fx.dir > 0 ? fx.x : fx.x - L, y: fx.y - WC.h / 2, w: L, h: WC.h };
  }
  function wcUpdate(fx, dt) {
    var r = wcRect(fx), d = fx.dir;
    S.hitMutantsRect(fx, r, WC.dmgM, d * WC.kx, WC.ky);
    if (S.hitPlayerRect(fx, r, WC.dmgP, d * WC.kx, WC.ky)) {
      var lp = localP();
      if (lp) { burst(lp.x + pw(lp) / 2, lp.y + ph(lp) / 2, 12, ['#bfe6ff', '#5fb4ff', '#ffffff'], 260); }
    }
    remoteFx(fx, r, ['#bfe6ff', '#5fb4ff', '#ffffff'], 12, 0);
    // 물방울 (자체 관리, 최대 40)
    fx.dropT -= dt;
    var L = wcLen(fx);
    if (fx.dropT <= 0 && fx.t < WC.life - 0.08) {
      fx.dropT = 0.018;
      for (var k = 0; k < 2 && fx.drops.length < 40; k++) {
        var s = rnd(0.35, 1);
        fx.drops.push({ x: fx.x + d * L * s, y: fx.y + rnd(-10, 10), vx: d * rnd(120, 380), vy: rnd(-220, 40),
          life: rnd(0.25, 0.45), r: rnd(1.5, 3.4) });
      }
    }
    for (var i = fx.drops.length - 1; i >= 0; i--) {
      var q = fx.drops[i];
      q.life -= dt;
      if (q.life <= 0) { fx.drops.splice(i, 1); continue; }
      q.vy += 900 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
    }
  }
  function wcRender(fx, ctx) {
    var d = fx.dir, L = wcLen(fx);
    var a = fx.t > WC.life - 0.12 ? clamp((WC.life - fx.t) / 0.12, 0, 1) : 1;
    var n = 14, i, s, x, hw, wob;
    ctx.save();
    ctx.globalAlpha = 0.62 * a;
    var g = ctx.createLinearGradient(0, fx.y - 20, 0, fx.y + 20);
    g.addColorStop(0, 'rgba(170,225,255,0.95)');
    g.addColorStop(0.5, 'rgba(60,150,240,0.85)');
    g.addColorStop(1, 'rgba(25,80,190,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (i = 0; i <= n; i++) {
      s = i / n; x = fx.x + d * L * s;
      hw = 7 + 13 * s; wob = Math.sin(fx.t * 46 - s * 9) * 3 * s;
      if (i === 0) { ctx.moveTo(x, fx.y - hw + wob); } else { ctx.lineTo(x, fx.y - hw + wob); }
    }
    for (i = n; i >= 0; i--) {
      s = i / n; x = fx.x + d * L * s;
      hw = 7 + 13 * s; wob = Math.sin(fx.t * 41 - s * 8 + 1.7) * 3 * s;
      ctx.lineTo(x, fx.y + hw + wob);
    }
    ctx.closePath();
    ctx.fill();
    // 하이라이트 물결선
    ctx.globalAlpha = 0.7 * a;
    ctx.strokeStyle = 'rgba(235,250,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (i = 0; i <= n; i++) {
      s = i / n; x = fx.x + d * L * s;
      var yy = fx.y - 3 - 4 * s + Math.sin(fx.t * 52 - s * 11) * 2.5;
      if (i === 0) { ctx.moveTo(x, yy); } else { ctx.lineTo(x, yy); }
    }
    ctx.stroke();
    // 끝부분 물보라
    var tx = fx.x + d * L;
    ctx.fillStyle = 'rgba(220,245,255,0.85)';
    for (i = 0; i < 5; i++) {
      var ang = fx.t * 30 + i * 1.3;
      ctx.globalAlpha = 0.5 * a;
      ctx.beginPath();
      ctx.arc(tx + d * Math.cos(ang) * 8, fx.y + Math.sin(ang * 1.3) * 16, 6 + (i % 3) * 3, 0, TAU);
      ctx.fill();
    }
    // 물방울
    ctx.fillStyle = 'rgba(160,215,255,0.95)';
    for (i = 0; i < fx.drops.length; i++) {
      var q = fx.drops[i];
      ctx.globalAlpha = clamp(q.life / 0.3, 0, 1) * a;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  S.register({
    id: 'watercannon', element: 'water', elementName: '물', name: '물대포', icon: '💧', rarity: 'easy',
    cost: 20, cooldown: 2.5, color: '#3fa9ff',
    desc: '앞쪽으로 강한 물줄기를 뿜어 적을 멀리 밀어냅니다.',
    cast: function (ctx) {
      var h = handOf(ctx);
      mk('watercannon', ctx, { x: h.x, y: h.y, dir: h.d, life: WC.life, drops: [], dropT: 0,
        update: wcUpdate, render: wcRender });
    }
  });

  // =====================================================================
  // 2. 덩굴 속박 (grass)
  // =====================================================================
  var VB = { off: 260, warn: 0.3, dur: 0.8, w: 130, h: 110, dmgP: 5, dmgM: 10, rootP: 1.8, rootM: 2.4 };
  function vbRect(fx) { var g = gy(); return { x: fx.x - VB.w / 2, y: g - VB.h, w: VB.w, h: VB.h }; }
  function vbUpdate(fx) {
    var g = gy();
    fx.y = g - VB.h / 2;
    if (fx.t < VB.warn) { return; }
    var r = vbRect(fx);
    if (!fx.popped) {
      fx.popped = true;
      burst(fx.x, g - 6, 14, ['#5fcf4a', '#2f8a2a', '#7a5a34'], 240);
    }
    S.hitMutantsRect(fx, r, VB.dmgM, 0, 0);
    S.hitPlayerRect(fx, r, VB.dmgP, 0, 0);
    var nc = newcomers(fx, r);
    if (nc.m) { S.statusMutantsRect(fx, r, 'root', VB.rootM); }
    if (nc.p) { S.statusPlayerRect(fx, r, 'root', VB.rootP); }
    remoteFx(fx, r, ['#5fcf4a', '#a6f07a'], 10, 0);
  }
  function bez(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }
  function vbRender(fx, ctx) {
    var g = gy(), i, k;
    ctx.save();
    if (fx.t < VB.warn) {
      var k0 = fx.t / VB.warn;
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 'vine', 'rgba(170,255,140,0.9)', 'rgba(60,180,60,0.45)', fx.x, g, VB.w * 0.55,
        0.35 + 0.35 * Math.sin(fx.t * 40) * 0.5 + 0.3 * k0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(120,230,90,' + (0.4 + 0.5 * k0).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse ? ctx.ellipse(fx.x, g, VB.w / 2, 7, 0, 0, TAU) : ctx.rect(fx.x - VB.w / 2, g - 4, VB.w, 8);
      ctx.stroke();
      ctx.restore();
      return;
    }
    var at = fx.t - VB.warn;
    var grow = clamp(at / 0.12, 0, 1) * clamp((fx.life - fx.t) / 0.15, 0, 1);
    grow = 1 - (1 - grow) * (1 - grow);
    // 흙 둔덕
    ctx.fillStyle = 'rgba(80,58,34,0.85)';
    ctx.beginPath();
    ctx.moveTo(fx.x - VB.w / 2 - 6, g);
    ctx.quadraticCurveTo(fx.x, g - 16 * grow, fx.x + VB.w / 2 + 6, g);
    ctx.closePath();
    ctx.fill();
    for (i = 0; i < fx.stems.length; i++) {
      var st = fx.stems[i];
      var bx = fx.x + st.bx, H = VB.h * st.hm * grow;
      var sway = Math.sin(fx.t * 5 + st.ph) * 6;
      var x1 = bx + st.c1, x2 = bx + st.c2 + sway, x3 = bx + st.lean + sway * 1.5;
      var y1 = g - H * 0.33, y2 = g - H * 0.7, y3 = g - H;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1f5a1c'; ctx.lineWidth = st.wd + 2.5;
      ctx.beginPath(); ctx.moveTo(bx, g); ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3); ctx.stroke();
      ctx.strokeStyle = '#4fae3a'; ctx.lineWidth = st.wd;
      ctx.beginPath(); ctx.moveTo(bx, g); ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3); ctx.stroke();
      // 잎
      for (k = 0; k < st.leaves.length; k++) {
        var lf = st.leaves[k], s = lf.s;
        if (s > grow + 0.05) { continue; }
        var lx = bez(bx, x1, x2, x3, s), ly = bez(g, y1, y2, y3, s);
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(lf.a + Math.sin(fx.t * 6 + lf.a) * 0.15);
        ctx.fillStyle = k % 2 ? '#6fd650' : '#3d9a30';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(lf.len * 0.5, -lf.len * 0.38, lf.len, 0);
        ctx.quadraticCurveTo(lf.len * 0.5, lf.len * 0.38, 0, 0);
        ctx.fill();
        ctx.restore();
      }
      // 가시 끝 꽃눈
      ctx.fillStyle = '#b8f58a';
      ctx.beginPath(); ctx.arc(x3, y3, 2.5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  S.register({
    id: 'vinebind', element: 'grass', elementName: '풀', name: '덩굴 속박', icon: '🌿', rarity: 'easy',
    cost: 25, cooldown: 5, color: '#4fc24a',
    desc: '앞쪽 땅에서 덩굴을 솟구치게 해 닿은 적을 묶어 둡니다.',
    cast: function (ctx) {
      var d = dirOf(ctx.facing);
      var cx = ctx.x + pw(ctx.p) / 2 + d * VB.off;
      var stems = [];
      for (var i = 0; i < 6; i++) {
        var leaves = [];
        for (var k = 0; k < 4; k++) {
          leaves.push({ s: 0.25 + k * 0.17 + rnd(-0.04, 0.04), a: (k % 2 ? -1 : 1) * rnd(0.4, 1.1) - Math.PI / 2 + (k % 2 ? Math.PI : 0),
            len: rnd(9, 15) });
        }
        stems.push({ bx: -VB.w / 2 + 10 + i * ((VB.w - 20) / 5) + rnd(-6, 6), c1: rnd(-24, 24), c2: rnd(-28, 28),
          lean: rnd(-26, 26), hm: rnd(0.72, 1), ph: rnd(0, TAU), wd: rnd(3, 5), leaves: leaves });
      }
      mk('vinebind', ctx, { x: cx, y: gy() - VB.h / 2, life: VB.warn + VB.dur, stems: stems,
        update: vbUpdate, render: vbRender });
    }
  });

  // =====================================================================
  // 3. 연쇄 번개 (electric)
  // =====================================================================
  var CB = { range: 420, hop: 250, max: 3, life: 0.35, dmgP: 12, dmgM: 20, stun: 0.3 };
  function cbPrepare(ctx) {
    var d = dirOf(ctx.facing);
    var cur = { x: ctx.x + pw(ctx.p) / 2, y: ctx.y + ph(ctx.p) * 0.45 };
    var cands = [], i, L = mutList();
    for (i = 0; i < L.length; i++) {
      var m = L[i];
      if (!isAlive(m)) { continue; }
      cands.push({ kind: 'mutant', id: m.id, x: m.x + (m.w || 40) / 2, y: m.y + (m.h || 30) / 2 });
    }
    var others = othersP();
    for (i = 0; i < others.length; i++) {
      var rp = others[i];
      if (!isAlive(rp) || rp.id == null) { continue; }
      cands.push({ kind: 'player', id: rp.id, x: rp.x + pw(rp) / 2, y: rp.y + ph(rp) / 2 });
    }
    var chain = [], used = [];
    for (var k = 0; k < CB.max; k++) {
      var best = -1, bd = 1e9, lim = k === 0 ? CB.range : CB.hop;
      for (i = 0; i < cands.length; i++) {
        if (used[i]) { continue; }
        var c = cands[i], dx = c.x - cur.x, dy = c.y - cur.y;
        if (k === 0 && dx * d < -8) { continue; }   // 바라보는 쪽 반원
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= lim && dist < bd) { bd = dist; best = i; }
      }
      if (best < 0) { break; }
      used[best] = true;
      var b = cands[best];
      chain.push({ kind: b.kind, id: b.id, x: Math.round(b.x), ry: Math.round(S.rel(b.y)) });
      cur = b;
    }
    return { chain: chain };
  }
  // 대상 현재 위치 해석 (해석 실패 시 전송 위치)
  function cbResolve(fx, e) {
    var tgt = null;
    if (e.kind === 'mutant') { tgt = findMutant(e.id); }
    else if (e.kind === 'player') { tgt = byId(e.id); }
    if (tgt && isAlive(tgt)) {
      e.px = tgt.x + (tgt.w || 34) / 2; e.py = tgt.y + (tgt.h || 62) / 2;
    } else if (typeof e.px !== 'number') {
      e.px = e.x; e.py = e.kind === 'none' ? e.ay : S.abs(e.ry);
    }
  }
  function cbJag(fx) {
    fx.jag = [];
    for (var i = 0; i < fx.chain.length; i++) {
      var seg = [];
      for (var k = 0; k < 9; k++) { seg.push(rnd(-1, 1)); }
      seg.fork = Math.random() < 0.7 ? { s: rnd(0.25, 0.75), a: rnd(-1, 1), l: rnd(18, 40) } : null;
      fx.jag.push(seg);
    }
  }
  function cbUpdate(fx, dt) {
    var i, e;
    for (i = 0; i < fx.chain.length; i++) { cbResolve(fx, fx.chain[i]); }
    fx.jagT -= dt;
    if (fx.jagT <= 0) { fx.jagT = 0.035; cbJag(fx); }
    if (fx.done) { return; }
    fx.done = true;
    var d = fx.dir, hitMe = false;
    for (i = 0; i < fx.chain.length; i++) {
      e = fx.chain[i];
      burst(e.px, e.py, 8, ['#ffffff', '#bfe0ff', '#7fb0ff'], 260);
      if (e.kind === 'mutant' && fx.owner === 'local') {
        S.hitMutantsRect(fx, { x: e.px - 8, y: e.py - 8, w: 16, h: 16 }, CB.dmgM, d * 180, -200);
      } else if (e.kind === 'player' && isMe(e.id)) { hitMe = true; }   // 지정 대상이 나일 때만
    }
    if (hitMe && fx.owner === 'remote') {
      var lp = localP();
      if (isAlive(lp)) {
        var r = boxOf(lp);
        S.hitPlayerRect(fx, r, CB.dmgP, d * 160, -180);
        S.statusPlayerRect(fx, r, 'stun', CB.stun);
      }
    }
  }
  function cbStroke(ctx, fx, lw, col) {
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    ctx.beginPath();
    var sx = fx.x, sy = fx.y;
    for (var i = 0; i < fx.chain.length; i++) {
      var e = fx.chain[i], seg = fx.jag[i] || [];
      var ex = e.px, ey = e.py, dx = ex - sx, dy = ey - sy;
      var len = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / len, ny = dx / len;
      var amp = Math.min(22, len * 0.12);
      ctx.moveTo(sx, sy);
      for (var k = 1; k <= 9; k++) {
        var s = k / 10, o = (seg[k - 1] || 0) * amp;
        ctx.lineTo(sx + dx * s + nx * o, sy + dy * s + ny * o);
      }
      ctx.lineTo(ex, ey);
      if (seg.fork) {
        var f = seg.fork, fx0 = sx + dx * f.s, fy0 = sy + dy * f.s;
        ctx.moveTo(fx0, fy0);
        ctx.lineTo(fx0 + (dx / len) * f.l * 0.6 + nx * f.a * f.l, fy0 + (dy / len) * f.l * 0.6 + ny * f.a * f.l);
      }
      sx = ex; sy = ey;
    }
    ctx.stroke();
  }
  function cbRender(fx, ctx) {
    if (!fx.jag) { return; }
    var a = (1 - fx.t / fx.life) * (0.75 + 0.25 * Math.random());
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.globalAlpha = clamp(a * 0.35, 0, 1); cbStroke(ctx, fx, 9, 'rgba(90,140,255,1)');
    ctx.globalAlpha = clamp(a * 0.85, 0, 1); cbStroke(ctx, fx, 3.2, 'rgba(160,205,255,1)');
    ctx.globalAlpha = clamp(a, 0, 1); cbStroke(ctx, fx, 1.3, 'rgba(255,255,255,1)');
    glow(ctx, 'bolt', 'rgba(255,255,255,1)', 'rgba(120,170,255,0.6)', fx.x, fx.y, 26, a);
    for (var i = 0; i < fx.chain.length; i++) {
      var e = fx.chain[i];
      glow(ctx, 'bolt', 'rgba(255,255,255,1)', 'rgba(120,170,255,0.6)', e.px, e.py, 38, a);
    }
    ctx.restore();
  }
  S.register({
    id: 'chainbolt', element: 'electric', elementName: '전기', name: '연쇄 번개', icon: '⚡', rarity: 'easy',
    cost: 30, cooldown: 4, color: '#ffe14a',
    desc: '가까운 적에게 번개를 떨어뜨려 최대 3명까지 연쇄로 감전시킵니다.',
    prepare: cbPrepare,
    cast: function (ctx) {
      var h = handOf(ctx), raw = (ctx.data && ctx.data.chain) || [], chain = [];
      if (Object.prototype.toString.call(raw) === '[object Array]') {
        for (var i = 0; i < raw.length && chain.length < CB.max; i++) {
          var e = raw[i];
          if (!e || (e.kind !== 'mutant' && e.kind !== 'player')) { continue; }
          chain.push({ kind: e.kind, id: e.id, x: num(e.x, h.x), ry: num(e.ry, 0) });
        }
      }
      if (!chain.length) {   // 대상 없음 → 앞쪽 지면으로 헛방 번개
        chain.push({ kind: 'none', id: null, x: h.x + h.d * CB.range * 0.55, ry: 0, ay: gy() });
      }
      mk('chainbolt', ctx, { x: h.x, y: h.y, dir: h.d, life: CB.life, chain: chain, jagT: 0, done: false,
        update: cbUpdate, render: cbRender });
    }
  });

  // =====================================================================
  // 4. 얼음 창 (ice)
  // =====================================================================
  var IS = { speed: 720, life: 1.2, r: 10, dmgP: 7, dmgM: 12, slow: 2, kx: 140, ky: -60 };
  function isShatter(fx) {
    burst(fx.x, fx.y, 12, ['#ffffff', '#cdf2ff', '#7fd4ff'], 240);
  }
  function isUpdate(fx, dt) {
    fx.x += fx.vx * dt;
    var r = fx.r, rect = { x: fx.x - r, y: fx.y - r, w: r * 2, h: r * 2 }, d = fx.dir;
    // 돌연변이 충돌은 owner 와 무관하게 양쪽에서 동일하게 소멸 (피해는 헬퍼가 owner 판정, slow 는 권한측)
    if (anyMutantIn(rect)) {
      S.hitMutantsRect(fx, rect, IS.dmgM, d * IS.kx, IS.ky);
      S.statusMutantsRect(fx, rect, 'slow', IS.slow);
      isShatter(fx); fx.dead = true; return;
    }
    if (fx.owner === 'remote') {
      if (S.hitPlayerRect(fx, rect, IS.dmgP, d * IS.kx, IS.ky)) {
        S.statusPlayerRect(fx, rect, 'slow', IS.slow);
        isShatter(fx); fx.dead = true; return;
      }
    }
    // 다른(제3자 포함) 플레이어에 닿으면 시각적으로 소멸 — 피해는 그 플레이어의 클라이언트가 처리
    if (typeof S.remoteTouchRect === 'function' && S.remoteTouchRect(rect, fx)) {
      isShatter(fx); fx.dead = true; return;
    }
    if (fx.x < -50 || fx.x > worldW() + 50) { fx.dead = true; return; }
    fx.trailT -= dt;
    if (fx.trailT <= 0) { fx.trailT = 0.06; burst(fx.x - d * 12, fx.y, 1, ['#e8fbff', '#9fe0ff'], 40); }
  }
  function isRender(fx, ctx) {
    var d = fx.dir;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 'ice', 'rgba(230,250,255,0.9)', 'rgba(110,200,255,0.35)', fx.x, fx.y, 26, 0.8);
    // 서리 꼬리
    var tg = ctx.createLinearGradient(fx.x, 0, fx.x - d * 70, 0);
    tg.addColorStop(0, 'rgba(180,235,255,0.55)');
    tg.addColorStop(1, 'rgba(180,235,255,0)');
    ctx.fillStyle = tg;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(fx.x - d * 6, fx.y - 5); ctx.lineTo(fx.x - d * 70, fx.y); ctx.lineTo(fx.x - d * 6, fx.y + 5);
    ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(fx.x, fx.y);
    ctx.scale(d, 1);
    var g = ctx.createLinearGradient(0, -6, 0, 6);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#a8e6ff');
    g.addColorStop(1, '#4aa8e0');
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(18, 0); ctx.lineTo(5, -6); ctx.lineTo(-10, -4.5); ctx.lineTo(-17, 0);
    ctx.lineTo(-10, 4.5); ctx.lineTo(5, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // 면 분할선
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-17, 0); ctx.moveTo(5, -6); ctx.lineTo(0, 0); ctx.lineTo(5, 6); ctx.stroke();
    // 작은 곁결정
    ctx.fillStyle = 'rgba(200,240,255,0.9)';
    ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(-9, -10); ctx.lineTo(-8, -3.5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(-9, 10); ctx.lineTo(-8, 3.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  S.register({
    id: 'iceshard', element: 'ice', elementName: '얼음', name: '얼음 창', icon: '❄️', rarity: 'easy',
    cost: 15, cooldown: 1.2, color: '#7fd8ff',
    desc: '빠른 얼음 창을 던져 맞은 적을 2초간 느리게 만듭니다.',
    cast: function (ctx) {
      var h = handOf(ctx);
      mk('iceshard', ctx, { x: h.x + h.d * 8, y: h.y, r: IS.r, vx: h.d * IS.speed, dir: h.d, life: IS.life,
        projectile: true, trailT: 0, update: isUpdate, render: isRender });
    }
  });

  // =====================================================================
  // 5. 회오리 (wind)
  // =====================================================================
  var TN = { w: 80, h: 160, speed: 280, life: 1.6, dmgP: 4, dmgM: 8, kx: 120, ky: -720, rehit: 0.5 };
  function tnUpdate(fx, dt) {
    fx.x += fx.dir * TN.speed * dt;
    var feet = S.abs(fx.feetRel);
    fx.y = feet - TN.h / 2;
    var rect = { x: fx.x - TN.w / 2, y: feet - TN.h, w: TN.w, h: TN.h }, d = fx.dir;
    S.hitMutantsRect(fx, rect, TN.dmgM, d * TN.kx, TN.ky);
    S.hitPlayerRect(fx, rect, TN.dmgP, d * TN.kx, TN.ky);
    remoteFx(fx, rect, ['#e6f4f2', '#a9c8c4'], 8, TN.rehit);
    fx.debT -= dt;
    if (fx.debT <= 0) { fx.debT = 0.07; burst(fx.x + rnd(-30, 30), feet - 4, 1, ['#9a9283', '#cfd8d4', '#6f6a5e'], 160); }
  }
  function tnRender(fx, ctx) {
    var feet = S.abs(fx.feetRel);
    var k = clamp(fx.t / 0.15, 0, 1) * clamp((fx.life - fx.t) / 0.22, 0, 1);
    if (k <= 0) { return; }
    var H = TN.h * (0.4 + 0.6 * k), n = 9, i, s, yy, rr, sx;
    ctx.save();
    // 반투명 깔때기
    var g = ctx.createLinearGradient(0, feet - H, 0, feet);
    g.addColorStop(0, 'rgba(220,236,236,0.28)');
    g.addColorStop(1, 'rgba(160,180,175,0.12)');
    ctx.fillStyle = g;
    ctx.globalAlpha = k;
    ctx.beginPath();
    ctx.moveTo(fx.x - 8, feet);
    for (i = 0; i <= n; i++) {
      s = i / n; yy = feet - H * s; rr = 8 + 32 * s; sx = Math.sin(fx.t * 6 + s * 3) * 7 * s;
      ctx.lineTo(fx.x + sx - rr, yy);
    }
    for (i = n; i >= 0; i--) {
      s = i / n; yy = feet - H * s; rr = 8 + 32 * s; sx = Math.sin(fx.t * 6 + s * 3) * 7 * s;
      ctx.lineTo(fx.x + sx + rr, yy);
    }
    ctx.closePath(); ctx.fill();
    // 나선 줄무늬
    ctx.lineCap = 'round';
    for (var st = 0; st < 4; st++) {
      ctx.strokeStyle = st % 2 ? 'rgba(255,255,255,0.65)' : 'rgba(190,215,212,0.6)';
      ctx.lineWidth = st % 2 ? 2 : 3;
      ctx.beginPath();
      var m = 26;
      for (i = 0; i <= m; i++) {
        s = i / m; yy = feet - H * s; rr = 8 + 32 * s; sx = Math.sin(fx.t * 6 + s * 3) * 7 * s;
        var ang = fx.t * 15 * fx.dir + st * (TAU / 4) + s * 7;
        var px = fx.x + sx + Math.cos(ang) * rr, py = yy + Math.sin(ang) * rr * 0.18;
        if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
    }
    // 고리 테두리
    ctx.strokeStyle = 'rgba(240,250,250,0.35)';
    ctx.lineWidth = 1.5;
    for (i = 2; i <= n; i += 2) {
      s = i / n; yy = feet - H * s; rr = 8 + 32 * s; sx = Math.sin(fx.t * 6 + s * 3) * 7 * s;
      ctx.beginPath();
      if (ctx.ellipse) { ctx.ellipse(fx.x + sx, yy, rr, rr * 0.16, 0, 0, TAU); }
      ctx.stroke();
    }
    // 휩쓸린 잔해
    ctx.fillStyle = 'rgba(110,100,85,0.9)';
    for (i = 0; i < 6; i++) {
      var a2 = fx.t * 11 * fx.dir + i * 1.05, s2 = (i * 0.17 + fx.t * 0.6) % 1;
      var r2 = 8 + 32 * s2;
      ctx.fillRect(fx.x + Math.cos(a2) * r2 - 1.5, feet - H * s2 + Math.sin(a2) * r2 * 0.18 - 1.5, 3, 3);
    }
    ctx.restore();
  }
  S.register({
    id: 'tornado', element: 'wind', elementName: '바람', name: '회오리', icon: '🌪️', rarity: 'easy',
    cost: 30, cooldown: 4, color: '#9fe3d6',
    desc: '앞으로 나아가는 회오리를 일으켜 닿은 적을 공중으로 띄웁니다.',
    cast: function (ctx) {
      var d = dirOf(ctx.facing), feet = ctx.y + ph(ctx.p);
      mk('tornado', ctx, { x: ctx.x + pw(ctx.p) / 2 + d * 50, y: feet - TN.h / 2, feetRel: S.rel(feet), dir: d,
        life: TN.life, rehit: TN.rehit, debT: 0, update: tnUpdate, render: tnRender });
    }
  });

  // =====================================================================
  // 6. 바위 가시 (rock) — 가시 1개당 fx 1개 (각각 별도 피해)
  // =====================================================================
  var RS = { n: 5, gap: 70, step: 0.08, dur: 0.5, w: 50, h: 90, dmgP: 8, dmgM: 14, kx: 150, ky: -520 };
  function rsRise(fx) {
    var at = fx.t - fx.delay;
    if (at < 0) { return 0; }
    var up = clamp(at / 0.06, 0, 1), down = clamp((fx.life - fx.t) / 0.1, 0, 1);
    return Math.min(up, down);
  }
  function rsUpdate(fx) {
    if (fx.t < fx.delay) { return; }
    var g = gy();
    if (!fx.popped) {
      fx.popped = true;
      burst(fx.x, g - 4, 9, ['#8a7f70', '#b5a892', '#5e564b'], 260);
      if (fx.idx === 0) { shake(3); }
    }
    var rise = rsRise(fx);
    if (rise < 0.3) { return; }
    var rect = { x: fx.x - RS.w / 2, y: g - RS.h * rise, w: RS.w, h: RS.h * rise }, d = fx.dir;
    S.hitMutantsRect(fx, rect, RS.dmgM, d * RS.kx, RS.ky);
    S.hitPlayerRect(fx, rect, RS.dmgP, d * RS.kx, RS.ky);
    remoteFx(fx, rect, ['#8a7f70', '#b5a892'], 8, 0);
  }
  function rsRender(fx, ctx) {
    var g = gy(), i;
    ctx.save();
    if (fx.t < fx.delay) {   // 짧은 균열 예고
      ctx.strokeStyle = 'rgba(60,48,36,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx.x - 16, g - 1); ctx.lineTo(fx.x - 5, g - 3); ctx.lineTo(fx.x + 3, g - 1); ctx.lineTo(fx.x + 15, g - 3);
      ctx.stroke();
      ctx.restore();
      return;
    }
    var rise = rsRise(fx);
    ctx.translate(fx.x, g);
    ctx.scale(1, rise);
    var pts = fx.pts;
    var grd = ctx.createLinearGradient(0, -RS.h, 0, 0);
    grd.addColorStop(0, '#b7ab97');
    grd.addColorStop(0.5, '#867a69');
    grd.addColorStop(1, '#4f473d');
    // 곁가시
    ctx.fillStyle = '#6b6153';
    ctx.beginPath();
    ctx.moveTo(fx.side[0], 0); ctx.lineTo(fx.side[1], -fx.side[2]); ctx.lineTo(fx.side[3], 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = grd;
    ctx.strokeStyle = '#2f2a24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (i = 2; i < pts.length; i += 2) { ctx.lineTo(pts[i], pts[i + 1]); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 밝은 면 (왼쪽 절반 각진 면)
    ctx.fillStyle = 'rgba(230,220,200,0.28)';
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[4], pts[5]); ctx.lineTo(pts[6], pts[7]);
    ctx.lineTo(pts[6] * 0.3, -RS.h * 0.35); ctx.lineTo(-4, 0);
    ctx.closePath(); ctx.fill();
    // 금
    ctx.strokeStyle = 'rgba(40,34,28,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(fx.crack, -RS.h * 0.15); ctx.lineTo(fx.crack + 5, -RS.h * 0.4); ctx.lineTo(fx.crack - 2, -RS.h * 0.55); ctx.stroke();
    ctx.restore();
  }
  S.register({
    id: 'rockspike', element: 'rock', elementName: '바위', name: '바위 가시', icon: '🪨', rarity: 'easy',
    cost: 35, cooldown: 4.5, color: '#b08a5a',
    desc: '앞쪽 땅에서 바위 가시 다섯 개를 차례로 솟구치게 합니다.',
    cast: function (ctx) {
      var d = dirOf(ctx.facing), cx0 = ctx.x + pw(ctx.p) / 2;
      for (var i = 0; i < RS.n; i++) {
        var hw = RS.w / 2, tip = rnd(-6, 6);
        var pts = [-hw, 0, -hw + rnd(5, 9), -RS.h * rnd(0.3, 0.38), -hw * 0.4 + rnd(-3, 3), -RS.h * rnd(0.66, 0.74), tip, -RS.h,
          hw * 0.4 + rnd(-3, 3), -RS.h * rnd(0.6, 0.7), hw - rnd(5, 9), -RS.h * rnd(0.28, 0.36), hw, 0];
        var sd = Math.random() < 0.5 ? -1 : 1;
        mk('rockspike', ctx, { x: cx0 + d * RS.gap * (i + 1), y: gy() - RS.h / 2, idx: i, dir: d,
          delay: i * RS.step, life: i * RS.step + RS.dur, pts: pts,
          side: [sd * (hw - 4), sd * (hw + 6), RS.h * rnd(0.3, 0.45), sd * (hw + 12)], crack: rnd(-8, 6),
          update: rsUpdate, render: rsRender });
      }
    }
  });

  // =====================================================================
  // 7. 모래 폭풍 (sand)
  // =====================================================================
  var SS = { w: 300, h: 200, life: 3, dmgP: 3, dmgM: 6, rehit: 0.5, slow: 0.6, stEvery: 0.15 };
  var overlayStamp = null;
  function ssRect(fx) { var feet = S.abs(fx.feetRel); return { x: fx.left, y: feet - SS.h, w: SS.w, h: SS.h }; }
  function ssUpdate(fx, dt) {
    var r = ssRect(fx);
    fx.y = r.y + SS.h / 2;
    S.hitMutantsRect(fx, r, SS.dmgM, 0, 0);
    S.hitPlayerRect(fx, r, SS.dmgP, 0, 0);
    fx.stT -= dt;
    if (fx.stT <= 0) {   // slow 0.6초를 계속 갱신
      fx.stT = SS.stEvery;
      S.statusMutantsRect(fx, r, 'slow', SS.slow);
      S.statusPlayerRect(fx, r, 'slow', SS.slow);
    }
    var lp = localP();
    fx.inside = fx.owner === 'remote' && isAlive(lp) && rectsHit(r, boxOf(lp));
    remoteFx(fx, r, ['#e0c48a', '#c9a060'], 6, SS.rehit);
  }
  function ssRender(fx, ctx) {
    var r = ssRect(fx);
    var a = clamp(fx.t / 0.3, 0, 1) * clamp((fx.life - fx.t) / 0.5, 0, 1);
    if (a <= 0) { return; }
    var i, q, px, py;
    ctx.save();
    var puff = sprite('sand', 'rgba(222,186,120,0.9)', 'rgba(196,150,80,0.45)');
    for (i = 0; i < fx.grains.length; i++) {
      q = fx.grains[i];
      px = r.x + ((q.u * SS.w + fx.t * q.sp * fx.dir) % SS.w + SS.w) % SS.w;
      py = r.y + SS.h * q.v + Math.sin(fx.t * 2.2 + q.ph) * 12;
      var rr = q.r * (0.85 + 0.15 * Math.sin(fx.t * 3 + q.ph));
      ctx.globalAlpha = a * q.al;
      if (puff) { ctx.drawImage(puff, px - rr, py - rr, rr * 2, rr * 2); }
      else { ctx.fillStyle = 'rgba(210,170,100,0.4)'; ctx.beginPath(); ctx.arc(px, py, rr * 0.6, 0, TAU); ctx.fill(); }
    }
    // 빠른 모래 알갱이 줄
    ctx.fillStyle = '#f0d9a6';
    for (i = 0; i < 40; i++) {
      var u = ((i * 0.6180339 + fx.t * (0.9 + (i % 5) * 0.25) * fx.dir) % 1 + 1) % 1;
      var v = (i * 0.3819660) % 1;
      ctx.globalAlpha = a * 0.75;
      ctx.fillRect(r.x + u * SS.w, r.y + v * SS.h + Math.sin(fx.t * 5 + i) * 6, 3, 1.2);
    }
    // 피해자측 화면 필터
    if (fx.inside) {
      var stamp = typeof G.time === 'number' ? G.time : null;
      if (stamp === null || stamp !== overlayStamp) {
        overlayStamp = stamp;
        var cam = G.camera || { x: 0, y: 0 }, W = G.width || 1280, H = G.height || 720;
        ctx.globalAlpha = 0.42 * a;
        ctx.fillStyle = 'rgb(196,152,84)';
        ctx.fillRect(cam.x - 80, cam.y - 80, W + 160, H + 160);
        ctx.globalAlpha = 0.35 * a;
        ctx.fillStyle = '#f3dcae';
        for (i = 0; i < 28; i++) {
          var su = ((i * 0.7548776 + fx.t * (1.4 + (i % 4) * 0.3) * fx.dir) % 1 + 1) % 1;
          var sv = (i * 0.5698403) % 1;
          ctx.fillRect(cam.x + su * W, cam.y + sv * H, 26, 1.5);
        }
      }
    }
    ctx.restore();
  }
  S.register({
    id: 'sandstorm', element: 'sand', elementName: '모래', name: '모래 폭풍', icon: '🏜️', rarity: 'easy',
    cost: 30, cooldown: 6, color: '#e0b46a',
    desc: '앞쪽에 모래 폭풍을 일으켜 안의 적을 느리게 하고 계속 깎아냅니다.',
    cast: function (ctx) {
      var d = dirOf(ctx.facing), feet = ctx.y + ph(ctx.p), cx = ctx.x + pw(ctx.p) / 2;
      var left = d > 0 ? cx + 10 : cx - 10 - SS.w;
      var grains = [];
      for (var i = 0; i < 34; i++) {
        grains.push({ u: Math.random(), v: rnd(0.12, 0.92), r: rnd(22, 42), ph: rnd(0, TAU), sp: rnd(40, 110), al: rnd(0.25, 0.5) });
      }
      mk('sandstorm', ctx, { x: left + SS.w / 2, y: feet - SS.h / 2, left: left, feetRel: S.rel(feet), dir: d,
        life: SS.life, rehit: SS.rehit, grains: grains, stT: 0, inside: false,
        update: ssUpdate, render: ssRender });
    }
  });

  // =====================================================================
  // 8. 신체강화 (body)
  // =====================================================================
  var BB = { dur: 6, r: 120, dmgP: 4, dmgM: 8, kx: 420, ky: -300, wave: 0.35 };
  function bbKnock(e, dx) { return { kx: (dx < 0 ? -1 : 1) * BB.kx, ky: BB.ky }; }
  function bbUpdate(fx, dt) {
    var c = S.caster(fx);
    if (!isAlive(c)) { fx.dead = true; return; }
    fx.x = c.x + pw(c) / 2; fx.y = c.y + ph(c) / 2;
    if (fx.owner === 'local' && fx.t > 0.3 && !(c.boostTimer > 0)) { fx.dead = true; return; }  // 리스폰 등으로 해제됨
    if (!fx.waveDone) {
      fx.waveDone = true;
      fx.wx = fx.x; fx.wy = fx.y;
      S.hitMutantsCircle(fx, fx.wx, fx.wy, BB.r, BB.dmgM, bbKnock);
      S.hitPlayerCircle(fx, fx.wx, fx.wy, BB.r, BB.dmgP, bbKnock);
      remoteFx(fx, { x: fx.wx - BB.r * 0.75, y: fx.wy - BB.r * 0.75, w: BB.r * 1.5, h: BB.r * 1.5 }, ['#ff6a50', '#ffb08a'], 10, 0);
      burst(fx.wx, fx.wy + 20, 16, ['#ff5a40', '#ff9a6a', '#ffd0b0'], 320);
      shake(5);
    }
    fx.embT -= dt;
    if (fx.embT <= 0) { fx.embT = 0.14; burst(fx.x + rnd(-14, 14), fx.y + rnd(-10, 26), 1, ['#ff5a40', '#ff8a5a'], 60); }
  }
  function bbRender(fx, ctx) {
    var c = S.caster(fx);
    if (!isAlive(c)) { return; }
    var a = clamp((fx.life - fx.t) / 0.5, 0, 1) * clamp(fx.t / 0.15, 0, 1);
    var pulse = 0.5 + 0.5 * Math.sin(fx.t * 8);
    var i;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 충격파
    if (fx.t < BB.wave && fx.waveDone) {
      var k = fx.t / BB.wave, e = 1 - (1 - k) * (1 - k);
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = 'rgba(255,90,60,1)';
      ctx.lineWidth = 10 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(fx.wx, fx.wy, BB.r * e, 0, TAU); ctx.stroke();
      glow(ctx, 'boost', 'rgba(255,200,170,1)', 'rgba(255,60,40,0.5)', fx.wx, fx.wy, BB.r * e, (1 - k) * 0.6);
    }
    if (a > 0) {
      glow(ctx, 'boost', 'rgba(255,200,170,1)', 'rgba(255,60,40,0.5)', fx.x, fx.y, 46 + pulse * 10, a * (0.35 + 0.2 * pulse));
      // 일렁이는 오라 윤곽
      ctx.globalAlpha = a * (0.55 + 0.3 * pulse);
      ctx.strokeStyle = 'rgba(255,80,55,1)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      var n = 28;
      for (i = 0; i <= n; i++) {
        var ang = (i / n) * TAU;
        var rad = 1 + 0.12 * Math.sin(ang * 7 + fx.t * 12) + 0.06 * pulse;
        var px = fx.x + Math.cos(ang) * 28 * rad;
        var py = fx.y + Math.sin(ang) * 42 * rad - (Math.sin(ang) < 0 ? 6 * (1 + Math.sin(fx.t * 10 + ang * 3)) : 0);
        if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
      // 솟아오르는 힘줄 줄기
      ctx.strokeStyle = 'rgba(255,130,90,1)';
      ctx.lineWidth = 2;
      for (i = 0; i < 6; i++) {
        var ph2 = (fx.t * 1.6 + i / 6) % 1;
        var sx = fx.x + (i - 2.5) * 9;
        ctx.globalAlpha = a * (1 - ph2) * 0.8;
        ctx.beginPath();
        ctx.moveTo(sx, fx.y + 30 - ph2 * 60);
        ctx.lineTo(sx + Math.sin(fx.t * 9 + i) * 3, fx.y + 18 - ph2 * 60);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  S.register({
    id: 'bodyboost', element: 'body', elementName: '신체강화', name: '신체강화', icon: '💪', rarity: 'easy',
    cost: 35, cooldown: 12, color: '#ff5a4a',
    desc: '6초간 몸을 강화해 더 빠르고 높이 뛰며 받는 피해를 줄입니다.',
    cast: function (ctx) {
      if (ctx.owner === 'local' && ctx.p) { ctx.p.boostTimer = BB.dur; }
      var w = pw(ctx.p), h = ph(ctx.p);
      mk('bodyboost', ctx, { x: ctx.x + w / 2, y: ctx.y + h / 2, life: BB.dur, waveDone: false, embT: 0,
        update: bbUpdate, render: bbRender });
    }
  });
})();
