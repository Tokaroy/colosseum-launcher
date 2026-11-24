'use strict';

// Makes src/generations/gen6.json and gen6-learnsets.json: generation 6's battle rules, and generations 5 and 6's
// Pokémon, moves and abilities, from Pokémon Showdown's generation 6 data (@pkmn/dex, MIT), on generation 4's file
// (gen4.json):
//   - each Pokémon's generation 6 types, base stats, base experience (generation 5's, PokeAPI's), abilities and hidden
//     ability, and its level-up, TM, tutor and egg
//     moves in generation 6 (X, Y, Omega Ruby, Alpha Sapphire: a level-up move at its earliest level);
//   - the Pokémon generations 5 and 6 brought (#494-#721, each in its base form), with what Showdown hasn't (catch
//     rate, base experience, EV yield, growth rate, friendship) from PokeAPI's tables (BSD-3-Clause, ref/pokeapi: see
//     POKEAPI below), and their evolutions as gen4.json writes them;
//   - each move's generation 6 power, accuracy, PP, type, priority, category, added-effect chance, flags and (where it
//     changed) range. The first
//     four generations' keep the effect gen4.json names (Pokémon Platinum's): the game's port plays generation 6's
//     changes to them as mechanics (src/mechanics.js). Generations 5 and 6's moves have no Platinum effect: the port
//     plays each by Showdown's data and code (host/gen6_moves.inc), and its effect is `SHOWDOWN`;
//   - the abilities generations 5 and 6 brought, numbered as Showdown numbers them (the game's are one past:
//     src/generations.js colosseumAbility);
//   - the Fairy type's moves (fairy.json's newMoves);
//   - the mechanics generation 6's rules have on (src/mechanics.js).
// Make fairy.js's first.
//
// usage: node gen6.js [POKEAPI_CSV_DIR]
const fs = require('node:fs');
const path = require('node:path');
const { Dex } = require('@pkmn/dex');

const OUT = path.join(__dirname, '..', '..', 'src', 'generations');
const POKEAPI = process.argv[2] || path.join(__dirname, '..', '..', '..', 'ref', 'pokeapi');
const LAST_SPECIES = 721, LAST_MOVE = 621, LAST_ABILITY = 191, FIRST_NEW_SPECIES = 494, FIRST_NEW_MOVE = 468, FIRST_NEW_ABILITY = 124;
const KINDS = { M: 'tm', T: 'tutor', E: 'egg', S: 'event' };
// The flags gen4.json gives a move, from Showdown's (the rest: Platinum's, which generation 6 kept)
const FLAG_MAP = { contact: 'contact', protect: 'protect', reflectable: 'reflectable', snatch: 'snatch', mirror: 'mirror', sound: 'sound' };
// Showdown's targets, as Pokémon Platinum names a move's range (gen4.json)
const RANGES = { normal: 'RANGE_SINGLE_TARGET', any: 'RANGE_SINGLE_TARGET', self: 'RANGE_USER', allAdjacentFoes: 'RANGE_ADJACENT_OPPONENTS',
  allAdjacent: 'RANGE_ALL_ADJACENT', allySide: 'RANGE_USER_SIDE', foeSide: 'RANGE_OPPONENT_SIDE', all: 'RANGE_FIELD',
  adjacentAlly: 'RANGE_ALLY', adjacentAllyOrSelf: 'RANGE_USER_OR_ALLY', randomNormal: 'RANGE_RANDOM_OPPONENT', scripted: 'RANGE_SINGLE_TARGET_SPECIAL' };
const GROWTH = { 1: 'slow', 2: 'mediumFast', 3: 'fast', 4: 'mediumSlow', 5: 'erratic', 6: 'fluctuating' };
const EV_KEYS = { 1: 'hp', 2: 'attack', 3: 'defense', 4: 'spAttack', 5: 'spDefense', 6: 'speed' };

function csv(name) {
  const [head, ...rows] = fs.readFileSync(path.join(POKEAPI, `${name}.csv`), 'utf8').trim().split(/\r?\n/);
  const keys = head.split(',');
  return rows.map(line => Object.fromEntries(line.split(',').map((value, i) => [keys[i], value])));
}

