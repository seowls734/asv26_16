/* 초능력자: 각성 — 어려운 능력 4종 (히든 미션 보상) v3
 * 염력 / 블랙홀 / 시간 정지 / 용족 소환
 * Game.Skills 프레임워크(powers.js) 위에서 동작. 판정은 모두 Game.Skills 헬퍼 사용.
 */
(function () {
  'use strict';

  var G = window.Game = window.Game || {};
  var S = G.Skills;
  if (!S || typeof S.register !== 'function') {
    if (window.console && console.warn) console.warn('[skills_hard] Game.Skills 가 없어 어려운 능력을 등록하지 않습니다.');
    return;
  }

  var TAU = Math.PI * 2;

  // ------------------------------------------------------------ 유틸
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function gy() { return S.groundY(); }
  function shake(a) { if (typeof G.shake === 'function') G.shake(a); }
  function burst(x, y, n, colors, speed) { if (typeof S.burst === 'function') S.burst(x, y, n, colors, speed); }
  function viewW() { return G.width || 1280; }
  function viewH() { return G.height || 720; }
  function cam() { return G.camera || { x: 0, y: 0 }; }
  function screenRect(pad) {
    var c = cam();
    return { x: c.x - pad, y: (c.y || 0) - pad, w: viewW() + pad * 2, h: viewH() + pad * 2 };
  }
  function alive(e) { return !!e && e.alive !== false; }
  function center(e) { return { x: e.x + (e.w || 0) / 2, y: e.y + (e.h || 0) / 2 }; }
  function findMutant(id) {
    var l = (G.Mutants && G.Mutants.list) || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function playerById(id) { return typeof S.playerById === 'function' ? S.playerById(id) : null; }
  function isMe(id) { return typeof S.isMe === 'function' ? S.isMe(id) : false; }
  // 원격 시전자 이름 + 조사 (예: '보라(이)가 ')
  function whoName(ctx) {
    var p = ctx && ctx.p;
    var nm = p && typeof p.name === 'string' && p.name ? p.name : '';
    return nm ? nm + '(이)가 ' : '';
  }
  function isAuth() { return !!(G.Mutants && typeof G.Mutants.isAuthority === 'function' && G.Mutants.isAuthority()); }
  function casterCenter(fx) {
    var p = typeof S.caster === 'function' ? S.caster(fx) : null;
    if (p && alive(p)) { fx._cx = p.x + p.w / 2; fx._cy = p.y + p.h / 2; fx._cp = p; }
    return { x: fx._cx, y: fx._cy, p: fx._cp || null };
  }
  function glow(ctx, x, y, r, stops) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r), 0, TAU); ctx.fill();
  }
  // 결정적 의사난수 (시각용 고정 배치)
  function hash(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  // ================================================================ 1. 염력
  var PG_RANGE = 420, PG_LIFT = 0.6, PG_STUN = 0.9, PG_DMG_M = 40, PG_DMG_P = 18, PG_COL = '#b06bff';

  function pgTargetPos(fx) {
    var t = null;
    if (fx.kind === 'mutant') {
      var m = findMutant(fx.tid);
      if (m && alive(m)) t = m;
      fx._tm = t;
    } else {
      var pl = playerById(fx.tid);   // 대상 플레이어 net id (8인 개인전)
      if (pl && alive(pl)) t = pl;
    }
    if (t) { var c = center(t); fx.tx = c.x; fx.ty = c.y; fx.tw = t.w || 40; fx.th = t.h || 40; }
    return t;
  }

  function pgUpdate(fx, dt) {
    var t = pgTargetPos(fx);
    var cc = casterCenter(fx);
    // 시전자 손 주변 보라 기운
    if (Math.random() < 0.6) burst(cc.x + fx.facing * 18, cc.y - 6, 1, ['#d9b8ff', PG_COL, '#7a3cff'], 80);

    if (!fx.started) {
      fx.started = true;
      fx.liftY0 = fx.ty;
      shake(5);
      if (fx.kind === 'mutant') {
        if (t && isAuth()) S.statusMutantsRect(fx, { x: t.x - 4, y: t.y - 4, w: t.w + 8, h: t.h + 8 }, 'stun', PG_STUN);
      } else if (fx.owner === 'remote' && isMe(fx.tid)) {   // 지정 대상이 나일 때만
        var lp = G.players && G.players.local;
        if (lp && alive(lp)) {
          S.statusPlayerRect(fx, { x: lp.x - 4, y: lp.y - 4, w: lp.w + 8, h: lp.h + 8 }, 'stun', PG_STUN);
          lp.vy = -600; lp.onGround = false;
        }
      }
    }

    if (fx.t < PG_LIFT) {
      // 들어 올리는 중
      if (fx.kind === 'mutant' && t && isAuth()) {
        var goal = fx.liftY0 - 170 - (t.h || 0) / 2;
        t.vx *= 0.8;
        t.vy = clamp((goal - t.y) * 9, -700, 250) - 30;
      }
      if (Math.random() < 0.8) burst(fx.tx + rnd(-fx.tw, fx.tw) * 0.6, fx.ty + fx.th * 0.5, 1, ['#e7d0ff', PG_COL], 120);
    } else if (!fx.slammed) {
      fx.slammed = true;
      fx.slamT = fx.t;
      if (fx.kind === 'mutant') {
        if (t && isAuth()) t.vy = 1200;
        var r = Math.max(fx.tw, fx.th) * 0.5 + 18;
        S.hitMutantsCircle(fx, fx.tx, fx.ty, r, PG_DMG_M, { kx: 0, ky: 900 });
      } else {
        var lp2 = G.players && G.players.local;
        var r2 = 140;
        if (lp2 && alive(lp2) && isMe(fx.tid)) S.hitPlayerCircle(fx, lp2.x + lp2.w / 2, lp2.y + lp2.h / 2, r2, PG_DMG_P, { kx: 0, ky: 900 });
      }
      shake(14);
      burst(fx.tx, fx.ty, 26, ['#ffffff', '#e1c4ff', PG_COL, '#5b1fd6'], 520);
      fx.slamX = fx.tx; fx.slamY = Math.min(gy(), fx.ty + fx.th * 0.5 + 220);
    }
    if (fx.slammed && fx.t - fx.slamT > 0.12 && !fx.impact) {
      fx.impact = true;
      burst(fx.tx, gy() - 6, 22, ['#c9a2ff', '#8a4dff', '#ffffff'], 420);
      shake(8);
    }
  }

  function pgRender(fx, ctx) {
    var cc = casterCenter(fx);
    if (cc.x == null || fx.tx == null) return;
    var t = fx.t, k = fx.slammed ? clamp(1 - (t - fx.slamT) / (fx.life - fx.slamT), 0, 1) : 1;
    var hx = cc.x + fx.facing * 20, hy = cc.y - 8;
    var tx = fx.tx, ty = fx.ty;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 시전자 염력 오라
    var pulse = 0.85 + 0.15 * Math.sin(t * 30);
    glow(ctx, cc.x, cc.y, 70 * pulse, [[0, 'rgba(210,170,255,' + (0.45 * k) + ')'], [0.5, 'rgba(150,80,255,' + (0.22 * k) + ')'], [1, 'rgba(90,20,200,0)']]);
    glow(ctx, hx, hy, 26 * pulse, [[0, 'rgba(255,255,255,' + (0.9 * k) + ')'], [0.4, 'rgba(200,150,255,' + (0.6 * k) + ')'], [1, 'rgba(120,40,255,0)']]);

    // 손 → 대상 빛줄기 (여러 겹의 출렁이는 광선)
    if (!fx.slammed || t - fx.slamT < 0.18) {
      var dx = tx - hx, dy = ty - hy, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      for (var b = 0; b < 3; b++) {
        ctx.beginPath();
        var segs = 22;
        for (var i = 0; i <= segs; i++) {
          var u = i / segs;
          var wob = Math.sin(u * 9 + t * (18 + b * 7) + b * 2) * 10 * Math.sin(u * Math.PI) * (1 + b * 0.6);
          var px = hx + dx * u + nx * wob, py = hy + dy * u + ny * wob - Math.sin(u * Math.PI) * 26;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = b === 0 ? 'rgba(255,255,255,' + (0.85 * k) + ')' : 'rgba(170,100,255,' + (0.45 * k) + ')';
        ctx.lineWidth = b === 0 ? 2.5 : 7 + b * 4;
        ctx.stroke();
      }
      // 사슬 고리
      ctx.strokeStyle = 'rgba(220,190,255,' + (0.7 * k) + ')';
      ctx.lineWidth = 2;
      for (var c = 1; c < 9; c++) {
        var uu = (c / 9 + t * 0.9) % 1;
        var cx2 = hx + dx * uu, cy2 = hy + dy * uu - Math.sin(uu * Math.PI) * 26;
        ctx.save(); ctx.translate(cx2, cy2); ctx.rotate(Math.atan2(dy, dx) + (c % 2) * 0.9);
        ctx.beginPath(); ctx.ellipse(0, 0, 8, 4, 0, 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }

    // 대상 주변 오라 + 회전 룬
    var rr = Math.max(fx.tw, fx.th) * 0.7 + 26;
    glow(ctx, tx, ty, rr * 1.6, [[0, 'rgba(230,200,255,' + (0.5 * k) + ')'], [0.45, 'rgba(160,80,255,' + (0.3 * k) + ')'], [1, 'rgba(80,0,200,0)']]);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(t * 3.2);
    ctx.strokeStyle = 'rgba(200,150,255,' + (0.8 * k) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(0, 0, rr + 10, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(240,220,255,' + (0.95 * k) + ')';
    ctx.font = 'bold 15px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var runes = ['ᚠ', 'ᚱ', 'ᛉ', 'ᛟ', 'ᚦ', 'ᛞ', 'ᛗ', 'ᛇ'];
    for (var ri = 0; ri < runes.length; ri++) {
      var a = ri / runes.length * TAU;
      ctx.save(); ctx.translate(Math.cos(a) * (rr + 5), Math.sin(a) * (rr + 5)); ctx.rotate(a + Math.PI / 2);
      ctx.fillText(runes[ri], 0, 0); ctx.restore();
    }
    ctx.rotate(-t * 7);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * k) + ')';
    ctx.beginPath();
    for (var h = 0; h < 6; h++) {
      var ha = h / 6 * TAU;
      var px2 = Math.cos(ha) * rr * 0.75, py2 = Math.sin(ha) * rr * 0.75;
      if (h === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
    }
    ctx.closePath(); ctx.stroke();
    ctx.restore();

    // 내리꽂기 충격파
    if (fx.slammed) {
      var st = (t - fx.slamT) / (fx.life - fx.slamT);
      var g0 = gy();
      ctx.strokeStyle = 'rgba(200,150,255,' + (1 - st) + ')';
      ctx.lineWidth = 6 * (1 - st) + 1;
      ctx.beginPath(); ctx.ellipse(tx, g0 - 4, 40 + st * 220, 10 + st * 30, 0, 0, TAU); ctx.stroke();
      glow(ctx, tx, g0 - 10, 120 * (1 - st * 0.5), [[0, 'rgba(255,255,255,' + (0.7 * (1 - st)) + ')'], [1, 'rgba(140,60,255,0)']]);
      // 내려꽂는 빛기둥
      var colA = 0.8 * (1 - st);
      var lg = ctx.createLinearGradient(tx, ty - 260, tx, g0);
      lg.addColorStop(0, 'rgba(160,80,255,0)');
      lg.addColorStop(1, 'rgba(240,220,255,' + colA + ')');
      ctx.fillStyle = lg;
      ctx.fillRect(tx - 22 * (1 - st), ty - 260, 44 * (1 - st), g0 - ty + 260);
    }
    ctx.restore();
  }

  S.register({
    id: 'psychograb', element: 'psychic', elementName: '염력', name: '염력', icon: '🧠',
    rarity: 'hard', cost: 45, cooldown: 6, color: PG_COL,
    desc: '앞쪽 가장 가까운 적을 염력으로 들어 올렸다가 땅에 내리꽂습니다.',
    prepare: function (ctx) {
      var p = ctx.p;
      var cx = p.x + p.w / 2, cy = p.y + p.h / 2, f = ctx.facing || 1;
      var best = null, bd = Infinity;
      function consider(kind, id, e) {
        if (!alive(e)) return;
        var c = center(e), dx = c.x - cx, dy = c.y - cy;
        if (dx * f < -30) return;              // 바라보는 쪽(뒤 약간 허용)
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d <= PG_RANGE && d < bd) { bd = d; best = { kind: kind, id: id, ry: S.rel(c.y) }; }
      }
      var l = (G.Mutants && G.Mutants.list) || [];
      for (var i = 0; i < l.length; i++) consider('mutant', l[i].id, l[i]);
      var others = typeof S.remotePlayers === 'function' ? S.remotePlayers() : [];
      for (var j = 0; j < others.length; j++) if (others[j] && others[j].id != null) consider('player', others[j].id, others[j]);
      if (!best) {
        if (typeof G.toast === 'function') G.toast('염력: 대상이 없습니다');
        return false;
      }
      return best;
    },
    cast: function (ctx) {
      var d = ctx.data || {};
      if (d.kind !== 'mutant' && d.kind !== 'player') return;
      var p = ctx.p;
      var fx = S.addFx({
        skill: 'psychograb', owner: ctx.owner, castId: ctx.castId, casterId: ctx.casterId,
        x: p ? p.x + p.w / 2 : ctx.x, y: p ? p.y + p.h / 2 : ctx.y,
        t: 0, life: 1.1,
        facing: ctx.facing || 1, kind: d.kind, tid: d.id,
        tx: null, ty: null, tw: 40, th: 40,
        _cx: (p ? p.x + p.w / 2 : ctx.x), _cy: (p ? p.y + p.h / 2 : ctx.y + 31),
        update: pgUpdate, render: pgRender
      });
      // 초기 대상 위치 (대상이 보이지 않아도 렌더 가능하게)
      if (typeof d.ry === 'number') { fx.tx = fx._cx + fx.facing * 200; fx.ty = S.abs(d.ry); }
      pgTargetPos(fx);
      if (fx.tx == null) { fx.tx = fx._cx + fx.facing * 200; fx.ty = fx._cy; }
    }
  });

  // ================================================================ 2. 블랙홀
  var BH_OFF = 300, BH_H = 170, BH_LIFE = 3, BH_PULL_R = 300, BH_ACC = 1800,
      BH_CORE = 70, BH_DMG_P = 4, BH_DMG_M = 10, BH_EXP_R = 220, BH_EXP_P = 15, BH_EXP_M = 40, BH_COL = '#7b4dff';

  function bhScale(t) {
    if (t < 0.35) return ease(t / 0.35);
    if (t > BH_LIFE - 0.25) return 1 - ease((t - (BH_LIFE - 0.25)) / 0.25) * 0.85;
    return 1;
  }

  function bhUpdate(fx, dt) {
    var cx = fx.x, cy = S.abs(fx.ry);
    fx.y = cy;
    S.pullMutants(fx, cx, cy, BH_PULL_R, BH_ACC, dt);
    S.pullPlayer(fx, cx, cy, BH_PULL_R, BH_ACC, dt);
    S.hitMutantsCircle(fx, cx, cy, BH_CORE, BH_DMG_M, { kx: 0, ky: 0 });
    S.hitPlayerCircle(fx, cx, cy, BH_CORE, BH_DMG_P, { kx: 0, ky: 0 });
    // 빨려 드는 파편
    var i, d;
    while (fx.debris.length < 70) {
      fx.debris.push({ a: rnd(0, TAU), r: rnd(200, 380), s: rnd(1.5, 4.5), w: rnd(0.8, 1.6), h: rnd(0, 1) });
    }
    for (i = fx.debris.length - 1; i >= 0; i--) {
      d = fx.debris[i];
      d.r -= (60 + 26000 / (d.r + 30)) * dt;
      d.a += (1.2 + 220 / (d.r + 20)) * d.w * dt;
      if (d.r < 46) fx.debris.splice(i, 1);
    }
    fx.shk = (fx.shk || 0) + dt;
    if (fx.shk > 0.08) { fx.shk = 0; shake(1.5); }
    if (fx.t + dt >= fx.life && !fx.exploded) {
      fx.exploded = true;
      spawnBlackholeBlast(fx, cx, cy);
    }
  }

  function bhRender(fx, ctx) {
    var cx = fx.x, cy = S.abs(fx.ry), t = fx.t, sc = bhScale(t);
    if (sc <= 0.01) return;
    ctx.save();
    // 주변 시공간 어둠
    glow(ctx, cx, cy, BH_PULL_R * 1.15 * sc, [[0, 'rgba(10,0,30,0.75)'], [0.35, 'rgba(30,10,70,0.35)'], [1, 'rgba(20,0,50,0)']]);

    ctx.globalCompositeOperation = 'lighter';
    // 빛 휘어짐: 일렁이는 여러 겹 링
    for (var k = 0; k < 6; k++) {
      var rr = (62 + k * 26) * sc + Math.sin(t * 4 + k) * 4;
      ctx.strokeStyle = 'rgba(' + (150 + k * 15) + ',' + (110 + k * 10) + ',255,' + (0.38 - k * 0.05) + ')';
      ctx.lineWidth = 2.5 - k * 0.3;
      ctx.beginPath();
      for (var i = 0; i <= 48; i++) {
        var a = i / 48 * TAU;
        var w = 1 + 0.06 * Math.sin(a * 3 + t * (2 + k)) ;
        var px = cx + Math.cos(a) * rr * w, py = cy + Math.sin(a) * rr * w * (0.92 + 0.08 * Math.sin(t * 3));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // 파편 (안쪽일수록 늘어지고 밝아짐)
    for (var j = 0; j < fx.debris.length; j++) {
      var d = fx.debris[j];
      var dx = Math.cos(d.a) * d.r * sc, dy = Math.sin(d.a) * d.r * 0.55 * sc;
      var near = clamp(1 - d.r / 380, 0, 1);
      ctx.strokeStyle = d.h > 0.5 ? 'rgba(255,190,120,' + (0.3 + near * 0.7) + ')' : 'rgba(180,150,255,' + (0.3 + near * 0.7) + ')';
      ctx.lineWidth = d.s * (0.6 + near);
      ctx.beginPath();
      ctx.moveTo(cx + dx, cy + dy);
      var a2 = d.a - 0.12 - near * 0.4;
      ctx.lineTo(cx + Math.cos(a2) * (d.r + 14) * sc, cy + Math.sin(a2) * (d.r + 14) * 0.55 * sc);
      ctx.stroke();
    }
    // 강착 원반 (뒤쪽 절반)
    function disk(front) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.22);
      ctx.scale(1, 0.3);
      for (var b = 0; b < 26; b++) {
        var r0 = (58 + b * 4.6) * sc;
        var hot = 1 - b / 26;
        var col = hot > 0.7 ? '255,245,220' : hot > 0.4 ? '255,170,90' : '190,90,255';
        var segN = 10;
        for (var s = 0; s < segN; s++) {
          var a0 = s / segN * TAU + t * (5 - b * 0.12) + b * 0.7;
          var a1 = a0 + TAU / segN * 0.62;
          var mid = (a0 + a1) / 2;
          var isFront = Math.sin(mid) > 0;
          if (isFront !== front) continue;
          ctx.strokeStyle = 'rgba(' + col + ',' + (0.18 + hot * 0.4) * (0.6 + 0.4 * Math.sin(mid * 2 + t * 3)) + ')';
          ctx.lineWidth = 4.2 * sc;
          ctx.beginPath(); ctx.arc(0, 0, r0, a0, a1); ctx.stroke();
        }
      }
      ctx.restore();
    }
    disk(false);
    // 렌즈로 휘어 올라간 원반 상(위·아래 고리)
    ctx.strokeStyle = 'rgba(255,210,150,0.55)';
    ctx.lineWidth = 5 * sc;
    ctx.beginPath(); ctx.ellipse(cx, cy, 64 * sc, 58 * sc, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,140,255,0.35)';
    ctx.lineWidth = 3 * sc;
    ctx.beginPath(); ctx.ellipse(cx, cy, 60 * sc, 54 * sc, 0, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
    // 광자 고리
    glow(ctx, cx, cy, 64 * sc, [[0.7, 'rgba(255,255,255,0)'], [0.82, 'rgba(255,240,220,0.9)'], [0.9, 'rgba(200,140,255,0.5)'], [1, 'rgba(120,60,255,0)']]);
    // 중심: 완전한 검정
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(cx, cy, 48 * sc, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    disk(true);
    // 수축 직전 섬광 예고
    if (t > BH_LIFE - 0.4) {
      var q = (t - (BH_LIFE - 0.4)) / 0.4;
      glow(ctx, cx, cy, 40 + q * 60, [[0, 'rgba(255,255,255,' + q + ')'], [1, 'rgba(180,120,255,0)']]);
    }
    ctx.restore();
  }

  function spawnBlackholeBlast(src, cx, cy) {
    var ry = S.rel(cy);
    var bx = S.addFx({
      skill: 'blackhole', owner: src.owner, castId: src.castId, casterId: src.casterId,
      x: cx, y: cy, ry: ry, t: 0, life: 0.9,
      update: function (fx) {
        if (fx.done) return;
        fx.done = true;
        var y = S.abs(fx.ry);
        var knock = function (e, dx, dy, dist) {
          var n = dist || 1;
          return { kx: dx / n * 760, ky: dy / n * 520 - 380 };
        };
        S.hitMutantsCircle(fx, fx.x, y, BH_EXP_R, BH_EXP_M, knock);
        S.hitPlayerCircle(fx, fx.x, y, BH_EXP_R, BH_EXP_P, knock);
        shake(20);
        burst(fx.x, y, 40, ['#ffffff', '#e6d4ff', '#9a6bff', '#ffb070'], 820);
        burst(fx.x, y, 20, ['#2a0a5a', '#5a2ab0'], 420);
      },
      render: function (fx, ctx) {
        var y = S.abs(fx.ry), q = fx.t / fx.life, e = 1 - Math.pow(1 - q, 3);
        ctx.save();
        // 화면 섬광
        if (fx.t < 0.18) {
          var sr = screenRect(80);
          ctx.fillStyle = 'rgba(240,230,255,' + (0.55 * (1 - fx.t / 0.18)) + ')';
          ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
        }
        ctx.globalCompositeOperation = 'lighter';
        glow(ctx, fx.x, y, BH_EXP_R * (0.4 + e * 0.9), [[0, 'rgba(255,255,255,' + (1 - q) + ')'], [0.3, 'rgba(220,190,255,' + (0.8 * (1 - q)) + ')'], [0.7, 'rgba(120,60,255,' + (0.4 * (1 - q)) + ')'], [1, 'rgba(60,0,160,0)']]);
        for (var k = 0; k < 3; k++) {
          var rr = BH_EXP_R * (0.3 + e * (1.1 + k * 0.25));
          ctx.strokeStyle = 'rgba(' + (k === 1 ? '255,200,140' : '200,160,255') + ',' + (1 - q) * (1 - k * 0.25) + ')';
          ctx.lineWidth = (10 - k * 3) * (1 - q) + 1;
          ctx.beginPath(); ctx.arc(fx.x, y, rr, 0, TAU); ctx.stroke();
        }
        // 방사 광선
        ctx.strokeStyle = 'rgba(255,240,255,' + (0.7 * (1 - q)) + ')';
        ctx.lineWidth = 2;
        for (var r = 0; r < 18; r++) {
          var a = r / 18 * TAU + hash(r) * 0.3;
          var l0 = 30 + e * 80, l1 = l0 + 120 + hash(r + 9) * 200 * e;
          ctx.beginPath();
          ctx.moveTo(fx.x + Math.cos(a) * l0, y + Math.sin(a) * l0);
          ctx.lineTo(fx.x + Math.cos(a) * l1, y + Math.sin(a) * l1);
          ctx.stroke();
        }
        ctx.restore();
      }
    });
    return bx;
  }

  S.register({
    id: 'blackhole', element: 'void', elementName: '블랙홀', name: '블랙홀', icon: '🕳️',
    rarity: 'hard', cost: 70, cooldown: 14, color: BH_COL,
    desc: '앞쪽 공중에 블랙홀을 열어 주변을 빨아들이고, 마지막에 폭발시킵니다.',
    cast: function (ctx) {
      var p = ctx.p, f = ctx.facing || 1;
      var cx = (p ? ctx.x + p.w / 2 : ctx.x) + f * BH_OFF;
      var w = (G.world && G.world.width) || 4200;
      cx = clamp(cx, 60, w - 60);
      shake(8);
      var fx = S.addFx({
        skill: 'blackhole', owner: ctx.owner, castId: ctx.castId, casterId: ctx.casterId,
        x: cx, y: S.abs(-BH_H), ry: -BH_H, r: 48,
        t: 0, life: BH_LIFE, rehit: 0.3, debris: [],
        update: bhUpdate, render: bhRender
      });
      burst(cx, fx.y, 30, ['#ffffff', '#b590ff', '#3a1a80'], 500);
    }
  });

  // ================================================================ 3. 시간 정지
  var TS_LIFE = 3, TS_MUT = 3, TS_PLAYER = 2.5, TS_COL = '#6fd8ff', TS_R = 99999;
  var ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

  function tsAlpha(t) {
    if (t < 0.25) return ease(t / 0.25);
    if (t > TS_LIFE - 0.4) return 1 - ease((t - (TS_LIFE - 0.4)) / 0.4);
    return 1;
  }

  function tsUpdate(fx, dt) {
    var cc = casterCenter(fx);
    if (!fx.applied) {
      fx.applied = true;
      S.statusMutantsCircle(fx, cc.x, cc.y, TS_R, 'stun', TS_MUT);
      S.statusPlayerCircle(fx, cc.x, cc.y, TS_R, 'stun', TS_PLAYER);
      shake(10);
      burst(cc.x, cc.y, 30, ['#ffffff', '#bff0ff', TS_COL, '#ffe08a'], 600);
    }
    // 세상의 파티클이 멈춘 듯이 (시각 효과 전용)
    if (fx.t < TS_LIFE - 0.3 && G.particles && G.particles.length) {
      var damp = Math.exp(-14 * dt);
      for (var i = 0; i < G.particles.length; i++) {
        var q = G.particles[i];
        if (!q) continue;
        q.vx *= damp; q.vy *= damp;
        if (q.gravity) q.vy -= q.gravity * dt * 0.95;
        if (typeof q.life === 'number') q.life += dt * 0.85;
      }
    }
  }

  function tsRender(fx, ctx) {
    var cc = casterCenter(fx);
    var t = fx.t, a = tsAlpha(t);
    var sr = screenRect(120);
    ctx.save();
    // 1) 흑백
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 0.92 * a;
    ctx.fillStyle = 'hsl(0,0%,50%)';
    ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
    // 2) 청색 톤
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(30,70,140,' + (0.3 * a) + ')';
    ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
    // 시작 순간 퍼지는 파동
    if (t < 0.7) {
      var wq = t / 0.7;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(180,240,255,' + (1 - wq) + ')';
      ctx.lineWidth = 14 * (1 - wq) + 1;
      ctx.beginPath(); ctx.arc(cc.x, cc.y, 30 + wq * viewW(), 0, TAU); ctx.stroke();
      if (t < 0.12) {
        ctx.fillStyle = 'rgba(220,250,255,' + (0.5 * (1 - t / 0.12)) + ')';
        ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    // 멈춘 먼지 (공중에 고정된 빛 알갱이)
    for (var m = 0; m < fx.motes.length; m++) {
      var mo = fx.motes[m];
      var tw = 0.5 + 0.5 * Math.sin(mo.p + t * 2);
      ctx.fillStyle = 'rgba(200,240,255,' + (0.25 + 0.55 * tw) * a + ')';
      ctx.fillRect(mo.x - mo.s / 2, mo.y - mo.s / 2, mo.s, mo.s);
      if (mo.s > 3) {
        ctx.fillRect(mo.x - mo.s * 2, mo.y - 0.5, mo.s * 4, 1);
        ctx.fillRect(mo.x - 0.5, mo.y - mo.s * 2, 1, mo.s * 4);
      }
    }
    // 3) 거대한 시계 문양
    var R = Math.min(viewH() * 0.42, 340) * (0.6 + 0.4 * ease(t / 0.35));
    ctx.translate(cc.x, cc.y);
    ctx.globalAlpha = a;
    glow(ctx, 0, 0, R * 1.15, [[0, 'rgba(120,220,255,0.12)'], [0.8, 'rgba(80,170,255,0.08)'], [0.95, 'rgba(160,230,255,0.22)'], [1, 'rgba(100,200,255,0)']]);
    ctx.strokeStyle = 'rgba(190,240,255,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, R - 12, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,140,0.6)';
    ctx.beginPath(); ctx.arc(0, 0, R + 10, 0, TAU); ctx.stroke();
    // 눈금 60개
    for (var i = 0; i < 60; i++) {
      var ang = i / 60 * TAU;
      var big = i % 5 === 0;
      var r0 = R - 12 - (big ? 16 : 7), r1 = R - 12;
      ctx.strokeStyle = big ? 'rgba(255,230,160,0.95)' : 'rgba(180,230,255,0.7)';
      ctx.lineWidth = big ? 3 : 1.4;
      ctx.beginPath(); ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0); ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1); ctx.stroke();
    }
    // 로마 숫자
    ctx.fillStyle = 'rgba(255,235,180,0.95)';
    ctx.font = 'bold ' + Math.round(R * 0.09 + 6) + 'px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var n = 0; n < 12; n++) {
      var na = n / 12 * TAU - Math.PI / 2, nr = R - 46;
      ctx.fillText(ROMAN[n], Math.cos(na) * nr, Math.sin(na) * nr);
    }
    // 회전하는 룬 고리 (반대 방향 두 겹)
    ctx.save();
    ctx.rotate(-t * 0.6);
    ctx.setLineDash([4, 10]);
    ctx.strokeStyle = 'rgba(140,220,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.62, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(170,235,255,0.85)';
    ctx.font = Math.round(R * 0.06 + 6) + 'px serif';
    var glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    for (var gi = 0; gi < 24; gi++) {
      var ga = gi / 24 * TAU;
      ctx.save(); ctx.translate(Math.cos(ga) * R * 0.7, Math.sin(ga) * R * 0.7); ctx.rotate(ga + Math.PI / 2);
      ctx.fillText(glyphs.charAt(gi), 0, 0); ctx.restore();
    }
    ctx.restore();
    // 톱니바퀴 2개
    function gear(x, y, r, teeth, rot) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.beginPath();
      for (var g = 0; g < teeth * 2; g++) {
        var ga2 = g / (teeth * 2) * TAU, rr2 = g % 2 ? r : r * 1.18;
        var ga3 = ga2 + TAU / (teeth * 2);
        ctx.lineTo(Math.cos(ga2) * rr2, Math.sin(ga2) * rr2);
        ctx.lineTo(Math.cos(ga3) * rr2, Math.sin(ga3) * rr2);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,215,130,0.55)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    gear(-R * 0.26, R * 0.2, R * 0.2, 12, t * 0.8);
    gear(R * 0.2, R * 0.28, R * 0.13, 8, -t * 1.2 + 0.2);
    // 바늘: 분침(느림), 초침(60틱 끊어 가며 3초에 한 바퀴)
    var minA = -Math.PI / 2 + t * 0.35;
    var secA = -Math.PI / 2 + Math.floor(t / TS_LIFE * 60) / 60 * TAU;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(200,240,255,0.9)'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(minA) * R * 0.5, Math.sin(minA) * R * 0.5); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,120,1)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-Math.cos(secA) * R * 0.12, -Math.sin(secA) * R * 0.12); ctx.lineTo(Math.cos(secA) * (R - 30), Math.sin(secA) * (R - 30)); ctx.stroke();
    glow(ctx, Math.cos(secA) * (R - 30), Math.sin(secA) * (R - 30), 14, [[0, 'rgba(255,255,220,0.9)'], [1, 'rgba(255,200,80,0)']]);
    glow(ctx, 0, 0, 22, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(160,230,255,0.6)'], [1, 'rgba(80,180,255,0)']]);
    // 시전자 주변은 시간이 흐른다 — 밝은 청록 오라
    glow(ctx, 0, 0, 70 + 6 * Math.sin(t * 12), [[0, 'rgba(180,250,255,0.35)'], [1, 'rgba(80,200,255,0)']]);
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  S.register({
    id: 'timestop', element: 'time', elementName: '시간', name: '시간 정지', icon: '⏳',
    rarity: 'hard', cost: 80, cooldown: 20, color: TS_COL,
    desc: '3초 동안 시간을 멈춥니다. 모든 돌연변이와 상대가 얼어붙고, 나만 움직입니다.',
    cast: function (ctx) {
      var p = ctx.p;
      var cx = p ? ctx.x + p.w / 2 : ctx.x, cy = p ? ctx.y + p.h / 2 : ctx.y;
      var motes = [];
      var sr = screenRect(0);
      for (var i = 0; i < 90; i++) {
        motes.push({ x: cx + rnd(-viewW() * 0.7, viewW() * 0.7), y: sr.y + rnd(0, viewH()), s: rnd(1.5, 4.5), p: rnd(0, TAU) });
      }
      S.addFx({
        skill: 'timestop', owner: ctx.owner, castId: ctx.castId, casterId: ctx.casterId,
        x: cx, y: cy, _cx: cx, _cy: cy,
        t: 0, life: TS_LIFE, motes: motes,
        update: tsUpdate, render: tsRender
      });
      if (typeof G.toast === 'function' && ctx.owner === 'remote') G.toast(whoName(ctx) + '시간을 멈췄다!');
    }
  });

  // ================================================================ 4. 용족 소환
  var DR_LIFE = 3, DR_FX_LIFE = 4.6, DR_SPEED = 1150, DR_START = 950, DR_HIT_OFF = 230,
      DR_B0 = 0.35, DR_B1 = 2.85, DR_W = 220, DR_H = 460, DR_DMG_P = 5, DR_DMG_M = 15, DR_COL = '#ff5a1f';

  function drX(fx, t) { return fx.sx + fx.dir * DR_SPEED * t; }
  function drScale() { return Math.max(0.6, viewH() * 0.46 / 480); }
  function drBodyY(fx, t) {
    var base = gy() - viewH() * 0.47;
    var swoop = t < 0.6 ? (1 - ease(t / 0.6)) * viewH() * 0.55 : 0;
    var exit = t > DR_B1 ? ease((t - DR_B1) / (DR_LIFE - DR_B1)) * viewH() * 0.75 : 0;
    return base - swoop - exit + Math.sin(t * 7) * 8;
  }
  function breathing(t) { return t >= DR_B0 && t <= DR_B1; }

  function drUpdate(fx, dt) {
    var t = fx.t, g0 = gy();
    var hx = drX(fx, t) + fx.dir * DR_HIT_OFF;
    if (breathing(t)) {
      var rect = { x: hx - DR_W / 2, y: g0 - DR_H, w: DR_W, h: DR_H };
      S.hitMutantsRect(fx, rect, DR_DMG_M, fx.dir * 140, -260);
      S.hitPlayerRect(fx, rect, DR_DMG_P, fx.dir * 140, -260);
      shake(36 * dt);
      fx.fireAcc += dt;
      while (fx.fireAcc > 0.035) {
        fx.fireAcc -= 0.035;
        fx.fires.push({ x: hx + rnd(-DR_W * 0.5, DR_W * 0.5), t0: t, s: rnd(0.7, 1.4), p: rnd(0, TAU) });
      }
      if (Math.random() < 0.7) burst(hx + rnd(-90, 90), g0 - 8, 2, ['#fff2b0', '#ffb040', '#ff5a1f', '#c21a0a'], 380);
    }
    if (!fx.roared && t > 0.15) { fx.roared = true; shake(18); }
    for (var i = fx.fires.length - 1; i >= 0; i--) if (t - fx.fires[i].t0 > 1.7) fx.fires.splice(i, 1);
  }

  // 용 그리기 (로컬 좌표: 오른쪽이 머리, 원점=몸통 중심, 단위 ≈ 480 높이)
  function drawWing(ctx, t, far) {
    var f = Math.sin(t * 7.5 + (far ? 0.35 : 0));      // -1..1
    var up = 0.25 + 0.75 * (f * 0.5 + 0.5);              // 0.25..1
    var sx = far ? 30 : 10, sy = -40;
    var ex = -40, ey = sy - 150 * up + 40 * (1 - up);
    var wx = -150, wy = sy - 300 * up + 150 * (1 - up);
    var tips = [
      [-330, wy + 40 * up + 60 * (1 - up)],
      [-300, wy + 170 * up + 140 * (1 - up)],
      [-220, sy + 60 + 30 * (1 - up)],
      [-110, sy + 70]
    ];
    // 막
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey); ctx.lineTo(wx, wy);
    ctx.lineTo(tips[0][0], tips[0][1]);
    for (var i = 1; i < tips.length; i++) {
      var p0 = tips[i - 1], p1 = tips[i];
      ctx.quadraticCurveTo((p0[0] + p1[0]) / 2 + 18, (p0[1] + p1[1]) / 2 - 10, p1[0], p1[1]);
    }
    ctx.quadraticCurveTo(-40, sy + 40, sx, sy + 20);
    ctx.closePath();
    var mg = ctx.createLinearGradient(0, wy, 0, sy + 80);
    mg.addColorStop(0, far ? '#4a0f12' : '#7a1a14');
    mg.addColorStop(1, far ? '#2a0606' : '#c2401a');
    ctx.fillStyle = mg;
    ctx.globalAlpha = far ? 0.85 : 0.94;
    ctx.fill();
    ctx.globalAlpha = 1;
    // 막 안의 핏줄 빛
    ctx.strokeStyle = far ? 'rgba(255,120,60,0.15)' : 'rgba(255,150,80,0.3)';
    ctx.lineWidth = 1.5;
    for (var v = 0; v < tips.length; v++) {
      ctx.beginPath(); ctx.moveTo(wx, wy);
      ctx.quadraticCurveTo((wx + tips[v][0]) / 2 + 10, (wy + tips[v][1]) / 2 + 12, tips[v][0], tips[v][1]);
      ctx.stroke();
    }
    // 뼈대
    ctx.strokeStyle = far ? '#2a0a08' : '#3a0d08';
    ctx.lineCap = 'round';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(wx, wy); ctx.stroke();
    ctx.lineWidth = 5;
    for (var b = 0; b < tips.length; b++) {
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(tips[b][0], tips[b][1]); ctx.stroke();
    }
    // 날개 발톱
    ctx.fillStyle = '#e8d6b0';
    ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + 8, wy - 26); ctx.lineTo(wx + 14, wy - 2); ctx.closePath(); ctx.fill();
    ctx.lineCap = 'butt';
  }

  function drawDragon(ctx, fx, t) {
    var br = breathing(t);
    // 꼬리
    var tailPts = [];
    for (var i = 0; i <= 14; i++) {
      var u = i / 14;
      tailPts.push([-120 - u * 420, 10 + u * 50 + Math.sin(t * 5 - u * 4) * 34 * u]);
    }
    ctx.beginPath();
    for (var a = 0; a < tailPts.length; a++) {
      var w = 46 * (1 - a / 14) + 3;
      if (a === 0) ctx.moveTo(tailPts[a][0], tailPts[a][1] - w); else ctx.lineTo(tailPts[a][0], tailPts[a][1] - w);
    }
    for (var b = tailPts.length - 1; b >= 0; b--) {
      var w2 = 46 * (1 - b / 14) + 3;
      ctx.lineTo(tailPts[b][0], tailPts[b][1] + w2 * 0.7);
    }
    ctx.closePath();
    ctx.fillStyle = '#6e1410';
    ctx.fill();
    // 꼬리 가시 + 끝 화살촉
    ctx.fillStyle = '#2a0805';
    for (var s = 1; s < 14; s += 2) {
      var tp = tailPts[s], ww = 46 * (1 - s / 14) + 3;
      ctx.beginPath(); ctx.moveTo(tp[0] + 10, tp[1] - ww); ctx.lineTo(tp[0] - 4, tp[1] - ww - 22 * (1 - s / 16)); ctx.lineTo(tp[0] - 14, tp[1] - ww); ctx.closePath(); ctx.fill();
    }
    var tip = tailPts[14];
    ctx.beginPath(); ctx.moveTo(tip[0] + 10, tip[1]); ctx.lineTo(tip[0] - 30, tip[1] - 22); ctx.lineTo(tip[0] - 50, tip[1] + 4); ctx.lineTo(tip[0] - 26, tip[1] + 22); ctx.closePath(); ctx.fill();

    // 먼 날개
    drawWing(ctx, t, true);

    // 뒷다리 (접힘)
    ctx.fillStyle = '#5a100c';
    ctx.beginPath(); ctx.ellipse(-90, 60, 46, 30, 0.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-100, 80); ctx.lineTo(-70, 132); ctx.lineTo(-40, 128); ctx.lineTo(-60, 76); ctx.fill();
    ctx.fillStyle = '#efe0c0';
    for (var c = 0; c < 3; c++) { ctx.beginPath(); ctx.moveTo(-70 + c * 12, 130); ctx.lineTo(-62 + c * 12, 146); ctx.lineTo(-58 + c * 12, 130); ctx.fill(); }

    // 몸통
    ctx.beginPath();
    ctx.moveTo(-150, -10);
    ctx.bezierCurveTo(-120, -80, 60, -90, 140, -50);
    ctx.bezierCurveTo(170, -30, 170, 30, 120, 50);
    ctx.bezierCurveTo(40, 90, -110, 80, -150, 40);
    ctx.closePath();
    var bg = ctx.createLinearGradient(0, -90, 0, 90);
    bg.addColorStop(0, '#3f0907'); bg.addColorStop(0.45, '#8f1d12'); bg.addColorStop(1, '#c9551c');
    ctx.fillStyle = bg;
    ctx.fill();
    // 비늘 (몸통 안쪽으로 클립)
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(30,4,2,0.55)';
    ctx.lineWidth = 1.6;
    for (var ry = -90; ry < 90; ry += 13) {
      var off = ((ry / 13) & 1) ? 9 : 0;
      for (var rx = -160; rx < 180; rx += 18) {
        ctx.beginPath(); ctx.arc(rx + off, ry, 9, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      }
    }
    // 배 비늘판
    ctx.fillStyle = 'rgba(240,180,90,0.55)';
    for (var pl = 0; pl < 9; pl++) {
      var px = -120 + pl * 30;
      ctx.beginPath(); ctx.ellipse(px, 52 + Math.sin(pl * 0.6) * 4, 15, 9, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
    // 등 가시
    ctx.fillStyle = '#240604';
    for (var d = 0; d < 8; d++) {
      var dxp = -130 + d * 34, dyp = -60 - Math.sin((d + 1) / 9 * Math.PI) * 22;
      ctx.beginPath(); ctx.moveTo(dxp + 12, dyp + 10); ctx.lineTo(dxp - 2, dyp - 30); ctx.lineTo(dxp - 12, dyp + 10); ctx.closePath(); ctx.fill();
    }

    // 목 (머리를 아래로 숙여 땅에 불을 뿜음)
    var hA = br ? 0.55 : 0.2;
    var hx = 300, hy = 40 + (br ? 40 : 0);
    ctx.beginPath();
    ctx.moveTo(110, -55);
    ctx.quadraticCurveTo(250, -100, hx - 10, hy - 34);
    ctx.lineTo(hx + 4, hy + 18);
    ctx.quadraticCurveTo(230, -10, 130, 45);
    ctx.closePath();
    ctx.fillStyle = '#7c1910';
    ctx.fill();
    ctx.fillStyle = 'rgba(240,180,90,0.5)';
    for (var nk = 0; nk < 5; nk++) {
      var nu = nk / 5;
      ctx.beginPath(); ctx.ellipse(150 + nu * 140, 30 - nu * 20 + nu * nu * 40, 12, 7, 0.5, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#240604';
    for (var ns = 0; ns < 5; ns++) {
      var nx = 140 + ns * 34, ny = -66 - Math.sin(ns / 5 * Math.PI) * 18 + ns * 10;
      ctx.beginPath(); ctx.moveTo(nx + 10, ny + 10); ctx.lineTo(nx, ny - 20); ctx.lineTo(nx - 8, ny + 10); ctx.closePath(); ctx.fill();
    }

    // 머리
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(hA);
    var jaw = br ? 0.45 + 0.06 * Math.sin(t * 40) : 0.08;
    // 아래턱
    ctx.save();
    ctx.rotate(jaw);
    ctx.fillStyle = '#5c120c';
    ctx.beginPath(); ctx.moveTo(-10, 6); ctx.lineTo(100, 6); ctx.lineTo(96, 20); ctx.lineTo(0, 26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f4ecd6';
    for (var tt = 0; tt < 5; tt++) { ctx.beginPath(); ctx.moveTo(30 + tt * 14, 6); ctx.lineTo(36 + tt * 14, -4); ctx.lineTo(42 + tt * 14, 6); ctx.fill(); }
    ctx.restore();
    // 입 안 불빛
    if (br) {
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 80, 14, 50, [[0, 'rgba(255,255,220,0.95)'], [0.4, 'rgba(255,170,50,0.6)'], [1, 'rgba(255,60,0,0)']]);
      ctx.globalCompositeOperation = 'source-over';
    }
    // 위턱/두개골
    ctx.beginPath();
    ctx.moveTo(-30, -30);
    ctx.quadraticCurveTo(30, -48, 70, -22);
    ctx.lineTo(112, -8); ctx.lineTo(110, 6);
    ctx.lineTo(-14, 10);
    ctx.quadraticCurveTo(-40, 0, -30, -30);
    ctx.closePath();
    var hg = ctx.createLinearGradient(0, -40, 0, 10);
    hg.addColorStop(0, '#4a0b07'); hg.addColorStop(1, '#a3301a');
    ctx.fillStyle = hg; ctx.fill();
    ctx.strokeStyle = 'rgba(30,4,2,0.6)'; ctx.lineWidth = 1.4;
    for (var hs = 0; hs < 5; hs++) { ctx.beginPath(); ctx.arc(10 + hs * 18, -18 + hs * 2.5, 7, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = '#f4ecd6';
    for (var ut = 0; ut < 6; ut++) { ctx.beginPath(); ctx.moveTo(24 + ut * 14, 6); ctx.lineTo(30 + ut * 14, 16); ctx.lineTo(36 + ut * 14, 6); ctx.fill(); }
    // 뿔 2개 (뒤로 휜)
    ctx.fillStyle = '#e2d2a8';
    ctx.beginPath(); ctx.moveTo(-6, -36); ctx.quadraticCurveTo(-60, -70, -96, -58); ctx.quadraticCurveTo(-58, -52, -24, -24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b8a47a';
    ctx.beginPath(); ctx.moveTo(14, -38); ctx.quadraticCurveTo(-30, -90, -70, -92); ctx.quadraticCurveTo(-36, -76, -4, -30); ctx.closePath(); ctx.fill();
    // 볏/가시
    ctx.fillStyle = '#240604';
    ctx.beginPath(); ctx.moveTo(-30, -8); ctx.lineTo(-60, 4); ctx.lineTo(-28, 12); ctx.fill();
    // 눈
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 36, -22, 18, [[0, 'rgba(255,255,180,1)'], [0.35, 'rgba(255,200,40,0.8)'], [1, 'rgba(255,80,0,0)']]);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#1a0200';
    ctx.fillRect(35, -27, 2.5, 10);
    // 콧김
    ctx.fillStyle = 'rgba(255,140,60,0.5)';
    ctx.beginPath(); ctx.arc(104, -6, 3, 0, TAU); ctx.fill();
    ctx.restore();

    // 앞다리
    ctx.fillStyle = '#6a150e';
    ctx.beginPath(); ctx.ellipse(90, 50, 30, 20, 0.8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(84, 60); ctx.lineTo(118, 104); ctx.lineTo(136, 96); ctx.lineTo(104, 52); ctx.fill();
    ctx.fillStyle = '#efe0c0';
    for (var fc = 0; fc < 3; fc++) { ctx.beginPath(); ctx.moveTo(118 + fc * 8, 100); ctx.lineTo(128 + fc * 8, 114); ctx.lineTo(130 + fc * 8, 98); ctx.fill(); }

    // 가까운 날개
    drawWing(ctx, t, false);
  }

  // 용 입 위치 (월드 좌표, 시각용)
  function drMouth(fx, t, sc) {
    var br = breathing(t);
    var hA = br ? 0.55 : 0.2;
    var hx = 300, hy = 40 + (br ? 40 : 0);
    var mx = hx + Math.cos(hA) * 100 - Math.sin(hA) * 10, my = hy + Math.sin(hA) * 100 + Math.cos(hA) * 10;
    return { x: drX(fx, t) + fx.dir * mx * sc, y: drBodyY(fx, t) + my * sc };
  }

  function drRender(fx, ctx) {
    var t = fx.t, g0 = gy(), sc = drScale();
    var i;
    ctx.save();
    // 땅에 남는 불길
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < fx.fires.length; i++) {
      var f = fx.fires[i], age = (t - f.t0) / 1.7;
      var hgt = (60 + 50 * Math.sin(f.p + t * 14)) * f.s * (1 - age);
      var fw = 26 * f.s;
      var lg = ctx.createLinearGradient(f.x, g0, f.x, g0 - hgt);
      lg.addColorStop(0, 'rgba(255,240,180,' + (0.8 * (1 - age)) + ')');
      lg.addColorStop(0.4, 'rgba(255,130,30,' + (0.6 * (1 - age)) + ')');
      lg.addColorStop(1, 'rgba(200,30,0,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(f.x - fw, g0);
      ctx.quadraticCurveTo(f.x - fw * 0.6 + Math.sin(t * 9 + f.p) * 6, g0 - hgt * 0.6, f.x + Math.sin(t * 11 + f.p) * 8, g0 - hgt);
      ctx.quadraticCurveTo(f.x + fw * 0.6, g0 - hgt * 0.5, f.x + fw, g0);
      ctx.closePath();
      ctx.fill();
    }
    if (fx.fires.length) {
      // 그을린 바닥 띠
      var minX = Infinity, maxX = -Infinity;
      for (i = 0; i < fx.fires.length; i++) { minX = Math.min(minX, fx.fires[i].x); maxX = Math.max(maxX, fx.fires[i].x); }
      ctx.fillStyle = 'rgba(255,90,20,0.18)';
      ctx.fillRect(minX - 30, g0 - 6, maxX - minX + 60, 8);
    }
    ctx.globalCompositeOperation = 'source-over';

    if (t < DR_LIFE) {
      var dx = drX(fx, t), dy = drBodyY(fx, t);
      // 그림자
      var hk = clamp(1 - (g0 - dy) / (viewH() * 1.4), 0.1, 1);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * hk) + ')';
      ctx.beginPath(); ctx.ellipse(dx, g0 + 4, 380 * sc * hk + 60, 20, 0, 0, TAU); ctx.fill();

      // 화염 브레스 (입 → 판정 영역의 지면)
      if (breathing(t)) {
        var mo = drMouth(fx, t, sc);
        var hx = dx + fx.dir * DR_HIT_OFF;
        var k = Math.min(1, (t - DR_B0) / 0.12) * Math.min(1, (DR_B1 - t) / 0.12 + 0.001);
        ctx.globalCompositeOperation = 'lighter';
        for (var layer = 0; layer < 3; layer++) {
          var spread = DR_W * (0.5 + layer * 0.28);
          var cg = ctx.createLinearGradient(mo.x, mo.y, hx, g0);
          var al = k * (0.75 - layer * 0.18);
          cg.addColorStop(0, 'rgba(255,255,230,' + al + ')');
          cg.addColorStop(0.35, 'rgba(255,200,70,' + al + ')');
          cg.addColorStop(0.75, 'rgba(255,90,20,' + al * 0.9 + ')');
          cg.addColorStop(1, 'rgba(190,20,0,' + al * 0.5 + ')');
          ctx.fillStyle = cg;
          ctx.beginPath();
          var wob = Math.sin(t * 30 + layer) * 10;
          ctx.moveTo(mo.x - 8, mo.y);
          ctx.quadraticCurveTo(lerp(mo.x, hx, 0.5) - spread * 0.3 + wob, lerp(mo.y, g0, 0.55), hx - spread / 2, g0 + 4);
          ctx.lineTo(hx + spread / 2, g0 + 4);
          ctx.quadraticCurveTo(lerp(mo.x, hx, 0.5) + spread * 0.3 - wob, lerp(mo.y, g0, 0.45), mo.x + 8, mo.y);
          ctx.closePath();
          ctx.fill();
        }
        // 화염 덩어리
        for (var bl = 0; bl < 14; bl++) {
          var u = ((bl / 14) + t * 2.6) % 1;
          var bx = lerp(mo.x, hx + (hash(bl) - 0.5) * DR_W * 0.8, u) + Math.sin(t * 20 + bl) * 8;
          var by = lerp(mo.y, g0 - 10, u);
          glow(ctx, bx, by, 18 + u * 46, [[0, 'rgba(255,250,200,' + (0.7 * k) + ')'], [0.5, 'rgba(255,140,30,' + (0.4 * k) + ')'], [1, 'rgba(200,30,0,0)']]);
        }
        // 지면 충돌 섬광
        glow(ctx, hx, g0 - 10, DR_W * 0.9, [[0, 'rgba(255,255,210,' + (0.8 * k) + ')'], [0.35, 'rgba(255,150,40,' + (0.5 * k) + ')'], [1, 'rgba(220,40,0,0)']]);
        ctx.globalCompositeOperation = 'source-over';
      }

      // 용 몸체
      ctx.save();
      ctx.translate(dx, dy);
      ctx.scale(fx.dir * sc, sc);
      // 몸 주변 열기 오라
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 0, 0, 360, [[0, 'rgba(255,90,20,0.2)'], [1, 'rgba(255,40,0,0)']]);
      ctx.globalCompositeOperation = 'source-over';
      drawDragon(ctx, fx, t);
      ctx.restore();
    }

    // 화면 전체 열기 톤
    var tone = t < DR_LIFE ? Math.min(1, t / 0.3) * Math.min(1, (DR_LIFE - t) / 0.4 + 0.2) : 0;
    if (tone > 0) {
      var sr = screenRect(120);
      ctx.fillStyle = 'rgba(255,80,20,' + (0.09 * tone) + ')';
      ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
    }
    ctx.restore();
  }

  S.register({
    id: 'dragonsummon', element: 'dragon', elementName: '용족', name: '용족 소환', icon: '🐉',
    rarity: 'hard', cost: 90, cooldown: 25, color: DR_COL,
    desc: '거대한 용을 불러 맵을 가로지르며 땅 위를 화염 브레스로 불태웁니다.',
    cast: function (ctx) {
      var p = ctx.p, f = ctx.facing || 1;
      var cx = p ? ctx.x + p.w / 2 : ctx.x;   // 시전 시점 x + facing 으로 결정적인 경로
      S.addFx({
        skill: 'dragonsummon', owner: ctx.owner, castId: ctx.castId, casterId: ctx.casterId,
        x: cx, y: gy(), sx: cx - f * DR_START, dir: f,
        t: 0, life: DR_FX_LIFE, rehit: 0.25,
        fires: [], fireAcc: 0,
        update: drUpdate, render: drRender
      });
      shake(12);
      if (typeof G.toast === 'function') G.toast(ctx.owner === 'local' ? '용족 소환!' : (whoName(ctx) ? whoName(ctx) + '용을 불렀다!' : '용이 나타났다!'));
    }
  });
})();
