/* 초능력자: 각성 — 기술 프레임워크 (Game.Skills) + 능력 키트 (Skills.kit) + 장착 슬롯 (Game.Powers) + 불꽃 4종  v4 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};
  var hasOwn = Object.prototype.hasOwnProperty;

  // ======================================================================
  // 공통 수치
  // ======================================================================
  var CAST_TIME = 0.25;
  var MAX_PARTS = 420;           // 불꽃 자체 파티클 상한
  var MAX_FX = 1200;             // 활성 효과 상한 (초과 시 가장 오래된 것부터 제거)
  var PULL_MAX = 620;            // 끌어당김으로 올릴 수 있는 최대 속도 (px/s)
  var PULL_DRIFT = 220;          // 끌어당김 보조 위치 이동 상한 (px/s) — AI/입력 감속을 이기기 위한 약한 직접 이동
  var KEYS = ['KeyJ', 'KeyK', 'KeyL', 'KeyI'];
  var KEY_LABELS = ['J', 'K', 'L', 'I'];
  var DEFAULT_SLOTS = ['fireball', 'flamedash', 'pillar', 'inferno'];

  // 불꽃 수치 (v2 고정값)
  var FB_SPEED = 820, FB_LIFE = 1.4, FB_R = 12, FB_DMG_P = 9, FB_DMG_M = 15, FB_KX = 260, FB_KY = -160;
  var DASH_TIME = 0.18, DASH_DIST = 230, DASH_INVULN = 0.3, TRAIL_LIFE = 1.2, TRAIL_TICK = 0.4,
      TRAIL_DMG_P = 4, TRAIL_DMG_M = 8, TRAIL_H = 34;
  var PIL_OFFSET = 220, PIL_WARN = 0.45, PIL_W = 90, PIL_H = 300, PIL_TIME = 0.5,
      PIL_DMG_P = 22, PIL_DMG_M = 35, PIL_KY = -900;
  var INF_CHARGE = 0.3, INF_R = 230, INF_DMG_P = 28, INF_DMG_M = 45, INF_KX = 820, INF_KY = -620, INF_SHAKE = 16,
      INF_BOOM = 0.5;

  // ======================================================================
  // 유틸
  // ======================================================================
  var clock = 0;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function worldW() { return (G.world && G.world.width) || 4200; }
  function groundY() {
    if (G.world && typeof G.world.groundY === 'number' && G.world.groundY > 0) { return G.world.groundY; }
    return (G.height || 700) * 0.82;
  }
  function rel(y) { return y - groundY(); }
  function abs(ry) { return groundY() + (+ry || 0); }
  function localP() { return (G.players && G.players.local) || null; }
  // 다른 플레이어 전부 (8인 개인전)
  function othersP() {
    var P = G.players;
    if (!P) { return []; }
    if (typeof P.list === 'function') {
      try { var l = P.list(); if (Array.isArray(l)) { return l; } } catch (e) { /* 무시 */ }
    }
    var out = [], o = P.others;
    if (o && typeof o === 'object') { for (var k in o) { if (hasOwn.call(o, k) && o[k]) { out.push(o[k]); } } }
    return out;
  }
  function playerById(id) {
    if (id == null) { return null; }
    var P = G.players;
    if (!P) { return null; }
    if (typeof P.byId === 'function') { try { return P.byId(id) || null; } catch (e) { return null; } }
    var lp = P.local;
    if (lp && lp.id === id) { return lp; }
    return (P.others && hasOwn.call(P.others, id) && P.others[id]) || null;
  }
  // 내 net id (연습 모드 = 로컬 플레이어 id, 기본 'h')
  function myId() {
    var pv = G.players && G.players.pov;
    if (pv && pv.id != null) { return pv.id; }   // 봇 시점 시뮬레이션 중
    if (G.Net && G.Net.myId != null && G.Net.mode !== 'offline') { return G.Net.myId; }
    var lp = localP();
    if (lp && lp.id != null) { return lp.id; }
    return (G.Net && G.Net.myId != null) ? G.Net.myId : 'h';
  }
  function isMe(id) {
    if (id == null) { return false; }
    var lp = localP();
    return id === myId() || (!!lp && lp.id != null && id === lp.id);
  }
  // 호환: "가장 가까운 다른 플레이어" (살아 있는 쪽 우선)
  function remoteP() {
    var list = othersP(), lp = localP(), best = null, bd = Infinity, bestDead = null;
    var lx = lp ? lp.x + (lp.w || 34) / 2 : 0, ly = lp ? lp.y + (lp.h || 62) / 2 : 0;
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (!q) { continue; }
      if (q.alive === false) { if (!bestDead) { bestDead = q; } continue; }
      var dx = q.x + (q.w || 34) / 2 - lx, dy = q.y + (q.h || 62) / 2 - ly, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = q; }
    }
    return best || bestDead;
  }
  function mutantList() { return ((G.Mutants && G.Mutants.list) || []).filter(function (q) { return !(q && q.under); }); }
  function alive(e) { return !!e && e.alive !== false; }
  function shake(a) { if (typeof G.shake === 'function') { G.shake(a); } }
  function send(msg) { if (G.Net && typeof G.Net.send === 'function') { G.Net.send(msg); } }
  function emit(name, data) {
    if (G.events && typeof G.events.emit === 'function') {
      try { G.events.emit(name, data); } catch (e) { /* 무시 */ }
    }
  }
  function isAuthority() {
    if (G.Mutants && typeof G.Mutants.isAuthority === 'function') { return !!G.Mutants.isAuthority(); }
    return !!((G.Net && G.Net.isHost) || G.mode === 'practice');
  }
  // ---- 봇 그림자 시뮬레이션 태그 ----
  // curTag = 지금 실행 중인 시전/효과의 태그 {pov: 시점 플레이어, cs: 봇 시전자 그림자, bm: 봇 시전 표시용 본체}
  // addFx 는 새 효과에 이 태그를 물려준다.
  var curTag = null;
  function povP() { return (G.players && G.players.pov) || null; }
  function withPov(p, fn) {
    if (p && G.players && typeof G.players.withPov === 'function') { return G.players.withPov(p, fn); }
    return fn();
  }
  // 돌연변이 상태이상/끌어당김: 시전 1회당 한 인스턴스만 (피격 그림자, 봇 표시용 본체 제외)
  function mutAuth() {
    if (!isAuthority()) { return false; }
    if (curTag && (curTag.bm || (curTag.pov && !curTag.cs))) { return false; }
    return true;
  }
  function rectHit(a, b) {
    if (typeof G.rectHit === 'function') { return G.rectHit(a, b); }
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function circleRect(cx, cy, r, e) {
    var nx = clamp(cx, e.x, e.x + e.w), ny = clamp(cy, e.y, e.y + e.h);
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }
  function validRect(r) { return !!r && isFinite(r.x) && isFinite(r.y) && isFinite(r.w) && isFinite(r.h); }
  function handPos(p) {
    var dir = p.facing >= 0 ? 1 : -1;
    var w = p.w || 34, h = p.h || 62;
    return { x: p.x + w / 2 + dir * (w / 2 + 6), y: p.y + h * 0.42, dir: dir };
  }
  // 발 아래 착지면 (발판 위면 발판 top, 아니면 지면)
  function surfaceBelow(cx, feetY) {
    var best = groundY();
    var pl = (G.world && !G.world.platformsLocked && G.world.platforms) || [];
    for (var i = 0; i < pl.length; i++) {
      var q = pl[i];
      if (!q || cx < q.x || cx > q.x + q.w) { continue; }
      if (q.y >= feetY - 6 && q.y < best) { best = q.y; }
    }
    return best;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function logErr(where, e) {
    if (typeof console !== 'undefined' && console.error) { console.error('[Skills] ' + where, e); }
  }

  // 색 파싱 → [r,g,b]
  function parseColor(c) {
    if (Array.isArray(c) && c.length >= 3) { return [c[0] | 0, c[1] | 0, c[2] | 0]; }
    if (typeof c !== 'string') { return [255, 255, 255]; }
    var s = c.trim(), m;
    if (s.charAt(0) === '#') {
      s = s.slice(1);
      if (s.length === 3 || s.length === 4) {
        return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)];
      }
      if (s.length >= 6) {
        return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
      }
    }
    m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
    if (m) { return [+m[1] | 0, +m[2] | 0, +m[3] | 0]; }
    return [255, 255, 255];
  }
  function fixRgb(a) {
    return [clamp(isFinite(a[0]) ? a[0] : 255, 0, 255) | 0, clamp(isFinite(a[1]) ? a[1] : 255, 0, 255) | 0,
      clamp(isFinite(a[2]) ? a[2] : 255, 0, 255) | 0];
  }

  // ======================================================================
  // 판정 공통 (hitSet / rehit)
  // ======================================================================
  var anonKey = 0;
  function keyOf(m) {
    if (m.id !== undefined && m.id !== null) { return m.id; }
    if (m._skKey === undefined) { m._skKey = '_a' + (++anonKey); }
    return m._skKey;
  }
  // fx.hitSet[key] = 마지막 피해 시각(clock). fx.rehit > 0 이면 그 간격 후 재피해 허용
  function tryHit(fx, key) {
    if (!fx.hitSet || typeof fx.hitSet !== 'object') { fx.hitSet = {}; }
    if (!hasOwn.call(fx.hitSet, key)) { fx.hitSet[key] = clock; return true; }
    var re = +fx.rehit || 0;
    var last = fx.hitSet[key];
    if (re > 0 && (typeof last !== 'number' || clock - last >= re - 1e-6)) { fx.hitSet[key] = clock; return true; }
    return false;
  }
  // knock: function(e, dx, dy, dist) → {kx,ky} | {kx,ky} | 숫자(바깥 방향 세기) | 없음(0,0)
  function resolveKnock(knock, e, cx, cy) {
    var ex = e.x + e.w / 2, ey = e.y + e.h / 2;
    var dx = ex - cx, dy = ey - cy, dist = Math.sqrt(dx * dx + dy * dy);
    var k = knock;
    if (typeof k === 'function') {
      try { k = k(e, dx, dy, dist); } catch (err) { logErr('knock', err); k = null; }
    }
    if (typeof k === 'number') {
      return { kx: (dx < 0 ? -1 : 1) * k, ky: -Math.abs(k) * 0.5 };
    }
    if (!k || typeof k !== 'object') { return { kx: 0, ky: 0 }; }
    return { kx: num(+k.kx, 0), ky: num(+k.ky, 0) };
  }
  // rect 헬퍼의 kx,ky: 숫자 두 개, 또는 kx 자리에 knock 함수/객체 (관대하게)
  function rectKnock(kx, ky) {
    if (typeof kx === 'function' || (kx && typeof kx === 'object')) { return kx; }
    return { kx: +kx || 0, ky: +ky || 0 };
  }
  function doHitMutant(m, dmg, kx, ky, fx) {
    if (G.Mutants && typeof G.Mutants.hit === 'function') {
      G.Mutants.hit(m, dmg, kx, ky, { skill: fx.skill, castId: fx.castId, by: attackerOf(fx) });
    }
  }
  function hitMutantsBy(fx, test, dmg, knock, cx, cy, limit) {
    var out = [];
    if (!fx || fx.owner !== 'local') { return out; }
    if (fx._pov && !fx._cs) { return out; }          // 피격 시점 그림자는 돌연변이를 치지 않음
    var ms = mutantList().slice();
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (!alive(m) || !test(m)) { continue; }
      if (!tryHit(fx, keyOf(m))) { continue; }
      var k = resolveKnock(knock, m, cx, cy);
      var type = m.type;
      doHitMutant(m, +dmg || 0, k.kx, k.ky, fx);
      emit('mutantHitByMe', { type: type, skill: fx.skill, castId: fx.castId });
      out.push(m);
      if (limit && out.length >= limit) { break; }
    }
    return out;
  }
  // ---- castId → 시전자 net id ----
  var casterIds = {}, casterKeys = [];
  var MAX_CASTERS = 600;
  function noteCaster(castId, id) {
    if (castId == null || id == null) { return; }
    if (!hasOwn.call(casterIds, castId)) {
      casterKeys.push(castId);
      if (casterKeys.length > MAX_CASTERS) { delete casterIds[casterKeys.shift()]; }
    }
    casterIds[castId] = id;
  }
  // fx 의 책임자 net id (원격: 시전자, 로컬: 나)
  function attackerOf(fx) {
    if (!fx) { return null; }
    if (fx.casterId != null) { return fx.casterId; }
    if (fx.castId != null && hasOwn.call(casterIds, fx.castId)) { return casterIds[fx.castId]; }
    if (fx.owner !== 'remote') { return myId(); }
    return null;
  }
  function casterOf(fx) {
    if (!fx) { return null; }
    if (fx.owner !== 'remote') { return localP(); }
    var id = attackerOf(fx);
    var p = id != null ? playerById(id) : null;
    if (p && p !== localP()) { return p; }
    return (fx.p && fx.p !== localP()) ? fx.p : null;
  }
  function hitPlayerBy(fx, test, dmg, knock, cx, cy) {
    if (!fx || fx.owner !== 'remote' || G.bossMode) { return false; }   // 보스전: PvP 없음
    var lp = localP();
    if (!alive(lp) || !test(lp)) { return false; }
    if (!tryHit(fx, 'player')) { return false; }
    var k = resolveKnock(knock, lp, cx, cy);
    var by = attackerOf(fx);
    if (typeof G.damagePlayer === 'function') {
      if (by != null) { G.damagePlayer(+dmg || 0, k.kx, k.ky, by); } else { G.damagePlayer(+dmg || 0, k.kx, k.ky); }
    }
    return true;
  }
  function statusMutantsBy(test, kind, secs) {
    var out = [];
    if (!mutAuth()) { return out; }
    var ms = mutantList();
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (!alive(m) || !test(m)) { continue; }
      if (G.Mutants && typeof G.Mutants.status === 'function') { G.Mutants.status(m, kind, secs); }
      out.push(m);
    }
    return out;
  }
  var PLAYER_STATUS = { slow: 'slowTimer', root: 'rootTimer', stun: 'frozen', freeze: 'frozen', frozen: 'frozen', boost: 'boostTimer' };
  function applyPlayerStatus(p, kind, secs) {
    var f = hasOwn.call(PLAYER_STATUS, kind) ? PLAYER_STATUS[kind] : null;
    if (!f || !p) { return false; }
    p[f] = Math.max(+p[f] || 0, +secs || 0);
    return true;
  }
  function statusPlayerBy(fx, test, kind, secs) {
    if (!fx || fx.owner !== 'remote' || G.bossMode) { return false; }   // 보스전: PvP 없음
    var lp = localP();
    if (!alive(lp) || !test(lp)) { return false; }
    return applyPlayerStatus(lp, kind, secs);
  }
  function hyp(a, b) { return Math.sqrt(a * a + b * b); }
  function pullEntity(e, cx, cy, accel, dt) {
    var ex = e.x + e.w / 2, ey = e.y + e.h / 2;
    var dx = cx - ex, dy = cy - ey, d = hyp(dx, dy);
    var ovx = +e.vx || 0, ovy = +e.vy || 0;
    if (d < 8) { e.vx = ovx * 0.9; e.vy = ovy * 0.9; return; }
    var nx = dx / d, ny = dy / d;
    var nvx = ovx + nx * accel * dt, nvy = ovy + ny * accel * dt;
    var os = hyp(ovx, ovy), ns = hyp(nvx, nvy), cap = Math.max(PULL_MAX, os);
    if (ns > cap && ns > 0) { nvx *= cap / ns; nvy *= cap / ns; }
    e.vx = nvx; e.vy = nvy;
    var drift = Math.min(d, Math.min(PULL_DRIFT, Math.abs(accel) * 0.12) * dt);
    e.x += nx * drift;
    e.y += ny * drift;
    if (ny < -0.3 && e.onGround) { e.onGround = false; }
  }

  // ======================================================================
  // 글로우 스프라이트 (공개: Skills.sprite / Skills.glow)
  // ======================================================================
  var spriteCache = {}, spriteCount = 0;
  function canMakeCanvas() { return typeof document !== 'undefined' && !!document.createElement; }
  function makeGlowCanvas(c0, c1, c2) {
    if (!canMakeCanvas()) { return null; }
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var x = c.getContext && c.getContext('2d');
    if (!x || !x.createRadialGradient) { return null; }
    var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, c0);
    g.addColorStop(0.35, c1);
    g.addColorStop(0.7, c2);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return c;
  }
  // 흰 코어 → color → 투명 원형 글로우 64×64 캔버스 (캐시). document 없으면 null
  function sprite(color) {
    var key = typeof color === 'string' ? color : String(color);
    if (hasOwn.call(spriteCache, key)) { return spriteCache[key]; }
    var rgb = fixRgb(parseColor(color));
    var s = rgb.join(',');
    var wr = Math.round(rgb[0] + (255 - rgb[0]) * 0.75), wg = Math.round(rgb[1] + (255 - rgb[1]) * 0.75),
        wb = Math.round(rgb[2] + (255 - rgb[2]) * 0.75);
    var c = makeGlowCanvas('rgba(' + wr + ',' + wg + ',' + wb + ',1)', 'rgba(' + s + ',.8)', 'rgba(' + s + ',.3)');
    if (spriteCount < 96) { spriteCache[key] = c; spriteCount++; }
    return c;
  }
  // 스프라이트로 원형 글로우 그리기 (ctx 의 globalAlpha 를 설정함)
  function glowColor(ctx, x, y, r, color, a) {
    if (!ctx || !(r > 0.5)) { return; }
    a = a == null ? 1 : a;
    if (a <= 0.01) { return; }
    var spr = sprite(color);
    ctx.globalAlpha = clamp(a, 0, 1);
    if (spr) {
      ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = 'rgba(' + fixRgb(parseColor(color)).join(',') + ',0.6)';
      ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ======================================================================
  // Game.Skills
  // ======================================================================
  var S = {
    defs: {},
    order: [],
    fx: [],

    register: function (def) {
      if (!def || typeof def.id !== 'string' || !def.id) { logErr('register', 'id 없음'); return null; }
      if (typeof def.cost !== 'number' || !isFinite(def.cost)) { def.cost = 0; }
      if (typeof def.cooldown !== 'number' || !isFinite(def.cooldown)) { def.cooldown = 0; }
      if (!def.name) { def.name = def.id; }
      if (!def.icon) { def.icon = '✨'; }
      if (!def.color) { def.color = '#ffffff'; }
      if (!def.rarity) { def.rarity = 'easy'; }
      if (!def.element) { def.element = 'none'; }
      if (!def.elementName) { def.elementName = def.element; }
      if (!def.desc) { def.desc = ''; }
      if (!hasOwn.call(S.defs, def.id)) { S.order.push(def.id); }
      S.defs[def.id] = def;
      return def;
    },

    addFx: function (fx) {
      if (!fx || typeof fx !== 'object') { return fx; }
      if (fx.owner !== 'remote') { fx.owner = 'local'; }
      if (curTag) {
        if (curTag.pov && !fx._pov) { fx._pov = curTag.pov; }
        if (curTag.cs) { fx._cs = true; }
        if (curTag.bm) { fx._bm = true; }
      }
      if (fx.casterId == null) {
        var cid = attackerOf(fx);
        if (cid != null) { fx.casterId = cid; }
      }
      if (typeof fx.t !== 'number' || !isFinite(fx.t)) { fx.t = 0; }
      if (typeof fx.life !== 'number' || !(fx.life > 0)) { fx.life = 10; }
      if (!fx.hitSet || typeof fx.hitSet !== 'object') { fx.hitSet = {}; }
      fx.dead = !!fx.dead;
      if (S.fx.length >= MAX_FX) { removeFx(0); }
      S.fx.push(fx);
      return fx;
    },

    // ---- 피해 ----
    hitMutantsRect: function (fx, rect, dmg, kx, ky) {
      if (!validRect(rect)) { return []; }
      return hitMutantsBy(fx, function (m) { return rectHit(rect, m); }, dmg, rectKnock(kx, ky),
        rect.x + rect.w / 2, rect.y + rect.h / 2, 0);
    },
    hitMutantsCircle: function (fx, cx, cy, r, dmg, knock) {
      return hitMutantsBy(fx, function (m) { return circleRect(cx, cy, r, m); }, dmg, knock, cx, cy, 0);
    },
    hitPlayerRect: function (fx, rect, dmg, kx, ky) {
      if (!validRect(rect)) { return false; }
      return hitPlayerBy(fx, function (p) { return rectHit(rect, p); }, dmg, rectKnock(kx, ky),
        rect.x + rect.w / 2, rect.y + rect.h / 2);
    },
    hitPlayerCircle: function (fx, cx, cy, r, dmg, knock) {
      return hitPlayerBy(fx, function (p) { return circleRect(cx, cy, r, p); }, dmg, knock, cx, cy);
    },
    // 지정 대상 피해: targetId 가 나일 때만 (원격 fx), 판정 없이 적용. knock 은 {kx,ky} 또는 숫자/함수
    hitPlayerTarget: function (fx, targetId, dmg, kx, ky) {
      if (!isMe(targetId)) { return false; }
      var lp = localP();
      return hitPlayerBy(fx, function () { return true; }, dmg, rectKnock(kx, ky),
        lp ? lp.x + (lp.w || 34) / 2 : 0, lp ? lp.y + (lp.h || 62) / 2 : 0);
    },

    // ---- 상태이상 (타이머 = max(현재, secs), 호출할 때마다 갱신. hitSet 무관) ----
    statusMutantsRect: function (fx, rect, kind, secs) {
      if (!validRect(rect)) { return []; }
      return statusMutantsBy(function (m) { return rectHit(rect, m); }, kind, secs);
    },
    statusMutantsCircle: function (fx, cx, cy, r, kind, secs) {
      return statusMutantsBy(function (m) { return circleRect(cx, cy, r, m); }, kind, secs);
    },
    statusPlayerRect: function (fx, rect, kind, secs) {
      if (!validRect(rect)) { return false; }
      return statusPlayerBy(fx, function (p) { return rectHit(rect, p); }, kind, secs);
    },
    statusPlayerCircle: function (fx, cx, cy, r, kind, secs) {
      return statusPlayerBy(fx, function (p) { return circleRect(cx, cy, r, p); }, kind, secs);
    },

    // ---- 끌어당김 ----
    pullMutants: function (fx, cx, cy, r, accel, dt) {
      var out = [];
      if (!mutAuth() || !(dt > 0)) { return out; }
      var ms = mutantList();
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (!alive(m) || !circleRect(cx, cy, r, m)) { continue; }
        pullEntity(m, cx, cy, +accel || 0, Math.min(dt, 0.1));
        out.push(m);
      }
      return out;
    },
    pullPlayer: function (fx, cx, cy, r, accel, dt) {
      if (!fx || fx.owner !== 'remote' || !(dt > 0) || G.bossMode) { return false; }
      var lp = localP();
      if (!alive(lp) || !circleRect(cx, cy, r, lp)) { return false; }
      pullEntity(lp, cx, cy, +accel || 0, Math.min(dt, 0.1));
      return true;
    },

    // ---- 조회 ----
    // 다른 플레이어 중 rect 에 닿은 첫 번째 (시각효과용) 또는 null. fx(원격)를 주면 그 시전자는 제외
    remoteTouchRect: function (rect, fx) {
      if (!validRect(rect)) { return null; }
      var list = othersP(), ex = fx && fx.owner === 'remote' ? casterOf(fx) : null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] !== ex && alive(list[i]) && rectHit(rect, list[i])) { return list[i]; }
      }
      return null;
    },
    remoteTouchAll: function (rect, fx) {
      var out = [];
      if (!validRect(rect)) { return out; }
      var list = othersP(), ex = fx && fx.owner === 'remote' ? casterOf(fx) : null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] !== ex && alive(list[i]) && rectHit(rect, list[i])) { out.push(list[i]); }
      }
      return out;
    },
    remotePlayers: othersP,
    mutantsInCircle: function (cx, cy, r) {
      var out = [];
      var ms = mutantList();
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (alive(m) && circleRect(cx, cy, r, m)) {
          var dx = m.x + m.w / 2 - cx, dy = m.y + m.h / 2 - cy;
          out.push({ m: m, d: dx * dx + dy * dy });
        }
      }
      out.sort(function (a, b) { return a.d - b.d; });
      return out.map(function (o) { return o.m; });
    },
    caster: casterOf,
    casterOf: casterOf,
    attackerOf: attackerOf,
    playerById: playerById,
    myId: myId,
    isMe: isMe,              // (id) → 이 id 가 나(로컬 플레이어)인가
    groundY: groundY,
    rel: rel,
    abs: abs,
    burst: function (x, y, n, colors, speed) {
      if (typeof G.spawnParticles !== 'function') { return; }
      n = n == null ? 12 : n;
      var list = Array.isArray(colors) ? colors : [colors || '#ffffff'];
      if (!list.length) { list = ['#ffffff']; }
      var per = Math.max(1, Math.ceil(n / list.length));
      for (var i = 0; i < list.length; i++) { G.spawnParticles(x, y, per, list[i], speed); }
    },

    // ---- 추가 헬퍼 (명세 외, 기술 에이전트용) ----
    sprite: sprite,                      // (color) → 캐시된 글로우 캔버스 64×64 또는 null
    glow: glowColor,                     // (ctx, x, y, r, color, alpha) 'lighter' 와 함께 쓰면 좋음
    isAuthority: isAuthority,
    localPlayer: localP,
    remotePlayer: remoteP,
    rectHit: rectHit,
    circleRect: circleRect,
    surfaceBelow: surfaceBelow,          // (cx, feetY) → 발 아래 착지면 y
    handPos: handPos,                    // (p) → {x, y, dir}
    shake: shake,
    now: function () { return clock; },  // 프레임워크 시계 (초)
    lockCast: function (secs) { setLock(localP(), secs); }, // 시전자 시전 잠금 (봇 시점이면 그 봇)
    statusLocal: function (kind, secs) { return applyPlayerStatus(localP(), kind, secs); }, // 로컬 플레이어 직접
    reset: function () { resetFx(); }
  };

  function tagOf(f) { return (f._pov || f._cs || f._bm) ? { pov: f._pov || null, cs: !!f._cs, bm: !!f._bm } : null; }
  // 그림자 효과의 시점 봇이 게임에서 빠졌는가
  function povGone(f) {
    var v = f._pov;
    if (!v) { return false; }
    var o = G.players && G.players.others;
    return !o || o[v.id] !== v;
  }
  function runFx(f, fn) {
    var prev = curTag;
    curTag = tagOf(f);
    try {
      if (f._pov) { withPov(f._pov, fn); } else { fn(); }
    } finally { curTag = prev; }
  }
  function removeFx(i) {
    var f = S.fx[i];
    S.fx.splice(i, 1);
    if (f && typeof f.end === 'function' && !povGone(f)) {
      try { runFx(f, function () { f.end(f); }); } catch (e) { logErr('end', e); }
    }
  }
  function resetFx() { S.fx.length = 0; }

  function updateFx(dt) {
    var list = S.fx, i, f;
    for (i = 0; i < list.length; i++) {
      f = list[i];
      if (!f || f.dead) { continue; }
      f.t += dt;
      if (f._pov && povGone(f)) { f.dead = true; f.end = null; continue; }
      if (typeof f.update === 'function') {
        try { runFx(f, function () { f.update(f, dt); }); } catch (e) { logErr('update ' + f.skill, e); f.dead = true; }
      }
      if (f.t >= f.life) { f.dead = true; }
    }
    for (i = list.length - 1; i >= 0; i--) {
      if (!list[i] || list[i].dead) { removeFx(i); }
    }
  }
  function renderFx(ctx) {
    var list = S.fx;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f || f.dead || f._pov || f._cs || typeof f.render !== 'function') { continue; }   // 그림자는 그리지 않음
      ctx.save();
      try { f.render(f, ctx); } catch (e) { logErr('render ' + f.skill, e); f.render = null; }
      ctx.restore();
    }
  }

  // ======================================================================
  // 불꽃 전용 파티클/그래픽 (v2 그대로)
  // ======================================================================
  var rings = [], parts = [];
  var dash = null;                    // 로컬 화염 질주 진행 상태
  var hand = {}; // 플레이어 id → 손 불꽃 남은 시간
  var castLock = 0;

  var SPR = null; // [흰노랑, 노랑주황, 주황, 빨강]
  function makeSprites() {
    if (SPR !== null) { return; }
    SPR = [];
    if (!canMakeCanvas()) { return; }
    var stops = [
      ['rgba(255,255,240,1)', 'rgba(255,236,140,.85)', 'rgba(255,170,40,.35)'],
      ['rgba(255,240,170,1)', 'rgba(255,190,60,.8)', 'rgba(255,110,20,.3)'],
      ['rgba(255,190,90,1)', 'rgba(255,120,30,.75)', 'rgba(220,50,10,.28)'],
      ['rgba(255,120,60,.95)', 'rgba(220,50,15,.65)', 'rgba(140,20,5,.22)']
    ];
    for (var i = 0; i < stops.length; i++) {
      var c = makeGlowCanvas(stops[i][0], stops[i][1], stops[i][2]);
      if (!c) { SPR = []; return; }
      SPR.push(c);
    }
  }
  var FALLBACK_COL = ['rgba(255,250,210,', 'rgba(255,200,80,', 'rgba(255,130,30,', 'rgba(220,50,15,'];
  function glow(ctx, x, y, r, tier, a) {
    if (r <= 0.5 || a <= 0.01) { return; }
    tier = clamp(tier | 0, 0, 3);
    ctx.globalAlpha = clamp(a, 0, 1);
    if (SPR && SPR.length === 4) {
      ctx.drawImage(SPR[tier], x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = FALLBACK_COL[tier] + '0.6)';
      ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  function addPart(o) { if (parts.length < MAX_PARTS && !povP()) { parts.push(o); } }
  function ember(x, y, vx, vy, life, size) {
    addPart({ k: 'f', x: x, y: y, vx: vx, vy: vy, life: life, max: life, size: size, grav: -120, drag: 2.2 });
  }
  function spark(x, y, vx, vy, life) {
    addPart({ k: 's', x: x, y: y, vx: vx, vy: vy, life: life, max: life, size: 2, grav: 700, drag: 0.6 });
  }
  function smoke(x, y, vx, vy, life, size) {
    addPart({ k: 'm', x: x, y: y, vx: vx, vy: vy, life: life, max: life, size: size, grav: -60, drag: 1.4 });
  }
  function fireBurst(x, y, n, speed) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, s = rnd(0.3, 1) * speed;
      if (i % 3 === 0) { spark(x, y, Math.cos(a) * s * 1.3, Math.sin(a) * s * 1.3 - 120, rnd(0.3, 0.7)); }
      else { ember(x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.25, 0.6), rnd(8, 18)); }
    }
    for (var j = 0; j < Math.ceil(n / 5); j++) {
      smoke(x + rnd(-10, 10), y + rnd(-10, 10), rnd(-40, 40), rnd(-80, -20), rnd(0.7, 1.2), rnd(14, 26));
    }
  }
  function ring(x, y, r0, r1, life, width, tier) {
    if (povP()) { return; }
    rings.push({ x: x, y: y, r0: r0, r1: r1, life: life, max: life, width: width, tier: tier || 1 });
  }
  function sparkOn(e) { fireBurst(e.x + e.w / 2, e.y + e.h / 2, 8, 200); }
  function handKey(who) {
    if (who && typeof who === 'object') {
      var p = who.p && typeof who.p === 'object' ? who.p : who;     // cast ctx 또는 플레이어
      if (p === localP()) { return 'local'; }
      if (p && p.id != null) { return 'id:' + p.id; }
      return who.owner === 'remote' ? 'id:?' : 'local';
    }
    return who === 'remote' ? 'id:?' : 'local';
  }
  function setHand(who, t) { if (!povP()) { hand[handKey(who)] = t; } }
  // 다른 플레이어(시전자 제외) 중 test 에 걸리는 첫 번째
  function otherTouched(fx, test) {
    var list = othersP(), me = fx && fx.owner === 'remote' ? casterOf(fx) : null;
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      if (q !== me && alive(q) && test(q)) { return q; }
    }
    return null;
  }
  // 원격 플레이어 접촉 시각효과 (플레이어별 간격 interval, 0 이면 1회)
  function remoteVis(fx, test, interval, fn) {
    if (fx.owner !== 'local') { return false; }
    var list = othersP(), any = false;
    if (!fx._visBy || typeof fx._visBy !== 'object') { fx._visBy = {}; }
    for (var i = 0; i < list.length; i++) {
      var rp = list[i];
      if (!alive(rp) || !test(rp)) { continue; }
      var key = rp.id != null ? String(rp.id) : ('_' + i);
      var last = fx._visBy[key];
      if (last !== undefined && !(interval > 0 && clock - last >= interval)) { continue; }
      fx._visBy[key] = clock;
      fn(rp);
      any = true;
    }
    return any;
  }

  // ---------- 화염구 ----------
  function fireballUpdate(b, dt) {
    b.hist.unshift(b.x, b.y);
    if (b.hist.length > 16) { b.hist.length = 16; }
    b.x += b.dir * FB_SPEED * dt;
    if (Math.random() < 0.9) { ember(b.x - b.dir * 6, b.y + rnd(-5, 5), -b.dir * rnd(40, 120), rnd(-50, 30), rnd(0.2, 0.4), rnd(7, 13)); }
    if (Math.random() < 0.25) { smoke(b.x - b.dir * 14, b.y, -b.dir * 30, -30, rnd(0.5, 0.8), rnd(8, 14)); }
    var ww = worldW();
    if (b.t >= b.life || b.x < -60 || b.x > ww + 60) { b.dead = true; b._quiet = true; return; }
    var hit = false;
    if (b.owner === 'local') {
      hit = hitMutantsBy(b, function (m) { return circleRect(b.x, b.y, FB_R, m); }, FB_DMG_M,
        { kx: b.dir * FB_KX, ky: FB_KY }, b.x, b.y, 1).length > 0;
      if (!hit && otherTouched(b, function (e) { return circleRect(b.x, b.y, FB_R, e); })) { hit = true; } // 시각효과만
    } else {
      hit = S.hitPlayerCircle(b, b.x, b.y, FB_R, FB_DMG_P, { kx: b.dir * FB_KX, ky: FB_KY });
      // 다른 제3자에게 맞은 것도 시각적으로 소멸 (피해는 그 클라이언트가 직접 처리)
      if (!hit && otherTouched(b, function (e) { return circleRect(b.x, b.y, FB_R, e); })) { hit = true; }
    }
    if (hit) {
      b.dead = true;
      fireballImpact(b);
    }
  }
  function fireballImpact(b) {
    if (b._impacted) { return; }
    b._impacted = true;
    fireBurst(b.x, b.y, 14, 260);
    ring(b.x, b.y, 6, 48, 0.25, 4, 1);
    if (b.owner === 'local') { shake(2); }
  }
  function fireballEnd(b) {
    // 외부 모듈(미션의 시계판 등)이 dead 로 소멸시킨 경우에도 폭발 표시
    if (!b._quiet) { fireballImpact(b); }
  }
  function fireballRender(b, ctx) {
    ctx.globalCompositeOperation = 'lighter';
    var h = b.hist;
    for (var k = h.length - 2; k >= 0; k -= 2) {
      var f = 1 - k / h.length;
      glow(ctx, h[k], h[k + 1], FB_R * (1 + 1.2 * f), k < 6 ? 2 : 3, 0.45 * f);
    }
    var pulse = 1 + 0.12 * Math.sin(clock * 45 + b.x * 0.05);
    glow(ctx, b.x, b.y, FB_R * 3.2 * pulse, 2, 0.75);
    var g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, FB_R * 1.4);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,240,150,1)');
    g.addColorStop(0.7, 'rgba(255,150,40,0.9)');
    g.addColorStop(1, 'rgba(220,50,10,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, FB_R * 1.4 * pulse, 0, Math.PI * 2); ctx.fill();
  }

  // ---------- 화염 질주 (트레일) ----------
  function trailBox(tr) {
    var grow = Math.min(1, tr.t / DASH_TIME);
    var xe = tr.x0 + (tr.x1 - tr.x0) * grow;
    return { lo: Math.min(tr.x0, xe), hi: Math.max(tr.x0, xe) };
  }
  function trailUpdate(tr) {
    var left = tr.life - tr.t;
    if (left <= 0) { return; }
    var b = trailBox(tr), lo = b.lo, hi = b.hi;
    var fade = Math.min(1, left / 0.3);
    if (Math.random() < 0.5 * fade) { ember(rnd(lo, hi), tr.y - 4, rnd(-20, 20), rnd(-120, -50), rnd(0.3, 0.6), rnd(6, 12)); }
    if (Math.random() < 0.08) { smoke(rnd(lo, hi), tr.y - 14, rnd(-10, 10), -40, rnd(0.8, 1.2), rnd(10, 18)); }
    if (hi - lo < 1 || left < 0.1) { return; }
    var box = { x: lo, y: tr.y - TRAIL_H, w: hi - lo, h: TRAIL_H + 4 };
    var mid = (lo + hi) / 2;
    var knock = function (e) { var d = (e.x + e.w / 2) < mid ? -1 : 1; return { kx: d * 120, ky: -220 }; };
    var footFx = function (e) { fireBurst(e.x + e.w / 2, e.y + e.h - 6, 5, 140); };
    var test = function (e) { return rectHit(box, e); };
    if (tr.owner === 'local') {
      var ms = hitMutantsBy(tr, test, TRAIL_DMG_M, knock, mid, box.y + box.h / 2, 0);
      for (var i = 0; i < ms.length; i++) { footFx(ms[i]); }
      remoteVis(tr, test, TRAIL_TICK, footFx);
    } else if (hitPlayerBy(tr, test, TRAIL_DMG_P, knock, mid, box.y + box.h / 2)) {
      footFx(localP());
    }
  }
  function trailRender(tr, ctx) {
    ctx.globalCompositeOperation = 'lighter';
    var b = trailBox(tr), lo = b.lo, hi = b.hi;
    var len = hi - lo;
    if (len < 2) { return; }
    var fade = Math.min(1, Math.max(0, tr.life - tr.t) / 0.35);
    var y = tr.y;
    var lg = ctx.createLinearGradient(0, y - 18, 0, y + 3);
    lg.addColorStop(0, 'rgba(255,90,10,0)');
    lg.addColorStop(1, 'rgba(255,120,30,' + (0.55 * fade) + ')');
    ctx.globalAlpha = 1;
    ctx.fillStyle = lg;
    ctx.fillRect(lo, y - 18, len, 21);
    var n = Math.max(2, Math.round(len / 17));
    for (var i = 0; i <= n; i++) {
      var x = lo + len * (i / n);
      var seed = i * 1.7 + tr.x0 * 0.01;
      var hgt = (16 + 12 * Math.sin(clock * 13 + seed * 3) + 6 * Math.sin(clock * 29 + seed)) * fade;
      glow(ctx, x, y - hgt * 0.45, hgt * 0.95, 2, 0.75 * fade);
      glow(ctx, x, y - hgt * 0.25, hgt * 0.45, 0, 0.8 * fade);
    }
  }
  // 화염 질주 진행: 플레이어별 p._dash (로컬 플레이어 + 권한측 봇)
  function updateDash(dt) {
    var P = G.players;
    if (!P) { return; }
    var list = typeof P.all === 'function' ? P.all() : [];
    for (var di = 0; di < list.length; di++) {
      if (list[di] && list[di]._dash) { stepDash(list[di], dt); }
    }
    dash = localP() ? (localP()._dash || null) : null;
  }
  function stepDash(p, dt) {
    var d = p._dash;
    if (!alive(p) || !(p === localP() || p._sim)) { p._dash = null; return; }
    var step = Math.min(d.left, dt);
    p.x = clamp(p.x + d.dir * d.speed * step, 0, worldW() - p.w);
    d.left -= step;
    p.vx = 0;
    if (!p.onGround) { p.vy = 0; }
    if (d.left > 0) { p.frozen = Math.max(p.frozen || 0, d.left); }
    var cx = p.x + p.w / 2, cy = p.y + p.h * 0.55;
    for (var i = 0; i < 3; i++) {
      ember(cx - d.dir * rnd(0, 20), cy + rnd(-22, 22), -d.dir * rnd(60, 200), rnd(-60, 20), rnd(0.2, 0.4), rnd(10, 20));
    }
    if (d.left <= 0) {
      p.x = d.ex;
      p.vx = d.dir * 300;
      p._dash = null;
    }
  }
  // 시전 잠금: 로컬 플레이어는 castLock, 봇은 p._castLock
  function lockOf(p) {
    if (p && p.isBot) { return +p._castLock || 0; }
    return castLock;
  }
  function setLock(p, secs) {
    secs = +secs || 0;
    if (p && p.isBot) { p._castLock = Math.max(+p._castLock || 0, secs); }
    else { castLock = Math.max(castLock, secs); }
  }

  // ---------- 불기둥 ----------
  function pillarUpdate(pl, dt) {
    var gy = groundY();
    if (pl.t < PIL_WARN) {
      if (Math.random() < 0.6) { ember(pl.x + rnd(-PIL_W / 2, PIL_W / 2), gy - 2, 0, rnd(-160, -60), rnd(0.2, 0.4), rnd(6, 11)); }
      return;
    }
    if (!pl.active) {
      pl.active = true;
      fireBurst(pl.x, gy - 10, 22, 380);
      ring(pl.x, gy - 6, 10, 110, 0.3, 6, 1);
      shake(pl.owner === 'local' ? 7 : 4);
    }
    var at = pl.t - PIL_WARN;
    if (at >= PIL_TIME) { return; }
    for (var k = 0; k < 3; k++) {
      ember(pl.x + rnd(-PIL_W / 2, PIL_W / 2), gy - rnd(0, PIL_H * 0.9), rnd(-40, 40), rnd(-420, -200), rnd(0.25, 0.5), rnd(10, 22));
    }
    if (Math.random() < 0.4) { smoke(pl.x + rnd(-30, 30), gy - PIL_H * rnd(0.7, 1), rnd(-30, 30), -90, rnd(0.8, 1.3), rnd(16, 28)); }
    var box = { x: pl.x - PIL_W / 2, y: gy - PIL_H, w: PIL_W, h: PIL_H };
    var test = function (e) { return rectHit(box, e); };
    var kn = { kx: 0, ky: PIL_KY };
    if (pl.owner === 'local') {
      var ms = hitMutantsBy(pl, test, PIL_DMG_M, kn, pl.x, gy - PIL_H / 2, 0);
      for (var i = 0; i < ms.length; i++) { sparkOn(ms[i]); }
      remoteVis(pl, test, 0, sparkOn);
    } else if (hitPlayerBy(pl, test, PIL_DMG_P, kn, pl.x, gy - PIL_H / 2)) {
      sparkOn(localP());
    }
  }
  function pillarRender(pl, ctx) {
    ctx.globalCompositeOperation = 'lighter';
    var gy = groundY();
    var x = pl.x, hw = PIL_W / 2;
    if (pl.t < PIL_WARN || !pl.active) {
      var prog = clamp(pl.t / PIL_WARN, 0, 1);
      var pulse = 0.55 + 0.45 * Math.sin(clock * 30);
      ctx.save();
      ctx.translate(x, gy);
      ctx.scale(1, 0.22);
      var rg = ctx.createRadialGradient(0, 0, 0, 0, 0, hw * 1.5);
      rg.addColorStop(0, 'rgba(255,230,150,' + (0.7 * prog + 0.2) + ')');
      rg.addColorStop(0.5, 'rgba(255,110,20,' + (0.45 * pulse + 0.2) + ')');
      rg.addColorStop(1, 'rgba(200,30,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(0, 0, hw * 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      var vg = ctx.createLinearGradient(0, gy - 120, 0, gy);
      vg.addColorStop(0, 'rgba(255,80,0,0)');
      vg.addColorStop(1, 'rgba(255,120,30,' + (0.35 * prog * pulse) + ')');
      ctx.fillStyle = vg;
      ctx.fillRect(x - hw * 0.8, gy - 120, hw * 1.6, 120);
      return;
    }
    var t = pl.t - PIL_WARN;
    var rise = 1 - Math.pow(1 - Math.min(1, t / 0.12), 3);
    var fade = clamp((PIL_TIME - t) / 0.18, 0, 1);
    var top = gy - PIL_H * rise;
    var hgt = gy - top;
    var lg = ctx.createLinearGradient(0, top, 0, gy);
    lg.addColorStop(0, 'rgba(200,30,0,0)');
    lg.addColorStop(0.25, 'rgba(255,90,10,' + (0.55 * fade) + ')');
    lg.addColorStop(0.75, 'rgba(255,190,70,' + (0.8 * fade) + ')');
    lg.addColorStop(1, 'rgba(255,250,220,' + (0.95 * fade) + ')');
    ctx.globalAlpha = 1;
    ctx.fillStyle = lg;
    ctx.beginPath();
    var wob = 6 * Math.sin(clock * 24);
    ctx.moveTo(x - hw, gy);
    ctx.quadraticCurveTo(x - hw * 0.9 + wob, gy - hgt * 0.5, x - hw * 0.35, top);
    ctx.lineTo(x + hw * 0.35, top);
    ctx.quadraticCurveTo(x + hw * 0.9 - wob, gy - hgt * 0.5, x + hw, gy);
    ctx.closePath();
    ctx.fill();
    for (var i = 0; i < 7; i++) {
      var f = i / 6;
      var yy = gy - hgt * f;
      var xx = x + Math.sin(clock * 18 + i * 1.3) * 10 * f;
      var r = (hw * (1.1 - f * 0.5)) * (0.9 + 0.15 * Math.sin(clock * 31 + i));
      glow(ctx, xx, yy, r * 1.4, f < 0.3 ? 1 : (f < 0.7 ? 2 : 3), 0.7 * fade);
    }
    glow(ctx, x, gy - 10, hw * 1.2, 0, 0.9 * fade);
    ctx.save();
    ctx.translate(x, gy);
    ctx.scale(1, 0.25);
    glow(ctx, 0, 0, hw * 2.4, 1, 0.6 * fade);
    ctx.restore();
  }

  // ---------- 인페르노 ----------
  function infernoUpdate(f) {
    if (f.t < INF_CHARGE) {
      for (var k = 0; k < 4; k++) {
        var a = Math.random() * Math.PI * 2, r = rnd(70, 130), life = rnd(0.18, 0.28);
        addPart({ k: 'f', x: f.x + Math.cos(a) * r, y: f.y + Math.sin(a) * r,
          vx: -Math.cos(a) * r / life, vy: -Math.sin(a) * r / life, life: life, max: life,
          size: rnd(8, 15), grav: 0, drag: 0 });
      }
      return;
    }
    if (f.boom) { return; }
    f.boom = true;
    var test = function (e) { return circleRect(f.x, f.y, INF_R, e); };
    var knock = function (e) {
      var d = (e.x + e.w / 2) - f.x;
      var s = d === 0 ? 1 : (d > 0 ? 1 : -1);
      return { kx: s * INF_KX, ky: INF_KY };
    };
    if (f.owner === 'local') {
      var ms = hitMutantsBy(f, test, INF_DMG_M, knock, f.x, f.y, 0);
      for (var i = 0; i < ms.length; i++) { sparkOn(ms[i]); }
      remoteVis(f, test, 0, sparkOn);
    } else if (hitPlayerBy(f, test, INF_DMG_P, knock, f.x, f.y)) {
      sparkOn(localP());
    }
    fireBurst(f.x, f.y, 46, 620);
    ring(f.x, f.y, 20, INF_R, 0.45, 14, 0);
    ring(f.x, f.y, 10, INF_R * 0.75, 0.35, 8, 2);
    if (f.owner === 'local') { shake(INF_SHAKE); }
    else {
      var lp = localP();
      var dist = lp ? Math.abs(lp.x + lp.w / 2 - f.x) : 9999;
      shake(dist < INF_R * 2.5 ? INF_SHAKE : 5);
    }
  }
  function infernoRender(f, ctx) {
    ctx.globalCompositeOperation = 'lighter';
    if (!f.boom) {
      var prog = clamp(f.t / INF_CHARGE, 0, 1);
      var fl = 1 + 0.12 * Math.sin(clock * 50);
      glow(ctx, f.x, f.y, (40 + 60 * prog) * fl, 2, 0.5 + 0.4 * prog);
      glow(ctx, f.x, f.y, (14 + 26 * prog) * fl, 0, 0.9);
      ctx.globalAlpha = 0.6 * prog;
      ctx.strokeStyle = 'rgba(255,170,60,1)';
      ctx.lineWidth = 3;
      for (var k = 0; k < 3; k++) {
        var a0 = clock * 9 + k * 2.09;
        ctx.beginPath();
        ctx.arc(f.x, f.y, Math.max(1, 110 - 70 * prog), a0, a0 + 1.2);
        ctx.stroke();
      }
      return;
    }
    var t = clamp((f.t - INF_CHARGE) / INF_BOOM, 0, 1);
    var a = 1 - t;
    var r = INF_R * (0.5 + 0.5 * (1 - Math.pow(1 - Math.min(1, t * 2.2), 3)));
    var g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
    g.addColorStop(0, 'rgba(255,255,235,' + (0.95 * a) + ')');
    g.addColorStop(0.25, 'rgba(255,225,120,' + (0.8 * a) + ')');
    g.addColorStop(0.55, 'rgba(255,130,30,' + (0.55 * a) + ')');
    g.addColorStop(0.85, 'rgba(210,40,10,' + (0.3 * a) + ')');
    g.addColorStop(1, 'rgba(120,10,0,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
  }

  // ---------- 불꽃 4종 등록 ----------
  var FIRE = { element: 'fire', elementName: '불꽃', rarity: 'start', color: '#ff7a2a' };
  function fireDef(o) {
    o.element = FIRE.element; o.elementName = FIRE.elementName; o.rarity = FIRE.rarity; o.color = FIRE.color;
    return S.register(o);
  }

  fireDef({
    id: 'fireball', name: '화염구', icon: '🔥', cost: 10, cooldown: 0.35,
    desc: '바라보는 방향으로 빠른 화염구를 던집니다.',
    cast: function (c) {
      var h = handPos({ x: c.x, y: c.y, w: (c.p && c.p.w) || 34, h: (c.p && c.p.h) || 62, facing: c.facing });
      S.addFx({ skill: c.skill, owner: c.owner, castId: c.castId, x: h.x, y: h.y, r: FB_R, dir: h.dir,
        t: 0, life: FB_LIFE, projectile: true, hist: [],
        update: fireballUpdate, render: fireballRender, end: fireballEnd });
      fireBurst(h.x, h.y, 6, 160);
      setHand(c, 0.3);
    }
  });

  fireDef({
    id: 'flamedash', name: '화염 질주', icon: '💨', cost: 25, cooldown: 2.5,
    desc: '불꽃을 두르고 앞으로 돌진하며, 지나간 자리를 불태웁니다.',
    prepare: function (c) {
      var p = c.p, dir = c.facing;
      var ex = clamp(p.x + dir * DASH_DIST, 0, worldW() - p.w);
      var surf = surfaceBelow(p.x + p.w / 2, p.y + p.h);
      p._dash = { dir: dir, left: DASH_TIME, speed: Math.abs(ex - p.x) / DASH_TIME, ex: ex };
      if (p === localP() && !p.isBot) { dash = p._dash; }
      p.frozen = Math.max(p.frozen || 0, DASH_TIME);
      p.invulnTimer = Math.max(p.invulnTimer || 0, DASH_INVULN);
      p.vx = 0;
      setLock(p, DASH_TIME);
      return { x0: p.x + p.w / 2, x1: ex + p.w / 2, sy: rel(surf) };
    },
    cast: function (c) {
      var d = c.data || {};
      var w = (c.p && c.p.w) || 34, h = (c.p && c.p.h) || 62;
      var x0 = num(d.x0, c.x + w / 2);
      var x1 = num(d.x1, x0 + c.facing * DASH_DIST);
      var sy = typeof d.sy === 'number' ? abs(d.sy) : c.y + h;
      S.addFx({ skill: c.skill, owner: c.owner, castId: c.castId, x: x0, y: sy, x0: x0, x1: x1,
        t: 0, life: DASH_TIME + TRAIL_LIFE, rehit: TRAIL_TICK, update: trailUpdate, render: trailRender });
      if (c.owner === 'local') { fireBurst(x0, c.y + h * 0.6, 10, 220); }
      setHand(c, 0.3);
    }
  });

  fireDef({
    id: 'pillar', name: '불기둥', icon: '🌋', cost: 40, cooldown: 4,
    desc: '앞쪽 지면에서 거대한 불기둥을 솟구치게 합니다.',
    prepare: function (c) {
      return { tx: clamp(c.x + c.p.w / 2 + c.facing * PIL_OFFSET, PIL_W / 2, worldW() - PIL_W / 2) };
    },
    cast: function (c) {
      var w = (c.p && c.p.w) || 34;
      var tx = num(c.data && c.data.tx, clamp(c.x + w / 2 + c.facing * PIL_OFFSET, PIL_W / 2, worldW() - PIL_W / 2));
      S.addFx({ skill: c.skill, owner: c.owner, castId: c.castId, x: tx, y: groundY(), active: false,
        t: 0, life: PIL_WARN + PIL_TIME, update: pillarUpdate, render: pillarRender });
      setHand(c, 0.35);
    }
  });

  fireDef({
    id: 'inferno', name: '인페르노', icon: '💥', cost: 70, cooldown: 10,
    desc: '기를 모아 주변 전체를 집어삼키는 대폭발을 일으킵니다.',
    prepare: function (c) {
      c.p.frozen = Math.max(c.p.frozen || 0, INF_CHARGE);
      c.p.vx = 0;
      return {};
    },
    cast: function (c) {
      var w = (c.p && c.p.w) || 34, h = (c.p && c.p.h) || 62;
      S.addFx({ skill: c.skill, owner: c.owner, castId: c.castId, x: c.x + w / 2, y: c.y + h / 2, r: INF_R,
        boom: false, t: 0, life: INF_CHARGE + INF_BOOM, update: infernoUpdate, render: infernoRender });
      setHand(c, INF_CHARGE + 0.1);
    }
  });

  // ======================================================================
  // 능력 키트 (원소 1개 = J/K/L/I 4개 기술)  v4
  //   S.kit(element, elementName, icon, [idJ, idK, idL, idI], meta?)  meta = {color, desc, rarity}
  //   - 기술 등록 전/후 어느 쪽에서 선언해도 됨 (id 해석은 조회 시점에)
  //   - 등록되지 않은 id 는 빈 슬롯 (null)
  //   - 선언되지 않은 원소는 [기존 기술 1개] 폴백 키트로 표시
  // ======================================================================
  var ELEMENTS = [
    { element: 'fire', elementName: '불꽃', icon: '🔥', color: '#ff7a2a', rarity: 'start', base: 'fireball',
      desc: '폭발적인 화력으로 밀어붙이는 기본 능력.' },
    { element: 'water', elementName: '물', icon: '💧', color: '#3aa8ff', rarity: 'easy', base: 'watercannon',
      desc: '강한 물줄기로 적을 밀어내고 흐름을 지배합니다.' },
    { element: 'grass', elementName: '풀', icon: '🌿', color: '#5fc24a', rarity: 'easy', base: 'vinebind',
      desc: '덩굴과 식물로 적을 묶고 지형을 장악합니다.' },
    { element: 'electric', elementName: '전기', icon: '⚡', color: '#ffe14a', rarity: 'easy', base: 'chainbolt',
      desc: '빠르게 튀는 번개로 여러 적을 동시에 노립니다.' },
    { element: 'ice', elementName: '얼음', icon: '❄️', color: '#9ae6ff', rarity: 'easy', base: 'iceshard',
      desc: '날카로운 얼음으로 꿰뚫고 얼려 발을 묶습니다.' },
    { element: 'wind', elementName: '바람', icon: '🌪️', color: '#b8f0d8', rarity: 'easy', base: 'tornado',
      desc: '돌풍과 회오리로 적을 띄우고 날려 보냅니다.' },
    { element: 'rock', elementName: '바위', icon: '🪨', color: '#b08a5a', rarity: 'easy', base: 'rockspike',
      desc: '단단한 대지의 힘으로 솟구치고 짓누릅니다.' },
    { element: 'sand', elementName: '모래', icon: '🏜️', color: '#e0b860', rarity: 'easy', base: 'sandstorm',
      desc: '모래바람으로 시야와 움직임을 갉아먹습니다.' },
    { element: 'body', elementName: '신체강화', icon: '💪', color: '#ff5050', rarity: 'easy', base: 'bodyboost',
      desc: '육체를 한계까지 끌어올려 근접전을 압도합니다.' },
    { element: 'psychic', elementName: '염력', icon: '🧠', color: '#b070ff', rarity: 'hard', base: 'psychograb',
      desc: '마음의 힘으로 적과 사물을 자유롭게 휘두릅니다.' },
    { element: 'void', elementName: '블랙홀', icon: '🕳️', color: '#7a5aff', rarity: 'hard', base: 'blackhole',
      desc: '중력을 비틀어 모든 것을 빨아들입니다.' },
    { element: 'time', elementName: '시간', icon: '⏳', color: '#7ad0ff', rarity: 'hard', base: 'timestop',
      desc: '흐름을 늦추고 멈춰 전장의 박자를 빼앗습니다.' },
    { element: 'dragon', elementName: '용족', icon: '🐉', color: '#ff9a3a', rarity: 'hard', base: 'dragonsummon',
      desc: '고대 용의 힘을 깨워 하늘과 불길을 지배합니다.' }
  ];
  var ELEMENT_BY = {};
  for (var ei = 0; ei < ELEMENTS.length; ei++) { ELEMENT_BY[ELEMENTS[ei].element] = ELEMENTS[ei]; }
  var declared = {};      // element → {element, elementName, icon, ids, color, desc, rarity}
  var declaredOrder = []; // 표에 없는 새 원소 (선언 순서)
  S.kits = [];            // 정렬된 목록 (항상 13개 + 추가 원소). 같은 배열 객체를 유지
  S.elements = ELEMENTS;  // 원소 기본 정보 (읽기용)

  function str(v, d) { return (typeof v === 'string' && v) ? v : d; }
  function fallbackIds(el) {
    var info = ELEMENT_BY[el];
    if (info && info.base) { return [info.base, null, null, null]; }
    var out = [null, null, null, null], n = 0;
    for (var i = 0; i < S.order.length && n < 4; i++) {
      var d = S.defs[S.order[i]];
      if (d && d.element === el) { out[n++] = d.id; }
    }
    return out;
  }
  function makeKit(el) {
    var info = ELEMENT_BY[el] || {};
    var dk = hasOwn.call(declared, el) ? declared[el] : null;
    var ids = dk ? dk.ids.slice() : fallbackIds(el);
    var first = null;
    for (var i = 0; i < ids.length; i++) { if (ids[i] && hasOwn.call(S.defs, ids[i])) { first = S.defs[ids[i]]; break; } }
    return {
      element: el,
      elementName: str(dk && dk.elementName, str(info.elementName, str(first && first.elementName, el))),
      icon: str(dk && dk.icon, str(info.icon, str(first && first.icon, '✨'))),
      ids: ids,
      color: str(dk && dk.color, str(info.color, str(first && first.color, '#c9a35a'))),
      desc: str(dk && dk.desc, str(info.desc, '')),
      rarity: str(dk && dk.rarity, str(info.rarity, str(first && first.rarity, 'easy'))),
      declared: !!dk
    };
  }
  function rebuildKits() {
    var list = S.kits;
    list.length = 0;
    for (var i = 0; i < ELEMENTS.length; i++) { list.push(makeKit(ELEMENTS[i].element)); }
    for (var j = 0; j < declaredOrder.length; j++) { list.push(makeKit(declaredOrder[j])); }
    return list;
  }
  function defineKit(element, elementName, icon, ids, meta) {
    if (typeof element !== 'string' || !element) { logErr('kit', '원소 없음'); return null; }
    meta = (meta && typeof meta === 'object') ? meta : {};
    var arr = Array.isArray(ids) ? ids : [];
    var clean = [null, null, null, null];
    for (var i = 0; i < 4; i++) { clean[i] = (typeof arr[i] === 'string' && arr[i]) ? arr[i] : null; }
    if (!hasOwn.call(declared, element) && !hasOwn.call(ELEMENT_BY, element)) { declaredOrder.push(element); }
    declared[element] = {
      element: element, elementName: str(elementName, ''), icon: str(icon, ''), ids: clean,
      color: str(meta.color, ''), desc: str(meta.desc, ''), rarity: str(meta.rarity, '')
    };
    rebuildKits();
    if (P && P._ready) { try { P.refreshSlots(); } catch (e) { logErr('kit refresh', e); } }
    return kitOf(element);
  }
  // G.pendingKits: S.kit 이 없을 때 키트 파일이 쌓아 둔 선언 ({element, elementName, icon, ids, meta} 또는 인자 배열)
  function applyPending(item) {
    if (!item) { return; }
    if (Array.isArray(item) || (typeof item === 'object' && typeof item.length === 'number' && typeof item[0] === 'string')) {
      defineKit(item[0], item[1], item[2], item[3], item[4]);
    } else if (typeof item === 'object') {
      defineKit(item.element, item.elementName, item.icon, item.ids, item.meta || item);
    }
  }
  function drainPending() {
    var pk = G.pendingKits;
    if (!pk || typeof pk.length !== 'number') { G.pendingKits = makePendingArr(); return; }
    if (!pk._live) {
      var items = Array.prototype.slice.call(pk);
      G.pendingKits = makePendingArr();
      for (var i = 0; i < items.length; i++) {
        try { applyPending(items[i]); } catch (e) { logErr('pendingKits', e); }
      }
    }
  }
  // 이후 push 는 즉시 적용되는 배열
  function makePendingArr() {
    var a = [];
    a._live = true;
    a.push = function () {
      for (var i = 0; i < arguments.length; i++) {
        try { applyPending(arguments[i]); } catch (e) { logErr('pendingKits', e); }
      }
      return 0;
    };
    return a;
  }
  function kitOf(el) {
    var list = S.kits;
    for (var i = 0; i < list.length; i++) { if (list[i].element === el) { return list[i]; } }
    return null;
  }
  // 키트의 실제 슬롯 (등록 안 된 id → null)
  function kitSlots(el) {
    var k = kitOf(el);
    var out = [null, null, null, null];
    if (!k) { return out; }
    for (var i = 0; i < 4; i++) {
      var id = k.ids[i];
      out[i] = (id && hasOwn.call(S.defs, id) && typeof S.defs[id].cast === 'function') ? id : null;
    }
    return out;
  }
  function elementOfSkill(id) {
    var i, j;
    for (i = 0; i < S.kits.length; i++) {
      for (j = 0; j < 4; j++) { if (S.kits[i].ids[j] === id) { return S.kits[i].element; } }
    }
    var d = hasOwn.call(S.defs, id) ? S.defs[id] : null;
    if (d && d.element && d.element !== 'none') { return d.element; }
    for (i = 0; i < ELEMENTS.length; i++) { if (ELEMENTS[i].base === id) { return ELEMENTS[i].element; } }
    return null;
  }

  S.kit = defineKit;
  S.kitOf = function (el) { return kitOf(el); };
  S.kitSlots = kitSlots;
  S.elementOf = elementOfSkill;                 // (skillId) → element 또는 null
  S.refreshKits = function () { drainPending(); return rebuildKits(); };
  // register 후에도 폴백/아이콘 정보 갱신
  var baseRegister = S.register;
  S.register = function (def) {
    var r = baseRegister(def);
    if (r) {
      rebuildKits();
      if (P && P._ready) { try { P.refreshSlots(); } catch (e) { logErr('register refresh', e); } }
    }
    return r;
  };
  rebuildKits();

  // 불꽃 키트 (기본 지급)
  S.kit('fire', '불꽃', '🔥', ['fireball', 'flamedash', 'pillar', 'inferno'],
    { color: '#ff7a2a', rarity: 'start', desc: '폭발적인 화력으로 밀어붙이는 기본 능력.' });
  drainPending();

  // ======================================================================
  // 시전 / 네트워크
  // ======================================================================
  var cd = {};          // 기술 id → 남은 쿨다운 (슬롯 교체해도 유지)
  var castCounter = 0;
  var netBound = false;

  function getDef(id) { return (typeof id === 'string' && hasOwn.call(S.defs, id)) ? S.defs[id] : null; }

  function onCast(msg) {
    if (!msg || typeof msg.skill !== 'string') { return; }
    var def = getDef(msg.skill);
    if (!def || typeof def.cast !== 'function') { return; }
    var from = msg.from != null ? String(msg.from) : null;
    // 호스트가 보낸 봇 시전: 시전자 = msg.bot
    var botId = (msg.bot != null && msg.bot !== '' && (from === 'h' || from === null)) ? String(msg.bot) : null;
    if (!botId && from !== null && isMe(from)) { return; } // 내 시전의 메아리 무시
    var cid = botId || from;
    var rp = cid !== null ? playerById(cid) : null;
    if (rp && rp === localP()) { return; }
    if (rp && rp._sim) { return; }                 // 내가 시뮬레이션하는 봇 (메아리)
    if (cid === null && !rp) { rp = remoteP(); } // 구버전 호환 (from 없음)
    var facing = msg.facing >= 0 ? 1 : -1;
    var x = num(msg.x, rp ? rp.x : 0);
    var y = typeof msg.gy === 'number' && isFinite(msg.gy) ? abs(msg.gy) : (rp ? rp.y : groundY() - 62);
    var p = rp || { id: cid, x: x, y: y, w: 34, h: 62, vx: 0, vy: 0, facing: facing, alive: true, isLocal: false, isBot: !!botId };
    var casterId = cid !== null ? cid : (rp && rp.id != null ? rp.id : null);
    var castId = 'r' + (casterId != null ? casterId : '?') + ':' +
      (msg.castId != null ? msg.castId : ('?' + (++castCounter)));
    noteCaster(castId, casterId);
    var data = (msg.data && typeof msg.data === 'object') ? msg.data : {};
    var ctx = {
      owner: 'remote', skill: def.id, def: def, p: p, x: x, y: y, facing: facing,
      castId: castId, casterId: casterId, data: data
    };
    try { def.cast(ctx); } catch (e) { logErr('remote cast ' + def.id, e); }
    if (rp) { rp.castTimer = CAST_TIME; }
    // 권한측(호스트): 다른 사람의 시전이 내 봇들을 맞히는지 각 봇 시점에서 재생
    castShadows(def, ctx, casterId);
  }

  // ---- 봇 그림자 시뮬레이션 ----
  function cloneData(o) {
    if (!o || typeof o !== 'object') { return {}; }
    try { return JSON.parse(JSON.stringify(o)); } catch (e) { return {}; }
  }
  // 권한측이 시뮬레이션하는 봇 목록
  function simBots() {
    var out = [], o = G.players && G.players.others;
    if (!o) { return out; }
    for (var k in o) { if (hasOwn.call(o, k) && o[k] && o[k].isBot && o[k]._sim) { out.push(o[k]); } }
    return out;
  }
  // 권한측: 시전 base 를 각 봇 V 의 시점(local = V)에서 '원격 시전'으로 한 번 더 재생한다.
  // 그 그림자 효과는 그려지지 않고 시각/이벤트가 무음이며, 기술 코드가 '나(local)'에게 하는 모든 일
  // (피해·상태이상·끌어당김·직접 조작)이 V 에게 적용된다 → 모든 기술이 봇에게도 그대로 통한다.
  function castShadows(def, base, excludeId) {
    if (!isAuthority() || !def || typeof def.cast !== 'function' || G.bossMode) { return; }   // 보스전: 봇은 아군 → 피격 그림자 없음
    var bots = simBots();
    for (var i = 0; i < bots.length; i++) {
      var v = bots[i];
      if (v.id === excludeId || !alive(v)) { continue; }
      shadowCast(def, base, v);
    }
  }
  function shadowCast(def, base, v) {
    noteCaster(base.castId, base.casterId);
    var c = {
      owner: 'remote', skill: def.id, def: def, p: base.p, x: base.x, y: base.y, facing: base.facing,
      castId: base.castId, casterId: base.casterId, data: cloneData(base.data)
    };
    var prev = curTag;
    curTag = { pov: v, cs: false, bm: false };
    try { withPov(v, function () { def.cast(c); }); } catch (e) { logErr('shadow cast ' + def.id, e); }
    finally { curTag = prev; }
  }

  // 시간 정지 중 초침 베기 무제한: 시전자 본인의 시간 정지가 흐르는 동안
  // 초침 베기(time_hands)만 쿨타임·에너지 소모 없음 (다른 기술·시간 정지 자체는 그대로)
  function timeStopFree(casterId, id) {
    if (casterId == null || id !== 'time_hands') { return false; }
    var list = S.fx;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f || f.dead || f.skill !== 'timestop' || !(f.t < f.life)) { continue; }
      if (f.casterId != null && String(f.casterId) === String(casterId)) { return true; }
    }
    return false;
  }

  // 봇이 지금 이 기술을 쓸 수 있는가
  function botCanCast(bot, id) {
    var def = getDef(id);
    if (!def || typeof def.cast !== 'function' || !bot || !alive(bot)) { return false; }
    var bcd = bot._cd || {};
    var bfree = timeStopFree(bot.id, id);
    if (!bfree && ((bcd[id] || 0) > 0 || (bot.energy || 0) < def.cost)) { return false; }
    if (bot._dash || (bot._castLock || 0) > 0 || (bot.frozen || 0) > 0) { return false; }
    return true;
  }
  // 권한측 봇 시전. 같은 시전이 세 갈래로 재생된다:
  //  1) 시전자 그림자 (owner 'local', 시점 = 봇): prepare + 자기 이동/버프 + 돌연변이 피해. 그리지 않음
  //  2) 표시용 본체 (owner 'remote', 시전자 = 봇): 게스트가 보는 것과 같음 → 진짜 로컬 플레이어(호스트) 피격 + 렌더
  //  3) 다른 봇들의 피격 그림자 (castShadows)
  // 게스트에게는 {t:'cast', bot, ...} 로 방송 → 게스트는 2) 처럼 원격 시전으로 처리
  function botCast(bot, id) {
    if (!isAuthority() || !botCanCast(bot, id)) { return false; }
    var def = getDef(id);
    var facing = bot.facing >= 0 ? 1 : -1;
    var raw = 'k' + (++castCounter);
    var castId = 'r' + bot.id + ':' + raw;
    noteCaster(castId, bot.id);
    var lctx = { owner: 'local', skill: id, def: def, p: bot, x: bot.x, y: bot.y, facing: facing,
      castId: castId, casterId: bot.id, data: {} };
    var csTag = { pov: bot, cs: true, bm: false };
    var data = {}, ok = true, prev = curTag;
    if (typeof def.prepare === 'function') {
      curTag = csTag;
      try {
        withPov(bot, function () {
          var r = def.prepare(lctx);
          if (r === false) { ok = false; } else if (r && typeof r === 'object') { data = r; }
        });
      } catch (e) { logErr('bot prepare ' + id, e); ok = false; }
      finally { curTag = prev; }
    }
    if (!ok) { return false; }
    if (!bot._cd) { bot._cd = {}; }
    if (timeStopFree(bot.id, id)) { bot._cd[id] = 0; }
    else { bot.energy -= def.cost; bot._cd[id] = def.cooldown; }
    bot.castTimer = CAST_TIME;
    bot.facing = lctx.facing = facing;
    var bx = bot.x, by = bot.y;
    if (G.Net && G.Net.isHost && G.Net.connected) {
      send({ t: 'cast', bot: bot.id, skill: id, castId: raw, x: bx, gy: rel(by), facing: facing, data: data });
    }
    // 1) 시전자 그림자
    lctx.data = cloneData(data);
    curTag = csTag;
    try { withPov(bot, function () { def.cast(lctx); }); } catch (e1) { logErr('bot cast(self) ' + id, e1); }
    finally { curTag = prev; }
    // 2) 표시용 본체
    var rctx = { owner: 'remote', skill: id, def: def, p: bot, x: bx, y: by, facing: facing,
      castId: castId, casterId: bot.id, data: data };
    curTag = { pov: null, cs: false, bm: true };
    try { def.cast(rctx); } catch (e2) { logErr('bot cast ' + id, e2); }
    finally { curTag = prev; }
    // 3) 다른 봇들
    castShadows(def, rctx, bot.id);
    return true;
  }
  function botTick(bot, dt) {
    if (bot._castLock > 0) { bot._castLock = Math.max(0, bot._castLock - dt); }
    var bcd = bot._cd;
    if (bcd) { for (var k in bcd) { if (hasOwn.call(bcd, k) && bcd[k] > 0) { bcd[k] = Math.max(0, bcd[k] - dt); } } }
  }

  function bindNet() {
    if (netBound) { return; }
    if (G.Net && typeof G.Net.on === 'function') {
      G.Net.on('cast', onCast);
      netBound = true;
    }
  }

  // ======================================================================
  // 장착 슬롯 / UI
  // ======================================================================
  var slotEls = [];

  var curElement = 'fire';
  function elementUnlocked(el) {
    var k = kitOf(el);
    if (!k) { return false; }
    if (k.rarity === 'start') { return true; }
    var pr = G.Progress;
    if (!pr) { return false; }
    if (typeof pr.isElementUnlocked === 'function') {
      try { return !!pr.isElementUnlocked(el); } catch (e) { return false; }
    }
    return Array.isArray(pr.elements) && pr.elements.indexOf(el) >= 0;
  }
  // 선택된 원소 (Progress.element) → 잠겨 있거나 없으면 불꽃
  function selectedElement() {
    var el = G.Progress && typeof G.Progress.element === 'string' ? G.Progress.element : curElement;
    if (!kitOf(el) || !elementUnlocked(el)) { el = 'fire'; }
    return el;
  }
  function computeSlots(el) { return kitSlots(el || selectedElement()); }
  function applyLoadout() {
    drainPending();
    curElement = selectedElement();
    P.slots = kitSlots(curElement);
    P.element = curElement;
  }
  function localBusy() {
    var p = localP();
    if ((p && p._dash) || castLock > 0) { return true; }
    if (p && G.running && !G.matchOver && p.alive !== false && ((p.castTimer || 0) > 0 || (p.frozen || 0) > 0)) { return true; }
    return false;
  }
  function panelOpen() {
    var M = G.Missions;
    if (!M || typeof M.isPanelOpen !== 'function') { return false; }
    try { return !!M.isPanelOpen(); } catch (e) { return false; }
  }

  function injectStyle() {
    if (typeof document === 'undefined' || !document.getElementById || document.getElementById('powers-style')) { return; }
    var css = [
      '#power-list{display:flex;flex-direction:column;align-items:center;gap:5px;}',
      '.pw-label{font-size:11px;font-weight:800;letter-spacing:2px;color:#ffd9b0;',
      'text-shadow:0 0 6px rgba(255,140,60,.7),0 1px 2px #000;}',
      '.pw-row{display:flex;gap:10px;align-items:flex-end;}',
      '.pw-slot{--pc:255,122,42;--pd:72,34,12;--pl:255,233,207;position:relative;width:70px;height:70px;box-sizing:border-box;border-radius:12px;',
      'background:radial-gradient(circle at 50% 110%,rgba(var(--pc),.45),rgba(var(--pd),.92) 60%,rgba(20,12,8,.95));',
      'border:2px solid rgba(var(--pc),.75);box-shadow:0 4px 12px rgba(0,0,0,.45),0 0 10px rgba(var(--pc),.45),inset 0 0 12px rgba(var(--pc),.3);',
      'color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'overflow:hidden;user-select:none;transition:opacity .15s,filter .15s,border-color .15s,box-shadow .15s;}',
      '.pw-key{position:absolute;top:3px;left:3px;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;',
      'border-radius:5px;background:linear-gradient(#fff3d6,rgb(var(--pc)));color:#1e0e04;font-size:11px;font-weight:900;line-height:16px;text-align:center;z-index:3;}',
      '.pw-cost{position:absolute;top:3px;right:4px;font-size:10px;font-weight:800;color:rgb(var(--pl));text-shadow:0 0 3px #000;z-index:3;}',
      '.pw-icon{font-size:23px;line-height:1;margin-top:8px;filter:drop-shadow(0 0 5px rgba(var(--pc),.9));z-index:1;color:rgb(var(--pl));}',
      '.pw-icon .sk-svg{width:26px;height:26px;display:block;}',
      '.pw-name{font-size:10.5px;font-weight:800;margin-top:4px;letter-spacing:-.3px;white-space:nowrap;color:rgb(var(--pl));z-index:1;}',
      '.pw-cd{position:absolute;left:0;right:0;bottom:0;height:0;background:rgba(6,4,2,.75);z-index:2;pointer-events:none;',
      'border-top:1px solid rgba(var(--pc),.6);}',
      '.pw-num{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;',
      'color:#fff;text-shadow:0 0 4px #000,0 0 6px rgba(var(--pc),.8);z-index:4;pointer-events:none;}',
      '.pw-slot.pw-empty{opacity:.35;filter:grayscale(1);}',
      '.pw-slot.pw-low{opacity:.45;filter:grayscale(.7);}',
      '.pw-slot.pw-free{border-color:#7ad0ff !important;box-shadow:0 0 18px rgba(122,208,255,.9),inset 0 0 14px rgba(122,208,255,.5) !important;animation:pwFree .5s ease-in-out infinite alternate;}',
      '@keyframes pwFree{from{filter:brightness(1)}to{filter:brightness(1.35)}}',
      '.pw-slot.pw-ready{border-color:rgb(var(--pc));box-shadow:0 4px 12px rgba(0,0,0,.45),0 0 16px rgba(var(--pc),.75),inset 0 0 14px rgba(var(--pc),.4);}',
      '.pw-slot.pw-fire{animation:pw-fire .25s ease-out;}',
      '.pw-slot.pw-deny{animation:pw-shake .35s ease;border-color:#ff2a2a!important;box-shadow:0 0 14px rgba(255,30,30,.9)!important;}',
      '@keyframes pw-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}',
      '60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}',
      '@keyframes pw-fire{0%{transform:scale(1.14);box-shadow:0 0 24px rgba(var(--pl),1)}100%{transform:scale(1)}}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'powers-style';
    st.textContent = css;
    (document.head || document.body).appendChild(st);
  }

  function buildSlots() {
    slotEls = [];
    if (typeof document === 'undefined' || !document.getElementById) { return; }
    var listEl = document.getElementById('power-list');
    if (!listEl) { return; }
    injectStyle();
    listEl.innerHTML = '';
    var label = document.createElement('div');
    label.className = 'pw-label';
    var kk = kitOf(curElement);
    label.textContent = kk ? (kk.icon + ' ' + kk.elementName) : '장착 기술';
    if (kk) { label.title = '장착 능력: ' + kk.elementName + (kk.desc ? ' — ' + kk.desc : ''); }
    listEl.appendChild(label);
    var row = document.createElement('div');
    row.className = 'pw-row';
    listEl.appendChild(row);
    for (var i = 0; i < 4; i++) {
      var id = P.slots[i];
      var d = getDef(id);
      var root = document.createElement('div');
      root.className = 'pw-slot' + (d ? '' : ' pw-empty');
      if (d) {
        var rgb = fixRgb(parseColor(d.color));
        var dk = [Math.round(rgb[0] * 0.28), Math.round(rgb[1] * 0.28), Math.round(rgb[2] * 0.28)];
        var lt = [Math.round(rgb[0] + (255 - rgb[0]) * 0.8), Math.round(rgb[1] + (255 - rgb[1]) * 0.8),
          Math.round(rgb[2] + (255 - rgb[2]) * 0.8)];
        if (root.style && root.style.setProperty) {
          root.style.setProperty('--pc', rgb.join(','));
          root.style.setProperty('--pd', dk.join(','));
          root.style.setProperty('--pl', lt.join(','));
        }
        root.title = (d.elementName ? '[' + d.elementName + '] ' : '') + d.name + ' (' + KEY_LABELS[i] + ') — ' +
          d.desc + ' 에너지 ' + d.cost + ', 재사용 ' + d.cooldown + '초';
        root.innerHTML =
          '<span class="pw-key">' + KEY_LABELS[i] + '</span>' +
          '<span class="pw-cost">' + escapeHtml(d.cost) + '</span>' +
          '<span class="pw-icon">' + ((G.SkillIcons && G.SkillIcons.svg(d.id, d.element)) || escapeHtml(d.icon)) + '</span>' +
          '<span class="pw-name">' + escapeHtml(d.name) + '</span>' +
          '<div class="pw-cd"></div>' +
          '<div class="pw-num"></div>';
      } else {
        root.title = '빈 슬롯 (' + KEY_LABELS[i] + ')';
        root.innerHTML = '<span class="pw-key">' + KEY_LABELS[i] + '</span><span class="pw-icon">·</span>' +
          '<span class="pw-name">비어 있음</span><div class="pw-cd"></div><div class="pw-num"></div>';
      }
      row.appendChild(root);
      slotEls.push({ id: d ? id : null, root: root, cd: root.querySelector ? root.querySelector('.pw-cd') : null,
        num: root.querySelector ? root.querySelector('.pw-num') : null,
        lastPct: -1, lastNum: null, lastLow: null, lastReady: null, timer: 0 });
    }
  }

  function flashSlot(idx, cls) {
    var s = slotEls[idx];
    if (!s || !s.root || !s.root.classList) { return; }
    var el = s.root;
    el.classList.remove('pw-deny', 'pw-fire');
    void el.offsetWidth;
    el.classList.add(cls);
    clearTimeout(s.timer);
    s.timer = setTimeout(function () { el.classList.remove(cls); }, 380);
  }

  function updateSlots() {
    var p = localP();
    var energy = p ? p.energy : 0;
    var meId = p ? myId() : null;
    for (var i = 0; i < slotEls.length; i++) {
      var s = slotEls[i];
      var d = getDef(s.id);
      if (!d || !s.cd || !s.num || !s.root.classList) { continue; }
      var free = !!p && timeStopFree(meId, s.id);
      if (free !== s.lastFree) { s.root.classList.toggle('pw-free', free); s.lastFree = free; }
      var left = free ? 0 : (cd[s.id] || 0);
      var pct = left > 0 && d.cooldown > 0 ? Math.round(clamp(left / d.cooldown, 0, 1) * 1000) / 10 : 0;
      if (pct !== s.lastPct) { s.cd.style.height = pct + '%'; s.lastPct = pct; }
      var n = left > 0 ? (left >= 1 ? String(Math.ceil(left)) : left.toFixed(1)) : '';
      if (n !== s.lastNum) { s.num.textContent = n; s.lastNum = n; }
      var low = !free && energy < d.cost;
      if (low !== s.lastLow) { s.root.classList.toggle('pw-low', low); s.lastLow = low; }
      var ready = !low && left <= 0;
      if (ready !== s.lastReady) { s.root.classList.toggle('pw-ready', ready); s.lastReady = ready; }
    }
  }

  // ---------- 렌더 공통 ----------
  function drawHand(ctx, p, t) {
    if (!alive(p)) { return; }
    var h = handPos(p);
    var fl = 1 + 0.2 * Math.sin(clock * 37) + 0.1 * Math.sin(clock * 61);
    var a = Math.min(1, t / 0.12);
    glow(ctx, h.x, h.y, 22 * fl, 2, 0.8 * a);
    glow(ctx, h.x, h.y - 3, 11 * fl, 0, a);
  }
  function renderSmoke(ctx) {
    ctx.save();
    ctx.fillStyle = '#2b2522';
    for (var i = 0; i < parts.length; i++) {
      var q = parts[i];
      if (q.k !== 'm') { continue; }
      var f = q.life / q.max;
      ctx.globalAlpha = 0.22 * f;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * (1.8 - f), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  function renderRings(ctx) {
    var cols = ['255,240,190', '255,180,70', '255,110,30', '220,50,15'];
    for (var i = 0; i < rings.length; i++) {
      var rg = rings[i];
      var t = 1 - rg.life / rg.max;
      var r = rg.r0 + (rg.r1 - rg.r0) * (1 - Math.pow(1 - t, 2));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(' + cols[clamp(rg.tier | 0, 0, 3)] + ',' + (0.9 * (1 - t)) + ')';
      ctx.lineWidth = Math.max(1, rg.width * (1 - t * 0.7));
      ctx.beginPath(); ctx.arc(rg.x, rg.y, r, 0, Math.PI * 2); ctx.stroke();
    }
  }
  function updateParts(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var q = parts[i];
      q.life -= dt;
      if (q.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      var dr = Math.max(0, 1 - q.drag * dt);
      q.vx *= dr; q.vy *= dr;
      q.vy += q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
    }
    for (var j = rings.length - 1; j >= 0; j--) {
      rings[j].life -= dt;
      if (rings[j].life <= 0) { rings.splice(j, 1); }
    }
  }

  // ======================================================================
  // Game.Powers
  // ======================================================================
  var P = {
    slots: DEFAULT_SLOTS.slice(),
    element: 'fire',                   // 현재 장착 원소 (읽기용)
    keys: KEYS.slice(),
    cooldowns: cd,                     // id → 남은 쿨다운 (읽기용)
    _ready: false,

    init: function () {
      P._ready = true;
      bindNet();
      resetFx();
      rings = []; parts = [];
      dash = null; castLock = 0;
      var ap = G.players && typeof G.players.all === 'function' ? G.players.all() : [];
      for (var ai = 0; ai < ap.length; ai++) { if (ap[ai]) { ap[ai]._dash = null; ap[ai]._castLock = 0; } }
      for (var hk in hand) { if (hasOwn.call(hand, hk)) { delete hand[hk]; } }
      casterIds = {}; casterKeys = [];
      for (var k in cd) { if (hasOwn.call(cd, k)) { delete cd[k]; } }
      applyLoadout();
      makeSprites();
      buildSlots();
      updateSlots();
    },

    refreshSlots: function () {
      P._ready = true;
      applyLoadout();
      buildSlots();
      updateSlots();
    },

    // 능력(원소) 교체. 시전 중(질주·시전 잠금·시전 동작)에는 거부 → false.
    // 경기 중 교체 시 새 키트 기술은 1초 대기 (교체로 쿨다운 우회 방지)
    setElement: function (el) {
      drainPending();
      if (typeof el !== 'string' || !kitOf(el) || !elementUnlocked(el)) { return false; }
      if (localBusy()) { return false; }
      var pr = G.Progress;
      if (pr) {
        if (typeof pr.setElement === 'function') {
          try { if (pr.setElement(el) === false) { return false; } } catch (e) { logErr('setElement', e); }
        } else { pr.element = el; }
      }
      var changed = el !== curElement;
      curElement = el;
      P.refreshSlots();
      if (changed && G.running && !G.matchOver) {
        for (var i = 0; i < 4; i++) {
          var id = P.slots[i];
          if (id) { cd[id] = Math.max(cd[id] || 0, 1); }
        }
        updateSlots();
      }
      if (changed) { emit('elementChanged', { element: el }); }
      return true;
    },
    canSwitch: function () { return !localBusy(); },
    elementUnlocked: elementUnlocked,

    cdLeft: function (id) { return cd[id] || 0; },

    // ---- 봇 (bots.js 가 사용, 권한측 전용) ----
    botCast: botCast,          // (bot, skillId) → 시전 성공 여부
    botCanCast: botCanCast,    // (bot, skillId) → 쿨다운/에너지/잠금 확인
    botTick: botTick,          // (bot, dt) → 봇 쿨다운/시전 잠금 감소

    onKeyDown: function (code) {
      var idx = KEYS.indexOf(code);
      if (idx < 0) { return; }
      if (panelOpen()) { return; }       // 능력 패널이 열려 있으면 기술 키 무시
      var p = localP();
      if (!alive(p)) { return; }
      var id = P.slots[idx];
      var def = getDef(id);
      if (!def || typeof def.cast !== 'function') { return; }
      var free = timeStopFree(myId(), id);
      if ((!free && ((cd[id] || 0) > 0 || (p.energy || 0) < def.cost)) || p._dash || castLock > 0 || (p.frozen || 0) > 0) {
        flashSlot(idx, 'pw-deny'); return;
      }
      var castId = 'c' + (++castCounter);
      var ctx = { owner: 'local', skill: id, def: def, p: p, x: p.x, y: p.y, facing: p.facing >= 0 ? 1 : -1,
        castId: castId, casterId: myId(), data: {} };
      noteCaster(castId, ctx.casterId);
      var data = {};
      if (typeof def.prepare === 'function') {
        var r;
        try { r = def.prepare(ctx); } catch (e) { logErr('prepare ' + id, e); r = false; }
        if (r === false) { flashSlot(idx, 'pw-deny'); return; }
        if (r && typeof r === 'object') { data = r; }
      }
      ctx.data = data;
      if (free) { cd[id] = 0; }
      else { p.energy -= def.cost; cd[id] = def.cooldown; }
      p.castTimer = CAST_TIME;
      send({ t: 'cast', skill: id, castId: castId, x: p.x, gy: rel(p.y), facing: ctx.facing, data: data });
      try { def.cast(ctx); } catch (e2) { logErr('cast ' + id, e2); }
      // 권한측: 내 시전이 봇들을 맞히는지 각 봇 시점에서 재생
      castShadows(def, { p: p, x: p.x, y: p.y, facing: ctx.facing, castId: 'r' + ctx.casterId + ':' + castId,
        casterId: ctx.casterId, data: data }, ctx.casterId);
      flashSlot(idx, 'pw-fire');
      emit('skillCast', { skill: id, castId: castId });
    },

    update: function (dt) {
      if (!(dt > 0)) { return; }
      bindNet();
      clock += dt;
      for (var k in cd) {
        if (hasOwn.call(cd, k) && cd[k] > 0) { cd[k] = Math.max(0, cd[k] - dt); }
      }
      if (castLock > 0) { castLock = Math.max(0, castLock - dt); }
      for (var hk in hand) { if (hasOwn.call(hand, hk) && hand[hk] > 0) { hand[hk] -= dt; } }
      updateDash(dt);
      updateFx(dt);
      updateParts(dt);
      updateSlots();
    },

    render: function (ctx) {
      if (!ctx) { return; }
      makeSprites();
      var i;
      renderSmoke(ctx);
      renderFx(ctx);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      renderRings(ctx);
      for (var hk in hand) {
        if (!hasOwn.call(hand, hk) || !(hand[hk] > 0)) { continue; }
        var hp = hk === 'local' ? localP() : playerById(hk.slice(3));
        if (hp) { drawHand(ctx, hp, hand[hk]); }
      }
      for (i = 0; i < parts.length; i++) {
        var q = parts[i];
        if (q.k === 'm') { continue; }
        var f = q.life / q.max;
        if (q.k === 's') {
          ctx.globalAlpha = f;
          ctx.fillStyle = f > 0.5 ? '#fff2b0' : '#ff9a3a';
          ctx.fillRect(q.x - 1, q.y - 1, q.size, q.size);
        } else {
          glow(ctx, q.x, q.y, q.size * (0.5 + 0.5 * f), f > 0.75 ? 0 : (f > 0.5 ? 1 : (f > 0.25 ? 2 : 3)), 0.9 * f + 0.1);
        }
      }
      ctx.restore();
    },

    // 테스트/디버그용
    _debug: function () {
      return { fx: S.fx, parts: parts, rings: rings, dash: dash, netBound: netBound, cd: cd, castLock: castLock,
        onCast: onCast, computeSlots: computeSlots };
    }
  };

  S.timeStopFree = timeStopFree;     // (casterId, skillId) → 시간 정지 중 초침 베기 무제한인가
  G.Skills = S;
  G.Powers = P;
  bindNet(); // 로드 시 한 번 등록 (Net 이 아직 없으면 init/update 에서 재시도, 한 번만)
})();
