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
    behemoth: { w: 236, h: 164, speed: 120, hp: 850, dmg: 8, knockX: 520, knockY: -300, flying: false, boss: true },
    // 보스 '이끼 여왕' — 거대한 이끼 나방. 몸통(가슴+늘어진 배) 판정, 날개는 그림만
    mossqueen: { w: 150, h: 178, speed: 150, hp: 800, dmg: 8, knockX: 460, knockY: -320, flying: true, boss: true },
    // 보스 '강철 지네' — 판정은 머리+앞 몸통, 뒤따르는 마디는 접촉 피해만
    centipede: { w: 180, h: 92, speed: 170, hp: 850, dmg: 8, knockX: 480, knockY: -300, flying: false, boss: true },
    // 강철 지네가 격노 시 떼어 내는 마디 드론 (지면 몬스터)
    drone: { w: 38, h: 26, speed: 330, hp: 26, dmg: 7, knockX: 300, knockY: -220, flying: false },
    // 변이 두더지 — 땅속을 파고 다가와 발밑에서 솟구침 (땅속에선 무적)
    mole: { w: 56, h: 38, speed: 260, hp: 45, dmg: 13, knockX: 420, knockY: -640, flying: false }
  };
  var BOSS_ORDER = ['behemoth', 'mossqueen', 'centipede'];
  var BOSS_NAMES = { behemoth: '녹슨 거수', mossqueen: '이끼 여왕', centipede: '강철 지네' };
  var BOSS_SUBJ = { behemoth: '녹슨 거수가', mossqueen: '이끼 여왕이', centipede: '강철 지네가' };

  // ---------------------------------------------------------------- 보스 3 '강철 지네' 수치
  var CENTI = {
    hpMul: 1.0, segs: 15, segGap: 27,
    walk: 170, walkEnr: 235, cool: 1.3, enrMul: 0.7,
    contactDmg: 8, bodyDmg: 6, bodyCd: 0.9,
    burrowWind: 0.8, digSpd: 560, digMax: 1.6, eruptWind: 0.75, eruptDmg: 22, eruptW: 250, eruptH: 230, eruptVy: -1050,
    railWind: 0.9, railSpd: 1150, railSpdEnr: 1350, railT: 1.3, railDmg: 20, railKx: 900, railKy: -520,
    slagLife: 1.8, slagDmg: 4, slagTick: 0.5,
    sprayWind: 0.7, scraps: 6, scrapsEnr: 9, scrapDmg: 11, scrapT: 0.85, scrapR: 11, moltenLife: 1.6, moltenW: 70, moltenDmg: 4,
    whipWind: 0.75, whipDmg: 16, whipR: 340, whipH: 64,
    drones: 3, droneCd: 14, droneWind: 0.9, enrageTime: 1.3, introT: 2.2
  };

  // ---------------------------------------------------------------- 보스 2 '이끼 여왕' 수치
  var QUEEN = {
    hpMul: 0.92,            // 녹슨 거수 hp 대비 (공중이라 맞히기 조금 어려움)
    hoverY: 16,             // 평소 몸통 바닥 = 땅 - 16 (늘어진 배가 땅을 스침 → 지상 기술로 타격 가능)
    hoverHi: 150,           // 광선 시 몸통 바닥 높이
    fly: 150, flyEnr: 210, keepOff: 230,
    cool: 1.4, enrMul: 0.7,
    contactDmg: 8, contactCd: 1.0,
    diveWind: 0.9, diveT: 1.05, diveDmg: 20, diveKx: 820, diveKy: -520, diveZone: 260, diveRise: 230,
    sporeWind: 0.8, spores: 4, sporesEnr: 6, sporeDmg: 10, sporeFall: 0.95,
    cloudR: 92, cloudLife: 2.6, cloudDmg: 6, cloudTick: 0.5,
    beamWind: 1.1, beamT: 1.5, beamTEnr: 1.15, beamDmg: 14, beamSpan: 1100, beamH: 90, beamW: 46,
    summonWind: 1.0, crows: 2, crowsEnr: 3, summonCd: 15,
    gustWind: 0.85, darts: 7, dartDmg: 9, dartSpd: 980, gustRange: 620, gustKx: 980, gustDmg: 6,
    enrageTime: 1.3, introT: 2.2
  };
  // ---------------------------------------------------------------- 변이 두더지 수치
  var MOLE = {
    depth: 70,          // 땅속에 있을 때 몸통 윗면 = 땅 + depth (판정이 지면 기술에 닿지 않게)
    near: 40,           // |dx| 가 이보다 가까우면 솟구칠 준비
    windup: 0.6,        // 예고 (갈라짐 + 자갈)
    erupt: 0.35, eruptVy: -760,
    recover: 1.6,       // 솟구친 뒤 지상에 머무는 시간 (공격 가능)
    burrow: 0.45,       // 다시 파고드는 연출
    cd: 1.4,            // 다시 파고든 뒤 다음 솟구침까지 최소 간격
    bite: 0.22, biteVx: 320, biteMul: 0.6
  };
  // ---------------------------------------------------------------- 스테이지 (보스 처치마다 +1)
  var STAGE = { hpStep: 0.3, dmgStep: 0.15, bossHpStep: 0.25, spawnStep: 0.08, spawnMin: 0.6 };
  // 보스전 모드
  var RUSH = { first: 5, gap: 8, hpStep: 0.3 };

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
  var warnType = 'behemoth';      // 모든 클라이언트: 경고 중인 보스 종류
  var nextBossIdx = 0;            // 권한측: 다음 보스 (BOSS_ORDER 순환)
  var bossMode = false;           // 보스전 모드 (일반 돌연변이 없음)
  var bossesKilled = 0;
  var lastDeadPts = null;         // 강철 지네 사망 시 마디 위치 (시체 연출)
  var bossWarnNum = 0;            // 보스전: 몇 번째 보스인지 (경고 문구)
  // 발판 봉쇄
  var lockedPrev = false, lockAnim = 0, lockSince = 0;
  var toastQ = [], lastToastAt = -10;
  var stage = 1;
  var stageHudState = { shown: false, n: -1, pulse: false, boss: null };

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
  function toast(t) { lastToastAt = clock; if (typeof Game.toast === 'function') Game.toast(t); }
  // 보스 알림이 서로 덮어쓰지 않게 최소 간격을 두고 차례로 표시
  function queueToast(t) {
    if (!toastQ.length && clock - lastToastAt >= 1.5) toast(t);
    else toastQ.push(t);
  }
  function pumpToasts() {
    if (toastQ.length && clock - lastToastAt >= 1.5) toast(toastQ.shift());
  }
  function bossName(type) { return BOSS_NAMES[type] || BOSS_NAMES.behemoth; }

  // 경기 진행도 0..1 (약 3분에 최대 난이도)
  function difficulty() { return clamp(matchTime / 180, 0, 1); }

  // 스테이지 배율
  function stageHpMul() { return 1 + STAGE.hpStep * (stage - 1); }
  function stageDmgMul() { return 1 + STAGE.dmgStep * (stage - 1); }
  function stageBossHpMul() { return 1 + STAGE.bossHpStep * (stage - 1); }
  function stageSpawnMul() { return Math.max(STAGE.spawnMin, 1 - STAGE.spawnStep * (stage - 1)); }

  // 스테이지 변경 (모든 클라이언트). announce: 알림 토스트
  function setStage(n, announce) {
    n = Math.max(1, Math.floor(+n || 1));
    var changed = n !== stage;
    stage = n;
    Mutants.stage = stage;
    if (announce) queueToast('🏆 스테이지 ' + stage + ' 돌입!');
    if (changed) {
      stageHudState.pulse = true;
      if (Game.events && Game.events.emit) {
        try { Game.events.emit('stageChanged', { stage: stage }); } catch (e) { /* 무시 */ }
      }
    }
  }

  // ---------------------------------------------------------------- 생성
  function makeMutant(type, id, x, y) {
    var T = TYPES[type] || TYPES.rat;
    var m = makeBase(type, id, x, y, T);
    if (T.boss) {
      m.boss = true;
      m.name = bossName(type);
      m.sweep = 0;           // 이끼 여왕: 광선 진행 0..1 등 보조값
      m.ax0 = 0; m.ax1 = 0;  // 이끼 여왕: 광선 시작/끝 x
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
    var wm = Math.min(0.32, 0.08 + 0.14 * t + 0.03 * (stage - 1));   // 두더지: 적게 시작해서 점점 자주
    var r = Math.random() * (wr + wd + wc + wm);
    if (r < wr) return 'rat';
    if (r < wr + wd) return 'dog';
    if (r < wr + wd + wc) return 'crow';
    return 'mole';
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
    } else if (type === 'mole') {
      x = side < 0 ? rand(10, 60) : W.width - T.w - rand(10, 60);
      y = W.groundY + MOLE.depth;       // 땅속에서 등장
    } else {
      x = side < 0 ? rand(10, 60) : W.width - T.w - rand(10, 60);
      y = W.groundY - T.h - rand(0, 160); // 살짝 위에서 떨어지며 등장
    }
    var m = makeMutant(type, nextId++, x, y);
    m.facing = side < 0 ? 1 : -1;
    m.wanderDir = m.facing;
    // 스테이지 배율 (일반 돌연변이)
    m.hp = m.maxHp = Math.round(T.hp * stageHpMul());
    m.dmgMul = stageDmgMul();
    if (type === 'mole') { m.under = true; setState(m, 'under', 0); m.attackCd = rand(0.4, 0.9); }
    Mutants.list.push(m);
    var fy = type === 'mole' ? W.groundY - 6 : y + T.h / 2;
    particles(x + T.w / 2, fy, 18, type === 'mole' ? '#9a8460' : TOXIC, 220);
    send({ t: 'mutantFx', kind: 'spawn', id: m.id, x: Math.round(x + T.w / 2), y: Math.round(fy), gy: world().groundY });
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
    if (m.vy >= 0 && m.dropTimer <= 0 && W.platforms && !W.platformsLocked) {
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
    if (!m.onGround || world().platformsLocked) return;
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

  // ---------------------------------------------------------------- AI: 변이 두더지 (권한측)
  // under(땅속 이동, 무적) → windup(갈라짐 예고, 무적) → attack(솟구침) → recover(지상, 공격 가능, 근접 시 한 번 깨묾)
  // → burrow(파고듦) → under. 발판 무시, 땅만 다님.
  function moleGround(m, dt) {
    var W = world();
    m.vy += gravity() * dt;
    if (m.vy > 1600) m.vy = 1600;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.onGround = false;
    if (m.y + m.h >= W.groundY) { m.y = W.groundY - m.h; m.vy = 0; m.onGround = true; }
    if (m.x < 0) { m.x = 0; m.vx = 0; m.wanderDir = 1; }
    if (m.x + m.w > W.width) { m.x = W.width - m.w; m.vx = 0; m.wanderDir = -1; }
  }

  function moleSurface(m, vy) {
    m.under = false;
    m.y = world().groundY - m.h;
    m.vy = vy || 0;
    m.onGround = !vy;
  }

  function updateMole(m, dt) {
    var W = world();
    var G0 = W.groundY;
    var diff = difficulty();
    var spd = TYPES.mole.speed * (1 + 0.2 * diff);
    var tgt = nearestTarget(m);
    m.target = tgt;
    m.attackCd -= dt;
    var cx = m.x + m.w / 2;
    var dxT = 0, dyT = 0;
    if (tgt) {
      dxT = (tgt.x + tgt.w / 2) - cx;
      dyT = (tgt.y + tgt.h) - (m.y + m.h);
    }

    switch (m.state) {
      case 'under':
        m.under = true;
        m.vy = 0;
        m.y = G0 + MOLE.depth;
        if (!tgt) {
          m.wanderTimer -= dt;
          if (m.wanderTimer <= 0) { m.wanderDir = -m.wanderDir; m.wanderTimer = rand(1.5, 3.5); }
          m.vx = approach(m.vx, m.wanderDir * spd * 0.35, 1200, dt);
          m.facing = m.wanderDir;
        } else {
          m.facing = dxT >= 0 ? 1 : -1;
          var desired = Math.abs(dxT) > 6 ? m.facing * Math.min(spd, Math.abs(dxT) * 8) : 0;
          m.vx = approach(m.vx, desired, 1800, dt);
          if (Math.abs(dxT) < MOLE.near && m.attackCd <= 0) {
            m.vx = 0;
            setState(m, 'windup', MOLE.windup * (1 - 0.25 * diff));
          }
        }
        m.x += m.vx * dt;
        if (m.x < 0) { m.x = 0; m.vx = 0; m.wanderDir = 1; }
        if (m.x + m.w > W.width) { m.x = W.width - m.w; m.vx = 0; m.wanderDir = -1; }
        return;

      case 'windup':
        // 제자리에서 땅이 갈라짐 — 이 자리를 피하면 됨
        m.under = true;
        m.vx = 0; m.vy = 0;
        m.y = G0 + MOLE.depth;
        if (tgt && Math.abs(dxT) > 4) m.facing = dxT >= 0 ? 1 : -1;
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) {
          moleSurface(m, MOLE.eruptVy * (1 + 0.1 * diff));
          m.vx = m.facing * 40;
          setState(m, 'attack', MOLE.erupt);
        }
        return;

      case 'attack':
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) {
          m.bit = false;
          setState(m, 'recover', MOLE.recover * (1 - 0.3 * diff));
          m.stateDur = m.stateTimer;
        }
        break;

      case 'recover':
        m.vx = approach(m.vx, 0, 1400, dt);
        if (tgt && m.onGround) m.facing = dxT >= 0 ? 1 : -1;
        m.stateTimer -= dt;
        // 착지 후 붙어 있으면 한 번 깨묾
        if (!m.bit && m.onGround && tgt && (m.stateDur - m.stateTimer) > 0.35 && Math.abs(dxT) < m.w * 0.5 + 34 && Math.abs(dyT) < 50) {
          m.bit = true;
          m.resumeT = m.stateTimer;
          setState(m, 'bite', MOLE.bite);
          m.vx = m.facing * MOLE.biteVx;
          break;
        }
        if (m.stateTimer <= 0) setState(m, 'burrow', MOLE.burrow);
        break;

      case 'bite':
        m.vx = approach(m.vx, 0, 1600, dt);
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) setState(m, 'recover', Math.max(0.35, (m.resumeT || 0) - MOLE.bite));
        break;

      case 'burrow':
        m.vx = approach(m.vx, 0, 2000, dt);
        m.stateTimer -= dt;
        // 판정은 지상에 둔 채 그림만 가라앉음 (render 에서 땅 아래 잘라냄)
        m.sink = clamp(1 - m.stateTimer / MOLE.burrow, 0, 1);
        if (m.stateTimer <= 0) {
          m.sink = 0;
          m.under = true;
          m.y = G0 + MOLE.depth; m.vy = 0;
          m.attackCd = MOLE.cd * (1 - 0.4 * diff) + rand(0, 0.5);
          setState(m, 'under', 0);
          return;
        }
        break;

      case 'hurt':
        m.vx = approach(m.vx, 0, 900, dt);
        m.stateTimer -= dt;
        if (m.stateTimer <= 0) { m.bit = true; setState(m, 'recover', 0.5); m.stateDur = 0.5; }
        break;

      default:
        if (m.under) setState(m, 'under', 0);
        else { setState(m, 'recover', 0.5); m.stateDur = 0.5; }
    }
    moleGround(m, dt);
  }

  // 모든 클라이언트: 흙먼지/자갈/분출 연출 + 땅속 이동 흔적 (동기화된 state 기준)
  function moleFx(m, dt) {
    var G0 = gy(), cx = m.x + m.w / 2;
    var ps = m.prevState;
    if (ps !== m.state) {
      m.prevState = m.state;
      if (m.state === 'windup') {
        particles(cx, G0 - 4, 8, '#8a7a5a', 120);
      } else if (m.state === 'attack' && (ps === 'windup' || ps === 'under')) {
        particles(cx, G0 - 6, 26, '#9a8460', 380);
        particles(cx, G0 - 8, 10, '#5a4a3a', 300);
        particles(cx, G0 - 10, 10, TOXIC, 260);
        bossFx.push({ kind: 'crack', x: cx, w: 110, life: 1.3, t: 0 });
        shake(5);
      } else if (m.state === 'burrow') {
        particles(cx, G0 - 4, 14, '#9a8460', 220);
      } else if (m.state === 'under' && ps === 'burrow') {
        particles(cx, G0 - 4, 8, '#7a6a4a', 140);
      } else if (m.state === 'hurt' && (ps === 'under' || ps === 'windup')) {
        // 기절로 튀어나옴
        particles(cx, G0 - 6, 18, '#9a8460', 300);
        particles(cx, G0 - 10, 6, TOXIC, 200);
      }
    }
    var under = m.under || m.state === 'under' || m.state === 'windup';
    if (!m.trail) m.trail = [];
    if (under && m.state === 'under') {
      m.trailT = (m.trailT || 0) - dt;
      if (m.trailT <= 0 && Math.abs(m.vx) > 30) {
        m.trailT = 0.07;
        m.trail.push({ x: cx, t: clock });
        particles(cx - m.facing * 12, G0 - 3, 1, '#8a7a5a', 80);
      }
    } else if (m.state === 'windup') {
      m.dustT = (m.dustT || 0) - dt;
      if (m.dustT <= 0) { m.dustT = 0.05; particles(cx + rand(-22, 22), G0 - 3, 1, '#a89470', 150); }
    }
    while (m.trail.length && (clock - m.trail[0].t > 0.9 || m.trail.length > 24)) m.trail.shift();
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
      if (TYPES[s.type].boss && !bossMode) continue;   // 보스전이 아니면 보스 무시 (구버전 호스트 대비)
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
      m.under = !!s.u;
      if (s.dm) m.dmgMul = +s.dm;
      if (m.type === 'mole') m.sink = m.state === 'burrow' ? clamp(1 - m.stateTimer / MOLE.burrow, 0, 1) : 0;
      if (m.boss) {
        if (!m.enraged && s.enr) m.lagHp = m.hp;
        m.enraged = !!s.enr;
        m.stateDur = +s.sd || 0;
        m.aux = +s.aux || 0;
        m.ax0 = +s.a0 || 0; m.ax1 = +s.a1 || 0;
        m.name = bossName(m.type);
      }
      m.alive = true;
      next.push(m);
    }
    Mutants.list = next;
    if (typeof msg.st === 'number' && msg.st >= 1 && msg.st !== stage) setStage(msg.st, false);   // 늦게 들어온 게스트 동기화
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
    if (m.under) return;                      // 땅속 두더지는 무적
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
      if (m.state === 'leap' || m.state === 'intro' || m.state === 'dive' || m.state === 'dig' || m.state === 'erupt_wind' || m.state === 'erupt' || m.state === 'rail') return false;
      m.vx *= Math.exp(-12 * dt);
      if (m.type === 'mossqueen') { m.vy *= Math.exp(-8 * dt); queenPhysics(m, dt); }
      else if (m.type === 'centipede') centPhysics(m, dt);
      else bossPhysics(m, dt);
      return true;
    }
    if (m.type === 'mole' && m.under) {
      if (m.stunT > 0) {
        // 땅속에서 기절 → 지상으로 튀어나와 공격 가능
        moleSurface(m, -320);
        m.vx = 0;
        setState(m, 'hurt', 0.1);
      } else {
        m.vx = 0;               // 속박: 땅속에서 멈춤
        return true;
      }
    }
    if (m.stunT > 0 && m.state !== 'hurt') setState(m, 'hurt', 0.1);
    if (m.type === 'mole') {
      m.vx *= Math.exp(-12 * dt);
      moleGround(m, dt);
    } else if (m.type === 'crow') {
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
      if (m.under) s.u = 1;
      if (m.dmgMul && m.dmgMul !== 1) s.dm = Math.round(m.dmgMul * 100) / 100;
      if (m.boss) {
        s.enr = m.enraged ? 1 : 0;
        s.sd = Math.round(m.stateDur * 100) / 100;
        s.aux = Math.round(m.aux);
        if (m.type === 'mossqueen') { s.a0 = Math.round(m.ax0); s.a1 = Math.round(m.ax1); }
      }
      out.push(s);
    }
    send({ t: 'mutants', list: out, gy: world().groundY, st: stage });
  }

  // ---------------------------------------------------------------- 공격 판정 (모든 클라이언트)
  function checkAttack(m) {
    var biting = m.state === 'bite' && m.type === 'mole';
    if ((m.state !== 'attack' && !biting) || m.dmgCd > 0 || m.under) return;
    var P = Game.players || {};
    var me = P.local;
    if (!me || !me.alive) return;
    if (me.invulnTimer > 0) return;
    if (!rectHit(m, me)) return;
    var T = TYPES[m.type];
    var dir = (me.x + me.w / 2) >= (m.x + m.w / 2) ? 1 : -1;
    var mul = m.dmgMul || stageDmgMul();
    m.dmgCd = DMG_INTERVAL;
    if (typeof Game.damagePlayer === 'function') {
      if (biting) Game.damagePlayer(Math.round(T.dmg * MOLE.biteMul * mul), dir * T.knockX * 0.5, -260);
      else Game.damagePlayer(Math.round(T.dmg * mul), dir * T.knockX, T.knockY);
    }
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
  function bossMul(m) { return m.enraged ? (m.type === 'mossqueen' ? QUEEN.enrMul : (m.type === 'centipede' ? CENTI.enrMul : BOSS.enrMul)) : 1; }
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
    if (!bossMode) return;   // 보스전이 아니면 보스 연출·피해 모두 무시
    if (k === 'warn') {
      warnT = BOSS.warn;
      warnType = TYPES[msg.type] && TYPES[msg.type].boss ? msg.type : 'behemoth';
      if (typeof msg.n === 'number') bossWarnNum = msg.n;
      bossFx.push({ kind: 'marker', x: +msg.x || 0, life: BOSS.warn + 1.4, t: 0, type: warnType });
      queueToast('⚠ 보스 출현! — ' + bossName(warnType));
      shake(8);
    } else if (k === 'arrive') {
      // 이끼 여왕 도착: 날갯짓 돌풍 + 포자 폭발 (피해 없음)
      shake(18);
      particles(msg.x, G0 - (+msg.dy || 120), 46, TOXIC, 420);
      particles(msg.x, G0 - 20, 30, '#7fe0b8', 360);
      particles(msg.x, G0 - 10, 26, '#c9b48a', 300);
      bossFx.push({ kind: 'gustfx', x: +msg.x, y: G0 - (+msg.dy || 120), dir: 0, life: 1.1, t: 0 });
      for (i = bossFx.length - 1; i >= 0; i--) if (bossFx[i].kind === 'marker') bossFx.splice(i, 1);
    } else if (k === 'qdive') {
      shake(14);
      particles(msg.x, G0 - 12, 30, '#7fe0b8', 360);
      particles(msg.x, G0 - 20, 18, TOXIC, 260);
      bossFx.push({ kind: 'cloud', x: +msg.x, r: QUEEN.cloudR * 0.8, life: 1.4, t: 0, cd: {}, dmg: 0 });
    } else if (k === 'spores') {
      var sl = msg.list || [];
      for (i = 0; i < sl.length; i++) {
        bossFx.push({ kind: 'pod', x: +sl[i][0], sx: +sl[i][1], y0: G0 - (+sl[i][2]), delay: +sl[i][3] || 0,
                      fall: QUEEN.sporeFall, t: 0, ft: 0, hit: {}, enr: !!msg.enr, spin: Math.random() * 6 });
      }
    } else if (k === 'beam') {
      bossFx.push({ kind: 'beam', x0: +msg.x0, x1: +msg.x1, dur: +msg.dur || QUEEN.beamT, back: !!msg.back,
                    sy: G0 - (+msg.dy || 260), t: 0, hit: {}, hit2: {}, enr: !!msg.enr, scorch: [] });
    } else if (k === 'gust') {
      var gx = +msg.x, gdy = G0 - (+msg.dy || 120);
      shake(12);
      bossFx.push({ kind: 'gustfx', x: gx, y: gdy, dir: 0, life: 0.9, t: 0 });
      forVictims(function (p, key, isLocal) {
        var pcx = p.x + p.w / 2;
        if (Math.abs(pcx - gx) > QUEEN.gustRange || p.y + p.h < gdy - 160) return;
        var d = pcx >= gx ? 1 : -1;
        hurt(p, isLocal, QUEEN.gustDmg, d * QUEEN.gustKx, -360);
      });
      var dl = msg.list || [];
      for (i = 0; i < dl.length; i++) {
        bossFx.push({ kind: 'dart', x: +dl[i][0], y: G0 - (+dl[i][1]), vx: +dl[i][2], vy: +dl[i][3], t: 0, hit: {}, delay: +msg.delay || 0 });
      }
    } else if (k === 'dig') {
      // 강철 지네가 땅속으로 파고듦
      shake(10);
      particles(msg.x, G0 - 6, 34, '#c9b48a', 340);
      particles(msg.x, G0 - 10, 12, '#ff9a3a', 260);
      bossFx.push({ kind: 'crack', x: +msg.x, w: 200, life: 1.6, t: 0 });
    } else if (k === 'erupt') {
      shake(msg.dmg ? 24 : 16);
      particles(msg.x, G0 - 10, 46, '#c9b48a', 520);
      particles(msg.x, G0 - 30, 26, '#ff9a3a', 420);
      particles(msg.x, G0 - 20, 14, '#5a4a3a', 360);
      bossFx.push({ kind: 'crack', x: +msg.x, w: (+msg.w || 250) * 1.4, life: 2.0, t: 0 });
      if (+msg.dmg > 0) impactZone(msg.x - (+msg.w || 250) / 2, +msg.h || CENTI.eruptH, +msg.dmg, 600, -900, msg.x);
      for (i = bossFx.length - 1; i >= 0; i--) if (bossFx[i].kind === 'marker') bossFx.splice(i, 1);
    } else if (k === 'slag') {
      var sx0 = Math.min(+msg.x0, +msg.x1), sx1 = Math.max(+msg.x0, +msg.x1);
      if (sx1 - sx0 > 20) bossFx.push({ kind: 'slag', x0: sx0, x1: sx1, life: CENTI.slagLife, t: 0, cd: {} });
    } else if (k === 'scrap') {
      var cl = msg.list || [];
      for (i = 0; i < cl.length; i++) {
        bossFx.push({ kind: 'scrap', delay: +msg.delay || 0, x: +cl[i][0], y: G0 - (+cl[i][1]), vx: +cl[i][2], vy: +cl[i][3],
                      ax: +cl[i][4], t: 0, hit: {}, rot: Math.random() * 6, enr: !!msg.enr });
      }
    } else if (k === 'whip') {
      var wx = +msg.x, wr = +msg.r || CENTI.whipR, wh = +msg.h || CENTI.whipH;
      shake(14);
      bossFx.push({ kind: 'whipfx', x: wx, r: wr, dir: msg.dir === -1 ? -1 : 1, life: 0.55, t: 0 });
      particles(wx, G0 - 20, 24, '#ffcf7a', 420);
      var wz = { x: wx - wr, y: G0 - wh, w: wr * 2, h: wh };
      forVictims(function (p, key, isLocal) {
        if (!rectHit(wz, p)) return;
        var d = (p.x + p.w / 2) >= wx ? 1 : -1;
        hurt(p, isLocal, +msg.dmg || CENTI.whipDmg, d * 700, -560);
      });
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
      queueToast((BOSS_SUBJ[msg.type] || BOSS_SUBJ.behemoth) + ' 격노했다!');
      bossFx.push({ kind: 'roar', x: +msg.x, y: G0 - (+msg.dy || 150), dir: msg.dir === -1 ? -1 : 1, life: 1.4, t: 0, red: true });
      particles(msg.x, G0 - 100, 40, '#ff5a2a', 360);
    } else if (k === 'die') {
      var bx = +msg.x, by = G0 - (+msg.dy || 80);
      var deadPts = lastDeadPts; lastDeadPts = null;
      if (!local) {
        for (i = Mutants.list.length - 1; i >= 0; i--) if (Mutants.list[i].boss) { if (Mutants.list[i].segPts) deadPts = Mutants.list[i].segPts; Mutants.list.splice(i, 1); }
      }
      var dtp = TYPES[msg.type] && TYPES[msg.type].boss ? msg.type : 'behemoth';
      bossFx.push({ kind: 'corpse', type: dtp, pts: deadPts ? deadPts.map(function (q) { return { x: q.x, y: q.y, a: q.a }; }) : null, x: bx, y: by, facing: msg.facing === -1 ? -1 : 1, enr: !!msg.enr, life: 2.4, t: 0 });
      particles(bx, by, 60, TOXIC, 480);
      particles(bx, by, 30, dtp === 'mossqueen' ? '#7fe0b8' : (dtp === 'centipede' ? '#ff9a3a' : '#b5541c'), 360);
      particles(bx, by, 24, '#3f8f2a', 300);
      shake(30);
      var nm = msg.name || '누군가';
      queueToast(nm + ' 님이 보스를 처치했다! — ' + bossName(dtp));
      if (!local && msg.killer != null && msg.killer === myNetId()) emitKill('boss', msg.src || null);
      warnT = 0;
      if (typeof msg.count === 'number') bossesKilled = msg.count; else if (!local) bossesKilled++;
      Mutants.bossesKilled = bossesKilled;
      if (Game.events && Game.events.emit) Game.events.emit('bossDefeated', { type: dtp, count: bossesKilled, killer: msg.killer != null ? msg.killer : null });
      // 스테이지 +1 (모든 클라이언트; 권한측은 bossDie → bossEmit 로 여기 도달)
      setStage(typeof msg.count === 'number' ? msg.count + 1 : stage + 1, true);
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
  function nextBossType() { return BOSS_ORDER[nextBossIdx % BOSS_ORDER.length]; }

  function bossSchedule(dt) {
    if (findBoss()) return;
    bossTimer -= dt;
    if (!bossWarned && bossTimer <= BOSS.warn) {
      bossWarned = true;
      var ty = nextBossType();
      bossLandX = pickLandX(ty);
      bossEmit({ kind: 'warn', x: Math.round(bossLandX), type: ty, n: bossesKilled + 1 });
    }
    if (bossTimer <= 0) {
      spawnBoss(bossLandX, false, nextBossType());
    }
  }

  function pickLandX(type) {
    var W = world();
    var c = candidatePlayers();
    var half = (TYPES[type] || TYPES.behemoth).w / 2;
    var x = W.width / 2;
    if (c.length) {
      var s = 0;
      for (var i = 0; i < c.length; i++) s += c[i].x + c[i].w / 2;
      x = s / c.length + rand(-160, 160);
    }
    return clamp(x, half + 60, W.width - half - 60);
  }

  function bossHpFor(type) {
    var hp = BOSS.hpBase + BOSS.hpPer * combatants();
    if (type === 'mossqueen') hp *= QUEEN.hpMul;
    if (type === 'centipede') hp *= CENTI.hpMul;
    // 스테이지 배율 (보스전 모드도 이것만 — 예전 RUSH.hpStep × 처치 수 와 중복되지 않게 대체)
    hp *= stageBossHpMul();
    return Math.round(hp / 10) * 10;
  }

  function spawnBoss(x, instant, type) {
    if (!isAuthority() || !bossMode) return null;   // 보스는 「보스전」 모드에서만
    var old = findBoss();
    if (old) return old;
    if (!TYPES[type] || !TYPES[type].boss) type = nextBossType();
    // 순환: 방금 나온 종류 다음 것을 다음 보스로
    nextBossIdx = (BOSS_ORDER.indexOf(type) + 1) % BOSS_ORDER.length;
    var W = world();
    var T = TYPES[type];
    if (x == null) x = pickLandX(type);
    if (instant) {
      bossEmit({ kind: 'warn', x: Math.round(x), type: type, n: bossesKilled + 1 });
      warnT = 0;
    }
    var m;
    if (type === 'centipede') {
      m = makeMutant(type, nextId++, clamp(x - T.w / 2, 0, W.width - T.w), W.groundY + 40);
      m.launched = false;
      setBossState(m, 'intro', CENTI.introT);
      m.facing = Math.random() < 0.5 ? -1 : 1;
      m.hp = m.maxHp = m.lagHp = bossHpFor(type);
      Mutants.list.push(m);
      bossTimer = bossMode ? RUSH.gap : BOSS.respawn;
      bossWarned = false;
      return m;
    }
    if (type === 'mossqueen') {
      m = makeMutant(type, nextId++, clamp(x - T.w / 2, 0, W.width - T.w), W.groundY - T.h - 900);
      m.aux = W.groundY - T.h - QUEEN.hoverY;   // 도착 높이
      m.introY = m.y;
      setBossState(m, 'intro', QUEEN.introT);
    } else {
      m = makeMutant(type, nextId++, clamp(x - T.w / 2, 0, W.width - T.w), W.groundY - T.h - 1050);
      m.vy = 200;
      setBossState(m, 'intro', 3);
    }
    var hp = bossHpFor(type);
    m.hp = m.maxHp = m.lagHp = hp;
    m.facing = Math.random() < 0.5 ? -1 : 1;
    Mutants.list.push(m);
    bossTimer = bossMode ? RUSH.gap : BOSS.respawn;
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
    if (m.type === 'mossqueen') return { x: bcx(m) + m.facing * 10, y: m.y + 34 };
    if (m.type === 'centipede') { var hp0 = centHead(m); return { x: hp0.x + m.facing * 26, y: hp0.y - 4 }; }
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
    if (m.type === 'mossqueen') updateQueen(m, dt);
    else if (m.type === 'centipede') updateCenti(m, dt);
    else updateBehemoth(m, dt);
  }

  function updateBehemoth(m, dt) {
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

  // ================================================================ 보스 2 '이끼 여왕' AI (권한측)
  // 거대한 이끼 나방. 땅 바로 위를 맴돌며(늘어진 배가 땅을 스침) 지상전 위주 패턴:
  //  dive  : 표식 지점으로 U자 급강하 (몸통 접촉 20)   spores: 포자 폭탄 낙하 → 독 포자 구름
  //  beam  : 높이 떠올라 땅을 훑는 독성 광선 (점프로 회피)  summon: 까마귀 소환
  //  gust  : (격노 전용) 날개 돌풍으로 밀쳐내고 깃털 화살 부채꼴 발사
  function queenPhysics(m, dt) {
    var W = world();
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.onGround = false;
    if (m.y + m.h > W.groundY - 4) { m.y = W.groundY - 4 - m.h; if (m.vy > 0) m.vy = 0; }
    if (m.y < W.groundY - m.h - 700) m.y = W.groundY - m.h - 700;
    m.hitWall = 0;
    if (m.x < 0) { m.x = 0; m.hitWall = -1; if (m.vx < 0) m.vx = 0; }
    if (m.x + m.w > W.width) { m.x = W.width - m.w; m.hitWall = 1; if (m.vx > 0) m.vx = 0; }
  }

  // 목표 높이(몸통 바닥이 땅에서 alt 만큼 위)로 부드럽게
  function queenHoverTo(m, alt, dt, rate) {
    var ty = gy() - m.h - alt + Math.sin(clock * 2.2 + m.seed * 6) * 7;
    var want = (ty - m.y) * (rate || 4);
    m.vy = approach(m.vy, clamp(want, -520, 520), 2400, dt);
  }

  function countType(t) {
    var c = 0;
    for (var i = 0; i < Mutants.list.length; i++) if (Mutants.list[i].alive && Mutants.list[i].type === t) c++;
    return c;
  }

  function chooseQueenPattern(m, tgt) {
    var dist = tgt ? Math.abs((tgt.x + tgt.w / 2) - bcx(m)) : 600;
    var opts = [
      ['dive', dist > 200 ? 2.6 : 1.4],
      ['spores', 2.2],
      ['beam', dist < 700 ? 2.0 : 1.2],
      ['summon', (m.summonCd <= 0 && countType('crow') < 4 && aliveCount() < MAX_ALIVE + 2) ? 1.1 : 0]
    ];
    if (m.enraged) opts.push(['gust', dist < QUEEN.gustRange ? 2.6 : 1.0]);
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
    return 'dive';
  }

  function startQueenPattern(m, p, tgt) {
    var mul = bossMul(m);
    var W = world();
    m.lastPat = p;
    var tx = tgt ? tgt.x + tgt.w / 2 : bcx(m) + m.facing * 400;
    m.facing = tx >= bcx(m) ? 1 : -1;
    if (p === 'dive') {
      m.aux = clamp(tx, 120, W.width - 120);
      m.slam2 = false;
      setBossState(m, 'dive_wind', QUEEN.diveWind * mul);
    } else if (p === 'spores') {
      var dur = QUEEN.sporeWind * mul;
      setBossState(m, 'spore_wind', dur);
      var n = m.enraged ? QUEEN.sporesEnr : QUEEN.spores;
      var list = [];
      var bx = bcx(m), byd = Math.round(gy() - (m.y + m.h * 0.75));
      for (var i = 0; i < n; i++) {
        // 목표 주변 + 여왕 앞쪽으로 고르게 퍼짐 (한 곳은 정확히 목표 발밑)
        var off = i === 0 ? 0 : ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 170 + rand(-30, 30));
        var x = clamp(tx + off, 40, W.width - 40);
        list.push([Math.round(x), Math.round(bx + rand(-30, 30)), byd, Math.round((dur + i * 0.12) * 100) / 100]);
      }
      bossEmit({ kind: 'spores', list: list, enr: m.enraged ? 1 : 0 });
    } else if (p === 'beam') {
      var span = QUEEN.beamSpan;
      // 여왕 쪽에서 목표를 지나 반대편까지 훑음
      var a0 = clamp(tx - m.facing * span * 0.45, 30, W.width - 30);
      var a1 = clamp(tx + m.facing * span * 0.55, 30, W.width - 30);
      m.ax0 = a0; m.ax1 = a1;
      setBossState(m, 'beam_wind', QUEEN.beamWind * mul);
    } else if (p === 'summon') {
      setBossState(m, 'summon', QUEEN.summonWind * mul);
      m.summonCd = QUEEN.summonCd;
      var mp = mouthPos(m);
      bossEmit({ kind: 'roar', x: Math.round(mp.x), dy: Math.round(gy() - mp.y), dir: m.facing });
    } else if (p === 'gust') {
      setBossState(m, 'gust_wind', QUEEN.gustWind * mul);
    }
  }

  function summonCrows(m) {
    var n = m.enraged ? QUEEN.crowsEnr : QUEEN.crows;
    var mp = mouthPos(m);
    for (var i = 0; i < n; i++) {
      if (aliveCount() >= MAX_ALIVE + 4) break;
      var c = makeMutant('crow', nextId++, clamp(mp.x - 22 + (i - (n - 1) / 2) * 60, 0, world().width - 44), m.y - 40 - i * 20);
      c.facing = m.facing;
      c.vx = (i - (n - 1) / 2) * 260; c.vy = -220;
      Mutants.list.push(c);
      particles(c.x + 22, c.y + 15, 12, '#7fe0b8', 220);
      send({ t: 'mutantFx', kind: 'spawn', id: c.id, x: Math.round(c.x + 22), y: Math.round(c.y + 15), gy: gy() });
    }
  }

  function fireGust(m, tgt) {
    var cx = bcx(m), cy = m.y + m.h * 0.45;
    var G0 = gy();
    var n = QUEEN.darts;
    var list = [];
    var aimX = tgt ? tgt.x + tgt.w / 2 : cx + m.facing * 400;
    var base = Math.atan2(G0 - 30 - cy, aimX - cx);
    for (var i = 0; i < n; i++) {
      var a = base + (i - (n - 1) / 2) * 0.17;
      list.push([Math.round(cx), Math.round(G0 - cy), Math.round(Math.cos(a) * QUEEN.dartSpd), Math.round(Math.sin(a) * QUEEN.dartSpd)]);
    }
    bossEmit({ kind: 'gust', x: Math.round(cx), dy: Math.round(G0 - cy), list: list, delay: 0.18 });
  }

  function updateQueen(m, dt) {
    var mul = bossMul(m);
    var W = world();
    var tgt = nearestTarget(m);
    m.target = tgt;
    if (m.summonCd > 0) m.summonCd -= dt;
    var dxT = tgt ? (tgt.x + tgt.w / 2) - bcx(m) : 0;
    m.stateTimer -= dt;
    var done = m.stateTimer <= 0;
    var p = m.stateDur > 0 ? clamp(1 - m.stateTimer / m.stateDur, 0, 1) : 1;

    switch (m.state) {
      case 'intro':
        // 하늘에서 날개를 접고 내려와 정지
        var q = easeOut(p);
        var ny = m.introY + (m.aux - m.introY) * q;
        m.vy = (ny - m.y) / dt; m.y = ny; m.vx = 0;
        if (done) {
          m.vy = 0;
          bossEmit({ kind: 'arrive', x: Math.round(bcx(m)), dy: Math.round(gy() - (m.y + m.h * 0.4)) });
          setBossState(m, 'roar', BOSS.roarTime);
          var mp0 = mouthPos(m);
          bossEmit({ kind: 'roar', x: Math.round(mp0.x), dy: Math.round(gy() - mp0.y), dir: m.facing });
        }
        return;   // 위치 직접 계산 (물리 없음)

      case 'roar':
      case 'enrage':
        m.vx = approach(m.vx, 0, 1200, dt);
        queenHoverTo(m, QUEEN.hoverY + 30, dt);
        if (done) { setBossState(m, 'walk', 0); m.cool = 0.6; }
        break;

      case 'walk':
      case 'idle':
        m.state = 'walk';
        m.cool -= dt;
        var spd = m.enraged ? QUEEN.flyEnr : QUEEN.fly;
        if (tgt) {
          m.facing = dxT >= 0 ? 1 : -1;
          // 목표 옆 keepOff 지점을 맴돎 (붙어 있으면 살짝 물러남)
          var side = dxT >= 0 ? -1 : 1;
          var goal = (tgt.x + tgt.w / 2) + side * QUEEN.keepOff;
          var d = goal - bcx(m);
          var want = Math.abs(d) > 30 ? clamp(d * 1.6, -spd, spd) : 0;
          m.vx = approach(m.vx, want, 420, dt);
          if (m.cool <= 0) startQueenPattern(m, chooseQueenPattern(m, tgt), tgt);
        } else {
          m.vx = approach(m.vx, 0, 400, dt);
        }
        queenHoverTo(m, QUEEN.hoverY, dt);
        break;

      case 'dive_wind':
        // 뒤로 물러나며 떠오름 → 표식 지점으로 급강하 준비
        m.vx = approach(m.vx, -m.facing * 120, 900, dt);
        queenHoverTo(m, QUEEN.diveRise, dt, 5);
        if (done) {
          var sx = bcx(m), sy = m.y;
          m.d0x = sx; m.d0y = sy;
          m.d1x = clamp(m.aux + (m.aux - sx), m.w / 2, W.width - m.w / 2);
          m.d1y = sy;
          m.dmx = m.aux; m.dmy = gy() - 4 - m.h;
          m.diveHit = false;
          setBossState(m, 'dive', QUEEN.diveT * (m.enraged ? 0.85 : 1));
          shake(6);
        }
        break;

      case 'dive':
        // 2차 베지어: P(0.5) = 바닥점
        var t = p;
        var cxp = 2 * m.dmx - (m.d0x + m.d1x) / 2, cyp = 2 * m.dmy - (m.d0y + m.d1y) / 2;
        var u = 1 - t;
        var nx = u * u * m.d0x + 2 * u * t * cxp + t * t * m.d1x;
        var ny2 = u * u * m.d0y + 2 * u * t * cyp + t * t * m.d1y;
        m.vx = (nx - m.w / 2 - m.x) / dt; m.vy = (ny2 - m.y) / dt;
        m.x = clamp(nx - m.w / 2, 0, W.width - m.w); m.y = Math.min(ny2, gy() - 4 - m.h);
        m.facing = m.d1x >= m.d0x ? 1 : -1;
        if (!m.diveHit && t >= 0.5) {
          m.diveHit = true;
          bossEmit({ kind: 'qdive', x: Math.round(bcx(m)) });
        }
        if (Math.random() < 0.5) particles(bcx(m) - m.facing * 50, m.y + m.h * 0.5, 2, '#7fe0b8', 140);
        if (done) {
          if (m.enraged && !m.slam2 && tgt) {
            // 격노: 바로 한 번 더
            m.slam2 = true;
            m.aux = clamp(tgt.x + tgt.w / 2, 120, W.width - 120);
            m.facing = m.aux >= bcx(m) ? 1 : -1;
            setBossState(m, 'dive_wind', 0.45);
          } else {
            setBossState(m, 'recover', 0.8 * mul);
          }
        }
        return;   // 위치 직접 계산

      case 'spore_wind':
        m.vx = approach(m.vx, 0, 900, dt);
        queenHoverTo(m, QUEEN.hoverY + 40, dt);
        if (done) setBossState(m, 'spore', 0.6);
        break;

      case 'spore':
        queenHoverTo(m, QUEEN.hoverY + 40, dt);
        if (done) setBossState(m, 'recover', 0.6 * mul);
        break;

      case 'beam_wind':
        m.vx = approach(m.vx, 0, 900, dt);
        queenHoverTo(m, QUEEN.hoverHi, dt, 5);
        if (done) {
          var bd = m.enraged ? QUEEN.beamTEnr : QUEEN.beamT;
          var mpb = mouthPos(m);
          bossEmit({ kind: 'beam', x0: Math.round(m.ax0), x1: Math.round(m.ax1), dur: bd, back: m.enraged ? 1 : 0,
                     dy: Math.round(gy() - mpb.y), enr: m.enraged ? 1 : 0 });
          setBossState(m, 'beam', bd * (m.enraged ? 2 : 1));
        }
        break;

      case 'beam':
        m.vx = approach(m.vx, 0, 900, dt);
        queenHoverTo(m, QUEEN.hoverHi, dt, 5);
        // 광선 끝점 쪽으로 몸을 돌림
        if (done) setBossState(m, 'recover', 0.7 * mul);
        break;

      case 'summon':
        m.vx = approach(m.vx, 0, 900, dt);
        queenHoverTo(m, QUEEN.hoverY + 60, dt);
        if (done) { summonCrows(m); setBossState(m, 'recover', 0.5); }
        break;

      case 'gust_wind':
        m.vx = approach(m.vx, 0, 900, dt);
        queenHoverTo(m, QUEEN.hoverY + 70, dt);
        if (done) { fireGust(m, tgt); setBossState(m, 'gust', 0.55); }
        break;

      case 'gust':
        queenHoverTo(m, QUEEN.hoverY + 70, dt);
        if (done) setBossState(m, 'recover', 0.6 * mul);
        break;

      case 'recover':
        m.vx = approach(m.vx, 0, 700, dt);
        queenHoverTo(m, QUEEN.hoverY, dt);
        if (done) { setBossState(m, 'walk', 0); m.cool = QUEEN.cool * mul; }
        break;

      default:
        setBossState(m, 'walk', 0);
    }
    queenPhysics(m, dt);
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
    if (m.type === 'centipede' && (m.state === 'dig' || m.state === 'erupt_wind')) return;   // 땅속
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
      if (m.state !== 'leap' && m.state !== 'charge' && m.state !== 'dive' && m.state !== 'beam') {
        m.vx = 0;
        setBossState(m, 'enrage', m.type === 'mossqueen' ? QUEEN.enrageTime : (m.type === 'centipede' ? CENTI.enrageTime : BOSS.enrageTime));
      }
      m.cool = 0.4;
      var mp = mouthPos(m);
      bossEmit({ kind: 'enrage', x: Math.round(mp.x), dy: Math.round(gy() - mp.y), dir: m.facing, type: m.type });
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
    bossesKilled++;
    Mutants.bossesKilled = bossesKilled;
    bossTimer = bossMode ? RUSH.gap : BOSS.respawn;
    lastDeadPts = m.segPts || null;
    bossWarned = false;
    bossEmit({ kind: 'die', x: Math.round(cx), dy: Math.round(gy() - cy), killer: killer, name: name, type: m.type, count: bossesKilled,
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
  }

  // ---- 접촉 피해 (로컬: 모든 클라이언트 / 봇: 권한측)
  function checkBossContact(m, dt) {
    if (m.type === 'centipede') { centContact(m, dt); return; }
    if (m.state === 'intro' || m.state === 'leap') return;   // 낙하·도약 착지는 충격 범위 판정으로 처리
    var Q = m.type === 'mossqueen';
    var charging = m.state === (Q ? 'dive' : 'charge');
    var box = Q ? { x: m.x + 14, y: m.y + 10, w: m.w - 28, h: m.h - 14 } : { x: m.x + 10, y: m.y + 16, w: m.w - 20, h: m.h - 16 };
    var T = TYPES[m.type] || TYPES.behemoth;
    for (var k in m.botCd) if (m.botCd[k] > 0) m.botCd[k] -= dt;
    forVictims(function (p, key, isLocal) {
      if (!rectHit(box, p)) return;
      var cd = isLocal ? m.dmgCd : (m.botCd[key] || 0);
      if (cd > 0) return;
      var dir = (p.x + p.w / 2) >= bcx(m) ? 1 : -1;
      var ok;
      if (charging && Q) ok = hurt(p, isLocal, QUEEN.diveDmg, (m.vx >= 0 ? 1 : -1) * QUEEN.diveKx, QUEEN.diveKy);
      else if (charging) ok = hurt(p, isLocal, BOSS.chargeDmg, m.facing * BOSS.chargeKx, BOSS.chargeKy);
      else ok = hurt(p, isLocal, BOSS.contactDmg, dir * T.knockX, T.knockY);
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
        if (f.vy > 0 && W.platforms && !W.platformsLocked) {
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
      } else if (f.kind === 'slag') {
        // 레일 돌진 자국: 녹은 쇳물 띠
        var sz = { x: f.x0, y: G0 - 14, w: f.x1 - f.x0, h: 14 };
        for (var sk in f.cd) if (f.cd[sk] > 0) f.cd[sk] -= dt;
        forVictims(function (p, key, isLocal) {
          if ((f.cd[key] || 0) > 0 || !rectHit(sz, p)) return;
          f.cd[key] = CENTI.slagTick;
          hurt(p, isLocal, CENTI.slagDmg, 0, -160);
        });
        if (Math.random() < 0.5) particles(rand(f.x0, f.x1), G0 - 3, 1, Math.random() < 0.5 ? '#ffcf7a' : '#ff7a2a', 120);
        if (f.t >= f.life) alive = false;
      } else if (f.kind === 'scrap') {
        if (f.delay > 0) { f.delay -= dt; keep.push(f); continue; }
        var sg = gravity() * 0.5;
        f.vy += sg * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += dt * 12;
        forVictims(function (p, key, isLocal) {
          if (f.hit[key]) return;
          var nx = clamp(f.x, p.x, p.x + p.w), ny = clamp(f.y, p.y, p.y + p.h);
          var dx = f.x - nx, dy = f.y - ny;
          if (dx * dx + dy * dy > CENTI.scrapR * CENTI.scrapR) return;
          f.hit[key] = true;
          hurt(p, isLocal, CENTI.scrapDmg, (f.vx >= 0 ? 1 : -1) * 320, -340);
          particles(f.x, f.y, 8, '#ffcf7a', 220);
        });
        if (f.y >= G0) {
          alive = false;
          particles(f.x, G0 - 4, 12, '#ff9a3a', 240);
          keep.push({ kind: 'molten', x: f.x, w: CENTI.moltenW, life: CENTI.moltenLife, t: 0, cd: {} });
        }
        if (f.t > 4) alive = false;
      } else if (f.kind === 'molten') {
        var mz = { x: f.x - f.w / 2, y: G0 - 14, w: f.w, h: 14 };
        for (var mk2 in f.cd) if (f.cd[mk2] > 0) f.cd[mk2] -= dt;
        forVictims(function (p, key, isLocal) {
          if ((f.cd[key] || 0) > 0 || !rectHit(mz, p)) return;
          f.cd[key] = CENTI.slagTick;
          hurt(p, isLocal, CENTI.moltenDmg, 0, -140);
        });
        if (f.t >= f.life) alive = false;
      } else if (f.kind === 'pod') {
        // 포자 폭탄: 여왕 몸에서 떨어져 표식 지점으로 낙하 → 포자 구름
        if (f.delay > 0) { f.delay -= dt; keep.push(f); continue; }
        f.ft += dt;
        var pq = clamp(f.ft / f.fall, 0, 1);
        var ox2 = f.cx != null ? f.cx : f.sx, oy2 = f.cy != null ? f.cy : f.y0;
        f.cx = f.sx + (f.x - f.sx) * easeOut(pq);
        f.cy = f.y0 + (G0 - f.y0) * pq * pq;
        f.vx2 = (f.cx - ox2) / dt; f.vy2 = (f.cy - oy2) / dt;
        forVictims(function (p, key, isLocal) {
          if (f.hit[key]) return;
          var nx = clamp(f.cx, p.x, p.x + p.w), ny = clamp(f.cy, p.y, p.y + p.h);
          var dx = f.cx - nx, dy = f.cy - ny;
          if (dx * dx + dy * dy > 18 * 18) return;
          f.hit[key] = true;
          hurt(p, isLocal, QUEEN.sporeDmg, (p.x + p.w / 2 >= f.cx ? 1 : -1) * 260, -300);
        });
        if (pq >= 1) {
          alive = false;
          particles(f.x, G0 - 10, 18, '#c6ff7a', 260);
          particles(f.x, G0 - 16, 10, '#b28cff', 180);
          shake(3);
          keep.push({ kind: 'cloud', x: f.x, r: QUEEN.cloudR, life: QUEEN.cloudLife * (f.enr ? 1.25 : 1), t: 0, cd: {}, dmg: QUEEN.cloudDmg });
        }
      } else if (f.kind === 'cloud') {
        if (f.dmg > 0 && f.t > 0.15) {
          var cz = { x: f.x - f.r, y: G0 - f.r * 1.05, w: f.r * 2, h: f.r * 1.05 };
          for (var ck2 in f.cd) if (f.cd[ck2] > 0) f.cd[ck2] -= dt;
          forVictims(function (p, key, isLocal) {
            if ((f.cd[key] || 0) > 0 || !rectHit(cz, p)) return;
            f.cd[key] = QUEEN.cloudTick;
            hurt(p, isLocal, f.dmg, 0, -100);
          });
        }
        if (f.t >= f.life) alive = false;
      } else if (f.kind === 'beam') {
        // 독성 광선: 땅을 따라 x0 → x1 (격노: 되돌아오기까지)
        var bt = f.t / f.dur;
        var total = f.back ? 2 : 1;
        if (bt >= total) { alive = false; }
        else {
          var fwd = bt < 1;
          var bp = fwd ? bt : 2 - bt;
          f.bx = f.x0 + (f.x1 - f.x0) * bp;
          var hz = { x: f.bx - QUEEN.beamW / 2, y: G0 - QUEEN.beamH, w: QUEEN.beamW, h: QUEEN.beamH };
          var hset = fwd ? f.hit : f.hit2;
          forVictims(function (p, key, isLocal) {
            if (hset[key] || !rectHit(hz, p)) return;
            hset[key] = true;
            hurt(p, isLocal, QUEEN.beamDmg, ((f.x1 - f.x0) >= 0 ? 1 : -1) * (fwd ? 1 : -1) * 380, -520);
          });
          if (!f.lastScorch || Math.abs(f.bx - f.lastScorch) > 26) { f.lastScorch = f.bx; f.scorch.push(f.bx, f.t); }
          if (Math.random() < 0.8) particles(f.bx + rand(-12, 12), G0 - 6, 1, Math.random() < 0.5 ? '#e6ff9a' : '#ff5ad2', 220);
        }
        if (!alive) {
          // 그을음 자국은 잠시 남김
          keep.push({ kind: 'scorch', list: f.scorch, life: 1.6, t: 0 });
        }
      } else if (f.kind === 'dart') {
        if (f.delay > 0) { f.delay -= dt; keep.push(f); continue; }
        f.x += f.vx * dt; f.y += f.vy * dt;
        forVictims(function (p, key, isLocal) {
          if (f.hit[key]) return;
          if (f.x < p.x - 6 || f.x > p.x + p.w + 6 || f.y < p.y - 6 || f.y > p.y + p.h + 6) return;
          f.hit[key] = true;
          hurt(p, isLocal, QUEEN.dartDmg, (f.vx >= 0 ? 1 : -1) * 300, -260);
          particles(f.x, f.y, 6, '#c6ff7a', 160);
        });
        if (f.y >= G0 - 2) {
          alive = false;
          particles(f.x, G0 - 4, 5, '#c9b48a', 120);
          keep.push({ kind: 'stuck', x: f.x, a: Math.atan2(f.vy, f.vx), life: 1.4, t: 0 });
        }
        if (f.t > 3 || f.x < -50 || f.x > W.width + 50) alive = false;
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
        '#boss-hud.queen .bh-name{color:#e6d4ff;text-shadow:0 0 8px rgba(190,120,255,.55),0 2px 0 #2a1a40}',
        '#boss-hud.queen .bh-bar{border-color:#7a5ab8}',
        '#boss-hud.queen .bh-fill{background:repeating-linear-gradient(115deg,rgba(255,255,255,.10) 0 6px,rgba(0,0,0,0) 6px 14px),linear-gradient(180deg,#d8ffb0,#7fe0b8 40%,#3c6a58)}',
        '#boss-hud.queen.enr .bh-fill{background:repeating-linear-gradient(115deg,rgba(255,255,255,.12) 0 6px,rgba(0,0,0,0) 6px 14px),linear-gradient(180deg,#ffb0e0,#ff5ad2 45%,#6a1a5a);box-shadow:0 0 12px rgba(255,90,210,.7)}',
        '#boss-hud.centi .bh-name{color:#ffd9a0;text-shadow:0 0 8px rgba(255,140,40,.6),0 2px 0 #1a1f1e}',
        '#boss-hud.centi .bh-bar{border-color:#8a949a}',
        '#boss-hud.centi .bh-fill{background:repeating-linear-gradient(115deg,rgba(255,255,255,.10) 0 6px,rgba(0,0,0,0) 6px 14px),linear-gradient(180deg,#ffe2a0,#ff9a3a 40%,#7a3a14)}',
        '#boss-hud.centi.enr .bh-fill{background:repeating-linear-gradient(115deg,rgba(255,255,255,.12) 0 6px,rgba(0,0,0,0) 6px 14px),linear-gradient(180deg,#fff0c0,#ff3a1a 45%,#5a0a04);box-shadow:0 0 12px rgba(255,60,20,.8)}',
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
    if (showWarn && hudState.wtype !== warnType + bossWarnNum) {
      hudState.wtype = warnType + bossWarnNum;
      warnEl.innerHTML = '⚠ 보스 출현! <small>' + (bossMode && bossWarnNum ? '보스전 ' + bossWarnNum + '번째 · ' : '') + bossName(warnType) + '</small>';
    }
    if (showWarn !== hudState.warn) { hudState.warn = showWarn; warnEl.hidden = !showWarn; }
    if (!b) {
      if (hudState.shown) { hudState.shown = false; hudEl.hidden = true; }
      return;
    }
    if (!hudState.shown) { hudState.shown = true; hudEl.hidden = false; hudState.ratio = -1; }
    if (hudState.type !== b.type) {
      hudState.type = b.type;
      hudName.textContent = bossName(b.type);
      if (hudEl.classList) hudEl.classList.toggle('queen', b.type === 'mossqueen');
      if (hudEl.classList) hudEl.classList.toggle('centi', b.type === 'centipede');
      hudState.ratio = -1;
    }
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

  // ---------------------------------------------------------------- 스테이지 배지 (모든 클라이언트)
  // 위쪽 가운데. 보스 체력바(#boss-hud)가 보이면 그 아래로 내려감 (좁은 화면에선 보스바가 아래쪽이라 그대로)
  var stageEl = null, stageNumEl = null;

  function ensureStageHud() {
    if (stageEl) return true;
    if (typeof document === 'undefined' || !document.getElementById) return false;
    var hud = document.getElementById('hud');
    if (!hud) return false;
    if (!document.getElementById('stage-hud-style')) {
      var st = document.createElement('style');
      st.id = 'stage-hud-style';
      st.textContent = [
        '#stage-hud{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:3;pointer-events:none;display:flex;align-items:baseline;gap:6px;padding:3px 12px 4px;border-radius:4px;' +
          'background:repeating-linear-gradient(115deg,rgba(255,255,255,.04) 0 6px,rgba(0,0,0,0) 6px 14px),linear-gradient(180deg,rgba(46,52,51,.88),rgba(26,31,30,.88));' +
          'border:2px solid #b5541c;box-shadow:inset 0 0 10px rgba(90,42,16,.6),0 0 0 1px #2e3433,0 0 12px rgba(141,255,60,.18),0 4px 10px rgba(0,0,0,.45);' +
          'font-family:var(--font-title,sans-serif);white-space:nowrap;transition:top .25s ease}',
        '#stage-hud[hidden]{display:none}',
        '#stage-hud .sg-k{font-family:var(--font-body,sans-serif);font-size:.66rem;font-weight:900;letter-spacing:.22em;color:#e07a35;text-shadow:0 1px 0 #3a1408}',
        '#stage-hud .sg-n{font-size:1.15rem;letter-spacing:.06em;color:#c8ff7a;text-shadow:0 0 8px rgba(141,255,60,.75),0 2px 0 #1a2a0a}',
        '#stage-hud.bossup{top:64px}',
        '#stage-hud.pulse{animation:sgPulse .9s ease-out 1}',
        '@keyframes sgPulse{0%{transform:translateX(-50%) scale(1);box-shadow:inset 0 0 10px rgba(90,42,16,.6),0 0 0 1px #2e3433,0 0 0 rgba(141,255,60,0)}' +
          '25%{transform:translateX(-50%) scale(1.35);box-shadow:inset 0 0 10px rgba(90,42,16,.6),0 0 0 1px #2e3433,0 0 26px rgba(141,255,60,.95)}' +
          '100%{transform:translateX(-50%) scale(1);box-shadow:inset 0 0 10px rgba(90,42,16,.6),0 0 0 1px #2e3433,0 0 12px rgba(141,255,60,.18)}}',
        '@media (max-width:760px){#stage-hud.bossup{top:12px}}',
        '@media (max-width:480px){#stage-hud,#stage-hud.bossup{top:8px;padding:2px 8px 3px;gap:4px}#stage-hud .sg-k{font-size:.56rem;letter-spacing:.14em}#stage-hud .sg-n{font-size:.95rem}}'
      ].join('\n');
      (document.head || document.body).appendChild(st);
    }
    stageEl = document.createElement('div');
    stageEl.id = 'stage-hud';
    stageEl.hidden = true;
    stageEl.innerHTML = '<span class="sg-k">STAGE</span><span class="sg-n">1</span>';
    hud.appendChild(stageEl);
    stageNumEl = stageEl.querySelector('.sg-n');
    if (stageEl.addEventListener) stageEl.addEventListener('animationend', function () { if (stageEl.classList) stageEl.classList.remove('pulse'); });
    return true;
  }

  // b: 현재 보스 (없으면 null). Game.running 이 false 면 숨김
  function stageHudSync(b) {
    if (!ensureStageHud()) return;
    var show = Game.running !== false;
    if (show !== stageHudState.shown) { stageHudState.shown = show; stageEl.hidden = !show; }
    if (!show) return;
    if (stageHudState.n !== stage) {
      stageHudState.n = stage;
      stageNumEl.textContent = String(stage);
    }
    var bu = !!b;
    if (bu !== stageHudState.boss) {
      stageHudState.boss = bu;
      if (stageEl.classList) stageEl.classList.toggle('bossup', bu);
    }
    if (stageHudState.pulse) {
      stageHudState.pulse = false;
      if (stageEl.classList) {
        stageEl.classList.remove('pulse');
        void stageEl.offsetWidth;     // 애니메이션 다시 시작
        stageEl.classList.add('pulse');
      }
    }
  }

  // ---------------------------------------------------------------- 발판 봉쇄 (모든 클라이언트)
  // 보스가 살아 있는 동안 (등장 연출 포함) Game.world.platformsLocked = true.
  // 물리(한 방향 발판 무시)는 world.js 가 담당, 여기선 플래그 + 시각효과 + 알림.
  function setLock(on, silent) {
    var W = Game.world;
    if (W) W.platformsLocked = !!on;
    if (on === lockedPrev) return;
    lockedPrev = !!on;
    if (silent) { lockAnim = on ? 1 : 0; return; }
    if (on) {
      lockSince = clock;
      queueToast('⚠ 보스 출현 — 발판이 봉쇄되었습니다!');
      shake(6);
      var pl = (W && W.platforms) || [];
      for (var i = 0; i < pl.length; i++) {
        if (pl[i]) particles(pl[i].x + pl[i].w / 2, pl[i].y - 4, 6, '#ff3a3a', 200);
      }
    } else {
      queueToast('발판 봉쇄 해제');
    }
  }

  // 발판 위 봉쇄 표시: 붉은 경고 줄무늬 + 에너지 장벽 + ⛔ 깜빡임
  function renderPlatformLock(ctx) {
    if (lockAnim <= 0) return;
    var W = world();
    var pl = W.platforms || [];
    var a = lockAnim;
    var t = clock;
    var flick = 0.75 + 0.25 * Math.sin(t * 9) * Math.sin(t * 23.7);
    ctx.save();
    for (var i = 0; i < pl.length; i++) {
      var p = pl[i];
      if (!p) continue;
      var x = p.x, y = p.y, w = p.w;
      // 바닥 쪽으로 번지는 에너지 장벽 (발판 위로 솟는 붉은 막)
      var hh = 34 * a;
      var g = ctx.createLinearGradient(0, y - hh, 0, y);
      g.addColorStop(0, 'rgba(255,40,40,0)');
      g.addColorStop(1, 'rgba(255,50,40,' + (0.42 * a * flick).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(x, y - hh, w, hh);
      // 세로 스캔 줄
      ctx.fillStyle = 'rgba(255,120,110,' + (0.35 * a * flick).toFixed(3) + ')';
      var off = (t * 40) % 18;
      for (var sx = x + off; sx < x + w; sx += 18) ctx.fillRect(sx, y - hh * 0.85, 1.5, hh * 0.85);
      // 윗면 경고 줄무늬 (빨강/검정 사선)
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y - 3, w, 9); ctx.clip();
      ctx.fillStyle = 'rgba(20,6,6,' + (0.85 * a).toFixed(3) + ')';
      ctx.fillRect(x, y - 3, w, 9);
      ctx.fillStyle = 'rgba(255,50,40,' + (0.95 * a).toFixed(3) + ')';
      var so = (t * 30) % 16;
      for (var k = x - 16 + so; k < x + w + 16; k += 16) {
        ctx.beginPath();
        ctx.moveTo(k, y + 6); ctx.lineTo(k + 8, y + 6); ctx.lineTo(k + 14, y - 3); ctx.lineTo(k + 6, y - 3);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // 윗선 발광
      ctx.shadowColor = '#ff2a2a'; ctx.shadowBlur = 10 * a;
      ctx.fillStyle = 'rgba(255,90,80,' + (0.9 * a * flick).toFixed(3) + ')';
      ctx.fillRect(x, y - 4, w, 2);
      ctx.fillRect(x, y - hh, w, 1);
      ctx.shadowBlur = 0;
      // 양 끝 기둥 + 가운데 ⛔ 표시 (깜빡임)
      ctx.fillStyle = 'rgba(255,70,60,' + (0.8 * a).toFixed(3) + ')';
      ctx.fillRect(x, y - hh, 3, hh); ctx.fillRect(x + w - 3, y - hh, 3, hh);
      var blink = ((t * 2.2 + i * 0.37) % 1) < 0.62 ? 1 : 0.25;
      ctx.globalAlpha = a * blink;
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⛔', x + w / 2, y - 18);
      ctx.globalAlpha = 1;
    }
    // 봉쇄 직후 펄스 링
    var since = clock - lockSince;
    if (lockedPrev && since < 0.8) {
      ctx.strokeStyle = 'rgba(255,60,50,' + (0.8 * (1 - since / 0.8)).toFixed(3) + ')';
      ctx.lineWidth = 3;
      for (var j = 0; j < pl.length; j++) {
        var q = pl[j]; if (!q) continue;
        var e = 6 + since * 40;
        ctx.strokeRect(q.x - e, q.y - 4 - e * 0.5, q.w + e * 2, 8 + e);
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- 공개 API
  var Mutants = {
    list: [],
    types: TYPES,

    // opts = { mode, bossMode } (선택). 인자 없이 부르면 Game.bossMode 를 따름 (구버전 호환)
    init: function (opts) {
      registerHandlers();
      bossMode = (opts && typeof opts === 'object' && opts.bossMode != null) ? !!opts.bossMode : !!Game.bossMode;
      Mutants.bossMode = bossMode;
      Mutants.list = [];
      nextId = 1;
      spawnTimer = FIRST_SPAWN;
      matchTime = 0;
      snapTimer = 0;
      bossTimer = bossMode ? RUSH.first : BOSS.firstAt;
      bossWarned = false;
      nextBossIdx = 0;
      bossesKilled = 0;
      bossWarnNum = 0;
      Mutants.bossesKilled = 0;
      bossFx = [];
      warnT = 0;
      toastQ = [];
      stage = 1;
      Mutants.stage = 1;
      stageHudState.n = -1;
      stageHudState.pulse = false;
      setLock(false, true);
      bossHudSync(null);
      stageHudSync(null);
    },

    update: function (dt) {
      if (!dt || dt <= 0) return;
      if (dt > 0.05) dt = 0.05;
      clock += dt;
      registerHandlers();
      pumpToasts();
      if (Game.running === false) { bossHudSync(null); stageHudSync(null); setLock(false, true); return; }
      var auth = isAuthority();
      var i, m;

      if (auth) {
        matchTime += dt;
        if (!Game.matchOver) {
          spawnTimer -= dt;
          if (spawnTimer <= 0) {
            spawnTimer = rand(10, 14) * stageSpawnMul();
            // 보스 생존 중엔 일반 출현 쉼 (보스가 쥐/까마귀를 부름). 보스전 모드는 일반 출현 없음
            if (!findBoss() && !bossMode) spawnWave();
          }
          if (bossMode) bossSchedule(dt);   // 보스는 「보스전」 모드에서만 등장
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
            else if (m.type === 'crow') updateCrow(m, adt);
            else if (m.type === 'mole') updateMole(m, adt);
            else updateGround(m, adt);
          }
        } else {
          updateGuestMutant(m, dt);
        }
        if (m.type === 'mole') moleFx(m, dt);
        if (m.type === 'centipede') centTrail(m);
        if (m.boss) checkBossContact(m, dt); else checkAttack(m);
      }
      updateBossFx(dt);
      var curBoss = findBoss();
      setLock(!!curBoss, false);
      if (lockAnim < 1 && curBoss) lockAnim = Math.min(1, lockAnim + dt * 2.5);
      else if (!curBoss && lockAnim > 0) lockAnim = Math.max(0, lockAnim - dt * 1.6);
      bossHudSync(curBoss);
      stageHudSync(curBoss);

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
      if (!m || !m.alive || m.under) return;   // 땅속 두더지는 무적
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
      if (m.under && kind !== 'stun') return;   // 땅속 두더지: 기절만 통함 (지상으로 튀어나옴)
      if (m.boss) secs *= BOSS.resist;    // 보스는 상태이상 저항 (지속시간 절반)
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
      ctx.save();
      try { renderPlatformLock(ctx); } catch (eL) { /* 무시 */ }
      ctx.restore();
      // 보스와 바닥 표식은 작은 돌연변이 뒤에
      ctx.save();
      try { renderBossUnder(ctx); } catch (e0) { /* 무시 */ }
      ctx.restore();
      for (i = 0; i < Mutants.list.length; i++) {
        m = Mutants.list[i];
        if (!m.alive || !m.boss) continue;
        ctx.save();
        try { if (m.type === 'mossqueen') drawQueen(ctx, m); else if (m.type === 'centipede') drawCenti(ctx, m); else drawBoss(ctx, m); } catch (e1) { if (window.console) console.error('[boss] draw', e1); }
        ctx.restore();
      }
      for (i = 0; i < Mutants.list.length; i++) {
        m = Mutants.list[i];
        if (!m.alive || m.boss) continue;
        ctx.save();
        try { drawMutant(ctx, m); } catch (e) { /* 렌더 오류가 루프를 멈추지 않게 */ }
        ctx.restore();
        if (!(m.type === 'mole' && moleHidden(m))) drawHpBar(ctx, m);
      }
      ctx.save();
      try { renderBossOver(ctx); } catch (e2) { /* 무시 */ }
      ctx.restore();
    },

    // 현재 보스 (없으면 null)
    boss: function () { return findBoss(); },
    bossInfo: BOSS,
    queenInfo: QUEEN,
    bossNames: BOSS_NAMES,
    bossOrder: BOSS_ORDER,
    bossMode: false,
    bossesKilled: 0,
    // 현재 스테이지 (1부터, 보스 처치마다 +1). 변경 시 Game.events 'stageChanged' {stage}
    stage: 1,
    getStage: function () { return stage; },
    moleInfo: MOLE,
    stageInfo: STAGE,
    // 다음 보스까지 남은 시간 (권한측; 보스 생존 중엔 null)
    nextBossIn: function () { return findBoss() ? null : Math.max(0, bossTimer); },
    nextBossType: function () { return nextBossType(); },

    // 테스트/디버그용
    _debug: {
      // spawnBoss(type?, x?) — type: 'behemoth'|'mossqueen'|'centipede' (생략 시 순서대로). 구버전 spawnBoss(x) 도 허용
      spawnBoss: function (a, b) {
        var type = typeof a === 'string' ? a : null;
        var x = typeof a === 'number' ? a : (typeof b === 'number' ? b : null);
        return spawnBoss(x, true, type);
      },
      killBoss: function (by) { var b = findBoss(); if (b && isAuthority()) { b.killer = by != null ? by : myNetId(); bossDie(b); } },
      bossWarn: function () { bossTimer = BOSS.warn + 0.01; bossWarned = false; },
      setBossTimer: function (t) { bossTimer = t; },
      getBossTimer: function () { return bossTimer; },
      forcePattern: function (p) {
        var b = findBoss();
        if (b && isAuthority()) { if (b.type === 'mossqueen') startQueenPattern(b, p, nearestTarget(b)); else if (b.type === 'centipede') startCentiPattern(b, p, nearestTarget(b)); else startPattern(b, p, nearestTarget(b)); }
        return b ? b.state : null;
      },
      getBossesKilled: function () { return bossesKilled; },
      setStage: function (n) { setStage(n, true); },
      setBossMode: function (on) { bossMode = !!on; Mutants.bossMode = bossMode; },
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
    if (m.type === 'mole') {
      if (moleHidden(m)) { drawMoleUnder(ctx, m); return; }
      // 땅 아래로 내려간 부분은 잘라냄 (파고들기/솟구치기 시작)
      var G0c = gy();
      ctx.beginPath(); ctx.rect(m.x - 120, G0c - 600, m.w + 240, 600); ctx.clip();
    }
    var cx = m.x + m.w / 2;
    var base = m.y + m.h;
    if (m.type === 'mole' && m.state === 'burrow') base += m.h * 0.9 * clamp(1 - m.stateTimer / MOLE.burrow, 0, 1);
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
    else if (m.type === 'drone') drawDrone(ctx, m, wind, intensity);
    else if (m.type === 'mole') drawMole(ctx, m, wind, intensity);
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

  // ---- 변이 두더지
  function moleHidden(m) { return !!m.under || m.state === 'under' || m.state === 'windup'; }

  // 균열 한 줄 (지면을 따라 지그재그)
  function moleCrackPath(ctx, x0, G0, dir, len, k, id) {
    ctx.beginPath();
    ctx.moveTo(x0, G0 - 1);
    for (var j = 1; j <= 4; j++) {
      var xx = x0 + dir * len * (j / 4) * (k ? 0.7 : 1);
      var yy = G0 - 1 + (((j + k + id) % 2) ? 2.5 : -1.5) * (k ? 1 : -0.7);
      ctx.lineTo(xx, yy);
    }
  }

  // 땅속: 흙 둔덕 + 이동 흔적만 (월드 좌표). 예고 중엔 균열 + 자갈 + 경고
  function drawMoleUnder(ctx, m) {
    var G0 = gy(), cx = m.x + m.w / 2;
    var wind = m.state === 'windup';
    var i, k;
    var tr = m.trail || [];
    for (i = 0; i < tr.length; i++) {
      var a = 1 - clamp((clock - tr[i].t) / 0.9, 0, 1);
      if (a <= 0) continue;
      ctx.fillStyle = 'rgba(92,74,52,' + (0.75 * a).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(tr[i].x, G0, 13 * (0.6 + 0.4 * a), 5 * a + 1, 0, Math.PI, 0); ctx.fill();
    }
    var p = wind ? clamp(1 - m.stateTimer / MOLE.windup, 0, 1) : 0;
    var sx = wind ? Math.sin(clock * 80 + m.id) * (1.5 + 2.5 * p) : 0;
    var mx = cx + sx;
    var hgt = 9 + 7 * p + (wind ? 0 : Math.abs(Math.sin(clock * 14 + m.id)) * 2);
    var rw = 24 + 10 * p;
    if (wind) {
      // 바닥 경고 빛
      var gr = 60 + 20 * p;
      var gl = ctx.createRadialGradient(cx, G0, 2, cx, G0, gr);
      gl.addColorStop(0, 'rgba(141,255,60,' + (0.1 + 0.35 * p).toFixed(3) + ')');
      gl.addColorStop(1, 'rgba(141,255,60,0)');
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.ellipse(cx, G0, gr, 18 + 10 * p, 0, Math.PI, 0); ctx.fill();
    }
    // 둔덕
    var g = ctx.createLinearGradient(0, G0 - hgt, 0, G0);
    g.addColorStop(0, '#7a644a'); g.addColorStop(1, '#3e3226');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(mx, G0, rw, hgt, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(176,92,38,0.55)';
    ctx.beginPath(); ctx.ellipse(mx - rw * 0.3, G0 - hgt * 0.45, 4, 2, 0.3, 0, Math.PI * 2); ctx.fill();
    // 자갈 알갱이
    ctx.fillStyle = '#a89470';
    for (k = 0; k < 5; k++) {
      var px = mx + (((m.id * 37 + k * 53) % 100) / 100 - 0.5) * rw * 1.3;
      var py = G0 - hgt * 0.25 - (((k * 29 + m.id * 11) % 10) / 10) * hgt * 0.5;
      ctx.fillRect(px, py, 2.5, 2);
    }
    // 흙 틈 사이로 보이는 독성 눈빛
    var glow = wind ? 0.5 + 0.5 * p : 0.25 + 0.15 * Math.sin(clock * 5 + m.id);
    ctx.save();
    ctx.shadowColor = TOXIC; ctx.shadowBlur = 6 + 14 * glow;
    ctx.fillStyle = 'rgba(141,255,60,' + (0.5 + 0.5 * glow).toFixed(3) + ')';
    ctx.fillRect(mx + m.facing * 6 - 1.5, G0 - hgt * 0.55, 3, 1.6);
    ctx.fillRect(mx + m.facing * 11 - 1.2, G0 - hgt * 0.5, 2.4, 1.4);
    ctx.restore();
    if (wind) {
      // 균열 (점점 길어짐) — 어두운 틈 + 독성 빛
      var len = 18 + 46 * p;
      ctx.lineCap = 'round';
      for (var s = -1; s <= 1; s += 2) {
        for (k = 0; k < 2; k++) {
          moleCrackPath(ctx, cx + s * rw * 0.6, G0, s, len, k, m.id);
          ctx.strokeStyle = '#1a1410'; ctx.lineWidth = 2.6; ctx.stroke();
          ctx.strokeStyle = 'rgba(141,255,60,' + (0.25 + 0.55 * p).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke();
        }
      }
      // 튀는 자갈 (그림)
      ctx.fillStyle = '#b8a47e';
      for (k = 0; k < 4; k++) {
        var ph = (clock * 3.2 + k * 0.27 + m.seed) % 1;
        var bx = cx + (k - 1.5) * 14 + Math.sin(k * 7.1 + m.id) * 6;
        ctx.fillRect(bx, G0 - 4 - Math.sin(ph * Math.PI) * (10 + 16 * p), 3, 2.5);
      }
      // 경고 표시
      ctx.globalAlpha = Math.sin(clock * 20) > 0 ? 1 : 0.4;
      ctx.fillStyle = '#ff7a3a';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('!', cx, G0 - hgt - 10);
      ctx.globalAlpha = 1;
    }
  }

  // 굴착 앞발 (원점: 어깨)
  function moleClaw(ctx, x, y, ang, near) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = near ? '#4e3f36' : '#3a2f28';
    ctx.beginPath(); ctx.ellipse(5, 2, 8, 5, 0.3, 0, Math.PI * 2); ctx.fill();
    // 넓은 손바닥 (굳은살 + 녹)
    ctx.fillStyle = near ? '#9a6a62' : '#7a524c';
    ctx.beginPath(); ctx.ellipse(12, 5, 6, 7.5, 0.2, 0, Math.PI * 2); ctx.fill();
    if (near) rust(ctx, 11, 7, 2.5, 2);
    // 발톱 4개 (녹슨 강철빛)
    for (var k = 0; k < 4; k++) {
      var yb = -1 + k * 3.4;
      ctx.fillStyle = k % 2 ? '#cfc6a8' : '#b0a584';
      ctx.beginPath();
      ctx.moveTo(15, yb); ctx.lineTo(16, yb + 3);
      ctx.lineTo(26 + (k === 1 || k === 2 ? 2 : 0), yb + 3.5 + k * 0.6);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(141,255,60,0.6)';
    ctx.beginPath(); ctx.arc(27.5, 7.5, 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 지상의 두더지 (원점: 발밑 중앙, +x = 앞)
  function drawMole(ctx, m, wind, intensity) {
    var st = m.state;
    var t = m.animT * 2;
    var erupt = st === 'attack', bite = st === 'bite', dig = st === 'burrow';
    if (erupt || bite) intensity = Math.max(intensity, 0.75);
    var by = -17 - (erupt ? 0 : Math.abs(Math.sin(t)) * 1.5);
    ctx.save();
    if (erupt) { ctx.translate(0, by); ctx.rotate(-0.5); ctx.translate(0, -by); }
    else if (dig) { ctx.translate(0, by); ctx.rotate(0.38); ctx.translate(0, -by); }
    var i;
    // 뒷발 (짧음)
    leg(ctx, -16, by + 9, 9, t + Math.PI, 4, '#2e2520');
    leg(ctx, -6, by + 10, 9, t, 4, '#2e2520');
    // 짧은 꼬리
    ctx.strokeStyle = '#a07070'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-25, by + 2);
    ctx.quadraticCurveTo(-32, by - 3 + Math.sin(clock * 7 + m.id) * 2, -36, by + 3); ctx.stroke();
    // 몸통 (통통한 원통)
    var g = ctx.createRadialGradient(-4, by - 8, 3, 0, by, 30);
    g.addColorStop(0, '#5b4f47'); g.addColorStop(1, '#241d19');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, by, 26, 15, 0, 0, Math.PI * 2); ctx.fill();
    // 배 쪽 털결
    ctx.strokeStyle = 'rgba(20,14,10,0.7)'; ctx.lineWidth = 1;
    for (i = -18; i <= 14; i += 5) { ctx.beginPath(); ctx.moveTo(i, by + 9); ctx.lineTo(i - 2, by + 13); ctx.stroke(); }
    // 등에 박힌 녹슨 고철 갑피 + 리벳
    for (i = 0; i < 3; i++) {
      var px = -13 + i * 10, py = by - 11 + Math.abs(i - 1) * 1.6;
      ctx.fillStyle = i === 1 ? '#7a5234' : '#6a4630';
      ctx.beginPath(); ctx.ellipse(px, py, 6.5, 4, -0.25 + i * 0.25, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#3a2414'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#c9a27a';
      ctx.beginPath(); ctx.arc(px, py - 2, 0.9, 0, Math.PI * 2); ctx.fill();
    }
    rust(ctx, -10, by - 2, 6, 4);
    rust(ctx, 9, by + 4, 4, 3);
    moss(ctx, -4, by - 14, 3.6, m.seed);
    moss(ctx, -19, by - 8, 2.6, m.seed + 0.5);
    tumor(ctx, -15 + m.seed * 6, by - 12, 4 + m.seed * 2);
    // 머리 + 긴 주둥이
    var hx = 22 + (bite ? 5 : 0), hy = by + 2 + (bite ? 2 : 0);
    ctx.fillStyle = '#4a3d35';
    ctx.beginPath(); ctx.ellipse(hx, hy, 10, 8, 0.1, 0, Math.PI * 2); ctx.fill();
    // 벌어지는 턱
    var jaw = bite ? 0.55 : (erupt ? 0.35 : 0.08 + Math.sin(clock * 4 + m.id) * 0.04);
    ctx.save();
    ctx.translate(hx + 3, hy + 4); ctx.rotate(jaw);
    ctx.fillStyle = '#33261d';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(13, 0); ctx.lineTo(11, 4); ctx.lineTo(0, 4); ctx.fill();
    ctx.fillStyle = '#e6dcb8';
    for (i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(3 + i * 3.5, 0); ctx.lineTo(4.5 + i * 3.5, -2.5); ctx.lineTo(6 + i * 3.5, 0); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = '#5a4038';
    ctx.beginPath(); ctx.moveTo(hx + 3, hy - 5); ctx.quadraticCurveTo(hx + 16, hy - 4, hx + 20, hy); ctx.quadraticCurveTo(hx + 14, hy + 4, hx + 3, hy + 4); ctx.fill();
    // 앞니
    ctx.fillStyle = '#e8dcb0';
    ctx.fillRect(hx + 13, hy + 2, 2, 4); ctx.fillRect(hx + 16, hy + 1.5, 2, 3.5);
    // 별 모양 변이 코 (분홍 촉수 + 독성 끝)
    var ncx = hx + 21, ncy = hy;
    for (i = 0; i < 8; i++) {
      var a = i / 8 * Math.PI * 2 + Math.sin(clock * 9 + i) * 0.12;
      var rr = 4 + Math.sin(clock * 11 + i * 1.3) * 0.6;
      ctx.fillStyle = i % 2 ? '#d97a8a' : '#c46478';
      ctx.beginPath(); ctx.ellipse(ncx + Math.cos(a) * rr, ncy + Math.sin(a) * rr, 2.2, 1.3, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#9a4058';
    ctx.beginPath(); ctx.arc(ncx, ncy, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(141,255,60,' + (0.4 + intensity * 0.5).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(ncx + 0.5, ncy - 0.5, 1, 0, Math.PI * 2); ctx.fill();
    // 작은 실눈 (빛나는)
    if (wind || erupt || bite) eyeHalo(ctx, hx + 2, hy - 4, 14);
    glowEye(ctx, hx + 3, hy - 4, 1.9, intensity);
    glowEye(ctx, hx - 2, hy - 3, 1.4, intensity);
    // 큰 앞발 (먼 쪽, 가까운 쪽)
    var pawA = erupt ? -1.25 : (dig ? 0.5 + Math.sin(clock * 30) * 0.7 : (bite ? -0.35 : 0.35 + Math.sin(t) * 0.18));
    moleClaw(ctx, 8, by + 4, pawA + (dig ? 0.9 : 0.15), false);
    moleClaw(ctx, 13, by + 7, pawA, true);
    // 솟구칠 때 흙덩이
    if (erupt) {
      for (i = 0; i < 6; i++) {
        var dx = Math.sin(i * 2.3 + m.id) * 26, dy = 6 + ((clock * 90 + i * 13) % 26);
        ctx.fillStyle = i % 2 ? '#7a644a' : '#5a4a36';
        ctx.fillRect(dx - 2, -dy * 0.3 + 4, 4, 3.5);
      }
    }
    ctx.restore();
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
      } else if (f.kind === 'pod' || f.kind === 'scorch') {
        renderQueenGroundFx(ctx, f, G0);
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
    if (b.type === 'mossqueen') { renderQueenTele(ctx, b, G0); return; }
    if (b.type === 'centipede') { renderCentiTele(ctx, b, G0); return; }
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
      } else if (f.kind === 'beam' || f.kind === 'dart' || f.kind === 'gustfx' || f.kind === 'stuck' || f.kind === 'cloud' || (f.kind === 'pod' && f.delay <= 0)) {
        renderQueenAirFx(ctx, f, G0);
      } else if (f.kind === 'slag' || f.kind === 'scrap' || f.kind === 'molten' || f.kind === 'whipfx') {
        renderCentiFx(ctx, f, G0);
      } else if (f.kind === 'corpse' && f.type === 'centipede') {
        var CT = TYPES.centipede;
        var cfake = { type: 'centipede', x: f.x - CT.w / 2, y: G0 - CT.h, w: CT.w, h: CT.h, seed: 0.5, segPts: f.pts,
                      facing: f.facing, enraged: f.enr, animT: 0, vx: 0, vy: 0, hitFlash: 0,
                      state: 'dead', stateTimer: Math.max(0, f.life - f.t), stateDur: f.life };
        ctx.save();
        try { drawCenti(ctx, cfake); } catch (ec) { /* 무시 */ }
        ctx.restore();
      } else if (f.kind === 'corpse' && f.type === 'mossqueen') {
        var QT = TYPES.mossqueen;
        var fq = clamp(f.t / 0.9, 0, 1);
        var qy0 = (f.y || G0 - QT.h / 2) - QT.h / 2;
        var qfake = { type: 'mossqueen', x: f.x - QT.w / 2, y: qy0 + (G0 - QT.h - qy0) * fq * fq, w: QT.w, h: QT.h, seed: 0.3,
                      facing: f.facing, enraged: f.enr, animT: 0, vx: 0, vy: 0, hitFlash: 0,
                      state: 'dead', stateTimer: Math.max(0, f.life - f.t), stateDur: f.life };
        ctx.save();
        try { drawQueen(ctx, qfake); } catch (eq) { /* 무시 */ }
        ctx.restore();
      } else if (f.kind === 'corpse') {
        var BT = TYPES.behemoth;
        var fake = { x: f.x - BT.w / 2, y: G0 - BT.h, w: BT.w, h: BT.h,
                     facing: f.facing, enraged: f.enr, animT: 0, vx: 0, vy: 0, hitFlash: 0,
                     state: 'dead', stateTimer: Math.max(0, f.life - f.t), stateDur: f.life };
        ctx.save();
        try { drawBoss(ctx, fake); } catch (e) { /* 무시 */ }
        ctx.restore();
      }
    }
  }

  // ================================================================ 보스 그래픽 '이끼 여왕'
  // 정면을 향한 거대한 이끼 나방: 양옆으로 펼친 두 쌍의 날개(눈알 무늬 발광), 털 많은 가슴, 깃털 더듬이,
  // 녹슨 철근 왕관, 포자 주머니가 달린 늘어진 배, 매달린 여섯 다리. 오프스크린에 그린 뒤 덧칠/합성.
  var QW = 640, QH = 560, QX = 320, QY = 250;   // 오프스크린 (원점 = 몸통 판정 윗변 중앙)
  var qCv = null, qK = 0;
  var VIOLET = '#b28cff', PINK = '#ff5ad2';

  function getQOff(k) {
    if (typeof document === 'undefined') return null;
    if (!qCv) qCv = document.createElement('canvas');
    if (qK !== k) {
      qK = k;
      qCv.width = Math.ceil(QW * k);
      qCv.height = Math.ceil(QH * k);
    }
    return qCv;
  }

  function queenPose(m) {
    var st = m.state;
    var dur = m.stateDur > 0 ? m.stateDur : 1;
    var p = clamp(1 - m.stateTimer / dur, 0, 1);
    var pulse = 0.5 + 0.5 * Math.sin(clock * 26);
    var P = {
      flapSpd: 8, flapAmp: 1, flapBias: 0, tele: 0, lean: clamp((m.vx || 0) * (m.facing || 1) / 900, -0.3, 0.3) * 0.35,
      head: Math.sin(clock * 1.6) * 0.04, eye: 0.35, mouth: 0, sac: 0.25, jit: 0, dead: 0, fold: 0
    };
    switch (st) {
      case 'intro':
        P.flapSpd = 5; P.flapAmp = 0.7; P.fold = 0.35 * (1 - p); P.eye = 0.6;
        break;
      case 'roar': case 'enrage': case 'summon':
        P.flapSpd = 15; P.flapAmp = 1.1; P.mouth = 0.6; P.eye = 0.8 + 0.2 * pulse; P.head = -0.16;
        P.jit = st === 'enrage' ? 2.2 : 1; P.tele = st === 'roar' ? 0 : pulse * 0.6;
        break;
      case 'dive_wind':
        P.flapSpd = 14; P.flapBias = -0.55; P.flapAmp = 0.5; P.tele = pulse; P.eye = 0.6 + 0.4 * pulse; P.jit = 1; P.lean = -0.12;
        break;
      case 'dive':
        P.fold = 0.8; P.flapSpd = 3; P.flapAmp = 0.15; P.eye = 1;
        P.lean = clamp(Math.abs(m.vx || 0) / 1500, 0, 0.5) * (((m.vy || 0) > 0) ? 1 : 0.4);
        break;
      case 'spore_wind':
        P.sac = 0.4 + 0.6 * p; P.tele = pulse; P.flapSpd = 12; P.eye = 0.6;
        break;
      case 'spore':
        P.sac = 1 - p; P.flapSpd = 11;
        break;
      case 'beam_wind':
        P.mouth = p; P.eye = 0.6 + 0.4 * pulse; P.tele = pulse; P.head = 0.22 * easeOut(p); P.flapSpd = 10; P.jit = 0.8;
        break;
      case 'beam':
        P.mouth = 1; P.eye = 1; P.head = 0.28; P.flapSpd = 10; P.flapAmp = 0.8;
        break;
      case 'gust_wind':
        P.flapBias = -0.95 * easeOut(p * 1.3); P.flapAmp = 0.1; P.tele = pulse; P.eye = 0.8; P.jit = 1;
        break;
      case 'gust':
        P.flapBias = -0.95 + 2.0 * easeOut(clamp(p * 2.5, 0, 1)); P.flapAmp = 0.05; P.eye = 0.9;
        break;
      case 'recover':
        P.flapSpd = 7;
        break;
      case 'dead':
        P.dead = p; P.fold = 0.55 * easeOut(p * 1.5); P.flapSpd = 2; P.flapAmp = 0.35 * (1 - p); P.eye = 0; P.lean = 0.35 * easeOut(p);
        break;
    }
    if (m.enraged && st !== 'dead') { P.eye = Math.max(P.eye, 0.6 + 0.3 * Math.sin(clock * 9)); P.flapSpd *= 1.2; }
    // 날갯짓 위상은 누적 (상태가 바뀌어도 날개가 튀지 않게)
    var dtR = m._fpT != null ? clamp(clock - m._fpT, 0, 0.1) : 0;
    m._fpT = clock;
    m._fp = (m._fp || m.seed * 10) + dtR * P.flapSpd;
    P.flap = clamp(Math.sin(m._fp) * P.flapAmp + P.flapBias, -1.2, 1.2);   // -1 = 위로, +1 = 아래로
    P.flapLag = clamp(Math.sin(m._fp - 0.6) * P.flapAmp + P.flapBias, -1.2, 1.2);
    return P;
  }

  // 날개 눈알 무늬
  function ocellus(o, x, y, r, col, glow) {
    o.save();
    o.fillStyle = '#120c06';
    o.beginPath(); o.ellipse(x, y, r * 1.25, r * 1.1, 0, 0, Math.PI * 2); o.fill();
    o.fillStyle = '#c9b48a';
    o.beginPath(); o.ellipse(x, y, r * 1.02, r * 0.92, 0, 0, Math.PI * 2); o.fill();
    o.shadowColor = col; o.shadowBlur = 4 + glow * 16;
    o.fillStyle = col;
    o.beginPath(); o.ellipse(x, y, r * 0.82, r * 0.74, 0, 0, Math.PI * 2); o.fill();
    o.shadowBlur = 0;
    o.fillStyle = '#16200c';
    o.beginPath(); o.ellipse(x + r * 0.08, y, r * 0.42, r * 0.4, 0, 0, Math.PI * 2); o.fill();
    o.fillStyle = 'rgba(255,255,240,' + (0.6 + 0.4 * glow).toFixed(3) + ')';
    o.beginPath(); o.arc(x - r * 0.2, y - r * 0.22, r * 0.18, 0, Math.PI * 2); o.fill();
    o.restore();
  }

  // 날개 한 쌍 (side = +1 앞쪽/-1 뒤쪽, 좌우 대칭). 지역 좌표: +x = 날개 끝 방향, -y = 앞 가장자리
  function queenWings(o, side, P, enr, seed, far) {
    var sc = far ? 0.88 : 1;
    var fold = P.fold;
    var lenK = (1 - 0.42 * fold) * sc;
    var angF = 0.5 - 0.62 * P.flap + fold * 0.85;
    var angH = 0.02 - 0.5 * P.flapLag + fold * 0.95;
    var eyeCol = enr ? PINK : TOXIC;
    var glow = P.eye;
    // ---- 뒷날개
    o.save();
    o.translate(side * 16, 74);
    o.scale(side, 1);
    o.rotate(-angH);
    o.scale(lenK, sc);
    var hg = o.createRadialGradient(30, 40, 6, 60, 50, 175);
    hg.addColorStop(0, far ? '#1c1626' : '#2a2034');
    hg.addColorStop(0.45, far ? '#3a3052' : '#54467a');
    hg.addColorStop(0.8, far ? '#4a3c64' : '#7a6aa0');
    hg.addColorStop(1, '#2a1e3a');
    o.fillStyle = hg;
    o.beginPath();
    o.moveTo(0, 2);
    o.bezierCurveTo(60, -8, 140, 8, 168, 40);
    o.quadraticCurveTo(178, 70, 160, 90);
    o.lineTo(150, 86); o.lineTo(144, 100);
    o.bezierCurveTo(110, 120, 52, 92, 0, 34);
    o.closePath(); o.fill();
    o.strokeStyle = 'rgba(16,10,24,0.55)'; o.lineWidth = 1.4;
    for (var v = 0; v < 5; v++) {
      o.beginPath(); o.moveTo(4, 10 + v * 5); o.quadraticCurveTo(70, 18 + v * 14, 150 - v * 14, 36 + v * 14); o.stroke();
    }
    // 가장자리 이끼 술
    o.fillStyle = '#5f7f30';
    o.beginPath(); o.arc(166, 50, 5, 0, Math.PI * 2); o.arc(158, 84, 4, 0, Math.PI * 2); o.arc(128, 104, 4.5, 0, Math.PI * 2); o.fill();
    ocellus(o, 112, 58, 12, VIOLET, glow * 0.8);
    o.restore();

    // ---- 앞날개
    o.save();
    o.translate(side * 18, 58);
    o.scale(side, 1);
    o.rotate(-angF);
    o.scale(lenK, sc);
    var fg = o.createLinearGradient(0, 0, 250, -70);
    fg.addColorStop(0, far ? '#241c12' : '#3a2c1c');
    fg.addColorStop(0.22, far ? '#34402a' : '#4f6236');
    fg.addColorStop(0.55, far ? '#4a5434' : '#6f7d4a');
    fg.addColorStop(0.82, far ? '#5a3a1c' : '#8a5a2a');
    fg.addColorStop(1, '#3a2410');
    o.fillStyle = fg;
    o.beginPath();
    o.moveTo(0, -14);
    o.bezierCurveTo(60, -60, 150, -106, 232, -94);
    o.quadraticCurveTo(264, -86, 252, -58);
    o.lineTo(240, -52); o.lineTo(238, -38);
    o.bezierCurveTo(222, -22, 200, -8, 172, 2);
    o.lineTo(160, -2); o.lineTo(150, 8);
    o.bezierCurveTo(100, 16, 50, 18, 0, 14);
    o.closePath(); o.fill();
    // 무늬: 어두운 물결 띠 + 밝은 띠
    o.save();
    o.clip();
    o.strokeStyle = 'rgba(26,18,8,0.55)'; o.lineWidth = 11;
    o.beginPath(); o.moveTo(96, -96); o.bezierCurveTo(112, -60, 100, -30, 118, 20); o.stroke();
    o.strokeStyle = 'rgba(214,200,150,0.32)'; o.lineWidth = 5;
    o.beginPath(); o.moveTo(150, -110); o.bezierCurveTo(166, -70, 150, -30, 170, 14); o.stroke();
    // 녹 반점
    o.fillStyle = 'rgba(181,84,28,0.55)';
    o.beginPath(); o.ellipse(214, -76, 16, 9, -0.3, 0, Math.PI * 2); o.fill();
    o.beginPath(); o.ellipse(60, -18, 12, 6, -0.4, 0, Math.PI * 2); o.fill();
    // 이끼 가루 (밝은 점)
    o.fillStyle = 'rgba(127,224,184,0.35)';
    for (var d = 0; d < 9; d++) {
      var dx = 30 + ((d * 53 + seed * 97) % 190), dy = -10 - ((d * 37) % 70) * (dx / 220);
      o.beginPath(); o.arc(dx, dy, 2 + (d % 3), 0, Math.PI * 2); o.fill();
    }
    o.restore();
    o.strokeStyle = 'rgba(20,14,8,0.5)'; o.lineWidth = 1.5;
    for (var w = 0; w < 6; w++) {
      o.beginPath(); o.moveTo(6, -8 + w * 4); o.quadraticCurveTo(110, -64 + w * 14, 232 - w * 12, -84 + w * 18); o.stroke();
    }
    // 앞 가장자리 털 + 가장자리 이끼
    o.strokeStyle = '#2a1e10'; o.lineWidth = 3;
    o.beginPath(); o.moveTo(0, -14); o.bezierCurveTo(60, -60, 150, -106, 232, -94); o.stroke();
    var tufts = [[244, -72, 6], [250, -60, 5], [236, -40, 6], [210, -18, 5], [180, -2, 6], [152, 6, 4]];
    for (var t = 0; t < tufts.length; t++) {
      o.fillStyle = t % 2 ? '#5f7f30' : '#a8c070';
      o.beginPath(); o.arc(tufts[t][0], tufts[t][1], tufts[t][2], 0, Math.PI * 2); o.fill();
      o.fillStyle = '#3d6b2a';
      o.beginPath(); o.arc(tufts[t][0] + 3, tufts[t][1] + 2, tufts[t][2] * 0.6, 0, Math.PI * 2); o.fill();
    }
    ocellus(o, 176, -52, 15, eyeCol, glow);
    o.restore();
  }

  function queenAntenna(o, bx, by, side, P) {
    var sway = Math.sin(clock * 3 + side) * 6;
    var tx = bx + side * 74 + sway, ty = by - 70 + Math.cos(clock * 2.6) * 4 - P.head * 20;
    var cx = bx + side * 12, cy = by - 66;
    o.strokeStyle = '#c9b48a'; o.lineWidth = 3; o.lineCap = 'round';
    o.beginPath(); o.moveTo(bx, by); o.quadraticCurveTo(cx, cy, tx, ty); o.stroke();
    // 깃털 가지 (빗살)
    o.strokeStyle = 'rgba(160,140,96,0.9)'; o.lineWidth = 1.6;
    o.beginPath();
    for (var i = 1; i < 15; i++) {
      var s = i / 15, u = 1 - s;
      var px = u * u * bx + 2 * u * s * cx + s * s * tx;
      var py = u * u * by + 2 * u * s * cy + s * s * ty;
      var gx = 2 * u * (cx - bx) + 2 * s * (tx - cx), gy2 = 2 * u * (cy - by) + 2 * s * (ty - cy);
      var gl = Math.sqrt(gx * gx + gy2 * gy2) || 1;
      var nx = -gy2 / gl, ny = gx / gl;
      var L = 14 * (1 - s * 0.7);
      o.moveTo(px, py); o.lineTo(px + nx * L + gx / gl * L * 0.5, py + ny * L + gy2 / gl * L * 0.5);
      o.moveTo(px, py); o.lineTo(px - nx * L + gx / gl * L * 0.5, py - ny * L + gy2 / gl * L * 0.5);
    }
    o.stroke();
    o.save();
    o.shadowColor = TOXIC; o.shadowBlur = 8;
    o.fillStyle = 'rgba(200,255,140,' + (0.5 + 0.4 * P.eye).toFixed(3) + ')';
    o.beginPath(); o.arc(tx, ty, 3, 0, Math.PI * 2); o.fill();
    o.restore();
  }

  function queenEye(o, x, y, rx, ry, P, enr) {
    var col = enr ? PINK : TOXIC;
    o.save();
    o.fillStyle = '#0a1406';
    o.beginPath(); o.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); o.fill();
    o.shadowColor = col; o.shadowBlur = 6 + P.eye * 18;
    var g = o.createRadialGradient(x - rx * 0.2, y - ry * 0.2, 1, x, y, rx);
    g.addColorStop(0, enr ? '#ffe0f4' : '#f4ffd0');
    g.addColorStop(0.35, col);
    g.addColorStop(1, enr ? '#4a0a3a' : '#1a3a08');
    o.globalAlpha = 0.45 + 0.55 * P.eye;
    o.fillStyle = g;
    o.beginPath(); o.ellipse(x, y, rx * 0.92, ry * 0.92, 0, 0, Math.PI * 2); o.fill();
    o.globalAlpha = 1;
    o.shadowBlur = 0;
    // 겹눈 낱눈
    o.fillStyle = 'rgba(0,0,0,0.28)';
    for (var i = -2; i <= 2; i++) {
      for (var j = -2; j <= 2; j++) {
        if (i * i + j * j > 5) continue;
        o.beginPath(); o.arc(x + i * rx * 0.34 + (j % 2) * rx * 0.17, y + j * ry * 0.3, 1.2, 0, Math.PI * 2); o.fill();
      }
    }
    o.fillStyle = 'rgba(255,255,255,0.75)';
    o.beginPath(); o.ellipse(x - rx * 0.35, y - ry * 0.4, rx * 0.22, ry * 0.14, -0.5, 0, Math.PI * 2); o.fill();
    o.restore();
  }

  function drawQueenBody(o, m, P) {
    var enr = !!m.enraged;
    var seed = m.seed || 0.3;
    // 기울기 (가슴 중심 기준)
    o.save();
    o.translate(0, 66); o.rotate(P.lean); o.translate(0, -66);

    // 날개: 먼 쪽(-x) → 가까운 쪽(+x), 둘 다 몸 뒤
    queenWings(o, -1, P, enr, seed, true);
    queenWings(o, 1, P, enr, seed + 0.37, false);

    // ---- 배 (늘어진 체절 + 포자 주머니)
    var sway = Math.sin(clock * 2.4 + seed * 5) * 5;
    var segs = 6;
    for (var s = segs - 1; s >= 0; s--) {
      var q = s / (segs - 1);
      var sx = sway * q * q - q * 6;
      var sy = 98 + q * 70;
      var rx = 30 - q * 17, ry = 11 - q * 3;
      var ag = o.createLinearGradient(sx - rx, sy, sx + rx, sy);
      ag.addColorStop(0, '#2a2016');
      ag.addColorStop(0.45, s % 2 ? '#5a4a30' : '#6b5a3a');
      ag.addColorStop(1, '#2a2016');
      o.fillStyle = ag;
      o.beginPath(); o.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); o.fill();
      o.strokeStyle = 'rgba(20,12,6,0.7)'; o.lineWidth = 1.5;
      o.beginPath(); o.ellipse(sx, sy + ry * 0.4, rx * 0.9, ry * 0.5, 0, 0.1, Math.PI - 0.1); o.stroke();
      // 포자 주머니 (옆구리)
      if (s > 0 && s < segs - 1) {
        var pr = (4.5 - q * 1.5) * (1 + 0.5 * P.sac + 0.12 * Math.sin(clock * 6 + s));
        o.save();
        o.shadowColor = s % 2 ? VIOLET : TOXIC; o.shadowBlur = 6 + 12 * P.sac;
        o.fillStyle = s % 2 ? '#c8a8ff' : '#c6ff7a';
        o.beginPath(); o.arc(sx - rx * 0.86, sy, pr, 0, Math.PI * 2); o.arc(sx + rx * 0.86, sy, pr, 0, Math.PI * 2); o.fill();
        o.restore();
      }
    }
    // 배 끝 침 + 떨어지는 독
    var tipX = sway - 6, tipY = 176;
    o.fillStyle = '#1e160c';
    o.beginPath(); o.moveTo(tipX - 6, tipY - 6); o.lineTo(tipX + 6, tipY - 6); o.lineTo(tipX + 1, tipY + 8); o.closePath(); o.fill();
    var drip = (clock * 0.9 + seed) % 1;
    o.fillStyle = 'rgba(141,255,60,' + (0.85 * (1 - drip)).toFixed(3) + ')';
    o.beginPath(); o.arc(tipX + 1, tipY + 8 + drip * 18, 2.6, 0, Math.PI * 2); o.fill();

    // ---- 다리 6개 (가슴 아래에서 매달림)
    o.lineCap = 'round'; o.lineJoin = 'round';
    for (var l = 0; l < 6; l++) {
      var sd = l < 3 ? -1 : 1;
      var li = l % 3;
      var hx = sd * (10 + li * 8), hy = 88 + li * 4;
      var sw = Math.sin(clock * 2.2 + l * 1.3) * 0.15 + (m.state === 'dive' ? -0.5 : 0) + P.dead * 0.6;
      var kx = hx + sd * (26 + li * 6) * Math.cos(sw), ky = hy + 18 + Math.sin(sw) * 8;
      var fx2 = kx + sd * (6 + li * 4), fy2 = ky + 38 + li * 8 - Math.abs(sw) * 10;
      o.strokeStyle = '#2a2016'; o.lineWidth = 5;
      o.beginPath(); o.moveTo(hx, hy); o.lineTo(kx, ky); o.lineTo(fx2, fy2); o.stroke();
      o.strokeStyle = '#6b5a3a'; o.lineWidth = 1.6;
      o.beginPath(); o.moveTo(hx, hy); o.lineTo(kx, ky); o.stroke();
      o.strokeStyle = '#1a120a'; o.lineWidth = 2.5;
      o.beginPath(); o.moveTo(fx2, fy2); o.lineTo(fx2 - sd * 6, fy2 + 4); o.stroke();
    }

    // ---- 가슴 (털 뭉치)
    var tg = o.createRadialGradient(-8, 56, 6, 0, 66, 44);
    tg.addColorStop(0, '#9a8a5e');
    tg.addColorStop(0.55, '#5a4a30');
    tg.addColorStop(1, '#2e2618');
    o.fillStyle = tg;
    o.beginPath(); o.ellipse(0, 66, 40, 36, 0, 0, Math.PI * 2); o.fill();
    o.strokeStyle = 'rgba(190,170,120,0.55)'; o.lineWidth = 2;
    o.beginPath();
    for (var f = 0; f < 26; f++) {
      var a = f / 26 * Math.PI * 2;
      var r0 = 34 + (f % 3) * 2;
      o.moveTo(Math.cos(a) * r0, 66 + Math.sin(a) * r0 * 0.88);
      o.lineTo(Math.cos(a + 0.1) * (r0 + 8), 66 + Math.sin(a + 0.1) * (r0 + 8) * 0.88);
    }
    o.stroke();
    moss(o, -20, 74, 9, seed);
    moss(o, 22, 82, 7, seed + 0.4);
    mushroom(o, 28, 52, 8, P.eye > 0.7);
    mushroom(o, -30, 58, 6, false);
    // 목 털 칼라
    o.fillStyle = '#c8cca0';
    for (var c = -3; c <= 3; c++) {
      o.beginPath(); o.arc(c * 9 + 4, 42 + Math.abs(c) * 2, 8 - Math.abs(c) * 0.6, 0, Math.PI * 2); o.fill();
    }
    o.fillStyle = 'rgba(120,130,80,0.6)';
    for (var c2 = -2; c2 <= 2; c2++) { o.beginPath(); o.arc(c2 * 10 + 4, 47, 4, 0, Math.PI * 2); o.fill(); }

    // ---- 머리
    o.save();
    o.translate(6, 28); o.rotate(P.head); o.translate(-6, -28);
    var hdg = o.createRadialGradient(2, 18, 3, 6, 26, 26);
    hdg.addColorStop(0, '#7a6a48');
    hdg.addColorStop(1, '#2e2618');
    o.fillStyle = hdg;
    o.beginPath(); o.ellipse(6, 26, 24, 20, 0, 0, Math.PI * 2); o.fill();
    queenAntenna(o, -4, 10, -1, P);
    queenAntenna(o, 16, 10, 1, P);
    // 녹슨 철근 왕관 (끝이 독빛)
    o.strokeStyle = '#7a3a14'; o.lineWidth = 4; o.lineCap = 'round';
    var spikes = [[-6, 8, -12, -12], [6, 6, 6, -20], [18, 8, 24, -12]];
    for (var k = 0; k < 3; k++) {
      o.beginPath(); o.moveTo(spikes[k][0], spikes[k][1]); o.lineTo(spikes[k][2], spikes[k][3]); o.stroke();
    }
    o.strokeStyle = '#e07a35'; o.lineWidth = 1.5;
    for (k = 0; k < 3; k++) {
      o.beginPath(); o.moveTo(spikes[k][0] - 1, spikes[k][1]); o.lineTo(spikes[k][2] - 1, spikes[k][3] + 2); o.stroke();
    }
    o.fillStyle = '#b5541c';
    o.beginPath(); o.ellipse(6, 10, 15, 4, 0, 0, Math.PI * 2); o.fill();
    o.save();
    o.shadowColor = enr ? PINK : TOXIC; o.shadowBlur = 10;
    o.fillStyle = enr ? '#ffb0e8' : '#c6ff7a';
    for (k = 0; k < 3; k++) { o.beginPath(); o.arc(spikes[k][2], spikes[k][3], 3.2, 0, Math.PI * 2); o.fill(); }
    o.restore();
    // 겹눈 (먼 쪽은 작게)
    queenEye(o, -9, 27, 10, 12, P, enr);
    queenEye(o, 22, 27, 12, 14, P, enr);
    // 말린 주둥이 / 광선 충전구
    o.strokeStyle = '#3a2a1a'; o.lineWidth = 2.5;
    o.beginPath(); o.arc(7, 44, 5, 0.3, Math.PI * 1.7); o.stroke();
    if (P.mouth > 0) {
      o.save();
      o.shadowColor = enr ? PINK : TOXIC; o.shadowBlur = 10 + 20 * P.mouth;
      o.fillStyle = enr ? '#ffd0f0' : '#eaffc0';
      o.beginPath(); o.arc(10, 36, 3 + 7 * P.mouth, 0, Math.PI * 2); o.fill();
      o.restore();
    }
    o.restore();   // 머리
    o.restore();   // lean
  }

  function drawQueen(ctx, m) {
    var P = queenPose(m);
    var cx = bcx(m), top = m.y;
    var G0 = gy();
    var sa = P.dead > 0 ? 1 - P.dead : 1;
    // 땅 그림자 (높을수록 작고 옅게)
    var alt = Math.max(0, G0 - (m.y + m.h));
    var s = clamp(1 - alt / 700, 0.3, 1);
    var shg = ctx.createRadialGradient(cx, G0, 4, cx, G0, 190 * s);
    shg.addColorStop(0, 'rgba(0,0,0,' + (0.5 * s * sa).toFixed(3) + ')');
    shg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shg;
    ctx.beginPath(); ctx.ellipse(cx, G0, 190 * s, 15 * s, 0, 0, Math.PI * 2); ctx.fill();
    // 날갯짓 바람에 일어나는 먼지
    if (alt < 80 && sa > 0.5 && Math.random() < 0.25) particles(cx + rand(-150, 150), G0 - 4, 1, '#c9b48a', 90);

    // 오라 (격노: 분홍빛)
    var col = m.enraged ? '255,90,210' : '178,140,255';
    var ag = ctx.createRadialGradient(cx, top + 70, 20, cx, top + 70, 260);
    ag.addColorStop(0, 'rgba(' + col + ',' + ((m.enraged ? 0.2 : 0.1) * sa + 0.04 * Math.sin(clock * 6)).toFixed(3) + ')');
    ag.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(cx, top + 70, 260, 0, Math.PI * 2); ctx.fill();

    // 급강하 잔상
    if (m.state === 'dive') {
      ctx.strokeStyle = 'rgba(178,140,255,0.4)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      var vl = Math.sqrt(m.vx * m.vx + m.vy * m.vy) || 1;
      for (var q = 0; q < 5; q++) {
        var ox = cx + (q - 2) * 30, oy = top + 40 + q * 26;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox - m.vx / vl * (80 + q * 16), oy - m.vy / vl * (80 + q * 16)); ctx.stroke();
      }
    }

    var k = 1;
    try {
      if (ctx.getTransform) { var tr = ctx.getTransform(); k = Math.sqrt(tr.a * tr.a + tr.b * tr.b) || 1; }
    } catch (e) { k = 1; }
    k = clamp(Math.round(k * 4) / 4, 0.5, 2.5);
    var cv = getQOff(k);
    if (!cv) return;
    var jx = 0, jy = 0;
    if (P.jit) { jx = Math.sin(clock * 93) * P.jit; jy = Math.cos(clock * 71) * P.jit * 0.6; }
    var o = cv.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';
    o.clearRect(0, 0, cv.width, cv.height);
    o.setTransform(k, 0, 0, k, QX * k, QY * k);
    o.scale(m.facing < 0 ? -1 : 1, 1);
    drawQueenBody(o, m, P);
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-atop';
    if (P.tele > 0) {
      o.globalAlpha = 0.08 + 0.2 * P.tele;
      o.fillStyle = m.enraged ? PINK : TOXIC;
      o.fillRect(0, 0, cv.width, cv.height);
    }
    if (m.enraged && P.dead <= 0) {
      o.globalAlpha = 0.07 + 0.05 * Math.sin(clock * 8);
      o.fillStyle = PINK;
      o.fillRect(0, 0, cv.width, cv.height);
    }
    if (m.hitFlash > 0) {
      o.globalAlpha = Math.min(1, m.hitFlash / 0.15) * 0.85;
      o.fillStyle = '#ffffff';
      o.fillRect(0, 0, cv.width, cv.height);
    }
    if (P.dead > 0) {
      o.globalAlpha = Math.min(1, P.dead * 1.2) * 0.6;
      o.fillStyle = '#120a1a';
      o.fillRect(0, 0, cv.width, cv.height);
    }
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = sa < 1 ? clamp(sa * 1.6, 0, 1) : 1;
    ctx.drawImage(cv, cx - QX + jx, top - QY + jy, QW, QH);
    ctx.globalAlpha = 1;

    // 날개에서 흩날리는 포자 가루
    if (sa > 0.3) {
      for (var i = 0; i < 12; i++) {
        var px = cx + Math.sin(i * 12.9898 + clock * 0.6) * 230;
        var py = top - 40 + ((clock * 34 + i * 53) % 260);
        var pa = 0.35 + 0.35 * Math.sin(clock * 3 + i);
        ctx.fillStyle = (i % 2 ? 'rgba(178,140,255,' : 'rgba(198,255,122,') + (pa * sa).toFixed(3) + ')';
        ctx.fillRect(px, py, 2.5, 2.5);
      }
    }
  }

  // ---- 이끼 여왕 바닥 예고 (여왕 뒤)
  function renderQueenTele(ctx, b, G0) {
    var cx = bcx(b);
    var tele = 0.5 + 0.5 * Math.sin(clock * 22);
    var dur = b.stateDur > 0 ? b.stateDur : 1;
    var prog = clamp(1 - b.stateTimer / dur, 0, 1);
    var col = b.enraged ? '255,90,210' : '190,150,255';
    var W = world();
    if (b.state === 'dive_wind' || b.state === 'dive') {
      var zx = b.aux, zr = QUEEN.diveZone / 2;
      var on = b.state === 'dive' ? 1 : easeOut(prog * 1.4);
      // 내려꽂힐 기둥
      var cg = ctx.createLinearGradient(0, G0 - 420, 0, G0);
      cg.addColorStop(0, 'rgba(' + col + ',0)');
      cg.addColorStop(1, 'rgba(' + col + ',' + ((0.16 + 0.18 * tele) * on).toFixed(3) + ')');
      ctx.fillStyle = cg;
      ctx.fillRect(zx - zr, G0 - 420, zr * 2, 420);
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.6 + 0.4 * tele).toFixed(3) + ')';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(zx, G0 - 2, zr * on, 16 * on, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(zx, G0 - 2, zr * 0.55 * on, 9 * on, 0, 0, Math.PI * 2); ctx.stroke();
      // 궤적 미리보기 (점선 U자)
      if (b.state === 'dive_wind') {
        var sx = cx, sy = b.y;
        var ex = clamp(zx + (zx - sx), b.w / 2, W.width - b.w / 2);
        var by = G0 - 4 - b.h;
        var cxp = 2 * zx - (sx + ex) / 2, cyp = 2 * by - sy;
        ctx.setLineDash([10, 10]);
        ctx.lineDashOffset = -clock * 60;
        ctx.strokeStyle = 'rgba(' + col + ',' + (0.35 + 0.35 * tele).toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sx, sy + b.h * 0.5); ctx.quadraticCurveTo(cxp, cyp + b.h * 0.5, ex, sy + b.h * 0.5); ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (b.state === 'beam_wind') {
      var a0 = b.ax0, a1 = b.ax1;
      var dir = a1 >= a0 ? 1 : -1;
      var reach = a0 + (a1 - a0) * easeOut(prog * 1.3);
      var lg = ctx.createLinearGradient(a0, 0, a1, 0);
      lg.addColorStop(0, 'rgba(' + col + ',' + (0.65 * (0.5 + 0.5 * tele)).toFixed(3) + ')');
      lg.addColorStop(1, 'rgba(' + col + ',0.15)');
      ctx.fillStyle = lg;
      ctx.fillRect(Math.min(a0, reach), G0 - 7, Math.abs(reach - a0), 7);
      ctx.fillStyle = 'rgba(' + col + ',' + (0.12 + 0.1 * tele).toFixed(3) + ')';
      ctx.fillRect(Math.min(a0, reach), G0 - QUEEN.beamH, Math.abs(reach - a0), QUEEN.beamH);
      ctx.fillRect(Math.min(a0, reach), G0 - QUEEN.beamH, Math.abs(reach - a0), 2);
      // 진행 방향 화살표
      ctx.strokeStyle = 'rgba(255,230,255,' + (0.5 + 0.4 * tele).toFixed(3) + ')';
      ctx.lineWidth = 4; ctx.lineJoin = 'round';
      for (var ch = 0; ch < 7; ch++) {
        var px = a0 + dir * (((clock * 240 + ch * 150) % 1050) + 20);
        if ((px - reach) * dir > 0) continue;
        ctx.beginPath();
        ctx.moveTo(px - dir * 14, G0 - 70); ctx.lineTo(px, G0 - 52); ctx.lineTo(px - dir * 14, G0 - 34);
        ctx.stroke();
      }
      // 조준선
      var mp = mouthPos(b);
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.25 + 0.5 * prog).toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(mp.x, mp.y); ctx.lineTo(a0, G0); ctx.stroke();
    } else if (b.state === 'gust_wind') {
      var R = QUEEN.gustRange * easeOut(prog * 1.2);
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.4 + 0.4 * tele).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cx, G0 - 2, R, 18, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(' + col + ',' + (0.08 + 0.08 * tele).toFixed(3) + ')';
      ctx.fillRect(cx - R, G0 - 160, R * 2, 160);
      ctx.strokeStyle = 'rgba(240,230,255,' + (0.5 + 0.4 * tele).toFixed(3) + ')';
      ctx.lineWidth = 4;
      for (var g = 0; g < 4; g++) {
        var off = ((clock * 200 + g * 140) % 560) + 40;
        for (var sd = -1; sd <= 1; sd += 2) {
          var gx = cx + sd * off;
          ctx.beginPath(); ctx.moveTo(gx - sd * 12, G0 - 60); ctx.lineTo(gx, G0 - 44); ctx.lineTo(gx - sd * 12, G0 - 28); ctx.stroke();
        }
      }
    } else if (b.state === 'spore_wind') {
      // 배의 포자 주머니가 부풀어 오름 → 포자 낙하 표식은 pod fx 가 그림
      var sg = ctx.createRadialGradient(cx, b.y + b.h * 0.75, 4, cx, b.y + b.h * 0.75, 70);
      sg.addColorStop(0, 'rgba(' + col + ',' + (0.35 * tele).toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(cx, b.y + b.h * 0.75, 70, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---- 포자 낙하 지점 표식 / 광선 그을음 (보스 뒤)
  function renderQueenGroundFx(ctx, f, G0) {
    if (f.kind === 'pod') {
      var pq = f.delay > 0 ? 0 : clamp(f.ft / f.fall, 0, 1);
      var a = 0.5 + 0.5 * Math.sin(clock * 16 + f.x);
      var r = QUEEN.cloudR * (1 - 0.35 * pq);
      ctx.strokeStyle = 'rgba(190,150,255,' + (0.5 + 0.4 * a).toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(f.x, G0 - 2, r, 9, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(178,140,255,' + (0.1 + 0.25 * pq).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(f.x, G0 - 2, r * pq, 9 * pq, 0, 0, Math.PI * 2); ctx.fill();
      // 생물 위험 표시 (세 갈래)
      ctx.strokeStyle = 'rgba(198,255,122,' + (0.5 + 0.4 * a).toFixed(3) + ')';
      ctx.lineWidth = 2;
      for (var i = 0; i < 3; i++) {
        var an = i * 2.094 + clock * 2;
        ctx.beginPath(); ctx.ellipse(f.x + Math.cos(an) * 12, G0 - 2 + Math.sin(an) * 3, 7, 3, 0, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (f.kind === 'scorch') {
      var sa = clamp(1 - f.t / f.life, 0, 1);
      for (var j = 0; j + 1 < f.list.length; j += 2) {
        ctx.fillStyle = 'rgba(30,10,30,' + (0.55 * sa).toFixed(3) + ')';
        ctx.beginPath(); ctx.ellipse(f.list[j], G0 - 1, 22, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,90,210,' + (0.35 * sa).toFixed(3) + ')';
        ctx.fillRect(f.list[j] - 10, G0 - 2, 20, 2);
      }
    }
  }

  // ---- 공중 fx (보스 앞)
  function renderQueenAirFx(ctx, f, G0) {
    var i;
    if (f.kind === 'pod') {
      if (f.cx == null) return;
      ctx.save();
      ctx.translate(f.cx, f.cy);
      ctx.rotate(Math.sin(f.ft * 9 + f.spin) * 0.5);
      ctx.shadowColor = f.enr ? PINK : VIOLET; ctx.shadowBlur = 14;
      var g = ctx.createRadialGradient(-3, -4, 1, 0, 0, 14);
      g.addColorStop(0, '#f0e4ff');
      g.addColorStop(0.45, f.enr ? '#ff8ae0' : VIOLET);
      g.addColorStop(1, '#3a2458');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(198,255,122,0.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.quadraticCurveTo(5, 0, 0, 13); ctx.moveTo(-8, -6); ctx.quadraticCurveTo(-2, 2, -6, 10); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(198,255,122,0.4)';
      for (i = 1; i < 5; i++) ctx.fillRect(f.cx - (f.vx2 || 0) * 0.008 * i - 1, f.cy - (f.vy2 || 0) * 0.008 * i - 1, 3, 3);
    } else if (f.kind === 'cloud') {
      var la = clamp(f.t / 0.2, 0, 1) * clamp((f.life - f.t) / 0.7, 0, 1);
      for (i = 0; i < 6; i++) {
        var px = f.x + Math.sin(i * 2.4 + f.t * 0.9) * f.r * 0.55;
        var py = G0 - f.r * (0.3 + 0.18 * (i % 3)) - Math.sin(f.t * 1.3 + i) * 6;
        var pr = f.r * (0.45 + 0.12 * (i % 3)) * (0.8 + 0.2 * clamp(f.t / 0.4, 0, 1));
        var cg = ctx.createRadialGradient(px, py, 2, px, py, pr);
        cg.addColorStop(0, (i % 2 ? 'rgba(198,255,122,' : 'rgba(190,150,255,') + (0.45 * la).toFixed(3) + ')');
        cg.addColorStop(1, 'rgba(120,80,180,0)');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(240,255,200,' + (0.7 * la).toFixed(3) + ')';
      for (i = 0; i < 8; i++) {
        var sx = f.x + Math.sin(i * 7.1 + f.t * 2) * f.r * 0.8;
        var sy = G0 - ((f.t * 40 + i * 23) % (f.r * 1.1));
        ctx.fillRect(sx, sy, 2, 2);
      }
    } else if (f.kind === 'beam') {
      if (f.bx == null) return;
      var b = findBoss();
      var sx2 = b ? mouthPos(b).x : f.x0, sy2 = b ? mouthPos(b).y : f.sy;
      var c1 = f.enr ? '255,90,210' : '198,255,122';
      ctx.save();
      ctx.lineCap = 'round';
      var fl = 0.85 + 0.15 * Math.sin(clock * 60);
      ctx.strokeStyle = 'rgba(' + c1 + ',' + (0.22 * fl).toFixed(3) + ')'; ctx.lineWidth = 30;
      ctx.beginPath(); ctx.moveTo(sx2, sy2); ctx.lineTo(f.bx, G0); ctx.stroke();
      ctx.shadowColor = f.enr ? PINK : TOXIC; ctx.shadowBlur = 18;
      ctx.strokeStyle = 'rgba(' + c1 + ',' + (0.75 * fl).toFixed(3) + ')'; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(sx2, sy2); ctx.lineTo(f.bx, G0); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,240,0.95)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sx2, sy2); ctx.lineTo(f.bx, G0); ctx.stroke();
      ctx.shadowBlur = 0;
      // 착탄점: 솟구치는 독 불꽃 (= 피해 범위)
      var H = QUEEN.beamH;
      for (i = 0; i < 7; i++) {
        var fx = f.bx + (i - 3) * 6 + Math.sin(clock * 40 + i) * 3;
        var fh = H * (0.45 + 0.55 * Math.abs(Math.sin(clock * 23 + i * 1.7)));
        var tg = ctx.createLinearGradient(0, G0, 0, G0 - fh);
        tg.addColorStop(0, 'rgba(255,255,230,0.9)');
        tg.addColorStop(0.4, 'rgba(' + c1 + ',0.75)');
        tg.addColorStop(1, 'rgba(' + c1 + ',0)');
        ctx.fillStyle = tg;
        ctx.beginPath(); ctx.moveTo(fx - 7, G0); ctx.quadraticCurveTo(fx - 4, G0 - fh * 0.6, fx, G0 - fh); ctx.quadraticCurveTo(fx + 4, G0 - fh * 0.6, fx + 7, G0); ctx.closePath(); ctx.fill();
      }
      var rg = ctx.createRadialGradient(f.bx, G0, 2, f.bx, G0, 60);
      rg.addColorStop(0, 'rgba(255,255,230,0.8)');
      rg.addColorStop(1, 'rgba(' + c1 + ',0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.ellipse(f.bx, G0, 60, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (f.kind === 'dart' && f.delay <= 0) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(Math.atan2(f.vy, f.vx));
      ctx.shadowColor = TOXIC; ctx.shadowBlur = 8;
      ctx.fillStyle = '#c9d8a0';
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.quadraticCurveTo(0, -6, -16, -3); ctx.lineTo(-12, 0); ctx.lineTo(-16, 3); ctx.quadraticCurveTo(0, 6, 12, 0); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#4c6a28'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-16, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(198,255,122,0.35)';
      ctx.fillRect(-40, -1.5, 24, 3);
      ctx.restore();
    } else if (f.kind === 'stuck') {
      var sa = clamp(1 - f.t / f.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = sa;
      ctx.translate(f.x, G0 - 2);
      ctx.rotate(f.a);
      ctx.fillStyle = '#c9d8a0';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-10, -5, -22, -3); ctx.lineTo(-22, 3); ctx.quadraticCurveTo(-10, 5, 0, 0); ctx.fill();
      ctx.restore();
    } else if (f.kind === 'gustfx') {
      var gp = f.t / f.life;
      for (i = 0; i < 3; i++) {
        var q = gp * 1.3 - i * 0.15;
        if (q <= 0 || q >= 1) continue;
        var R = 40 + q * QUEEN.gustRange;
        ctx.strokeStyle = 'rgba(230,240,255,' + (0.6 * (1 - q)).toFixed(3) + ')';
        ctx.lineWidth = 6 * (1 - q) + 1;
        ctx.beginPath(); ctx.arc(f.x, f.y, R, -0.7, 0.7); ctx.stroke();
        ctx.beginPath(); ctx.arc(f.x, f.y, R, Math.PI - 0.7, Math.PI + 0.7); ctx.stroke();
        ctx.strokeStyle = 'rgba(198,255,122,' + (0.4 * (1 - q)).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, R * 0.8, -0.5, 0.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(f.x, f.y, R * 0.8, Math.PI - 0.5, Math.PI + 0.5); ctx.stroke();
      }
    }
  }

  // ================================================================ 보스 3 '강철 지네' (권한측 AI + 공용 몸통 경로)
  // 녹슨 강철 마디 15개가 머리의 지나간 경로를 따라오는 거대 지네. 땅속을 파고들어 목표 밑에서 솟구치고,
  // 레일 위를 달리듯 불꽃을 튀기며 돌진(쇳물 자국), 녹은 고철을 흩뿌리고, 몸을 감았다가 꼬리를 휘두른다.
  // 격노: 더 빠르고, 연속 잠행, 마디 드론 분리.
  //  burrow: 파고듦 → 땅속 이동 (먼지 줄) → 표식 → 솟구침 22    rail : 레일 돌진 20 + 쇳물 띠 4/0.5s
  //  spray : 녹은 고철 6~9개 (착탄 표식) 11 + 쇳물 웅덩이      whip : 몸 감기 → 꼬리 휘두르기 (낮은 띠, 점프) 16
  //  drones: (격노 전용) 꼬리 마디 3개를 드론으로 분리

  function centHead(m) { return { x: bcx(m) + m.facing * (m.w / 2 - 26), y: m.y + 44 }; }

  // 모든 클라이언트: 머리 경로 기록 → 마디 위치 (m.segPts = [{x,y,a}], 0 = 머리)
  // 경로는 땅 기준 높이로 저장 (창 크기가 바뀌어 groundY 가 달라져도 몸이 뜨지 않게)
  function centTrail(m) {
    var G0 = gy();
    var h0 = centHead(m);
    var h = { x: h0.x, y: G0 - h0.y };
    if (!m.trail || !m.trail.length) {
      m.trail = [];
      for (var i = CENTI.segs * CENTI.segGap + 40; i >= 0; i -= 8) m.trail.push(h.x - m.facing * i, h.y);
    }
    var tr = m.trail;
    var lx = tr[tr.length - 2], ly = tr[tr.length - 1];
    var dx = h.x - lx, dy = h.y - ly;
    if (dx * dx + dy * dy > 16) tr.push(h.x, h.y);
    else { tr[tr.length - 2] = h.x; tr[tr.length - 1] = h.y; }
    // 경로 길이 제한
    var need = CENTI.segs * CENTI.segGap + 60, len = 0;
    for (var j = tr.length - 2; j >= 2; j -= 2) {
      len += Math.sqrt((tr[j] - tr[j - 2]) * (tr[j] - tr[j - 2]) + (tr[j + 1] - tr[j - 1]) * (tr[j + 1] - tr[j - 1]));
      if (len > need) { tr.splice(0, j - 2); break; }
    }
    // 머리에서부터 경로를 따라 segGap 간격으로 마디 배치
    var pts = [{ x: h.x, y: G0 - h.y, a: m.facing > 0 ? 0 : Math.PI }];
    var k = tr.length - 2, px = h.x, py = h.y, acc = 0, want = CENTI.segGap;
    while (pts.length < CENTI.segs && k >= 0) {
      var qx = tr[k], qy = tr[k + 1];
      var sd = Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py));
      if (acc + sd >= want && sd > 0) {
        var r = (want - acc) / sd;
        var nx = px + (qx - px) * r, ny = py + (qy - py) * r;
        var prev = pts[pts.length - 1];
        pts.push({ x: nx, y: G0 - ny, a: Math.atan2(prev.y - (G0 - ny), prev.x - nx) });
        px = nx; py = ny; acc = 0;
      } else { acc += sd; px = qx; py = qy; k -= 2; }
    }
    while (pts.length < CENTI.segs) { var l2 = pts[pts.length - 1]; pts.push({ x: l2.x - m.facing * CENTI.segGap, y: l2.y, a: l2.a }); }
    if (pts.length > 1) pts[0].a = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
    m.segPts = pts;
    m.segG0 = G0;
  }

  function centUnder(m) { return m.state === 'dig' || m.state === 'erupt_wind' || (m.state === 'intro' && !m.launched); }

  function centPhysics(m, dt) {
    var W = world(), G0 = W.groundY;
    if (centUnder(m)) {
      // 땅속: 머리를 땅 밑으로 끌어내림
      m.x += m.vx * dt;
      m.y = Math.min(G0 + 40, m.y + 700 * dt);
      m.vy = 0; m.onGround = false;
    } else {
      if (m.vy < -150 && m.state !== 'erupt' && m.state !== 'intro') m.vy = -150;   // 들어 올리기 방지
      m.vy += gravity() * dt;
      if (m.vy > 2200) m.vy = 2200;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.onGround = false;
      if (m.y + m.h >= G0) { m.y = G0 - m.h; m.vy = 0; m.onGround = true; }
    }
    m.hitWall = 0;
    if (m.x < 0) { m.x = 0; m.hitWall = -1; if (m.vx < 0) m.vx = 0; }
    if (m.x + m.w > W.width) { m.x = W.width - m.w; m.hitWall = 1; if (m.vx > 0) m.vx = 0; }
  }

  function chooseCentiPattern(m, tgt) {
    var dist = tgt ? Math.abs((tgt.x + tgt.w / 2) - bcx(m)) : 600;
    var opts = [
      ['burrow', dist > 300 ? 2.4 : 1.4],
      ['rail', dist > 360 ? 2.6 : 0.9],
      ['spray', dist > 250 ? 2.2 : 1.2],
      ['whip', dist < CENTI.whipR + 40 ? 3.0 : 0.6]
    ];
    if (m.enraged) opts.push(['drones', (m.summonCd <= 0 && countType('drone') < 4 && aliveCount() < MAX_ALIVE + 2) ? 1.6 : 0]);
    var total = 0, i;
    for (i = 0; i < opts.length; i++) {
      if (opts[i][0] === m.lastPat) opts[i][1] *= 0.2;
      total += opts[i][1];
    }
    var r = Math.random() * total;
    for (i = 0; i < opts.length; i++) { r -= opts[i][1]; if (r <= 0) return opts[i][0]; }
    return 'rail';
  }

  function startCentiPattern(m, p, tgt) {
    var mul = bossMul(m);
    m.lastPat = p;
    var tx = tgt ? tgt.x + tgt.w / 2 : bcx(m) + m.facing * 400;
    m.facing = tx >= bcx(m) ? 1 : -1;
    m.vx = 0;
    if (p === 'burrow') {
      m.slam2 = false;
      setBossState(m, 'burrow_wind', CENTI.burrowWind * mul);
    } else if (p === 'rail') {
      setBossState(m, 'rail_wind', CENTI.railWind * mul);
    } else if (p === 'spray') {
      var dur = CENTI.sprayWind * mul;
      setBossState(m, 'spray_wind', dur);
      fireScrap(m, tgt, dur);
    } else if (p === 'whip') {
      setBossState(m, 'whip_wind', CENTI.whipWind * mul);
    } else if (p === 'drones') {
      m.summonCd = CENTI.droneCd;
      setBossState(m, 'drone_wind', CENTI.droneWind);
      var mp = mouthPos(m);
      bossEmit({ kind: 'roar', x: Math.round(mp.x), dy: Math.round(gy() - mp.y), dir: m.facing });
    }
  }

  function fireScrap(m, tgt, delay) {
    var mp = mouthPos(m);
    mp.y -= 30;   // 고개를 치켜든 위치
    var G0 = gy();
    var n = m.enraged ? CENTI.scrapsEnr : CENTI.scraps;
    var baseX = tgt ? tgt.x + tgt.w / 2 : mp.x + m.facing * 450;
    var g = gravity() * 0.5;
    var list = [];
    for (var i = 0; i < n; i++) {
      var off = (i - (n - 1) / 2) * 95 + rand(-20, 20);
      var ax = clamp(baseX + off, 20, world().width - 20);
      var T = CENTI.scrapT * (0.8 + 0.4 * Math.random());
      var vx = (ax - mp.x) / T;
      var vy = ((G0 - mp.y) - 0.5 * g * T * T) / T;
      list.push([Math.round(mp.x), Math.round(G0 - mp.y), Math.round(vx), Math.round(vy), Math.round(ax)]);
    }
    bossEmit({ kind: 'scrap', list: list, delay: Math.round(delay * 100) / 100, enr: m.enraged ? 1 : 0 });
  }

  function spawnDrones(m) {
    var pts = m.segPts || [];
    for (var i = 0; i < CENTI.drones; i++) {
      if (aliveCount() >= MAX_ALIVE + 4) break;
      var sp = pts[pts.length - 1 - i * 2] || { x: bcx(m) - m.facing * 200, y: gy() - 30 };
      var d = makeMutant('drone', nextId++, clamp(sp.x - 19, 0, world().width - 38), Math.min(sp.y - 13, gy() - 26));
      d.facing = m.facing;
      d.vx = rand(-260, 260); d.vy = rand(-560, -380);
      d.state = 'hurt'; d.stateTimer = 0.5;
      Mutants.list.push(d);
      particles(sp.x, sp.y, 14, '#ff9a3a', 260);
      send({ t: 'mutantFx', kind: 'spawn', id: d.id, x: Math.round(sp.x), y: Math.round(sp.y), gy: gy() });
    }
  }

  function updateCenti(m, dt) {
    var mul = bossMul(m);
    var W = world(), G0 = W.groundY;
    var tgt = nearestTarget(m);
    m.target = tgt;
    if (m.summonCd > 0) m.summonCd -= dt;
    var dxT = tgt ? (tgt.x + tgt.w / 2) - bcx(m) : 0;
    m.stateTimer -= dt;
    var done = m.stateTimer <= 0;

    switch (m.state) {
      case 'intro':
        // 땅속에서 우르릉 → 솟구쳐 착지
        if (!m.launched && m.stateTimer <= 1.0) {
          m.launched = true;
          m.y = G0 - m.h; m.vy = -1100; m.vx = m.facing * 60;
          bossEmit({ kind: 'erupt', x: Math.round(bcx(m)), w: 300, h: 0, dmg: 0 });
        } else if (m.launched && m.onGround && m.stateDur - m.stateTimer > 1.3) {
          m.vx = 0;
          bossEmit({ kind: 'land', x: Math.round(bcx(m)) });
          setBossState(m, 'roar', BOSS.roarTime);
          var mp0 = mouthPos(m);
          bossEmit({ kind: 'roar', x: Math.round(mp0.x), dy: Math.round(G0 - mp0.y), dir: m.facing });
        } else if (!m.launched && Math.random() < 0.4) {
          particles(bcx(m) + rand(-80, 80), G0 - 4, 1, '#c9b48a', 200);
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
        var spd = m.enraged ? CENTI.walkEnr : CENTI.walk;
        if (tgt) {
          m.facing = dxT >= 0 ? 1 : -1;
          var want = Math.abs(dxT) > m.w * 0.5 + 70 ? m.facing * spd : 0;
          m.vx = approach(m.vx, want, 600, dt);
          if (m.cool <= 0) startCentiPattern(m, chooseCentiPattern(m, tgt), tgt);
        } else m.vx = approach(m.vx, 0, 600, dt);
        break;

      case 'burrow_wind':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) {
          bossEmit({ kind: 'dig', x: Math.round(centHead(m).x) });
          m.aux = tgt ? tgt.x + tgt.w / 2 : bcx(m);
          setBossState(m, 'dig', CENTI.digMax);
        }
        break;

      case 'dig':
        // 땅속 이동: 목표를 따라감 (지면 위엔 먼지 줄만)
        if (tgt) m.aux = tgt.x + tgt.w / 2;
        var dd = m.aux - bcx(m);
        m.facing = dd >= 0 ? 1 : -1;
        m.vx = clamp(dd * 4, -CENTI.digSpd, CENTI.digSpd);
        if (Math.random() < 0.6) particles(bcx(m) + rand(-30, 30), G0 - 4, 1, '#c9b48a', 180);
        if ((Math.abs(dd) < 30 && m.stateDur - m.stateTimer > 0.45) || done) {
          m.vx = 0;
          m.aux = bcx(m);
          setBossState(m, 'erupt_wind', CENTI.eruptWind * mul * (m.slam2 ? 0.75 : 1));
        }
        break;

      case 'erupt_wind':
        m.vx = 0;
        if (Math.random() < 0.5) particles(m.aux + rand(-110, 110), G0 - 4, 1, '#ff9a3a', 220);
        if (done) {
          bossEmit({ kind: 'erupt', x: Math.round(m.aux), w: CENTI.eruptW, h: CENTI.eruptH, dmg: CENTI.eruptDmg });
          m.y = G0 - m.h; m.vy = CENTI.eruptVy; m.vx = m.facing * 120;
          setBossState(m, 'erupt', 3);
        }
        break;

      case 'erupt':
        if (m.onGround && m.stateDur - m.stateTimer > 0.15) {
          shake(12);
          particles(bcx(m), G0 - 6, 20, '#c9b48a', 300);
          if (m.enraged && !m.slam2) { m.slam2 = true; setBossState(m, 'burrow_wind', 0.4); }
          else setBossState(m, 'recover', 0.8 * mul);
        }
        break;

      case 'rail_wind':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (Math.random() < 0.5) particles(centHead(m).x, G0 - 4, 2, '#ffcf7a', 260);
        if (done) { m.aux = bcx(m); setBossState(m, 'rail', CENTI.railT); shake(8); }
        break;

      case 'rail':
        m.vx = m.facing * (m.enraged ? CENTI.railSpdEnr : CENTI.railSpd);
        if (Math.random() < 0.8) particles(bcx(m) - m.facing * 40, G0 - 4, 2, Math.random() < 0.5 ? '#ffcf7a' : '#ff7a2a', 300);
        if (m.hitWall === m.facing || done) {
          bossEmit({ kind: 'slag', x0: Math.round(m.aux), x1: Math.round(bcx(m)) });
          if (m.hitWall === m.facing) {
            shake(20);
            particles(m.facing > 0 ? m.x + m.w : m.x, m.y + m.h * 0.5, 30, '#ffcf7a', 380);
            m.vx = -m.facing * 200;
            setBossState(m, 'stagger', 1.5);
          } else setBossState(m, 'stagger', 0.8 * mul + 0.2);
        }
        break;

      case 'stagger':
        m.vx = approach(m.vx, 0, 1600, dt);
        if (done) { setBossState(m, 'walk', 0); m.cool = CENTI.cool * mul * 0.6; }
        break;

      case 'spray_wind':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) setBossState(m, 'spray', 0.5);
        break;

      case 'spray':
        if (done) setBossState(m, 'recover', 0.6 * mul);
        break;

      case 'whip_wind':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) {
          bossEmit({ kind: 'whip', x: Math.round(bcx(m)), r: CENTI.whipR, h: CENTI.whipH, dmg: CENTI.whipDmg, dir: m.facing });
          setBossState(m, 'whip', 0.5);
        }
        break;

      case 'whip':
        if (done) setBossState(m, 'recover', 0.6 * mul);
        break;

      case 'drone_wind':
        m.vx = approach(m.vx, 0, 3000, dt);
        if (done) { spawnDrones(m); setBossState(m, 'recover', 0.5); }
        break;

      case 'recover':
        m.vx = approach(m.vx, 0, 2000, dt);
        if (done) { setBossState(m, 'walk', 0); m.cool = CENTI.cool * mul; }
        break;

      default:
        setBossState(m, 'walk', 0);
    }
    centPhysics(m, dt);
  }

  // 접촉: 머리(판정 상자) + 지면 위 마디 몸통 (로컬: 모든 클라이언트 / 봇: 권한측)
  function centContact(m, dt) {
    for (var k in m.botCd) if (m.botCd[k] > 0) m.botCd[k] -= dt;
    if (centUnder(m) || m.state === 'intro') return;
    var railing = m.state === 'rail';
    var G0 = gy();
    var head = { x: m.x + 12, y: m.y + 12, w: m.w - 24, h: m.h - 12 };
    var pts = m.segPts || [];
    forVictims(function (p, key, isLocal) {
      var cd = isLocal ? m.dmgCd : (m.botCd[key] || 0);
      if (cd > 0) return;
      var hitHead = rectHit(head, p), hitBody = false;
      if (!hitHead) {
        for (var i = 3; i < pts.length; i++) {
          var s = pts[i];
          if (s.y > G0 + 4) continue;   // 땅속 마디
          if (rectHit({ x: s.x - 15, y: s.y - 15, w: 30, h: 30 }, p)) { hitBody = true; break; }
        }
      }
      if (!hitHead && !hitBody) return;
      var dir = (p.x + p.w / 2) >= bcx(m) ? 1 : -1;
      var ok;
      if (railing && hitHead) ok = hurt(p, isLocal, CENTI.railDmg, m.facing * CENTI.railKx, CENTI.railKy);
      else if (hitHead) ok = hurt(p, isLocal, CENTI.contactDmg, dir * TYPES.centipede.knockX, TYPES.centipede.knockY);
      else ok = hurt(p, isLocal, CENTI.bodyDmg, dir * 320, -300);
      if (ok || !isLocal) {
        var c = railing ? 0.8 : CENTI.bodyCd;
        if (isLocal) m.dmgCd = c; else m.botCd[key] = c;
      }
    });
  }

  // ================================================================ 보스 3 그래픽
  var STEEL = '#2e3433', STEEL_D = '#1a1f1e', STEEL_L = '#5c6664', MOLTEN = '#ff7a2a', MOLTEN_HOT = '#ffcf7a';

  function centPose(m) {
    var dur = m.stateDur > 0 ? m.stateDur : 1;
    var p = clamp(1 - m.stateTimer / dur, 0, 1);
    var pulse = 0.5 + 0.5 * Math.sin(clock * 26);
    var P = { tele: 0, glow: 0.35, jaw: 0.15 + 0.1 * Math.sin(clock * 3), rear: 0, coil: 0, dead: 0, jit: 0, gait: 1 };
    switch (m.state) {
      case 'burrow_wind': P.tele = pulse; P.glow = 0.7; P.rear = 0.6 * easeOut(p * 2); P.jit = 1; P.gait = 0; break;
      case 'rail_wind': P.tele = pulse; P.glow = 0.6 + 0.4 * pulse; P.jaw = 0.5; P.jit = 1.2; P.gait = 2.5; break;
      case 'rail': P.glow = 1; P.jaw = 0.7; P.gait = 3; break;
      case 'spray_wind': P.tele = pulse; P.rear = 0.9 * easeOut(p * 1.6); P.jaw = 0.3 + 0.6 * p; P.glow = 0.6 + 0.4 * pulse; P.gait = 0; break;
      case 'spray': P.rear = 0.9 * (1 - p); P.jaw = 1; P.glow = 1; P.gait = 0; break;
      case 'whip_wind': P.tele = pulse; P.coil = easeOut(p); P.glow = 0.6; P.jit = 0.8; P.gait = 0; break;
      case 'whip': P.coil = 1 - easeOut(p * 2); P.glow = 0.8; P.gait = 0; break;
      case 'roar': case 'enrage': case 'drone_wind':
        P.rear = 0.7; P.jaw = 1; P.glow = 0.7 + 0.3 * pulse; P.jit = m.state === 'enrage' ? 2.2 : 1; P.tele = m.state === 'roar' ? 0 : pulse * 0.6; P.gait = 0; break;
      case 'stagger': P.jaw = 0.4; P.gait = 0; P.jit = 0.6; break;
      case 'dead': P.dead = p; P.glow = 0.3 * (1 - p); P.jaw = 0.6; P.gait = 0; break;
    }
    if (m.enraged && m.state !== 'dead') P.glow = Math.max(P.glow, 0.55 + 0.25 * Math.sin(clock * 9));
    return P;
  }

  function centLeg(ctx, hx, hy, fx, fy, side, col, w) {
    // 무릎은 위·바깥쪽으로 꺾임
    var mx = (hx + fx) / 2 + side * 6, my = Math.min(hy, fy) - 16;
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(mx, my); ctx.lineTo(fx, fy); ctx.stroke();
  }

  function drawCenti(ctx, m) {
    var pts = m.segPts;
    if (!pts || !pts.length) return;
    var P = centPose(m);
    var G0 = gy();
    var n = pts.length;
    var enr = !!m.enraged;
    var sa = P.dead > 0 ? clamp(1 - P.dead, 0, 1) : 1;
    var jx = P.jit ? Math.sin(clock * 93) * P.jit : 0, jy = P.jit ? Math.cos(clock * 71) * P.jit * 0.6 : 0;
    var flash = m.hitFlash > 0 ? Math.min(1, m.hitFlash / 0.15) : 0;
    var glowA = P.glow;
    var moving = clamp(Math.abs(m.vx || 0) / 160, 0, 1) * P.gait;
    var i, s;
    var gOff = m.segG0 != null ? G0 - m.segG0 : 0;   // 계산 뒤 groundY 가 바뀐 경우 보정

    // 몸 휘기 (감기 / 고개 들기): 화면 좌표에서 오프셋
    var Q = [];
    for (i = 0; i < n; i++) {
      s = pts[i];
      var u = i / (n - 1);
      var ox = 0, oy = 0;
      if (P.rear > 0 && i < 6) oy -= P.rear * (6 - i) * 14;
      if (P.coil > 0) { var ca = u * Math.PI * 1.6; ox += -m.facing * Math.sin(ca) * 40 * P.coil * u; oy -= Math.sin(u * Math.PI) * 50 * P.coil; }
      if (P.dead > 0) oy += (G0 - 14 - s.y) * easeOut(P.dead * 1.5);
      Q.push({ x: s.x + ox + jx, y: s.y + gOff + oy + jy, a: s.a });
    }

    ctx.save();
    // 땅속 부분은 보이지 않게
    ctx.beginPath(); ctx.rect(-100000, -100000, 200000, G0 + 100000 + 2); ctx.clip();
    ctx.globalAlpha = sa < 1 ? clamp(sa * 1.6, 0, 1) : 1;

    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (i = 0; i < n; i += 2) {
      if (Q[i].y > G0 + 4) continue;
      var hgt = clamp((G0 - Q[i].y) / 300, 0, 1);
      ctx.beginPath(); ctx.ellipse(Q[i].x, G0, 24 * (1 - hgt * 0.6), 5, 0, 0, Math.PI * 2); ctx.fill();
    }

    // 다리 (먼 쪽 → 몸 → 가까운 쪽)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    function legs(far) {
      for (var li = 1; li < n; li++) {
        var q = Q[li];
        if (q.y > G0 + 10) continue;
        var tap = 1 - li / n * 0.35;
        var ph = (m.animT || clock) * 6 + li * 0.9 + (far ? Math.PI : 0);
        var near = q.y > G0 - 70;
        var fx, fy;
        if (near) {
          fx = q.x + Math.sin(ph) * 16 * moving + (far ? -6 : 6) * -m.facing;
          fy = G0 - Math.max(0, Math.cos(ph)) * 10 * moving;
        } else {
          fx = q.x + (far ? -10 : 10) + Math.sin(clock * 5 + li) * 6;
          fy = q.y + 40 * tap;
        }
        var hx = q.x + (far ? -4 : 4), hy = q.y + 8 * tap;
        centLeg(ctx, hx, hy, fx, fy, far ? -1 : 1, far ? '#101413' : STEEL_D, (far ? 4 : 5) * tap);
        if (!far) {
          ctx.strokeStyle = 'rgba(255,122,42,' + (0.35 * glowA).toFixed(3) + ')'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo((hx + fx) / 2 + 6, Math.min(hy, fy) - 16); ctx.stroke();
          ctx.fillStyle = '#8a949a';
          ctx.beginPath(); ctx.arc(fx, fy, 2.2 * tap, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    legs(true);

    // 마디 (꼬리 → 머리)
    for (i = n - 1; i >= 1; i--) {
      s = Q[i];
      if (s.y > G0 + 26) continue;
      var t2 = 1 - i / n * 0.38;
      var rx = 21 * t2, ry = 18 * t2;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.a);
      // 마디 사이 쇳물 이음새
      ctx.save();
      ctx.shadowColor = enr ? '#ff3a1a' : MOLTEN; ctx.shadowBlur = 6 + 12 * glowA;
      ctx.fillStyle = 'rgba(255,' + (enr ? 80 : 130) + ',40,' + (0.5 + 0.5 * glowA).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(-rx * 0.85, 0, 5 * t2, ry * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      var g = ctx.createLinearGradient(0, -ry, 0, ry);
      g.addColorStop(0, STEEL_L);
      g.addColorStop(0.35, '#3e4644');
      g.addColorStop(1, STEEL_D);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      // 등판 (겹친 장갑)
      ctx.fillStyle = '#4a5250';
      ctx.beginPath(); ctx.ellipse(-2, -ry * 0.35, rx * 0.85, ry * 0.55, 0, Math.PI, 0); ctx.fill();
      // 녹
      if ((i * 7) % 3 !== 0) rust(ctx, rx * 0.2 - (i % 2) * 8, -ry * 0.1, 7 * t2, 4 * t2);
      // 리벳
      ctx.fillStyle = '#9aa4a8';
      ctx.beginPath(); ctx.arc(-rx * 0.4, -ry * 0.55, 1.8, 0, Math.PI * 2); ctx.arc(rx * 0.4, -ry * 0.55, 1.8, 0, Math.PI * 2); ctx.fill();
      // 등 가시 (짝수 마디)
      if (i % 2 === 0) {
        ctx.fillStyle = '#7a3a14';
        ctx.beginPath(); ctx.moveTo(-4, -ry * 0.8); ctx.lineTo(4, -ry * 0.8); ctx.lineTo(-6, -ry - 12 * t2); ctx.closePath(); ctx.fill();
      }
      if (i % 4 === 1) moss(ctx, -rx * 0.3, -ry * 0.75, 4 * t2, i * 0.13);
      // 아랫배 쇳물 발광
      ctx.fillStyle = 'rgba(255,' + (enr ? 90 : 150) + ',50,' + (0.25 + 0.4 * glowA).toFixed(3) + ')';
      ctx.fillRect(-rx * 0.6, ry * 0.45, rx * 1.2, 2.5);
      if (P.tele > 0) { ctx.fillStyle = 'rgba(255,170,60,' + (0.12 + 0.2 * P.tele).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
      if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + (0.8 * flash).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
      if (P.dead > 0) { ctx.fillStyle = 'rgba(10,8,6,' + (0.55 * P.dead).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
      // 꼬리 집게
      if (i === n - 1) {
        ctx.strokeStyle = STEEL_D; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-rx, -3); ctx.quadraticCurveTo(-rx - 18, -10, -rx - 26, -2); ctx.moveTo(-rx, 3); ctx.quadraticCurveTo(-rx - 18, 10, -rx - 26, 2); ctx.stroke();
      }
      ctx.restore();
    }
    legs(false);

    // 머리
    s = Q[0];
    if (s.y < G0 + 30) {
      ctx.save();
      ctx.translate(s.x, s.y);
      var fa = s.a;
      var flip = Math.cos(fa) < 0 ? -1 : 1;
      ctx.rotate(fa);
      ctx.scale(1, flip);
      // 더듬이 (긴 철사)
      ctx.strokeStyle = '#8a949a'; ctx.lineWidth = 2;
      for (var an = -1; an <= 1; an += 2) {
        var sw = Math.sin(clock * 4 + an) * 8;
        ctx.beginPath(); ctx.moveTo(14, -14); ctx.quadraticCurveTo(50, -40 + an * 6 + sw, 92, -26 + an * 14 + sw); ctx.stroke();
      }
      // 큰 턱 (집게) — jaw 로 벌어짐
      var jaw = P.jaw;
      ctx.fillStyle = '#3e4644';
      for (var sd = -1; sd <= 1; sd += 2) {
        ctx.save();
        ctx.translate(26, sd * 8);
        ctx.rotate(sd * (0.15 + 0.5 * jaw));
        ctx.beginPath(); ctx.moveTo(0, -4 * sd); ctx.quadraticCurveTo(30, -2 * sd, 38, 10 * sd); ctx.lineTo(30, 6 * sd); ctx.quadraticCurveTo(18, 4 * sd, 0, 5 * sd); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c9b48a';
        ctx.beginPath(); ctx.arc(36, 9 * sd, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3e4644';
        ctx.restore();
      }
      // 용광로 입 (분사/돌진 시 밝게)
      ctx.save();
      ctx.shadowColor = enr ? '#ff3a1a' : MOLTEN; ctx.shadowBlur = 10 + 18 * glowA;
      ctx.fillStyle = jaw > 0.5 ? MOLTEN_HOT : MOLTEN;
      ctx.beginPath(); ctx.ellipse(28, 0, 6 + 6 * jaw, 4 + 4 * jaw, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 머리 장갑
      var hg = ctx.createLinearGradient(0, -26, 0, 24);
      hg.addColorStop(0, '#6c7674');
      hg.addColorStop(0.4, '#3e4644');
      hg.addColorStop(1, STEEL_D);
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.moveTo(-22, -20); ctx.quadraticCurveTo(10, -32, 30, -12); ctx.lineTo(32, 10); ctx.quadraticCurveTo(8, 26, -22, 20); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#1a1f1e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-14, -22); ctx.lineTo(-10, 20); ctx.moveTo(4, -24); ctx.lineTo(8, 22); ctx.stroke();
      rust(ctx, -4, -12, 9, 5);
      // 볏 (녹슨 톱날)
      ctx.fillStyle = '#7a3a14';
      ctx.beginPath(); ctx.moveTo(-20, -20);
      for (var c = 0; c < 4; c++) { ctx.lineTo(-14 + c * 11, -34 - (c % 2) * 6); ctx.lineTo(-9 + c * 11, -24); }
      ctx.closePath(); ctx.fill();
      // 눈 무리 (불씨처럼)
      var ec = enr ? '#ff3a1a' : '#ff9a3a';
      ctx.save();
      ctx.shadowColor = ec; ctx.shadowBlur = 8 + 14 * glowA;
      ctx.fillStyle = glowA > 0.7 ? MOLTEN_HOT : ec;
      var eyes = [[16, -12, 4], [22, -6, 3], [10, -6, 3], [18, 2, 2.4]];
      for (var e = 0; e < eyes.length; e++) { ctx.beginPath(); ctx.arc(eyes[e][0], eyes[e][1], eyes[e][2] * (1 + 0.3 * glowA), 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      // 깨진 전조등
      ctx.fillStyle = 'rgba(230,240,200,' + (0.35 + 0.3 * Math.abs(Math.sin(clock * 7))).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(-2, 8, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1a1f1e'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-2, 8, 6, 0, Math.PI * 2); ctx.moveTo(-6, 4); ctx.lineTo(0, 10); ctx.stroke();
      if (P.tele > 0) { ctx.fillStyle = 'rgba(255,170,60,' + (0.15 + 0.25 * P.tele).toFixed(3) + ')'; ctx.fillRect(-24, -34, 58, 60); }
      if (flash > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,255,255,' + (0.7 * flash).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(4, 0, 30, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
      ctx.restore();
    }
    // 격노 열기
    if (enr && sa > 0.5) {
      for (i = 0; i < n; i += 3) {
        if (Q[i].y > G0) continue;
        ctx.fillStyle = 'rgba(255,90,30,' + (0.25 + 0.2 * Math.sin(clock * 10 + i)).toFixed(3) + ')';
        ctx.fillRect(Q[i].x - 1, Q[i].y - 26 - ((clock * 60 + i * 13) % 30), 2, 4);
      }
    }
    ctx.restore();
    // 레일 돌진 불꽃 꼬리
    if (m.state === 'rail') {
      ctx.strokeStyle = 'rgba(255,207,122,0.55)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (var q2 = 0; q2 < 6; q2++) {
        var lx = bcx(m) - m.facing * (40 + q2 * 30), ly = G0 - 4 - (q2 % 3) * 4;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx - m.facing * (40 + q2 * 10), ly - 6 - q2 * 3); ctx.stroke();
      }
    }
  }

  // ---- 강철 지네 예고 (보스 뒤)
  function renderCentiTele(ctx, b, G0) {
    var tele = 0.5 + 0.5 * Math.sin(clock * 22);
    var dur = b.stateDur > 0 ? b.stateDur : 1;
    var prog = clamp(1 - b.stateTimer / dur, 0, 1);
    var col = b.enraged ? '255,60,30' : '255,160,60';
    var W = world();
    var cx = bcx(b);
    if (b.state === 'dig') {
      // 땅속 이동: 솟아오르는 흙더미 + 갈라짐
      for (var i = 0; i < 6; i++) {
        var x = cx - b.facing * i * 26;
        var hh = (6 - i) * 2 + Math.abs(Math.sin(clock * 20 + i)) * 4;
        ctx.fillStyle = 'rgba(90,74,58,' + (0.9 - i * 0.12).toFixed(3) + ')';
        ctx.beginPath(); ctx.ellipse(x, G0, 22, hh, 0, Math.PI, 0); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.4 + 0.4 * tele).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(b.aux, G0 - 2, 70, 9, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (b.state === 'erupt_wind') {
      var zw = CENTI.eruptW, zh = CENTI.eruptH;
      var cg = ctx.createLinearGradient(0, G0 - zh, 0, G0);
      cg.addColorStop(0, 'rgba(' + col + ',0)');
      cg.addColorStop(1, 'rgba(' + col + ',' + (0.2 + 0.25 * tele * prog).toFixed(3) + ')');
      ctx.fillStyle = cg;
      ctx.fillRect(b.aux - zw / 2, G0 - zh, zw, zh);
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.6 + 0.4 * tele).toFixed(3) + ')';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(b.aux, G0 - 2, zw / 2, 16, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(20,12,6,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (var c = 0; c < 8; c++) {
        var sg = c % 2 ? 1 : -1, ln = zw * 0.5 * (0.3 + 0.7 * prog) * (0.5 + ((c * 37) % 10) / 20);
        ctx.moveTo(b.aux, G0 - 1); ctx.lineTo(b.aux + sg * ln * 0.5, G0 - 3 - (c % 3)); ctx.lineTo(b.aux + sg * ln, G0 - 1);
      }
      ctx.stroke();
    } else if (b.state === 'rail_wind') {
      var x0 = cx + b.facing * b.w * 0.45;
      var len = Math.min(1500, b.facing > 0 ? W.width - x0 : x0);
      var x1 = x0 + b.facing * len * easeOut(prog * 1.5);
      var lg = ctx.createLinearGradient(x0, 0, x1, 0);
      lg.addColorStop(0, 'rgba(' + col + ',' + (0.45 + 0.25 * tele).toFixed(3) + ')');
      lg.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = lg;
      ctx.fillRect(Math.min(x0, x1), G0 - b.h, Math.abs(x1 - x0), b.h);
      // 레일 두 줄 + 튀는 전기 불꽃
      ctx.fillStyle = 'rgba(255,230,180,' + (0.6 + 0.3 * tele).toFixed(3) + ')';
      ctx.fillRect(Math.min(x0, x1), G0 - 6, Math.abs(x1 - x0), 2);
      ctx.fillRect(Math.min(x0, x1), G0 - 14, Math.abs(x1 - x0), 2);
      ctx.strokeStyle = 'rgba(255,240,200,0.85)'; ctx.lineWidth = 1.5;
      for (var s = 0; s < 5; s++) {
        var px = x0 + b.facing * ((clock * 700 + s * 230) % Math.max(60, len));
        if ((px - x1) * b.facing > 0) continue;
        ctx.beginPath(); ctx.moveTo(px, G0 - 8); ctx.lineTo(px + 6, G0 - 20); ctx.lineTo(px - 2, G0 - 26); ctx.lineTo(px + 4, G0 - 38); ctx.stroke();
      }
    } else if (b.state === 'whip_wind') {
      var R = CENTI.whipR, H = CENTI.whipH;
      ctx.fillStyle = 'rgba(' + col + ',' + (0.14 + 0.2 * tele * prog).toFixed(3) + ')';
      ctx.fillRect(cx - R, G0 - H, R * 2, H);
      ctx.setLineDash([12, 8]); ctx.lineDashOffset = -clock * 50;
      ctx.strokeStyle = 'rgba(255,230,180,' + (0.5 + 0.4 * tele).toFixed(3) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - R, G0 - H); ctx.lineTo(cx + R, G0 - H); ctx.stroke();
      ctx.setLineDash([]);
      // 위쪽 화살표 (점프!)
      ctx.strokeStyle = 'rgba(255,240,200,' + (0.5 + 0.4 * tele).toFixed(3) + ')'; ctx.lineWidth = 4;
      for (var a = -2; a <= 2; a++) {
        if (!a) continue;
        var ax = cx + a * R * 0.4;
        ctx.beginPath(); ctx.moveTo(ax - 12, G0 - H - 6); ctx.lineTo(ax, G0 - H - 20); ctx.lineTo(ax + 12, G0 - H - 6); ctx.stroke();
      }
    } else if (b.state === 'burrow_wind') {
      var h0 = centHead(b);
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.4 + 0.4 * tele).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(h0.x + b.facing * 20, G0 - 2, 50 + 30 * prog, 8, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ---- 강철 지네 fx
  function renderCentiFx(ctx, f, G0) {
    if (f.kind === 'slag' || f.kind === 'molten') {
      var a = clamp((f.life - f.t) / 0.6, 0, 1) * clamp(f.t / 0.1, 0, 1);
      var x0 = f.kind === 'slag' ? f.x0 : f.x - f.w / 2, x1 = f.kind === 'slag' ? f.x1 : f.x + f.w / 2;
      var g = ctx.createLinearGradient(0, G0 - 8, 0, G0);
      g.addColorStop(0, 'rgba(255,207,122,' + (0.9 * a).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,90,30,' + (0.75 * a).toFixed(3) + ')');
      ctx.save();
      ctx.shadowColor = MOLTEN; ctx.shadowBlur = 12;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse((x0 + x1) / 2, G0 - 2, (x1 - x0) / 2, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,240,200,' + (0.7 * a).toFixed(3) + ')';
      for (var i = 0; i < 5; i++) {
        var bx = x0 + ((i * 97 + clock * 40) % Math.max(10, x1 - x0));
        ctx.fillRect(bx, G0 - 6 - Math.abs(Math.sin(clock * 9 + i)) * 6, 2, 2);
      }
    } else if (f.kind === 'scrap') {
      // 착탄 표식
      var ta = 0.5 + 0.5 * Math.sin(clock * 16 + f.ax);
      ctx.strokeStyle = 'rgba(255,160,60,' + (0.5 + 0.4 * ta).toFixed(3) + ')'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(f.ax, G0 - 2, 26 + 6 * ta, 6, 0, 0, Math.PI * 2); ctx.stroke();
      if (f.delay > 0) return;
      ctx.save();
      ctx.translate(f.x, f.y); ctx.rotate(f.rot);
      ctx.shadowColor = MOLTEN; ctx.shadowBlur = 14;
      ctx.fillStyle = f.enr ? '#ff5a2a' : MOLTEN;
      ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(6, -9); ctx.lineTo(11, 2); ctx.lineTo(-2, 9); ctx.lineTo(-11, 4); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = MOLTEN_HOT;
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,160,60,0.45)';
      for (var k = 1; k < 4; k++) ctx.fillRect(f.x - f.vx * 0.012 * k - 1.5, f.y - f.vy * 0.012 * k - 1.5, 3, 3);
    } else if (f.kind === 'whipfx') {
      var p = f.t / f.life;
      ctx.save();
      ctx.lineCap = 'round';
      for (var s = 0; s < 3; s++) {
        var q = p * 1.3 - s * 0.12;
        if (q <= 0 || q >= 1) continue;
        ctx.strokeStyle = 'rgba(255,220,160,' + (0.75 * (1 - q)).toFixed(3) + ')';
        ctx.lineWidth = 8 * (1 - q) + 1;
        var R = f.r * (0.4 + 0.6 * q);
        ctx.beginPath(); ctx.ellipse(f.x, G0 - 30, R, 26, 0, Math.PI * 0.05, Math.PI * 0.95, true); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ---- 마디 드론 (원점: 발밑 중앙, +x = 앞)
  function drawDrone(ctx, m, wind, intensity) {
    var t = m.animT * 3;
    ctx.lineCap = 'round';
    for (var l = 0; l < 3; l++) {
      var ph = t + l * 2.1;
      ctx.strokeStyle = STEEL_D; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-8 + l * 8, -10); ctx.lineTo(-12 + l * 8 + Math.sin(ph) * 5, -18); ctx.lineTo(-10 + l * 8 + Math.sin(ph) * 7, -Math.max(0, Math.cos(ph)) * 4); ctx.stroke();
    }
    var g = ctx.createLinearGradient(0, -26, 0, -6);
    g.addColorStop(0, STEEL_L); g.addColorStop(1, STEEL_D);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, -14, 18, 11, 0, 0, Math.PI * 2); ctx.fill();
    rust(ctx, -4, -16, 5, 3);
    ctx.save();
    ctx.shadowColor = MOLTEN; ctx.shadowBlur = 6 + intensity * 12;
    ctx.fillStyle = intensity > 0.6 ? MOLTEN_HOT : MOLTEN;
    ctx.beginPath(); ctx.arc(12, -15, 3 + intensity * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-14, -9, 26, 2);
    ctx.restore();
  }
})();
