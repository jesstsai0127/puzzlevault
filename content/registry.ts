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

import liYan from './characters/li_yan.json';
import suQing from './characters/su_qing.json';
import baiZhi from './characters/bai_zhi.json';
import lingEr from './characters/ling_er.json';

import yinGhost from './monsters/yin_ghost.json';
import jiangshi from './monsters/jiangshi.json';
import yuanLing from './monsters/yuan_ling.json';
import tengYao from './monsters/teng_yao.json';
import yaoLang from './monsters/yao_lang.json';

import yanwuGround from './maps/yanwu_ground.json';
import yanwuGroundEasy from './maps/yanwu_ground_easy.json';
import yanwuGroundHard from './maps/yanwu_ground_hard.json';
import demo2Pincer from './maps/demo2_pincer.json';
import demo3WolfWoods from './maps/demo3_wolf_woods.json';
import demo4MistHollow from './maps/demo4_mist_hollow.json';

// "Lesson" levels: each is a small, real, winnable/losable MapDef (same
// waves/turns/baseHp rules as every other map — see MapDef) that spotlights
// one mechanic, replacing the old fully-scripted TutorialDef system. See
// design/roadmap.md and LESSON_MAP_IDS below for how LevelSelectScene marks
// these apart from a finale-style demo map.
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
].map(parseSkillDef);
const characters = [liYan, suQing, baiZhi, lingEr].map(parseCharacterDef);
const monsters = [yinGhost, jiangshi, yuanLing, tengYao, yaoLang].map(parseMonsterDef);

export const registry: ContentRegistry = {
  characters: Object.fromEntries(characters.map((c) => [c.id, c])),
  skills: Object.fromEntries(skills.map((s) => [s.id, s])),
  monsters: Object.fromEntries(monsters.map((m) => [m.id, m])),
};

export const yanwuGroundMap = parseMapDef(yanwuGround);

// Each playable level is its own map file — demo1 (yanwu_ground) is the
// baseline control; demo2/demo3 test one mechanic apiece so different
// playtesters can be pointed at different levels without their feedback
// tangling together (see design/roadmap.md ch.5).
export const maps: Record<string, MapDef> = {
  demo1: yanwuGroundMap,
  yanwu_ground_easy: parseMapDef(yanwuGroundEasy),
  yanwu_ground_hard: parseMapDef(yanwuGroundHard),
  demo2: parseMapDef(demo2Pincer),
  demo3: parseMapDef(demo3WolfWoods),
  demo4: parseMapDef(demo4MistHollow),
  lesson_ap_cost: parseMapDef(lessonApCost),
  lesson_opportunity_attack: parseMapDef(lessonOpportunityAttack),
  lesson_push_abyss: parseMapDef(lessonPushAbyss),
  lesson_healer: parseMapDef(lessonHealer),
  lesson_poison_mist: parseMapDef(lessonPoisonMist),
};

export const DEFAULT_MAP_ID = 'demo1';

/**
 * Small, single-mechanic practice levels — real, playable MapDefs (see
 * `maps` above), just called out separately so LevelSelectScene can still
 * visually distinguish them from a finale-style demo map (distinct fill
 * color), same spirit as the old scripted-tutorial list but now pointing at
 * genuinely winnable/losable levels instead of an auto-playing script.
 * Nothing here is gated/locked — every id in `maps` is always clickable.
 */
export const LESSON_MAP_IDS: string[] = [
  'lesson_ap_cost',
  'lesson_opportunity_attack',
  'lesson_push_abyss',
  'lesson_healer',
  'lesson_poison_mist',
];

/**
 * Pure UI grouping for LevelSelectScene's difficulty-tier buttons — NOT part
 * of MapDef/format.ts. Difficulty tiers are a selection-screen concern, not
 * battle content; keeping this out of MapDef keeps format.ts's validation
 * scoped to actual battle data. Only demo1 (演武場) has tiers today; demo2/3/4
 * are untouched and keep their single-button rendering in LevelSelectScene.
 */
export interface LevelGroup {
  levelNameKey: string;
  easy?: string;
  normal: string;
  hard?: string;
}

export const LEVEL_GROUPS: LevelGroup[] = [
  {
    levelNameKey: 'map.yanwu_ground.name',
    easy: 'yanwu_ground_easy',
    normal: 'demo1',
    hard: 'yanwu_ground_hard',
  },
];

export const STARTING_SQUAD = ['li_yan', 'su_qing'];
