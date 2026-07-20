import { BattleEngine } from '../core/battle/engine';
import { maps, registry } from '../content/registry';

const id = process.argv[2] ?? 'island2_m3';
const map = maps[id];
const engine = new BattleEngine(map, map.squadCharacterIds!, registry);

function dump(label: string) {
  const s = engine.getSnapshot();
  const mons = s.monsters
    .filter((m) => m.hp > 0)
    .map((m) => `${m.monsterId}@(${m.position.x},${m.position.y})h${m.hp}`)
    .join(' ');
  console.log(`${label} baseHp=${s.baseHp} outcome=${s.outcome ?? '-'} | ${mons}`);
}

dump('start');
let turns = 0;
while (!engine.getSnapshot().outcome && turns < 10) {
  // show the intents locked for this turn before resolving
  const intents = engine.getIntents?.() ?? [];
  const it = intents
    .map((i: any) =>
      i.kind === 'skill'
        ? `${i.instanceId}:${i.skillId}->${i.direction}`
        : `${i.instanceId}:move->(${i.aim?.x},${i.aim?.y})`,
    )
    .join(' ');
  console.log(`  intents T${turns + 1}: ${it}`);
  engine.endTurn();
  turns += 1;
  dump(`after T${turns}`);
}
console.log(`FINAL outcome=${engine.getSnapshot().outcome} after ${turns} turns`);
