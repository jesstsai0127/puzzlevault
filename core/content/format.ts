import type {
  AiRule,
  CharacterDef,
  EffectPrimitive,
  MapDef,
  MonsterDef,
  SkillDef,
  WaveDef,
} from './types';
import type { Vec2 } from '../geometry';

export const CONTENT_FORMAT_VERSION = 1;

const EFFECT_TYPES = ['damage', 'push', 'shield', 'heal'];
const TARGET_MODES = ['self', 'firstInLine'];

function checkFormatVersion(raw: unknown, kind: string): void {
  const v = (raw as { formatVersion?: unknown })?.formatVersion;
  if (v !== CONTENT_FORMAT_VERSION) {
    throw new Error(`${kind}: unsupported formatVersion ${String(v)} (expected ${CONTENT_FORMAT_VERSION})`);
  }
}

function throwIfProblems(kind: string, id: unknown, problems: string[]): void {
  if (problems.length > 0) {
    throw new Error(`${kind} '${String(id)}': ${problems.join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

export function validateSkillDef(def: SkillDef): string[] {
  const problems: string[] = [];
  if (!def.id) problems.push('missing id');
  if (!def.nameKey) problems.push('missing nameKey');
  if (!def.descKey) problems.push('missing descKey');
  if (!(def.range >= 0)) problems.push('range must be >= 0');
  if (!(def.mpCost > 0)) problems.push('mpCost must be > 0');
  if (!Array.isArray(def.effects) || def.effects.length === 0) {
    problems.push('skill has no effects');
    return problems;
  }
  def.effects.forEach((eff: EffectPrimitive, i: number) => {
    if (!EFFECT_TYPES.includes(eff.type)) problems.push(`effect ${i}: unknown type '${eff.type}'`);
    if (!(eff.amount > 0)) problems.push(`effect ${i}: amount must be > 0`);
    if (!TARGET_MODES.includes(eff.target)) problems.push(`effect ${i}: unknown target '${eff.target}'`);
    if (eff.target === 'firstInLine' && def.range < 1) {
      problems.push(`effect ${i}: firstInLine target requires range >= 1`);
    }
  });
  return problems;
}

export function parseSkillDef(raw: unknown): SkillDef {
  checkFormatVersion(raw, 'skill file');
  const def = raw as SkillDef;
  throwIfProblems('skill', def.id, validateSkillDef(def));
  return def;
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

export function validateCharacterDef(def: CharacterDef): string[] {
  const problems: string[] = [];
  if (!def.id) problems.push('missing id');
  if (!def.nameKey) problems.push('missing nameKey');
  if (!def.spriteRef) problems.push('missing spriteRef');
  if (!(def.maxHp > 0)) problems.push('maxHp must be > 0');
  if (!(def.actionPoints > 0)) problems.push('actionPoints must be > 0');
  if (!Array.isArray(def.skillIds) || def.skillIds.length === 0) problems.push('character has no skills');
  return problems;
}

export function parseCharacterDef(raw: unknown): CharacterDef {
  checkFormatVersion(raw, 'character file');
  const def = raw as CharacterDef;
  throwIfProblems('character', def.id, validateCharacterDef(def));
  return def;
}

// ---------------------------------------------------------------------------
// Monster
// ---------------------------------------------------------------------------

export function validateMonsterDef(def: MonsterDef): string[] {
  const problems: string[] = [];
  if (!def.id) problems.push('missing id');
  if (!def.nameKey) problems.push('missing nameKey');
  if (!def.spriteRef) problems.push('missing spriteRef');
  if (!(def.maxHp > 0)) problems.push('maxHp must be > 0');
  if (!(def.moveRange > 0)) problems.push('moveRange must be > 0');
  if (!Array.isArray(def.skillIds) || def.skillIds.length === 0) problems.push('monster has no skills');
  if (!Array.isArray(def.aiRules) || def.aiRules.length === 0) {
    problems.push('monster has no aiRules');
  } else {
    const last = def.aiRules[def.aiRules.length - 1] as AiRule;
    if (last.when.kind !== 'always') {
      problems.push('last aiRule must be an unconditional fallback (when.kind === "always")');
    }
    def.aiRules.forEach((rule: AiRule, i: number) => {
      if (rule.action.kind === 'useSkill' && !def.skillIds.includes(rule.action.skillId)) {
        problems.push(`aiRule ${i}: uses skillId '${rule.action.skillId}' not in this monster's skillIds`);
      }
    });
  }
  return problems;
}

