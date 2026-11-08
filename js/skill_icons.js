/* 초능력자: 각성 — 스킬 버튼 SVG 아이콘 (Game.SkillIcons)
 * 이모지 대신 선 아이콘(24×24, currentColor). 스킬 id → 모양, 없으면 원소 → 모양, 그것도 없으면 null(이모지 사용).
 */
(function () {
  'use strict';
  var G = window.Game = window.Game || {};

  var F = ' fill="currentColor" fill-opacity=".28"';   // 반투명 채움
  var FS = ' fill="currentColor" stroke="none"';      // 꽉 채움

  // ---- 모양 (viewBox 0 0 24 24) ----
  var GLYPH = {
    flame: '<path' + F + ' d="M12 2c1 4 5.5 6 5.5 11.5a5.5 5.5 0 0 1-11 0C6.5 10 9 9 9 5.5c2 1.3 3 3.3 3 5.5 1.2-2.3 1.2-5.5 0-9z"/><path d="M12 21a2.5 2.5 0 0 1-2.5-2.5c0-1.8 1.5-2.5 2.5-4.5 1 2 2.5 2.7 2.5 4.5A2.5 2.5 0 0 1 12 21z"/>',
    fireball: '<circle' + F + ' cx="15" cy="12" r="5"/><path d="M10 9H3M11 12H2M10 15H4"/><path d="M15 9.5a2.5 2.5 0 0 1 0 5"/>',
    dash: '<path d="M3 8h8M2 12h11M3 16h8"/><path' + F + ' d="M14 5l7 7-7 7z"/>',
    pillar: '<path' + F + ' d="M8 22V10h8v12z"/><path d="M6 22h12"/><path d="M12 2c.8 2 3 3 3 5.5a3 3 0 0 1-6 0C9 6 10 5.5 10 4c1 .6 1.6 1.4 2 2.5.4-1.5.4-3 0-4.5z"/>',
    burst: '<path' + F + ' d="M12 1.5l2.2 5.6 5.8-2-3.2 5.3 5.2 3.4-6 .8.8 6.2L12 16.7 7.2 20.8 8 14.6l-6-.8 5.2-3.4L4 5.1l5.8 2z"/><circle cx="12" cy="12" r="2.2"/>',
    drop: '<path' + F + ' d="M12 2.5C8.5 8 6 11 6 15a6 6 0 0 0 12 0c0-4-2.5-7-6-12.5z"/><path d="M9.5 15.5a2.5 2.5 0 0 0 2.5 2.5"/>',
    bubble: '<circle' + F + ' cx="10" cy="13" r="6"/><circle cx="17.5" cy="6.5" r="3"/><circle cx="19" cy="15" r="1.6"/><path d="M7.5 11a3 3 0 0 1 2.5-2"/>',
    vortex: '<path d="M12 12.5a1 1 0 1 1 1-1 2.6 2.6 0 0 1-2.6 2.6A3.9 3.9 0 0 1 6.5 10.2 5.4 5.4 0 0 1 11.9 4.8a7 7 0 0 1 7 7 8.4 8.4 0 0 1-8.4 8.4"/>',
    wave: '<path' + F + ' d="M2 15c2-5 6-8 11-8 3 0 5 1.5 6 3.5-2.5-1-5 0-5 2.5 0 2 2 3 4 2.5L22 15v6H2z"/>',
    leaf: '<path' + F + ' d="M4.5 19.5C4.5 9.5 10.5 4 20 4c0 9.5-5.5 15.5-15.5 15.5z"/><path d="M4.5 19.5l9.5-9.5M10 14h4M10 14v-4"/>',
    boomerang: '<path' + F + ' d="M4 4c6 1 11 5 12 12l4 4c-2-9-7-15-16-16z"/><path d="M4 4c1 6 5 11 12 12"/>',
    flower: '<circle cx="12" cy="7" r="3"/><circle cx="7.5" cy="10.5" r="3"/><circle cx="16.5" cy="10.5" r="3"/><circle cx="9.5" cy="15.5" r="3"/><circle cx="14.5" cy="15.5" r="3"/><circle' + FS + ' cx="12" cy="11.6" r="2"/>',
    thorns: '<path' + F + ' d="M12 2l6 8h-3.5l5 7H4.5l5-7H6z"/><path d="M12 17v5M8 22h8"/>',
    vine: '<path d="M4 20c2-7 6-7 6-11S7 4 12 3c5 1 2 5 2 8s4 4 6 9"/><path' + F + ' d="M6.5 13.5c-2 0-3-1.5-3-3 2 0 3 1.3 3 3zM17.5 13c2 0 3-1.5 3-3-2 0-3 1.3-3 3z"/>',
    bolt: '<path' + F + ' d="M13.5 2L4.5 14h6.5L10 22l9.5-12.5H13z"/>',
    chain: '<path' + F + ' d="M9 2L4 11h4l-1.5 6L12 9H8.5z"/><path' + F + ' d="M17 7l-3.5 6h3l-1 5 4.5-6.5h-3z"/>',
    spark: '<path' + F + ' d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z"/><path d="M19 3l.7 2.3L22 6l-2.3.7L19 9l-.7-2.3L16 6l2.3-.7z"/>',
    blink: '<path' + F + ' d="M11 3L5 12h4.5L8 21l7-10h-4.5L12 3z"/><path d="M15 5h5M16 9h5M17 13h4" stroke-dasharray="2 2"/>',
    storm: '<path' + F + ' d="M7 14a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 6.5a3.8 3.8 0 0 1-.5 7.5z"/><path d="M12 14l-2.5 4H13l-2 4"/>',
    snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5M3.6 10.4L7 9.4 6 6M20.4 13.6L17 14.6l1 3.4M3.6 13.6L7 14.6l-1 3.4M20.4 10.4L17 9.4l1-3.4"/>',
    shard: '<path' + F + ' d="M3 21l4-9 12-10-3 12z"/><path d="M7 12l9 2M3 21l13-7"/>',
    icewall: '<path' + F + ' d="M4 21V9l3-3 3 3 2-4 3 4 3-3 2 3v12z"/><path d="M4 15h16M9 9v12M15 9v12"/>',
    nova: '<path' + F + ' d="M12 3l3 6 6 3-6 3-3 6-3-6-6-3 6-3z"/><circle cx="12" cy="12" r="10" stroke-dasharray="2.5 3"/>',
    blizzard: '<path' + F + ' d="M7 12a4 4 0 0 1-.3-8A5.5 5.5 0 0 1 17 5.5a3.4 3.4 0 0 1-.4 6.5z"/><path d="M7 15.5h.01M11 15h.01M15 15.5h.01M9 19h.01M13 19.5h.01M17 19h.01M5 19.5h.01" stroke-width="2.6"/>',
    tornado: '<path d="M3 4h18M5 8h14M7.5 12h11M9.5 16h7M11 20h3.5"/>',
    windslash: '<path d="M3 17C8 17 15 13 19 4M6 20c5-1 10-5 13-11"/><path' + F + ' d="M19 4l2 4-4 .5z"/>',
    feather: '<path' + F + ' d="M20 3C11 3 6 9 6 18l3-3c6 0 10-5 11-12z"/><path d="M4 21L14 10"/><path d="M12 22h8M15 18h6" stroke-dasharray="2 2"/>',
    gale: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8a2.5 2.5 0 1 1-2.5 2.5"/>',
    rock: '<path' + F + ' d="M4 17.5l2.5-8L12 5l6.5 3 2 8.5-7 3.5z"/><path d="M6.5 9.5l5.5 3 6.5-4.5M12 12.5V20"/>',
    spike: '<path' + F + ' d="M2 21l4.5-11 3 6 3-13 3.5 10 2-4L22 21z"/>',
    pebble: '<ellipse' + F + ' cx="14" cy="13" rx="6" ry="4.5"/><path d="M2 8h5M3 12h3M2 16h4"/>',
    brick: '<path' + F + ' d="M3 5h18v15H3z"/><path d="M3 10h18M3 15h18M9 5v5M15 5v5M6 10v5M12 10v5M18 10v5M9 15v5M15 15v5"/>',
    quake: '<path d="M2 19h20"/><path' + F + ' d="M4 19l3-6 3 3 2-8 2 6 3-3 3 8z"/><path d="M12 19l-1 3M8 19l1 3M16 19l-1 3"/>',
    sand: '<path d="M2 18c3-2 5-2 8 0s5 2 8 0 3-1 4-1M2 13c3-2 5-2 8 0s5 2 8 0"/><circle' + FS + ' cx="7" cy="7" r="1.3"/><circle' + FS + ' cx="13" cy="5" r="1.1"/><circle' + FS + ' cx="18" cy="8" r="1.3"/>',
    snake: '<path d="M4 20c6 0 6-6 2-6s-4-6 2-6h7c3 0 3-4 0-4"/><circle' + FS + ' cx="16.5" cy="4" r="1.6"/>',
    pit: '<ellipse' + F + ' cx="12" cy="7" rx="9" ry="3"/><path d="M3 7l7 13h4l7-13M7 10.5c3 1 7 1 10 0M9 14.5c2 .6 4 .6 6 0"/>',
    fist: '<path' + F + ' d="M6.5 11V7.5a1.8 1.8 0 0 1 3.6 0V10V6.5a1.8 1.8 0 0 1 3.6 0V10V7.5a1.8 1.8 0 0 1 3.6 0v6A7 7 0 0 1 10.3 20.5h-.5A5.5 5.5 0 0 1 4.3 15v-2a2 2 0 0 1 2.2-2z"/>',
    muscle: '<path' + F + ' d="M4 19c0-6 1-11 4-14l3 1-1 3 3 2c3-1 6 0 7 3 1 4-2 6-6 6-3 0-4-1-6-1z"/>',
    charge: '<path' + F + ' d="M4 15c0-5 4-8 9-8h3l2-3 1 4c2 1 3 3 3 5v3H4z"/><path d="M2 10h3M1 14h2"/><circle' + FS + ' cx="18" cy="11" r="1"/>',
    meteor: '<circle' + F + ' cx="16" cy="16" r="5"/><path d="M12.5 12.5L3 3M15 10.5L8 2M10.5 15L2 8"/>',
    eye: '<path' + F + ' d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><circle' + FS + ' cx="12" cy="12" r="1.2"/>',
    orb: '<circle' + F + ' cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="9.5" stroke-dasharray="3 3"/><path d="M9.5 10a3 3 0 0 1 2.5-2"/>',
    levitate: '<circle cx="12" cy="5" r="2.5"/><path d="M12 8v6M8 11l4-1.5 4 1.5M9.5 20l2.5-6 2.5 6"/><ellipse cx="12" cy="21.5" rx="7" ry="1.3" stroke-dasharray="2 2"/>',
    hole: '<ellipse' + F + ' cx="12" cy="12" rx="10.5" ry="3.8"/><circle' + FS + ' cx="12" cy="12" r="4.5"/><path d="M5 9.5C6.5 5 17.5 5 19 9.5"/>',
    phase: '<circle cx="8" cy="12" r="5" stroke-dasharray="2.5 2.5"/><circle' + F + ' cx="16" cy="12" r="5"/>',
    well: '<circle' + F + ' cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="6"/><circle' + FS + ' cx="12" cy="12" r="2.5"/>',
    hourglass: '<path d="M6 2h12M6 22h12"/><path' + F + ' d="M7 2c0 6 10 6 10 10S7 16 7 22h10c0-6-10-6-10-10S17 8 17 2z"/>',
    clock: '<circle' + F + ' cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2.5"/>',
    arrowclock: '<circle cx="9" cy="12" r="6"/><path d="M9 8.5V12l2 1.5"/><path' + F + ' d="M15 12h5l-2-2.5M20 12l-2 2.5"/>',
    rewind: '<path' + F + ' d="M11 5.5L3.5 12 11 18.5zM20.5 5.5L13 12l7.5 6.5z"/>',
    hands: '<circle cx="12" cy="12" r="9.5" stroke-dasharray="2 2.4"/><path d="M12 12L18 4.5M12 12l-4 3"/><path' + F + ' d="M12 12L18 4.5C21 8 21 13 19 16z"/>',
    dragon: '<path' + F + ' d="M3 13c2-5 6-8 11-8l3-3 1 4 4 1-3 3c0 5-4 9-9 9l-2 3-1-4-4-1z"/><circle' + FS + ' cx="15" cy="9" r="1.2"/>',
    claw: '<path d="M5 3c3.5 5 3.5 13 0 18M12 3c3.5 5 3.5 13 0 18M19 3c3.5 5 3.5 13 0 18"/>',
    wing: '<path' + F + ' d="M2 18C6 8 13 4 22 4c-2 4-4 6-8 7 3 0 5 1 6 2-5 2-9 3-18 5z"/>',
    breath: '<path' + F + ' d="M2 9l5-3 3 3-3 2 2 2-5 2z"/><path d="M11 9c3 0 5-2 9-2M11 12h11M11 15c3 0 5 2 9 2"/>',
    drone: '<path' + F + ' d="M8 11h8l-1.5 4h-5z"/><path d="M12 11V8M3 7h6M15 7h6M6 7v2M18 7v2M10.5 18l-1 2.5M13.5 18l1 2.5"/>',
    wolf: '<path' + F + ' d="M4 3l4 5h8l4-5v9l-8 9-8-9z"/><circle' + FS + ' cx="9.3" cy="12" r="1.2"/><circle' + FS + ' cx="14.7" cy="12" r="1.2"/><path d="M10.5 16.5L12 18l1.5-1.5"/>',
    golem: '<path' + F + ' d="M6 3h12v8H6z"/><path d="M4 21v-6l3-4h10l3 4v6M9 21v-5h6v5"/><path d="M9 7h.01M15 7h.01" stroke-width="2.8"/>',
    titan: '<circle cx="12" cy="4.5" r="2.5"/><path' + F + ' d="M7 9h10l1.5 6-2.5 1V22H8v-6l-2.5-1z"/><path d="M3 12l4-3M21 12l-4-3"/>',
    shield: '<path' + F + ' d="M12 2l8 3v6.5c0 5-3.5 8.5-8 10.5-4.5-2-8-5.5-8-10.5V5z"/>',
    shieldbash: '<path' + F + ' d="M10 3l6 2.3v5c0 3.8-2.6 6.5-6 8-3.4-1.5-6-4.2-6-8v-5z"/><path d="M18 8l3-2M19 12h3M18 16l3 2"/>',
    reflect: '<path d="M12 2v20"/><path' + F + ' d="M12 4l7 3v10l-7 3z"/><path d="M3 8l6 4-6 4"/>',
    dome: '<path' + F + ' d="M3 19a9 9 0 0 1 18 0z"/><path d="M1.5 19h21M12 10v9M7 13l5 6 5-6"/>',
    fortress: '<path' + F + ' d="M4 21V9h3V6h3v3h4V6h3v3h3v12z"/><path d="M10 21v-5h4v5"/>',
    steelfist: '<path' + F + ' d="M6.5 11V7.5a1.8 1.8 0 0 1 3.6 0V10V6.5a1.8 1.8 0 0 1 3.6 0V10V7.5a1.8 1.8 0 0 1 3.6 0v6A7 7 0 0 1 10.3 20.5h-.5A5.5 5.5 0 0 1 4.3 15v-2a2 2 0 0 1 2.2-2z"/><path d="M8 15h7M9 18h5"/>',
    plate: '<path' + F + ' d="M12 2l8 3v6.5c0 5-3.5 8.5-8 10.5-4.5-2-8-5.5-8-10.5V5z"/><path d="M8 7h.01M16 7h.01M8 15h.01M16 15h.01M12 6v12" stroke-width="2.4"/>',
    rail: '<path d="M2 17h20M2 21h20M5 17v4M10 17v4M15 17v4M20 17v4"/><path' + F + ' d="M4 14V7h11l5 4v3z"/>',
    girder: '<path' + F + ' d="M3 3h18v3h-7.5v12H21v3H3v-3h7.5V6H3z"/>',
    ghost: '<path' + F + ' d="M5 21.5V10a7 7 0 0 1 14 0v11.5l-2.4-2-2.3 2-2.3-2-2.3 2-2.3-2z"/><circle' + FS + ' cx="9.5" cy="10.5" r="1.4"/><circle' + FS + ' cx="14.5" cy="10.5" r="1.4"/>',
    wisp: '<path' + F + ' d="M12 21a5 5 0 0 1-5-5c0-4 5-6 4-12 4 2 6 6 6 12a5 5 0 0 1-5 5z"/><circle cx="12" cy="16" r="1.8"/>',
    phantom: '<path d="M5 21V11a7 7 0 0 1 14 0v10" stroke-dasharray="2.5 2.2"/><circle cx="9.5" cy="11" r="1.2"/><circle cx="14.5" cy="11" r="1.2"/>',
    possess: '<circle' + F + ' cx="12" cy="7" r="4"/><path d="M4 22c0-5 3.5-8 8-8s8 3 8 8"/><path d="M19 3l3 2-3 2" />',
    wail: '<path' + F + ' d="M7 21V11a5 5 0 0 1 10 0v10l-1.7-1.5-1.6 1.5-1.7-1.5-1.6 1.5-1.7-1.5z"/><ellipse' + FS + ' cx="12" cy="14" rx="1.6" ry="2.2"/><path d="M2.5 8a10 10 0 0 1 2.5-4M21.5 8A10 10 0 0 0 19 4M1 13h2M21 13h2"/>',
    scythe: '<path d="M5 22L14 3"/><path' + F + ' d="M14 3c4.5-.5 8 2.5 8.5 7.5-3-3.5-6.5-4.5-10-3.6z"/><circle cx="9.5" cy="12.5" r="1.6"/>',
    spinslash: '<path d="M12 3a9 9 0 1 1-8.5 6"/><path' + F + ' d="M3.5 9L2 4l5 2.5z"/><path d="M12 12l5-5"/><path' + F + ' d="M17 7c2-.3 3.5 1 3.7 3-1.3-1.4-2.7-1.8-4.2-1.4z"/>',
    rift: '<path' + F + ' d="M12 2l-3 6 4 3-4 4 3 7 1-6-3-3 4-4z"/><circle cx="12" cy="12" r="9.5" stroke-dasharray="1.5 3"/>',
    reap: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6v6l3.5 2"/><path' + F + ' d="M2 20C7 20 16 15 21 3c1 8-5 16-19 17z"/>'
  };

  // ---- 스킬 id → 모양 ----
  var MAP = {
    fireball: 'fireball', flamedash: 'dash', pillar: 'pillar', inferno: 'burst',
    watercannon: 'drop', water_bubble: 'bubble', water_whirlpool: 'vortex', water_tsunami: 'wave',
    vinebind: 'vine', grass_leaf: 'boomerang', grass_bloom: 'flower', grass_thorns: 'thorns',
    chainbolt: 'chain', elec_spark: 'spark', elec_blink: 'blink', elec_storm: 'storm',
    iceshard: 'shard', ice_wall: 'icewall', ice_nova: 'nova', ice_blizzard: 'blizzard',
    tornado: 'tornado', wind_slash: 'windslash', wind_updraft: 'feather', wind_gale: 'gale',
    rockspike: 'spike', rock_pebble: 'pebble', rock_wall: 'brick', rock_quake: 'quake',
    sandstorm: 'sand', sand_blast: 'sand', sand_dash: 'snake', sand_pit: 'pit',
    bodyboost: 'muscle', body_jab: 'fist', body_tackle: 'charge', body_meteor: 'meteor',
    psychograb: 'eye', psy_bolt: 'orb', psy_levitate: 'levitate', psy_storm: 'vortex',
    blackhole: 'hole', void_orb: 'orb', void_phase: 'phase', void_well: 'well',
    timestop: 'hourglass', time_bolt: 'arrowclock', time_rewind: 'rewind', time_hands: 'hands',
    dragonsummon: 'dragon', dragon_claw: 'claw', dragon_wing: 'wing', dragon_breath: 'breath',
    sum_drone: 'drone', sum_wolf: 'wolf', sum_golem: 'golem', sum_guardian: 'titan',
    steel_fist: 'steelfist', steel_skin: 'plate', steel_rail: 'rail', steel_girder: 'girder',
    shield_bash: 'shieldbash', shield_reflect: 'reflect', shield_dome: 'dome', shield_fortress: 'fortress',
    ghost_orb: 'wisp', ghost_phase: 'phantom', ghost_possess: 'possess', ghost_wail: 'wail',
    scythe_slash: 'scythe', scythe_spin: 'spinslash', scythe_rift: 'rift', scythe_reap: 'reap'
  };
  // 원소 → 모양 (새 기술 대비)
  var ELEMENT = {
    fire: 'flame', water: 'drop', grass: 'leaf', electric: 'bolt', ice: 'snow', wind: 'tornado',
    rock: 'rock', sand: 'sand', body: 'fist', psychic: 'eye', void: 'hole', time: 'clock',
    dragon: 'dragon', summon: 'titan', steel: 'plate', shield: 'shield', ghost: 'ghost', scythe: 'scythe'
  };

  function glyphFor(id, element) {
    if (id && MAP[id] && GLYPH[MAP[id]]) return GLYPH[MAP[id]];
    if (element && ELEMENT[element]) return GLYPH[ELEMENT[element]];
    return null;
  }

  G.SkillIcons = {
    // SVG 문자열 (모르는 기술이면 null → 호출측이 이모지 사용)
    svg: function (id, element) {
      var g = glyphFor(id, element);
      if (!g) return null;
      return '<svg class="sk-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + g + '</svg>';
    },
    has: function (id, element) { return !!glyphFor(id, element); },
    glyphs: GLYPH,
    map: MAP
  };
})();