function genderOf(species) {
  if (species.gender === 'N') return 'genderless';
  if (species.gender === 'M') return 0;
  if (species.gender === 'F') return 100;
  return Math.round((species.genderRatio?.F ?? 0.5) * 1000) / 10;
}

// A move of generations 5 or 6 as gen4.json writes one
function moveEntry(move) {
  if (!RANGES[move.target]) throw new Error(`${move.name}: no range for Showdown's target ${move.target}`);
  const damaging = move.category !== 'Status';
  const flinches = (move.secondaries || []).some(s => s.volatileStatus === 'flinch');
  const flags = {};
  for (const [ours, theirs] of Object.entries(FLAG_MAP)) flags[ours] = Boolean(move.flags[theirs]);
  return {
    name: move.name, type: move.type, category: move.category,
    // a damaging move whose power is worked out as it's used has 1, as Platinum's data has it
    power: damaging && move.basePower === 0 ? 1 : move.basePower,
    accuracy: move.accuracy === true ? 0 : move.accuracy, pp: move.pp, priority: move.priority, range: RANGES[move.target],
    effect: 'SHOWDOWN', effectChance: move.secondary?.chance ?? 0, ...flags,
    kingsRock: damaging && !flinches, metronome: Boolean(move.flags.metronome), mimic: !move.flags.failmimic,
    assist: !move.flags.noassist, sleepTalk: !move.flags.nosleeptalk && !move.flags.charge, hm: false,
    description: move.shortDesc
  };
}

// An evolution of generations 5 and 6 as gen4.json writes one. The game keeps no time of day or weather, and has no
// way to turn the console upside-down: those evolve by level alone. Sylveon (a Fairy move and affection) evolves
// knowing Baby-Doll Eyes, the Fairy move Eevee learns by level.
function evolutionOf(into, dex) {
  const s = dex.species.get(into), out = { into: s.num };
  if (s.evoType === 'useItem') return { ...out, item: s.evoItem, ...(s.gender === 'M' ? { gender: 'male' } : s.gender === 'F' ? { gender: 'female' } : {}) };
  if (s.evoType === 'levelFriendship') return { ...out, friendship: true };
  if (s.evoType === 'trade') return s.evoItem ? { ...out, trade: s.evoItem } : { ...out, trade: true };
  if (s.evoType === 'levelMove') return { ...out, knowsMove: dex.moves.get(s.evoMove).num };
  if (s.evoType === 'levelExtra' && s.name === 'Sylveon') return { ...out, knowsMove: dex.moves.get('Baby-Doll Eyes').num };
  if (s.evoType === 'levelHold') return { ...out, heldItem: s.evoItem, time: 'any' };
  if (s.evoType === 'levelExtra') return { ...out, level: s.evoLevel || 1 };
  const level = s.evoLevel || 1;
  // a level for one gender (Meowstic's both: either), else a level
  if (s.gender === 'M' || s.gender === 'F') return { ...out, level, gender: s.gender === 'M' ? 'male' : 'female' };
  return { ...out, level };
}

