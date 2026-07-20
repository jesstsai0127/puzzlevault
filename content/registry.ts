import { parseCharacterDef, parseMapDef, parseMonsterDef, parseSkillDef } from '../core/content';
import type { ContentRegistry } from '../core/battle/types';
import type { MapDef } from '../core/content/types';

import swordQi from './skills/sword_qi.json';
import palmWave from './skills/palm_wave.json';
import flyingSword from './skills/flying_sword.json';
import qiShield from './skills/qi_shield.json';
import ghostClaw from './skills/ghost_claw.json';
import corpseSmash from './skills/corpse_smash.json';
import spiritBolt from './skills/spirit_bolt.json';
import vineLash from './skills/vine_lash.json';
import wolfBite from './skills/wolf_bite.json';
import minorHeal from './skills/minor_heal.json';
import majorHeal from './skills/major_heal.json';
import heavyShield from './skills/heavy_shield.json';
import tauntSkill from './skills/taunt.json';
import swordTempest from './skills/sword_tempest.json';
import swordRampage from './skills/sword_rampage.json';
import roaringShockwave from './skills/roaring_shockwave.json';
import springRain from './skills/spring_rain.json';

import liYan from './characters/li_yan.json';
import suQing from './characters/su_qing.json';
import baiZhi from './characters/bai_zhi.json';
import lingEr from './characters/ling_er.json';

import yinGhost from './monsters/yin_ghost.json';
import jiangshi from './monsters/jiangshi.json';
import yuanLing from './monsters/yuan_ling.json';
import tengYao from './monsters/teng_yao.json';
import yaoLang from './monsters/yao_lang.json';

// Campaign missions — ITB-verified structure (2026-07-17 full content
// replacement): 4 islands × 5 missions each (m1-m4 regular, m5 the island's
// boss/HQ mission), every mission on a fixed 8×8 grid, 5 turns, a 3-person
// squad, and 4-6 monsters mixing base-threats with player-threats (A5).
// Grids reuse 5 shared templates (corridor / choke / split-base / arena /
// boss) — see design/itb-alignment-spec.md and the plan that authored these.
import island1M1 from './maps/island1_m1.json';
import island1M2 from './maps/island1_m2.json';
import island1M3 from './maps/island1_m3.json';
import island1M4 from './maps/island1_m4.json';
import island1M5 from './maps/island1_m5.json';
import island2M1 from './maps/island2_m1.json';
import island2M2 from './maps/island2_m2.json';
import island2M3 from './maps/island2_m3.json';
import island2M4 from './maps/island2_m4.json';
import island2M5 from './maps/island2_m5.json';
import island3M1 from './maps/island3_m1.json';
import island3M2 from './maps/island3_m2.json';
import island3M3 from './maps/island3_m3.json';
import island3M4 from './maps/island3_m4.json';
import island3M5 from './maps/island3_m5.json';
import island4M1 from './maps/island4_m1.json';
import island4M2 from './maps/island4_m2.json';
import island4M3 from './maps/island4_m3.json';
import island4M4 from './maps/island4_m4.json';
import island4M5 from './maps/island4_m5.json';
// The final mission — ITB's "Last Stand" decisive phase: protect a 4-HP
// objective (the sealing array standing in for ITB's Renfield Bomb) for 5
// turns under the campaign's heaviest assault. ITB's real final battle is
// TWO back-to-back phases with damage carried over; multi-phase missions
// need engine support we don't have yet, so this ships the verified,
// decisive phase-2 shape as a single mission (known gap, documented).
import finalHive from './maps/final_hive.json';

// "Lesson" levels: each is a small, real, winnable/losable MapDef (same
// turns/baseHp rules as every other map — see MapDef) that spotlights
// one mechanic, replacing the old fully-scripted TutorialDef system. They
// form the standalone tutorial sequence (LESSON_MAP_IDS below), not
// campaign content.
import lessonApCost from './maps/lesson_ap_cost.json';
import lessonOpportunityAttack from './maps/lesson_opportunity_attack.json';
import lessonPushAbyss from './maps/lesson_push_abyss.json';
import lessonHealer from './maps/lesson_healer.json';
import lessonPoisonMist from './maps/lesson_poison_mist.json';

// Builtin content goes through the same parse+validate path that downloaded
// content packs will use in Phase 2 — one format, one code path.
const skills = [
  swordQi,
  palmWave,
  flyingSword,
  qiShield,
  ghostClaw,
  corpseSmash,
  spiritBolt,
  vineLash,
  wolfBite,
  minorHeal,
  majorHeal,
  heavyShield,
  tauntSkill,
  swordTempest,
  swordRampage,
  roaringShockwave,
  springRain,
].map(parseSkillDef);
const characters = [liYan, suQing, baiZhi, lingEr].map(parseCharacterDef);
const monsters = [yinGhost, jiangshi, yuanLing, tengYao, yaoLang].map(parseMonsterDef);

export const registry: ContentRegistry = {
  characters: Object.fromEntries(characters.map((c) => [c.id, c])),
  skills: Object.fromEntries(skills.map((s) => [s.id, s])),
  monsters: Object.fromEntries(monsters.map((m) => [m.id, m])),
};

