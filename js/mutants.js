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
    crow: { w: 44, h: 30, speed: 260, hp: 25, dmg: 10, knockX: 340, knockY: -260, flying: true },
    // 보스 '녹슨 거수' — 개(64×42)의 약 5배 덩치. hp 는 스폰 시 참가자 수로 다시 계산
    boss: { w: 236, h: 164, speed: 120, hp: 850, dmg: 8, knockX: 520, knockY: -300, flying: false, boss: true }
  };

  // ---------------------------------------------------------------- 보스 수치
  var BOSS = {
    name: '녹슨 거수',
    firstAt: 90,          // 경기 시작 후 첫 출현 (초)
    respawn: 180,         // 처치 후 다음 출현까지
    warn: 3,              // 출현 경고 시간
    hpBase: 600, hpPer: 250,   // hp = 600 + 250 × 참가자(플레이어 + 봇)
    walk: 120, walkEnr: 170,
    enrMul: 0.7,          // 격노 시 예고/쿨다운 시간 배율
    cool: 1.5,            // 패턴 사이 간격
    contactDmg: 8, contactCd: 1.0,
    chargeWind: 1.0, chargeSpd: 920, chargeSpdEnr: 1180, chargeTime: 1.5, chargeDmg: 22, chargeKx: 950, chargeKy: -560,
    slamWind: 1.05, slamDmg: 20, slamZoneW: 320, slamZoneH: 140,
    waveDmg: 16, waveSpd: 720, waveSpdEnr: 900, waveRange: 1000, waveH: 44,
    spitWind: 0.8, globs: 3, globsEnr: 5, globDmg: 12, globR: 13, globT: 0.9,
    puddleDmg: 5, puddleTick: 0.5, puddleLife: 3, puddleW: 120,
    summonWind: 1.1, rats: 2, ratsEnr: 3, summonCd: 16,
    leapWind: 0.7, leapT: 0.85, leapDmg: 24,
    landDmg: 18, enrageTime: 1.4, roarTime: 1.6,
    resist: 0.5           // 상태이상 지속시간 배율
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
  // 보스
  var bossTimer = BOSS.firstAt;   // 권한측: 다음 보스 출현까지 (보스 생존 중엔 멈춤)
  var bossWarned = false;
  var bossLandX = 0;
  var bossFx = [];                // 모든 클라이언트: 충격파/독침/웅덩이/표식/잔해 (로컬 시뮬레이션)
  var warnT = 0;                  // 모든 클라이언트: 경고 연출 남은 시간

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
    var m = makeBase(type, id, x, y, T);
    if (T.boss) {
      m.boss = true;
      m.name = BOSS.name;
      m.enraged = false;
      m.cool = 1.0;          // 다음 패턴까지
      m.lastPat = null;
      m.summonCd = 8;
      m.stateDur = 0;
      m.aux = 0;             // 도약 착지 x 등
      m.botCd = {};          // 봇별 접촉 피해 간격 (권한측)
      m.killer = null;       // 마지막 타격자 net id
      m.slam2 = false;
      m.lagHp = m.hp;
    }
    return m;
  }

  function makeBase(type, id, x, y, T) {
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
    for (var i = 0; i < Mutants.list.length; i++) if (Mutants.list[i].alive && !Mutants.list[i].boss) c++;
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
      if (m.boss) {
        if (!m.enraged && s.enr) m.lagHp = m.hp;
        m.enraged = !!s.enr;
        m.stateDur = +s.sd || 0;
        m.aux = +s.aux || 0;
        m.name = BOSS.name;
      }
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
    if (m.boss) { bossApplyHit(m, dmg, kx, ky, src, by); return; }
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
    if (m.boss) {
      // 보스: 패턴은 유지한 채 잠시 멈춤 (공중 도약/낙하 중엔 무시)
      if (m.state === 'leap' || m.state === 'intro') return false;
      m.vx *= Math.exp(-12 * dt);
      bossPhysics(m, dt);
      return true;
    }
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
    n.on('bossFx', onBossFxMsg);
  }

  function sendSnapshot() {
    var out = [];
    for (var i = 0; i < Mutants.list.length; i++) {
      var m = Mutants.list[i];
      if (!m.alive) continue;
      var s = {
        id: m.id, type: m.type,
        x: Math.round(m.x), y: Math.round(m.y),
        vx: Math.round(m.vx), vy: Math.round(m.vy),
        facing: m.facing, hp: Math.round(m.hp * 10) / 10, maxHp: m.maxHp,
        state: m.state, stateTimer: Math.round(m.stateTimer * 100) / 100
      };
      if (m.boss) {
        s.enr = m.enraged ? 1 : 0;
        s.sd = Math.round(m.stateDur * 100) / 100;
        s.aux = Math.round(m.aux);
      }
      out.push(s);
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

  // ================================================================ 보스 '녹슨 거수'
  // 권한측(연습/호스트)이 AI·스폰·사망을 결정하고 mutants 스냅샷(+보스 전용 필드)으로 동기화.
  // 충격파/독침/웅덩이/착지 충격은 'bossFx' 이벤트로 알리고 각 클라이언트가 같은 규칙으로 시뮬레이션,
  // 로컬 플레이어 피해는 각자 판정, 봇 피해는 권한측에서 G.Bots.damage 로.

  function findBoss() {
    for (var i = 0; i < Mutants.list.length; i++) {
      var m = Mutants.list[i];
      if (m.boss && m.alive) return m;
    }
    return null;
  }
  function gy() { return world().groundY; }
  function bossMul(m) { return m.enraged ? BOSS.enrMul : 1; }
  function bcx(m) { return m.x + m.w / 2; }

  function combatants() {
    var P = Game.players || {};
    var n = 0;
    if (typeof P.all === 'function') { try { n = P.all().length; } catch (e) { n = 0; } }
    if (!n) n = 1 + (typeof P.list === 'function' ? P.list().length : 0);
    // 봇이 아직 others 에 없을 수 있으므로 G.Bots.count() 와 비교해 큰 값
    var n2 = 1;
    var N = net();
    if (N && N.peers && N.peers.length && Game.mode !== 'practice') n2 = N.peers.length;
    if (Game.Bots && typeof Game.Bots.count === 'function') { try { n2 += +Game.Bots.count() || 0; } catch (e2) { /* 무시 */ } }
    return Math.max(1, n, n2);
  }

  function botList() {
    var B = Game.Bots;
    var out = [];
    if (!B || typeof B.damage !== 'function') return out;
    var src = null;
    if (typeof B.list === 'function') { try { src = B.list(); } catch (e) { src = null; } }
    if (!src) {
      var P = Game.players || {};
      src = typeof P.list === 'function' ? P.list() : [];
    }
    for (var i = 0; i < src.length; i++) {
      var b = src[i];
      if (b && b.isBot && b.alive !== false) out.push(b);
    }
    return out;
  }

  // 피해 대상 순회: 로컬 플레이어(모든 클라이언트) + 봇(권한측). fn(p, key, isLocal)
  function forVictims(fn) {
    var P = Game.players || {};
    var me = P.local;
    if (me && me.alive) fn(me, 'me', true);
    if (isAuthority()) {
      var bl = botList();
      for (var i = 0; i < bl.length; i++) fn(bl[i], 'b:' + bl[i].id, false);
    }
  }

  function hurt(p, isLocal, dmg, kx, ky) {
    if (isLocal) {
      if (p.invulnTimer > 0) return false;
      if (typeof Game.damagePlayer === 'function') return Game.damagePlayer(dmg, kx, ky) !== false;
      return false;
    }
    if (Game.Bots && typeof Game.Bots.damage === 'function') {
      try { Game.Bots.damage(p, dmg, kx, ky, null); } catch (e) { return false; }
      return true;
    }
    return false;
  }

  // ---- fx 발신: 로컬에 적용 + 게스트에게 전송 (y 는 땅 기준 높이 dy 로)
  function bossEmit(msg) {
    msg.t = 'bossFx';
    handleBossFx(msg, true);
    send(msg);
  }
  function onBossFxMsg(msg) {
    if (isAuthority() || !msg || !fromHost(msg)) return;
    handleBossFx(msg, false);
  }

  function handleBossFx(msg, local) {
    var G0 = gy();
    var k = msg.kind;
    var i;
    if (k === 'warn') {
      warnT = BOSS.warn;
      bossFx.push({ kind: 'marker', x: +msg.x || 0, life: BOSS.warn + 1.4, t: 0 });
      toast('⚠ 보스 출현! — ' + BOSS.name);
      shake(8);
    } else if (k === 'land') {
      shake(26);
      particles(msg.x, G0 - 10, 40, '#c9b48a', 420);
      particles(msg.x, G0 - 30, 24, TOXIC, 300);
      bossFx.push({ kind: 'crack', x: +msg.x, w: 380, life: 2.2, t: 0 });
      impactZone(msg.x - 190, 220, BOSS.landDmg, 760, -560, msg.x);
      for (i = bossFx.length - 1; i >= 0; i--) if (bossFx[i].kind === 'marker') bossFx.splice(i, 1);
    } else if (k === 'impact') {
      shake(msg.big ? 22 : 16);
      particles(msg.x, G0 - 8, 30, '#c9b48a', 380);
      particles(msg.x, G0 - 20, 16, TOXIC, 260);
      bossFx.push({ kind: 'crack', x: +msg.x, w: +msg.w || 300, life: 1.8, t: 0 });
      impactZone(msg.x - (+msg.w || 300) / 2, +msg.h || BOSS.slamZoneH, +msg.dmg || BOSS.slamDmg, 700, -620, msg.x);
      var spd = msg.enr ? BOSS.waveSpdEnr : BOSS.waveSpd;
      bossFx.push({ kind: 'wave', x0: +msg.x, dir: 1, r: (+msg.w || 300) / 2 - 20, spd: spd, t: 0, hit: {} });
      bossFx.push({ kind: 'wave', x0: +msg.x, dir: -1, r: (+msg.w || 300) / 2 - 20, spd: spd, t: 0, hit: {} });
    } else if (k === 'globs') {
      var list = msg.list || [];
      for (i = 0; i < list.length; i++) {
        var g = list[i];
        bossFx.push({ kind: 'glob', delay: +msg.delay || 0, x: +g[0], y: G0 - (+g[1]), vx: +g[2], vy: +g[3],
                      ax: +g[4], ay: G0 - (+g[5]), t: 0, hit: {}, enr: !!msg.enr, trail: [] });
      }
    } else if (k === 'roar') {
      shake(10);
      bossFx.push({ kind: 'roar', x: +msg.x, y: G0 - (+msg.dy || 150), dir: msg.dir === -1 ? -1 : 1, life: 1.1, t: 0 });
    } else if (k === 'enrage') {
      shake(18);
      toast(BOSS.name + '이(가) 격노했다!');
      bossFx.push({ kind: 'roar', x: +msg.x, y: G0 - (+msg.dy || 150), dir: msg.dir === -1 ? -1 : 1, life: 1.4, t: 0, red: true });
      particles(msg.x, G0 - 100, 40, '#ff5a2a', 360);
    } else if (k === 'die') {
      var bx = +msg.x, by = G0 - (+msg.dy || 80);
      if (!local) {
        for (i = Mutants.list.length - 1; i >= 0; i--) if (Mutants.list[i].boss) Mutants.list.splice(i, 1);
      }
      bossFx.push({ kind: 'corpse', x: bx, facing: msg.facing === -1 ? -1 : 1, enr: !!msg.enr, life: 2.4, t: 0 });
      particles(bx, by, 60, TOXIC, 480);
      particles(bx, by, 30, '#b5541c', 360);
      particles(bx, by, 24, '#3f8f2a', 300);
      shake(30);
      var nm = msg.name || '누군가';
      toast(nm + ' 님이 보스를 처치했다!');
      if (!local && msg.killer != null && msg.killer === myNetId()) emitKill('boss', msg.src || null);
      warnT = 0;
    }
  }

  // 땅에서 높이 h 까지의 직사각형 충격 범위 (x0 = 왼쪽, 폭 = |2*(cx-x0)|)
  function impactZone(x0, h, dmg, kx, ky, cx) {
    var w = (cx - x0) * 2;
    var zone = { x: x0, y: gy() - h, w: w, h: h };
    forVictims(function (p, key, isLocal) {
      if (!rectHit(zone, p)) return;
      var d = (p.x + p.w / 2) >= cx ? 1 : -1;
      hurt(p, isLocal, dmg, d * kx, ky);
    });
  }

  // ---- 스폰 일정 (권한측)
  function bossSchedule(dt) {
    if (findBoss()) return;
    bossTimer -= dt;
    if (!bossWarned && bossTimer <= BOSS.warn) {
      bossWarned = true;
      bossLandX = pickLandX();
      bossEmit({ kind: 'warn', x: Math.round(bossLandX) });
    }
    if (bossTimer <= 0) {
      spawnBoss(bossLandX, false);
    }
  }

  function pickLandX() {
    var W = world();
    var c = candidatePlayers();
    var half = TYPES.boss.w / 2;
    var x = W.width / 2;
    if (c.length) {
      var s = 0;
      for (var i = 0; i < c.length; i++) s += c[i].x + c[i].w / 2;
      x = s / c.length + rand(-160, 160);
    }
    return clamp(x, half + 60, W.width - half - 60);
  }

  function spawnBoss(x, instant) {
    if (!isAuthority()) return null;
    var old = findBoss();
    if (old) return old;
    var W = world();
    var T = TYPES.boss;
    if (x == null) x = pickLandX();
    if (instant) {
      bossEmit({ kind: 'warn', x: Math.round(x) });
      warnT = 0;
    }
    var m = makeMutant('boss', nextId++, clamp(x - T.w / 2, 0, W.width - T.w), W.groundY - T.h - 1050);
    var hp = BOSS.hpBase + BOSS.hpPer * combatants();
    m.hp = m.maxHp = m.lagHp = hp;
    m.vy = 200;
    m.facing = Math.random() < 0.5 ? -1 : 1;
    setBossState(m, 'intro', 3);
    Mutants.list.push(m);
    bossTimer = BOSS.respawn;
    bossWarned = false;
    return m;
  }

  function setBossState(m, s, dur) {
    m.state = s;
    m.stateTimer = dur || 0;
    m.stateDur = dur || 0;
  }

  // ---- 물리: 땅만 밟음 (발판은 통과 — 덩치가 커서 발판 위로 못 올라감)
  function bossPhysics(m, dt) {
    var W = world();
    var airborne = m.state === 'leap' || m.state === 'intro';
    // 외부 힘(염력 등)으로 들어 올려지지 않게: 거대한 몸무게
    if (!airborne && m.vy < -150) m.vy = -150;
    m.vy += gravity() * dt;
    if (m.vy > 2200) m.vy = 2200;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.onGround = false;
    if (m.y + m.h >= W.groundY) { m.y = W.groundY - m.h; m.vy = 0; m.onGround = true; }
    m.hitWall = 0;
    if (m.x < 0) { m.x = 0; m.hitWall = -1; if (m.vx < 0) m.vx = 0; }
    if (m.x + m.w > W.width) { m.x = W.width - m.w; m.hitWall = 1; if (m.vx > 0) m.vx = 0; }
  }

  function countRats() {
    var c = 0;
    for (var i = 0; i < Mutants.list.length; i++) if (Mutants.list[i].alive && Mutants.list[i].type === 'rat') c++;
    return c;
  }

  function choosePattern(m, tgt) {
    var dist = tgt ? Math.abs((tgt.x + tgt.w / 2) - bcx(m)) : 600;
    var opts = [
      ['charge', dist > 380 ? 3 : 1],
      ['slam', dist < 420 ? 3.2 : 1.1],
      ['spit', dist > 300 ? 2.6 : 1],
      ['summon', (m.summonCd <= 0 && countRats() < 5 && aliveCount() < MAX_ALIVE + 2) ? 1.3 : 0]
    ];
    if (m.enraged) opts.push(['leap', dist > 300 ? 2.6 : 0.9]);
    var total = 0, i;
    for (i = 0; i < opts.length; i++) {
      if (opts[i][0] === m.lastPat) opts[i][1] *= 0.2;
      total += opts[i][1];
    }
    var r = Math.random() * total;
    for (i = 0; i < opts.length; i++) {
      r -= opts[i][1];
      if (r <= 0) return opts[i][0];
    }
    return 'slam';
  }

  function mouthPos(m) {
    // 입 위치 (머리 앞쪽) — drawBoss 의 머리 위치와 대략 일치
    return { x: bcx(m) + m.facing * (m.w * 0.5 + 40), y: m.y + m.h * 0.42 };
  }

  function startPattern(m, p, tgt) {
    var mul = bossMul(m);
    m.lastPat = p;
    if (tgt) m.facing = (tgt.x + tgt.w / 2) >= bcx(m) ? 1 : -1;
    m.vx = 0;
    if (p === 'charge') {
      setBossState(m, 'charge_wind', BOSS.chargeWind * mul);
    } else if (p === 'slam') {
      m.slam2 = false;
      setBossState(m, 'slam_wind', BOSS.slamWind * mul);
    } else if (p === 'spit') {
      var dur = BOSS.spitWind * mul;
      setBossState(m, 'spit_wind', dur);
      fireGlobs(m, tgt, dur);
    } else if (p === 'summon') {
      setBossState(m, 'summon', BOSS.summonWind * mul);
      m.summonCd = BOSS.summonCd;
      var mp = mouthPos(m);
      bossEmit({ kind: 'roar', x: Math.round(mp.x), dy: Math.round(gy() - mp.y), dir: m.facing });
    } else if (p === 'leap') {
      var tx = tgt ? tgt.x + tgt.w / 2 : bcx(m) + m.facing * 500;
      m.aux = clamp(tx, m.w / 2, world().width - m.w / 2);
      setBossState(m, 'leap_wind', BOSS.leapWind * mul);
    }
  }

  // 독침: 예고 시간 뒤 발사되도록 지연값과 함께 한 번에 전송 → 모든 클라이언트가 같은 궤적
  function fireGlobs(m, tgt, delay) {
    var mp = mouthPos(m);
    var G0 = gy();
    var n = m.enraged ? BOSS.globsEnr : BOSS.globs;
    var baseX = tgt ? tgt.x + tgt.w / 2 : mp.x + m.facing * 500;
    var g = gravity() * 0.42;
    var list = [];
    for (var i = 0; i < n; i++) {
      var off = (i - (n - 1) / 2) * 150 + rand(-25, 25);
      var ax = clamp(baseX + off, 20, world().width - 20);
      var T = BOSS.globT * (0.85 + 0.3 * Math.random());
      var ay = G0;
      var vx = (ax - mp.x) / T;
      var vy = ((ay - mp.y) - 0.5 * g * T * T) / T;
      list.push([Math.round(mp.x), Math.round(G0 - mp.y), Math.round(vx), Math.round(vy), Math.round(ax), 0]);
    }
    bossEmit({ kind: 'globs', list: list, delay: Math.round(delay * 100) / 100, enr: m.enraged ? 1 : 0 });
  }

  function slamImpact(m, big) {
    var x = bcx(m) + m.facing * (big ? 0 : 70);
    bossEmit({ kind: 'impact', x: Math.round(x), w: big ? 380 : BOSS.slamZoneW, h: BOSS.slamZoneH,
               dmg: big ? BOSS.leapDmg : BOSS.slamDmg, enr: m.enraged ? 1 : 0, big: big ? 1 : 0 });
  }

  function summonRats(m) {
    var n = m.enraged ? BOSS.ratsEnr : BOSS.rats;
    var mp = mouthPos(m);
    for (var i = 0; i < n; i++) {
      if (aliveCount() >= MAX_ALIVE + 4) break;
      var r = makeMutant('rat', nextId++, clamp(mp.x - 20, 0, world().width - 40), mp.y);
      r.vx = m.facing * rand(160, 420) + rand(-80, 80);
      r.vy = rand(-620, -420);
      r.facing = m.facing;
      r.state = 'hurt'; r.stateTimer = 0.45;
      Mutants.list.push(r);
      particles(mp.x, mp.y, 10, TOXIC, 200);
      send({ t: 'mutantFx', kind: 'spawn', id: r.id, x: Math.round(mp.x), y: Math.round(mp.y), gy: gy() });
    }
  }

  // ---- AI (권한측)
  function updateBoss(m, dt) {
    var mul = bossMul(m);
    var tgt = nearestTarget(m);
    m.target = tgt;
    if (m.summonCd > 0) m.summonCd -= dt;
    var dxT = tgt ? (tgt.x + tgt.w / 2) - bcx(m) : 0;
    m.stateTimer -= dt;
    var done = m.stateTimer <= 0;

    switch (m.state) {
      case 'intro':
        if (m.onGround) {
          var lx = bcx(m);
          bossEmit({ kind: 'land', x: Math.round(lx) });
          setBossState(m, 'roar', BOSS.roarTime);
          var mp0 = mouthPos(m);
          bossEmit({ kind: 'roar', x: Math.round(mp0.x), dy: Math.round(gy() - mp0.y), dir: m.facing });
        }
        break;

      case 'roar':
      case 'enrage':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) { setBossState(m, 'walk', 0); m.cool = 0.6; }
        break;

      case 'walk':
      case 'idle':
        m.state = 'walk';
        m.cool -= dt;
        var spd = m.enraged ? BOSS.walkEnr : BOSS.walk;
        if (tgt) {
          m.facing = dxT >= 0 ? 1 : -1;
          var want = Math.abs(dxT) > m.w * 0.5 + 60 ? m.facing * spd : 0;
          m.vx = approach(m.vx, want, 500, dt);
          if (m.cool <= 0) startPattern(m, choosePattern(m, tgt), tgt);
        } else {
          m.vx = approach(m.vx, 0, 500, dt);
        }
        break;

      case 'charge_wind':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) {
          setBossState(m, 'charge', BOSS.chargeTime);
          shake(8);
        }
        break;

      case 'charge':
        var cs = m.enraged ? BOSS.chargeSpdEnr : BOSS.chargeSpd;
        m.vx = m.facing * cs;
        if (Math.random() < 0.6) particles(bcx(m) - m.facing * m.w * 0.4, gy() - 6, 2, '#c9b48a', 160);
        if (m.hitWall === m.facing) {
          // 벽에 들이받음 → 길게 휘청 (반격 기회)
          shake(20);
          particles(m.facing > 0 ? m.x + m.w : m.x, m.y + m.h * 0.5, 30, '#e07a35', 360);
          m.vx = -m.facing * 200;
          setBossState(m, 'stagger', 1.6);
        } else if (done) {
          setBossState(m, 'stagger', 0.9 * mul + 0.2);
        }
        break;

      case 'stagger':
        m.vx = approach(m.vx, 0, 1400, dt);
        if (done) { setBossState(m, 'walk', 0); m.cool = BOSS.cool * mul * 0.6; }
        break;

      case 'slam_wind':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) {
          slamImpact(m, false);
          setBossState(m, 'slam', 0.6);
        }
        break;

      case 'slam':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) {
          if (m.enraged && !m.slam2) {
            // 격노: 연속 두 번 내려찍기
            m.slam2 = true;
            if (tgt) m.facing = dxT >= 0 ? 1 : -1;
            setBossState(m, 'slam_wind', 0.5);
          } else {
            setBossState(m, 'recover', 0.6 * mul);
          }
        }
        break;

      case 'spit_wind':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) setBossState(m, 'spit', 0.5);
        break;

      case 'spit':
        if (done) setBossState(m, 'recover', 0.6 * mul);
        break;

      case 'summon':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) { summonRats(m); setBossState(m, 'recover', 0.5); }
        break;

      case 'leap_wind':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) {
          var T = BOSS.leapT;
          m.vx = (m.aux - bcx(m)) / T;
          m.vy = -0.5 * gravity() * T;
          m.onGround = false;
          m.y -= 2;
          setBossState(m, 'leap', 3);
        }
        break;

      case 'leap':
        if (m.onGround && m.vy >= 0 && m.stateDur - m.stateTimer > 0.1) {
          m.vx = 0;
          slamImpact(m, true);
          setBossState(m, 'slam', 0.7);
          m.slam2 = true;
        }
        break;

      case 'recover':
        m.vx = approach(m.vx, 0, 2000, dt);
        if (done) { setBossState(m, 'walk', 0); m.cool = BOSS.cool * mul; }
        break;

      default:
        setBossState(m, 'walk', 0);
    }
    bossPhysics(m, dt);
  }

  // ---- 피격 (권한측)
  function resolveAttacker(by, src) {
    if (by !== 'me') return by;
    if (src) {
      if (src.by != null) return String(src.by);
      if (src.casterId != null) return String(src.casterId);
      if (src.castId != null && Game.Skills && typeof Game.Skills.attackerOf === 'function') {
        try {
          var a = Game.Skills.attackerOf({ castId: src.castId });
          if (a != null) return String(a);
        } catch (e) { /* 무시 */ }
      }
    }
    return myNetId();
  }

  function bossApplyHit(m, dmg, kx, ky, src, by) {
    if (m.state === 'intro') return;          // 낙하 중엔 무적
    dmg = +dmg || 0;
    if (dmg <= 0) return;
    m.hitFlash = 0.15;
    m.hp -= dmg;
    m.killer = resolveAttacker(by, src);
    m.killSrc = src || null;
    m.vx += (+kx || 0) * 0.06;               // 거의 밀리지 않음
    particles(bcx(m), m.y + m.h * 0.45, 6, TOXIC, 180);
    if (m.hp <= 0) { bossDie(m); return; }
    if (!m.enraged && m.hp < m.maxHp * 0.5) {
      m.enraged = true;
      m.lagHp = m.hp;
      if (m.state !== 'leap' && m.state !== 'charge') {
        m.vx = 0;
        setBossState(m, 'enrage', BOSS.enrageTime);
      }
      m.cool = 0.4;
      var mp = mouthPos(m);
      bossEmit({ kind: 'enrage', x: Math.round(mp.x), dy: Math.round(gy() - mp.y), dir: m.facing });
    }
  }

  function bossDie(m) {
    m.hp = 0;
    m.alive = false;
    var cx = bcx(m), cy = m.y + m.h / 2;
    var killer = m.killer;
    var P = Game.players || {};
    var kp = (killer != null && typeof P.byId === 'function') ? P.byId(killer) : null;
    var name = (kp && kp.name) ? kp.name : (killer === myNetId() && P.local && P.local.name ? P.local.name : '누군가');
    for (var i = Mutants.list.length - 1; i >= 0; i--) if (Mutants.list[i] === m) Mutants.list.splice(i, 1);
    bossEmit({ kind: 'die', x: Math.round(cx), dy: Math.round(gy() - cy), killer: killer, name: name,
               facing: m.facing, enr: m.enraged ? 1 : 0, src: m.killSrc || null });
    if (killer != null && typeof Game.awardPoint === 'function') {
      try { Game.awardPoint(killer, 1, 'boss'); } catch (e) { if (window.console) console.error('[boss] awardPoint', e); }
    }
    if (killer === myNetId()) emitKill('boss', m.killSrc || null);
    // 보상 아이템 3개
    if (Game.Items && typeof Game.Items.spawnAt === 'function') {
      var kinds = ['heal', null, null];
      for (var k = 0; k < 3; k++) {
        try { Game.Items.spawnAt(clamp(cx + (k - 1) * 90, 30, world().width - 30), 0, kinds[k]); } catch (e2) { /* 무시 */ }
      }
    }
    bossTimer = BOSS.respawn;
    bossWarned = false;
  }

  // ---- 접촉 피해 (로컬: 모든 클라이언트 / 봇: 권한측)
  function checkBossContact(m, dt) {
    if (m.state === 'intro' || m.state === 'leap') return;   // 낙하·도약 착지는 충격 범위 판정으로 처리
    var charging = m.state === 'charge';
    var box = { x: m.x + 10, y: m.y + 16, w: m.w - 20, h: m.h - 16 };
    for (var k in m.botCd) if (m.botCd[k] > 0) m.botCd[k] -= dt;
    forVictims(function (p, key, isLocal) {
      if (!rectHit(box, p)) return;
      var cd = isLocal ? m.dmgCd : (m.botCd[key] || 0);
      if (cd > 0) return;
      var dir = (p.x + p.w / 2) >= bcx(m) ? 1 : -1;
      var ok;
      if (charging) ok = hurt(p, isLocal, BOSS.chargeDmg, m.facing * BOSS.chargeKx, BOSS.chargeKy);
      else ok = hurt(p, isLocal, BOSS.contactDmg, dir * TYPES.boss.knockX, TYPES.boss.knockY);
      if (ok || !isLocal) {
        if (isLocal) m.dmgCd = charging ? 0.8 : BOSS.contactCd; else m.botCd[key] = charging ? 0.8 : BOSS.contactCd;
      }
    });
  }

  // ---- 공용 fx 시뮬레이션 (모든 클라이언트)
  function updateBossFx(dt) {
    if (warnT > 0) {
      warnT -= dt;
      shake(0.55 * dt * 60);
    }
    var G0 = gy();
    var W = world();
    var keep = [];
    for (var i = 0; i < bossFx.length; i++) {
      var f = bossFx[i];
      f.t += dt;
      var alive = true;
      if (f.kind === 'wave') {
        var pr = f.r;
        f.r += f.spd * dt;
        var a = f.x0 + f.dir * (pr - 30), b = f.x0 + f.dir * (f.r + 30);
        var band = { x: Math.min(a, b), y: G0 - BOSS.waveH, w: Math.abs(b - a), h: BOSS.waveH };
        forVictims(function (p, key, isLocal) {
          if (f.hit[key] || !rectHit(band, p)) return;
          f.hit[key] = true;
          hurt(p, isLocal, BOSS.waveDmg, f.dir * 420, -640);
        });
        if (Math.random() < 0.7) particles(f.x0 + f.dir * f.r, G0 - 6, 1, Math.random() < 0.5 ? '#c9b48a' : TOXIC, 140);
        var fx = f.x0 + f.dir * f.r;
        if (f.r > BOSS.waveRange || fx < -40 || fx > W.width + 40) alive = false;
      } else if (f.kind === 'glob') {
        if (f.delay > 0) { f.delay -= dt; keep.push(f); continue; }
        var g = gravity() * 0.42;
        var ox = f.x, oy = f.y;
        f.vy += g * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.trail.push(ox, oy);
        if (f.trail.length > 16) f.trail.splice(0, 2);
        var gr = BOSS.globR;
        forVictims(function (p, key, isLocal) {
          if (f.hit[key]) return;
          var nx = clamp(f.x, p.x, p.x + p.w), ny = clamp(f.y, p.y, p.y + p.h);
          var dx = f.x - nx, dy = f.y - ny;
          if (dx * dx + dy * dy > gr * gr) return;
          f.hit[key] = true;
          hurt(p, isLocal, BOSS.globDmg, (f.vx >= 0 ? 1 : -1) * 300, -320);
          particles(f.x, f.y, 10, TOXIC, 200);
        });
        // 발판 / 땅에 닿으면 웅덩이
        var landY = null;
        if (f.vy > 0 && W.platforms) {
          for (var pi = 0; pi < W.platforms.length; pi++) {
            var pl = W.platforms[pi];
            if (pl && f.x > pl.x && f.x < pl.x + pl.w && oy <= pl.y && f.y >= pl.y) { landY = pl.y; break; }
          }
        }
        if (landY == null && f.y >= G0) landY = G0;
        if (landY != null) {
          alive = false;
          particles(f.x, landY - 4, 14, TOXIC, 220);
          keep.push({ kind: 'puddle', x: f.x, y: landY, w: BOSS.puddleW, life: BOSS.puddleLife * (f.enr ? 1.3 : 1), t: 0, cd: {} });
        }
        if (f.t > 4) alive = false;
      } else if (f.kind === 'puddle') {
        var pz = { x: f.x - f.w / 2, y: f.y - 14, w: f.w, h: 16 };
        for (var ck in f.cd) if (f.cd[ck] > 0) f.cd[ck] -= dt;
        forVictims(function (p, key, isLocal) {
          if ((f.cd[key] || 0) > 0 || !rectHit(pz, p)) return;
          f.cd[key] = BOSS.puddleTick;
          hurt(p, isLocal, BOSS.puddleDmg, 0, -120);
        });
        if (Math.random() < 0.25) particles(f.x + rand(-f.w / 2, f.w / 2), f.y - 4, 1, TOXIC, 60);
        if (f.t >= f.life) alive = false;
      } else {
        if (f.t >= (f.life || 1)) alive = false;
      }
      if (alive) keep.push(f);
    }
    bossFx = keep;
  }

  // ---------------------------------------------------------------- 보스 HUD (DOM)
  var hudEl = null, hudFill = null, hudLag = null, hudName = null, hudPhase = null, hudNum = null, warnEl = null;
  var hudState = { shown: false, ratio: -1, lag: -1, enr: null, warn: false };

  function ensureHud() {
    if (hudEl) return true;
    if (typeof document === 'undefined' || !document.getElementById) return false;
    var hud = document.getElementById('hud');
    if (!hud) return false;
    if (!document.getElementById('boss-hud-style')) {
      var st = document.createElement('style');
      st.id = 'boss-hud-style';
      st.textContent = [
        '#boss-hud{position:absolute;top:12px;left:50%;transform:translateX(-50%);width:min(460px,36vw);z-index:3;pointer-events:none;text-align:center;font-family:var(--font-body,sans-serif);filter:drop-shadow(0 4px 10px rgba(0,0,0,.55))}',
        '#boss-hud .bh-top{display:flex;align-items:baseline;justify-content:center;gap:8px;margin-bottom:3px}',
        '#boss-hud .bh-name{font-family:var(--font-title,sans-serif);font-size:1.15rem;letter-spacing:.14em;color:#ffd2a8;text-shadow:0 0 8px rgba(141,255,60,.45),0 2px 0 #5a2a10}',
        '#boss-hud .bh-phase{font-size:.72rem;font-weight:900;letter-spacing:.1em;padding:1px 6px;border-radius:3px;background:#5a2a10;color:#ffb38a;border:1px solid #e07a35}',
        '#boss-hud .bh-num{font-size:.7rem;color:#b9ab98;font-weight:700}',
        '#boss-hud .bh-bar{position:relative;height:16px;border-radius:3px;overflow:hidden;background:linear-gradient(180deg,#1a1f1e,#0d1110);border:2px solid #b5541c;box-shadow:inset 0 0 8px rgba(0,0,0,.8),0 0 0 1px #2e3433,0 0 14px rgba(141,255,60,.18)}',
        '#boss-hud .bh-lag{position:absolute;left:0;top:0;bottom:0;background:#ffe0a0;opacity:.85;transition:width .5s ease .25s}',
        '#boss-hud .bh-fill{position:absolute;left:0;top:0;bottom:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.10) 0 6px,rgba(0,0,0,0) 6px 14px),linear-gradient(180deg,#c8ff7a,#8dff3c 40%,#4c6a28);transition:width .12s linear;box-shadow:0 0 10px rgba(141,255,60,.6)}',
        '#boss-hud .bh-ticks{position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(0,0,0,0) 0 calc(10% - 1px),rgba(0,0,0,.45) calc(10% - 1px) 10%)}',
        '#boss-hud .bh-mid{position:absolute;left:50%;top:-2px;bottom:-2px;width:2px;background:#e07a35;box-shadow:0 0 4px #e07a35}',
        '#boss-hud.enr .bh-fill{background:repeating-linear-gradient(115deg,rgba(255,255,255,.12) 0 6px,rgba(0,0,0,0) 6px 14px),linear-gradient(180deg,#ffb07a,#ff5a2a 45%,#8a2410);box-shadow:0 0 12px rgba(255,90,42,.7)}',
        '#boss-hud.enr .bh-bar{animation:bhPulse .7s ease-in-out infinite alternate}',
        '@keyframes bhPulse{from{box-shadow:inset 0 0 8px rgba(0,0,0,.8),0 0 6px rgba(255,90,42,.3)}to{box-shadow:inset 0 0 8px rgba(0,0,0,.8),0 0 18px rgba(255,90,42,.85)}}',
        '#boss-warn{position:absolute;top:22%;left:50%;transform:translateX(-50%);z-index:3;pointer-events:none;font-family:var(--font-title,sans-serif);font-size:clamp(1.6rem,5vw,3rem);letter-spacing:.12em;color:#ff7a3a;text-shadow:0 0 18px rgba(255,80,30,.9),0 3px 0 #3a1408;white-space:nowrap;animation:bwBlink .5s steps(2,end) infinite}',
        '#boss-warn small{display:block;font-family:var(--font-body,sans-serif);font-size:.9rem;letter-spacing:.3em;color:#8dff3c;text-shadow:0 0 8px rgba(141,255,60,.8)}',
        '@keyframes bwBlink{50%{opacity:.35}}',
        '@media (max-width:760px){#boss-hud{top:auto;bottom:96px;width:72vw}#boss-hud .bh-name{font-size:.95rem}}'
      ].join('\n');
      (document.head || document.body).appendChild(st);
    }
    hudEl = document.createElement('div');
    hudEl.id = 'boss-hud';
    hudEl.hidden = true;
    hudEl.innerHTML = '<div class="bh-top"><span class="bh-name"></span><span class="bh-phase" hidden>격노</span><span class="bh-num"></span></div>' +
      '<div class="bh-bar"><div class="bh-lag"></div><div class="bh-fill"></div><div class="bh-ticks"></div><div class="bh-mid"></div></div>';
    hud.appendChild(hudEl);
    hudName = hudEl.querySelector('.bh-name');
    hudPhase = hudEl.querySelector('.bh-phase');
    hudNum = hudEl.querySelector('.bh-num');
    hudFill = hudEl.querySelector('.bh-fill');
    hudLag = hudEl.querySelector('.bh-lag');
    hudName.textContent = BOSS.name;
    warnEl = document.createElement('div');
    warnEl.id = 'boss-warn';
    warnEl.hidden = true;
    warnEl.innerHTML = '⚠ 보스 출현! <small>' + BOSS.name + '</small>';
    hud.appendChild(warnEl);
    return true;
  }

  function bossHudSync(b) {
    if (!ensureHud()) return;
    var showWarn = warnT > 0 && !b;
    if (showWarn !== hudState.warn) { hudState.warn = showWarn; warnEl.hidden = !showWarn; }
    if (!b) {
      if (hudState.shown) { hudState.shown = false; hudEl.hidden = true; }
      return;
    }
    if (!hudState.shown) { hudState.shown = true; hudEl.hidden = false; hudState.ratio = -1; }
    var r = clamp(b.hp / (b.maxHp || 1), 0, 1);
    var pct = Math.round(r * 1000) / 10;
    if (pct !== hudState.ratio) {
      hudState.ratio = pct;
      hudFill.style.width = pct + '%';
      hudLag.style.width = pct + '%';
      hudNum.textContent = Math.ceil(Math.max(0, b.hp)) + ' / ' + b.maxHp;
    }
    if (b.enraged !== hudState.enr) {
      hudState.enr = b.enraged;
      hudPhase.hidden = !b.enraged;
      if (hudEl.classList) hudEl.classList.toggle('enr', !!b.enraged);
    }
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
      bossTimer = BOSS.firstAt;
      bossWarned = false;
      bossFx = [];
      warnT = 0;
      bossHudSync(null);
    },

    update: function (dt) {
      if (!dt || dt <= 0) return;
      if (dt > 0.05) dt = 0.05;
      clock += dt;
      registerHandlers();
      if (Game.running === false) { bossHudSync(null); return; }
      var auth = isAuthority();
      var i, m;

      if (auth) {
        matchTime += dt;
        if (!Game.matchOver) {
          spawnTimer -= dt;
          if (spawnTimer <= 0) {
            spawnTimer = rand(10, 14);
            if (!findBoss()) spawnWave();   // 보스전 중엔 일반 출현 쉼 (보스가 쥐를 부름)
          }
          bossSchedule(dt);
        }
      }

      for (i = 0; i < Mutants.list.length; i++) {
        m = Mutants.list[i];
        if (!m.alive) continue;
        if (m.boss) {
          m.animT += dt * (1 + Math.min(Math.abs(m.vx), 1200) / 140);
        } else {
          m.animT += dt * (1 + Math.min(Math.abs(m.vx), 600) / 60);
        }
        if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt);
        if (m.dmgCd > 0) m.dmgCd -= dt;
        if (auth) {
          if (!tickStatus(m, dt)) {
            var adt = m.slowT > 0 ? dt * (m.boss ? 0.65 : 0.45) : dt;
            if (m.boss) updateBoss(m, adt);
            else if (m.type === 'crow') updateCrow(m, adt); else updateGround(m, adt);
          }
        } else {
          updateGuestMutant(m, dt);
        }
        if (m.boss) checkBossContact(m, dt); else checkAttack(m);
      }
      updateBossFx(dt);
      bossHudSync(findBoss());

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
      if (m.boss) secs *= BOSS.resist;     // 보스는 상태이상 저항 (지속시간 절반)
      if (kind === 'slow') m.slowT = Math.max(m.slowT || 0, secs);
      else if (kind === 'root') m.rootT = Math.max(m.rootT || 0, secs);
      else if (kind === 'stun') m.stunT = Math.max(m.stunT || 0, secs);
    },

    isAuthority: isAuthority,

    // 즉시 1마리 소환 (권한측, 동시 최대 12). x 를 주면 그 위치에
    forceSpawn: function (type, x) {
      if (!isAuthority() || !TYPES[type] || TYPES[type].boss || aliveCount() >= 12) return null;
      var m = spawnOne(type);
      if (m && typeof x === 'number') {
        m.x = clamp(x, 0, world().width - m.w);
        m.tx = m.x;
      }
      return m;
    },

    render: function (ctx) {
      if (!ctx) return;
      var i, m;
      // 보스와 바닥 표식은 작은 돌연변이 뒤에
      ctx.save();
      try { renderBossUnder(ctx); } catch (e0) { /* 무시 */ }
      ctx.restore();
      for (i = 0; i < Mutants.list.length; i++) {
        m = Mutants.list[i];
        if (!m.alive || !m.boss) continue;
        ctx.save();
        try { drawBoss(ctx, m); } catch (e1) { if (window.console) console.error('[boss] draw', e1); }
        ctx.restore();
      }
      for (i = 0; i < Mutants.list.length; i++) {
        m = Mutants.list[i];
        if (!m.alive || m.boss) continue;
        ctx.save();
        try { drawMutant(ctx, m); } catch (e) { /* 렌더 오류가 루프를 멈추지 않게 */ }
        ctx.restore();
        drawHpBar(ctx, m);
      }
      ctx.save();
      try { renderBossOver(ctx); } catch (e2) { /* 무시 */ }
      ctx.restore();
    },

    // 현재 보스 (없으면 null)
    boss: function () { return findBoss(); },
    bossInfo: BOSS,

    // 테스트/디버그용
    _debug: {
      spawnBoss: function (x) { return spawnBoss(typeof x === 'number' ? x : null, true); },
      bossWarn: function () { bossTimer = BOSS.warn + 0.01; bossWarned = false; },
      setBossTimer: function (t) { bossTimer = t; },
      getBossTimer: function () { return bossTimer; },
      forcePattern: function (p) { var b = findBoss(); if (b && isAuthority()) startPattern(b, p, nearestTarget(b)); return b ? b.state : null; },
      bossFx: function () { return bossFx; },
      onBossFx: function (msg) { onBossFxMsg(msg); },
      sendSnapshot: sendSnapshot,
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

  // ================================================================ 보스 그래픽 '녹슨 거수'
  // 몸 전체를 오프스크린에 그린 뒤 합성 → 실루엣 그대로 피격 플래시 / 예고 발광을 덧칠할 수 있다.
  var OW = 540, OH = 420, OX = 270, OY = 380;   // 오프스크린 (원점 = 발밑 중앙)
  var offCv = null, offK = 0;
  var RED = '#ff5a2a';

  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); }

  function bossPose(m) {
    var st = m.state;
    var dur = m.stateDur > 0 ? m.stateDur : 1;
    var p = clamp(1 - m.stateTimer / dur, 0, 1);
    var pulse = 0.5 + 0.5 * Math.sin(clock * 28);
    var spd = Math.abs(m.vx || 0);
    var P = {
      lean: 0, crouch: 0, head: Math.sin(clock * 1.7) * 0.03, jaw: 0.1 + Math.sin(clock * 2.3) * 0.04, sac: 0.15,
      phase: m.animT * 3, stride: clamp(spd / 120, 0, 1) * 30, bob: 0,
      glow: 0.15, tele: 0, air: false, tuck: false, roar: 0, dizzy: 0,
      pawX: 0, pawY: 0, fore: 0, jit: 0, dead: 0
    };
    P.bob = Math.abs(Math.sin(P.phase)) * 3 * clamp(spd / 120, 0, 1) + Math.sin(clock * 2) * 1.5;
    switch (st) {
      case 'charge_wind':
        P.crouch = 12 * easeOut(p * 2); P.head = 0.24; P.jaw = 0.3;
        P.pawX = Math.sin(clock * 13) * 28; P.pawY = Math.max(0, Math.cos(clock * 13)) * 18;
        P.glow = 0.5 + 0.5 * pulse; P.tele = pulse; P.jit = 1.5; P.stride = 0;
        break;
      case 'charge':
        P.lean = 0.1; P.stride = 64; P.head = 0.2; P.jaw = 0.55; P.glow = 0.75; P.bob = Math.abs(Math.sin(P.phase)) * 7;
        break;
      case 'stagger':
        P.head = 0.32 + Math.sin(clock * 6) * 0.08; P.dizzy = 1; P.jaw = 0.3; P.crouch = 6; P.stride = 0;
        break;
      case 'slam_wind':
        P.lean = -0.44 * easeOut(p * 1.4); P.fore = easeOut(p * 1.6); P.jaw = 0.6; P.head = -0.12;
        P.glow = 0.5 + 0.5 * pulse; P.tele = pulse; P.stride = 0; P.jit = 0.8;
        break;
      case 'slam':
        var q = m.stateTimer / dur;
        P.lean = 0.1 * q; P.crouch = 16 * q; P.jaw = 0.5 * q + 0.1; P.stride = 0; P.head = 0.1 * q;
        break;
      case 'spit_wind':
        P.head = -0.32 * easeOut(p * 2); P.sac = 0.25 + 0.8 * p; P.jaw = 0.1 + 0.2 * p;
        P.glow = 0.5 + 0.5 * pulse; P.tele = pulse; P.stride = 0;
        break;
      case 'spit':
        P.head = -0.14; P.jaw = 0.95; P.sac = 0.3 - 0.15 * p; P.stride = 0; P.glow = 0.7;
        break;
      case 'summon':
      case 'roar':
      case 'enrage':
        P.head = -0.46 * easeOut(p * 4); P.jaw = 1; P.roar = 1; P.stride = 0; P.jit = st === 'enrage' ? 2.2 : 1.2;
        P.glow = 0.6 + 0.4 * pulse; P.tele = st === 'roar' ? 0 : pulse * 0.6;
        break;
      case 'leap_wind':
        P.crouch = 28 * easeOut(p * 1.5); P.head = 0.16; P.glow = 0.5 + 0.5 * pulse; P.tele = pulse; P.stride = 0; P.jit = 1;
        break;
      case 'leap':
        P.air = true; P.tuck = true; P.lean = clamp((m.vy || 0) / 2400, -0.25, 0.25); P.jaw = 0.6; P.stride = 0;
        break;
      case 'intro':
        P.air = true; P.lean = 0.06; P.jaw = 0.7; P.stride = 0;
        break;
      case 'dead':
        P.dead = p; P.crouch = 20 * easeOut(p * 2); P.lean = 0.18 * easeOut(p * 1.5); P.head = 0.5 * easeOut(p * 2);
        P.jaw = 0.5; P.stride = 0; P.glow = 0; P.bob = 0;
        break;
    }
    if (m.enraged) P.glow = Math.max(P.glow, 0.45 + 0.25 * Math.sin(clock * 9));
    return P;
  }

  // 2-관절 다리 (IK)
  function ikKnee(hx, hy, fx, fy, l1, l2, bend) {
    var dx = fx - hx, dy = fy - hy;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var maxD = l1 + l2 - 1;
    if (d > maxD) { fx = hx + dx / d * maxD; fy = hy + dy / d * maxD; dx = fx - hx; dy = fy - hy; d = maxD; }
    var a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var ux = dx / d, uy = dy / d;
    return { kx: hx + ux * a + (-uy) * h * bend, ky: hy + uy * a + ux * h * bend, fx: fx, fy: fy };
  }

  function bossLeg(o, hx, hy, fx, fy, l1, l2, bend, w1, w2, col, hi, fore) {
    var k = ikKnee(hx, hy, fx, fy, l1, l2, bend);
    o.lineCap = 'round'; o.lineJoin = 'round';
    // 외곽선
    o.strokeStyle = '#0e0907';
    o.lineWidth = w1 + 5;
    o.beginPath(); o.moveTo(hx, hy); o.lineTo(k.kx, k.ky); o.stroke();
    o.lineWidth = w2 + 5;
    o.beginPath(); o.moveTo(k.kx, k.ky); o.lineTo(k.fx, k.fy - 4); o.stroke();
    // 살
    o.strokeStyle = col;
    o.lineWidth = w1;
    o.beginPath(); o.moveTo(hx, hy); o.lineTo(k.kx, k.ky); o.stroke();
    o.lineWidth = w2;
    o.beginPath(); o.moveTo(k.kx, k.ky); o.lineTo(k.fx, k.fy - 4); o.stroke();
    // 근육 하이라이트
    o.strokeStyle = hi;
    o.lineWidth = Math.max(2, w1 * 0.22);
    o.beginPath(); o.moveTo(hx + 4, hy + 4); o.lineTo((hx + k.kx) / 2 + 4, (hy + k.ky) / 2); o.stroke();
    // 관절 녹슨 볼트 (앞다리 팔꿈치에 철판 덧댐)
    if (fore) {
      o.fillStyle = '#7a3a16';
      o.beginPath(); o.arc(k.kx, k.ky, w2 * 0.55, 0, Math.PI * 2); o.fill();
      o.fillStyle = '#c0682a';
      o.beginPath(); o.arc(k.kx - 2, k.ky - 2, w2 * 0.22, 0, Math.PI * 2); o.fill();
    }
    // 발 + 철근 발톱
    var fx2 = k.fx, fy2 = k.fy;
    o.fillStyle = '#1c1411';
    o.beginPath(); o.ellipse(fx2 + 4, fy2 - 6, w2 * 0.85, 8, 0, 0, Math.PI * 2); o.fill();
    o.fillStyle = '#9aa09a';
    for (var c = 0; c < 3; c++) {
      var cx0 = fx2 + 4 + (c - 1) * w2 * 0.45 + w2 * 0.35;
      o.beginPath(); o.moveTo(cx0 - 3, fy2 - 5); o.lineTo(cx0 + 9, fy2 - 1); o.lineTo(cx0 - 2, fy2); o.closePath(); o.fill();
    }
    o.fillStyle = 'rgba(181,84,28,0.8)';
    o.fillRect(fx2 + 4 + w2 * 0.35 - 2, fy2 - 5, 4, 3);
  }

  function rustPlate(o, x, y, w, h, rot, steel, seed) {
    o.save();
    o.translate(x, y); o.rotate(rot);
    var g = o.createLinearGradient(0, -h / 2, 0, h / 2);
    if (steel) { g.addColorStop(0, '#6a7270'); g.addColorStop(1, '#2e3433'); }
    else { g.addColorStop(0, '#d0703a'); g.addColorStop(0.5, '#b5541c'); g.addColorStop(1, '#5a2a10'); }
    o.fillStyle = g;
    o.strokeStyle = '#1a0e08'; o.lineWidth = 2.5;
    o.beginPath();
    o.moveTo(-w / 2 + 4, -h / 2); o.lineTo(w / 2 - 2, -h / 2 + 3); o.lineTo(w / 2, h / 2 - 4);
    o.lineTo(w / 2 - 10, h / 2); o.lineTo(-w / 2 + 6, h / 2 - 2); o.lineTo(-w / 2, -h / 2 + 8);
    o.closePath(); o.fill(); o.stroke();
    // 윗변 하이라이트
    o.strokeStyle = steel ? 'rgba(200,210,205,0.5)' : 'rgba(255,170,100,0.6)'; o.lineWidth = 1.5;
    o.beginPath(); o.moveTo(-w / 2 + 6, -h / 2 + 2); o.lineTo(w / 2 - 4, -h / 2 + 5); o.stroke();
    // 녹 반점 (철판)
    if (steel) { rust(o, -w * 0.15, 2, w * 0.18, h * 0.22); rust(o, w * 0.25, -3, w * 0.1, h * 0.15); }
    // 리벳
    for (var i = 0; i < 4; i++) {
      var rx = -w / 2 + 7 + i * (w - 14) / 3;
      o.fillStyle = '#2e2420';
      o.beginPath(); o.arc(rx, -h / 2 + 6, 2.4, 0, Math.PI * 2); o.fill();
      o.fillStyle = 'rgba(255,200,150,0.55)';
      o.beginPath(); o.arc(rx - 0.7, -h / 2 + 5.3, 0.9, 0, Math.PI * 2); o.fill();
    }
    // 녹물 줄기
    o.strokeStyle = 'rgba(150,62,20,0.55)'; o.lineWidth = 1.6;
    for (var s = 0; s < 3; s++) {
      var sx = -w / 2 + 10 + ((seed * 37 + s * 17) % (w - 16));
      o.beginPath(); o.moveTo(sx, h / 2 - 3); o.lineTo(sx + 1, h / 2 + 6 + s * 3); o.stroke();
    }
    o.restore();
  }

  function mushroom(o, x, y, s, lit) {
    o.strokeStyle = '#d8d0b0'; o.lineWidth = s * 0.35;
    o.beginPath(); o.moveTo(x, y); o.lineTo(x + s * 0.2, y - s); o.stroke();
    o.save();
    if (lit) { o.shadowColor = TOXIC; o.shadowBlur = 8; }
    o.fillStyle = lit ? '#b8ff7a' : '#7fe0b8';
    o.beginPath(); o.ellipse(x + s * 0.2, y - s, s * 0.75, s * 0.42, 0, Math.PI, 0); o.fill();
    o.restore();
  }

  function bossEye(o, x, y, r, intensity, enr) {
    var col = enr ? '#ff8a3a' : TOXIC, hot = enr ? '#ffe0a0' : TOXIC_HOT;
    o.save();
    o.shadowColor = col;
    o.shadowBlur = 6 + intensity * 16;
    o.fillStyle = intensity > 0.6 ? hot : col;
    o.beginPath(); o.arc(x, y, r * (1 + intensity * 0.3), 0, Math.PI * 2); o.fill();
    o.shadowBlur = 0;
    o.fillStyle = '#100803';
    o.beginPath(); o.ellipse(x + r * 0.2, y, r * 0.22, r * 0.62, 0, 0, Math.PI * 2); o.fill();
    o.restore();
  }

  // 몸 그리기 (o: 오프스크린 ctx, 원점 = 발밑 중앙, +x = 앞)
  function drawBossBody(o, m, P) {
    var enr = !!m.enraged;
    var by = -P.crouch - P.bob;
    var ph = P.phase;
    var st = P.stride;
    var gl = P.glow;
    var deadA = P.dead > 0 ? 1 - P.dead : 1;

    o.save();
    o.translate(-95, 0); o.rotate(P.lean); o.translate(95, 0);

    // 다리 발 위치
    function foot(hx, hy, off, l, isFore) {
      if (P.air) {
        if (P.tuck) return { x: hx + (isFore ? 26 : -18), y: hy + l * 0.55 };
        return { x: hx + (isFore ? 10 : -6), y: hy + l * 0.96 };
      }
      if (isFore && P.fore > 0) {
        return { x: hx + 30 + 30 * P.fore, y: hy + l * (0.95 - 0.75 * P.fore) };
      }
      var a = ph + off;
      return { x: hx + Math.sin(a) * st, y: -Math.max(0, -Math.cos(a)) * st * 0.45 };
    }

    // ---- 꼬리 + 질질 끌리는 쇠사슬
    var tx = -118, ty = by - 72;
    o.strokeStyle = '#2a1f1a'; o.lineWidth = 16; o.lineCap = 'round';
    o.beginPath(); o.moveTo(tx + 8, ty); o.quadraticCurveTo(tx - 26, ty - 6 + Math.sin(clock * 3) * 4, tx - 36, ty + 22); o.stroke();
    o.strokeStyle = '#3d2e26'; o.lineWidth = 9;
    o.beginPath(); o.moveTo(tx + 6, ty - 2); o.quadraticCurveTo(tx - 22, ty - 8 + Math.sin(clock * 3) * 4, tx - 34, ty + 20); o.stroke();
    var c0x = tx - 36, c0y = ty + 22;
    var c1x = tx - 96 - st * 0.3, c1y = P.air ? c0y + 70 : -5;
    for (var ci = 0; ci <= 9; ci++) {
      var u = ci / 9;
      var lx = c0x + (c1x - c0x) * u;
      var ly = c0y + (c1y - c0y) * u + Math.sin(u * Math.PI) * 14 + Math.sin(clock * 5 + ci) * 1.5;
      if (!P.air && ly > -4) ly = -4;
      o.strokeStyle = ci % 2 ? '#6a6e6a' : '#8a5a3a';
      o.lineWidth = 2.6;
      o.beginPath();
      if (ci % 2) o.ellipse(lx, ly, 6, 3.4, 0.3, 0, Math.PI * 2);
      else o.ellipse(lx, ly, 3.4, 6, 0.3, 0, Math.PI * 2);
      o.stroke();
    }

    // ---- 먼 쪽 다리
    var hbX = -78, hbY = by - 80, shX = 70, shY = by - 96;
    var f1 = foot(hbX + 14, hbY, Math.PI, 86, false);
    bossLeg(o, hbX + 14, hbY, f1.x, f1.y, 46, 42, -1, 30, 20, '#241a15', '#2f241e', false);
    var f2 = foot(shX + 14, shY, 0, 98, true);
    bossLeg(o, shX + 14, shY, f2.x, f2.y, 52, 48, 1, 32, 24, '#241a15', '#2f241e', true);

    // ---- 몸통
    o.save();
    o.beginPath();
    o.moveTo(-124, by - 66);
    o.bezierCurveTo(-132, by - 112, -92, by - 152, -32, by - 162);
    o.bezierCurveTo(8, by - 174, 62, by - 172, 90, by - 142);
    o.bezierCurveTo(114, by - 120, 120, by - 86, 104, by - 60);
    o.bezierCurveTo(80, by - 38, 20, by - 44, -20, by - 50);
    o.bezierCurveTo(-60, by - 52, -102, by - 42, -124, by - 66);
    o.closePath();
    var bg = o.createLinearGradient(0, by - 172, 0, by - 40);
    bg.addColorStop(0, enr ? '#5a3a2e' : '#4b3d33');
    bg.addColorStop(0.55, enr ? '#3a231b' : '#33281f');
    bg.addColorStop(1, '#1a120e');
    o.fillStyle = bg;
    o.fill();
    o.lineWidth = 4; o.strokeStyle = '#0e0907'; o.stroke();
    o.clip();
    // 어깨 볼륨
    var sg = o.createRadialGradient(40, by - 130, 10, 40, by - 120, 90);
    sg.addColorStop(0, 'rgba(120,95,75,0.45)'); sg.addColorStop(1, 'rgba(120,95,75,0)');
    o.fillStyle = sg; o.fillRect(-130, by - 180, 260, 150);
    // 드러난 갈비뼈
    o.strokeStyle = 'rgba(214,196,160,0.38)'; o.lineWidth = 3;
    for (var r = 0; r < 5; r++) {
      o.beginPath(); o.arc(-20 + r * 14, by - 70, 24, 3.6, 4.6); o.stroke();
    }
    // 털 결
    o.strokeStyle = 'rgba(10,6,4,0.55)'; o.lineWidth = 1.6;
    for (var fz = -110; fz < 100; fz += 9) {
      var fy0 = by - 58 - Math.sin((fz + 120) / 230 * Math.PI) * 18;
      o.beginPath(); o.moveTo(fz, fy0); o.lineTo(fz - 4, fy0 + 12); o.stroke();
    }
    o.restore();
    // 배 아래 삐죽 털
    o.fillStyle = '#1a120e';
    for (var bf = -100; bf < 90; bf += 14) {
      var byy = by - 48 + Math.abs(bf) * 0.04;
      o.beginPath(); o.moveTo(bf - 6, byy - 4); o.lineTo(bf, byy + 9 + (bf % 28 === 0 ? 4 : 0)); o.lineTo(bf + 6, byy - 4); o.fill();
    }

    // ---- 옆구리 독 분출구
    var ventCol = enr ? '#ffb04a' : TOXIC;
    for (var v = 0; v < 3; v++) {
      var vx = -62 + v * 22, vy = by - 104 + v * 4;
      o.save();
      o.translate(vx, vy); o.rotate(-0.5);
      o.fillStyle = '#0a0604';
      o.beginPath(); o.ellipse(0, 0, 4.5, 15, 0, 0, Math.PI * 2); o.fill();
      o.shadowColor = ventCol; o.shadowBlur = 8 + gl * 18;
      o.globalAlpha = (0.55 + 0.45 * gl) * deadA;
      o.fillStyle = ventCol;
      o.beginPath(); o.ellipse(0, 0, 2.2, 11 - (1 - gl) * 3, 0, 0, Math.PI * 2); o.fill();
      o.restore();
      // 김 (격노)
      if (enr && deadA > 0.5) {
        for (var sm = 0; sm < 2; sm++) {
          var tt = (clock * 0.9 + v * 0.37 + sm * 0.5) % 1;
          o.fillStyle = 'rgba(180,255,120,' + (0.28 * (1 - tt)).toFixed(3) + ')';
          o.beginPath(); o.arc(vx - 8 - tt * 18, vy - 10 - tt * 46, 4 + tt * 9, 0, Math.PI * 2); o.fill();
        }
      }
    }

    // ---- 등의 녹슨 철판 + 이끼 + 철근
    rustPlate(o, -92, by - 124, 52, 28, -0.95, false, 1);
    rustPlate(o, -54, by - 150, 58, 30, -0.45, true, 2);
    rustPlate(o, -8, by - 166, 60, 30, -0.1, false, 3);
    rustPlate(o, 44, by - 164, 56, 28, 0.22, false, 4);
    moss(o, -70, by - 146, 8, 0.2);
    moss(o, 18, by - 176, 7, 0.65);
    moss(o, 64, by - 160, 5, 0.4);
    mushroom(o, -74, by - 152, 8, true);
    mushroom(o, -64, by - 150, 6, false);
    mushroom(o, 22, by - 182, 7, true);
    // 철근 가시
    o.lineCap = 'round';
    var rods = [[-34, by - 160, -46, by - 214, -34, by - 230], [10, by - 172, 4, by - 214, 14, by - 224], [-78, by - 138, -102, by - 176, -112, by - 178]];
    for (var ri = 0; ri < rods.length; ri++) {
      var R = rods[ri];
      o.strokeStyle = '#120a06'; o.lineWidth = 8;
      o.beginPath(); o.moveTo(R[0], R[1]); o.quadraticCurveTo(R[2], R[3], R[4], R[5]); o.stroke();
      o.strokeStyle = ri === 1 ? '#7d8380' : '#8a4a22'; o.lineWidth = 4.5;
      o.beginPath(); o.moveTo(R[0], R[1]); o.quadraticCurveTo(R[2], R[3], R[4], R[5]); o.stroke();
      o.strokeStyle = 'rgba(255,190,140,0.35)'; o.lineWidth = 1.2;
      o.beginPath(); o.moveTo(R[0] + 1, R[1] - 2); o.quadraticCurveTo(R[2] + 1, R[3], R[4] + 1, R[5]); o.stroke();
    }
    // 부러진 경고 표지판 (철근 끝에 꽂힘)
    o.save();
    o.translate(-36, by - 226); o.rotate(0.35 + Math.sin(clock * 2.2) * 0.04);
    o.fillStyle = '#120a06';
    o.beginPath(); o.moveTo(0, -17); o.lineTo(17, 0); o.lineTo(0, 17); o.lineTo(-17, 0); o.closePath(); o.fill();
    o.fillStyle = '#c99a27';
    o.beginPath(); o.moveTo(0, -14); o.lineTo(14, 0); o.lineTo(0, 14); o.lineTo(-14, 0); o.closePath(); o.fill();
    rust(o, 5, 5, 6, 4);
    o.fillStyle = '#1a1208';
    o.fillRect(-1.6, -8, 3.2, 9); o.fillRect(-1.6, 3.5, 3.2, 3.2);
    o.restore();

    // ---- 가까운 쪽 다리
    var f3 = foot(hbX, hbY + 4, 0, 86, false);
    bossLeg(o, hbX, hbY + 4, f3.x, f3.y, 46, 42, -1, 36, 24, '#3e3029', '#5a4638', false);
    var fx4 = shX, fy4 = shY + 4;
    var f4 = foot(fx4, fy4, Math.PI, 98, true);
    if (P.pawX || P.pawY) { f4.x = fx4 + 10 + P.pawX; f4.y = -P.pawY; }
    bossLeg(o, fx4, fy4, f4.x, f4.y, 52, 48, 1, 40, 28, '#3e3029', '#5a4638', true);
    // 어깨 철판 (앞다리 위)
    rustPlate(o, shX + 2, shY - 18, 44, 34, 0.5, true, 5);

    // ---- 머리
    var nx = 92, ny = by - 118;
    o.save();
    o.translate(nx, ny);
    o.rotate(P.head);
    var jaw = clamp(P.jaw, 0, 1);
    // 목 갈기
    o.fillStyle = '#2a1f1a';
    o.beginPath(); o.moveTo(-26, -32); o.quadraticCurveTo(-4, -46, 14, -32); o.lineTo(10, 26); o.lineTo(-24, 20); o.closePath(); o.fill();
    // 목 아래 독 주머니
    var sac = clamp(P.sac, 0, 1.2);
    var sr = 16 + sac * 20, sry = 11 + sac * 14;
    var sg2 = o.createRadialGradient(20, 32 + sac * 6, 2, 20, 30 + sac * 6, sr);
    sg2.addColorStop(0, enr ? 'rgba(255,220,120,0.95)' : 'rgba(220,255,150,0.95)');
    sg2.addColorStop(0.5, enr ? 'rgba(255,120,40,0.75)' : 'rgba(141,255,60,0.75)');
    sg2.addColorStop(1, 'rgba(40,70,20,0.85)');
    o.save();
    if (sac > 0.5) { o.shadowColor = enr ? RED : TOXIC; o.shadowBlur = 10 + sac * 16; }
    o.fillStyle = sg2;
    o.beginPath(); o.ellipse(20, 30 + sac * 6, sr, sry, 0.15, 0, Math.PI * 2); o.fill();
    o.restore();
    o.strokeStyle = 'rgba(30,50,10,0.6)'; o.lineWidth = 1.2;
    o.beginPath(); o.moveTo(8, 26); o.quadraticCurveTo(18, 34 + sac * 8, 34, 28); o.moveTo(14, 22); o.quadraticCurveTo(22, 38 + sac * 10, 30, 40); o.stroke();

    // 아래턱 (회전)
    o.save();
    o.translate(4, 14);
    o.rotate(jaw * 0.55);
    // 입 안
    o.fillStyle = '#2a0c06';
    o.beginPath(); o.moveTo(0, -4); o.lineTo(72, -2); o.lineTo(70, 4); o.lineTo(2, 6); o.closePath(); o.fill();
    o.fillStyle = '#2e2119';
    o.strokeStyle = '#0e0907'; o.lineWidth = 3;
    o.beginPath(); o.moveTo(0, 0); o.lineTo(74, 4); o.lineTo(68, 18); o.lineTo(6, 24); o.closePath(); o.fill(); o.stroke();
    // 아랫니
    o.fillStyle = '#e6dcb8';
    for (var lt = 0; lt < 6; lt++) {
      var tx0 = 12 + lt * 10;
      o.beginPath(); o.moveTo(tx0, 3); o.lineTo(tx0 + 3, -6 - (lt % 2) * 3); o.lineTo(tx0 + 6, 3); o.fill();
    }
    // 철근 엄니 (아래턱에서 위로)
    o.lineCap = 'round';
    o.strokeStyle = '#120a06'; o.lineWidth = 9;
    o.beginPath(); o.moveTo(60, 10); o.quadraticCurveTo(84, 4, 92, -24); o.stroke();
    o.strokeStyle = '#8f9590'; o.lineWidth = 5.5;
    o.beginPath(); o.moveTo(60, 10); o.quadraticCurveTo(84, 4, 92, -24); o.stroke();
    o.strokeStyle = 'rgba(181,84,28,0.9)'; o.lineWidth = 5.5;
    o.beginPath(); o.moveTo(66, 9); o.lineTo(74, 7); o.stroke();
    // 독 침 흘림
    if (deadA > 0.5) {
      var dl = 6 + Math.abs(Math.sin(clock * 3)) * (10 + jaw * 14);
      o.fillStyle = enr ? 'rgba(255,170,80,0.85)' : 'rgba(141,255,60,0.85)';
      o.fillRect(40, 20, 3, dl);
      o.beginPath(); o.arc(41.5, 20 + dl, 3, 0, Math.PI * 2); o.fill();
    }
    o.restore();

    // 두개골
    var hg = o.createLinearGradient(0, -40, 0, 26);
    hg.addColorStop(0, enr ? '#55372a' : '#463830');
    hg.addColorStop(1, '#1d1511');
    o.fillStyle = hg;
    o.strokeStyle = '#0e0907'; o.lineWidth = 4;
    o.beginPath();
    o.moveTo(-14, -26);
    o.quadraticCurveTo(14, -44, 46, -36);
    o.quadraticCurveTo(76, -26, 86, -4);
    o.lineTo(88, 10);
    o.quadraticCurveTo(70, 20, 50, 16);
    o.lineTo(2, 18);
    o.quadraticCurveTo(-18, 12, -14, -26);
    o.closePath(); o.fill(); o.stroke();
    // 윗니
    o.fillStyle = '#e6dcb8';
    for (var ut = 0; ut < 6; ut++) {
      var ux0 = 22 + ut * 10;
      o.beginPath(); o.moveTo(ux0, 15); o.lineTo(ux0 + 3, 24 + (ut % 2) * 4); o.lineTo(ux0 + 6, 15); o.fill();
    }
    // 이마 철판 (용접 자국)
    o.save();
    var pg = o.createLinearGradient(0, -42, 0, -14);
    pg.addColorStop(0, '#d0703a'); pg.addColorStop(1, '#6a3012');
    o.fillStyle = pg;
    o.strokeStyle = '#1a0e08'; o.lineWidth = 2.5;
    o.beginPath(); o.moveTo(-6, -30); o.lineTo(44, -40); o.lineTo(66, -24); o.lineTo(58, -14); o.lineTo(6, -16); o.closePath(); o.fill(); o.stroke();
    o.strokeStyle = 'rgba(255,200,120,0.5)'; o.lineWidth = 1.2;
    o.beginPath(); o.moveTo(-2, -29); o.lineTo(43, -38); o.stroke();
    o.strokeStyle = 'rgba(40,20,10,0.7)'; o.lineWidth = 1;
    for (var wl = 0; wl < 7; wl++) { o.beginPath(); o.arc(2 + wl * 8, -15, 2.4, Math.PI, 0); o.stroke(); }
    o.fillStyle = '#2e2420';
    o.beginPath(); o.arc(8, -24, 2.4, 0, Math.PI * 2); o.arc(40, -32, 2.4, 0, Math.PI * 2); o.fill();
    o.restore();
    // 찢어진 귀
    o.fillStyle = '#2a1f1a';
    o.beginPath(); o.moveTo(-10, -26); o.lineTo(-30, -52); o.lineTo(-22, -40); o.lineTo(-18, -50); o.lineTo(4, -32); o.closePath(); o.fill();
    // 콧구멍 + 독 김
    o.fillStyle = '#0a0604';
    o.beginPath(); o.ellipse(82, -2, 3.5, 2.2, 0.4, 0, Math.PI * 2); o.fill();
    if (deadA > 0.5 && (P.tele > 0 || P.roar)) {
      var nt = (clock * 2.2) % 1;
      o.fillStyle = 'rgba(160,255,90,' + (0.4 * (1 - nt)).toFixed(3) + ')';
      o.beginPath(); o.arc(90 + nt * 20, -6 - nt * 10, 3 + nt * 7, 0, Math.PI * 2); o.fill();
    }
    // 눈 6개 (비대칭 무리)
    var ei = deadA > 0.3 ? gl : 0;
    if (deadA > 0.3) {
      if (P.tele > 0.2) {
        var eh = o.createRadialGradient(52, -18, 0, 52, -18, 34);
        eh.addColorStop(0, enr ? 'rgba(255,140,60,0.55)' : 'rgba(180,255,90,0.55)');
        eh.addColorStop(1, 'rgba(120,255,40,0)');
        o.fillStyle = eh;
        o.beginPath(); o.arc(52, -18, 34, 0, Math.PI * 2); o.fill();
      }
      bossEye(o, 56, -18, 5.5, ei, enr);
      bossEye(o, 44, -22, 4.2, ei, enr);
      bossEye(o, 66, -11, 3.6, ei, enr);
      bossEye(o, 34, -14, 3.2, ei, enr);
      bossEye(o, 50, -7, 2.8, ei, enr);
      bossEye(o, 62, -27, 2.4, ei, enr);
    } else {
      o.strokeStyle = '#0a0604'; o.lineWidth = 2;
      o.beginPath(); o.moveTo(40, -20); o.lineTo(62, -16); o.stroke();
    }
    // 휘청: 머리 위 별
    if (P.dizzy) {
      for (var ds = 0; ds < 3; ds++) {
        var da = clock * 5 + ds * 2.094;
        var sx = 30 + Math.cos(da) * 34, sy = -58 + Math.sin(da) * 9;
        o.fillStyle = ds === 1 ? TOXIC_HOT : '#ffd27a';
        o.beginPath();
        for (var sp = 0; sp < 8; sp++) {
          var rr = sp % 2 ? 2.4 : 6.5, aa = sp * Math.PI / 4 + clock * 3;
          if (sp === 0) o.moveTo(sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr); else o.lineTo(sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr);
        }
        o.closePath(); o.fill();
      }
    }
    o.restore();   // 머리
    o.restore();   // lean
  }

  function getOff(k) {
    if (typeof document === 'undefined') return null;
    if (!offCv) offCv = document.createElement('canvas');
    if (offK !== k) {
      offK = k;
      offCv.width = Math.ceil(OW * k);
      offCv.height = Math.ceil(OH * k);
    }
    return offCv;
  }

  function drawBoss(ctx, m, Pover) {
    var P = Pover || bossPose(m);
    var cx = bcx(m), base = m.y + m.h;
    var G0 = gy();

    // 바닥 그림자 (공중이면 작고 옅게)
    var hgt = Math.max(0, G0 - base);
    var s = clamp(1 - hgt / 1100, 0.2, 1);
    var sa = (P.dead > 0 ? 1 - P.dead : 1);
    var shg = ctx.createRadialGradient(cx, G0, 4, cx, G0, m.w * 0.7 * s);
    shg.addColorStop(0, 'rgba(0,0,0,' + (0.55 * s * sa).toFixed(3) + ')');
    shg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shg;
    ctx.beginPath(); ctx.ellipse(cx, G0, m.w * 0.7 * s, 16 * s, 0, 0, Math.PI * 2); ctx.fill();

    // 격노 오라
    if (m.enraged && sa > 0.5) {
      var ag = ctx.createRadialGradient(cx, base - m.h * 0.5, 20, cx, base - m.h * 0.5, m.w * 0.9);
      ag.addColorStop(0, 'rgba(255,90,42,' + (0.16 + 0.08 * Math.sin(clock * 8)).toFixed(3) + ')');
      ag.addColorStop(1, 'rgba(255,90,42,0)');
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(cx, base - m.h * 0.5, m.w * 0.9, 0, Math.PI * 2); ctx.fill();
    }

    // 돌진 잔상
    if (m.state === 'charge') {
      ctx.strokeStyle = 'rgba(141,255,60,0.35)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (var q = 0; q < 5; q++) {
        var ly = base - 30 - q * 28;
        var lx = cx - m.facing * (m.w * 0.5 + 10 + (q % 2) * 20);
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx - m.facing * (70 + q * 14), ly); ctx.stroke();
      }
    }

    var k = 1;
    try {
      if (ctx.getTransform) { var tr = ctx.getTransform(); k = Math.sqrt(tr.a * tr.a + tr.b * tr.b) || 1; }
    } catch (e) { k = 1; }
    k = clamp(Math.round(k * 4) / 4, 0.5, 2.5);
    var cv = getOff(k);
    var jx = 0, jy = 0;
    if (P.jit) { jx = Math.sin(clock * 93) * P.jit; jy = Math.cos(clock * 71) * P.jit * 0.6; }
    if (!cv) return;
    var o = cv.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';
    o.clearRect(0, 0, cv.width, cv.height);
    o.setTransform(k, 0, 0, k, OX * k, OY * k);
    o.scale(m.facing < 0 ? -1 : 1, 1);
    drawBossBody(o, m, P);
    // 덧칠: 예고 발광 / 격노 붉은 기 / 피격 플래시 (실루엣 내부만)
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-atop';
    if (P.tele > 0) {
      o.globalAlpha = 0.1 + 0.22 * P.tele;
      o.fillStyle = m.enraged ? RED : TOXIC;
      o.fillRect(0, 0, cv.width, cv.height);
    }
    if (m.enraged) {
      o.globalAlpha = 0.08 + 0.05 * Math.sin(clock * 8);
      o.fillStyle = RED;
      o.fillRect(0, 0, cv.width, cv.height);
    }
    if (m.hitFlash > 0) {
      o.globalAlpha = Math.min(1, m.hitFlash / 0.15) * 0.85;
      o.fillStyle = '#ffffff';
      o.fillRect(0, 0, cv.width, cv.height);
    }
    if (P.dead > 0) {
      // 녹아내리듯 어둡게
      o.globalAlpha = Math.min(1, P.dead * 1.2) * 0.6;
      o.fillStyle = '#0d1a05';
      o.fillRect(0, 0, cv.width, cv.height);
    }
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';

    var sink = P.dead > 0 ? easeOut(P.dead) * 26 : 0;
    ctx.globalAlpha = sa < 1 ? clamp(sa * 1.6, 0, 1) : 1;
    ctx.drawImage(cv, cx - OX + jx, base - OY + jy + sink, OW, OH);
    ctx.globalAlpha = 1;
  }

  // ---- 바닥 표식들 (보스 뒤)
  function renderBossUnder(ctx) {
    var G0 = gy();
    var i, f;
    var W = world();
    for (i = 0; i < bossFx.length; i++) {
      f = bossFx[i];
      if (f.kind === 'marker') {
        // 출현 예고: 하늘에서 내리꽂는 빛 + 지면 원
        var a = 0.5 + 0.5 * Math.sin(clock * 10);
        var bw = 120 + 60 * a;
        var bgr = ctx.createLinearGradient(0, G0 - 900, 0, G0);
        bgr.addColorStop(0, 'rgba(255,90,42,0)');
        bgr.addColorStop(1, 'rgba(255,90,42,' + (0.18 + 0.12 * a).toFixed(3) + ')');
        ctx.fillStyle = bgr;
        ctx.fillRect(f.x - bw / 2, G0 - 900, bw, 900);
        for (var rI = 0; rI < 3; rI++) {
          var rr = ((clock * 0.8 + rI / 3) % 1);
          ctx.strokeStyle = 'rgba(255,110,50,' + (0.8 * (1 - rr)).toFixed(3) + ')';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(f.x, G0 - 2, 40 + rr * 170, 6 + rr * 16, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,120,60,' + (0.6 + 0.4 * a).toFixed(3) + ')';
        ctx.font = 'bold 34px "Black Han Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠', f.x, G0 - 40);
      } else if (f.kind === 'puddle') {
        var pa = clamp((f.life - f.t) / 0.6, 0, 1) * clamp(f.t / 0.15, 0, 1);
        var pg = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, f.w / 2);
        pg.addColorStop(0, 'rgba(200,255,120,' + (0.85 * pa).toFixed(3) + ')');
        pg.addColorStop(0.6, 'rgba(141,255,60,' + (0.6 * pa).toFixed(3) + ')');
        pg.addColorStop(1, 'rgba(60,110,20,0)');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.ellipse(f.x, f.y - 2, f.w / 2, 9, 0, 0, Math.PI * 2); ctx.fill();
        for (var bI = 0; bI < 4; bI++) {
          var bt = (clock * 1.3 + bI * 0.27 + f.x * 0.01) % 1;
          ctx.strokeStyle = 'rgba(220,255,160,' + (0.7 * (1 - bt) * pa).toFixed(3) + ')';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(f.x - f.w * 0.35 + bI * f.w * 0.23, f.y - 4 - bt * 8, 2 + bt * 3, 0, Math.PI * 2); ctx.stroke();
        }
      } else if (f.kind === 'crack') {
        var ca = clamp(1 - f.t / f.life, 0, 1);
        ctx.strokeStyle = 'rgba(20,12,6,' + (0.85 * ca).toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (var cI = 0; cI < 9; cI++) {
          var sgn = cI % 2 ? 1 : -1;
          var len = f.w * 0.5 * (0.4 + ((cI * 37) % 10) / 16);
          ctx.moveTo(f.x, G0 - 1);
          ctx.lineTo(f.x + sgn * len * 0.5, G0 - 1 - ((cI * 13) % 5));
          ctx.lineTo(f.x + sgn * len, G0 - 1);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(141,255,60,' + (0.35 * ca).toFixed(3) + ')';
        ctx.fillRect(f.x - f.w * 0.3, G0 - 3, f.w * 0.6, 3);
      } else if (f.kind === 'glob') {
        // 착탄 지점 예고
        var gA = 0.5 + 0.5 * Math.sin(clock * 16);
        ctx.strokeStyle = 'rgba(141,255,60,' + (0.5 + 0.4 * gA).toFixed(3) + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(f.ax, f.ay - 2, 30 + 8 * gA, 7, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(f.ax - 10, f.ay - 2); ctx.lineTo(f.ax + 10, f.ay - 2); ctx.stroke();
      }
    }
    // 보스 상태별 예고
    var b = findBoss();
    if (!b) return;
    var cx = bcx(b);
    var tele = 0.5 + 0.5 * Math.sin(clock * 22);
    var dur = b.stateDur > 0 ? b.stateDur : 1;
    var prog = clamp(1 - b.stateTimer / dur, 0, 1);
    var col = b.enraged ? '255,90,42' : '255,150,60';
    if (b.state === 'charge_wind') {
      var x0 = cx + b.facing * b.w * 0.45;
      var len = Math.min(1300, b.facing > 0 ? W.width - x0 : x0);
      var x1 = x0 + b.facing * len * easeOut(prog * 1.6);
      var lg = ctx.createLinearGradient(x0, 0, x1, 0);
      lg.addColorStop(0, 'rgba(' + col + ',' + (0.45 + 0.25 * tele).toFixed(3) + ')');
      lg.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = lg;
      var hh = b.h * 0.9;
      ctx.fillRect(Math.min(x0, x1), G0 - hh, Math.abs(x1 - x0), hh);
      // 화살표 무늬
      ctx.strokeStyle = 'rgba(255,230,180,' + (0.55 + 0.35 * tele).toFixed(3) + ')';
      ctx.lineWidth = 5; ctx.lineJoin = 'round';
      for (var ch = 0; ch < 6; ch++) {
        var px = x0 + b.facing * (((clock * 260 + ch * 140) % 840) + 40);
        if ((px - x1) * b.facing > 0) continue;
        ctx.beginPath();
        ctx.moveTo(px - b.facing * 20, G0 - hh * 0.7); ctx.lineTo(px, G0 - hh * 0.45); ctx.lineTo(px - b.facing * 20, G0 - hh * 0.2);
        ctx.stroke();
      }
    } else if (b.state === 'slam_wind') {
      var zx = cx + b.facing * 70, zw = BOSS.slamZoneW;
      ctx.fillStyle = 'rgba(' + col + ',' + (0.18 + 0.22 * tele * prog).toFixed(3) + ')';
      ctx.fillRect(zx - zw / 2, G0 - BOSS.slamZoneH, zw, BOSS.slamZoneH);
      // 충격파가 지나갈 바닥선 (점프!)
      var reach = BOSS.waveRange * easeOut(prog * 1.3);
      var wg = ctx.createLinearGradient(zx - reach, 0, zx + reach, 0);
      wg.addColorStop(0, 'rgba(' + col + ',0)');
      wg.addColorStop(0.5, 'rgba(' + col + ',' + (0.7 * (0.5 + 0.5 * tele)).toFixed(3) + ')');
      wg.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = wg;
      ctx.fillRect(zx - reach, G0 - 8, reach * 2, 8);
      ctx.fillRect(zx - reach, G0 - BOSS.waveH, reach * 2, 2);
    } else if (b.state === 'leap_wind' || b.state === 'leap') {
      var la = 0.5 + 0.5 * tele;
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.6 + 0.4 * la).toFixed(3) + ')';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(b.aux, G0 - 2, 190, 18, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(' + col + ',' + (0.12 + 0.12 * la).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(b.aux, G0 - 2, 190 * (b.state === 'leap' ? 1 : prog), 18, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---- 공중 fx (보스 앞)
  function renderBossOver(ctx) {
    var G0 = gy();
    for (var i = 0; i < bossFx.length; i++) {
      var f = bossFx[i];
      if (f.kind === 'wave') {
        var fx = f.x0 + f.dir * f.r;
        var fade = clamp(1 - f.r / BOSS.waveRange, 0, 1);
        var H = BOSS.waveH * (0.6 + 0.4 * fade) + 8;
        var tail = 130;
        var g = ctx.createLinearGradient(fx - f.dir * tail, 0, fx, 0);
        g.addColorStop(0, 'rgba(201,180,138,0)');
        g.addColorStop(0.7, 'rgba(201,180,138,' + (0.75 * fade + 0.2).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(240,230,190,' + (0.9 * fade + 0.1).toFixed(3) + ')');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(fx - f.dir * tail, G0);
        ctx.quadraticCurveTo(fx - f.dir * 40, G0 - H * 0.4, fx - f.dir * 6, G0 - H);
        ctx.quadraticCurveTo(fx + f.dir * 10, G0 - H * 0.8, fx + f.dir * 12, G0);
        ctx.closePath(); ctx.fill();
        ctx.save();
        ctx.shadowColor = TOXIC; ctx.shadowBlur = 12;
        ctx.strokeStyle = 'rgba(141,255,60,' + (0.85 * fade + 0.15).toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(fx - f.dir * 60, G0 - H * 0.3);
        ctx.quadraticCurveTo(fx - f.dir * 20, G0 - H * 0.8, fx - f.dir * 6, G0 - H);
        ctx.stroke();
        ctx.restore();
        // 튀는 돌 조각
        ctx.fillStyle = '#5a4a3a';
        for (var rk = 0; rk < 4; rk++) {
          var rx = fx - f.dir * (10 + rk * 22);
          var ry = G0 - H * 0.6 - Math.abs(Math.sin(f.t * 14 + rk)) * 20;
          ctx.fillRect(rx - 3, ry - 3, 6 - rk % 2 * 2, 6 - rk % 2 * 2);
        }
      } else if (f.kind === 'glob' && f.delay <= 0) {
        for (var ti = 0; ti + 1 < f.trail.length; ti += 2) {
          var ta = ti / f.trail.length;
          ctx.fillStyle = 'rgba(141,255,60,' + (0.35 * ta).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(f.trail[ti], f.trail[ti + 1], BOSS.globR * (0.3 + 0.6 * ta), 0, Math.PI * 2); ctx.fill();
        }
        var gr = BOSS.globR;
        ctx.save();
        ctx.shadowColor = f.enr ? RED : TOXIC; ctx.shadowBlur = 16;
        var gg = ctx.createRadialGradient(f.x - 4, f.y - 4, 1, f.x, f.y, gr + 3);
        gg.addColorStop(0, '#f4ffd0');
        gg.addColorStop(0.45, f.enr ? '#d6ff5a' : TOXIC);
        gg.addColorStop(1, '#2f5a10');
        ctx.fillStyle = gg;
        var wob = Math.sin(f.t * 30) * 2;
        ctx.beginPath(); ctx.ellipse(f.x, f.y, gr + wob, gr - wob, Math.atan2(f.vy, f.vx), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (f.kind === 'roar') {
        var rp = f.t / f.life;
        for (var ri = 0; ri < 3; ri++) {
          var q = rp * 1.4 - ri * 0.18;
          if (q <= 0 || q >= 1) continue;
          ctx.strokeStyle = (f.red ? 'rgba(255,110,50,' : 'rgba(220,255,170,') + (0.7 * (1 - q)).toFixed(3) + ')';
          ctx.lineWidth = 5 * (1 - q) + 1;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 30 + q * 260, f.dir > 0 ? -0.9 : Math.PI - 0.9, f.dir > 0 ? 0.9 : Math.PI + 0.9);
          ctx.stroke();
        }
      } else if (f.kind === 'corpse') {
        var fake = { x: f.x - TYPES.boss.w / 2, y: G0 - TYPES.boss.h, w: TYPES.boss.w, h: TYPES.boss.h,
                     facing: f.facing, enraged: f.enr, animT: 0, vx: 0, vy: 0, hitFlash: 0,
                     state: 'dead', stateTimer: Math.max(0, f.life - f.t), stateDur: f.life };
        ctx.save();
        try { drawBoss(ctx, fake); } catch (e) { /* 무시 */ }
        ctx.restore();
      }
    }
  }
})();
