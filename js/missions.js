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
    dragonsummon: { element: 'dragon', elementName: '용족', name: '용족 소환', icon: '🐉', color: '#ff9a3a' },
    sum_guardian: { element: 'summon', elementName: '소환자', name: '수호 거신', icon: '🗽', color: '#5fe6d0' },
    steel_skin: { element: 'steel', elementName: '강철', name: '강철 피부', icon: '🛡️', color: '#b8c6d4' },
    shield_dome: { element: 'shield', elementName: '쉴드', name: '수호 돔', icon: '⛺', color: '#ffd35a' },
    ghost_wail: { element: 'ghost', elementName: '유령', name: '망령의 울부짖음', icon: '👻', color: '#b8c8ff' },
    scythe_reap: { element: 'scythe', elementName: '시간의 낫', name: '영혼 수확', icon: '🌙', color: '#ffd27a' }
  };
  // 능력(원소) 폴백 목록 — Game.Skills.kits 가 없을 때
  var ELEMENT_FALLBACK = [
    ['fire', '불꽃', '🔥', '#ff7a2a', 'start', ['fireball', 'flamedash', 'pillar', 'inferno']],
    ['water', '물', '💧', '#3aa8ff', 'easy', ['watercannon']], ['grass', '풀', '🌿', '#5fc24a', 'easy', ['vinebind']],
    ['electric', '전기', '⚡', '#ffe14a', 'easy', ['chainbolt']], ['ice', '얼음', '❄️', '#9ae6ff', 'easy', ['iceshard']],
    ['wind', '바람', '🌪️', '#b8f0d8', 'easy', ['tornado']], ['rock', '바위', '🪨', '#b08a5a', 'easy', ['rockspike']],
    ['sand', '모래', '🏜️', '#e0b860', 'easy', ['sandstorm']], ['body', '신체강화', '💪', '#ff5050', 'easy', ['bodyboost']],
    ['psychic', '염력', '🧠', '#b070ff', 'hard', ['psychograb']], ['void', '블랙홀', '🕳️', '#7a5aff', 'hard', ['blackhole']],
    ['time', '시간', '⏳', '#7ad0ff', 'hard', ['timestop']], ['dragon', '용족', '🐉', '#ff9a3a', 'hard', ['dragonsummon']],
    ['summon', '소환자', '🧿', '#5fe6d0', 'hard', ['sum_drone', 'sum_wolf', 'sum_golem', 'sum_guardian']],
    ['steel', '강철', '⚙️', '#b8c6d4', 'hard', ['steel_fist', 'steel_skin', 'steel_rail', 'steel_girder']],
    ['shield', '쉴드', '🔰', '#ffd35a', 'hard', ['shield_bash', 'shield_reflect', 'shield_dome', 'shield_fortress']],
    ['ghost', '유령', '👻', '#b8c8ff', 'hard', ['ghost_orb', 'ghost_phase', 'ghost_possess', 'ghost_wail']],
    ['scythe', '시간의 낫', '🌙', '#ffd27a', 'hard', ['scythe_slash', 'scythe_spin', 'scythe_rift', 'scythe_reap']]
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
      riddle: '스물다섯 개의 숨이 차례로 끊어지는 동안\n네 살갗엔 긁힌 자국 하나 없어야 하리.\n피 한 방울이 떨어지면 셈은 다시 하나부터 —\n흠 없는 마음만이 손대지 않고 사물을 움직인다.',
      desc: '피해를 한 번도 받지 않고 돌연변이 25마리 연속 처치', goal: 25, reward: 'psychograb',
      how: '돌연변이를 25마리 연속으로 처치하세요. 도중에 피해를 한 번이라도 받으면 진행도가 0으로 돌아갑니다. 경기가 바뀌어도 진행도는 이어집니다.' },
    { id: 'h_bigbang', hidden: true, name: '대폭발', hint: '한 번의 불꽃으로 무리를 삼켜라.',
      riddle: '가장 큰 불꽃은 단 한 번 피어난다.\n네 개의 그림자가 한자리에 모였을 때\n그 한가운데서 마지막 불꽃(I)을 터뜨려라.\n한꺼번에 재가 된 별들이 어둠의 구멍을 연다.',
      desc: '인페르노 한 방으로 돌연변이 4마리 이상 처치', goal: 4, reward: 'blackhole',
      how: '🔥 불꽃 능력을 장착하고, 돌연변이 4마리 이상이 모였을 때 한가운데서 인페르노(I 키)를 터뜨리세요. 한 번의 인페르노로 4마리를 처치해야 합니다.' },
    { id: 'h_clock', hidden: true, name: '멈춘 시계', hint: '무너진 시계탑은 정확한 박자를 기억한다.',
      riddle: '부서진 탑 꼭대기, 금이 간 얼굴 하나\n네 시 사십칠 분에 심장이 멎은 채 잠들었네.\n손이 닿지 않거든 멀리서 세 번 그 뺨을 두드려라.\n깨어난 바늘이 멈춘 시간을 너에게 건네리라.',
      desc: '무너진 시계탑의 시계판에 투사체를 3번 맞히기', goal: 3, reward: 'timestop',
      how: '시계탑은 맵 중앙의 버스·광고판 바로 왼쪽에 있습니다. 시계판을 향해 화염구 같은 투사체를 3번 맞히면 됩니다. 박자나 간격은 상관없고, 땅에서 쏘기 어려우면 광고판 위에 올라가서 쏘세요.' },
    { id: 'h_dragon', hidden: true, name: '용의 시련', hint: '세 개의 비석, 발톱 자국의 수를 세어라.',
      riddle: '세상의 서쪽 끝, 가장 높은 길 위, 동쪽 끝 —\n세 개의 비석이 발톱 자국을 품고 잠들었다.\n하나, 둘, 셋, 그 수를 따라 무릎 꿇고 두 숨을 기다려라.\n깨어난 용은 아흔 번의 숨 안에 열다섯의 피를 원하리니.',
      desc: '숨겨진 용 비석 3개를 발톱 수 순서대로 깨우고, 시련(90초 안에 돌연변이 15마리)을 통과', goal: 15, reward: 'dragonsummon',
      how: '혼자 연습에서만 할 수 있습니다. 비석 위에 서서 아래 키(S/↓)를 2초 동안 누르면 비석이 깨어납니다. 순서는 ① 발톱 1개: 맵 맨 왼쪽 끝 바닥 → ② 발톱 2개: 왼쪽 고가도로(가장 높은 발판) 위 오른쪽 끝 → ③ 발톱 3개: 맵 맨 오른쪽 끝 바닥입니다. 순서가 틀리면 모두 꺼집니다. 셋을 다 깨우면 시련이 시작되고, 90초 안에 돌연변이 15마리를 처치해야 합니다.' },
    { id: 'h_summon', hidden: true, name: '두 군주의 계약', hint: '녹슨 짐승과 이끼의 여왕, 둘 모두를 꺾은 자에게 영혼이 응답한다.',
      riddle: '녹슨 쇳덩이 짐승과 이끼 옷을 입은 여왕,\n두 왕관이 땅에 떨어지는 것을 지켜보아라.\n단, 그 몸에 네 손길이 한 번은 닿았어야 하리.\n두 군주의 몰락을 증명한 자에게 영혼이 무릎 꿇는다.',
      desc: '서로 다른 보스 2종(녹슨 거수 · 이끼 여왕)을 각각 한 번씩 쓰러뜨리기 (누적, 그 보스에게 기술을 1번 이상 맞혀야 인정)', goal: 2, reward: 'sum_guardian',
      how: '보스는 일반 경기에서 시작 90초 뒤 처음 나오고(첫 보스는 녹슨 거수), 쓰러진 뒤 180초마다 종류를 바꿔 다시 나옵니다. 「보스전」 모드에서는 5초 뒤부터 녹슨 거수 → 이끼 여왕 순서로 계속 나와 가장 빠릅니다. 보스가 살아 있는 동안 아무 기술로나 그 보스를 최소 1번 맞히고, 그 보스가 쓰러지면(누가 막타를 쳐도 됨) 그 종류가 인정됩니다. 녹슨 거수와 이끼 여왕을 모두 인정받으면 클리어. 경기가 바뀌어도 인정된 종류는 남습니다.' },
    { id: 'h_steel', hidden: true, name: '강철 심장', hint: '쓰러지지 않는 몸은 강철로 벼려진다.',
      riddle: '강철은 망치질 속에서만 태어난다.\n네 그릇(100)보다 큰 고통, 백팔십을 삼키되\n단 한 번도 무너지지 마라 — 쓰러지면 다시 쇳물이니.\n상처를 메우며 버틴 몸만이 강철의 심장을 얻는다.',
      desc: '한 목숨으로(KO 없이) 누적 피해 180 받기', goal: 180, reward: 'steel_skin',
      how: '경기 중 한 번도 KO 되지 않은 채로 받은 피해의 합이 180이 되어야 합니다 (최대 체력은 100). 회복 키트(빨간 상자, +35)를 줍거나 회복 기술(풀 · 시간 · 쉴드의 수호 돔 등)로 체력을 채우며 버티세요. 보스와 돌연변이 무리 근처에서 버티면 빨리 쌓입니다. KO 되거나 새 경기를 시작하면 진행도가 0으로 돌아갑니다. 강화 혈청의 피해 감소로 줄어든 피해는 줄어든 만큼만 셉니다.' },
    { id: 'h_shield', hidden: true, name: '이끼 수호자', hint: '이끼의 가호가 머무는 찰나에 적을 베어라.',
      riddle: '하늘에서 초록 장막이 떨어져 내린다.\n그것이 너를 감싸는 세 번의 숨 동안\n네 손으로 괴물의 숨 하나를 거두어라.\n세 번의 가호를 모은 자, 스스로 방패가 되리라.',
      desc: '이끼 보호막 아이템을 주운 뒤 보호막이 켜진 3초 안에 돌연변이 처치하기 — 3번 (누적)', goal: 3, reward: 'shield_dome',
      how: '아이템은 경기 시작 6초 뒤부터 10~15초마다 하늘에서 떨어집니다. 그중 초록빛의 「이끼 보호막」(3초 무적)을 주운 뒤, 3초 안에 돌연변이(종류 무관, 보스 포함)를 직접 처치(막타)하세요. 보호막 1번당 1회만 인정되고 3번 모으면 클리어. 돌연변이 무리 근처에 떨어진 보호막을 노리거나, 체력이 낮은 돌연변이를 남겨 두었다가 줍자마자 마무리하세요.' },
    { id: 'h_ghost', hidden: true, name: '떠도는 혼', hint: '죽음에서 돌아온 숨으로 산 것을 데려가라.',
      riddle: '한 번 쓰러져 본 자만이 넘는 문턱이 있다.\n저승에서 돌아온 숨이 채 식기 전에,\n다섯을 세기 전에 산 것 하나를 데려가라.\n세 번 돌아오고 나면, 너는 이미 혼이니.',
      desc: 'KO 당한 뒤 부활하고 5초 안에 돌연변이 처치하기 — 3번 (누적)', goal: 3, reward: 'ghost_wail',
      how: '어떤 모드에서든 KO 된 뒤 다시 살아나면(부활) 5초의 「저승의 숨」 시간이 열립니다. 그 5초 안에 돌연변이(종류 무관, 보스 포함)를 직접 처치(막타)하세요. 부활 1번당 1회만 인정되고 3번 모으면 클리어. 돌연변이 무리 근처에서 쓰러지면 부활 지점 근처에 적이 남아 있어 쉽습니다. 부활 직후 1.5초 무적도 활용하세요.' },
    { id: 'h_scythe', hidden: true, name: '시계탑 뒤의 낫', hint: '멈춘 시계가 다시 뛰면, 그 등 뒤를 보라.',
      riddle: '멈춘 시계가 다시 숨을 쉬는 날,\n탑의 등 뒤 그늘진 발치를 살펴라.\n시간을 베던 낫이 금빛 꿈을 꾸고 있으니\n무릎 꿇고 두 번 숨 쉬는 동안 손을 내밀어라.',
      desc: '「멈춘 시계」를 클리어한 뒤, 시계탑 뒤쪽 받침대 발치에서 아래 키를 2초 동안 누르기', goal: 1, reward: 'scythe_reap',
      how: '먼저 히든 미션 「멈춘 시계」를 클리어해야 합니다(그전에는 아무것도 보이지 않아요). 클리어 후 시계탑(맵 중앙 버스·광고판 바로 왼쪽) 오른쪽 아래 받침대 발치에 희미한 금빛 반짝임이 나타납니다. 그 위 바닥에 서서 아래 키(S/↓)를 2초 동안 누르면 전설의 무기 「시간의 낫」을 손에 넣습니다. 어떤 모드에서든 가능합니다.' }
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
  var bossHit = {};      // 보스 종류 → 이번 개체에 내 기술이 맞았는가 (h_summon)
  var shieldWin = { until: -1, used: true };   // 이끼 보호막 유효 시간 (h_shield)
  var SHIELD_WINDOW = 3.2;
  // h_ghost: KO → 부활 직후 5초 창
  var GHOST_WINDOW = 5.2;
  var ghostWin = { pendingKO: false, until: -1, used: true, wasAlive: true };
  // h_scythe: 시계탑 뒤 낫 (h_clock 완료 후)
  var scythe = { hold: 0, lock: false, flash: 0, reveal: 0 };

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
    bossHit = {};
    shieldWin = { until: -1, used: true };
    ghostWin = { pendingKO: false, until: -1, used: true, wasAlive: true };
    scythe = { hold: 0, lock: false, flash: 0, reveal: 0 };
    resetSteel();
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
    on.call(G.events, 'mutantHitByMe', function (d) {
      addProgress('m_marks', 1);
      if (d && typeof d.type === 'string' && isBossType(d.type)) bossHit[d.type] = true;
    });
    on.call(G.events, 'bossDefeated', onBossDefeated);
    on.call(G.events, 'itemPickup', function (d) {
      if (!d || d.type !== 'shield' || d.local === false) return;
      shieldWin = { until: simT + SHIELD_WINDOW, used: false };
    });
    on.call(G.events, 'playerDamaged', function (d) {
      if (d && typeof d.amount === 'number' && d.amount <= 0) return;
      runT.m_cool = 0;
      resetFlawless();
      if (d && typeof d.amount === 'number' && d.amount > 0) addSteel(d.amount);
    });
    on.call(G.events, 'playerKO', function () {
      runT.m_cool = 0;
      runT.m_survive = 0;
      resetFlawless();
      resetSteel();
      ghostWin.pendingKO = true;
      ghostWin.used = true;
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

  var steelAcc = 0;
  function addSteel(n) {
    var st = mstate('h_steel');
    if (st.done) return;
    steelAcc += n;
    var v = Math.floor(steelAcc);
    if (v >= goalOf(DEF_BY_ID.h_steel)) { complete('h_steel'); return; }
    if (v !== st.progress) { st.progress = v; markDirty(); }
  }
  function resetSteel() {
    steelAcc = 0;
    var st = mstate('h_steel');
    if (st.done) return;
    if (st.progress) { st.progress = 0; markDirty(); }
  }
  function isBossType(t) {
    var M = G.Mutants;
    if (M && M.types && M.types[t]) return !!M.types[t].boss;
    var b = M && typeof M.boss === 'function' ? M.boss() : null;
    return !!(b && b.type === t);
  }
  // 보스 처치(모든 클라이언트) — 내가 그 보스를 1번 이상 맞혔으면 그 종류 인정
  function onBossDefeated(d) {
    var t = d && typeof d.type === 'string' ? d.type : null;
    if (!t || !bossHit[t]) return;
    bossHit[t] = false;
    var st = mstate('h_summon');
    if (st.done) return;
    if (!st.kinds) st.kinds = [];
    if (st.kinds.indexOf(t) >= 0) return;
    st.kinds.push(t);
    st.progress = Math.max(0, st.kinds.length - 1);
    addProgress('h_summon', 1);
  }

  function onMutantKilled(d) {
    d = d || {};
    if (!shieldWin.used && simT <= shieldWin.until) { shieldWin.used = true; addProgress('h_shield', 1); }
    if (!ghostWin.used && simT <= ghostWin.until) {
      ghostWin.used = true;
      var gs = mstate('h_ghost');
      if (!gs.done) {
        addProgress('h_ghost', 1);
        var gp = localPlayer();
        if (gp) particles(gp.x + gp.w / 2, gp.y + gp.h / 2, 22, '#b8c8ff', 300);
        if (!gs.done) toast('👻 저승에서 돌아온 혼이 생명을 거두었다… (' + gs.progress + '/' + goalOf(DEF_BY_ID.h_ghost) + ')');
      }
    }
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
    // (쉬운 버전: 박자 제한 없음)
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
    clock.streak++;
    // 간격 상관없이 누적
    clock.last = simT;
    clock.flash = 1;
    particles(x, y, 12, '#ffd34a', 260);
    particles(x, y, 6, '#c08a3a', 160);
    if (clock.streak >= 3) {
      clock.streak = 0;
      complete('h_clock');
    }
  }

  // ===========================================================================
  // 시간의 낫 (시계탑 뒤 — h_clock 완료 후에만 보이고 집을 수 있음)
  // ===========================================================================
  var SCYTHE_X = TOWER_X + TOWER_W - 10;   // 1812: 탑 오른쪽 받침대 발치
  var SCYTHE_HOLD = 2;
  function scytheVisible() { return mstate('h_clock').done && !mstate('h_scythe').done; }
  function scytheUnder(p) {
    if (!p || !p.alive || !p.onGround) return false;
    if (Math.abs(p.x + p.w / 2 - SCYTHE_X) > 30) return false;
    return Math.abs(p.y + p.h - groundY()) <= 4;
  }
  function updateScythe(dt, p) {
    if (scythe.flash > 0) scythe.flash = Math.max(0, scythe.flash - dt * 1.2);
    if (scythe.reveal > 0) scythe.reveal = Math.max(0, scythe.reveal - dt);
    var held = downHeld();
    if (!held) scythe.lock = false;
    if (!scytheVisible() || !p || !held || scythe.lock || !scytheUnder(p)) { scythe.hold = 0; return; }
    p.frozen = Math.max(p.frozen || 0, 0.12);   // 무릎 꿇는 자세
    var prev = scythe.hold;
    scythe.hold += dt;
    var gy = groundY();
    if (Math.floor(prev * 6) !== Math.floor(scythe.hold * 6)) particles(SCYTHE_X + 8, gy - 30, 3, '#ffd27a', 120);
    if (scythe.hold >= SCYTHE_HOLD) {
      scythe.hold = 0;
      scythe.lock = true;
      pickScythe();
    }
  }
  function pickScythe() {
    var gy = groundY();
    scythe.flash = 1;
    scythe.reveal = 2.5;
    particles(SCYTHE_X + 10, gy - 40, 60, '#ffd27a', 620);
    particles(SCYTHE_X + 10, gy - 40, 34, '#fff3c0', 420);
    particles(SCYTHE_X + 10, gy - 40, 24, '#7ad0ff', 300);
    particles(FACE_CX, clockGeom().cy, 20, '#ffd34a', 260);
    clock.flash = 1;
    if (typeof G.shake === 'function') { try { G.shake(12); } catch (e) { /* 무시 */ } }
    toast('⌛ 전설의 무기 「시간의 낫」을 손에 넣었다!');
    complete('h_scythe');
  }
  // 탑보다 먼저 그림 → 탑 몸체에 가려지고 칼날 끝만 오른쪽으로 삐져나옴
  function drawScytheBehind(c, gy) {
    if (!scytheVisible()) return;
    var x = SCYTHE_X, base = gy - 24;   // 받침대 윗면에 기대어 섬
    var pulse = 0.55 + 0.45 * Math.sin(animT * 2.4);
    c.lineCap = 'round';
    // 자루 (탑 뒤에 비스듬히 기댐)
    c.strokeStyle = '#3a2a1a';
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(x - 6, base + 22); c.lineTo(x + 14, base - 96); c.stroke();
    // 칼날 (자루 끝에서 오른쪽 아래로 휘어짐)
    var hx = x + 14, hy = base - 96;
    c.beginPath();
    c.moveTo(hx, hy);
    c.quadraticCurveTo(hx + 44, hy - 14, hx + 58, hy + 26);
    c.quadraticCurveTo(hx + 36, hy + 2, hx + 2, hy + 8);
    c.closePath();
    var bg = c.createLinearGradient(hx, hy - 10, hx + 58, hy + 26);
    bg.addColorStop(0, '#8a6a2a');
    bg.addColorStop(0.6, '#ffd27a');
    bg.addColorStop(1, '#fff3c0');
    c.fillStyle = bg;
    c.globalAlpha = 0.55 + 0.35 * pulse;
    c.fill();
    c.globalAlpha = 1;
    c.lineCap = 'butt';
  }
  // 탑 다음에 그림 → 받침대 발치의 금빛 반짝임 + 유지 게이지
  function drawScytheFront(c, gy) {
    var p = localPlayer();
    var near = 0;
    if (p) near = clamp(1 - Math.abs(p.x + p.w / 2 - SCYTHE_X) / 300, 0, 1);
    var gx = SCYTHE_X + 6, gyy = gy - 12;
    c.globalCompositeOperation = 'lighter';
    if (mstate('h_scythe').done) {
      // 빈 받침: 아주 옅은 잔광만
      if (scythe.reveal > 0 || near > 0.6) {
        var ra = Math.max(scythe.reveal / 2.5 * 0.8, (near - 0.6) * 0.2);
        var rg = c.createRadialGradient(gx, gyy, 1, gx, gyy, 40);
        rg.addColorStop(0, 'rgba(255,210,122,' + ra.toFixed(3) + ')');
        rg.addColorStop(1, 'rgba(255,210,122,0)');
        c.fillStyle = rg;
        c.beginPath(); c.arc(gx, gyy, 40, 0, Math.PI * 2); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = 'rgba(30,20,12,0.6)';
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(SCYTHE_X - 8, gy - 24); c.lineTo(SCYTHE_X + 4, gy - 24); c.stroke();
      return;
    }
    if (!mstate('h_clock').done) {
      // 아직 봉인: 아주 가끔 스치는 미세한 반짝임
      var ph = (animT % 9) / 9;
      if (ph > 0.94) {
        var sa = Math.sin((ph - 0.94) / 0.06 * Math.PI) * 0.22;
        c.fillStyle = 'rgba(255,230,160,' + sa.toFixed(3) + ')';
        c.beginPath(); c.arc(gx, gyy, 2, 0, Math.PI * 2); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
      return;
    }
    var pulse = 0.5 + 0.5 * Math.sin(animT * 2.4);
    var a = 0.18 + 0.2 * pulse + near * 0.25 + scythe.hold * 0.2;
    var gg = c.createRadialGradient(gx, gyy, 1, gx, gyy, 30 + near * 12);
    gg.addColorStop(0, 'rgba(255,220,130,' + clamp(a, 0, 1).toFixed(3) + ')');
    gg.addColorStop(1, 'rgba(255,190,80,0)');
    c.fillStyle = gg;
    c.beginPath(); c.arc(gx, gyy, 30 + near * 12, 0, Math.PI * 2); c.fill();
    // 반짝이는 십자 별
    var tw = 4 + 3 * pulse;
    c.strokeStyle = 'rgba(255,243,192,' + (0.5 + 0.4 * pulse).toFixed(3) + ')';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(gx - tw, gyy); c.lineTo(gx + tw, gyy);
    c.moveTo(gx, gyy - tw); c.lineTo(gx, gyy + tw);
    c.stroke();
    // 떠오르는 금가루
    c.fillStyle = 'rgba(255,230,160,0.8)';
    for (var i = 0; i < 3; i++) {
      var t = (animT * 0.5 + i / 3) % 1;
      c.globalAlpha = (1 - t) * (0.4 + near * 0.6);
      c.beginPath(); c.arc(gx + Math.sin(animT * 1.7 + i * 2) * 8, gyy - t * 40, 1.3, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    // 유지 게이지
    if (scythe.hold > 0) {
      var ry = p ? p.y - 16 : gy - 84;
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineWidth = 4;
      c.beginPath(); c.arc(SCYTHE_X, ry, 10, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#ffd27a';
      c.lineWidth = 3;
      c.beginPath(); c.arc(SCYTHE_X, ry, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(scythe.hold / SCYTHE_HOLD, 0, 1)); c.stroke();
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
      // 떠도는 혼: KO 후 부활(죽음 → 삶) 순간에 5초 창 열기
      if (alive && !ghostWin.wasAlive && ghostWin.pendingKO) {
        ghostWin.pendingKO = false;
        if (!mstate('h_ghost').done) {
          ghostWin.until = simT + GHOST_WINDOW;
          ghostWin.used = false;
          particles(p.x + p.w / 2, p.y + p.h / 2, 16, '#b8c8ff', 220);
        }
      }
      ghostWin.wasAlive = alive;
      updateClock(dt);
      updateScythe(dt, alive ? p : null);
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
      try { drawScytheBehind(ctx, gy); } catch (e) { /* 무시 */ }
      ctx.restore();
      ctx.save();
      try { drawTower(ctx, gy); } catch (e) { /* 무시 */ }
      ctx.restore();
      ctx.save();
      try { drawScytheFront(ctx, gy); } catch (e) { /* 무시 */ }
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
    var secA = (done ? 0 : clock.streak) / 3 * Math.PI * 2 - Math.PI / 2;
    c.strokeStyle = done ? '#ffb020' : '#8a2a1a';
    c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(secA) * R * 0.86, cy + Math.sin(secA) * R * 0.86); c.stroke();
    c.lineCap = 'butt';
    c.fillStyle = '#1c150e';
    c.beginPath(); c.arc(cx, cy, 3, 0, Math.PI * 2); c.fill();

    // 금빛 표시 5개 (시계판 위 호)
    for (i = 0; i < 3; i++) {
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
    '#missions-panel .mp-ms .riddle{position:relative;margin-top:8px;padding:10px 12px 10px 14px;border-radius:6px;border:1px solid rgba(160,120,220,.35);border-left:3px solid #8a6ad0;background:linear-gradient(180deg,rgba(236,220,186,.13),rgba(120,90,160,.12)),radial-gradient(circle at 90% 10%,rgba(205,184,255,.12),transparent 50%);color:#efe2c4;font:italic 500 13.5px/1.7 var(--font-body,"Noto Serif KR",serif);letter-spacing:.01em;text-shadow:0 1px 0 rgba(0,0,0,.4);word-break:keep-all;}',
    '#missions-panel .mp-ms .riddle::before{content:"❝";position:absolute;right:8px;top:2px;font-size:22px;color:rgba(205,184,255,.35);font-style:normal;}',
    '#missions-panel .mp-ms .rd-seal{margin-top:6px;font-size:12px;color:#b9a6e0;font-style:italic;}',
    '#missions-panel .mp-ms .rd-ans{margin-top:7px;font-size:12px;}',
    '#missions-panel .mp-ms .rd-ans summary{cursor:pointer;color:#cdb8ff;font-weight:700;user-select:none;list-style:none;display:inline-block;padding:2px 8px;border-radius:4px;border:1px dashed rgba(205,184,255,.4);background:rgba(40,28,60,.4);}',
    '#missions-panel .mp-ms .rd-ans summary::-webkit-details-marker{display:none;}',
    '#missions-panel .mp-ms .rd-ans[open] summary{margin-bottom:4px;}',
    '#missions-panel .ab-rd{margin-top:3px;font-style:italic;color:#d8c8ff;}',
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
      panelMsg = { warn: true, text: '🔒 ' + k.elementName + ' 능력은 잠겨 있어요' + (md ? ' — ' + (md.hidden ? '히든 미션 「' + md.name + '」: “' + riddleFirst(md) + '” (히든 미션 탭에서 수수께끼를 풀어 보세요)' : '미션 「' + md.name + '」 클리어 시 해금') : '') };
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
          h += '<div class="ab-lk"><b>🔮 히든 미션: ' + esc(md.name) + '</b><div class="ab-rd">“' + esc(riddleFirst(md)) + '”</div>' +
            '<div class="ab-bar"><i style="width:' + Math.round(v / goal * 100) + '%"></i></div>' +
            '<div class="ab-pv">' + hiddenProgText(md, v, goal) + '</div></div>';
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

  // 수수께끼 (줄 목록 / 첫 줄)
  function riddleLines(def) {
    var r = def && (def.riddle || def.hint);
    return r ? String(r).split('\n') : [];
  }
  function riddleFirst(def) {
    var l = riddleLines(def);
    return l.length ? l[0] : (def ? def.name : '');
  }
  // 히든 미션 진행 표시: 시작 전에는 목표를 숨김
  function hiddenProgText(def, v, goal) {
    if (mstate(def.id).done) return goal + '/' + goal;
    return v > 0 ? v + '/' + goal : '?/???';
  }

  function hiddenCard(def) {
    var st = mstate(def.id);
    var goal = goalOf(def);
    var inf = rewardInfo(def);
    var v = Math.min(goal, st.progress || 0);
    var pct = st.done ? 100 : Math.round(v / goal * 100);
    var lines = riddleLines(def), rd = '';
    for (var i = 0; i < lines.length; i++) rd += (i ? '<br>' : '') + esc(lines[i]);
    var exact = '<div class="ds"><b>조건:</b> ' + esc(def.desc) + '</div>' +
      (def.how ? '<div class="ds"><b>방법:</b> ' + esc(def.how) + '</div>' : '');
    var locked = def.id === 'h_scythe' && !mstate('h_clock').done && !st.done;
    return '<div class="mp-ms hid' + (st.done ? ' done' : '') + '">' +
      '<div class="t"><span class="nm">🔮 ' + esc(def.name) + '</span>' + (st.done ? '<span class="ok">✔ 완료</span>' : '') + '</div>' +
      (rd ? '<div class="riddle">' + rd + '</div>' : '') +
      (locked ? '<div class="rd-seal">⏳ 무언가가 아직 잠들어 있다… 다른 수수께끼가 먼저 풀려야 할 것 같다.</div>' : '') +
      (st.done ? exact : '<details class="rd-ans"><summary>💡 정답 보기</summary>' + exact + '</details>') +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="ft"><span class="rw">보상: ' + esc(inf.label) + ' 능력</span>' +
      '<span>' + hiddenProgText(def, v, goal) + '</span></div></div>';
  }

  function msCard(def, hiddenView) {
    if (hiddenView) return hiddenCard(def);
    var st = mstate(def.id);
    var goal = goalOf(def);
    var inf = rewardInfo(def);
    var v = Math.min(goal, st.progress || 0);
    var pct = st.done ? 100 : Math.round(v / goal * 100);
    var unit = def.timed ? '초' : '';
    return '<div class="mp-ms' + (st.done ? ' done' : '') + (hiddenView ? ' hid' : '') + '">' +
      '<div class="t"><span class="nm">' + (hiddenView ? '🔮 ' : '') + esc(def.name) + '</span>' + (st.done ? '<span class="ok">✔ 완료</span>' : '') + '</div>' +
      '<div class="ds"><b>조건:</b> ' + esc(def.desc) + '</div>' +
      (def.how ? '<div class="ds"><b>방법:</b> ' + esc(def.how) + '</div>' : '') +
      (hiddenView && def.hint ? '<div class="hint">“' + esc(def.hint) + '”</div>' : '') +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="ft"><span class="rw">보상: ' + esc(inf.label) + ' 능력</span>' +
      '<span>' + (st.done ? goal : v) + '/' + goal + unit + (def.timed && !st.done ? ' (최고)' : '') + '</span></div></div>';
  }

  function hiddenCount() { var n = 0; for (var i = 0; i < DEFS.length; i++) if (DEFS[i].hidden) n++; return n; }
  function hiddenDone() { var n = 0; for (var i = 0; i < DEFS.length; i++) if (DEFS[i].hidden && mstate(DEFS[i].id).done) n++; return n; }
  function renderMissions(hidden) {
    var h = '<p class="mp-note">' + (hidden
      ? '🔮 수수께끼를 풀어 숨겨진 능력을 깨우세요. 히든 미션 ' + hiddenCount() + '개 (완료 ' + hiddenDone() + '개) — 도저히 모르겠다면 「💡 정답 보기」를 열어 보세요. (보스가 나와 있는 동안에는 발판이 봉쇄되니, 발판이 필요한 미션은 보스가 없을 때 하세요.)'
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
