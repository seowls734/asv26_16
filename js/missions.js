/* 초능력자: 각성 — v3 미션 & 능력 해금 (Game.Progress, Game.Missions)
 * 수집품(이끼 뭉치), 무너진 시계탑, 용 비석 + 용의 시련, HUD 트래커, 클리어 배너, "능력 · 미션" 패널.
 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};

  var STORAGE_KEY = 'psyawaken.progress.v1';
  var SAVE_VERSION = 2;          // v1(=게임 v3): 기술 단위 해금 + 로드아웃 → v2: 능력(원소) 단위 해금
  var START_ELEMENT = 'fire';
  var SLOT_KEYS = ['J', 'K', 'L', 'I'];

  // 기술 정보 폴백 (Game.Skills.defs 가 없을 때 이름 표시용)
  var SKILL_FALLBACK = {
    fireball: { element: 'fire', elementName: '불꽃', name: '화염구', icon: '🔥', color: '#ff7a2a' },
    flamedash: { element: 'fire', elementName: '불꽃', name: '화염 질주', icon: '💨', color: '#ff7a2a' },
    pillar: { element: 'fire', elementName: '불꽃', name: '불기둥', icon: '🌋', color: '#ff7a2a' },
    inferno: { element: 'fire', elementName: '불꽃', name: '인페르노', icon: '💥', color: '#ff5a2a' },
    watercannon: { element: 'water', elementName: '물', name: '물대포', icon: '💧', color: '#3aa8ff' },
    vinebind: { element: 'grass', elementName: '풀', name: '덩굴 속박', icon: '🌿', color: '#5fc24a' },
    chainbolt: { element: 'electric', elementName: '전기', name: '연쇄 번개', icon: '⚡', color: '#ffe14a' },
    iceshard: { element: 'ice', elementName: '얼음', name: '얼음 창', icon: '❄️', color: '#9ae6ff' },
    tornado: { element: 'wind', elementName: '바람', name: '회오리', icon: '🌪️', color: '#b8f0d8' },
    rockspike: { element: 'rock', elementName: '바위', name: '바위 가시', icon: '🪨', color: '#b08a5a' },
    sandstorm: { element: 'sand', elementName: '모래', name: '모래 폭풍', icon: '🏜️', color: '#e0b860' },
    bodyboost: { element: 'body', elementName: '신체강화', name: '신체강화', icon: '💪', color: '#ff5050' },
    psychograb: { element: 'psychic', elementName: '염력', name: '염력', icon: '🧠', color: '#b070ff' },
    blackhole: { element: 'void', elementName: '블랙홀', name: '블랙홀', icon: '🕳️', color: '#7a5aff' },
    timestop: { element: 'time', elementName: '시간', name: '시간 정지', icon: '⏳', color: '#7ad0ff' },
    dragonsummon: { element: 'dragon', elementName: '용족', name: '용족 소환', icon: '🐉', color: '#ff9a3a' }
  };
  // 능력(원소) 폴백 목록 — Game.Skills.kits 가 없을 때
  var ELEMENT_FALLBACK = [
    ['fire', '불꽃', '🔥', '#ff7a2a', 'start', ['fireball', 'flamedash', 'pillar', 'inferno']],
    ['water', '물', '💧', '#3aa8ff', 'easy', ['watercannon']], ['grass', '풀', '🌿', '#5fc24a', 'easy', ['vinebind']],
    ['electric', '전기', '⚡', '#ffe14a', 'easy', ['chainbolt']], ['ice', '얼음', '❄️', '#9ae6ff', 'easy', ['iceshard']],
    ['wind', '바람', '🌪️', '#b8f0d8', 'easy', ['tornado']], ['rock', '바위', '🪨', '#b08a5a', 'easy', ['rockspike']],
    ['sand', '모래', '🏜️', '#e0b860', 'easy', ['sandstorm']], ['body', '신체강화', '💪', '#ff5050', 'easy', ['bodyboost']],
    ['psychic', '염력', '🧠', '#b070ff', 'hard', ['psychograb']], ['void', '블랙홀', '🕳️', '#7a5aff', 'hard', ['blackhole']],
    ['time', '시간', '⏳', '#7ad0ff', 'hard', ['timestop']], ['dragon', '용족', '🐉', '#ff9a3a', 'hard', ['dragonsummon']]
  ];

  // ===========================================================================
  // 미션 정의
  // ===========================================================================
  var DEFS = [
    { id: 'm_hunt', name: '첫 사냥', desc: '돌연변이 5마리 처치 (누적)', goal: 5, reward: 'watercannon' },
    { id: 'm_moss', name: '이끼 채집가', desc: '맵 곳곳의 빛나는 이끼 뭉치 5개 줍기 (누적)', goal: 5, reward: 'vinebind' },
    { id: 'm_marks', name: '명사수', desc: '기술로 돌연변이 30번 맞히기 (누적)', goal: 30, reward: 'chainbolt' },
    { id: 'm_cool', name: '냉정한 생존자', desc: '한 번에 60초 동안 피해를 받지 않기 (경기 중)', goal: 60, reward: 'iceshard', timed: true },
    { id: 'm_explore', name: '도시 탐험가', desc: '서로 다른 종류의 발판을 모두 밟기 (누적)', goal: 6, reward: 'tornado', dynamicGoal: true },
    { id: 'm_dog', name: '들개 사냥꾼', desc: '변이 들개 3마리 처치 (누적)', goal: 3, reward: 'rockspike' },
    { id: 'm_survive', name: '사막의 인내', desc: '혼자 연습에서 KO 없이 3분 생존 (한 출전 내)', goal: 180, reward: 'sandstorm', timed: true, onlyMode: 'practice' },
    { id: 'm_duel', name: '결투가', desc: '온라인 대전에서 다른 플레이어를 3번 KO (누적)', goal: 3, reward: 'bodyboost', onlyMode: 'online' },
    { id: 'h_flawless', hidden: true, name: '무결점', hint: '상처 하나 없는 자만이 마음으로 사물을 움직인다.',
      desc: '피해를 한 번도 받지 않고 돌연변이 25마리 연속 처치', goal: 25, reward: 'psychograb' },
    { id: 'h_bigbang', hidden: true, name: '대폭발', hint: '한 번의 불꽃으로 무리를 삼켜라.',
      desc: '인페르노 한 방으로 돌연변이 4마리 이상 처치', goal: 4, reward: 'blackhole' },
    { id: 'h_clock', hidden: true, name: '멈춘 시계', hint: '무너진 시계탑은 정확한 박자를 기억한다.',
      desc: '무너진 시계탑의 시계판에 투사체를 정확히 1초 간격으로 5연속 명중', goal: 5, reward: 'timestop' },
    { id: 'h_dragon', hidden: true, name: '용의 시련', hint: '세 개의 비석, 발톱 자국의 수를 세어라.',
      desc: '숨겨진 용 비석 3개를 발톱 수 순서대로 깨우고, 시련(90초 안에 돌연변이 15마리)을 통과', goal: 15, reward: 'dragonsummon' }
  ];
  var DEF_BY_ID = {};
  var REWARD_TO_MISSION = {};
  for (var di = 0; di < DEFS.length; di++) {
    DEF_BY_ID[DEFS[di].id] = DEFS[di];
    REWARD_TO_MISSION[DEFS[di].reward] = DEFS[di];
  }
  // 보상 기술 → 원소 → 그 원소를 해금하는 미션
  function elementOfSkill(id) {
    if (typeof id !== 'string' || !id) return null;
    if (Object.prototype.hasOwnProperty.call(SKILL_FALLBACK, id)) return SKILL_FALLBACK[id].element;
    var S = G.Skills;
    if (S && typeof S.elementOf === 'function') {
      try { var e = S.elementOf(id); if (e) return e; } catch (err) { /* 무시 */ }
    }
    var d = S && S.defs ? S.defs[id] : null;
    return d && d.element && d.element !== 'none' ? d.element : null;
  }
  var ELEMENT_TO_MISSION = {};
  for (di = 0; di < DEFS.length; di++) {
    DEFS[di].element = elementOfSkill(DEFS[di].reward);
    if (DEFS[di].element) ELEMENT_TO_MISSION[DEFS[di].element] = DEFS[di];
  }

  // ===========================================================================
  // 유틸
  // ===========================================================================
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hasDom() {
    return typeof document !== 'undefined' && !!document.createElement && !!document.body;
  }
  function emit(name, data) {
    if (G.events && typeof G.events.emit === 'function') G.events.emit(name, data);
  }
  function toast(text) {
    if (typeof G.toast === 'function') { try { G.toast(text); } catch (e) { /* 무시 */ } }
  }
  function particles(x, y, n, color, speed) {
    if (typeof G.spawnParticles === 'function') { try { G.spawnParticles(x, y, n, color, speed); } catch (e) { /* 무시 */ } }
  }
  function groundY() { return (G.world && G.world.groundY) || 600; }
  function worldW() { return (G.world && G.world.width) || 4200; }
  function localPlayer() { return (G.players && G.players.local) || null; }
  function isOnlineMode() { return G.mode === 'host' || G.mode === 'guest'; }
  function keyHeld(code) { return !!(G.keys && typeof G.keys.has === 'function' && G.keys.has(code)); }
  function downHeld() { return keyHeld('KeyS') || keyHeld('ArrowDown'); }
  function inMatch() { return !!(G.running && !G.matchOver); }

  function skillInfo(id) {
    var d = G.Skills && G.Skills.defs ? G.Skills.defs[id] : null;
    var f = SKILL_FALLBACK[id] || { elementName: '?', name: id, icon: '✨', color: '#c9a35a' };
    if (!d) return { id: id, elementName: f.elementName, name: f.name, icon: f.icon, color: f.color, desc: '', cost: null, cooldown: null, rarity: '' };
    return {
      id: id,
      elementName: d.elementName || f.elementName,
      name: d.name || f.name,
      icon: d.icon || f.icon,
      color: d.color || f.color,
      desc: d.desc || '',
      cost: d.cost,
      cooldown: d.cooldown,
      rarity: d.rarity || ''
    };
  }

  // 능력(원소) 목록: [{element, elementName, icon, color, desc, rarity, ids[4]}] (Game.Skills.kits 우선)
  function kitList() {
    var S = G.Skills;
    if (S && Array.isArray(S.kits) && S.kits.length) {
      if (typeof S.refreshKits === 'function') { try { S.refreshKits(); } catch (e) { /* 무시 */ } }
      return S.kits;
    }
    var out = [];
    for (var i = 0; i < ELEMENT_FALLBACK.length; i++) {
      var f = ELEMENT_FALLBACK[i], ids = f[5].slice();
      while (ids.length < 4) ids.push(null);
      out.push({ element: f[0], elementName: f[1], icon: f[2], color: f[3], rarity: f[4], ids: ids, desc: '' });
    }
    return out;
  }
  function kitInfo(el) {
    var list = kitList();
    for (var i = 0; i < list.length; i++) if (list[i].element === el) return list[i];
    return null;
  }
  function isKnownElement(el) { return !!kitInfo(el) || (typeof el === 'string' && el.length > 0 && el.length < 40); }
  // 키트에서 실제로 쓸 수 있는(등록된) 기술 수
  function kitSkillCount(k) {
    if (!k) return 0;
    var S = G.Skills, n = 0;
    for (var i = 0; i < 4; i++) {
      var id = k.ids && k.ids[i];
      if (id && (!S || !S.defs || S.defs[id])) n++;
    }
    return n;
  }
  function elementLabel(el) {
    var k = kitInfo(el);
    if (!k) return el;
    return k.icon + ' ' + k.elementName;
  }

  // ===========================================================================
  // Game.Progress
  // ===========================================================================
  function getStorage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  // 능력 단위 진행도: elements = 해금한 원소 목록 (불꽃 항상), element = 장착 원소
  var Progress = {
    elements: [START_ELEMENT],
    element: START_ELEMENT,
    missions: {},
    // ---- 원소 ----
    isElementUnlocked: function (el) {
      if (el === START_ELEMENT) return true;
      var k = kitInfo(el);
      if (k && k.rarity === 'start') return true;
      return Progress.elements.indexOf(el) >= 0;
    },
    unlockElement: function (el) {
      if (typeof el !== 'string' || !el || !isKnownElement(el)) return false;
      if (Progress.elements.indexOf(el) >= 0) return false;
      Progress.elements.push(el);
      return true;
    },
    // 장착 원소 지정 (잠금이면 false). 저장까지 함. 실제 슬롯 교체는 Game.Powers.setElement 가 담당
    setElement: function (el) {
      if (!Progress.isElementUnlocked(el)) return false;
      Progress.element = el;
      Progress.save();
      return true;
    },
    // ---- 호환 (기술 id 기준) : 기술의 원소가 해금되어 있으면 해금 ----
    isUnlocked: function (id) {
      if (Progress.isElementUnlocked(id)) return true;
      var el = elementOfSkill(id);
      return !!el && Progress.isElementUnlocked(el);
    },
    unlock: function (idOrElement) {
      var el = kitInfo(idOrElement) ? idOrElement : elementOfSkill(idOrElement);
      return el ? Progress.unlockElement(el) : false;
    },
    save: function () {
      dirty = false;
      var st = getStorage();
      if (!st) return false;
      try {
        st.setItem(STORAGE_KEY, JSON.stringify({
          v: SAVE_VERSION, elements: Progress.elements, element: Progress.element, missions: Progress.missions
        }));
        return true;
      } catch (e) { return false; }
    },
    load: function () {
      var st = getStorage();
      var data = null;
      var i;
      if (st) {
        try {
          var raw = st.getItem(STORAGE_KEY);
          if (raw) data = JSON.parse(raw);
        } catch (e) { data = null; }
      }
      Progress.elements = [START_ELEMENT];
      Progress.element = START_ELEMENT;
      Progress.missions = {};
      if (data && typeof data === 'object') {
        if (Array.isArray(data.elements)) {
          for (i = 0; i < data.elements.length; i++) Progress.unlockElement(data.elements[i]);
        }
        // v1(게임 v3) 저장: 해금 기술 → 그 원소 해금. 옛 loadout 은 무시
        if (Array.isArray(data.unlocked)) {
          for (i = 0; i < data.unlocked.length; i++) {
            var el = elementOfSkill(data.unlocked[i]);
            if (el) Progress.unlockElement(el);
          }
        }
        if (data.missions && typeof data.missions === 'object') {
          for (var id in data.missions) {
            if (!Object.prototype.hasOwnProperty.call(data.missions, id)) continue;
            var m = data.missions[id];
            if (!m || typeof m !== 'object') continue;
            var rec = { progress: Number(m.progress) || 0, done: !!m.done };
            if (Array.isArray(m.kinds)) rec.kinds = m.kinds.filter(function (k) { return typeof k === 'string'; });
            Progress.missions[id] = rec;
            // 완료된 미션의 보상 능력은 반드시 해금 상태로
            if (rec.done && DEF_BY_ID[id] && DEF_BY_ID[id].element) Progress.unlockElement(DEF_BY_ID[id].element);
          }
        }
        if (typeof data.element === 'string' && Progress.isElementUnlocked(data.element)) Progress.element = data.element;
        if ((data.v | 0) < SAVE_VERSION) { Progress.save(); }   // 새 형식으로 즉시 변환 저장
      }
      return Progress;
    },
    reset: function () {
      Progress.elements = [START_ELEMENT];
      Progress.element = START_ELEMENT;
      Progress.missions = {};
      Progress.save();
      return Progress;
    }
  };
  // 해금한 기술 id 목록 (호환용 읽기 전용 속성)
  try {
    Object.defineProperty(Progress, 'unlocked', {
      enumerable: false,
      get: function () {
        var out = [], list = kitList();
        for (var i = 0; i < list.length; i++) {
          if (!Progress.isElementUnlocked(list[i].element)) continue;
          for (var j = 0; j < 4; j++) if (list[i].ids[j] && out.indexOf(list[i].ids[j]) < 0) out.push(list[i].ids[j]);
        }
        return out;
      }
    });
  } catch (e) { /* 무시 */ }

  var dirty = false;
  var saveTimer = 0;
  function markDirty() { dirty = true; }

  function mstate(id) {
    var s = Progress.missions[id];
    if (!s) { s = Progress.missions[id] = { progress: 0, done: false }; }
    return s;
  }
  function goalOf(def) {
    if (def.id === 'm_explore') return platformKinds().length || def.goal;
    return def.goal;
  }
  function platformKinds() {
    var out = [];
    var pl = (G.world && G.world.platforms) || [];
    for (var i = 0; i < pl.length; i++) {
      var k = pl[i] && pl[i].kind;
      if (typeof k === 'string' && out.indexOf(k) < 0) out.push(k);
    }
    return out;
  }

  // ===========================================================================
  // 출전 단위 상태
  // ===========================================================================
  var simT = 0;          // 경기 진행 시간(경기 중에만 흐름) — 시계 박자 측정
  var animT = 0;         // 렌더 애니메이션용
  var runT = { m_cool: 0, m_survive: 0 };
  var bigbang = {};      // castId → 처치 수
  var bigbangOrder = [];
  var mossItems = [];
  var stones = [];
  var holdLock = false;
  var trial = null;      // {t, kills, spawnT}
  var clock = { streak: 0, last: -99, flash: 0, hits: [] };

  // ---- 이끼 뭉치: 맵 고정 8곳 (dy = 지면 위 높이, 발판 위면 발판 윗면 높이) ----
  var MOSS_SPOTS = [
    { x: 375, dy: 100 },   // 왼쪽 폐차 지붕
    { x: 610, dy: 220 },   // 왼쪽 발코니
    { x: 985, dy: 320 },   // 왼쪽 고가도로 조각
    { x: 1580, dy: 0 },    // 모텔 간판 아래 도로
    { x: 2160, dy: 265 },  // 중앙 광고판 위
    { x: 2850, dy: 140 },  // 오른쪽 비계
    { x: 3215, dy: 320 },  // 오른쪽 고가도로 조각
    { x: 3905, dy: 0 }     // 오른쪽 끝 도로
  ];

  function snapDy(x, dy) {
    if (!dy) return 0;
    var pl = (G.world && G.world.platforms) || [];
    var best = null;
    for (var i = 0; i < pl.length; i++) {
      var p = pl[i];
      if (x < p.x || x > p.x + p.w) continue;
      var pdy = typeof p.dy === 'number' ? p.dy : (groundY() - p.y);
      if (Math.abs(pdy - dy) < 60 && (!best || Math.abs(pdy - dy) < Math.abs(best - dy))) best = pdy;
    }
    return best == null ? dy : best;
  }

  function buildMoss() {
    mossItems = [];
    for (var i = 0; i < MOSS_SPOTS.length; i++) {
      var s = MOSS_SPOTS[i];
      mossItems.push({ x: s.x, dy: snapDy(s.x, s.dy), taken: false, seed: i * 1.7 });
    }
  }

  // ---- 용 비석 3개 ----
  function highestPlatform() {
    var pl = (G.world && G.world.platforms) || [];
    var best = null;
    for (var i = 0; i < pl.length; i++) {
      var p = pl[i];
      var pdy = typeof p.dy === 'number' ? p.dy : (groundY() - p.y);
      if (!best || pdy > best.dy + 0.5 || (Math.abs(pdy - best.dy) <= 0.5 && p.x < best.p.x)) best = { p: p, dy: pdy };
    }
    return best;
  }
  function buildStones() {
    var hp = highestPlatform();
    var hx = hp ? hp.p.x + hp.p.w - 46 : 1124;
    var hdy = hp ? hp.dy : 320;
    var W = worldW();
    stones = [
      { claws: 1, x: 38, dy: 0, active: false, hold: 0, flash: 0, bad: 0 },        // 맵 맨 왼쪽 끝 구석
      { claws: 2, x: hx, dy: hdy, active: false, hold: 0, flash: 0, bad: 0 },      // 가장 높은 발판 위
      { claws: 3, x: W - 34, dy: 0, active: false, hold: 0, flash: 0, bad: 0 }     // 맵 맨 오른쪽 끝
    ];
    // 초기화 순서 상관없이 배열 순서는 위치 순서
  }

  // ---- 무너진 시계탑 ----
  // 근경 x 1738~1822 (중앙 버스/광고판 왼쪽, 모텔 네온(1580~1650)과 드럼통(1853) 사이).
  // 시계판 중심 높이 = 광고판 윗면(dy 265) 위에 선 플레이어의 화염구 발사 높이 (발 기준 h*0.58 ≈ 36px 위) → dy ≈ 301.
  var TOWER_X = 1738, TOWER_W = 84, FACE_CX = 1780, FACE_R = 34;
  function faceDy() {
    var pl = (G.world && G.world.platforms) || [];
    var p = localPlayer();
    var ph = (p && p.h) || 62;
    for (var i = 0; i < pl.length; i++) {
      if (pl[i].kind === 'billboard') {
        var pdy = typeof pl[i].dy === 'number' ? pl[i].dy : (groundY() - pl[i].y);
        return pdy + ph * 0.58;
      }
    }
    return 301;
  }
  function clockGeom() {
    var gy = groundY();
    var fdy = faceDy();
    return { cx: FACE_CX, cy: gy - fdy, r: FACE_R, gy: gy, fdy: fdy };
  }

  function resetSortie() {
    runT = { m_cool: 0, m_survive: 0 };
    bigbang = {};
    bigbangOrder = [];
    holdLock = false;
    trial = null;
    clock = { streak: 0, last: -99, flash: 0, hits: [] };
    simT = 0;
    buildMoss();
    buildStones();
  }

  // ===========================================================================
  // 진행 / 클리어
  // ===========================================================================
  function addProgress(id, n) {
    var def = DEF_BY_ID[id];
    if (!def) return;
    var st = mstate(id);
    if (st.done) return;
    var goal = goalOf(def);
    st.progress = Math.min(goal, (st.progress || 0) + n);
    markDirty();
    if (st.progress >= goal) complete(id);
  }

  function complete(id) {
    var def = DEF_BY_ID[id];
    if (!def) return false;
    var st = mstate(id);
    if (st.done) return false;
    st.done = true;
    st.progress = goalOf(def);
    var el = def.element || elementOfSkill(def.reward);
    if (el) Progress.unlockElement(el);
    Progress.save();
    var info = rewardInfo(def);
    toast('🎉 미션 클리어! ' + info.text);
    celebrate();
    showBanner(def, info);
    emit('abilityUnlocked', { skill: def.reward, element: el });
    if (panelOpen) renderPanel();
    return true;
  }

  // 미션 보상 표시 정보: 원소 전체
  function rewardInfo(def) {
    var el = def.element || elementOfSkill(def.reward);
    var k = el ? kitInfo(el) : null;
    var si = skillInfo(def.reward);
    var icon = k ? k.icon : si.icon, name = k ? k.elementName : si.elementName;
    var n = k ? kitSkillCount(k) : 1;
    return { element: el, icon: icon, name: name, count: n,
      label: icon + ' ' + name + ' (스킬 ' + n + '개)',
      text: '새 능력 해금: ' + icon + ' ' + name + ' (스킬 ' + n + '개)' };
  }

  function celebrate() {
    var p = localPlayer();
    if (!p) return;
    var x = p.x + p.w / 2, y = p.y + p.h / 2;
    particles(x, y, 46, '#ffd34a', 560);
    particles(x, y - 20, 30, '#fff3b0', 420);
    particles(x, y, 20, '#ffb020', 300);
    if (typeof G.shake === 'function') { try { G.shake(5); } catch (e) { /* 무시 */ } }
  }

  // ===========================================================================
  // 이벤트 구독 (1회)
  // ===========================================================================
  var subscribed = false;
  function subscribe() {
    if (subscribed) return true;
    if (!G.events || typeof G.events.on !== 'function') return false;
    subscribed = true;
    var on = G.events.on;
    on.call(G.events, 'mutantKilled', onMutantKilled);
    on.call(G.events, 'mutantHitByMe', function () { addProgress('m_marks', 1); });
    on.call(G.events, 'playerDamaged', function (d) {
      if (d && typeof d.amount === 'number' && d.amount <= 0) return;
      runT.m_cool = 0;
      resetFlawless();
    });
    on.call(G.events, 'playerKO', function () {
      runT.m_cool = 0;
      runT.m_survive = 0;
      resetFlawless();
      if (trial) failTrial('KO 당했습니다');
    });
    on.call(G.events, 'oppKO', function () {
      if (isOnlineMode()) addProgress('m_duel', 1);
    });
    on.call(G.events, 'land', function (d) {
      if (!d || typeof d.platform !== 'string') return;
      var st = mstate('m_explore');
      if (st.done) return;
      if (!st.kinds) st.kinds = [];
      if (st.kinds.indexOf(d.platform) >= 0) return;
      st.kinds.push(d.platform);
      var all = platformKinds();
      var cnt = 0;
      for (var i = 0; i < st.kinds.length; i++) if (!all.length || all.indexOf(st.kinds[i]) >= 0) cnt++;
      st.progress = Math.max(0, cnt - 1);
      addProgress('m_explore', 1);
    });
    on.call(G.events, 'matchEnd', function () { if (dirty) Progress.save(); });
    return true;
  }

  function resetFlawless() {
    var st = mstate('h_flawless');
    if (st.done) return;
    if (st.progress) { st.progress = 0; markDirty(); }
  }

  function onMutantKilled(d) {
    d = d || {};
    addProgress('m_hunt', 1);
    if (d.type === 'dog') addProgress('m_dog', 1);
    addProgress('h_flawless', 1);
    if (d.skill === 'inferno' && d.castId != null) {
      var k = String(d.castId);
      if (!Object.prototype.hasOwnProperty.call(bigbang, k)) {
        bigbang[k] = 0;
        bigbangOrder.push(k);
        if (bigbangOrder.length > 24) delete bigbang[bigbangOrder.shift()];
      }
      bigbang[k]++;
      if (bigbang[k] >= 4) complete('h_bigbang');
    }
    if (trial) {
      trial.kills++;
      if (trial.kills >= 15) {
        trial = null;
        for (var i = 0; i < stones.length; i++) stones[i].active = true;
        complete('h_dragon');
      }
    }
  }

  // ===========================================================================
  // 용 비석 / 시련
  // ===========================================================================
  function stoneUnder(p) {
    if (!p || !p.alive || !p.onGround) return null;
    var gy = groundY();
    var cx = p.x + p.w / 2, feet = p.y + p.h;
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (Math.abs(cx - s.x) > 26) continue;
      if (Math.abs(feet - (gy - s.dy)) > 4) continue;
      return s;
    }
    return null;
  }
  function stonesUsable() { return !mstate('h_dragon').done && !trial; }
  function activeCount() {
    var n = 0;
    for (var i = 0; i < stones.length; i++) if (stones[i].active) n++;
    return n;
  }
  function stonesOff() {
    for (var i = 0; i < stones.length; i++) { stones[i].active = false; stones[i].hold = 0; }
  }

  function activateStone(s) {
    var gy = groundY();
    var sy = gy - s.dy - 30;
    if (s.claws === activeCount() + 1) {
      s.active = true;
      s.flash = 1;
      particles(s.x, sy, 22, '#7fe0b8', 260);
      particles(s.x, sy, 10, '#ffe7a0', 180);
      if (activeCount() >= 3) {
        if (G.mode === 'practice') startTrial();
        else {
          toast('시련은 혼자 연습에서만 열립니다');
          stonesOff();
        }
      } else {
        toast('고대의 비석이 깨어났다… (' + activeCount() + '/3)');
      }
    } else {
      for (var i = 0; i < stones.length; i++) { stones[i].active = false; stones[i].bad = 0.8; }
      particles(s.x, sy, 16, '#6a2a2a', 200);
      toast('비석의 빛이 모두 꺼졌다…');
    }
  }

  function startTrial() {
    trial = { t: 90, kills: 0, spawnT: 1 };
    toast('🐉 용의 시련! 90초 안에 돌연변이 15마리를 처치하라');
    if (typeof G.shake === 'function') { try { G.shake(10); } catch (e) { /* 무시 */ } }
    var p = localPlayer();
    if (p) particles(p.x + p.w / 2, p.y + p.h / 2, 40, '#ff9a3a', 520);
  }

  function failTrial(reason) {
    trial = null;
    stonesOff();
    toast('용의 시련 실패… ' + (reason || ''));
  }

  var trialRng = makeRng(77031);
  function trialSpawn() {
    var M = G.Mutants;
    if (!M || typeof M.forceSpawn !== 'function') return;
    if (typeof M.isAuthority === 'function' && !M.isAuthority()) return;
    var r = trialRng();
    var type = r < 0.45 ? 'dog' : (r < 0.85 ? 'crow' : 'rat');
    var p = localPlayer();
    var px = p ? p.x + p.w / 2 : worldW() / 2;
    var side = trialRng() < 0.5 ? -1 : 1;
    var x = px + side * (520 + trialRng() * 280);
    if (x < 60 || x > worldW() - 60) x = px - side * (520 + trialRng() * 280);
    x = clamp(x, 60, worldW() - 60);
    try { M.forceSpawn(type, x); } catch (e) { /* 무시 */ }
  }

  function updateStones(dt, p) {
    for (var i = 0; i < stones.length; i++) {
      var st = stones[i];
      if (st.flash > 0) st.flash = Math.max(0, st.flash - dt);
      if (st.bad > 0) st.bad = Math.max(0, st.bad - dt);
    }
    if (!stonesUsable()) return;
    var held = downHeld();
    if (!held) holdLock = false;
    var s = stoneUnder(p);
    for (i = 0; i < stones.length; i++) {
      if (stones[i] !== s || !held || holdLock) stones[i].hold = 0;
    }
    if (!s || !held || holdLock) return;
    if (s.active) { s.hold = 0; return; }
    // 발판 위에서 S/↓ 를 누르면 아래로 떨어지므로 비석 위에서는 잠시 고정 (기도 자세)
    p.frozen = Math.max(p.frozen || 0, 0.12);
    s.hold += dt;
    if (s.hold >= 2) {
      s.hold = 0;
      holdLock = true;
      activateStone(s);
    }
  }

  // 키를 누르는 첫 순간(월드 업데이트 이전)에 고정해서 발판 아래로 빠지지 않게
  function onKeyDownCapture(e) {
    if (!e || (e.code !== 'KeyS' && e.code !== 'ArrowDown')) return;
    if (panelOpen) return;
    var ae = typeof document !== 'undefined' ? document.activeElement : null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    if (!inMatch() || holdLock || !stonesUsable()) return;
    var p = localPlayer();
    var s = stoneUnder(p);
    if (s && !s.active) p.frozen = Math.max(p.frozen || 0, 0.12);
  }

  function updateTrial(dt) {
    if (!trial) return;
    trial.t -= dt;
    trial.spawnT -= dt;
    while (trial && trial.spawnT <= 0) {
      trial.spawnT += 2;
      trialSpawn();
    }
    if (trial && trial.t <= 0) failTrial('시간 초과');
  }

  // ===========================================================================
  // 시계탑
  // ===========================================================================
  function updateClock(dt) {
    if (clock.flash > 0) clock.flash = Math.max(0, clock.flash - dt * 2.5);
    if (clock.streak > 0 && simT - clock.last > 1.12) clock.streak = 0;
    var S = G.Skills;
    if (!S || !Array.isArray(S.fx)) return;
    var g = clockGeom();
    for (var i = 0; i < S.fx.length; i++) {
      var fx = S.fx[i];
      if (!fx || fx.dead || fx.owner !== 'local' || !fx.projectile) continue;
      if (typeof fx.x !== 'number' || typeof fx.y !== 'number') continue;
      var rr = g.r + (typeof fx.r === 'number' ? fx.r : 10);
      var dx = fx.x - g.cx, dy = fx.y - g.cy;
      if (dx * dx + dy * dy > rr * rr) continue;
      fx.dead = true;
      clockHit(fx.x, fx.y);
    }
  }

  function clockHit(x, y) {
    var dtHit = simT - clock.last;
    if (clock.streak > 0 && Math.abs(dtHit - 1.0) <= 0.12) clock.streak++;
    else clock.streak = 1;
    clock.last = simT;
    clock.flash = 1;
    particles(x, y, 12, '#ffd34a', 260);
    particles(x, y, 6, '#c08a3a', 160);
    if (clock.streak >= 5) {
      clock.streak = 0;
      complete('h_clock');
    }
  }

  // ===========================================================================
  // 이끼 뭉치
  // ===========================================================================
  function updateMoss(p) {
    if (!p || !p.alive) return;
    var gy = groundY();
    for (var i = 0; i < mossItems.length; i++) {
      var m = mossItems[i];
      if (m.taken) continue;
      var my = gy - m.dy - 14;
      var r = { x: m.x - 16, y: my - 16, w: 32, h: 32 };
      var hit = typeof G.rectHit === 'function' ? G.rectHit(p, r)
        : (p.x < r.x + r.w && p.x + p.w > r.x && p.y < r.y + r.h && p.y + p.h > r.y);
      if (!hit) continue;
      m.taken = true;
      particles(m.x, my, 18, '#9be05a', 240);
      particles(m.x, my, 8, '#e8ffb0', 160);
      var st = mstate('m_moss');
      if (!st.done) {
        addProgress('m_moss', 1);
        if (!st.done) toast('빛나는 이끼 ' + st.progress + '/' + goalOf(DEF_BY_ID.m_moss));
      }
    }
  }

  // ===========================================================================
  // update / init
  // ===========================================================================
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    animT += dt;
    if (!subscribed) subscribe();

    if (inMatch()) {
      simT += dt;
      var p = localPlayer();
      var alive = !!(p && p.alive);
      updateClock(dt);
      if (alive) {
        runT.m_cool += dt;
        var sc = mstate('m_cool');
        if (!sc.done) {
          var v = Math.floor(runT.m_cool);
          if (v > (sc.progress || 0)) { sc.progress = Math.min(60, v); markDirty(); }
          if (runT.m_cool >= 60) complete('m_cool');
        }
        if (G.mode === 'practice') {
          runT.m_survive += dt;
          var ss = mstate('m_survive');
          if (!ss.done) {
            var v2 = Math.floor(runT.m_survive);
            if (v2 > (ss.progress || 0)) { ss.progress = Math.min(180, v2); markDirty(); }
            if (runT.m_survive >= 180) complete('m_survive');
          }
        }
        updateMoss(p);
        updateStones(dt, p);
        updateTrial(dt);
      }
    }

    if (dirty) {
      saveTimer += dt;
      if (saveTimer >= 1.5) { saveTimer = 0; Progress.save(); }
    } else saveTimer = 0;

    updateHud();
  }

  function init(opts) {
    subscribe();
    resetSortie();
    ensureHud();
    if (panelOpen) closePanel();
    if (hudTracker) hudTracker.hidden = false;
    lastTrackerHtml = '';
    return opts;
  }

  // ===========================================================================
  // 렌더 (월드 좌표계)
  // ===========================================================================
  var towerDeco = null;
  function buildTowerDeco() {
    var r = makeRng(5150917);
    var d = { moss: [], streaks: [], vines: [], cracks: [] };
    var i;
    for (i = 0; i < 16; i++) d.moss.push({ x: r() * (TOWER_W + 16) - 8, dy: r() * 26, rx: 8 + r() * 12, ry: 5 + r() * 7, c: r() });
    for (i = 0; i < 5; i++) d.streaks.push({ x: 8 + r() * (TOWER_W - 16), w: 3 + r() * 6, len: 60 + r() * 140, top: r() });
    for (i = 0; i < 5; i++) d.vines.push({ x: 6 + r() * (TOWER_W - 12), len: 30 + r() * 70, ph: r() * 6.28 });
    for (i = 0; i < 3; i++) {
      var pts = [], cx = 10 + r() * (TOWER_W - 20), cy = 40 + r() * 200;
      pts.push([cx, cy]);
      for (var k = 0; k < 4; k++) { cx += (r() - 0.5) * 18; cy += 10 + r() * 16; pts.push([cx, cy]); }
      d.cracks.push(pts);
    }
    return d;
  }

  function render(ctx) {
    if (!ctx) return;
    var gy = groundY();
    var cam = G.camera || { x: 0 };
    var vx0 = (cam.x || 0) - 200, vx1 = (cam.x || 0) + (G.width || 1600) + 200;
    if (!stones.length) buildStones();
    if (!mossItems.length && !G.running) buildMoss();
    if (TOWER_X + TOWER_W + 120 > vx0 && TOWER_X - 120 < vx1) {
      ctx.save();
      try { drawTower(ctx, gy); } catch (e) { /* 무시 */ }
      ctx.restore();
    }
    for (var i = 0; i < stones.length; i++) {
      if (stones[i].x < vx0 || stones[i].x > vx1) continue;
      ctx.save();
      try { drawStone(ctx, stones[i], gy); } catch (e) { /* 무시 */ }
      ctx.restore();
    }
    if (G.running) {
      for (i = 0; i < mossItems.length; i++) {
        var m = mossItems[i];
        if (m.taken || m.x < vx0 || m.x > vx1) continue;
        ctx.save();
        try { drawMoss(ctx, m, gy); } catch (e) { /* 무시 */ }
        ctx.restore();
      }
    }
  }

  function drawTower(c, gy) {
    if (!towerDeco) towerDeco = buildTowerDeco();
    var d = towerDeco;
    var x = TOWER_X, w = TOWER_W;
    var g = clockGeom();
    var cy = g.cy, cx = g.cx, R = g.r;
    var topL = gy - (g.fdy + 92), topR = gy - (g.fdy + 58);
    var i;

    // 그림자
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.beginPath();
    c.ellipse(x + w / 2, gy + 3, w * 0.75, 7, 0, 0, Math.PI * 2);
    c.fill();

    // 몸체 (부서진 꼭대기)
    c.beginPath();
    c.moveTo(x, gy);
    c.lineTo(x, topL + 10);
    c.lineTo(x + 10, topL);
    c.lineTo(x + 22, topL + 16);
    c.lineTo(x + 31, topL - 14);
    c.lineTo(x + 44, topL + 12);
    c.lineTo(x + 55, topR - 4);
    c.lineTo(x + 66, topR + 14);
    c.lineTo(x + w, topR);
    c.lineTo(x + w, gy);
    c.closePath();
    var bg = c.createLinearGradient(x, 0, x + w, 0);
    bg.addColorStop(0, '#3e3229');
    bg.addColorStop(0.35, '#5e4a3a');
    bg.addColorStop(0.7, '#544233');
    bg.addColorStop(1, '#30261f');
    c.fillStyle = bg;
    c.fill();
    c.save();
    c.clip();
    // 벽돌 줄
    c.strokeStyle = 'rgba(20,14,10,0.35)';
    c.lineWidth = 1;
    for (var yy = gy - 14, row = 0; yy > topL - 20; yy -= 14, row++) {
      c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke();
      for (var bx = x + (row % 2 ? 14 : 0); bx < x + w; bx += 28) {
        c.beginPath(); c.moveTo(bx, yy); c.lineTo(bx, yy - 14); c.stroke();
      }
    }
    // 녹물 흘러내림 (시계판 아래로)
    for (i = 0; i < d.streaks.length; i++) {
      var s = d.streaks[i];
      var sy = cy + R * 0.6 + s.top * 20;
      var sg = c.createLinearGradient(0, sy, 0, sy + s.len);
      sg.addColorStop(0, 'rgba(168,86,40,0.65)');
      sg.addColorStop(1, 'rgba(168,86,40,0)');
      c.fillStyle = sg;
      c.fillRect(x + s.x, sy, s.w, s.len);
    }
    // 아치형 창 (깨짐)
    var wy = gy - g.fdy * 0.45;
    c.fillStyle = '#120e0c';
    c.beginPath();
    c.moveTo(x + w / 2 - 11, wy + 34);
    c.lineTo(x + w / 2 - 11, wy);
    c.arc(x + w / 2, wy, 11, Math.PI, 0);
    c.lineTo(x + w / 2 + 11, wy + 34);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(150,170,160,0.25)';
    c.beginPath(); c.moveTo(x + w / 2 - 8, wy + 6); c.lineTo(x + w / 2 + 3, wy + 20); c.lineTo(x + w / 2 + 9, wy + 4); c.stroke();
    // 균열
    c.strokeStyle = 'rgba(15,10,8,0.6)';
    c.lineWidth = 1.4;
    for (i = 0; i < d.cracks.length; i++) {
      var pts = d.cracks[i];
      c.beginPath();
      c.moveTo(x + pts[0][0], gy - g.fdy - 60 + pts[0][1]);
      for (var k = 1; k < pts.length; k++) c.lineTo(x + pts[k][0], gy - g.fdy - 60 + pts[k][1]);
      c.stroke();
    }
    c.restore();
    // 몸체 테두리
    c.strokeStyle = 'rgba(15,10,8,0.7)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, gy); c.lineTo(x, topL + 10); c.moveTo(x + w, topR); c.lineTo(x + w, gy);
    c.stroke();
    // 노출된 철근
    c.strokeStyle = '#7d4424';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x + 31, topL - 10); c.lineTo(x + 27, topL - 34);
    c.moveTo(x + 55, topR); c.lineTo(x + 61, topR - 22);
    c.moveTo(x + 12, topL + 4); c.lineTo(x + 6, topL - 16);
    c.stroke();
    // 처마 띠 (시계판 위/아래 석재 띠)
    c.fillStyle = '#4a3e33';
    c.fillRect(x - 5, cy - R - 16, w + 10, 7);
    c.fillRect(x - 5, cy + R + 9, w + 10, 7);
    c.fillStyle = 'rgba(95,127,48,0.85)';
    c.fillRect(x - 5, cy - R - 17, w + 10, 3);
    c.fillRect(x - 5, cy + R + 8, w * 0.6, 3);
    // 받침대
    c.fillStyle = '#4a463e';
    c.fillRect(x - 9, gy - 24, w + 18, 24);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(x - 9, gy - 24, w + 18, 3);

    // ---- 시계판 ----
    var done = mstate('h_clock').done;
    // 녹슨 청동 테
    c.beginPath();
    c.arc(cx, cy, R + 6, 0, Math.PI * 2);
    c.fillStyle = '#6a4a26';
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = '#2a1c10';
    c.stroke();
    // 녹청(녹색 녹)
    c.strokeStyle = 'rgba(90,160,130,0.55)';
    c.lineWidth = 3;
    c.beginPath(); c.arc(cx, cy, R + 4, 0.3, 1.4); c.stroke();
    c.beginPath(); c.arc(cx, cy, R + 4, 3.6, 4.3); c.stroke();
    // 문자판
    var fg = c.createRadialGradient(cx - 8, cy - 8, 4, cx, cy, R);
    fg.addColorStop(0, done ? '#fff1c0' : '#cfc6aa');
    fg.addColorStop(1, done ? '#c99a3a' : '#857c66');
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fillStyle = fg;
    c.fill();
    // 눈금
    c.strokeStyle = '#2a2218';
    for (i = 0; i < 12; i++) {
      var a = i / 12 * Math.PI * 2;
      var r0 = i % 3 === 0 ? R - 9 : R - 6;
      c.lineWidth = i % 3 === 0 ? 2.4 : 1.2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * (R - 2), cy + Math.sin(a) * (R - 2));
      c.stroke();
    }
    // 깨진 유리 균열
    c.strokeStyle = 'rgba(40,30,20,0.55)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(cx + 6, cy - 4); c.lineTo(cx + 20, cy - 22); c.moveTo(cx + 6, cy - 4); c.lineTo(cx + 26, cy + 8);
    c.moveTo(cx + 6, cy - 4); c.lineTo(cx - 4, cy + 24);
    c.stroke();
    // 바늘 (멈춤: 4시 47분 / 연속 명중 시 초침이 한 칸씩)
    var hourA = (4 + 47 / 60) / 12 * Math.PI * 2 - Math.PI / 2;
    var minA = 47 / 60 * Math.PI * 2 - Math.PI / 2;
    c.strokeStyle = '#1c150e';
    c.lineCap = 'round';
    c.lineWidth = 3.4;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(hourA) * R * 0.5, cy + Math.sin(hourA) * R * 0.5); c.stroke();
    c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(minA) * R * 0.78, cy + Math.sin(minA) * R * 0.78); c.stroke();
    var secA = (done ? 0 : clock.streak) / 5 * Math.PI * 2 - Math.PI / 2;
    c.strokeStyle = done ? '#ffb020' : '#8a2a1a';
    c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(secA) * R * 0.86, cy + Math.sin(secA) * R * 0.86); c.stroke();
    c.lineCap = 'butt';
    c.fillStyle = '#1c150e';
    c.beginPath(); c.arc(cx, cy, 3, 0, Math.PI * 2); c.fill();

    // 금빛 표시 5개 (시계판 위 호)
    for (i = 0; i < 5; i++) {
      var la = Math.PI * (1.15 + i * 0.175);
      var lx = cx + Math.cos(la) * (R + 12), ly = cy + Math.sin(la) * (R + 12) + 2;
      var lit = done || i < clock.streak;
      c.beginPath();
      c.arc(lx, ly, 3.2, 0, Math.PI * 2);
      c.fillStyle = lit ? '#ffd34a' : 'rgba(60,46,30,0.9)';
      c.fill();
      if (lit) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        var lg = c.createRadialGradient(lx, ly, 0, lx, ly, 11);
        lg.addColorStop(0, 'rgba(255,220,120,0.8)');
        lg.addColorStop(1, 'rgba(255,200,80,0)');
        c.fillStyle = lg;
        c.beginPath(); c.arc(lx, ly, 11, 0, Math.PI * 2); c.fill();
        c.restore();
      }
    }
    // 명중 / 완료 발광
    var glow = Math.max(clock.flash, done ? 0.35 + 0.15 * Math.sin(animT * 2) : 0);
    if (glow > 0) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      var gg = c.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 2.2);
      gg.addColorStop(0, 'rgba(255,214,110,' + (0.55 * glow).toFixed(3) + ')');
      gg.addColorStop(1, 'rgba(255,170,60,0)');
      c.fillStyle = gg;
      c.beginPath(); c.arc(cx, cy, R * 2.2, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    // 부러진 진자 (2초 주기 — 1초마다 한가운데를 지난다)
    var pa = Math.sin(simT * Math.PI) * 0.28;
    var px0 = cx, py0 = cy + R + 16;
    var plen = 34;
    var pxe = px0 + Math.sin(pa) * plen, pye = py0 + Math.cos(pa) * plen;
    c.strokeStyle = '#5a3c20';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(px0, py0); c.lineTo(pxe, pye); c.stroke();
    c.fillStyle = '#7a5226';
    c.beginPath(); c.arc(pxe, pye, 5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#2a1c10'; c.lineWidth = 1; c.stroke();

    // 이끼 (받침대/꼭대기/처마)
    for (i = 0; i < d.moss.length; i++) {
      var m = d.moss[i];
      var my = i < 10 ? gy - 22 - m.dy * 0.6 : (i < 13 ? topL + 14 + m.dy * 0.4 : cy - R - 15);
      var mx = i < 10 ? x + m.x : x + 10 + (m.x / (TOWER_W + 16)) * (w - 20);
      c.fillStyle = m.c < 0.33 ? '#3b5520' : (m.c < 0.66 ? '#4c6a28' : '#5f7f30');
      c.beginPath();
      c.ellipse(mx, my, m.rx * (i < 10 ? 1 : 0.7), m.ry * (i < 10 ? 1 : 0.6), 0, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(144,173,78,0.5)';
    for (i = 0; i < 6; i++) {
      c.beginPath(); c.arc(x + 6 + i * 14, gy - 26 - (i % 2) * 4, 3, 0, Math.PI * 2); c.fill();
    }
    // 매달린 덩굴 (처마 아래)
    c.strokeStyle = '#4c6a28';
    c.lineWidth = 1.6;
    for (i = 0; i < d.vines.length; i++) {
      var v = d.vines[i];
      var vx = x + v.x, vy = cy + R + 16;
      var sway = Math.sin(animT * 1.3 + v.ph) * 4;
      c.beginPath();
      c.moveTo(vx, vy);
      c.quadraticCurveTo(vx + sway, vy + v.len * 0.5, vx + sway * 1.6, vy + v.len);
      c.stroke();
    }
  }

  function drawStone(c, s, gy) {
    var p = localPlayer();
    var base = gy - s.dy;
    var near = 0;
    if (p) {
      var dx = Math.abs(p.x + p.w / 2 - s.x);
      var dyy = Math.abs(p.y + p.h - base);
      near = clamp(1 - dx / 260, 0, 1) * clamp(1 - dyy / 260, 0, 1);
    }
    var done = mstate('h_dragon').done;
    var alpha = 0.12 + near * 0.33;
    if (s.active) alpha = 0.95;
    else if (done) alpha = 0.4 + near * 0.3;
    if (s.hold > 0) alpha = Math.max(alpha, 0.45 + s.hold * 0.25);
    if (s.bad > 0) alpha = Math.max(alpha, s.bad);
    c.globalAlpha = clamp(alpha, 0, 1);

    var w = 30, h = 46, x = s.x - w / 2, top = base - h;
    // 석판
    c.beginPath();
    c.moveTo(x, base);
    c.lineTo(x, top + 10);
    c.quadraticCurveTo(x, top, x + 10, top);
    c.lineTo(x + w - 10, top);
    c.quadraticCurveTo(x + w, top, x + w, top + 10);
    c.lineTo(x + w, base);
    c.closePath();
    var sg = c.createLinearGradient(x, 0, x + w, 0);
    sg.addColorStop(0, '#2c312d');
    sg.addColorStop(0.5, '#454c45');
    sg.addColorStop(1, '#262a27');
    c.fillStyle = sg;
    c.fill();
    c.strokeStyle = 'rgba(10,12,10,0.8)';
    c.lineWidth = 1.2;
    c.stroke();
    // 이끼
    c.fillStyle = '#3b5520';
    c.beginPath(); c.ellipse(x + 8, base - 3, 9, 4, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(x + w - 6, top + 6, 6, 3, 0.4, 0, Math.PI * 2); c.fill();
    // 발톱 자국
    var glowC = s.active || done ? '#7fe0b8' : (s.bad > 0 ? '#c0503a' : null);
    for (var i = 0; i < s.claws; i++) {
      var ox = x + w / 2 + (i - (s.claws - 1) / 2) * 7;
      c.strokeStyle = glowC || '#0e100e';
      c.lineWidth = 2.6;
      c.beginPath();
      c.moveTo(ox - 4, top + 10);
      c.quadraticCurveTo(ox, top + 20, ox + 3, top + 34);
      c.stroke();
      c.strokeStyle = 'rgba(160,170,150,0.25)';
      c.lineWidth = 0.8;
      c.beginPath();
      c.moveTo(ox - 2.5, top + 11);
      c.quadraticCurveTo(ox + 1.5, top + 21, ox + 4.5, top + 33);
      c.stroke();
    }
    // 활성 / 깨어남 발광
    if (s.active || s.flash > 0 || (done && near > 0)) {
      c.globalCompositeOperation = 'lighter';
      var a = s.active ? 0.35 + 0.15 * Math.sin(animT * 3 + s.claws) : 0.2 * near;
      a = Math.max(a, s.flash * 0.8);
      var gg = c.createRadialGradient(s.x, top + 22, 2, s.x, top + 22, 46);
      gg.addColorStop(0, 'rgba(127,224,184,' + a.toFixed(3) + ')');
      gg.addColorStop(1, 'rgba(127,224,184,0)');
      c.fillStyle = gg;
      c.beginPath(); c.arc(s.x, top + 22, 46, 0, Math.PI * 2); c.fill();
      c.globalCompositeOperation = 'source-over';
    }
    // 유지 게이지
    if (s.hold > 0) {
      c.globalAlpha = 0.9;
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineWidth = 4;
      c.beginPath(); c.arc(s.x, top - 14, 9, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#7fe0b8';
      c.lineWidth = 3;
      c.beginPath(); c.arc(s.x, top - 14, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(s.hold / 2, 0, 1)); c.stroke();
    }
    c.globalAlpha = 1;
  }

  function drawMoss(c, m, gy) {
    var bob = Math.sin(animT * 2.2 + m.seed) * 3;
    var x = m.x, y = gy - m.dy - 14 + bob;
    var pulse = 0.6 + 0.4 * Math.sin(animT * 3 + m.seed * 2);
    c.globalCompositeOperation = 'lighter';
    var gg = c.createRadialGradient(x, y, 2, x, y, 26);
    gg.addColorStop(0, 'rgba(170,255,120,' + (0.55 * pulse).toFixed(3) + ')');
    gg.addColorStop(1, 'rgba(120,220,90,0)');
    c.fillStyle = gg;
    c.beginPath(); c.arc(x, y, 26, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#3f6a22';
    c.beginPath(); c.ellipse(x, y + 4, 12, 7, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#6f9f3a';
    c.beginPath(); c.arc(x - 5, y, 6, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 5, y - 1, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#a8e060';
    c.beginPath(); c.arc(x + 1, y - 5, 4.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(235,255,190,0.9)';
    for (var i = 0; i < 3; i++) {
      var a = animT * 1.5 + i * 2.1 + m.seed;
      c.beginPath(); c.arc(x + Math.cos(a) * 14, y - 6 + Math.sin(a * 1.3) * 8, 1.4, 0, Math.PI * 2); c.fill();
    }
  }

  // ===========================================================================
  // DOM: 스타일 / HUD 트래커 / 시련 표시 / 배너
  // ===========================================================================
  var CSS = [
    '#mission-tracker{position:fixed;right:12px;top:42%;z-index:12;pointer-events:none;display:flex;flex-direction:column;gap:6px;align-items:flex-end;font-family:var(--font-body,"Noto Sans KR",system-ui,sans-serif);}',
    '#mission-tracker .mt-row{min-width:150px;max-width:44vw;padding:6px 10px 7px;border-radius:6px;background:linear-gradient(180deg,rgba(58,40,28,.88),rgba(30,22,17,.88));border:1px solid #7d4424;border-top:3px solid #4c6a28;box-shadow:0 2px 8px rgba(0,0,0,.45);color:#efe6d8;font-size:12px;line-height:1.25;}',
    '#mission-tracker .mt-row.trial{border-color:#b8642e;border-top-color:#ff9a3a;}',
    '#mission-tracker .mt-top{display:flex;justify-content:space-between;gap:10px;}',
    '#mission-tracker .mt-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#mission-tracker .mt-val{color:#ffd9a0;font-variant-numeric:tabular-nums;white-space:nowrap;}',
    '#mission-tracker .mt-bar{margin-top:4px;height:4px;border-radius:2px;background:rgba(0,0,0,.45);overflow:hidden;}',
    '#mission-tracker .mt-bar i{display:block;height:100%;background:linear-gradient(90deg,#5f7f30,#a8e060);}',
    '#mission-tracker .mt-label{font-size:10px;color:#b9ab98;letter-spacing:.08em;}',
    '#mission-trial{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:13;pointer-events:none;padding:6px 16px;border-radius:8px;background:linear-gradient(180deg,rgba(80,30,10,.9),rgba(40,16,8,.9));border:1px solid #ff9a3a;box-shadow:0 0 18px rgba(255,140,40,.35);color:#ffe7c0;font:700 15px/1.2 var(--font-title,var(--font-body,system-ui,sans-serif));white-space:nowrap;font-variant-numeric:tabular-nums;}',
    '#mission-banner{position:fixed;left:50%;top:17%;transform:translate(-50%,-10px);z-index:26;pointer-events:none;opacity:0;transition:opacity .35s,transform .35s;text-align:center;width:min(560px,calc(100% - 32px));padding:14px 18px 12px;border-radius:10px;background:linear-gradient(180deg,rgba(74,52,24,.95),rgba(36,26,14,.95));border:2px solid #ffd34a;box-shadow:0 0 30px rgba(255,200,70,.45),inset 0 0 0 1px rgba(0,0,0,.4);color:#fff3d6;font-family:var(--font-body,system-ui,sans-serif);}',
    '#mission-banner.show{opacity:1;transform:translate(-50%,0);}',
    '#mission-banner .mb-title{font:800 22px/1.2 var(--font-title,var(--font-body,system-ui,sans-serif));color:#ffd34a;text-shadow:0 0 12px rgba(255,200,70,.6);}',
    '#mission-banner .mb-skill{margin-top:6px;font-size:17px;font-weight:700;}',
    '#mission-banner .mb-hint{margin-top:6px;font-size:12px;color:#d8c8a8;}',
    '#missions-panel{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(8,10,9,.72);font-family:var(--font-body,"Noto Sans KR",system-ui,sans-serif);color:#efe6d8;}',
    '#missions-panel .mp-sheet{position:relative;display:flex;flex-direction:column;width:min(940px,100%);max-height:100%;border-radius:12px;border:3px solid #6e3a1d;box-shadow:0 12px 40px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,200,150,.08),inset 0 0 60px rgba(0,0,0,.5);background:radial-gradient(circle at 12% 8%,rgba(184,100,46,.35),transparent 38%),radial-gradient(circle at 88% 92%,rgba(138,74,34,.45),transparent 42%),radial-gradient(circle at 70% 20%,rgba(60,40,28,.6),transparent 30%),repeating-linear-gradient(0deg,rgba(0,0,0,.07) 0 2px,transparent 2px 7px),linear-gradient(180deg,#3d2c21,#2a1f19 60%,#1e1713);overflow:hidden;}',
    '#missions-panel .mp-sheet::before{content:"";position:absolute;left:0;right:0;top:0;height:16px;pointer-events:none;background:radial-gradient(ellipse 22px 10px at 6% 0,#5f7f30 60%,transparent 62%),radial-gradient(ellipse 30px 12px at 21% 0,#4c6a28 60%,transparent 62%),radial-gradient(ellipse 18px 9px at 37% 0,#6f8f3a 60%,transparent 62%),radial-gradient(ellipse 34px 13px at 58% 0,#3b5520 60%,transparent 62%),radial-gradient(ellipse 20px 10px at 76% 0,#5f7f30 60%,transparent 62%),radial-gradient(ellipse 28px 12px at 93% 0,#4c6a28 60%,transparent 62%);}',
    '#missions-panel .mp-sheet::after{content:"";position:absolute;inset:8px;pointer-events:none;background:radial-gradient(circle 4px at 0 0,#8a5a3a 70%,#2a1a10 72%,transparent 80%) 0 0/100% 100% no-repeat,radial-gradient(circle 4px at 100% 0,#8a5a3a 70%,#2a1a10 72%,transparent 80%),radial-gradient(circle 4px at 0 100%,#8a5a3a 70%,#2a1a10 72%,transparent 80%),radial-gradient(circle 4px at 100% 100%,#8a5a3a 70%,#2a1a10 72%,transparent 80%);}',
    '#missions-panel .mp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:20px 20px 8px;}',
    '#missions-panel .mp-head h2{margin:0;font:800 24px/1.1 var(--font-title,var(--font-body,system-ui,sans-serif));color:#ffcf9a;letter-spacing:.04em;text-shadow:0 2px 0 #2a1408,0 0 14px rgba(255,140,60,.25);}',
    '#missions-panel button{font:inherit;color:inherit;cursor:pointer;}',
    '#missions-panel .mp-close{padding:7px 14px;border-radius:6px;border:1px solid #8a4a22;background:linear-gradient(180deg,#5a3a26,#3a2618);color:#ffe0c0;font-weight:700;}',
    '#missions-panel .mp-close:hover{border-color:#ff9a5a;}',
    '#missions-panel .mp-tabs{display:flex;gap:6px;padding:4px 20px 0;border-bottom:2px solid rgba(110,58,29,.8);flex-wrap:wrap;}',
    '#missions-panel .mp-tab{padding:8px 14px;border:1px solid #6e3a1d;border-bottom:none;border-radius:8px 8px 0 0;background:rgba(30,20,14,.7);color:#c9b8a0;font-weight:700;font-size:14px;}',
    '#missions-panel .mp-tab.on{background:linear-gradient(180deg,#5f7f30,#3b5520);color:#f4ffe0;border-color:#7f9f40;}',
    '#missions-panel .mp-body{flex:1 1 auto;overflow-y:auto;padding:14px 20px 16px;-webkit-overflow-scrolling:touch;}',
    '#missions-panel .mp-note{font-size:13px;color:#d8c8a8;margin:0 0 10px;}',
    '#missions-panel .mp-note.warn{color:#ffb08a;}',
    '#missions-panel .mp-slots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px;}',
    '#missions-panel .mp-slot{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 4px 8px;border-radius:8px;border:2px solid rgba(255,255,255,.12);background:rgba(15,12,10,.6);min-height:84px;}',
    '#missions-panel .mp-slot.sel{border-color:#ffd34a;box-shadow:0 0 0 2px rgba(255,211,74,.25),0 0 16px rgba(255,211,74,.25);}',
    '#missions-panel .mp-slot .k{position:absolute;left:6px;top:4px;font:800 12px/1 Consolas,monospace;color:#ffd9a0;background:rgba(0,0,0,.5);border-radius:4px;padding:2px 5px;}',
    '#missions-panel .mp-slot .ic{font-size:26px;line-height:1.1;margin-top:6px;}',
    '#missions-panel .mp-slot .nm{font-size:12px;font-weight:700;text-align:center;word-break:keep-all;}',
    '#missions-panel .mp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;}',
    '#missions-panel .mp-card{position:relative;text-align:left;display:flex;flex-direction:column;gap:3px;padding:10px 10px 9px;border-radius:8px;border:1px solid rgba(0,0,0,.5);border-left:4px solid var(--c,#c9a35a);background:linear-gradient(180deg,rgba(70,50,36,.85),rgba(34,26,20,.9));box-shadow:inset 0 1px 0 rgba(255,220,180,.08);min-height:118px;}',
    '#missions-panel .mp-card:hover{box-shadow:0 0 0 1px var(--c,#c9a35a),inset 0 1px 0 rgba(255,220,180,.08);}',
    '#missions-panel .mp-card.locked{filter:grayscale(.85) brightness(.7);cursor:default;}',
    '#missions-panel .mp-card.eq{box-shadow:0 0 0 2px var(--c,#c9a35a);}',
    '#missions-panel .mp-card .row1{display:flex;align-items:center;gap:8px;}',
    '#missions-panel .mp-card .ic{font-size:24px;line-height:1;}',
    '#missions-panel .mp-card .el{font-size:11px;color:var(--c,#c9a35a);font-weight:700;}',
    '#missions-panel .mp-card .nm{font-size:15px;font-weight:800;}',
    '#missions-panel .mp-card .st{font-size:11px;color:#ffd9a0;font-variant-numeric:tabular-nums;}',
    '#missions-panel .mp-card .ds{font-size:12px;color:#d0c2ac;line-height:1.35;}',
    '#missions-panel .mp-card .lk{margin-top:auto;font-size:11px;color:#ffb08a;}',
    '#missions-panel .mp-card .eqb{position:absolute;right:8px;top:8px;font:800 11px/1 Consolas,monospace;background:var(--c,#c9a35a);color:#1a120c;border-radius:4px;padding:3px 6px;}',
    '#missions-panel .mp-rar{font-size:10px;padding:1px 5px;border-radius:3px;margin-left:auto;background:rgba(0,0,0,.35);color:#c9b8a0;}',
    '#missions-panel .mp-rar.hard{color:#e0b0ff;}',
    '#missions-panel .mp-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;}',
    '#missions-panel .mp-ms{padding:11px 12px;border-radius:8px;border:1px solid #6e3a1d;border-top:3px solid #4c6a28;background:linear-gradient(180deg,rgba(64,46,32,.88),rgba(32,24,18,.92));}',
    '#missions-panel .mp-ms.done{border-top-color:#ffd34a;}',
    '#missions-panel .mp-ms.hid{border-top-color:#6a4aa0;}',
    '#missions-panel .mp-ms .t{display:flex;justify-content:space-between;gap:8px;align-items:baseline;}',
    '#missions-panel .mp-ms .nm{font-weight:800;font-size:15px;}',
    '#missions-panel .mp-ms .ok{font-size:12px;color:#ffd34a;font-weight:800;white-space:nowrap;}',
    '#missions-panel .mp-ms .ds{font-size:12px;color:#d0c2ac;margin-top:3px;}',
    '#missions-panel .mp-ms .hint{font-size:13px;color:#cdb8ff;margin-top:5px;font-style:italic;}',
    '#missions-panel .mp-ms .bar{margin-top:8px;height:8px;border-radius:4px;background:rgba(0,0,0,.5);overflow:hidden;}',
    '#missions-panel .mp-ms .bar i{display:block;height:100%;background:linear-gradient(90deg,#4c6a28,#a8e060);}',
    '#missions-panel .mp-ms.done .bar i{background:linear-gradient(90deg,#c99a3a,#ffd34a);}',
    '#missions-panel .mp-ms .ft{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:12px;color:#ffd9a0;}',
    '#missions-panel .mp-ms .rw{color:#efe6d8;}',
    '#missions-panel .mp-empty{padding:30px 10px;text-align:center;color:#b9ab98;}',
    '#missions-panel .mp-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 20px 16px;border-top:1px solid rgba(110,58,29,.6);font-size:12px;color:#b9ab98;flex-wrap:wrap;}',
    '#missions-panel .mp-reset{padding:5px 10px;border-radius:5px;border:1px solid #5a2a1a;background:rgba(40,16,10,.6);color:#c99a8a;font-size:11px;}',
    '#missions-panel .mp-reset.arm{border-color:#ff5a3c;color:#ffd0c0;background:rgba(110,24,10,.75);}',
    '#missions-panel .mp-note.ok{color:#c8f08a;}',
    '#missions-panel .mp-body{scrollbar-color:#8a4a22 rgba(0,0,0,.3);scrollbar-width:thin;}',
    '#missions-panel .mp-abgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;}',
    '#missions-panel .mp-ab{position:relative;text-align:left;display:flex;flex-direction:column;gap:6px;padding:10px 10px 9px;border-radius:8px;border:1px solid rgba(0,0,0,.55);border-left:4px solid var(--c,#c9a35a);background:linear-gradient(180deg,rgba(70,50,36,.88),rgba(34,26,20,.92));box-shadow:inset 0 1px 0 rgba(255,220,180,.08);min-width:0;}',
    '#missions-panel .mp-ab:hover{box-shadow:0 0 0 1px var(--c,#c9a35a),inset 0 1px 0 rgba(255,220,180,.08);}',
    '#missions-panel .mp-ab:focus-visible{outline:2px solid #ffd34a;outline-offset:2px;}',
    '#missions-panel .mp-ab.on{border-color:#ffd34a;border-left-color:var(--c,#c9a35a);box-shadow:0 0 0 2px #ffd34a,0 0 18px rgba(255,211,74,.3);background:linear-gradient(180deg,rgba(92,66,34,.92),rgba(44,32,20,.94));}',
    '#missions-panel .mp-ab.locked{cursor:default;}',
    '#missions-panel .mp-ab.locked .ab-top,#missions-panel .mp-ab.locked .ab-ds,#missions-panel .mp-ab.locked .ab-sk{filter:grayscale(.85) brightness(.62);}',
    '#missions-panel .ab-top{display:flex;align-items:center;gap:8px;}',
    '#missions-panel .ab-ic{font-size:26px;line-height:1;filter:drop-shadow(0 0 6px var(--c,#c9a35a));}',
    '#missions-panel .ab-nm{font-size:17px;font-weight:800;color:#fff3e0;}',
    '#missions-panel .ab-eq{margin-left:auto;font-size:11px;font-weight:800;padding:3px 7px;border-radius:4px;background:#ffd34a;color:#1a120c;}',
    '#missions-panel .ab-top .mp-rar{margin-left:auto;}',
    '#missions-panel .ab-lock{font-size:14px;}',
    '#missions-panel .ab-ds{font-size:12px;color:#d0c2ac;line-height:1.35;}',
    '#missions-panel .ab-sk{display:grid;grid-template-columns:1fr;gap:3px;}',
    '#missions-panel .ab-sk .sk{display:grid;grid-template-columns:20px 20px minmax(0,1fr) auto;align-items:center;gap:6px;padding:3px 6px;border-radius:5px;background:rgba(0,0,0,.28);font-size:12px;}',
    '#missions-panel .ab-sk .sk.empty{opacity:.45;}',
    '#missions-panel .ab-sk .k{font:800 11px/16px Consolas,monospace;text-align:center;border-radius:4px;background:var(--c,#c9a35a);color:#1a120c;}',
    '#missions-panel .ab-sk .si{text-align:center;font-size:14px;line-height:1;}',
    '#missions-panel .ab-sk .sn{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#missions-panel .ab-sk .sc{font-size:11px;color:#ffd9a0;font-variant-numeric:tabular-nums;white-space:nowrap;}',
    '#missions-panel .ab-lk{font-size:11.5px;color:#ffb08a;line-height:1.35;padding-top:5px;border-top:1px dashed rgba(255,176,138,.3);}',
    '#missions-panel .ab-lk b{color:#ffd0b0;}',
    '#missions-panel .ab-bar{margin-top:5px;height:6px;border-radius:3px;background:rgba(0,0,0,.5);overflow:hidden;}',
    '#missions-panel .ab-bar i{display:block;height:100%;background:linear-gradient(90deg,#4c6a28,#a8e060);}',
    '#missions-panel .ab-pv{margin-top:2px;text-align:right;color:#ffd9a0;font-variant-numeric:tabular-nums;}',
    '@media (max-width:520px){#missions-panel .mp-abgrid{grid-template-columns:1fr;gap:8px;}#missions-panel .ab-nm{font-size:15px;}}',
    '@media (max-width:520px){#missions-panel{padding:6px;}#missions-panel .mp-head{padding:16px 12px 6px;}#missions-panel .mp-head h2{font-size:19px;}#missions-panel .mp-tabs{padding:4px 12px 0;}#missions-panel .mp-tab{padding:7px 9px;font-size:12px;}#missions-panel .mp-body{padding:12px;}#missions-panel .mp-foot{padding:8px 12px 12px;}#missions-panel .mp-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;}#missions-panel .mp-list{grid-template-columns:1fr;}#missions-panel .mp-slot{min-height:72px;padding:8px 2px 6px;}#missions-panel .mp-slot .ic{font-size:22px;}#missions-panel .mp-slot .nm{font-size:11px;}#mission-tracker .mt-row{min-width:120px;font-size:11px;}}'
  ].join('\n');

  function injectStyle() {
    if (!hasDom()) return;
    if (document.getElementById('missions-style')) return;
    var st = document.createElement('style');
    st.id = 'missions-style';
    st.textContent = CSS;
    (document.head || document.body).appendChild(st);
  }

  var hudTracker = null, hudTrial = null, bannerEl = null;
  var lastTrackerHtml = '', lastTrialText = '';
  var hudTimer = 0;

  function ensureHud() {
    if (!hasDom()) return;
    injectStyle();
    if (!hudTracker) {
      hudTracker = document.getElementById('mission-tracker') || document.createElement('div');
      hudTracker.id = 'mission-tracker';
      hudTracker.hidden = true;
      if (!hudTracker.parentNode) document.body.appendChild(hudTracker);
    }
    if (!hudTrial) {
      hudTrial = document.getElementById('mission-trial') || document.createElement('div');
      hudTrial.id = 'mission-trial';
      hudTrial.hidden = true;
      if (!hudTrial.parentNode) document.body.appendChild(hudTrial);
    }
  }

  function applicable(def) {
    if (def.onlyMode === 'practice') return G.mode === 'practice';
    if (def.onlyMode === 'online') return isOnlineMode();
    return true;
  }

  function currentValue(def) {
    var st = mstate(def.id);
    if (def.timed) return Math.floor(runT[def.id] || 0);
    return st.progress || 0;
  }

  function trackerHtml() {
    var html = '';
    var n = 0;
    if (trial) {
      html += '<div class="mt-row trial"><div class="mt-label">히든 시련</div><div class="mt-top"><span class="mt-name">🐉 용의 시련</span><span class="mt-val">' +
        trial.kills + '/15</span></div><div class="mt-bar"><i style="width:' + Math.round(trial.kills / 15 * 100) + '%"></i></div></div>';
    }
    for (var i = 0; i < DEFS.length && n < 2; i++) {
      var def = DEFS[i];
      if (def.hidden || !applicable(def)) continue;
      var st = mstate(def.id);
      if (st.done) continue;
      var goal = goalOf(def);
      var v = Math.min(goal, currentValue(def));
      html += '<div class="mt-row">' + (n === 0 ? '<div class="mt-label">진행 중인 미션</div>' : '') +
        '<div class="mt-top"><span class="mt-name">' + esc(def.name) + '</span><span class="mt-val">' + v + '/' + goal + (def.timed ? '초' : '') +
        '</span></div><div class="mt-bar"><i style="width:' + Math.round(v / goal * 100) + '%"></i></div></div>';
      n++;
    }
    return html;
  }

  function updateHud() {
    if (!hasDom()) return;
    if (!hudTracker) ensureHud();
    if (!hudTracker) return;
    var show = !!G.running && !panelOpen;
    if (hudTracker.hidden === show) hudTracker.hidden = !show;
    hudTimer -= 1 / 60;
    if (show && hudTimer <= 0) {
      hudTimer = 0.2;
      var html = trackerHtml();
      if (html !== lastTrackerHtml) { lastTrackerHtml = html; hudTracker.innerHTML = html; }
    }
    if (hudTrial) {
      var tt = trial && show ? '🐉 용의 시련 · 남은 시간 ' + Math.max(0, trial.t).toFixed(1) + '초 · 처치 ' + trial.kills + '/15' : '';
      if (tt !== lastTrialText) {
        lastTrialText = tt;
        hudTrial.textContent = tt;
        hudTrial.hidden = !tt;
      }
    }
  }

  var bannerQueue = [];
  var bannerBusy = false;
  function showBanner(def, info) {
    bannerQueue.push({ def: def, info: info });
    if (!bannerBusy) nextBanner();
  }
  function nextBanner() {
    if (!hasDom()) { bannerQueue.length = 0; bannerBusy = false; return; }
    var item = bannerQueue.shift();
    if (!item) { bannerBusy = false; return; }
    bannerBusy = true;
    injectStyle();
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'mission-banner';
      document.body.appendChild(bannerEl);
    }
    bannerEl.innerHTML = '<div class="mb-title">🎉 미션 클리어 — ' + esc(item.def.name) + '</div>' +
      '<div class="mb-skill">' + esc(item.info.text) + '</div>' +
      '<div class="mb-hint">[능력 · 미션] 에서 능력을 장착하세요</div>';
    // 리플로우 후 표시
    setTimeout(function () { if (bannerEl && bannerEl.classList) bannerEl.classList.add('show'); }, 20);
    setTimeout(function () {
      if (bannerEl && bannerEl.classList) bannerEl.classList.remove('show');
      setTimeout(nextBanner, 420);
    }, 4600);
  }

  // ===========================================================================
  // "능력 · 미션" 패널
  // ===========================================================================
  var panelEl = null, panelBody = null, panelFoot = null;
  var panelOpen = false;
  var panelTab = 'equip';
  var resetArmed = false, resetTimer = null;

  function ensurePanel() {
    if (!hasDom()) return false;
    injectStyle();
    if (panelEl) return true;
    panelEl = document.createElement('div');
    panelEl.id = 'missions-panel';
    panelEl.hidden = true;
    panelEl.innerHTML =
      '<div class="mp-sheet" role="dialog" aria-label="능력 · 미션">' +
        '<div class="mp-head"><h2>능력 · 미션</h2><button type="button" class="mp-close" data-act="close">닫기 ✕</button></div>' +
        '<div class="mp-tabs">' +
          '<button type="button" class="mp-tab" data-act="tab" data-val="equip">능력 선택</button>' +
          '<button type="button" class="mp-tab" data-act="tab" data-val="missions">미션</button>' +
          '<button type="button" class="mp-tab" data-act="tab" data-val="hidden">히든 미션</button>' +
        '</div>' +
        '<div class="mp-body"></div>' +
        '<div class="mp-foot"></div>' +
      '</div>';
    document.body.appendChild(panelEl);
    panelBody = panelEl.querySelector('.mp-body');
    panelFoot = panelEl.querySelector('.mp-foot');
    panelEl.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== panelEl) {
        if (t.getAttribute && t.getAttribute('data-act')) {
          handleAction(t.getAttribute('data-act'), t.getAttribute('data-val'));
          return;
        }
        t = t.parentNode;
      }
      if (e.target === panelEl) closePanel();
    });
    return true;
  }

  function handleAction(act, val) {
    if (act === 'close') { closePanel(); return; }
    if (act === 'tab') { panelTab = val === 'missions' || val === 'hidden' ? val : 'equip'; renderPanel(); return; }
    if (act === 'equip') { equip(val); renderPanel(); return; }
    if (act === 'reset') { pressReset(); return; }
  }

  // 능력 장착: 언제든 가능 (단, 시전 중 — 질주/시전 잠금/시전 동작 — 에는 거부)
  var panelMsg = null; // {text, warn}
  function equip(el) {
    if (!el) return false;
    var k = kitInfo(el);
    if (!k) return false;
    if (!Progress.isElementUnlocked(el)) {
      var md = ELEMENT_TO_MISSION[el];
      panelMsg = { warn: true, text: '🔒 ' + k.elementName + ' 능력은 잠겨 있어요' + (md ? ' — ' + (md.hidden ? '히든 미션을 찾아 보세요' : '미션 「' + md.name + '」 클리어 시 해금') : '') };
      return false;
    }
    var P = G.Powers, ok;
    if (P && typeof P.setElement === 'function') {
      try { ok = P.setElement(el); } catch (e) { ok = false; }
    } else {
      ok = Progress.setElement(el);
    }
    if (!ok) {
      panelMsg = { warn: true, text: '기술 시전 중에는 능력을 바꿀 수 없어요. 잠시 후 다시 눌러 주세요.' };
      return false;
    }
    if (Progress.element !== el) Progress.setElement(el);
    panelMsg = { warn: false, text: '✔ ' + k.icon + ' ' + k.elementName + ' 장착됨' };
    toast(k.icon + ' ' + k.elementName + ' 능력 장착');
    return true;
  }

  function pressReset() {
    if (!resetArmed) {
      resetArmed = true;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(function () { resetArmed = false; resetTimer = null; if (panelOpen) renderFoot(); }, 3500);
      renderFoot();
      return;
    }
    resetArmed = false;
    if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
    Progress.reset();
    panelMsg = null;
    var P = G.Powers;
    if (P) {
      if (typeof P.setElement === 'function') { try { P.setElement(START_ELEMENT); } catch (e) { /* 무시 */ } }
      if (typeof P.refreshSlots === 'function') { try { P.refreshSlots(); } catch (e2) { /* 무시 */ } }
    }
    toast('진행도를 초기화했습니다');
    renderPanel();
  }

  function fmtNum(v) { return typeof v === 'number' ? String(Math.round(v * 100) / 100) : '?'; }

  function abilityCard(k) {
    var el = k.element;
    var un = Progress.isElementUnlocked(el);
    var on = un && Progress.element === el;
    var S = G.Skills;
    var h = '<button type="button" class="mp-ab' + (un ? '' : ' locked') + (on ? ' on' : '') + '" data-act="equip" data-val="' + esc(el) + '" style="--c:' + esc(k.color || '#c9a35a') + '"' +
      ' aria-pressed="' + (on ? 'true' : 'false') + '" title="' + esc(k.elementName + (k.desc ? ' — ' + k.desc : '')) + '">';
    var rar = k.rarity === 'hard' ? '<span class="mp-rar hard">희귀</span>' : (k.rarity === 'start' ? '<span class="mp-rar">기본</span>' : '');
    h += '<div class="ab-top"><span class="ab-ic">' + esc(k.icon) + '</span><span class="ab-nm">' + esc(k.elementName) + '</span>' +
      (on ? '<span class="ab-eq">장착됨</span>' : rar) + (un ? '' : '<span class="ab-lock">🔒</span>') + '</div>';
    if (k.desc) h += '<div class="ab-ds">' + esc(k.desc) + '</div>';
    h += '<div class="ab-sk">';
    for (var i = 0; i < 4; i++) {
      var id = k.ids && k.ids[i];
      var d = id && S && S.defs ? S.defs[id] : null;
      if (!d) {
        h += '<div class="sk empty"><span class="k">' + SLOT_KEYS[i] + '</span><span class="si">·</span><span class="sn">비어 있음</span><span class="sc"></span></div>';
        continue;
      }
      var tip = d.name + ' (' + SLOT_KEYS[i] + ') — ' + (d.desc || '') + ' · 에너지 ' + fmtNum(d.cost) + ' · 재사용 ' + fmtNum(d.cooldown) + '초';
      h += '<div class="sk" title="' + esc(tip) + '"><span class="k">' + SLOT_KEYS[i] + '</span><span class="si">' + esc(d.icon) + '</span>' +
        '<span class="sn">' + esc(d.name) + '</span><span class="sc">⚡' + esc(fmtNum(d.cost)) + ' · ' + esc(fmtNum(d.cooldown)) + 's</span></div>';
    }
    h += '</div>';
    if (!un) {
      var md = ELEMENT_TO_MISSION[el];
      if (md) {
        var st = mstate(md.id), goal = goalOf(md), v = Math.min(goal, st.progress || 0);
        if (md.hidden) {
          h += '<div class="ab-lk"><b>히든 미션</b> — “' + esc(md.hint || '???') + '”</div>';
        } else {
          h += '<div class="ab-lk"><b>미션: ' + esc(md.name) + '</b> — ' + esc(md.desc) +
            '<div class="ab-bar"><i style="width:' + Math.round(v / goal * 100) + '%"></i></div>' +
            '<div class="ab-pv">' + v + '/' + goal + (md.timed ? '초' + (v ? ' (최고)' : '') : '') + '</div></div>';
        }
      } else {
        h += '<div class="ab-lk">잠김</div>';
      }
    }
    return h + '</button>';
  }

  function renderEquip() {
    var list = kitList();
    var cur = kitInfo(Progress.element);
    var h = '';
    if (panelMsg) h += '<p class="mp-note' + (panelMsg.warn ? ' warn' : ' ok') + '">' + esc(panelMsg.text) + '</p>';
    else h += '<p class="mp-note">능력을 하나 골라 장착하세요. J · K · L · I 키가 그 능력의 기술 4개가 됩니다. 현재: <b>' + esc(cur ? cur.icon + ' ' + cur.elementName : '🔥 불꽃') + '</b></p>';
    h += '<div class="mp-abgrid">';
    for (var i = 0; i < list.length; i++) h += abilityCard(list[i]);
    return h + '</div>';
  }

  function msCard(def, hiddenView) {
    var st = mstate(def.id);
    var goal = goalOf(def);
    var inf = rewardInfo(def);
    if (hiddenView && !st.done) {
      return '<div class="mp-ms hid"><div class="t"><span class="nm">??? (히든 미션)</span></div>' +
        '<div class="hint">“' + esc(def.hint) + '”</div>' +
        '<div class="ft"><span>보상: ???</span><span>🔒</span></div></div>';
    }
    var v = Math.min(goal, st.progress || 0);
    var pct = st.done ? 100 : Math.round(v / goal * 100);
    var unit = def.timed ? '초' : '';
    return '<div class="mp-ms' + (st.done ? ' done' : '') + (hiddenView ? ' hid' : '') + '">' +
      '<div class="t"><span class="nm">' + esc(def.name) + '</span>' + (st.done ? '<span class="ok">✔ 완료</span>' : '') + '</div>' +
      '<div class="ds">' + esc(def.desc) + '</div>' +
      (hiddenView ? '<div class="hint">“' + esc(def.hint) + '”</div>' : '') +
      (hiddenView ? '' : '<div class="bar"><i style="width:' + pct + '%"></i></div>') +
      '<div class="ft"><span class="rw">보상: ' + esc(inf.label) + ' 능력</span>' +
      (hiddenView ? '' : '<span>' + (st.done ? goal : v) + '/' + goal + unit + (def.timed && !st.done ? ' (최고)' : '') + '</span>') + '</div></div>';
  }

  function renderMissions(hidden) {
    var h = '<p class="mp-note">' + (hidden
      ? '필드 어딘가에 숨겨진 시험들. 수수께끼를 풀면 강력한 능력을 얻습니다.'
      : '미션은 혼자 연습과 온라인 대전 모두에서 진행됩니다. 클리어하면 새 능력을 얻어요.') + '</p><div class="mp-list">';
    for (var i = 0; i < DEFS.length; i++) {
      if (!!DEFS[i].hidden !== hidden) continue;
      h += msCard(DEFS[i], hidden);
    }
    return h + '</div>';
  }

  function renderFoot() {
    if (!panelFoot) return;
    var list = kitList();
    var total = list.length;
    var cnt = 0, i;
    for (i = 0; i < list.length; i++) if (Progress.isElementUnlocked(list[i].element)) cnt++;
    var doneN = 0;
    for (i = 0; i < DEFS.length; i++) if (mstate(DEFS[i].id).done) doneN++;
    panelFoot.innerHTML = '<span>해금한 능력 ' + cnt + ' / ' + total + ' · 완료한 미션 ' + doneN + ' / ' + DEFS.length + '</span>' +
      '<button type="button" class="mp-reset' + (resetArmed ? ' arm' : '') + '" data-act="reset">' + (resetArmed ? '정말요? 한 번 더 누르세요' : '진행도 초기화') + '</button>';
  }

  function renderPanel() {
    if (!panelEl) return;
    var tabs = panelEl.querySelectorAll('.mp-tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-val') === panelTab;
      if (tabs[i].classList) { if (on) tabs[i].classList.add('on'); else tabs[i].classList.remove('on'); }
    }
    var html = panelTab === 'missions' ? renderMissions(false) : (panelTab === 'hidden' ? renderMissions(true) : renderEquip());
    if (panelBody) panelBody.innerHTML = html;
    renderFoot();
  }

  function openPanel(tab) {
    if (!ensurePanel()) return false;
    if (tab === 'equip' || tab === 'missions' || tab === 'hidden') panelTab = tab;
    resetArmed = false;
    panelMsg = null;
    if (!Progress.isElementUnlocked(Progress.element)) Progress.element = START_ELEMENT;
    panelOpen = true;
    panelEl.hidden = false;
    renderPanel();
    return true;
  }

  function closePanel() {
    panelOpen = false;
    resetArmed = false;
    if (panelEl) panelEl.hidden = true;
  }

  // ===========================================================================
  // 공개
  // ===========================================================================
  Progress.load();
  G.Progress = Progress;
  if (G.Powers && typeof G.Powers.refreshSlots === 'function') {
    try { G.Powers.refreshSlots(); } catch (e) { /* 무시 */ }
  }

  G.Missions = {
    defs: DEFS,
    init: init,
    update: update,
    render: render,
    openPanel: openPanel,
    closePanel: closePanel,
    isPanelOpen: function () { return panelOpen; },
    equipElement: equip,               // (element) → bool (Powers.setElement 경유)
    // 디버그/테스트용
    _debug: {
      complete: complete,
      handleAction: handleAction,
      state: function () {
        return { simT: simT, runT: runT, bigbang: bigbang, stones: stones, trial: trial, clock: clock, moss: mossItems, holdLock: holdLock };
      },
      clockGeom: clockGeom,
      stoneUnder: stoneUnder
    }
  };

  subscribe();

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('keydown', onKeyDownCapture);
    window.addEventListener('keydown', function (e) {
      if (panelOpen && e && (e.key === 'Escape' || e.code === 'Escape')) closePanel();
    });
    window.addEventListener('pagehide', function () { if (dirty) Progress.save(); });
    window.addEventListener('beforeunload', function () { if (dirty) Progress.save(); });
  }
})();
