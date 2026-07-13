import { parseCharacterDef, parseMapDef, parseMonsterDef, parseSkillDef } from '../core/content';
import type { ContentRegistry } from '../core/battle/types';

import arcaneStrike from './skills/arcane_strike.json';
import repelCharm from './skills/repel_charm.json';
import sparkBolt from './skills/spark_bolt.json';
import ward from './skills/ward.json';
import impClaw from './skills/imp_claw.json';
import huskSlam from './skills/husk_slam.json';
import wispBolt from './skills/wisp_bolt.json';
import thornVolley from './skills/thorn_volley.json';
import houndBite from './skills/hound_bite.json';

import aster from './characters/aster.json';
import wren from './characters/wren.json';

import gloomImp from './monsters/gloom_imp.json';
import huskBrute from './monsters/husk_brute.json';
import whisperWisp from './monsters/whisper_wisp.json';
import thornling from './monsters/thornling.json';
import nightHound from './monsters/night_hound.json';

import courtyard from './maps/courtyard.json';

// Builtin content goes through the same parse+validate path that downloaded
// content packs will use in Phase 2 — one format, one code path.
const skills = [arcaneStrike, repelCharm, sparkBolt, ward, impClaw, huskSlam, wispBolt, thornVolley, houndBite].map(
  parseSkillDef,
);
const characters = [aster, wren].map(parseCharacterDef);
const monsters = [gloomImp, huskBrute, whisperWisp, thornling, nightHound].map(parseMonsterDef);

export const registry: ContentRegistry = {
  characters: Object.fromEntries(characters.map((c) => [c.id, c])),
  skills: Object.fromEntries(skills.map((s) => [s.id, s])),
  monsters: Object.fromEntries(monsters.map((m) => [m.id, m])),
};

export const courtyardMap = parseMapDef(courtyard);

export const STARTING_SQUAD = ['aster', 'wren'];
