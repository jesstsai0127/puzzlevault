#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { BattleEngine } from '../core/battle/engine';
import { registry, maps, STARTING_SQUAD } from '../content/registry';
import type { CardinalDir, Vec2 } from '../core/geometry';

/**
 * ITB action economy command set:
 *   {"kind":"move","unitIndex":0,"to":{"x":3,"y":2}}  — one committed move to a destination tile
 *   {"kind":"skill","unitIndex":0,"skillId":"sword_qi","dir":"right"}
 *   {"kind":"rest","unitIndex":0}                     — built-in self-heal-1 action
 *   {"kind":"endTurn"}
 */
interface Command {
  kind: 'move' | 'skill' | 'rest' | 'endTurn';
  unitIndex?: number;
  to?: Vec2;
  dir?: CardinalDir;
  skillId?: string;
}

// Player glyph is assigned by SQUAD POSITION (unitIndex), not characterId —
// works for any squad size/roster, not just the original li_yan/su_qing pair.
const PLAYER_GLYPHS = ['A', 'B', 'C', 'D', 'E'];
// Monster glyph by monsterId — extend as new archetypes show up in a map's waves.
const MONSTER_GLYPHS: Record<string, string> = {
  yin_ghost: 'Y',
  jiangshi: 'J',
  yuan_ling: 'U',
  teng_yao: 'T',
  yao_lang: 'W',
};

function printBoard(engine: BattleEngine, mapId: string): void {
  const snap = engine.getSnapshot();
  const intents = engine.getIntents();
  const previews = engine.getAttackPreviews();

  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `Turn ${snap.turnNumber}/${snap.totalTurns} | Base HP: ${snap.baseHp}/${snap.baseMaxHp}`,
  );
  console.log(`${'='.repeat(60)}`);

  // Print grid with units
  const grid = maps[mapId].grid.map((row) => row.split(''));
  const width = grid[0]?.length ?? 0;
  const height = grid.length;

  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      const playerIndex = snap.players.findIndex((p) => p.hp > 0 && p.position.x === x && p.position.y === y);
      const monster = snap.monsters.find((m) => m.hp > 0 && m.position.x === x && m.position.y === y);

      if (playerIndex >= 0) {
        line += PLAYER_GLYPHS[playerIndex] ?? '?';
      } else if (monster) {
        line += MONSTER_GLYPHS[monster.monsterId] ?? '?';
      } else if (cell === '#') {
        line += '#';
      } else if (cell === 'B') {
        line += 'b';
      } else if (cell === '~') {
        line += '~';
      } else if (cell === '*') {
        line += '*';
      } else {
        line += '.';
      }
    }
    console.log(line);
  }

  // Print player state
  console.log('\nPlayers:');
  for (let i = 0; i < snap.players.length; i++) {
    const p = snap.players[i];
    if (p.hp > 0) {
      const phase = p.acted ? 'acted' : p.moved ? 'moved' : 'fresh';
      console.log(
        `  [${i}] ${p.characterId.padEnd(10)} HP: ${p.hp}/${p.maxHp} | move ${p.moveRange} | ${phase.padEnd(5)} | Pos: (${p.position.x},${p.position.y})`,
      );
    }
  }

  // Print monster state with intents
  console.log('\nMonsters & Intents:');
  for (const m of snap.monsters) {
    if (m.hp > 0) {
      const intent = intents.find((i) => i.instanceId === m.instanceId);
      let intentStr = '?';
      if (intent?.kind === 'move') {
        intentStr = `move to (${intent.to.x},${intent.to.y})`;
      } else if (intent?.kind === 'skill') {
        // Exact telegraph: LIVE strike tiles (re-resolved against the
        // current board on every getIntents(), with per-tile damage) and
        // the attack's resolution rank — order 1 lands first.
        const tiles = intent.tiles.map((t) => `(${t.pos.x},${t.pos.y})x${t.damage}`).join(' ') || 'none';
        intentStr = `skill ${intent.skillId} dir ${intent.direction} | order ${intent.order} | tiles ${tiles}`;
      }
      console.log(
        `  ${m.monsterId.padEnd(12)} #${m.instanceId.split('#')[1]}: HP ${m.hp}/${m.maxHp} | Pos (${m.position.x},${m.position.y}) | Intent: ${intentStr}`,
      );
    }
  }

  // Print attack previews
  if (previews.length > 0) {
    console.log('\nIncoming damage preview:');
    for (const p of previews) {
      if (p.target.kind === 'player') {
        const char = snap.players[p.target.unitIndex];
        console.log(`  ${char.characterId}: ${p.damage} damage`);
      } else if (p.target.kind === 'base') {
        console.log(`  Base: ${p.damage} damage`);
      }
    }
  }
}

