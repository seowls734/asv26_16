/* 초능력자: 각성 — 아이템 드롭 (Game.Items)
 * 맵 곳곳(땅 + 발판 위)에 보급 아이템이 주기적으로 떨어진다. 먼저 닿는 사람이 효과를 받는다.
 * 호스트(및 연습 모드)가 스폰/소유권을 판정하고, 게스트는 줍기 요청을 보낸 뒤 호스트 확인을 받아 효과를 적용한다.
 * 위치는 dy(땅 위 높이)로 저장해서 화면 크기가 바뀌어도 어긋나지 않는다.
 */
(function () {
  'use strict';

  var Game = window.Game = window.Game || {};

  // ---------------------------------------------------------------- 아이템 종류
  var TYPES = {
    heal:   { name: '회복 키트',   color: '#ff5a4a', glow: '#ff9a8a', weight: 4 },
    energy: { name: '에너지 전지', color: '#ffc83a', glow: '#fff0a0', weight: 3 },
    boost:  { name: '강화 혈청',   color: '#e07a35', glow: '#ffb04a', weight: 2 },
    shield: { name: '이끼 보호막', color: '#4fae8c', glow: '#7fe0b8', weight: 2 }
  };
  var TYPE_KEYS = Object.keys(TYPES);

  var HEAL_AMOUNT = 35;
  var BOOST_TIME = 6;
  var SHIELD_TIME = 3;

  var SIZE = 30;
  var MAX_ITEMS = 3;
  var FIRST_SPAWN = 6;
  var SPAWN_MIN = 10, SPAWN_MAX = 15;
  var LIFETIME = 25;            // 이 시간 동안 아무도 안 주우면 사라짐
  var FALL_SPEED = 520;         // 하늘에서 떨어지는 속도
  var SNAP_INTERVAL = 2;        // 주기적 전체 동기화 (보정용)

  // ---------------------------------------------------------------- 내부 상태
  var nextId = 1;
  var spawnTimer = FIRST_SPAWN;
  var snapTimer = 0;
  var clock = 0;
  var pending = {};             // 게스트: 줍기 요청 보낸 아이템 id
  var handlersRegistered = false;

  function net() { return Game.Net || null; }
  function isOnline() { return Game.mode === 'host' || Game.mode === 'guest'; }
  function isAuthority() { return Game.mode !== 'guest'; }

  function send(msg, toId) {
    var n = net();
    if (!isOnline() || !n || typeof n.send !== 'function') return;
    try { if (toId != null) n.send(msg, toId); else n.send(msg); } catch (e) { /* 무시 */ }
  }

  function fromHost(m) { return !m || m.from == null || m.from === 'h'; }
  function myNetId() {
    var n = net(), lp = Game.players && Game.players.local;
    if (n && n.myId != null) return n.myId;
    return (lp && lp.id != null) ? lp.id : 'h';
  }

  function world() { return Game.world || { width: 4200, groundY: 600, platforms: [] }; }
  function particles(x, y, n, color, speed) {
    if (typeof Game.spawnParticles === 'function') Game.spawnParticles(x, y, n, color, speed);
  }
  function toast(t) { if (typeof Game.toast === 'function') Game.toast(t); }
  function emit(name, data) { if (Game.events && Game.events.emit) Game.events.emit(name, data); }

  function itemRect(it) {
    var gy = world().groundY;
    return { x: it.x - SIZE / 2, y: gy - it.dy - SIZE, w: SIZE, h: SIZE };
  }

  // ---------------------------------------------------------------- 스폰 (권한자만)
  function pickType() {
    var total = 0, i;
    for (i = 0; i < TYPE_KEYS.length; i++) total += TYPES[TYPE_KEYS[i]].weight;
    var r = Math.random() * total;
    for (i = 0; i < TYPE_KEYS.length; i++) {
      r -= TYPES[TYPE_KEYS[i]].weight;
      if (r <= 0) return TYPE_KEYS[i];
    }
    return TYPE_KEYS[0];
  }

  function pickSpot() {
    var w = world();
    var plats = w.platforms || [];
    for (var tries = 0; tries < 12; tries++) {
      var x, dy;
      if (plats.length && Math.random() < 0.55) {
        var pl = plats[Math.floor(Math.random() * plats.length)];
        x = pl.x + 30 + Math.random() * Math.max(0, pl.w - 60);
        dy = typeof pl.dy === 'number' ? pl.dy : (w.groundY - pl.y);
      } else {
        x = 300 + Math.random() * ((w.width || 4200) - 600);
        dy = 0;
      }
      var ok = true;
      for (var i = 0; i < Items.list.length; i++) {
        if (Math.abs(Items.list[i].x - x) < 260) { ok = false; break; }
      }
      if (ok) return { x: Math.round(x), dy: dy };
    }
    return null;
  }

  function spawnOne(type) {
    var spot = pickSpot();
    if (!spot) return null;
    var it = {
      id: nextId++, type: type || pickType(),
      x: spot.x, dy: spot.dy,
      fall: 700,                // 목표 위치 위쪽에서 떨어지기 시작 (연출용, 남은 낙하 거리)
      age: 0
    };
    Items.list.push(it);
    sendSnapshot();
    return it;
  }

  function removeItem(id) {
    for (var i = 0; i < Items.list.length; i++) {
      if (Items.list[i].id === id) return Items.list.splice(i, 1)[0];
    }
    return null;
  }
  function findItem(id) {
    for (var i = 0; i < Items.list.length; i++) if (Items.list[i].id === id) return Items.list[i];
    return null;
  }

  // ---------------------------------------------------------------- 효과
  function applyEffect(p, type) {
    if (!p || !p.alive) return;
    var T = TYPES[type];
    if (!T) return;
    if (type === 'heal') p.hp = Math.min(p.maxHp, p.hp + HEAL_AMOUNT);
    else if (type === 'energy') p.energy = p.maxEnergy;
    else if (type === 'boost') p.boostTimer = Math.max(p.boostTimer || 0, BOOST_TIME);
    else if (type === 'shield') p.invulnTimer = Math.max(p.invulnTimer || 0, SHIELD_TIME);
    toast(T.name + '!');
    emit('itemPickup', { type: type, local: true });
  }

  function pickupFx(it) {
    var r = itemRect(it);
    var T = TYPES[it.type] || TYPES.heal;
    particles(r.x + SIZE / 2, r.y + SIZE / 2, 18, T.glow, 240);
    particles(r.x + SIZE / 2, r.y + SIZE / 2, 8, T.color, 140);
  }

  // ---------------------------------------------------------------- 네트워크
  function sendSnapshot() {
    if (!isOnline() || !isAuthority()) return;
    var out = [];
    for (var i = 0; i < Items.list.length; i++) {
      var it = Items.list[i];
      out.push({ id: it.id, type: it.type, x: it.x, dy: it.dy, fall: Math.round(it.fall), age: Math.round(it.age * 10) / 10 });
    }
    send({ t: 'items', list: out });
  }

  // 게스트: 호스트의 목록으로 교체
  function onSnapshot(m) {
    if (Game.mode !== 'guest' || !m || !m.list || !fromHost(m)) return;
    var seen = {};
    var next = [];
    for (var i = 0; i < m.list.length; i++) {
      var s = m.list[i];
      if (!TYPES[s.type]) continue;
      seen[s.id] = true;
      var cur = findItem(s.id);
      if (cur) { cur.x = s.x; cur.dy = s.dy; next.push(cur); }
      else next.push({ id: s.id, type: s.type, x: +s.x || 0, dy: +s.dy || 0, fall: +s.fall || 0, age: +s.age || 0 });
    }
    // 사라진 아이템 = 누군가 주웠거나 만료됨
    Items.list = next;
    for (var k in pending) if (!seen[k]) delete pending[k];
  }

  // 호스트: 게스트의 줍기 요청 처리
  function onTakeRequest(m) {
    if (Game.mode !== 'host' || !m) return;
    var it = removeItem(m.id);
    if (!it) return;            // 이미 호스트가 먼저 주웠음
    pickupFx(it);
    // 요청한 게스트에게만 승인, 나머지에게는 "누가 주웠다" 연출
    send({ t: 'itemGot', id: it.id, type: it.type }, m.from);
    send({ t: 'itemTook', id: it.id, by: m.from != null ? m.from : null });
    sendSnapshot();
  }

  // 게스트: 호스트가 줍기를 승인
  function onGot(m) {
    if (Game.mode !== 'guest' || !m || !fromHost(m)) return;
    delete pending[m.id];
    var it = removeItem(m.id);
    if (it) pickupFx(it);
    var P = Game.players || {};
    applyEffect(P.local, m.type);
  }

  // 모두: 다른 플레이어가 주운 아이템 연출
  function onOppTook(m) {
    if (!m) return;
    var it = removeItem(m.id);
    if (it) pickupFx(it);
  }

  function registerHandlers() {
    if (handlersRegistered) return;
    var n = net();
    if (!n || typeof n.on !== 'function') return;
    handlersRegistered = true;
    n.on('items', onSnapshot);
    n.on('itemTake', onTakeRequest);
    n.on('itemGot', onGot);
    n.on('itemTook', onOppTook);
  }

  // ---------------------------------------------------------------- 줍기 판정 (로컬 플레이어)
  function checkPickup() {
    var P = Game.players || {};
    var me = P.local;
    if (!me || !me.alive || Game.matchOver) return;
    for (var i = Items.list.length - 1; i >= 0; i--) {
      var it = Items.list[i];
      if (it.fall > 0 || pending[it.id]) continue;
      if (!Game.rectHit(me, itemRect(it))) continue;
      if (isAuthority()) {
        Items.list.splice(i, 1);
        pickupFx(it);
        applyEffect(me, it.type);
        send({ t: 'itemTook', id: it.id, by: myNetId() });
        sendSnapshot();
      } else {
        pending[it.id] = true;
        send({ t: 'itemTake', id: it.id }, 'h');   // 호스트에게만 요청
      }
    }
  }

  // ---------------------------------------------------------------- 공개 API
  var Items = {
    list: [],
    types: TYPES,

    init: function () {
      registerHandlers();
      Items.list = [];
      pending = {};
      nextId = 1;
      spawnTimer = FIRST_SPAWN;
      snapTimer = 0;
      clock = 0;
    },

    update: function (dt) {
      if (!Game.running) return;
      clock += dt;
      var i, it;
      for (i = 0; i < Items.list.length; i++) {
        it = Items.list[i];
        it.age += dt;
        if (it.fall > 0) {
          it.fall = Math.max(0, it.fall - FALL_SPEED * dt);
          if (it.fall === 0) {
            var r = itemRect(it);
            particles(r.x + SIZE / 2, r.y + SIZE, 8, '#c9b48a', 120);
          }
        }
      }

      if (isAuthority() && !Game.matchOver) {
        // 만료
        for (i = Items.list.length - 1; i >= 0; i--) {
          if (Items.list[i].age > LIFETIME) { Items.list.splice(i, 1); sendSnapshot(); }
        }
        // 스폰
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawnTimer = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
          if (Items.list.length < MAX_ITEMS) spawnOne();
        }
        snapTimer += dt;
        if (snapTimer >= SNAP_INTERVAL) { snapTimer = 0; sendSnapshot(); }
      }

      checkPickup();
    },

    render: function (ctx) {
      for (var i = 0; i < Items.list.length; i++) {
        ctx.save();
        try { drawItem(ctx, Items.list[i]); } catch (e) { /* 렌더 오류가 루프를 멈추지 않게 */ }
        ctx.restore();
      }
    },

    // 지정 위치에 아이템 생성 (권한측 전용; 보스 보상 등). dy = 땅 위 높이, type 생략 시 무작위.
    // 최대 개수 제한(MAX_ITEMS)과 무관. 스냅샷으로 게스트에게 전파.
    spawnAt: function (x, dy, type) {
      if (!isAuthority()) return null;
      var w = world();
      var it = {
        id: nextId++,
        type: (type && TYPES[type]) ? type : pickType(),
        x: Math.round(Math.max(SIZE, Math.min((w.width || 4200) - SIZE, +x || 0))),
        dy: Math.max(0, +dy || 0),
        fall: 240,              // 보스 몸에서 툭 떨어지는 연출
        age: 0
      };
      Items.list.push(it);
      particles(it.x, w.groundY - it.dy - 240, 10, (TYPES[it.type] || TYPES.heal).glow, 200);
      sendSnapshot();
      return it;
    },

    _debug: { spawnOne: spawnOne, applyEffect: applyEffect }
  };

  Game.Items = Items;
  registerHandlers();

  // ================================================================ 그래픽
  function drawItem(c, it) {
    var T = TYPES[it.type] || TYPES.heal;
    var r = itemRect(it);
    var landed = it.fall <= 0;
    var bob = landed ? Math.sin(clock * 3 + it.id) * 4 - 6 : 0;
    var cx = r.x + SIZE / 2;
    var cy = r.y + SIZE / 2 - it.fall + bob;

    // 만료 직전 깜빡임
    var left = LIFETIME - it.age;
    if (left < 4 && Math.floor(clock * 8) % 2 === 0) c.globalAlpha = 0.35;

    // 바닥 그림자
    if (landed) {
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.beginPath();
      c.ellipse(cx, r.y + SIZE + 1, SIZE * 0.45, 4, 0, 0, Math.PI * 2);
      c.fill();
    } else {
      // 낙하 꼬리
      var g = c.createLinearGradient(cx, cy - 60, cx, cy);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, T.glow);
      c.fillStyle = g;
      c.globalAlpha *= 0.5;
      c.fillRect(cx - 3, cy - 60, 6, 60);
      c.globalAlpha /= 0.5;
    }

    // 후광
    var pulse = 0.6 + 0.4 * Math.sin(clock * 5 + it.id);
    var halo = c.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 1.3);
    halo.addColorStop(0, hexA(T.glow, 0.45 * pulse));
    halo.addColorStop(1, hexA(T.glow, 0));
    c.fillStyle = halo;
    c.beginPath(); c.arc(cx, cy, SIZE * 1.3, 0, Math.PI * 2); c.fill();

    // 상자 (녹슨 금속 테두리)
    var h = SIZE / 2;
    c.fillStyle = '#2e3433';
    roundRect(c, cx - h, cy - h, SIZE, SIZE, 6); c.fill();
    c.lineWidth = 2;
    c.strokeStyle = '#b5541c';
    c.stroke();
    c.fillStyle = T.color;
    roundRect(c, cx - h + 4, cy - h + 4, SIZE - 8, SIZE - 8, 4); c.fill();

    // 아이콘
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (it.type === 'heal') {
      c.fillRect(cx - 2.5, cy - 8, 5, 16);
      c.fillRect(cx - 8, cy - 2.5, 16, 5);
    } else if (it.type === 'energy') {
      c.beginPath();
      c.moveTo(cx + 2, cy - 9); c.lineTo(cx - 5, cy + 1); c.lineTo(cx, cy + 1);
      c.lineTo(cx - 2, cy + 9); c.lineTo(cx + 5, cy - 1); c.lineTo(cx, cy - 1);
      c.closePath(); c.fill();
    } else if (it.type === 'boost') {
      c.beginPath();
      c.moveTo(cx - 6, cy + 1); c.lineTo(cx, cy - 6); c.lineTo(cx + 6, cy + 1);
      c.moveTo(cx - 6, cy + 7); c.lineTo(cx, cy); c.lineTo(cx + 6, cy + 7);
      c.stroke();
    } else if (it.type === 'shield') {
      c.beginPath();
      c.moveTo(cx, cy - 9); c.lineTo(cx + 7, cy - 6); c.lineTo(cx + 6, cy + 2);
      c.lineTo(cx, cy + 8); c.lineTo(cx - 6, cy + 2); c.lineTo(cx - 7, cy - 6);
      c.closePath(); c.fill();
    }
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a.toFixed(3) + ')';
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
})();