export function parseMonsterDef(raw: unknown): MonsterDef {
  checkFormatVersion(raw, 'monster file');
  const def = raw as MonsterDef;
  throwIfProblems('monster', def.id, validateMonsterDef(def));
  return def;
}

// ---------------------------------------------------------------------------
// Map / waves
// ---------------------------------------------------------------------------

/**
 * '#' wall, ' ' floor, '~' hazard (blocks movement like a wall, but a push can
 * still land a unit on it), 'B' base (impassable to everyone, shares one HP pool).
 */
const GRID_CHARS = new Set(['#', ' ', '~', 'B']);

function parseWallFloorGrid(grid: string[]): { width: number; height: number; walkable: boolean[][] } {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const walkable: boolean[][] = grid.map((row) =>
    row.split('').map((ch) => ch === ' '),
  );
  return { width, height, walkable };
}

export function validateMapDef(def: MapDef): string[] {
  const problems: string[] = [];
  if (!def.id) problems.push('missing id');
  if (!def.nameKey) problems.push('missing nameKey');
  if (!Array.isArray(def.grid) || def.grid.length === 0) {
    problems.push('grid must be a non-empty array of strings');
    return problems;
  }

  const { width, height, walkable } = parseWallFloorGrid(def.grid);
  def.grid.forEach((row: string, y: number) => {
    if (row.length !== width) problems.push(`grid row ${y} length ${row.length} != ${width}`);
    row.split('').forEach((ch, x) => {
      if (!GRID_CHARS.has(ch)) problems.push(`grid (${x},${y}): unknown character '${ch}'`);
    });
  });

  if (!(def.baseHp > 0)) problems.push('baseHp must be > 0');
  if (!def.grid.some((row) => row.includes('B'))) problems.push("map has no base ('B') tile");

  const inBounds = (p: Vec2) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
  const isWalkable = (p: Vec2) => inBounds(p) && walkable[p.y]?.[p.x];

  if (!Array.isArray(def.playerStarts) || def.playerStarts.length === 0) {
    problems.push('map has no playerStarts');
  } else {
    const seen = new Set<string>();
    for (const p of def.playerStarts) {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) problems.push(`duplicate playerStart at (${key})`);
      seen.add(key);
      if (!isWalkable(p)) problems.push(`playerStart (${key}) not on a walkable tile`);
    }
  }

  if (!Array.isArray(def.waves) || def.waves.length === 0) {
    problems.push('map has no waves');
  } else {
    def.waves.forEach((wave: WaveDef, wi: number) => {
      if (!(wave.turns > 0)) problems.push(`wave ${wi}: turns must be > 0`);
      if (!Array.isArray(wave.monsters) || wave.monsters.length === 0) {
        problems.push(`wave ${wi} has no monsters`);
        return;
      }
      wave.monsters.forEach((spawn, si) => {
        if (!spawn.monsterId) problems.push(`wave ${wi} spawn ${si}: missing monsterId`);
        if (!isWalkable(spawn.spawn)) {
          problems.push(`wave ${wi} spawn ${si}: spawn (${spawn.spawn.x},${spawn.spawn.y}) not walkable`);
        }
      });
    });
  }

  return problems;
}

export function parseMapDef(raw: unknown): MapDef {
  checkFormatVersion(raw, 'map file');
  const def = raw as MapDef;
  throwIfProblems('map', def.id, validateMapDef(def));
  return def;
}