function executeCommand(engine: BattleEngine, cmd: Command): boolean {
  if (cmd.kind === 'move') {
    if (cmd.unitIndex === undefined || !cmd.to) return false;
    const result = engine.moveUnit(cmd.unitIndex, cmd.to);
    if (!result.ok) {
      console.warn(`  Move failed: ${result.reason}`);
      return false;
    }
    console.log(`  [Unit ${cmd.unitIndex}] moved to (${cmd.to.x},${cmd.to.y})`);
    return true;
  } else if (cmd.kind === 'rest') {
    if (cmd.unitIndex === undefined) return false;
    const result = engine.rest(cmd.unitIndex);
    if (!result.ok) {
      console.warn(`  Rest failed: ${result.reason}`);
      return false;
    }
    console.log(`  [Unit ${cmd.unitIndex}] rested | Events: ${JSON.stringify(engine.getLastEvents())}`);
    return true;
  } else if (cmd.kind === 'skill') {
    if (cmd.unitIndex === undefined || !cmd.skillId || !cmd.dir) return false;
    const result = engine.useSkill(cmd.unitIndex, cmd.skillId, cmd.dir);
    if (!result.ok) {
      console.warn(`  Skill failed: ${result.reason}`);
      return false;
    }
    const events = engine.getLastEvents();
    console.log(`  [Unit ${cmd.unitIndex}] used ${cmd.skillId} ${cmd.dir} | Events: ${JSON.stringify(events)}`);
    return true;
  } else if (cmd.kind === 'endTurn') {
    engine.endTurn();
    const snap = engine.getSnapshot();
    if (snap.outcome) {
      console.log(`  Turn ended. Outcome: ${snap.outcome.toUpperCase()}`);
      return true;
    }
    console.log(`  Turn ended. Ready for turn ${snap.turnNumber}.`);
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  const [mapId, cmdFile] = process.argv.slice(2);

  if (!mapId || !cmdFile) {
    console.error('Usage: tsx tools/autoplay-harness.ts <mapId> <commandsFile>');
    console.error('  mapId: demo1, demo2, etc.');
    console.error('  commandsFile: JSON array of commands');
    process.exit(1);
  }

  const mapDef = maps[mapId];
  if (!mapDef) {
    console.error(`Unknown map: ${mapId}`);
    process.exit(1);
  }

  const cmdPath = path.resolve(cmdFile);
  if (!fs.existsSync(cmdPath)) {
    console.error(`Commands file not found: ${cmdPath}`);
    process.exit(1);
  }

  const commands: Command[] = JSON.parse(fs.readFileSync(cmdPath, 'utf-8'));

  console.log(`\n${'#'.repeat(60)}`);
  console.log(`Starting autoplay: map=${mapId}, commands=${commands.length}`);
  console.log(`${'#'.repeat(60)}`);

  // A map can declare its own squad (e.g. demo4's 3-hero roster, see
  // MapDef.squadCharacterIds) — falls back to the game's default 2-hero
  // squad when it doesn't, same rule BattleScene follows.
  const squad = mapDef.squadCharacterIds ?? STARTING_SQUAD;
  console.log(`Squad: ${squad.join(', ')}`);
  const engine = new BattleEngine(mapDef, squad, registry);
  printBoard(engine, mapId);

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    console.log(`\n[Cmd ${i + 1}/${commands.length}] ${JSON.stringify(cmd)}`);

    executeCommand(engine, cmd);
    printBoard(engine, mapId);

    const snap = engine.getSnapshot();
    if (snap.outcome) {
      console.log(`\n${'#'.repeat(60)}`);
      console.log(`GAME ${snap.outcome.toUpperCase()} on turn ${snap.turnNumber}`);
      console.log(`${'#'.repeat(60)}\n`);
      break;
    }
  }

  const finalSnap = engine.getSnapshot();
  if (!finalSnap.outcome) {
    console.log(`\n${'#'.repeat(60)}`);
    console.log(`Commands exhausted. Game still running on turn ${finalSnap.turnNumber}.`);
    console.log(`Base HP: ${finalSnap.baseHp}/${finalSnap.baseMaxHp}`);
    console.log(`${'#'.repeat(60)}\n`);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
