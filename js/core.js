/* 초능력자: 각성 — 공통 이벤트 버스 (가장 먼저 로드) */
(function () {
  'use strict';

  var Game = window.Game = window.Game || {};
  var handlers = {};

  Game.events = {
    on: function (name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
    },
    emit: function (name, data) {
      var list = handlers[name];
      if (!list) return;
      for (var i = 0; i < list.length; i++) {
        try { list[i](data || {}); } catch (e) { console.error('[events] ' + name, e); }
      }
    },
  };
})();
