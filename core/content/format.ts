import type { AiRule, CharacterDef, EffectPrimitive, MapDef, MonsterDef, SkillDef, WaveDef } from './types';
import type { Vec2 } from '../geometry';

export const CONTENT_FORMAT_VERSION = 1;

const EFFECT_TYPES = ['damage', 'push', 'shield', 'heal', 'taunt'];
const TARGET_MODES = [
  'self',
  'firstInLine',
  'pierceLine',
  'aoeCross',
  'aoeRing',
  'aoeArc3',
  'allEnemies',
  'allUnits',
];
/** Directional line-scan modes: same range>=1 requirement as firstInLine, since a 0-range line has nothing to scan. */
const LINE_TARGET_MODES = ['firstInLine', 'pierceLine'];

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
    if (LINE_TARGET_MODES.includes(eff.target) && def.range < 1) {
      problems.push(`effect ${i}: ${eff.target} target requires range >= 1`);
    }
    if (eff.amountIsPercent && eff.type !== 'damage') {
      problems.push(`effect ${i}: amountIsPercent only applies to 'damage' effects`);
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
 * still land a unit on it), 'B' base (impassable to everyone, shares one HP pool),
 * '*' poison mist (walkable like floor — see MapDef.grid / BattleEngine's
 * poison-mist tick in endTurn()).
 */
const GRID_CHARS = new Set(['#', ' ', '~', 'B', '*']);

function parseWallFloorGrid(grid: string[]): { width: number; height: number; walkable: boolean[][] } {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  // Must match BattleEngine's own isWalkable() — poison mist ('*') is floor
  // you can stand on, same as ' '. Diverging here would let a map validate
  // fine while placing a playerStart/monster spawn the engine actually
  // rejects (or vice versa).
  const walkable: boolean[][] = grid.map((row) =>
    row.split('').map((ch) => ch === ' ' || ch === '*'),
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
  if (def.hintKey !== undefined && !def.hintKey) problems.push('hintKey, if present, must be a non-empty string');

  if (def.squadCharacterIds !== undefined) {
    if (!Array.isArray(def.squadCharacterIds) || def.squadCharacterIds.length === 0) {
      problems.push('squadCharacterIds, if present, must be a non-empty array');
    } else if (Array.isArray(def.playerStarts) && def.squadCharacterIds.length !== def.playerStarts.length) {
      problems.push(
        `squadCharacterIds.length (${def.squadCharacterIds.length}) must match playerStarts.length (${def.playerStarts.length})`,
      );
    }
  }

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
