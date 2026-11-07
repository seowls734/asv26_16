/* 초능력자: 각성 — 돌연변이 동물 (Game.Mutants)
 * 호스트(및 연습 모드)만 AI/스폰/사망을 시뮬레이션하고, 게스트는 스냅샷을 보간해서 그린다.
 * 공격 판정(로컬 플레이어 대상)은 모든 클라이언트에서 수행.
 */
(function () {
  'use strict';

  var Game = window.Game = window.Game || {};

  // ---------------------------------------------------------------- 상수
  var TYPES = {
    rat:  { w: 40, h: 26, speed: 300, hp: 30, dmg: 6,  knockX: 260, knockY: -200, flying: false },
    dog:  { w: 64, h: 42, speed: 220, hp: 60, dmg: 14, knockX: 620, knockY: -380, flying: false },
    crow: { w: 44, h: 30, speed: 260, hp: 25, dmg: 10, knockX: 340, knockY: -260, flying: true }
  };
  var MAX_ALIVE = 6;
  var FIRST_SPAWN = 8;
  var SNAP_INTERVAL = 1 / 12;
  var DMG_INTERVAL = 0.6;

  var TOXIC = '#8dff3c';
  var TOXIC_HOT = '#e6ff9a';

  // ---------------------------------------------------------------- 내부 상태
  var nextId = 1;
  var spawnTimer = FIRST_SPAWN;
  var matchTime = 0;
  var snapTimer = 0;
  var lastGuestToast = -10;
  var clock = 0;
  var handlersRegistered = false;

  function net() { return Game.Net || null; }

  function isAuthority() {
    if (Game.mode === 'practice') return true;
    if (Game.mode === 'guest') return false;
    var n = net();
    if (!n) return true;
    return n.isHost !== false;
  }

  function isOnlineHost() {
    var n = net();
    return !!(n && n.mode === 'host' && n.connected && Game.mode !== 'practice');
  }

  function myNetId() {
    var n = net();
    if (n && n.myId != null) return n.myId;
    var lp = Game.players && Game.players.local;
    return (lp && lp.id != null) ? lp.id : 'h';
  }
  // 호스트가 보낸 메시지인가 (from 없으면 구버전 호환으로 허용)
  function fromHost(msg) { return !msg || msg.from == null || msg.from === 'h'; }

  function send(msg, toId) {
    var n = net();
    if (n && typeof n.send === 'function' && Game.mode !== 'practice') {
      try { if (toId != null) n.send(msg, toId); else n.send(msg); } catch (e) { /* 무시 */ }
    }
  }

  function world() { return Game.world || { width: 4200, groundY: 600, platforms: [] }; }
  function gravity() { return typeof Game.gravity === 'number' ? Game.gravity : 2200; }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function rectHit(a, b) {
    if (typeof Game.rectHit === 'function') return Game.rectHit(a, b);
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function particles(x, y, n, color, speed) {
    if (typeof Game.spawnParticles === 'function') Game.spawnParticles(x, y, n, color, speed);
  }
  function shake(a) { if (typeof Game.shake === 'function') Game.shake(a); }
  function toast(t) { if (typeof Game.toast === 'function') Game.toast(t); }

  // 경기 진행도 0..1 (약 3분에 최대 난이도)
  function difficulty() { return clamp(matchTime / 180, 0, 1); }

  // ---------------------------------------------------------------- 생성
  function makeMutant(type, id, x, y) {
    var T = TYPES[type] || TYPES.rat;
    return {
      id: id, type: type,
      x: x, y: y, w: T.w, h: T.h,
      vx: 0, vy: 0, facing: 1,
      hp: T.hp, maxHp: T.hp,
      state: 'idle', stateTimer: 0,
      hitFlash: 0, alive: true,
      attackCd: rand(0.6, 1.2),
      target: null,
      onGround: false,
      dropTimer: 0,
      dmgCd: 0,          // 로컬 플레이어에게 준 피해 간격 (클라이언트별)
      animT: Math.random() * 10,
      wanderDir: Math.random() < 0.5 ? -1 : 1,
      wanderTimer: rand(1, 3),
      hoverPhase: Math.random() * Math.PI * 2,
      diveVx: 0, diveVy: 0,
      seed: ((id * 2654435761) >>> 0) % 1000 / 1000,
      tx: x, ty: y        // 게스트 보간 목표
    };
  }

  function pickType() {
    var t = difficulty();
    var wr = 0.6 - 0.35 * t, wd = 0.25 + 0.2 * t, wc = 0.15 + 0.15 * t;
    var r = Math.random() * (wr + wd + wc);
    if (r < wr) return 'rat';
    if (r < wr + wd) return 'dog';
    return 'crow';
  }

  function aliveCount() {
    var c = 0;
    for (var i = 0; i < Mutants.list.length; i++) if (Mutants.list[i].alive) c++;
    return c;
  }

  function spawnOne(type) {
    var W = world();
    var T = TYPES[type];
    var side = Math.random() < 0.5 ? -1 : 1;
    var x, y;
    if (T.flying) {
      x = rand(200, W.width - 200 - T.w);
      y = W.groundY - rand(420, 560);
    } else {
      x = side < 0 ? rand(10, 60) : W.width - T.w - rand(10, 60);
      y = W.groundY - T.h - rand(0, 160); // 살짝 위에서 떨어지며 등장
    }
    var m = makeMutant(type, nextId++, x, y);
    m.facing = side < 0 ? 1 : -1;
    m.wanderDir = m.facing;
    Mutants.list.push(m);
    particles(x + T.w / 2, y + T.h / 2, 18, TOXIC, 220);
    send({ t: 'mutantFx', kind: 'spawn', id: m.id, x: Math.round(x + T.w / 2), y: Math.round(y + T.h / 2), gy: world().groundY });
    return m;
  }

  function spawnWave() {
    var t = difficulty();
    var maxCount = 1 + Math.round(t * 2); // 1 → 3
    var count = 1 + Math.floor(Math.random() * maxCount);
    count = Math.min(count, 3, MAX_ALIVE - aliveCount());
    if (count <= 0) return;
    for (var i = 0; i < count; i++) spawnOne(pickType());
    toast('돌연변이 출현!');
  }

  // ---------------------------------------------------------------- 목표
  function candidatePlayers() {
    var out = [];
    var P = Game.players || {};
    if (P.local && P.local.alive) out.push(P.local);
    // 8인 개인전: 다른 플레이어 전부
    var others = typeof P.list === 'function' ? P.list() : [];
    for (var i = 0; i < others.length; i++) if (others[i] && others[i].alive) out.push(others[i]);
    return out;
  }

  function nearestTarget(m) {
    var c = candidatePlayers();
    var best = null, bd = Infinity;
    var mx = m.x + m.w / 2, my = m.y + m.h / 2;
    for (var i = 0; i < c.length; i++) {
      var p = c[i];
      var dx = p.x + p.w / 2 - mx, dy = p.y + p.h / 2 - my;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function setState(m, s, t) { m.state = s; m.stateTimer = t || 0; }

  // ---------------------------------------------------------------- 지면 물리
  function groundPhysics(m, dt) {
    var W = world();
    var prevBottom = m.y + m.h;
    m.vy += gravity() * dt;
    if (m.vy > 1600) m.vy = 1600;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.onGround = false;
    var bottom = m.y + m.h;
    if (m.vy >= 0 && m.dropTimer <= 0 && W.platforms) {
      for (var i = 0; i < W.platforms.length; i++) {
        var p = W.platforms[i];
        if (!p) continue;
        if (m.x + m.w > p.x && m.x < p.x + p.w && prevBottom <= p.y + 1 && bottom >= p.y) {
          m.y = p.y - m.h; m.vy = 0; m.onGround = true; bottom = p.y;
          break;
        }
      }
    }
    if (m.y + m.h >= W.groundY) { m.y = W.groundY - m.h; m.vy = 0; m.onGround = true; }
    if (m.x < 0) { m.x = 0; m.vx = Math.abs(m.vx) * 0.3; m.wanderDir = 1; }
    if (m.x + m.w > W.width) { m.x = W.width - m.w; m.vx = -Math.abs(m.vx) * 0.3; m.wanderDir = -1; }
  }

  function approach(v, target, rate, dt) {
    var d = target - v, s = rate * dt;
    if (Math.abs(d) <= s) return target;
    return v + (d > 0 ? s : -s);
  }

  // 지면 몬스터가 목표 높이를 따라가도록 점프/하강
  function navigateVertical(m, tgt) {
    var tb = tgt.y + tgt.h, mb = m.y + m.h;
    var dx = Math.abs((tgt.x + tgt.w / 2) - (m.x + m.w / 2));
    if (!m.onGround) return;
    if (tb < mb - 60 && dx < 260) {
      m.vy = m.type === 'rat' ? -760 : -880;
      m.onGround = false;
    } else if (tb > mb + 40 && mb < world().groundY - 2 && dx < 320) {
      m.dropTimer = 0.25;
    }
  }

  // ---------------------------------------------------------------- AI: 지면 (쥐/개)
  function updateGround(m, dt) {
    var T = TYPES[m.type];
    var diff = difficulty();
    var spd = T.speed * (1 + 0.25 * diff);
    var tgt = nearestTarget(m);
    m.target = tgt;
    m.attackCd -= dt;
    if (m.dropTimer > 0) m.dropTimer -= dt;

    var cx = m.x + m.w / 2;
    var dxT = 0, dyT = 0;
    if (tgt) {
      dxT = (tgt.x + tgt.w / 2) - cx;
      dyT = (tgt.y + tgt.h) - (m.y + m.h);
    }

    switch (m.state) {
      case 'idle':
      case 'chase':
        if (!tgt) {
          m.state = 'idle';
          m.wanderTimer -= dt;
          if (m.wanderTimer <= 0) { m.wanderDir = -m.wanderDir; m.wanderTimer = rand(1.5, 3.5); }
          m.vx = approach(m.vx, m.wanderDir * spd * 0.3, 900, dt);
          m.facing = m.wanderDir;
          break;
        }
        m.state = 'chase';
        m.facing = dxT >= 0 ? 1 : -1;
        var range = m.type === 'rat' ? 56 : 250;
        var vRange = m.type === 'rat' ? 50 : 70;
        if (Math.abs(dxT) < range && Math.abs(dyT) < vRange && m.attackCd <= 0 && m.onGround) {
          setState(m, 'windup', m.type === 'rat' ? 0.28 : 0.5);
          m.vx = 0;
          break;
        }
        var desired = Math.abs(dxT) > 8 ? m.facing * spd : 0;
        if (m.type === 'dog' && Math.abs(dxT) < 90 && m.attackCd > 0) desired = -m.facing * spd * 0.4; // 거리 벌리기
        m.vx = approach(m.vx, desired, 1400, dt);
        navigateVertical(m, tgt);
        break;

      case 'windup':
        m.vx = approach(m.vx, 0, 2000, dt);
        if (tgt) m.facing = dxT >= 0 ? 1 : -1;
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) {
          if (m.type === 'rat') {
            setState(m, 'attack', 0.3);
            m.vx = m.facing * 420 * (1 + 0.2 * diff);
            m.vy = -280; m.onGround = false;
          } else {
            setState(m, 'attack', 0.5);
            m.vx = m.facing * 640 * (1 + 0.2 * diff);
            m.vy = -120; m.onGround = false;
          }
        }
        break;

      case 'attack':
        m.stateTimer -= dt;
        if (m.type === 'dog') m.vx = approach(m.vx, m.facing * 560, 600, dt);
        if (m.stateTimer <= 0) {
          setState(m, 'recover', (m.type === 'rat' ? 0.45 : 0.7) * (1 - 0.35 * diff));
        }
        break;

      case 'recover':
        m.vx = approach(m.vx, 0, 1600, dt);
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) {
          m.attackCd = (m.type === 'rat' ? 0.5 : 1.0) * (1 - 0.4 * diff);
          setState(m, 'chase', 0);
        }
        break;

      case 'hurt':
        m.vx = approach(m.vx, 0, 900, dt);
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) setState(m, 'chase', 0);
        break;

      default:
        setState(m, 'idle', 0);
    }
    groundPhysics(m, dt);
  }

  // ---------------------------------------------------------------- AI: 까마귀
  function updateCrow(m, dt) {
    var W = world();
    var diff = difficulty();
    var spd = TYPES.crow.speed * (1 + 0.25 * diff);
    var tgt = nearestTarget(m);
    m.target = tgt;
    m.attackCd -= dt;
    m.hoverPhase += dt * 2.2;
    var cx = m.x + m.w / 2, cy = m.y + m.h / 2;

    function steerTo(px, py, maxSp, accel) {
      var dx = px - cx, dy = py - cy;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var want = Math.min(maxSp, d * 3);
      m.vx = approach(m.vx, dx / d * want, accel, dt);
      m.vy = approach(m.vy, dy / d * want, accel, dt);
    }

    switch (m.state) {
      case 'idle':
      case 'chase':
        if (!tgt) {
          m.state = 'idle';
          m.wanderTimer -= dt;
          if (m.wanderTimer <= 0) { m.wanderDir = -m.wanderDir; m.wanderTimer = rand(2, 4); }
          var hy = W.groundY - 380 + Math.sin(m.hoverPhase) * 40;
          steerTo(cx + m.wanderDir * 200, hy, spd * 0.45, 500);
          if (Math.abs(m.vx) > 10) m.facing = m.vx > 0 ? 1 : -1;
          break;
        }
        m.state = 'chase';
        var tcx = tgt.x + tgt.w / 2;
        var ox = Math.cos(m.hoverPhase * 0.7) * 130;
        var oy = Math.sin(m.hoverPhase * 1.3) * 25;
        steerTo(tcx + ox, tgt.y - 170 + oy, spd, 700);
        m.facing = tcx >= cx ? 1 : -1;
        var adx = Math.abs(tcx - cx);
        if (m.attackCd <= 0 && adx < 200 && cy < tgt.y - 60) {
          setState(m, 'windup', 0.42);
        }
        break;

      case 'windup':
        m.vx = approach(m.vx, 0, 900, dt);
        m.vy = approach(m.vy, -40, 900, dt);
        m.stateTimer -= dt;
        if (tgt) m.facing = (tgt.x + tgt.w / 2) >= cx ? 1 : -1;
        if (m.stateTimer <= 0) {
          var ax = tgt ? tgt.x + tgt.w / 2 : cx + m.facing * 100;
          var ay = tgt ? tgt.y + tgt.h / 2 : W.groundY;
          var ddx = ax - cx, ddy = ay - cy;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          var ds = 720 * (1 + 0.2 * diff);
          m.vx = ddx / dd * ds; m.vy = ddy / dd * ds;
          setState(m, 'attack', 0.75);
        }
        break;

      case 'attack':
        m.stateTimer -= dt;
        if (m.y + m.h >= W.groundY - 4 || m.stateTimer <= 0) {
          setState(m, 'recover', 0.8 * (1 - 0.3 * diff));
          m.vy = -300;
        }
        break;

      case 'recover':
        m.vx = approach(m.vx, 0, 500, dt);
        m.vy = approach(m.vy, -260, 900, dt);
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) {
          m.attackCd = rand(1.4, 2.4) * (1 - 0.4 * diff);
          setState(m, 'chase', 0);
        }
        break;

      case 'hurt':
        m.vx = approach(m.vx, 0, 700, dt);
        m.vy = approach(m.vy, 0, 700, dt);
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) setState(m, 'chase', 0);
        break;

      default:
        setState(m, 'idle', 0);
    }

    m.x += m.vx * dt;
    m.y += m.vy * dt;
    // 경계
    var topLimit = W.groundY - 760;
    if (m.y < topLimit) { m.y = topLimit; if (m.vy < 0) m.vy = 0; }
    if (m.y + m.h > W.groundY) { m.y = W.groundY - m.h; if (m.vy > 0) m.vy = 0; }
    if (m.x < 0) { m.x = 0; if (m.vx < 0) m.vx = 0; m.wanderDir = 1; }
    if (m.x + m.w > W.width) { m.x = W.width - m.w; if (m.vx > 0) m.vx = 0; m.wanderDir = -1; }
  }

  // ---------------------------------------------------------------- 게스트 보간
  function updateGuestMutant(m, dt) {
    m.tx += m.vx * dt;
    m.ty += m.vy * dt;
    var k = Math.min(1, dt * 14);
    m.x += (m.tx - m.x) * k;
    m.y += (m.ty - m.y) * k;
    if (m.stateTimer > 0) m.stateTimer = Math.max(0, m.stateTimer - dt);
  }

  function applySnapshot(msg) {
    if (isAuthority() || !fromHost(msg)) return;
    var arr = (msg && msg.list) || [];
    // 화면 높이가 달라 groundY 가 다를 수 있으므로 보낸 쪽 기준으로 보정
    var gyOff = (msg && typeof msg.gy === 'number') ? world().groundY - msg.gy : 0;
    var byId = {};
    var i, m;
    for (i = 0; i < Mutants.list.length; i++) byId[Mutants.list[i].id] = Mutants.list[i];
    var next = [];
    for (i = 0; i < arr.length; i++) {
      var s = arr[i];
      if (!s || !TYPES[s.type]) continue;
      m = byId[s.id];
      if (!m) {
        m = makeMutant(s.type, s.id, s.x, s.y + gyOff);
      }
      m.tx = s.x; m.ty = s.y + gyOff;
      m.vx = s.vx || 0; m.vy = s.vy || 0;
      m.facing = s.facing === -1 ? -1 : 1;
      m.hp = s.hp; m.maxHp = s.maxHp || m.maxHp;
      m.state = s.state || 'idle';
      m.stateTimer = s.stateTimer || 0;
      m.alive = true;
      next.push(m);
    }
    Mutants.list = next;
  }

  function onMutantHit(msg) {
    if (!isAuthority() || !msg) return;
    for (var i = 0; i < Mutants.list.length; i++) {
      var m = Mutants.list[i];
      if (m.id === msg.id && m.alive) {
        applyHit(m, +msg.dmg || 0, +msg.kx || 0, +msg.ky || 0, msg.src || null, msg.from != null ? String(msg.from) : 'guest');
        return;
      }
    }
  }

  function onMutantFx(msg) {
    if (isAuthority() || !msg || !fromHost(msg)) return;
    if (typeof msg.gy === 'number') msg.y += world().groundY - msg.gy;
    if (msg.kind === 'spawn') {
      particles(msg.x, msg.y, 18, TOXIC, 220);
      if (clock - lastGuestToast > 1.5) { lastGuestToast = clock; toast('돌연변이 출현!'); }
    } else if (msg.kind === 'die') {
      deathFx(msg.x, msg.y);
      for (var i = Mutants.list.length - 1; i >= 0; i--) {
        if (Mutants.list[i].id === msg.id) Mutants.list.splice(i, 1);
      }
      // 게스트가 막타를 쳤으면 게스트 쪽에서 처치 크레딧
      if (msg.killer != null && msg.killer === myNetId()) emitKill(msg.type, msg.src);
    }
  }

  function emitKill(type, src) {
    if (Game.events && Game.events.emit) {
      Game.events.emit('mutantKilled', { type: type, skill: src ? src.skill : null, castId: src ? src.castId : null });
    }
  }

  // 권한측 피해 적용. by: 'me'(이 클라이언트의 공격) | 게스트 net id(게스트가 보낸 mutantHit)
  function applyHit(m, dmg, kx, ky, src, by) {
    var cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    m.hitFlash = 0.15;
    m.hp -= dmg;
    var heavy = m.type === 'dog' ? 0.6 : 1;
    m.vx += kx * heavy;
    m.vy += ky * (m.type === 'crow' ? 0.5 : heavy);
    if (ky < 0 && m.type !== 'crow') m.onGround = false;
    particles(cx, cy, 6, TOXIC, 160);
    if (m.hp <= 0) {
      m.hp = 0;
      m.alive = false;
      deathFx(cx, cy);
      send({ t: 'mutantFx', kind: 'die', id: m.id, type: m.type, x: Math.round(cx), y: Math.round(cy), gy: world().groundY,
             killer: by === 'me' ? myNetId() : by, src: src || null });
      if (by === 'me') emitKill(m.type, src);
      return;
    }
    // 들개는 돌진 중엔 경직되지 않음 (슈퍼아머)
    if (!(m.type === 'dog' && m.state === 'attack') && !(m.stunT > 0)) setState(m, 'hurt', 0.28);
  }

  // 상태이상 (권한측). 반환: AI 를 건너뛰어야 하면 true
  function tickStatus(m, dt) {
    if (m.slowT > 0) m.slowT -= dt;
    if (m.rootT > 0) m.rootT -= dt;
    if (m.stunT > 0) m.stunT -= dt;
    if (!(m.stunT > 0) && !(m.rootT > 0)) return false;
    if (m.stunT > 0 && m.state !== 'hurt') setState(m, 'hurt', 0.1);
    if (m.type === 'crow') {
      m.vx *= Math.exp(-10 * dt); m.vy *= Math.exp(-10 * dt);
      m.x += m.vx * dt; m.y += m.vy * dt;
    } else {
      m.vx *= Math.exp(-12 * dt);
      groundPhysics(m, dt);
    }
    return true;
  }

  function deathFx(x, y) {
    particles(x, y, 26, TOXIC, 320);
    particles(x, y, 14, '#3f8f2a', 200);
    particles(x, y, 8, '#b5652b', 160);
    shake(4);
  }

  function registerHandlers() {
    if (handlersRegistered) return;
    var n = net();
    if (!n || typeof n.on !== 'function') return;
    handlersRegistered = true;
    n.on('mutants', applySnapshot);
    n.on('mutantHit', onMutantHit);
    n.on('mutantFx', onMutantFx);
  }

  function sendSnapshot() {
    var out = [];
    for (var i = 0; i < Mutants.list.length; i++) {
      var m = Mutants.list[i];
      if (!m.alive) continue;
      out.push({
        id: m.id, type: m.type,
        x: Math.round(m.x), y: Math.round(m.y),
        vx: Math.round(m.vx), vy: Math.round(m.vy),
        facing: m.facing, hp: m.hp, maxHp: m.maxHp,
        state: m.state, stateTimer: Math.round(m.stateTimer * 100) / 100
      });
    }
    send({ t: 'mutants', list: out, gy: world().groundY });
  }

  // ---------------------------------------------------------------- 공격 판정 (모든 클라이언트)
  function checkAttack(m) {
    if (m.state !== 'attack' || m.dmgCd > 0) return;
    var P = Game.players || {};
    var me = P.local;
    if (!me || !me.alive) return;
    if (me.invulnTimer > 0) return;
    if (!rectHit(m, me)) return;
    var T = TYPES[m.type];
    var dir = (me.x + me.w / 2) >= (m.x + m.w / 2) ? 1 : -1;
    m.dmgCd = DMG_INTERVAL;
    if (typeof Game.damagePlayer === 'function') Game.damagePlayer(T.dmg, dir * T.knockX, T.knockY);
    particles(me.x + me.w / 2, me.y + me.h / 2, 6, TOXIC, 160);
  }

  // ---------------------------------------------------------------- 공개 API
  var Mutants = {
    list: [],
    types: TYPES,

    init: function () {
      registerHandlers();
      Mutants.list = [];
      nextId = 1;
      spawnTimer = FIRST_SPAWN;
      matchTime = 0;
      snapTimer = 0;
    },

    update: function (dt) {
      if (!dt || dt <= 0) return;
      if (dt > 0.05) dt = 0.05;
      clock += dt;
      registerHandlers();
      if (Game.running === false) return;
      var auth = isAuthority();
      var i, m;

      if (auth) {
        matchTime += dt;
        if (!Game.matchOver) {
          spawnTimer -= dt;
          if (spawnTimer <= 0) {
            spawnTimer = rand(10, 14);
            spawnWave();
          }
        }
      }

      for (i = 0; i < Mutants.list.length; i++) {
        m = Mutants.list[i];
        if (!m.alive) continue;
        m.animT += dt * (1 + Math.min(Math.abs(m.vx), 600) / 60);
        if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
        if (m.dmgCd > 0) m.dmgCd -= dt;
        if (auth) {
          if (!tickStatus(m, dt)) {
            var adt = m.slowT > 0 ? dt * 0.45 : dt;
            if (m.type === 'crow') updateCrow(m, adt); else updateGround(m, adt);
          }
        } else {
          updateGuestMutant(m, dt);
        }
        checkAttack(m);
      }

      if (auth) {
        // 죽은 개체 제거
        var keep = [];
        for (i = 0; i < Mutants.list.length; i++) if (Mutants.list[i].alive) keep.push(Mutants.list[i]);
        Mutants.list = keep;
        if (isOnlineHost()) {
          snapTimer -= dt;
          if (snapTimer <= 0) { snapTimer = SNAP_INTERVAL; sendSnapshot(); }
        }
      }
    },

    // src = {skill, castId} (처치 크레딧/미션용, 선택)
    hit: function (m, dmg, kx, ky, src) {
      if (!m || !m.alive) return;
      kx = kx || 0; ky = ky || 0;
      if (!isAuthority()) {
        m.hitFlash = 0.15;
        send({ t: 'mutantHit', id: m.id, dmg: dmg, kx: kx, ky: ky, src: src || null }, 'h');   // 게스트 → 호스트만
        particles(m.x + m.w / 2, m.y + m.h / 2, 5, TOXIC, 140);
        return;
      }
      applyHit(m, dmg, kx, ky, src || null, 'me');
    },

    // 상태이상: 'slow' | 'root' | 'stun' (권한측에서만 적용)
    status: function (m, kind, secs) {
      if (!m || !m.alive || !isAuthority()) return;
      secs = +secs || 0;
      if (kind === 'slow') m.slowT = Math.max(m.slowT || 0, secs);
      else if (kind === 'root') m.rootT = Math.max(m.rootT || 0, secs);
      else if (kind === 'stun') m.stunT = Math.max(m.stunT || 0, secs);
    },

    isAuthority: isAuthority,

    // 즉시 1마리 소환 (권한측, 동시 최대 12). x 를 주면 그 위치에
    forceSpawn: function (type, x) {
      if (!isAuthority() || !TYPES[type] || aliveCount() >= 12) return null;
      var m = spawnOne(type);
      if (m && typeof x === 'number') {
        m.x = clamp(x, 0, world().width - m.w);
        m.tx = m.x;
      }
      return m;
    },

    render: function (ctx) {
      if (!ctx) return;
      for (var i = 0; i < Mutants.list.length; i++) {
        var m = Mutants.list[i];
        if (!m.alive) continue;
        ctx.save();
        try { drawMutant(ctx, m); } catch (e) { /* 렌더 오류가 루프를 멈추지 않게 */ }
        ctx.restore();
        drawHpBar(ctx, m);
      }
    },

    // 테스트/디버그용
    _debug: {
      spawnOne: function (type) { return spawnOne(type); },
      setMatchTime: function (t) { matchTime = t; },
      getSpawnTimer: function () { return spawnTimer; },
      applySnapshot: applySnapshot,
      onMutantHit: onMutantHit,
      onMutantFx: onMutantFx,
      isAuthority: isAuthority
    }
  };

  Game.Mutants = Mutants;
  registerHandlers();

  // ================================================================ 그래픽
  function glowEye(ctx, x, y, r, intensity) {
    ctx.save();
    ctx.shadowColor = TOXIC;
    ctx.shadowBlur = 6 + intensity * 18;
    ctx.fillStyle = intensity > 0.6 ? TOXIC_HOT : TOXIC;
    ctx.beginPath(); ctx.arc(x, y, r * (1 + intensity * 0.35), 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0d1a05';
    ctx.beginPath(); ctx.ellipse(x + r * 0.15, y, r * 0.25, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function eyeHalo(ctx, x, y, r) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(180,255,90,0.55)');
    g.addColorStop(1, 'rgba(120,255,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function moss(ctx, x, y, s, seed) {
    var cols = ['#3d6b2a', '#55892f', '#2c5220', '#6fa13a'];
    for (var i = 0; i < 5; i++) {
      var a = seed * 6.28 + i * 1.9;
      ctx.fillStyle = cols[i % 4];
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * s * 0.8, y + Math.sin(a) * s * 0.4, s * (0.45 + 0.1 * (i % 3)), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function rust(ctx, x, y, rx, ry) {
    ctx.fillStyle = 'rgba(176,92,38,0.75)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(122,58,22,0.7)';
    ctx.beginPath(); ctx.ellipse(x + rx * 0.3, y + ry * 0.2, rx * 0.5, ry * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  }

  function tumor(ctx, x, y, r) {
    var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#d98aa0');
    g.addColorStop(0.6, '#9a4d6a');
    g.addColorStop(1, '#5a2a40');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(141,255,60,0.5)';
    ctx.beginPath(); ctx.arc(x + r * 0.3, y - r * 0.1, r * 0.22, 0, Math.PI * 2); ctx.fill();
  }

  function leg(ctx, x, y, len, phase, width, color) {
    var swing = Math.sin(phase) * 0.55;
    var kx = x + Math.sin(swing) * len * 0.5;
    var ky = y + Math.cos(swing) * len * 0.5;
    var fx = kx + Math.sin(swing * 0.4 - 0.2) * len * 0.5;
    var fy = ky + Math.max(0, Math.cos(swing * 0.4) * len * 0.5 - Math.max(0, Math.cos(phase)) * len * 0.15);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
  }

  function drawMutant(ctx, m) {
    var cx = m.x + m.w / 2;
    var base = m.y + m.h;
    var wind = m.state === 'windup';
    var intensity = wind ? 0.7 + 0.3 * Math.sin(clock * 40) : (m.state === 'attack' ? 0.6 : 0.15);
    var sx = 0, sy = 0;
    if (wind) { sx = Math.sin(clock * 90 + m.id) * 2.2; sy = Math.cos(clock * 77 + m.id) * 1.2; }

    // 바닥 그림자
    if (m.type !== 'crow') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(cx, base, m.w * 0.5, 4, 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.translate(cx + sx, base + sy);
    ctx.scale(m.facing, 1);

    if (m.type === 'rat') drawRat(ctx, m, wind, intensity);
    else if (m.type === 'dog') drawDog(ctx, m, wind, intensity);
    else drawCrow(ctx, m, wind, intensity);

    if (m.hitFlash > 0) {
      // 흰색 플래시: 같은 실루엣 위에 밝게 덧칠
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, m.hitFlash / 0.15);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, -m.h * 0.5, m.w * 0.55, m.h * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ---- 변이 쥐 (원점: 발밑 중앙, +x = 앞)
  function drawRat(ctx, m, wind, intensity) {
    var t = m.animT * 2.2;
    var bob = Math.abs(Math.sin(t)) * 2;
    var crouch = wind ? 4 : 0;
    var by = -14 + crouch - bob;

    // 꼬리 (털 없는 분홍, 흔들림)
    ctx.strokeStyle = '#b77a7a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-16, by + 2);
    ctx.bezierCurveTo(-28, by - 6 + Math.sin(clock * 6 + m.id) * 6, -36, by + 8, -44, by - 2 + Math.sin(clock * 5) * 5);
    ctx.stroke();
    ctx.strokeStyle = '#7a4a4a'; ctx.lineWidth = 1;
    for (var s = 0; s < 4; s++) { ctx.beginPath(); ctx.moveTo(-22 - s * 5, by - 1); ctx.lineTo(-22 - s * 5, by + 4); ctx.stroke(); }

    // 다리 (4)
    var lc = '#3b302b';
    leg(ctx, -10, by + 6, 10 - crouch * 0.5, t + Math.PI, 3, lc);
    leg(ctx, 10, by + 6, 10 - crouch * 0.5, t, 3, lc);
    // 몸통
    var g = ctx.createRadialGradient(0, by - 4, 2, 0, by, 22);
    g.addColorStop(0, '#6b5d52'); g.addColorStop(1, '#2e2621');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, by, 19, 11, 0, 0, Math.PI * 2); ctx.fill();
    // 털 결 (삐죽)
    ctx.strokeStyle = '#1f1916'; ctx.lineWidth = 1.2;
    for (var f = -14; f <= 10; f += 4) {
      ctx.beginPath(); ctx.moveTo(f, by - 9); ctx.lineTo(f - 3, by - 13 - (f % 8 === 0 ? 2 : 0)); ctx.stroke();
    }
    rust(ctx, -6, by + 2, 6, 4);
    moss(ctx, -10, by - 8, 3.2, m.seed);
    // 비대칭 혹
    tumor(ctx, 4 + m.seed * 4, by - 10, 5 + m.seed * 2);
    // 앞다리
    leg(ctx, -6, by + 6, 10 - crouch * 0.5, t + Math.PI * 0.5, 3, '#4a3d36');
    leg(ctx, 14, by + 5, 10 - crouch * 0.5, t + Math.PI * 1.5, 3, '#4a3d36');

    // 머리
    var hx = 18, hy = by - 2;
    ctx.fillStyle = '#4c4038';
    ctx.beginPath(); ctx.moveTo(hx - 6, hy - 8); ctx.lineTo(hx + 12, hy + 1); ctx.lineTo(hx - 6, hy + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d58a96';
    ctx.beginPath(); ctx.arc(hx + 12, hy + 1, 2, 0, Math.PI * 2); ctx.fill();
    // 귀 (하나는 찢어짐)
    ctx.fillStyle = '#8a5a5a';
    ctx.beginPath(); ctx.ellipse(hx - 5, hy - 9, 4, 5, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx - 1, hy - 7); ctx.lineTo(hx + 2, hy - 13); ctx.lineTo(hx + 4, hy - 7); ctx.fill();
    // 이빨
    ctx.fillStyle = '#e8dcb0';
    ctx.fillRect(hx + 6, hy + 3, 2, 4); ctx.fillRect(hx + 9, hy + 2, 2, 4);
    // 수염
    ctx.strokeStyle = 'rgba(220,220,200,0.5)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(hx + 10, hy); ctx.lineTo(hx + 20, hy - 4); ctx.moveTo(hx + 10, hy + 1); ctx.lineTo(hx + 20, hy + 3); ctx.stroke();
    // 눈 3개 (큰 하나 + 작은 둘)
    if (wind) eyeHalo(ctx, hx + 1, hy - 3, 16);
    glowEye(ctx, hx + 1, hy - 3, 2.8, intensity);
    glowEye(ctx, hx - 4, hy - 1, 1.6, intensity);
    glowEye(ctx, hx + 4, hy + 2, 1.3, intensity);
  }

  // ---- 변이 들개
  function drawDog(ctx, m, wind, intensity) {
    var t = m.animT * 1.6;
    var run = m.state === 'attack';
    var crouch = wind ? 9 : 0;
    var bob = run ? Math.sin(t * 2) * 3 : Math.abs(Math.sin(t)) * 2;
    var by = -26 + crouch - bob;
    var legLen = 22 - crouch * 0.8;
    var phaseMul = run ? 1.6 : 1;

    // 뒷다리 (먼 쪽)
    leg(ctx, -18, by + 6, legLen, t * phaseMul + Math.PI, 5, '#2e2520');
    leg(ctx, 16, by + 6, legLen, t * phaseMul, 5, '#2e2520');

    // 꼬리 (뭉툭, 뼈 노출)
    ctx.strokeStyle = '#4a3a30'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-26, by - 4); ctx.quadraticCurveTo(-36, by - 14 + Math.sin(clock * 8) * 3, -40, by - 8); ctx.stroke();
    ctx.fillStyle = '#d8ccb0'; ctx.beginPath(); ctx.arc(-40, by - 8, 2.5, 0, Math.PI * 2); ctx.fill();

    // 몸통 (앙상하게 마른 몸)
    var g = ctx.createLinearGradient(0, by - 14, 0, by + 12);
    g.addColorStop(0, '#5e4a3a'); g.addColorStop(1, '#2a201a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-28, by - 4);
    ctx.quadraticCurveTo(-20, by - 16, 4, by - 14);
    ctx.quadraticCurveTo(22, by - 16, 26, by - 6);
    ctx.quadraticCurveTo(24, by + 10, 10, by + 8);
    ctx.quadraticCurveTo(-4, by + 4, -14, by + 10);
    ctx.quadraticCurveTo(-28, by + 8, -28, by - 4);
    ctx.fill();
    // 갈비뼈
    ctx.strokeStyle = 'rgba(210,190,160,0.45)'; ctx.lineWidth = 1.4;
    for (var r = 0; r < 4; r++) {
      ctx.beginPath(); ctx.arc(-2 + r * 6, by - 2, 7, 0.4, 1.9); ctx.stroke();
    }
    // 녹 / 탈모 / 이끼
    rust(ctx, -16, by - 2, 7, 5);
    rust(ctx, 14, by + 2, 4, 3);
    ctx.fillStyle = '#8a5f5a';
    ctx.beginPath(); ctx.ellipse(-4, by + 3, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    moss(ctx, -14, by - 12, 4.2, m.seed);
    moss(ctx, 8, by - 13, 3, m.seed + 0.37);
    // 척추 가시 (뼈)
    ctx.fillStyle = '#d6c9a8';
    for (var k = 0; k < 5; k++) {
      var px = -20 + k * 8, py = by - 13 - (k === 2 ? 2 : 0);
      ctx.beginPath(); ctx.moveTo(px - 2, py + 2); ctx.lineTo(px + 1, py - 6 - (k % 2) * 3); ctx.lineTo(px + 3, py + 2); ctx.fill();
    }
    // 어깨 혹 (비대칭)
    tumor(ctx, 14 + m.seed * 3, by - 14, 7 + m.seed * 3);
    tumor(ctx, -22, by + 4, 3.5);

    // 앞다리 (가까운 쪽)
    leg(ctx, -12, by + 6, legLen, t * phaseMul + Math.PI * 0.5, 5, '#46382e');
    leg(ctx, 20, by + 5, legLen, t * phaseMul + Math.PI * 1.5, 5, '#46382e');

    // 머리
    var hx = 30, hy = by - 8 + (wind ? 5 : 0);
    ctx.fillStyle = '#4a3a2e';
    ctx.beginPath(); ctx.ellipse(hx, hy, 11, 9, 0.15, 0, Math.PI * 2); ctx.fill();
    // 주둥이 + 벌어진 턱
    var jaw = run ? 0.55 : (wind ? 0.35 : 0.15 + Math.sin(clock * 4) * 0.05);
    ctx.fillStyle = '#3a2c22';
    ctx.beginPath(); ctx.moveTo(hx + 4, hy - 5); ctx.lineTo(hx + 22, hy - 1); ctx.lineTo(hx + 20, hy + 3); ctx.lineTo(hx + 4, hy + 3); ctx.fill();
    ctx.save();
    ctx.translate(hx + 4, hy + 3); ctx.rotate(jaw);
    ctx.fillStyle = '#33261d';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(16, 0); ctx.lineTo(14, 5); ctx.lineTo(0, 5); ctx.fill();
    ctx.fillStyle = '#e6dcb8';
    for (var tt = 0; tt < 4; tt++) { ctx.beginPath(); ctx.moveTo(3 + tt * 3.5, 0); ctx.lineTo(4.5 + tt * 3.5, -3); ctx.lineTo(6 + tt * 3.5, 0); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = '#e6dcb8';
    for (var u = 0; u < 4; u++) { ctx.beginPath(); ctx.moveTo(hx + 7 + u * 3.5, hy + 3); ctx.lineTo(hx + 8.5 + u * 3.5, hy + 6); ctx.lineTo(hx + 10 + u * 3.5, hy + 3); ctx.fill(); }
    // 독성 침
    if (wind || run) {
      ctx.fillStyle = 'rgba(141,255,60,0.8)';
      var dl = 4 + Math.abs(Math.sin(clock * 5)) * 6;
      ctx.fillRect(hx + 14, hy + 6, 1.6, dl);
    }
    // 귀 (찢어진)
    ctx.fillStyle = '#3a2c22';
    ctx.beginPath(); ctx.moveTo(hx - 8, hy - 4); ctx.lineTo(hx - 12, hy - 16); ctx.lineTo(hx - 2, hy - 8); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx - 2, hy - 7); ctx.lineTo(hx + 1, hy - 15); ctx.lineTo(hx + 3, hy - 11); ctx.lineTo(hx + 4, hy - 6); ctx.fill();
    // 눈 4개 (비대칭 배치)
    if (wind) eyeHalo(ctx, hx + 4, hy - 3, 22);
    glowEye(ctx, hx + 5, hy - 3, 2.8, intensity);
    glowEye(ctx, hx - 1, hy - 4, 2.2, intensity);
    glowEye(ctx, hx + 2, hy + 1, 1.5, intensity);
    glowEye(ctx, hx - 5, hy, 1.2, intensity);

    // 돌진 잔상
    if (run) {
      ctx.strokeStyle = 'rgba(141,255,60,0.25)'; ctx.lineWidth = 2;
      for (var q = 0; q < 3; q++) {
        ctx.beginPath(); ctx.moveTo(-34 - q * 8, by - 8 + q * 7); ctx.lineTo(-54 - q * 10, by - 8 + q * 7); ctx.stroke();
      }
    }
  }

  // ---- 변이 까마귀 (원점: 몸 아래 중앙)
  function drawCrow(ctx, m, wind, intensity) {
    var by = -15;
    var diving = m.state === 'attack';
    var flapSpeed = wind ? 4 : (m.state === 'recover' ? 22 : 14);
    var flap = Math.sin(clock * flapSpeed + m.id * 1.7);

    ctx.save();
    if (diving) {
      var ang = Math.atan2(m.vy, Math.abs(m.vx) + 1);
      ctx.translate(0, by); ctx.rotate(ang * 0.8); ctx.translate(0, -by);
    }

    // 먼 쪽 날개
    drawWing(ctx, -2, by - 4, diving ? -0.2 : flap, '#121a1c', diving, m.seed, false);

    // 꼬리 깃
    ctx.fillStyle = '#141c1f';
    ctx.beginPath(); ctx.moveTo(-14, by); ctx.lineTo(-28, by - 6); ctx.lineTo(-30, by + 1); ctx.lineTo(-27, by + 6); ctx.closePath(); ctx.fill();

    // 몸통
    var g = ctx.createRadialGradient(2, by - 4, 2, 0, by, 18);
    g.addColorStop(0, '#2f3d42'); g.addColorStop(1, '#0d1416');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, by, 16, 10, 0, 0, Math.PI * 2); ctx.fill();
    // 헝클어진 깃털
    ctx.strokeStyle = '#05090a'; ctx.lineWidth = 1.2;
    for (var f = -10; f <= 8; f += 4) { ctx.beginPath(); ctx.moveTo(f, by + 8); ctx.lineTo(f - 2, by + 13); ctx.stroke(); }
    rust(ctx, -4, by + 3, 5, 3);
    // 목 혹
    tumor(ctx, 9, by - 9, 4 + m.seed * 2);
    // 발 (늘어진 발톱)
    ctx.strokeStyle = '#a0753a'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-2, by + 9); ctx.lineTo(-4, by + 15); ctx.moveTo(3, by + 9); ctx.lineTo(2, by + 15);
    if (diving) { ctx.moveTo(-4, by + 15); ctx.lineTo(0, by + 17); ctx.moveTo(2, by + 15); ctx.lineTo(6, by + 17); }
    ctx.stroke();

    // 머리
    var hx = 15, hy = by - 6;
    ctx.fillStyle = '#182226';
    ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.fill();
    // 녹슨 부리
    ctx.fillStyle = '#9a5a2a';
    ctx.beginPath(); ctx.moveTo(hx + 4, hy - 3); ctx.lineTo(hx + 17, hy + 1); ctx.lineTo(hx + 4, hy + 3); ctx.fill();
    ctx.fillStyle = '#6a3a1a';
    ctx.beginPath(); ctx.moveTo(hx + 8, hy); ctx.lineTo(hx + 13, hy + 1); ctx.lineTo(hx + 8, hy + 2); ctx.fill();
    // 눈 3개
    if (wind) eyeHalo(ctx, hx + 1, hy - 1, 18);
    glowEye(ctx, hx + 2, hy - 2, 2.2, intensity);
    glowEye(ctx, hx - 3, hy - 3, 1.5, intensity);
    glowEye(ctx, hx - 1, hy + 2, 1.3, intensity);

    // 가까운 쪽 날개
    drawWing(ctx, 0, by - 3, diving ? -0.3 : flap * 0.9, '#1b2629', diving, m.seed + 0.5, true);
    ctx.restore();
  }

  function drawWing(ctx, x, y, flap, color, folded, seed, mossy) {
    ctx.save();
    ctx.translate(x, y);
    var lift = folded ? 0.15 : flap * 0.9;
    ctx.rotate(-lift);
    ctx.fillStyle = color;
    var span = folded ? 18 : 30;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.quadraticCurveTo(-span * 0.4, -span * 0.9, -span, -span * 0.5 * (folded ? 0.3 : 1));
    // 너덜너덜한 깃털 끝
    for (var i = 0; i < 4; i++) {
      var tx = -span + i * (span / 4);
      ctx.lineTo(tx + 2, -span * 0.25 + (i % 2) * 5);
      ctx.lineTo(tx + span / 4, -span * 0.35 + (i % 2) * 3);
    }
    ctx.lineTo(8, 0);
    ctx.closePath();
    ctx.fill();
    // 깃 뼈대 노출
    ctx.strokeStyle = 'rgba(200,190,170,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-span * 0.8, -span * 0.45 * (folded ? 0.3 : 1)); ctx.stroke();
    if (mossy) moss(ctx, -span * 0.35, -span * 0.25, 2.6, seed);
    ctx.restore();
  }

  function drawHpBar(ctx, m) {
    var w = Math.max(30, m.w * 0.8), h = 4;
    var x = m.x + m.w / 2 - w / 2;
    var y = m.y - 12;
    var r = clamp(m.hp / (m.maxHp || 1), 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#3a1410';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = r > 0.5 ? '#8dff3c' : (r > 0.25 ? '#e0c030' : '#ff5030');
    ctx.fillRect(x, y, w * r, h);
    ctx.restore();
  }
})();
