// =============================================================================
// touch.js — 휴대폰(터치) 조작
//  - 터치 기기(또는 ?touch=1)에서만 켜짐. ?touch=0 이면 강제로 끔.
//  - 왼쪽: 플로팅 조이스틱 (좌/우 이동, 아래로 당기면 발판 내려가기, 위로 당기면 점프)
//  - 오른쪽: 큰 점프 버튼 + 기술 4개(J/K/L/I)를 부채꼴로 배치
//  - 입력은 KeyboardEvent 를 window 에 흘려 보내 world.js / powers.js 의 기존 키 입력 경로를 그대로 탄다.
//    (포인터마다 누른 키를 따로 기억하므로 이동 + 점프 + 기술 동시 입력 가능)
// =============================================================================
(function () {
  'use strict';

  var G = window.Game || (window.Game = {});
  if (G.Touch) return;   // 중복 로드 방지

  // ---------------------------------------------------------------------------
  // 켜짐 여부
  // ---------------------------------------------------------------------------
  var qs = String(location.search || '');
  var forceOn = /[?&]touch=1\b/.test(qs);
  var forceOff = /[?&]touch=0\b/.test(qs);

  function mq(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; }
  }
  function detectTouch() {
    if (forceOff) return false;
    if (forceOn) return true;
    if (mq('(pointer: coarse)')) return true;
    // 터치스크린 노트북(마우스가 주 입력)은 제외
    return ('ontouchstart' in window) && !mq('(pointer: fine)');
  }

  var enabled = false;
  var built = false;

  // ---------------------------------------------------------------------------
  // 키 합성 (코드별 참조 카운트)
  // ---------------------------------------------------------------------------
  var KEY_NAMES = {
    KeyA: 'a', KeyD: 'd', KeyW: 'w', KeyS: 's', Space: ' ',
    ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    KeyJ: 'j', KeyK: 'k', KeyL: 'l', KeyI: 'i'
  };
  var held = {};      // code → 누르고 있는 포인터 수

  function fireKey(type, code) {
    var ev;
    try {
      ev = new KeyboardEvent(type, { code: code, key: KEY_NAMES[code] || code, bubbles: true, cancelable: true });
    } catch (e) {
      ev = document.createEvent('Event');
      ev.initEvent(type, true, true);
      ev.code = code; ev.key = KEY_NAMES[code] || code;
    }
    window.dispatchEvent(ev);
  }
  function keyDown(code) {
    held[code] = (held[code] || 0) + 1;
    if (held[code] === 1) fireKey('keydown', code);
  }
  function keyUp(code) {
    if (!held[code]) return;
    held[code]--;
    if (held[code] === 0) { delete held[code]; fireKey('keyup', code); }
  }
  // 포인터별로 지금 누르고 있는 키 목록을 원하는 목록으로 맞춘다
  var ptrKeys = {};   // pointerId → [code...]
  function setPointerKeys(pid, codes) {
    var cur = ptrKeys[pid] || [];
    var i;
    for (i = 0; i < cur.length; i++) if (codes.indexOf(cur[i]) < 0) keyUp(cur[i]);
    for (i = 0; i < codes.length; i++) if (cur.indexOf(codes[i]) < 0) keyDown(codes[i]);
    if (codes.length) ptrKeys[pid] = codes.slice(); else delete ptrKeys[pid];
  }
  function releaseAll() {
    for (var pid in ptrKeys) if (ptrKeys.hasOwnProperty(pid)) setPointerKeys(pid, []);
    for (var c in held) if (held.hasOwnProperty(c)) { delete held[c]; fireKey('keyup', c); }
    held = {};
    ptrKeys = {};
    stick.pid = null;
    resetStick();
    var pressed = root ? root.querySelectorAll('.tc-pressed') : [];
    for (var j = 0; j < pressed.length; j++) pressed[j].classList.remove('tc-pressed');
  }

  // ---------------------------------------------------------------------------
  // CSS
  // ---------------------------------------------------------------------------
  var CSS = [
    'body.tc-on #power-list { display: none !important; }',
    'body.tc-on { -webkit-tap-highlight-color: transparent; }',
    'body.tc-on button, body.tc-on .btn { touch-action: manipulation; }',
    'body.tc-on #game, body.tc-on #game3d { touch-action: none; }',
    'body.tc-play, body.tc-play * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }',
    'body.tc-play { touch-action: none; overscroll-behavior: none; }',
    'html.tc-html { overscroll-behavior: none; }',

    '#tc-root { position: fixed; inset: 0; z-index: 15; pointer-events: none; touch-action: none;',
    '  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }',
    '#tc-root[hidden] { display: none !important; }',
    '#tc-root * { box-sizing: border-box; }',

    /* 조이스틱 터치 영역(투명) */
    '#tc-stick-zone { position: absolute; left: 0; bottom: 0; width: min(46vw, 340px); height: min(62vh, 360px);',
    '  pointer-events: auto; touch-action: none; }',
    '#tc-stick-base { position: absolute; width: 128px; height: 128px; margin: -64px 0 0 -64px; border-radius: 50%;',
    '  background: radial-gradient(circle, rgba(26,31,30,0.25) 0%, rgba(26,31,30,0.5) 70%);',
    '  border: 3px solid rgba(181,84,28,0.65); box-shadow: inset 0 0 14px rgba(79,174,140,0.25), 0 0 10px rgba(0,0,0,0.4);',
    '  opacity: 0.55; transition: opacity 0.12s; }',
    '#tc-stick-base.on { opacity: 0.95; transition: none; }',
    '#tc-stick-base::before, #tc-stick-base::after { content: ""; position: absolute; left: 50%; top: 50%;',
    '  width: 0; height: 0; border: 7px solid transparent; }',
    '#tc-stick-base::before { margin: -7px 0 0 -58px; border-right-color: rgba(239,230,216,0.55); }',
    '#tc-stick-base::after { margin: -7px 0 0 44px; border-left-color: rgba(239,230,216,0.55); }',
    '#tc-stick-knob { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px;',
    '  border-radius: 50%; background: radial-gradient(circle at 38% 34%, #e07a35, #b5541c 60%, #5a2a10);',
    '  border: 2px solid rgba(127,224,184,0.75); box-shadow: 0 0 10px rgba(127,224,184,0.35), 0 3px 6px rgba(0,0,0,0.5); }',

    /* 오른쪽 버튼 묶음 */
    '#tc-right { position: absolute; right: 0; bottom: 0; width: 0; height: 0; }',
    '.tc-btn { position: absolute; border-radius: 50%; pointer-events: auto; touch-action: none;',
    '  display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden;',
    '  color: #efe6d8; font-family: var(--font-body, sans-serif); font-weight: 700; line-height: 1;',
    '  background: radial-gradient(circle at 40% 32%, rgba(79,174,140,0.55), rgba(31,85,70,0.6) 62%, rgba(26,31,30,0.7));',
    '  border: 3px solid rgba(127,224,184,0.7); box-shadow: 0 0 10px rgba(0,0,0,0.45), inset 0 0 10px rgba(127,224,184,0.2);',
    '  opacity: 0.88; transform: scale(1); transition: transform 0.06s, opacity 0.12s, filter 0.12s; }',
    '.tc-btn.tc-pressed { transform: scale(0.9); opacity: 1; box-shadow: 0 0 16px rgba(127,224,184,0.7), inset 0 0 14px rgba(127,224,184,0.45); }',
    '#tc-jump { background: radial-gradient(circle at 40% 32%, rgba(224,122,53,0.7), rgba(181,84,28,0.7) 60%, rgba(90,42,16,0.8));',
    '  border-color: rgba(255,170,90,0.8); font-size: 30px; }',
    '#tc-jump.tc-pressed { box-shadow: 0 0 16px rgba(255,138,42,0.75), inset 0 0 14px rgba(255,200,140,0.4); }',
    '.tc-skill .tc-ico { font-size: 26px; line-height: 1; position: relative; z-index: 2; }',
    '.tc-skill .tc-key { position: absolute; z-index: 3; left: 0; right: 0; bottom: 5px; text-align: center;',
    '  font-size: 10px; letter-spacing: 0.5px; color: rgba(239,230,216,0.8); text-shadow: 0 1px 2px #000; }',
    '.tc-skill .tc-cd { position: absolute; z-index: 1; left: 0; right: 0; bottom: 0; height: 0;',
    '  background: rgba(10,14,13,0.72); }',
    '.tc-skill .tc-cdt { position: absolute; z-index: 4; left: 0; right: 0; top: 50%; margin-top: -9px; text-align: center;',
    '  font-size: 17px; color: #fff; text-shadow: 0 0 3px #000, 0 1px 2px #000; }',
    '.tc-skill.tc-low { filter: grayscale(0.85) brightness(0.7); opacity: 0.6; }',
    '.tc-skill.tc-empty { opacity: 0.25; }',
    '.tc-skill.tc-deny { animation: tc-shake 0.22s; }',
    '@keyframes tc-shake { 0%,100% { margin-left: 0; } 25% { margin-left: -4px; } 75% { margin-left: 4px; } }',

    /* 전체화면 버튼 */
    '#tc-fs { position: absolute; top: calc(12px + env(safe-area-inset-top, 0px)); right: calc(60px + env(safe-area-inset-right, 0px));',
    '  width: 40px; height: 40px; pointer-events: auto; border-radius: 6px; font-size: 18px; line-height: 1;',
    '  color: #efe6d8; background: rgba(26,31,30,0.8); border: 2px solid rgba(181,84,28,0.75); padding: 0; }',
    '@media (max-width: 700px), (max-height: 500px) { #tc-fs { top: calc(8px + env(safe-area-inset-top, 0px));',
    '  right: calc(52px + env(safe-area-inset-right, 0px)); width: 36px; height: 36px; font-size: 16px; } }',

    /* 가로(낮은 화면)에서는 오른쪽 가운데의 미션 추적기가 기술 버튼과 겹치므로 위쪽 가운데로,
       점수판은 기술 버튼 위에서 잘리게 */
    '@media (max-height: 500px) {',
    '  body.tc-play #mission-tracker { top: calc(6px + env(safe-area-inset-top, 0px)); right: auto; left: 50%;',
    '    transform: translateX(-50%); flex-direction: row; align-items: flex-start; }',
    '  body.tc-play #mission-tracker .mt-row { min-width: 112px; max-width: 160px; padding: 3px 7px 4px; font-size: 10px; }',
    '  body.tc-play #mission-tracker .mt-label { display: none; }',
    '  body.tc-play #scoreboard { max-height: calc(100vh - 240px); overflow: hidden; }',
    '}',

    /* 타이틀: 터치 기기에선 키보드 표 대신 터치 안내, 낮은 가로 화면에선 시작 버튼을 위로 */
    'body.tc-on .start-panel .controls table { display: none; }',
    '.tc-howto { margin: 4px 0 10px; padding: 0; list-style: none; font-size: 0.86rem; line-height: 1.5; color: #efe6d8; }',
    '.tc-howto li { padding: 3px 0; border-bottom: 1px solid rgba(239,230,216,0.08); }',
    '.tc-howto b { color: #e07a35; }',
    '@media (max-height: 500px) {',
    '  body.tc-on .start-panel { display: flex; flex-direction: column; }',
    '  body.tc-on .start-panel .controls { order: 10; }',
    '  body.tc-on .start-panel .tagline { margin-top: 2px; margin-bottom: 8px; }',
    '}',

    /* 세로 화면 안내 */
    '#tc-hint { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(250px + env(safe-area-inset-bottom, 0px));',
    '  max-width: calc(100vw - 32px); pointer-events: auto; display: flex; align-items: center; gap: 8px;',
    '  padding: 7px 8px 7px 12px; border-radius: 6px; font-size: 13px; white-space: nowrap;',
    '  color: #efe6d8; background: rgba(26,31,30,0.88); border: 1px solid rgba(127,224,184,0.6); }',
    '#tc-hint button { pointer-events: auto; border: 0; background: rgba(181,84,28,0.85); color: #fff;',
    '  width: 26px; height: 26px; border-radius: 4px; font-size: 14px; padding: 0; line-height: 1; }'
  ].join('\n');

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  var root, zone, base, knob, jumpBtn, fsBtn, hintEl;
  var skillBtns = [];       // { el, ico, key, cd, cdt, id }
  var SKILL_CODES = ['KeyJ', 'KeyK', 'KeyL', 'KeyI'];
  var SKILL_KEYS = ['J', 'K', 'L', 'I'];

  // 레이아웃 (화면 크기에 따라 계산; 단위 CSS px, 오른쪽/아래 기준)
  var L = { jump: 84, skill: 62, radius: 110, margin: 18, stickR: 64 };

  function el(tag, id, cls, parent) {
    var e = document.createElement(tag);
    if (id) e.id = id;
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function safeInset(side) {
    // env() 값을 JS 에서 읽기 위한 측정용 요소
    if (!safeInset.probe) {
      var p = document.createElement('div');
      p.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
        'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);';
      document.body.appendChild(p);
      safeInset.probe = p;
    }
    var cs = getComputedStyle(safeInset.probe);
    return parseFloat(cs['padding' + side]) || 0;
  }

  function layout() {
    if (!built) return;
    var w = window.innerWidth, h = window.innerHeight;
    var small = Math.min(w, h);
    var landscapeShort = h < 500;
    if (landscapeShort) { L.jump = 76; L.skill = 56; L.radius = 94; L.margin = 14; }
    else if (small < 500) { L.jump = 84; L.skill = 62; L.radius = 108; L.margin = 18; }
    else { L.jump = 92; L.skill = 68; L.radius = 122; L.margin = 26; }

    var sr = safeInset('Right'), sb = safeInset('Bottom');
    var cx = -(L.margin + sr + L.jump / 2);          // 점프 버튼 중심 (오른쪽 아래 모서리 기준)
    var cy = -(L.margin + sb + L.jump / 2);
    if (!landscapeShort) cy -= 10;
    place(jumpBtn, cx, cy, L.jump);
    // 기술: 왼쪽(180°) → 위(90°) 부채꼴. J 가 엄지에 가장 가까운 왼쪽.
    var angs = landscapeShort ? [180, 147, 114, 81] : [180, 150, 120, 90];
    for (var i = 0; i < 4; i++) {
      var a = angs[i] * Math.PI / 180;
      place(skillBtns[i].el, cx + Math.cos(a) * L.radius, cy - Math.sin(a) * L.radius, L.skill);
    }
    resetStick();
  }
  function place(e, cx, cy, size) {
    e.style.width = size + 'px';
    e.style.height = size + 'px';
    e.style.left = (cx - size / 2) + 'px';
    e.style.top = (cy - size / 2) + 'px';
  }

  function build() {
    if (built) return;
    built = true;
    var st = document.createElement('style');
    st.id = 'tc-style';
    st.textContent = CSS;
    document.head.appendChild(st);

    root = el('div', 'tc-root', '', document.body);
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');

    zone = el('div', 'tc-stick-zone', '', root);
    base = el('div', 'tc-stick-base', '', zone);
    knob = el('div', 'tc-stick-knob', '', base);

    var right = el('div', 'tc-right', '', root);
    jumpBtn = el('div', 'tc-jump', 'tc-btn', right);
    jumpBtn.textContent = '▲';
    for (var i = 0; i < 4; i++) {
      var b = el('div', 'tc-skill-' + i, 'tc-btn tc-skill', right);
      var cd = el('div', '', 'tc-cd', b);
      var ico = el('span', '', 'tc-ico', b);
      var key = el('span', '', 'tc-key', b);
      var cdt = el('span', '', 'tc-cdt', b);
      key.textContent = SKILL_KEYS[i];
      skillBtns.push({ el: b, ico: ico, key: key, cd: cd, cdt: cdt, id: null, code: SKILL_CODES[i] });
    }

    var fsOk = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    if (fsOk) {
      fsBtn = el('button', 'tc-fs', '', root);
      fsBtn.type = 'button';
      fsBtn.textContent = '⛶';
      fsBtn.setAttribute('aria-label', '전체화면');
      fsBtn.title = '전체화면';
      fsBtn.addEventListener('click', toggleFullscreen);
    }

    bindButton(jumpBtn, 'Space', false);
    for (i = 0; i < 4; i++) bindButton(skillBtns[i].el, SKILL_CODES[i], true, i);
    bindStick();

    layout();
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });
  }

  function toggleFullscreen() {
    var d = document, de = d.documentElement;
    var cur = d.fullscreenElement || d.webkitFullscreenElement;
    try {
      if (cur) {
        (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      } else {
        var r = (de.requestFullscreen || de.webkitRequestFullscreen).call(de, { navigationUI: 'hide' });
        if (r && r.catch) r.catch(function () {});
      }
    } catch (e) { /* 지원 안 함 */ }
    setTimeout(layout, 300);
  }

  // ---------------------------------------------------------------------------
  // 버튼
  // ---------------------------------------------------------------------------
  function blurInputs() {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae.blur) ae.blur();
  }

  function bindButton(b, code, isSkill, idx) {
    var mine = {};   // pointerId → true
    function down(e) {
      if (e.button != null && e.button > 0) return;
      e.preventDefault();
      blurInputs();
      try { b.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
      mine[e.pointerId] = true;
      b.classList.add('tc-pressed');
      if (isSkill) {
        var s = skillBtns[idx];
        var ready = skillReady(s.id);
        setPointerKeys(e.pointerId, [code]);
        if (ready) buzz(10);
        else { s.el.classList.remove('tc-deny'); void s.el.offsetWidth; s.el.classList.add('tc-deny'); }
      } else {
        setPointerKeys(e.pointerId, [code]);
      }
    }
    function up(e) {
      if (!mine[e.pointerId]) return;
      delete mine[e.pointerId];
      setPointerKeys(e.pointerId, []);
      var any = false;
      for (var k in mine) if (mine.hasOwnProperty(k)) any = true;
      if (!any) b.classList.remove('tc-pressed');
    }
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 무시 */ }
  }

  // ---------------------------------------------------------------------------
  // 조이스틱 (터치한 위치에 나타나는 플로팅 방식)
  // ---------------------------------------------------------------------------
  var stick = { pid: null, ox: 0, oy: 0, dx: 0, dy: 0 };
  var JOY_UP_JUMP = true;

  function homeStick() {
    var sl = safeInset('Left'), sb = safeInset('Bottom');
    var zr = zone.getBoundingClientRect();
    var r = L.stickR;
    var m = window.innerHeight < 500 ? 18 : 28;
    return { x: sl + m + r + 6, y: zr.height - (sb + m + r) };
  }
  function resetStick() {
    if (!base) return;
    var h = homeStick();
    base.style.left = h.x + 'px';
    base.style.top = h.y + 'px';
    knob.style.transform = 'translate(0px, 0px)';
    base.classList.remove('on');
  }

  function stickCodes(dx, dy) {
    var R = L.stickR;
    var codes = [];
    if (dx < -R * 0.28) codes.push('KeyA');
    else if (dx > R * 0.28) codes.push('KeyD');
    if (dy > R * 0.55 && dy > Math.abs(dx) * 0.7) codes.push('KeyS');
    else if (JOY_UP_JUMP && dy < -R * 0.6 && -dy > Math.abs(dx) * 0.55) codes.push('ArrowUp');
    return codes;
  }

  function bindStick() {
    zone.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button > 0) return;
      e.preventDefault();
      if (stick.pid != null) return;      // 이미 다른 손가락이 조이스틱 사용 중
      blurInputs();
      try { zone.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
      var zr = zone.getBoundingClientRect();
      var r = L.stickR;
      // 화면 밖으로 나가지 않게 중심을 살짝 안쪽으로
      var x = Math.max(r + 4, Math.min(zr.width - r - 4, e.clientX - zr.left));
      var y = Math.max(r + 4, Math.min(zr.height - r - 4, e.clientY - zr.top));
      stick.pid = e.pointerId;
      stick.ox = x + zr.left; stick.oy = y + zr.top;
      base.style.left = x + 'px';
      base.style.top = y + 'px';
      base.classList.add('on');
      moveStick(e);
    });
    zone.addEventListener('pointermove', function (e) {
      if (e.pointerId !== stick.pid) return;
      e.preventDefault();
      moveStick(e);
    });
    function end(e) {
      if (e.pointerId !== stick.pid) return;
      setPointerKeys(e.pointerId, []);
      stick.pid = null;
      resetStick();
    }
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
    zone.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  function moveStick(e) {
    var R = L.stickR;
    var dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    var d = Math.sqrt(dx * dx + dy * dy);
    var kx = dx, ky = dy;
    if (d > R) { kx = dx / d * R; ky = dy / d * R; }
    stick.dx = dx; stick.dy = dy;
    knob.style.transform = 'translate(' + kx.toFixed(1) + 'px, ' + ky.toFixed(1) + 'px)';
    setPointerKeys(stick.pid, stickCodes(dx, dy));
  }

  // ---------------------------------------------------------------------------
  // 기술 버튼 상태 (10 Hz)
  // ---------------------------------------------------------------------------
  function getDef(id) {
    var S = G.Skills;
    return (id && S && S.defs && S.defs[id]) || null;
  }
  function skillReady(id) {
    var def = getDef(id), p = G.players && G.players.local;
    if (!def || !p) return false;
    var cd = G.Powers && G.Powers.cdLeft ? (G.Powers.cdLeft(id) || 0) : 0;
    return cd <= 0 && (p.energy || 0) >= (def.cost || 0);
  }
  function refreshLabels() {
    if (!built) return;
    var slots = (G.Powers && G.Powers.slots) || [];
    for (var i = 0; i < 4; i++) {
      var s = skillBtns[i], id = slots[i] || null;
      var def = getDef(id);
      s.id = id;
      s.ico.textContent = def ? (def.icon || '✦') : '';
      s.el.title = def ? (def.name + ' (' + SKILL_KEYS[i] + ')') : '';
      s.el.setAttribute('data-skill', id || '');
      s.el.classList.toggle('tc-empty', !def);
    }
  }
  var lastSlotSig = '';
  function refreshSkills() {
    var slots = (G.Powers && G.Powers.slots) || [];
    var sig = slots.join(',');
    if (sig !== lastSlotSig) { lastSlotSig = sig; refreshLabels(); }
    var p = G.players && G.players.local;
    var energy = p ? (p.energy || 0) : 0;
    for (var i = 0; i < 4; i++) {
      var s = skillBtns[i], def = getDef(s.id);
      if (!def) { s.cd.style.height = '0'; s.cdt.textContent = ''; continue; }
      var left = G.Powers && G.Powers.cdLeft ? (G.Powers.cdLeft(s.id) || 0) : 0;
      var total = def.cooldown || 1;
      var frac = left > 0 ? Math.min(1, left / total) : 0;
      s.cd.style.height = (frac * 100).toFixed(1) + '%';
      s.cdt.textContent = left >= 0.6 ? String(Math.ceil(left)) : '';
      s.el.classList.toggle('tc-low', energy < (def.cost || 0));
    }
  }

  // ---------------------------------------------------------------------------
  // 표시 여부 (매치 중 + 모달/패널 없음)
  // ---------------------------------------------------------------------------
  // position:fixed 요소는 offsetParent 가 항상 null 이라 computed style 로 판단
  function shownEl(e) {
    if (!e || e.hidden) return false;
    var cs = getComputedStyle(e);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }
  function anyModalOpen() {
    if (shownEl(document.getElementById('exit-modal')) || shownEl(document.getElementById('result'))) return true;
    var ms = document.querySelectorAll('.modal');
    for (var i = 0; i < ms.length; i++) if (shownEl(ms[i])) return true;
    var M = G.Missions;
    try { if (M && typeof M.isPanelOpen === 'function' && M.isPanelOpen()) return true; } catch (e) { /* 무시 */ }
    return false;
  }
  function inMatch() {
    var hud = document.getElementById('hud');
    return !!G.running && !!(hud && !hud.hidden);
  }

  var visible = false;
  function updateVisibility() {
    var playing = inMatch();
    var want = playing && !anyModalOpen();
    document.body.classList.toggle('tc-play', playing);
    if (want !== visible) {
      visible = want;
      root.hidden = !want;
      if (!want) releaseAll();
      else { layout(); refreshLabels(); }
    }
    updateHint(want);
  }

  // ---------------------------------------------------------------------------
  // 세로 화면 안내
  // ---------------------------------------------------------------------------
  var hintDismissed = false, hintShownAt = 0;
  try { hintDismissed = sessionStorage.getItem('tc-hint-off') === '1'; } catch (e) { /* 무시 */ }
  function updateHint(show) {
    var portrait = window.innerHeight > window.innerWidth;
    var want = show && portrait && !hintDismissed;
    if (want && !hintEl) {
      hintEl = el('div', 'tc-hint', '', root);
      var t = el('span', '', '', hintEl);
      t.textContent = '📱 가로로 돌리면 더 넓게 볼 수 있어요';
      var x = el('button', '', '', hintEl);
      x.type = 'button';
      x.textContent = '✕';
      x.setAttribute('aria-label', '안내 닫기');
      x.addEventListener('click', dismissHint);
      hintShownAt = Date.now();
    }
    if (hintEl) {
      hintEl.hidden = !want;
      if (want && hintShownAt && Date.now() - hintShownAt > 8000) dismissHint();
    }
  }
  function dismissHint() {
    hintDismissed = true;
    try { sessionStorage.setItem('tc-hint-off', '1'); } catch (e) { /* 무시 */ }
    if (hintEl) hintEl.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // 페이지 스크롤/확대/길게 누르기 방지
  // ---------------------------------------------------------------------------
  function fixViewport() {
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
    var c = m.getAttribute('content') || '';
    if (!/user-scalable\s*=\s*no/.test(c) || !/maximum-scale/.test(c) || !/viewport-fit/.test(c)) {
      m.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    }
  }
  function playingNoPanel() { return document.body.classList.contains('tc-play') && !anyModalOpen(); }
  function bindGuards() {
    var opt = { passive: false };
    document.addEventListener('touchmove', function (e) {
      if (playingNoPanel()) e.preventDefault();
    }, opt);
    document.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length > 1 && playingNoPanel()) e.preventDefault();   // 핀치 확대 방지
    }, opt);
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, opt);   // iOS 핀치
    document.addEventListener('dblclick', function (e) { if (playingNoPanel()) e.preventDefault(); }, opt);
    document.addEventListener('contextmenu', function (e) {
      if (document.body.classList.contains('tc-play')) e.preventDefault();
    });
    document.addEventListener('selectstart', function (e) {
      if (playingNoPanel()) e.preventDefault();
    });
  }

  // ---------------------------------------------------------------------------
  // 켜기
  // ---------------------------------------------------------------------------
  // 타이틀 '조작법' 칸에 터치 조작 안내 (키보드 표는 CSS 로 숨김)
  function addHowTo() {
    var box = document.querySelector('.start-panel .controls');
    if (!box || document.getElementById('tc-howto')) return;
    var ul = document.createElement('ul');
    ul.id = 'tc-howto';
    ul.className = 'tc-howto';
    ul.innerHTML =
      '<li><b>왼쪽</b> 화면 아무 곳이나 눌러 조이스틱 — 좌우 이동 · 위로 밀면 점프 · 아래로 당기면 발판 아래로</li>' +
      '<li><b>오른쪽</b> ▲ 점프 · 둘레의 기술 버튼 4개 (불꽃 4종부터, 미션으로 새 능력 획득)</li>';
    var table = box.querySelector('table');
    if (table && table.nextSibling) box.insertBefore(ul, table.nextSibling);
    else box.appendChild(ul);
  }

  var timer = null;
  function enable() {
    if (enabled) return;
    enabled = true;
    fixViewport();
    document.documentElement.classList.add('tc-html');
    document.body.classList.add('tc-on');
    build();
    addHowTo();
    bindGuards();
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', function () { if (document.hidden) releaseAll(); });
    if (G.events && typeof G.events.on === 'function') {
      G.events.on('elementChanged', function () { lastSlotSig = ''; refreshSkills(); });
      G.events.on('matchStart', function () { lastSlotSig = ''; refreshSkills(); });
    }
    timer = setInterval(tick, 100);
    tick();
  }
  function tick() {
    try {
      updateVisibility();
      if (visible) refreshSkills();
    } catch (e) {
      if (window.console && console.error) console.error('[touch]', e);
    }
  }

  function init() {
    if (detectTouch()) { enable(); return; }
    if (forceOff) return;
    // 감지가 빗나간 기기: 첫 터치가 들어오면 켠다
    window.addEventListener('touchstart', function once() {
      window.removeEventListener('touchstart', once, true);
      enable();
    }, true);
  }

  G.Touch = {
    get enabled() { return enabled; },
    enable: enable,
    releaseAll: function () { releaseAll(); },
    held: function () { var o = {}; for (var k in held) if (held.hasOwnProperty(k)) o[k] = held[k]; return o; },
    layout: layout,
    _tick: function () { tick(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
