/* 초능력자: 각성 — 네트워크 (PeerJS 기반, 호스트 중심 스타형 최대 8인)
 * 방 코드 5자리를 PeerJS 아이디로 사용. 호스트가 방을 만들고 게스트가 코드로 접속한다.
 * 모든 게스트는 호스트에만 연결되고, 호스트가 메시지를 중계한다 (from 은 호스트가 실제 보낸 사람으로 덮어씀).
 * 아이디: 호스트 'h', 게스트 'g1', 'g2', ... (호스트가 내부 메시지 _welcome 으로 배정)
 * 내부 메시지(t 가 '_' 로 시작)는 핸들러에 전달되지 않는다.
 */
(function () {
  'use strict';

  var Game = window.Game = window.Game || {};

  var ID_PREFIX = 'psyawaken-v4-';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var PING_INTERVAL = 2000;
  var TIMEOUT = 9000;
  var MAX_PLAYERS = 8;
  var HOST_ID = 'h';
  var FULL_TEXT = '방이 가득 찼습니다 (최대 8명).';
  var PUB_ROOMS = 12;            // 빠른 매칭 공개 방 PUB1..PUB12
  var QUICK_JOIN_TIMEOUT = 4000;  // 공개 방 하나에 참가 시도하는 시간

  var peer = null;
  var handlers = {};
  var pingTimer = null;
  var closedOnPurpose = false;
  var quickRun = null;   // 진행 중인 빠른 매칭 { cancelled, reject }

  // 호스트: 게스트 링크 목록 id → { id, slot, conn, lastSeen }
  var links = {};
  var nextGuestNum = 1;

  // 게스트: 호스트로 가는 링크
  var hostConn = null;
  var hostLastSeen = 0;

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function fail(message) {
    emit('net:error', { message: message });
    return new Error(message);
  }

  function makeCode() {
    var s = '';
    for (var i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function errorText(err) {
    switch (err && err.type) {
      case 'peer-unavailable': return '그 코드의 방을 찾을 수 없습니다. 코드를 다시 확인해 주세요.';
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed': return '중계 서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.';
      case 'browser-incompatible': return '이 브라우저는 온라인 대전을 지원하지 않습니다.';
      case 'unavailable-id': return '방 코드가 이미 사용 중입니다. 다시 시도해 주세요.';
      default: return '연결 오류가 발생했습니다' + (err && err.type ? ' (' + err.type + ')' : '') + '.';
    }
  }

  function copyPeers(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push({ id: list[i].id, slot: list[i].slot });
    out.sort(function (a, b) { return a.slot - b.slot; });
    return out;
  }

  function rosterDetail() {
    return { peers: copyPeers(Net.peers) };
  }

  // 핸들러에 전달 (내부 메시지는 전달 안 함)
  function deliver(msg) {
    if (!msg || typeof msg.t !== 'string' || msg.t.charAt(0) === '_') return;
    var list = handlers[msg.t];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](msg); } catch (e) { console.error('[net] handler error for', msg.t, e); }
    }
  }

  function rawSend(c, msg) {
    if (c && c.open) {
      try { c.send(msg); } catch (e) { /* 연결이 닫히는 중이면 무시 */ }
    }
  }

  function stopPing() {
    clearInterval(pingTimer);
    pingTimer = null;
  }

  function resetState() {
    stopPing();
    links = {};
    nextGuestNum = 1;
    hostConn = null;
    hostLastSeen = 0;
    Net.connected = false;
    Net.myId = HOST_ID;
    Net.peers = [{ id: HOST_ID, slot: 0 }];
  }

  /* ───────────── 호스트 ───────────── */

  function guestCount() {
    var n = 0;
    for (var k in links) if (links.hasOwnProperty(k)) n++;
    return n;
  }

  function lowestFreeSlot() {
    var used = {};
    for (var i = 0; i < Net.peers.length; i++) used[Net.peers[i].slot] = true;
    for (var s = 1; s < MAX_PLAYERS; s++) if (!used[s]) return s;
    return -1;
  }

  function hostBroadcastRaw(msg, exceptId) {
    for (var k in links) {
      if (links.hasOwnProperty(k) && k !== exceptId) rawSend(links[k].conn, msg);
    }
  }

  function hostSendRoster() {
    hostBroadcastRaw({ t: '_roster', peers: copyPeers(Net.peers) });
  }

  function hostRemoveGuest(id) {
    var L = links[id];
    if (!L) return;
    delete links[id];
    try { L.conn.close(); } catch (e) {}
    Net.peers = Net.peers.filter(function (p) { return p.id !== id; });
    Net.connected = guestCount() > 0;
    if (closedOnPurpose) return;
    hostSendRoster();
    emit('net:peerleave', { id: id });
    emit('net:roster', rosterDetail());
  }

  // 게스트에게서 받은 메시지 처리 + 중계
  function hostOnData(L, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    L.lastSeen = Date.now();
    if (msg.t === '_ping') { rawSend(L.conn, { t: '_pong' }); return; }
    if (msg.t === '_pong') return;
    if (msg.t === '_bye') { hostRemoveGuest(L.id); return; }
    var to = null;
    if (msg.t === '_to') {
      to = msg.to;
      msg = msg.m;
      if (!msg || typeof msg.t !== 'string' || msg.t.charAt(0) === '_') return;
    } else if (msg.t.charAt(0) === '_') {
      return;
    }
    msg.from = L.id; // 위조 방지: 실제 보낸 사람으로 덮어쓰기
    if (to != null) {
      if (to === HOST_ID) deliver(msg);
      else if (links[to] && to !== L.id) rawSend(links[to].conn, msg);
      return;
    }
    hostBroadcastRaw(msg, L.id);
    deliver(msg);
  }

  function hostOnConnection(c) {
    var L = null;
    var rejected = false;
    c.on('open', function () {
      if (closedOnPurpose) { try { c.close(); } catch (e) {} return; }
      var slot = lowestFreeSlot();
      if (Net.peers.length + Net.reserved >= MAX_PLAYERS || slot < 0) {
        rejected = true;
        rawSend(c, { t: '_full', message: FULL_TEXT });
        setTimeout(function () { try { c.close(); } catch (e) {} }, 500);
        return;
      }
      var id = 'g' + (nextGuestNum++);
      L = { id: id, slot: slot, conn: c, lastSeen: Date.now() };
      links[id] = L;
      Net.peers.push({ id: id, slot: slot });
      Net.peers = copyPeers(Net.peers);
      Net.connected = true;
      // _welcome 이 먼저 도착하므로 이후 메시지(start 등)는 게스트가 myId 를 안 뒤에 처리된다
      rawSend(c, { t: '_welcome', id: id, slot: slot, peers: copyPeers(Net.peers) });
      hostBroadcastRaw({ t: '_roster', peers: copyPeers(Net.peers) }, id);
      emit('net:peerjoin', { id: id, slot: slot });
      emit('net:roster', rosterDetail());
      emit('net:connected', { id: id, slot: slot });
    });
    c.on('data', function (msg) {
      if (rejected || !L || links[L.id] !== L) return;
      hostOnData(L, msg);
    });
    var gone = function () { if (L && links[L.id] === L) hostRemoveGuest(L.id); };
    c.on('close', gone);
    c.on('error', gone);
  }

  function hostStartPing() {
    stopPing();
    pingTimer = setInterval(function () {
      var now = Date.now();
      var dead = [];
      for (var k in links) {
        if (!links.hasOwnProperty(k)) continue;
        if (now - links[k].lastSeen > TIMEOUT) dead.push(k);
        else rawSend(links[k].conn, { t: '_ping' });
      }
      for (var i = 0; i < dead.length; i++) hostRemoveGuest(dead[i]);
    }, PING_INTERVAL);
  }

  /* ───────────── 게스트 ───────────── */

  function guestLostHost() {
    var was = Net.connected;
    Net.connected = false;
    stopPing();
    if (hostConn) { try { hostConn.close(); } catch (e) {} }
    hostConn = null;
    if (was && !closedOnPurpose) emit('net:disconnected');
  }

  function guestApplyRoster(list) {
    var old = {};
    var i;
    for (i = 0; i < Net.peers.length; i++) old[Net.peers[i].id] = Net.peers[i];
    var fresh = {};
    for (i = 0; i < list.length; i++) fresh[list[i].id] = list[i];
    Net.peers = copyPeers(list);
    for (i = 0; i < Net.peers.length; i++) {
      var p = Net.peers[i];
      if (p.id !== Net.myId && !old[p.id]) emit('net:peerjoin', { id: p.id, slot: p.slot });
    }
    for (var k in old) {
      if (old.hasOwnProperty(k) && k !== Net.myId && !fresh[k]) emit('net:peerleave', { id: k });
    }
    emit('net:roster', rosterDetail());
  }

  /* ───────────── 공개 API ───────────── */

  var Net = {
    mode: 'offline',
    isHost: true,
    connected: false,
    roomCode: null,
    myId: HOST_ID,
    peers: [{ id: HOST_ID, slot: 0 }],
    maxPlayers: MAX_PLAYERS,
    isPublic: false,   // 빠른 매칭 공개 방이면 true
    reserved: 0,       // 봇이 차지한 자리 수 (setReserved)

    slotOf: function (id) {
      for (var i = 0; i < Net.peers.length; i++) if (Net.peers[i].id === id) return Net.peers[i].slot;
      return -1;
    },

    host: function () {
      return openHost(makeCode, 5, false, false);
    },

    join: function (code) {
      code = String(code || '').trim().toUpperCase();
      try { requirePeerJS(); } catch (e) { return Promise.reject(e); }
      if (!/^[A-Z0-9]{5}$/.test(code)) return Promise.reject(fail('방 코드는 5자리 영문/숫자입니다.'));
      return openJoin(code, 15000, false, false);
    },

    /* 빠른 매칭: 공개 방 PUB1..PUB12 를 (무작위 시작점부터) 차례로 훑어 들어갈 수 있는 방에 참가.
     * 방이 없으면(peer-unavailable) 그 아이디로 직접 방을 연다. 그 사이 누가 먼저 열었으면(unavailable-id) 다시 참가 시도.
     * 꽉 찼거나 응답이 없으면 다음 방. 전부 꽉 찼으면 무작위 접미사의 공개 방을 연다.
     * → Promise { role: 'host'|'guest', code }. Net.close() 로 취소하면 kind 'cancel' 로 reject. */
    quickMatch: function () {
      try { requirePeerJS(); } catch (e) { return Promise.reject(e); }
      cancelQuick();
      if (peer) closeInternal();
      var run = { cancelled: false, reject: null };
      quickRun = run;
      return new Promise(function (resolve, reject) {
        run.reject = reject;
        var order = [];
        var startAt = Math.floor(Math.random() * PUB_ROOMS);
        for (var i = 0; i < PUB_ROOMS; i++) order.push(1 + (startAt + i) % PUB_ROOMS);
        var idx = 0;

        function live() { return !run.cancelled && quickRun === run; }
        function finish(role, code) {
          if (!live()) return;
          quickRun = null;
          resolve({ role: role, code: code });
        }
        function bail(e) {
          if (!live()) return;
          quickRun = null;
          var err = fail((e && e.message) || '빠른 매칭에 실패했습니다.');
          err.kind = e && e.kind;
          reject(err);
        }
        function next() {
          if (!live()) return;
          if (idx >= order.length) { fallback(); return; }
          tryJoin('PUB' + order[idx++], true);
        }
        function tryJoin(code, mayHost) {
          openJoin(code, QUICK_JOIN_TIMEOUT, true, true).then(function () {
            finish('guest', code);
          }, function (e) {
            if (!live()) return;
            var kind = e && e.kind;
            if (kind === 'missing' && mayHost) tryHost(code);
            else if (kind === 'net' || kind === 'nopeer') bail(e);
            else next(); // full / timeout / closed / 경쟁 뒤에도 없음 → 다음 방
          });
        }
        function tryHost(code) {
          openHost(function () { return code; }, 1, true, true).then(function () {
            finish('host', code);
          }, function (e) {
            if (!live()) return;
            var kind = e && e.kind;
            if (kind === 'taken') tryJoin(code, false); // 방금 누가 열었다 → 그 방에 참가
            else if (kind === 'net' || kind === 'nopeer') bail(e);
            else next();
          });
        }
        function fallback() {
          openHost(function () { return 'PUB' + makeCode(); }, 5, true, true).then(function (code) {
            finish('host', code);
          }, bail);
        }
        next();
      });
    },

    // 봇 등 사람 외 참가자가 차지하는 자리 수 (방 정원에 포함). 1 + 게스트 + reserved ≥ 8 이면 새 게스트 거절.
    setReserved: function (n) {
      n = Math.floor(Number(n) || 0);
      if (n < 0) n = 0;
      if (n > MAX_PLAYERS - 1) n = MAX_PLAYERS - 1;
      Net.reserved = n;
    },

    // 남은 사람 자리 수 (호스트 기준)
    freeSeats: function () {
      return Math.max(0, MAX_PLAYERS - Net.peers.length - Net.reserved);
    },

    // msg.from = 내 아이디. toId 없으면 나를 제외한 모두에게, 있으면 그 사람에게만.
    send: function (msg, toId) {
      if (!msg || !Net.connected) return;
      msg.from = Net.myId;
      if (toId != null && toId === Net.myId) return;
      if (Net.isHost) {
        if (toId != null) { if (links[toId]) rawSend(links[toId].conn, msg); }
        else hostBroadcastRaw(msg);
      } else {
        if (toId != null) rawSend(hostConn, { t: '_to', to: toId, m: msg });
        else rawSend(hostConn, msg);
      }
    },

    on: function (type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },

    close: function () {
      cancelQuick();
      closeInternal();
    },
  };

  /* ───────────── 내부: 방 열기 / 방 참가 ───────────── */
  // quiet: net:error 를 내보내지 않고 실패 시 조용히 정리 (빠른 매칭 탐색용). 실패 Error 에는 kind:
  //   'taken'(아이디 사용 중) | 'missing'(방 없음) | 'full' | 'timeout' | 'closed' | 'net'(중계 서버) | 'other'
  function quietOrFail(message, kind, quiet) {
    var e = quiet ? new Error(message) : fail(message);
    e.kind = kind;
    return e;
  }

  function kindOf(err) {
    var t = err && err.type;
    if (t === 'unavailable-id') return 'taken';
    if (t === 'peer-unavailable') return 'missing';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' ||
        t === 'socket-closed' || t === 'browser-incompatible') return 'net';
    return 'other';
  }

  function quietReset() {
    resetState();
    Net.mode = 'offline';
    Net.isHost = true;
    Net.isPublic = false;
    Net.roomCode = null;
  }

  // nextCode(): 시도할 방 코드. unavailable-id 면 maxAttempts 까지 nextCode() 로 다시 시도. → Promise(code)
  function openHost(nextCode, maxAttempts, isPublic, quiet) {
    return new Promise(function (resolve, reject) {
      try { requirePeerJS(); } catch (e) { e.kind = 'nopeer'; reject(e); return; }
      if (peer) closeInternal();
      closedOnPurpose = false;
      resetState();
      Net.mode = 'host';
      Net.isHost = true;
      Net.isPublic = !!isPublic;
      var attempts = 0;

      (function tryOpen() {
        attempts++;
        var code = nextCode();
        var p = new window.Peer(ID_PREFIX + code);
        var opened = false;
        peer = p;
        p.on('open', function () {
          if (peer !== p) return;
          opened = true;
          Net.roomCode = code;
          hostStartPing();
          resolve(code);
        });
        p.on('connection', function (c) {
          if (peer !== p) return;
          hostOnConnection(c);
        });
        p.on('disconnected', function () {
          // 중계(시그널링) 서버와 끊겨도 기존 연결은 유지됨 — 새 참가를 위해 재접속 시도
          if (peer === p && opened && !closedOnPurpose) { try { p.reconnect(); } catch (e) {} }
        });
        p.on('error', function (err) {
          if (peer !== p) return;
          if (!opened && err && err.type === 'unavailable-id' && attempts < maxAttempts) {
            try { p.destroy(); } catch (e) {}
            tryOpen();
            return;
          }
          if (opened && err && err.type === 'peer-unavailable') return;
          var e = quietOrFail(errorText(err), kindOf(err), quiet && !opened);
          if (!opened) {
            if (quiet) {
              try { p.destroy(); } catch (x) {}
              peer = null;
              quietReset();
            }
            reject(e);
          }
        });
      })();
    });
  }

  // code: 방 코드 (PeerJS 아이디 = ID_PREFIX + code). → Promise() (net:connected 이후 resolve)
  function openJoin(code, timeoutMs, isPublic, quiet) {
    return new Promise(function (resolve, reject) {
      try { requirePeerJS(); } catch (e) { e.kind = 'nopeer'; reject(e); return; }
      if (peer) closeInternal();
      closedOnPurpose = false;
      resetState();
      Net.mode = 'guest';
      Net.isHost = false;
      Net.isPublic = !!isPublic;
      Net.roomCode = code;
      Net.myId = null;
      Net.peers = [];
      var done = false;
      var p = new window.Peer();
      peer = p;
      var NOJOIN = quiet ? '공개 방에 연결하지 못했습니다.' : '방에 연결하지 못했습니다. 코드를 확인하고 다시 시도해 주세요.';

      function giveUp(message, kind) {
        if (done) return;
        done = true;
        var e = quietOrFail(message, kind, quiet);
        if (peer === p) {
          stopPing();
          if (hostConn) { try { hostConn.close(); } catch (x) {} }
          hostConn = null;
          try { p.destroy(); } catch (x) {}
          peer = null;
          if (quiet) quietReset();
        }
        reject(e);
      }

      var joinTimer = setTimeout(function () {
        giveUp(NOJOIN, 'timeout');
      }, timeoutMs);

      p.on('open', function () {
        if (peer !== p) return;
        var c = p.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
        hostConn = c;
        c.on('open', function () {
          hostLastSeen = Date.now();
          stopPing();
          pingTimer = setInterval(function () {
            if (Date.now() - hostLastSeen > TIMEOUT) {
              if (!done) giveUp(NOJOIN, 'timeout');
              else guestLostHost();
              return;
            }
            rawSend(c, { t: '_ping' });
          }, PING_INTERVAL);
        });
        c.on('data', function (msg) {
          if (hostConn !== c || !msg || typeof msg.t !== 'string') return;
          hostLastSeen = Date.now();
          switch (msg.t) {
            case '_ping': rawSend(c, { t: '_pong' }); return;
            case '_pong': return;
            case '_full': clearTimeout(joinTimer); giveUp(msg.message || FULL_TEXT, 'full'); return;
            case '_bye': guestLostHost(); return;
            case '_welcome': {
              if (done) return;
              done = true;
              clearTimeout(joinTimer);
              Net.myId = msg.id;
              Net.peers = copyPeers(msg.peers || []);
              Net.connected = true;
              emit('net:connected', { id: msg.id, slot: msg.slot });
              for (var i = 0; i < Net.peers.length; i++) {
                if (Net.peers[i].id !== Net.myId) emit('net:peerjoin', { id: Net.peers[i].id, slot: Net.peers[i].slot });
              }
              emit('net:roster', rosterDetail());
              resolve();
              return;
            }
            case '_roster': if (Net.connected) guestApplyRoster(msg.peers || []); return;
          }
          if (!Net.connected) return;
          deliver(msg);
        });
        var gone = function () {
          if (hostConn !== c) return;
          if (!done) { clearTimeout(joinTimer); giveUp(NOJOIN, 'closed'); return; }
          guestLostHost();
        };
        c.on('close', gone);
        c.on('error', gone);
      });
      p.on('error', function (err) {
        if (peer !== p) return;
        if (!done) { clearTimeout(joinTimer); giveUp(errorText(err), kindOf(err)); return; }
        if (err && (err.type === 'network' || err.type === 'server-error' ||
                    err.type === 'socket-error' || err.type === 'socket-closed')) return; // 시그널링만 끊김: 데이터 연결은 유지
        fail(errorText(err));
      });
    });
  }

  // 진행 중인 빠른 매칭 취소
  function cancelQuick() {
    if (!quickRun) return;
    var q = quickRun;
    quickRun = null;
    q.cancelled = true;
    if (q.reject) {
      var e = new Error('빠른 매칭을 취소했습니다.');
      e.kind = 'cancel';
      q.reject(e);
    }
  }

  // 연결 정리 (빠른 매칭 취소는 하지 않음)
  function closeInternal() {
    closedOnPurpose = true;
    stopPing();
    var k;
    for (k in links) if (links.hasOwnProperty(k)) rawSend(links[k].conn, { t: '_bye' });
    if (hostConn) rawSend(hostConn, { t: '_bye' });
    var conns = [];
    for (k in links) if (links.hasOwnProperty(k)) conns.push(links[k].conn);
    if (hostConn) conns.push(hostConn);
    var p = peer;
    peer = null;
    resetState();
    Net.mode = 'offline';
    Net.isHost = true;
    Net.isPublic = false;
    // _bye 가 전송될 시간을 조금 준 뒤 정리
    setTimeout(function () {
      for (var i = 0; i < conns.length; i++) { try { conns[i].close(); } catch (e) {} }
      if (p) { try { p.destroy(); } catch (e) {} }
    }, 50);
  }

  function requirePeerJS() {
    if (typeof window.Peer !== 'function') {
      throw fail('온라인 모듈(PeerJS)을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
  }

  window.addEventListener('beforeunload', function () {
    // 페이지를 떠날 때는 지연 없이 바로 정리
    closedOnPurpose = true;
    var k;
    for (k in links) if (links.hasOwnProperty(k)) { rawSend(links[k].conn, { t: '_bye' }); try { links[k].conn.close(); } catch (e) {} }
    if (hostConn) { rawSend(hostConn, { t: '_bye' }); try { hostConn.close(); } catch (e) {} }
    if (peer) { try { peer.destroy(); } catch (e) {} }
    peer = null;
    stopPing();
  });

  Game.Net = Net;
})();