async function main() {
  const dex = Dex.forGen(6);
  const gen4 = JSON.parse(fs.readFileSync(path.join(OUT, 'gen4.json'), 'utf8'));
  const fairy = JSON.parse(fs.readFileSync(path.join(OUT, 'fairy.json'), 'utf8'));
  const playable = num => num >= 1 && num <= LAST_MOVE;

  // moves: generation 4's entries with generation 6's numbers and flags, then generations 5 and 6's
  const moves = {};
  for (const [n, entry] of Object.entries(gen4.moves)) {
    const move = dex.moves.get(entry.name);
    if (!move.exists) throw new Error(`Showdown has no move ${entry.name}`);
    const flags = {};
    for (const [ours, theirs] of Object.entries(FLAG_MAP)) flags[ours] = Boolean(move.flags[theirs]);
    const damaging = move.category !== 'Status';
    const flinches = (move.secondaries || []).some(s => s.volatileStatus === 'flinch');
    // a range generation 6 changed (Poison Gas and Cotton Spore: all adjacent foes), else Platinum's
    const gen4Target = Dex.forGen(4).moves.get(entry.name).target;
    // (Mirror Move and Nature Power keep Platinum's range for a move that calls another)
    const range = move.target !== gen4Target && RANGES[move.target] && entry.range !== 'RANGE_SINGLE_TARGET_SPECIAL' ? RANGES[move.target] : entry.range;
    moves[n] = { ...entry, range, type: move.type, category: move.category, power: move.basePower === 0 && entry.power === 1 ? 1 : move.basePower,
      accuracy: move.accuracy === true ? 0 : move.accuracy, pp: move.pp, priority: move.priority,
      effectChance: move.secondary?.chance ?? entry.effectChance, ...flags,
      // From generation 5, King's Rock acts on every damaging move without a flinch chance of its own
      kingsRock: damaging && !flinches,
      description: move.shortDesc };
  }
  for (let n = FIRST_NEW_MOVE; n <= LAST_MOVE; n++) {
    if (fairy.newMoves[n]) { moves[n] = fairy.newMoves[n]; continue; }
    const move = dex.moves.all().find(m => m.num === n);
    if (!move) throw new Error(`Showdown has no move #${n}`);
    moves[n] = moveEntry(move);
  }

  // abilities: generation 4's, with generation 6's descriptions, then generations 5 and 6's
  const abilities = {};
  for (const [n, entry] of Object.entries(gen4.abilities)) {
    const ability = dex.abilities.get(entry.name);
    abilities[n] = { name: entry.name, description: ability.exists ? ability.shortDesc : entry.description };
  }
  for (const ability of dex.abilities.all().filter(a => a.num >= FIRST_NEW_ABILITY && a.num <= LAST_ABILITY).sort((a, b) => a.num - b.num))
    abilities[ability.num] = { name: ability.name, description: ability.shortDesc };

  // PokeAPI's numbers for the new Pokémon
  const speciesRows = new Map(csv('pokemon_species').map(r => [Number(r.id), r]));
  const pokemonRows = new Map(csv('pokemon').filter(r => r.is_default === '1').map(r => [Number(r.species_id), r]));
  const evYields = new Map();
  for (const r of csv('pokemon_stats')) {
    const id = Number(r.pokemon_id);
    if (!evYields.has(id)) evYields.set(id, { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 });
    evYields.get(id)[EV_KEYS[r.stat_id]] = Number(r.effort);
  }

  // the Pokémon that evolve into each (Eevee into Sylveon: the game's own get their evolutions into new Pokémon)
  const evolvesInto = new Map();
  for (const s of dex.species.all()) {
    if (s.num < FIRST_NEW_SPECIES || s.num > LAST_SPECIES || s.forme || !s.prevo) continue;
    const from = dex.species.get(s.prevo).num;
    (evolvesInto.get(from) || evolvesInto.set(from, []).get(from)).push(s.name);
  }
  // Feebas gained trade holding Prism Scale in generation 5 (in addition to its Beauty evolution)
  (evolvesInto.get(349) || evolvesInto.set(349, []).get(349)).push('Milotic');

  const species = {}, learnsets = {};
  let hidden = 0;
  const learnsetOf = async s => {
    const data = await dex.learnsets.get(s.id), levels = new Map(), other = {};
    for (const [id, sources] of Object.entries(data?.learnset || {})) {
      const move = dex.moves.get(id);
      if (!move.exists || !playable(move.num)) continue;
      for (const source of sources) {
        if (source[0] !== '6') continue;
        if (source[1] === 'L') levels.set(move.num, Math.min(levels.get(move.num) ?? 100, Number(source.slice(2)) || 1));
        else if (KINDS[source[1]]) (other[KINDS[source[1]]] ||= new Set()).add(move.num);
      }
    }
    const levelUp = [...levels].map(([move, level]) => [level, move]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const sorted = set => [...(set || [])].sort((a, b) => a - b);
    return { levelUp, tm: sorted(other.tm), tutor: sorted(other.tutor), egg: sorted(other.egg),
      kinds: Object.fromEntries(Object.entries(other).map(([kind, set]) => [kind, sorted(set)])) };
  };
  const statsOf = s => ({ hp: s.baseStats.hp, attack: s.baseStats.atk, defense: s.baseStats.def, spAttack: s.baseStats.spa,
    spDefense: s.baseStats.spd, speed: s.baseStats.spe });
  const newEvolutions = n => (evolvesInto.get(n) || []).map(name => evolutionOf(name, dex));

  for (const [n, entry] of Object.entries(gen4.species)) {
    const s = dex.species.get(entry.name);
    if (!s.exists) throw new Error(`Showdown has no Pokémon ${entry.name}`);
    const learned = await learnsetOf(s);
    if (s.abilities.H) hidden++;
    // (generation 5 on gives each Pokémon its own base experience: Blissey's 608, not Platinum's 255)
    const later = pokemonRows.get(Number(n));
    species[n] = { ...entry, ...(later ? { baseExp: Number(later.base_experience) } : {}), types: s.types, stats: statsOf(s), abilities: [s.abilities[0], s.abilities[1]].filter(Boolean),
      ...(s.abilities.H ? { hidden: s.abilities.H } : {}), levelUp: learned.levelUp, tm: learned.tm, tutor: learned.tutor, egg: learned.egg,
      evolutions: [...entry.evolutions, ...newEvolutions(Number(n))] };
    learnsets[n] = { levelUp: learned.levelUp, ...learned.kinds };
  }
  for (let n = FIRST_NEW_SPECIES; n <= LAST_SPECIES; n++) {
    const s = dex.species.all().find(x => x.num === n && !x.forme);
    const api = speciesRows.get(n), mon = pokemonRows.get(n);
    if (!s || !api || !mon) throw new Error(`no data for Pokémon #${n}`);
    const learned = await learnsetOf(s);
    if (s.abilities.H) hidden++;
    species[n] = {
      // (Showdown writes Flabébé's é as e and an accent: the game's letters have é as one)
      name: s.name.normalize('NFC'), types: s.types, stats: statsOf(s), abilities: [s.abilities[0], s.abilities[1]].filter(Boolean),
      ...(s.abilities.H ? { hidden: s.abilities.H } : {}), gender: genderOf(s), height: Number(mon.height) / 10, weight: Number(mon.weight) / 10,
      eggGroups: s.eggGroups, evolutions: newEvolutions(n),
      levelUp: learned.levelUp, tm: learned.tm, tutor: learned.tutor, egg: learned.egg,
      catchRate: Number(api.capture_rate), baseExp: Number(mon.base_experience), evYield: evYields.get(Number(mon.id)),
      baseFriendship: Number(api.base_happiness), growthRate: GROWTH[api.growth_rate_id]
    };
    learnsets[n] = { levelUp: learned.levelUp, ...learned.kinds };
  }

  // Smeargle learns any move by Sketch, but those Sketch can't copy (Struggle, Chatter)
  learnsets[dex.species.get('Smeargle').num].sketch = dex.moves.all()
    .filter(move => !move.isNonstandard && playable(move.num) && !move.flags.nosketch && !/^Hidden Power ./.test(move.name))
    .map(move => move.num).sort((a, b) => a - b);

  const data = {
    generation: 6, name: 'X and Y', newSpecies: [FIRST_NEW_SPECIES, LAST_SPECIES], newMoves: [355, LAST_MOVE],
    newAbilities: [gen4.newAbilities[0], LAST_ABILITY],
    mechanics: require('../../src/mechanics').preset(6),
    sources: [`Pokémon Showdown's data, generation 6 (@pkmn/dex ${require('@pkmn/dex/package.json').version}, MIT)`,
      'catch rate, base experience, EV yield, growth rate, friendship, heights, weights and evolutions of the first four generations\' Pokémon: gen4.json (Pokemon Battle Revolution, Pokémon Platinum)',
      'catch rate, base experience, EV yield, growth rate and friendship of generations 5 and 6\'s Pokémon: PokeAPI (BSD-3-Clause)'],
    species, moves, abilities
  };
  fs.writeFileSync(path.join(OUT, 'gen6.json'), `${JSON.stringify(data)}\n`);
  fs.writeFileSync(path.join(OUT, 'gen6-learnsets.json'),
    `${JSON.stringify({ source: `Pokémon Showdown's data, generation 6 (@pkmn/dex ${require('@pkmn/dex/package.json').version}, MIT)`, species: learnsets })}\n`);
  console.log(`gen6.json: ${Object.keys(species).length} Pokémon (${hidden} with a hidden ability), ${Object.keys(moves).length} moves, ${Object.keys(abilities).length} abilities`);
}

main().catch(error => { console.error(error); process.exit(1); });
