import { parseCharacterDef, parseMapDef, parseMonsterDef, parseSkillDef, parseTutorialDef } from '../core/content';
import type { ContentRegistry } from '../core/battle/types';
import type { MapDef, TutorialDef } from '../core/content/types';

import swordQi from './skills/sword_qi.json';
import palmWave from './skills/palm_wave.json';
import flyingSword from './skills/flying_sword.json';
import qiShield from './skills/qi_shield.json';
import ghostClaw from './skills/ghost_claw.json';
import corpseSmash from './skills/corpse_smash.json';
import spiritBolt from './skills/spirit_bolt.json';
import vineLash from './skills/vine_lash.json';
import wolfBite from './skills/wolf_bite.json';

import liYan from './characters/li_yan.json';
import suQing from './characters/su_qing.json';

import yinGhost from './monsters/yin_ghost.json';
import jiangshi from './monsters/jiangshi.json';
import yuanLing from './monsters/yuan_ling.json';
import tengYao from './monsters/teng_yao.json';
import yaoLang from './monsters/yao_lang.json';

import yanwuGround from './maps/yanwu_ground.json';
import demo2Pincer from './maps/demo2_pincer.json';

import tutApCost from './tutorials/tut_ap_cost.json';
import tutOpportunityAttack from './tutorials/tut_opportunity_attack.json';
import tutPushIntoAbyss from './tutorials/tut_push_into_abyss.json';

// Builtin content goes through the same parse+validate path that downloaded
// content packs will use in Phase 2 — one format, one code path.
const skills = [swordQi, palmWave, flyingSword, qiShield, ghostClaw, corpseSmash, spiritBolt, vineLash, wolfBite].map(
  parseSkillDef,
);
const characters = [liYan, suQing].map(parseCharacterDef);
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
  demo2: parseMapDef(demo2Pincer),
};

export const DEFAULT_MAP_ID = 'demo1';

export const STARTING_SQUAD = ['li_yan', 'su_qing'];

// Tutorial levels are a separate content kind from `maps` — each one carries
// its own embedded map (see TutorialDef) and isn't a playable level in its
// own right, so it's never mixed into the `maps` registry above.
export const tutorials: Record<string, TutorialDef> = {
  tut_ap_cost: parseTutorialDef(tutApCost),
  tut_opportunity_attack: parseTutorialDef(tutOpportunityAttack),
  tut_push_into_abyss: parseTutorialDef(tutPushIntoAbyss),
};