// Each playable level is its own map file. Campaign missions use the
// island{N}_m{M} convention (island 1-4, mission 1-5, m5 = that island's
// boss); the lesson_* entries are the standalone tutorial sequence.
export const maps: Record<string, MapDef> = {
  island1_m1: parseMapDef(island1M1),
  island1_m2: parseMapDef(island1M2),
  island1_m3: parseMapDef(island1M3),
  island1_m4: parseMapDef(island1M4),
  island1_m5: parseMapDef(island1M5),
  island2_m1: parseMapDef(island2M1),
  island2_m2: parseMapDef(island2M2),
  island2_m3: parseMapDef(island2M3),
  island2_m4: parseMapDef(island2M4),
  island2_m5: parseMapDef(island2M5),
  island3_m1: parseMapDef(island3M1),
  island3_m2: parseMapDef(island3M2),
  island3_m3: parseMapDef(island3M3),
  island3_m4: parseMapDef(island3M4),
  island3_m5: parseMapDef(island3M5),
  island4_m1: parseMapDef(island4M1),
  island4_m2: parseMapDef(island4M2),
  island4_m3: parseMapDef(island4M3),
  island4_m4: parseMapDef(island4M4),
  island4_m5: parseMapDef(island4M5),
  final_hive: parseMapDef(finalHive),
  lesson_ap_cost: parseMapDef(lessonApCost),
  lesson_opportunity_attack: parseMapDef(lessonOpportunityAttack),
  lesson_push_abyss: parseMapDef(lessonPushAbyss),
  lesson_healer: parseMapDef(lessonHealer),
  lesson_poison_mist: parseMapDef(lessonPoisonMist),
};

export const DEFAULT_MAP_ID = 'island1_m1';

/**
 * ITB alignment (2026-07-17): Into the Breach has no per-world tutorial
 * levels mixed into its mission list — it has one standalone "Combat
 * Simulation" outside the campaign, walked through once, teaching core
 * controls before real missions start. These 5 ids are exactly that content
 * (move/act economy, positioning, pushing, healer usage, poison terrain),
 * now played as the ORDERED SEQUENCE for that standalone tutorial flow (see
 * levelNav.ts's tutorialStepUrl / LevelSelectScene's tutorial entry point)
 * instead of appearing as separately-numbered slots in WORLD_STRUCTURE.
 * They remain real, individually-playable MapDefs in `maps` above — nothing
 * here is gated/locked, and autoplay-harness/tests can still address any one
 * of them directly by id.
 */
export const LESSON_MAP_IDS: string[] = [
  'lesson_ap_cost',
  'lesson_opportunity_attack',
  'lesson_push_abyss',
  'lesson_healer',
  'lesson_poison_mist',
];

/**
 * World structure — the campaign's 4 islands × 5 missions, ITB's verified
 * shape (full content replacement, 2026-07-17). This is a pure
 * UI/organization concern layered on top of `maps` — not part of
 * MapDef/format.ts, so it doesn't touch battle-content validation.
 *
 * `mapId` is the real key into `maps` (what autoplay-harness, BattleScene,
 * etc. address a level by). `label` is the player-facing sequence label
 * shown on the level-select screen ("2-1".."2-5") — purely cosmetic, never
 * used to look anything up. `isLesson` is retained for LevelSelectScene's
 * green lesson styling but is false for every campaign mission — the old
 * per-world lesson levels were replaced by this structure (basic-controls
 * teaching lives in the standalone tutorial, LESSON_MAP_IDS above).
 */
export interface WorldLevelEntry {
  /** Real key into `maps` — what every other system (BattleScene, autoplay-harness) addresses this level by. */
  mapId: string;
  /** Player-facing in-world sequence label shown on the level-select screen, e.g. "2-1". Cosmetic only. */
  label: string;
  /** Whether LevelSelectScene should render this entry with the small-lesson visual treatment (green tint / 【小關】 prefix). False for every campaign mission. */
  isLesson: boolean;
}

export interface WorldDef {
  /** i18n key for this world's display name, e.g. 'world.1.name'. */
  worldNameKey: string;
  /** This world's 5 missions in play order: m1-m4 regular, m5 the island boss. */
  levels: WorldLevelEntry[];
}

function islandLevels(island: number): WorldLevelEntry[] {
  return [1, 2, 3, 4, 5].map((m) => ({
    mapId: `island${island}_m${m}`,
    label: `${island}-${m}`,
    isLesson: false,
  }));
}

export const WORLD_STRUCTURE: WorldDef[] = [
  { worldNameKey: 'world.1.name', levels: islandLevels(1) },
  { worldNameKey: 'world.2.name', levels: islandLevels(2) },
  { worldNameKey: 'world.3.name', levels: islandLevels(3) },
  { worldNameKey: 'world.4.name', levels: islandLevels(4) },
  // The final battle — outside the island numbering, matching ITB's Volcanic
  // Hive sitting apart from the 4 corporate islands.
  {
    worldNameKey: 'world.final.name',
    levels: [{ mapId: 'final_hive', label: 'F', isLesson: false }],
  },
];

/**
 * Default squad for maps that don't set squadCharacterIds — the 2-person
 * pairing every lesson_* tutorial map is built around. Campaign missions all
 * declare their own 3-person squadCharacterIds explicitly (MapDef requires
 * it whenever playerStarts.length differs from this default's length).
 */
export const STARTING_SQUAD = ['li_yan', 'su_qing'];
