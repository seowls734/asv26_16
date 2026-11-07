/* 초능력자: 각성 — AI 봇 (Game.Bots)  v5
 * 봇은 권한측(연습 / 온라인 호스트)에서만 시뮬레이션되는 '플레이어'다.
 *  - G.players.others 에 id 'b1'..'b7', isBot: true, _sim: true 로 들어간다 (점수판/3D/기술이 플레이어처럼 취급)
 *  - 이동은 world.js 의 G.stepPlayer(p, input, dt) (로컬 플레이어와 같은 물리)
 *  - 기술은 G.Powers.botCast(bot, id) — 원격 시전 경로 + 그림자 시뮬레이션 (powers.js 참고)
 *  - 피해는 G.Bots.damage (권한측 전용), KO → 3초 뒤 리스폰, 킬 크레딧 / {t:'ko', by, victim} 방송
 *  - 게스트는 호스트의 {t:'bots', list} 묶음 상태로 봇을 원격 플레이어처럼 그린다 (world.js)
 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};
  var hasOwn = Object.prototype.hasOwnProperty;
  var MAX_BOTS = 7;

  // ---------------------------------------------------------------- 난이도
  var DIFF = {
    easy: {
      think: 0.45, react: 0.55, cast: 0.4, ult: 0.25, slop: 110, dodge: 0, hop: 0.04,
      mutants: false, retreat: 0, items: 0.15, idle: 0.25, reserve: 0, stick: 140
    },
    normal: {
      think: 0.24, react: 0.25, cast: 0.75, ult: 0.6, slop: 45, dodge: 0.3, hop: 0.07,
      mutants: false, retreat: 0.25, items: 0.55, idle: 0.06, reserve: 10, stick: 160
    },
    hard: {
      think: 0.12, react: 0.1, cast: 0.95, ult: 0.9, slop: 12, dodge: 0.75, hop: 0.1,
      mutants: true, retreat: 0.32, items: 1, idle: 0, reserve: 12, stick: 200
    }
  };

  // ---------------------------------------------------------------- 기술 사용 정보
  // k: proj(직선) arc(포물선) melee fwd(앞쪽 범위/지면) aoe(자기 주변) tgt(자동 조준) dash(돌진/순간이동)
  //    up(수직 이동) buff heal wall map(맵 전체) skip(봇이 쓰지 않음)
  // r: 최대 사거리(수평), min: 최소 수평 거리, dy: 허용 높이차
  var SK = {
    fireball: { k: 'proj', r: 700 }, flamedash: { k: 'dash', r: 240 },
    pillar: { k: 'fwd', min: 160, r: 280 }, inferno: { k: 'aoe', r: 210 },
    watercannon: { k: 'fwd', min: 0, r: 380, dy: 70 }, water_bubble: { k: 'arc', r: 420 },
    water_whirlpool: { k: 'fwd', min: 70, r: 320 }, water_tsunami: { k: 'fwd', min: 0, r: 600, dy: 160 },
    vinebind: { k: 'fwd', min: 50, r: 260 }, grass_leaf: { k: 'proj', r: 480 },
    grass_bloom: { k: 'heal' }, grass_thorns: { k: 'fwd', min: 60, r: 420 },
    chainbolt: { k: 'tgt', r: 420 }, elec_spark: { k: 'proj', r: 300 },
    elec_blink: { k: 'dash', r: 280 }, elec_storm: { k: 'fwd', min: 60, r: 420, dy: 200 },
    iceshard: { k: 'proj', r: 650 }, ice_wall: { k: 'wall', r: 220 },
    ice_nova: { k: 'aoe', r: 150 }, ice_blizzard: { k: 'aoe', r: 210 },
    tornado: { k: 'proj', r: 520, dy: 90 }, wind_slash: { k: 'proj', r: 600 },
    wind_updraft: { k: 'up' }, wind_gale: { k: 'fwd', min: 0, r: 450, dy: 140 },
    rockspike: { k: 'fwd', min: 60, r: 380 }, rock_pebble: { k: 'arc', r: 420 },
    rock_wall: { k: 'wall', r: 200 }, rock_quake: { k: 'aoe', r: 380, ground: true },
    sandstorm: { k: 'fwd', min: 30, r: 300, dy: 120 }, sand_blast: { k: 'melee', r: 200, dy: 80 },
    sand_dash: { k: 'dash', r: 280 }, sand_pit: { k: 'fwd', min: 80, r: 300 },
    bodyboost: { k: 'buff' }, body_jab: { k: 'melee', r: 95 },
    body_tackle: { k: 'dash', r: 300, hit: true }, body_meteor: { k: 'fwd', min: 60, r: 320, dy: 200 },
    psychograb: { k: 'tgt', r: 420 }, psy_bolt: { k: 'proj', r: 600, dy: 150 },
    psy_levitate: { k: 'aoe', r: 110 }, psy_storm: { k: 'aoe', r: 450, dy: 300 },
    blackhole: { k: 'fwd', min: 110, r: 380, dy: 160 }, void_orb: { k: 'proj', r: 450, dy: 80 },
    void_phase: { k: 'dash', r: 300, hit: true }, void_well: { k: 'fwd', min: 80, r: 320 },
    timestop: { k: 'aoe', r: 380, dy: 300 }, time_bolt: { k: 'proj', r: 600 },
    time_rewind: { k: 'skip' }, time_hands: { k: 'aoe', r: 170 },
    dragonsummon: { k: 'map' }, dragon_claw: { k: 'melee', r: 110 },
    dragon_wing: { k: 'dash', r: 330, hit: true }, dragon_breath: { k: 'fwd', min: 0, r: 260 }
  };
  var DEFAULT_SK = [{ k: 'proj', r: 450 }, { k: 'fwd', min: 40, r: 280 }, { k: 'fwd', min: 40, r: 300 }, { k: 'aoe', r: 230 }];
  // 표에 없는 기술: def.ai 힌트 {kind:'proj'|'melee'|'dash'|'buff'|'zone'|'summon', range} → 위 형식으로 변환 (캐시)
  var hintCache = {};
  function hintInfo(id) {
    if (hasOwn.call(hintCache, id)) { return hintCache[id]; }
    var Sk = S(), def = Sk && Sk.defs && hasOwn.call(Sk.defs, id) ? Sk.defs[id] : null;
    var ai = def && def.ai && typeof def.ai === 'object' ? def.ai : null;
    var out = null;
    if (ai) {
      var r = (typeof ai.range === 'number' && ai.range > 0) ? ai.range : 0;
      switch (ai.kind) {
        case 'proj': out = { k: 'proj', r: r || 500, dy: 80 }; break;
        case 'melee': out = { k: 'melee', r: r || 110, dy: 80 }; break;
        case 'dash': out = { k: 'dash', r: r || 280, hit: true }; break;
        case 'buff': out = { k: 'buff' }; break;
        case 'zone': out = { k: 'fwd', min: 0, r: r || 300, dy: 140 }; break;
        case 'summon': out = { k: 'tgt', r: r || 520 }; break;
        default: out = null;
      }
    }
    // 힌트가 없을 때만 캐시 (기술 파일이 나중에 로드돼도 힌트를 다시 찾도록)
    if (out || def) { hintCache[id] = out; }
    return out;
  }
  function infoOf(id, idx) {
    if (id && hasOwn.call(SK, id)) { return SK[id]; }
    var h = id ? hintInfo(id) : null;
    return h || DEFAULT_SK[idx] || DEFAULT_SK[0];
  }

  var EASY_KITS = ['fire', 'water', 'grass', 'electric', 'ice', 'wind', 'rock', 'sand', 'body'];

  // ---------------------------------------------------------------- 상태
  var cfg = { count: 0, difficulty: 'normal' };
  var bots = [];        // 권한측이 시뮬레이션하는 봇 플레이어 객체
  var nextIdHint = 1;

  function H() { return G._botHooks || null; }
  function S() { return G.Skills || null; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function alive(e) { return !!e && e.alive !== false; }
  function cx(e) { return e.x + (e.w || 34) / 2; }
  function cy(e) { return e.y + (e.h || 62) / 2; }
  function diff() { return DIFF[cfg.difficulty] || DIFF.normal; }
  function simAuthority() { return G.mode === 'practice' || G.mode === 'host'; }
  function isHostOnline() { return G.mode === 'host'; }
  function netSend(msg, to) { var h = H(); if (h) { h.netSend(msg, to); } }
  function setReserved() {
    var N = G.Net;
    if (N && typeof N.setReserved === 'function') {
      try { N.setReserved(cfg.count); } catch (e) { /* 무시 */ }
    }
  }

  // ---------------------------------------------------------------- 슬롯
  function usedSlots(exceptBot) {
    var used = {};
    var P = G.players;
    if (P && P.local) { used[P.local.slot] = 1; }
    var N = G.Net;
    if (G.mode !== 'practice' && N && Array.isArray(N.peers)) {
      for (var i = 0; i < N.peers.length; i++) { if (N.peers[i] && typeof N.peers[i].slot === 'number') { used[N.peers[i].slot] = 1; } }
    }
    if (P && P.others) {
      for (var k in P.others) {
        if (hasOwn.call(P.others, k) && P.others[k] && P.others[k] !== exceptBot) { used[P.others[k].slot] = 1; }
      }
    }
    return used;
  }
  // 비어 있는 가장 높은 슬롯 (봇은 7,6,5…)
  function highestFree(used) {
    for (var s = 7; s >= 0; s--) { if (!used[s]) { return s; } }
    return -1;
  }
  function freeId() {
    var P = G.players;
    for (var i = 1; i <= MAX_BOTS; i++) {
      var id = 'b' + i;
      if (!(P && P.others && P.others[id])) { return id; }
    }
    return 'b' + (++nextIdHint + MAX_BOTS);
  }
  function humans() {
    if (G.mode === 'practice' || !G.Net || !Array.isArray(G.Net.peers) || !G.Net.peers.length) { return 1; }
    return G.Net.peers.length;
  }

  // ---------------------------------------------------------------- 키트
  function kitIds(kit) { return kit && Array.isArray(kit.ids) ? kit.ids : []; }
  function usableKit(kit) {
    var Sk = S();
    if (!Sk || !kit) { return false; }
    var n = 0, ids = kitIds(kit);
    for (var i = 0; i < 4; i++) { if (ids[i] && Sk.defs && hasOwn.call(Sk.defs, ids[i])) { n++; } }
    return n >= 3;
  }
  function pickElement(taken) {
    var Sk = S();
    var list = (Sk && Array.isArray(Sk.kits)) ? Sk.kits : [];
    var pool = [], i;
    for (i = 0; i < list.length; i++) {
      var k = list[i];
      if (cfg.difficulty === 'easy' && EASY_KITS.indexOf(k.element) < 0) { continue; }
      if (!usableKit(k)) { continue; }
      pool.push(k.element);
    }
    if (!pool.length) { return 'fire'; }
    var fresh = [];
    for (i = 0; i < pool.length; i++) { if (!taken[pool[i]]) { fresh.push(pool[i]); } }
    var src = fresh.length ? fresh : pool;
    return src[Math.floor(Math.random() * src.length) % src.length];
  }
  function resolveSlots(bot) {
    var Sk = S();
    var slots = (Sk && typeof Sk.kitSlots === 'function') ? Sk.kitSlots(bot.element) : [null, null, null, null];
    var n = 0;
    for (var i = 0; i < 4; i++) { if (slots[i]) { n++; } }
    if (!n && bot.element !== 'fire') {    // 키트 파일이 없으면 불꽃으로
      bot.element = 'fire';
      slots = (Sk && typeof Sk.kitSlots === 'function') ? Sk.kitSlots('fire') : slots;
    }
    bot.slots = slots;
    bot._slotsOk = !!(slots[0] || slots[1] || slots[2] || slots[3]);
  }

  // ---------------------------------------------------------------- 생성 / 제거
  function newBrain() {
    return {
      think: rnd(0, 0.3), react: rnd(0.2, 0.6), target: null, tKind: 'p',
      input: { dir: 0, down: false, jumpHeld: false, jumpPressed: false },
      holdJump: 0, mode: 'fight', stuckT: 0, lastX: 0, castWait: 0, wander: 0, wanderDir: 1,
      hurtBy: null, hurtT: 0, plat: null
    };
  }
  function spawnBot(taken) {
    var h = H();
    if (!h) { return null; }
    var slot = highestFree(usedSlots(null));
    if (slot < 0) { return null; }
    var id = freeId();
    var p = h.addBotPlayer(id, slot, true);
    p.element = pickElement(taken || {});
    p._cd = {};
    p._castLock = 0;
    p._ai = newBrain();
    p._lastAtk = null;
    resolveSlots(p);
    h.resetPlayer(p);
    p._hasState = true;
    p.invulnTimer = 1;
    bots.push(p);
    return p;
  }
  function removeBot(p) {
    var h = H();
    var i = bots.indexOf(p);
    if (i >= 0) { bots.splice(i, 1); }
    if (h && p) { h.removePlayer(p.id); }
  }
  function syncBotsToCount(force) {
    if (!simAuthority() || !(G.running || force)) { return; }
    pruneBots();
    var want = cfg.count;
    var taken = {};
    for (var i = 0; i < bots.length; i++) { taken[bots[i].element] = 1; }
    while (bots.length > want) { removeBot(bots[bots.length - 1]); }
    var guard = 0;
    while (bots.length < want && guard++ < 10) {
      var b = spawnBot(taken);
      if (!b) { break; }
      taken[b.element] = 1;
      if (G.scores && !(b.id in G.scores)) { G.scores[b.id] = 0; }
    }
    if (bots.length < want) { cfg.count = bots.length; }
    setReserved();
  }
  // 외부에서 others 가 초기화된 경우 정리
  function pruneBots() {
    var P = G.players;
    for (var i = bots.length - 1; i >= 0; i--) {
      if (!P || !P.others || P.others[bots[i].id] !== bots[i]) { bots.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- 피해 (권한측)
  function damage(bot, amount, kx, ky, attackerId) {
    if (!bot || !bot.isBot || !bot._sim || !alive(bot) || G.matchOver) { return false; }
    if (bot.invulnTimer > 0) { return false; }
    var h = H();
    if (attackerId === bot.id || attackerId === '' || attackerId === 'local') { attackerId = null; }
    if (attackerId != null && G.bossMode) { return false; }   // 보스전: 아군끼리 피해 없음
    if (attackerId != null) { bot._lastAtk = { id: attackerId, t: G.time }; }
    amount = +amount || 0;
    if (bot.boostTimer > 0) { amount *= (h ? h.boostArmor : 0.6); }
    bot.hp -= amount;
    bot.vx += +kx || 0;
    bot.vy += +ky || 0;
    bot.onGround = false;
    bot._plat = null;
    bot.hitFlash = 0.15;
    bot.invulnTimer = 0.25;
    var ai = bot._ai;
    if (ai && attackerId != null) { ai.hurtBy = attackerId; ai.hurtT = G.time; }
    var unm = typeof G.unmuted === 'function' ? G.unmuted : function (f) { return f(); };
    unm(function () {
      if (typeof G.spawnParticles === 'function') { G.spawnParticles(cx(bot), bot.y + bot.h * 0.4, 12, '#ff3b30', 240); }
    });
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.respawnTimer = h ? h.respawnTime : 3;
      bot.vx = 0; bot.vy = 0;
      bot._dash = null; bot._castLock = 0;
      var killer = attackerId;
      var la = bot._lastAtk;
      if (killer == null && la && G.time - la.t <= (h ? h.koCreditTime : 6)) { killer = la.id; }
      bot._lastAtk = null;
      unm(function () {
        if (h) {
          h.koBurst(bot);
          if (isHostOnline()) { netSend({ t: 'ko', by: killer, victim: bot.id }); }
          h.creditKill(killer, bot.id);
        }
      });
    }
    return true;
  }

  // ---------------------------------------------------------------- AI
  function enemiesOf(bot) {
    var P = G.players, out = [];
    if (G.bossMode) { return out; }   // 보스전: 플레이어/봇은 모두 아군
    var all = P && typeof P.all === 'function' ? P.all() : [];
    for (var i = 0; i < all.length; i++) {
      var q = all[i];
      if (q && q !== bot && alive(q)) { out.push(q); }
    }
    return out;
  }
  function mutantTargets() {
    var l = (G.Mutants && G.Mutants.list) || [];
    var out = [];
    for (var i = 0; i < l.length; i++) { if (alive(l[i])) { out.push(l[i]); } }
    return out;
  }
  function chooseTarget(bot, D) {
    var ai = bot._ai;
    var bx = cx(bot), by = cy(bot);
    var best = null, bs = Infinity, kind = 'p';
    var es = enemiesOf(bot);
    for (var i = 0; i < es.length; i++) {
      var q = es[i];
      var s = Math.abs(cx(q) - bx) + 1.6 * Math.abs(cy(q) - by);
      if (q.invulnTimer > 0.6) { s += 250; }
      if (ai.target === q) { s -= D.stick; }
      if (ai.hurtBy != null && q.id === ai.hurtBy && G.time - ai.hurtT < 4) { s -= 220; }
      if (q.hp < 35) { s -= 90; }   // 마무리 노리기
      if (s < bs) { bs = s; best = q; kind = 'p'; }
    }
    if (D.mutants || G.bossMode) {
      var ms = mutantTargets();
      for (var j = 0; j < ms.length; j++) {
        var m = ms[j];
        var sm = (Math.abs(cx(m) - bx) + 1.6 * Math.abs(cy(m) - by)) * (m.boss ? 0.9 : 1.35) + (m.boss ? 0 : 60);
        if (ai.target === m) { sm -= D.stick; }
        if (sm < bs) { bs = sm; best = m; kind = 'm'; }
      }
    }
    ai.target = best;
    ai.tKind = kind;
    return best;
  }

  // 교전 거리: J 기술 기준
  function preferredRange(bot) {
    var s = bot.slots || [];
    var inf = infoOf(s[0], 0);
    switch (inf.k) {
      case 'proj': return Math.min(420, inf.r * 0.6);
      case 'arc': return Math.min(360, inf.r * 0.7);
      case 'melee': return Math.max(50, inf.r * 0.6);
      case 'fwd': return ((inf.min || 0) + inf.r) * 0.5;
      case 'tgt': return inf.r * 0.6;
      default: return 240;
    }
  }

  // 발판 이동: 목표가 위에 있으면 오를 발판, 아래면 내려가기
  function platNav(bot, tx, tFeet) {
    if (G.world && G.world.platformsLocked) { return null; }   // 발판 봉쇄 중엔 오르지 않음
    var plats = (G.world && G.world.platforms) || [];
    var feet = bot.y + bot.h, bx = cx(bot);
    var best = null, bc = Infinity;
    for (var i = 0; i < plats.length; i++) {
      var pl = plats[i];
      if (pl.y > feet - 25 || pl.y < feet - 165) { continue; }   // 한 번 점프로 닿는 높이
      var pc = pl.x + pl.w / 2;
      var c = Math.abs(pc - tx) + 0.6 * Math.abs(pl.y - tFeet) + 0.35 * Math.abs(pc - bx);
      if (c < bc) { bc = c; best = pl; }
    }
    return best;
  }

  function incomingThreat(bot, es) {
    var bx = cx(bot), by = cy(bot);
    for (var i = 0; i < es.length; i++) {
      var q = es[i];
      if (!(q.castTimer > 0.12)) { continue; }
      var dx = bx - cx(q);
      if (Math.abs(dx) > 520 || Math.abs(by - cy(q)) > 80) { continue; }
      if ((dx > 0 ? 1 : -1) === (q.facing >= 0 ? 1 : -1)) { return q; }
    }
    return null;
  }

  function nearItem(bot, D) {
    var I = G.Items;
    if (!I || !Array.isArray(I.list) || !I.list.length || Math.random() > D.items) { return null; }
    var gy = G.world.groundY, bx = cx(bot), best = null, bd = 520;
    for (var i = 0; i < I.list.length; i++) {
      var it = I.list[i];
      if (!it || it.fall > 0) { continue; }
      var want = it.type === 'heal' ? bot.hp < bot.maxHp * 0.7 :
        (it.type === 'energy' ? bot.energy < 45 : true);
      if (!want) { continue; }
      var d = Math.abs(it.x - bx) + Math.abs((gy - (it.dy || 0) - 15) - cy(bot)) * 0.8;
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  // 아이템 줍기 (권한측) — items.js 와 같은 사각형, 효과 직접 적용 후 itemTook 방송
  function pickupItems(bot) {
    var I = G.Items;
    if (!I || !Array.isArray(I.list) || !I.list.length || typeof G.rectHit !== 'function') { return; }
    var gy = G.world.groundY;
    for (var i = I.list.length - 1; i >= 0; i--) {
      var it = I.list[i];
      if (!it || it.fall > 0) { continue; }
      var r = { x: it.x - 15, y: gy - (it.dy || 0) - 30, w: 30, h: 30 };
      if (!G.rectHit(bot, r)) { continue; }
      I.list.splice(i, 1);
      if (it.type === 'heal') { bot.hp = Math.min(bot.maxHp, bot.hp + 35); }
      else if (it.type === 'energy') { bot.energy = bot.maxEnergy; }
      else if (it.type === 'boost') { bot.boostTimer = Math.max(bot.boostTimer || 0, 6); }
      else if (it.type === 'shield') { bot.invulnTimer = Math.max(bot.invulnTimer || 0, 3); }
      if (typeof G.spawnParticles === 'function') { G.spawnParticles(it.x, r.y + 15, 16, '#fff3b0', 220); }
      if (isHostOnline()) { netSend({ t: 'itemTook', id: it.id, by: bot.id }); }
    }
  }

  // 기술 조건 판단 → 시전 시도. 성공하면 true
  function tryCasts(bot, tgt, D, dist) {
    var P = G.Powers;
    if (!P || typeof P.botCast !== 'function' || !bot._slotsOk) { return false; }
    var s = bot.slots;
    var bx = cx(bot), by = cy(bot);
    var dx = tgt ? cx(tgt) - bx : 0, adx = Math.abs(dx);
    var ady = tgt ? Math.abs(cy(tgt) - by) : 9999;
    var face = dx >= 0 ? 1 : -1;
    var lowHp = bot.hp < bot.maxHp * 0.4;
    var order = [3, 2, 1, 0];
    for (var oi = 0; oi < order.length; oi++) {
      var idx = order[oi], id = s[idx];
      if (!id || !P.botCanCast(bot, id)) { continue; }
      var def = G.Skills.defs[id];
      var inf = infoOf(id, idx);
      if (idx === 3 && Math.random() > D.ult) { continue; }
      if (idx !== 0 && idx !== 3 && bot.energy - def.cost < D.reserve && Math.random() < 0.5) { continue; }
      var dyOk = ady < (inf.dy || 60);
      var ok = false, f = face;
      switch (inf.k) {
        case 'proj': ok = tgt && dyOk && adx < inf.r - D.slop * 0.5; break;
        case 'arc': ok = tgt && ady < (inf.dy || 140) && adx > 80 && adx < inf.r; break;
        case 'melee': ok = tgt && dyOk && adx < inf.r; break;
        case 'fwd': ok = tgt && ady < (inf.dy || 100) && adx >= (inf.min || 0) && adx <= inf.r; break;
        case 'aoe': ok = tgt && dist < inf.r && ady < (inf.dy || 160) && (!inf.ground || (tgt.onGround !== false)); break;
        case 'tgt': ok = tgt && dist < inf.r; break;
        case 'dash':
          if (lowHp && dist < 260 && D.retreat > 0) { ok = true; f = -face; }       // 도망
          else { ok = tgt && ady < 70 && adx > inf.r * (inf.hit ? 0.3 : 0.6) && adx < inf.r * (inf.hit ? 1.1 : 1.6); }
          break;
        case 'up': ok = (tgt && cy(tgt) < by - 120 && adx < 300) || (lowHp && dist < 220); break;
        case 'buff': ok = tgt && dist < 500 && !(bot.boostTimer > 0); break;
        case 'heal': ok = bot.hp < bot.maxHp * 0.65 && (!tgt || dist > 120 || Math.random() < 0.4); break;
        case 'wall': ok = tgt && adx < inf.r && ady < 80 && (lowHp || Math.random() < 0.25); break;
        case 'map': ok = !!tgt; break;
        default: ok = false;
      }
      if (!ok) { continue; }
      if (Math.random() > D.cast) { continue; }
      bot.facing = f;
      if (P.botCast(bot, id)) {
        bot._ai.castWait = D.react * rnd(0.6, 1.2) + 0.08;
        return true;
      }
    }
    return false;
  }

  function think(bot, D) {
    var ai = bot._ai;
    var inp = ai.input;
    inp.down = false;
    if (!bot._slotsOk) { resolveSlots(bot); }
    var tgt = chooseTarget(bot, D);
    var bx = cx(bot), by = cy(bot), feet = bot.y + bot.h;
    var WW = (G.world && G.world.width) || 4200;

    if (!tgt && G.bossMode) {
      // 보스전: 보스가 없으면 가까운 사람 동료 곁으로 (적당한 간격 유지)
      var PL = G.players, mates = PL && typeof PL.all === "function" ? PL.all() : [], mate = null, md = Infinity;
      for (var mi = 0; mi < mates.length; mi++) {
        var q = mates[mi];
        if (!q || q.isBot || q === bot || !alive(q)) { continue; }
        var qd = Math.abs(cx(q) - bx);
        if (qd < md) { md = qd; mate = q; }
      }
      var gap = 90 + (bot.slot % 4) * 45;
      inp.dir = (mate && md > gap) ? (cx(mate) > bx ? 1 : -1) : 0;
      return;
    }
    if (!tgt) {
      // 상대 없음 → 배회
      ai.wander -= D.think;
      if (ai.wander <= 0) { ai.wander = rnd(1, 3); ai.wanderDir = Math.random() < 0.5 ? -1 : 1; }
      if (bx < 200) { ai.wanderDir = 1; } else if (bx > WW - 200) { ai.wanderDir = -1; }
      inp.dir = ai.wanderDir;
      return;
    }

    var tx = cx(tgt), ty = cy(tgt), tFeet = tgt.y + (tgt.h || 62);
    var dx = tx - bx, adx = Math.abs(dx), dist = Math.sqrt(dx * dx + (ty - by) * (ty - by));
    var es = enemiesOf(bot);
    var lowHp = bot.hp < bot.maxHp * D.retreat;
    var want = preferredRange(bot);
    var dir = 0;

    // 아이템
    var it = (lowHp || Math.random() < 0.35) ? nearItem(bot, D) : null;

    if (it && !(adx < 140 && !lowHp)) {
      dir = it.x > bx + 8 ? 1 : (it.x < bx - 8 ? -1 : 0);
      var iy = G.world.groundY - (it.dy || 0);
      if (iy < feet - 40) { tFeet = iy; tx = it.x; }
      ai.mode = 'item';
    } else if (lowHp && dist < 380) {
      // 후퇴 (벽에 몰리면 반대로)
      dir = dx > 0 ? -1 : 1;
      if ((dir < 0 && bx < 150) || (dir > 0 && bx > WW - 150)) { dir = -dir; }
      ai.mode = 'flee';
    } else {
      ai.mode = 'fight';
      var slop = (Math.random() * 2 - 1) * D.slop;
      if (adx > want + 50 + slop) { dir = dx > 0 ? 1 : -1; }
      else if (adx < want * 0.45 && want > 150) { dir = dx > 0 ? -1 : 1; }    // 원거리 키트는 거리 유지
      else { dir = 0; }
      if (Math.random() < D.idle) { dir = 0; }
    }

    // 높이 차 → 발판 이동
    var climbing = false;
    if (tFeet < feet - 70 && ai.mode !== 'flee') {
      var pl = platNav(bot, tx, tFeet);
      if (pl) {
        climbing = true;
        var left = pl.x + 12, right = pl.x + pl.w - 12;
        if (bx < left) { dir = 1; } else if (bx > right) { dir = -1; }
        else { dir = (pl.x + pl.w / 2) > bx ? 1 : -1; }
        var edgeGap = bx < left ? left - bx : (bx > right ? bx - right : 0);
        if (bot.onGround && edgeGap < 120) { inp.jumpPressed = true; ai.holdJump = 0.45; }
      }
    } else if (tFeet > feet + 50 && bot._plat && ai.mode !== 'flee') {
      if (adx < 420 || Math.random() < 0.3) { inp.down = true; }
    }

    // 회피 점프 / 가끔 뛰기
    if (bot.onGround && !climbing) {
      var th = incomingThreat(bot, es);
      if (th && Math.random() < D.dodge) { inp.jumpPressed = true; ai.holdJump = 0.3; }
      else if (Math.random() < D.hop && dist < 500) { inp.jumpPressed = true; ai.holdJump = rnd(0.05, 0.35); }
    }

    // 끼임 감지
    if (dir !== 0 && Math.abs(bot.x - ai.lastX) < 4 && bot.onGround) {
      ai.stuckT += D.think;
      if (ai.stuckT > 0.8) { inp.jumpPressed = true; ai.holdJump = 0.4; ai.stuckT = 0; }
    } else { ai.stuckT = 0; }
    ai.lastX = bot.x;

    inp.dir = dir;

    // 기술 (반응 지연)
    if (ai.react > 0 || ai.castWait > 0) { return; }
    if (bot.castTimer > 0) { return; }
    tryCasts(bot, tgt, D, dist);
  }

  function updateBot(bot, dt, D) {
    var h = H();
    var ai = bot._ai || (bot._ai = newBrain());
    if (G.Powers && typeof G.Powers.botTick === 'function') { G.Powers.botTick(bot, dt); }
    if (!alive(bot)) {
      G.stepPlayer(bot, null, dt);       // 타이머만
      bot.respawnTimer -= dt;
      if (bot.respawnTimer <= 0 && !G.matchOver && h) {
        h.resetPlayer(bot);
        bot._hasState = true;
        bot.invulnTimer = 1.5;
        bot._cd = bot._cd || {};
        h.respawnBurst(bot);
        ai.target = null; ai.react = D.react + 0.3;
      }
      return;
    }
    if (ai.react > 0) { ai.react -= dt; }
    if (ai.castWait > 0) { ai.castWait -= dt; }
    ai.think -= dt;
    if (ai.think <= 0 && !G.matchOver) {
      ai.think = D.think * rnd(0.8, 1.25);
      try { think(bot, D); } catch (e) { if (window.console) { console.error('[Bots] think', e); } }
    }
    var inp = ai.input;
    if (ai.holdJump > 0) { ai.holdJump -= dt; }
    inp.jumpHeld = ai.holdJump > 0;
    if (G.matchOver) { inp.dir = 0; inp.jumpPressed = false; }
    G.stepPlayer(bot, inp, dt);
    inp.jumpPressed = false;
    pickupItems(bot);
  }

  // ---------------------------------------------------------------- 네트워크: 슬롯 충돌
  window.addEventListener('net:peerjoin', function (e) {
    var d = (e && e.detail) || {};
    if (!isHostOnline() || typeof d.slot !== 'number') { return; }
    pruneBots();
    var h = H();
    for (var i = 0; i < bots.length; i++) {
      var b = bots[i];
      if (b.slot !== d.slot) { continue; }
      var used = usedSlots(b);
      used[d.slot] = 1;
      var s = highestFree(used);
      if (s >= 0 && h) {
        h.setPlayerSlot(b, s);
      } else {
        removeBot(b);
        cfg.count = Math.max(0, cfg.count - 1);
        setReserved();
      }
      break;
    }
  });

  // ---------------------------------------------------------------- 공개 API
  var Bots = {
    difficulty: 'normal',
    // { count, difficulty } — Game.start 전에 호출. 경기 중 권한측이면 즉시 반영
    configure: function (o) {
      o = o || {};
      if (typeof o.difficulty === 'string' && DIFF[o.difficulty]) { cfg.difficulty = o.difficulty; }
      Bots.difficulty = cfg.difficulty;
      if (o.count != null) { Bots.setCount(o.count); }
      return { count: cfg.count, difficulty: cfg.difficulty };
    },
    setCount: function (n) {
      n = Math.max(0, Math.min(MAX_BOTS, (+n || 0) | 0));
      cfg.count = n;
      if (G.running && simAuthority()) {
        var cap = Math.max(0, 8 - humans());
        if (cfg.count > cap) { cfg.count = cap; }
        syncBotsToCount();
      }
      setReserved();
      return cfg.count;
    },
    // 봇 수: 권한측/시작 전 = 설정값, 게스트 = 보이는 봇 수
    count: function () {
      if (G.mode === 'guest') { return Bots.list().length; }
      return cfg.count;
    },
    // 봇 플레이어 객체 배열 (권한측: 시뮬레이션 중인 봇, 게스트: 표시 중인 봇)
    list: function () {
      if (G.mode === 'guest') {
        var out = [], P = G.players;
        var os = P && typeof P.list === 'function' ? P.list() : [];
        for (var i = 0; i < os.length; i++) { if (os[i] && os[i].isBot) { out.push(os[i]); } }
        return out;
      }
      pruneBots();
      return bots.slice();
    },
    damage: damage,
    isBot: function (id) { var P = G.players, p = P && P.byId ? P.byId(id) : null; return !!(p && p.isBot); },

    // world.js 가 호출
    onStart: function () {
      bots = [];
      if (!simAuthority()) { return; }
      var want = cfg.count;
      cfg.count = Math.min(want, Math.max(0, 8 - humans()));
      syncBotsToCount(true);
    },
    onRestart: function () {
      pruneBots();
      for (var i = 0; i < bots.length; i++) {
        var b = bots[i];
        b._hasState = true;
        b._cd = {};
        b._castLock = 0;
        b._dash = null;
        b._ai = newBrain();
        b.invulnTimer = 1;
      }
    },
    update: function (dt) {
      if (!bots.length || !simAuthority() || !(dt > 0)) { return; }
      if (typeof G.stepPlayer !== 'function') { return; }
      pruneBots();
      var D = diff();
      for (var i = 0; i < bots.length; i++) { updateBot(bots[i], dt, D); }
    },
    _debug: function () { return { cfg: cfg, bots: bots, SK: SK }; }
  };

  G.Bots = Bots;
})();
