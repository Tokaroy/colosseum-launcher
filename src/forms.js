'use strict';

// The forms a player can change a Pokémon into, as the 3DS and DS games' items do (Reveal Glass, DNA Splicers,
// Gracidea, Prison Bottle, Meteorite, Griseous Orb, Rotom's appliances): the Pokémon page's Change form, for now in place
// of those items (the story has no way to get them yet). A form with stats of its own is a Pokémon of its own in the
// game (generation 6's file, 722 on: src/generations.js); its number in the game is that plus 26, as a Generation 5 or
// 6 Pokémon's. Forms that are set once (Wormadam's cloak, Basculin's stripes, Pumpkaboo's size, a female Meowstic) and
// battle forms (Aegislash, Darmanitan, Meloetta) aren't changed here.
//
// changeForm(bytes, game, to, data) edits a Pokémon of a save (Colosseum's 0x138 bytes, XD's 0xC4) in place: its
// species, its stats from its new base stats (its level, IVs, EVs and nature as they are), its HP in proportion, a
// form's own move in place of the last form's (canon's), and in Colosseum its ability slot where the form has fewer.

const SPECIES_OFFSET = 26, MOVE_OFFSET = 3;
// by the base's National number: its forms' numbers (generation 6's file), the base's own first
const CHANGERS = {
  386: { by: 'Meteorite', forms: [386, 722, 723, 724] },
  479: { by: 'Rotom Catalog', forms: [479, 727, 728, 729, 730, 731] },
  487: { by: 'Griseous Orb', forms: [487, 732] },
  492: { by: 'Gracidea', forms: [492, 733] },
  641: { by: 'Reveal Glass', forms: [641, 735] },
  642: { by: 'Reveal Glass', forms: [642, 736] },
  645: { by: 'Reveal Glass', forms: [645, 737] },
  646: { by: 'DNA Splicers', forms: [646, 738, 739] },
  720: { by: 'Prison Bottle', forms: [720, 747] }
};
// a form's own move (National numbers), which takes the last form's place: [form, its move, the base's in its place]
const OWN_MOVES = [
  [727, 315], [728, 56], [729, 59], [730, 403], [731, 437],   // Rotom's: Overheat, Hydro Pump, Blizzard, Air Slash, Leaf Storm
  [738, 553, 549], [738, 559, 184], [739, 554, 549], [739, 558, 184],   // Kyurem's: Freeze Shock / Ice Burn for Glaciate, Fusion Bolt / Flare for Scary Face
  [747, 621, 593]   // Hoopa Unbound's Hyperspace Fury for Hyperspace Hole
];
const ROTOM_FORMS = [727, 728, 729, 730, 731], THUNDER_SHOCK = 84;

// the game's (Colosseum's) number of a National or form number, and back
const gameSpecies = number => (number >= 387 ? number + SPECIES_OFFSET : number);
const numberOf = species => (species >= 387 + SPECIES_OFFSET ? species - SPECIES_OFFSET : species);
const gameMove = national => (national >= 355 ? national + MOVE_OFFSET : national);

// The forms of `number` (a National or form number) a player can change it into, with what canon changes them with:
// { by, forms: [number...] } or null
function changerOf(number, data) {
  const base = data.species[number]?.formOf || number;
  return CHANGERS[base] || null;
}

function statsOf(entry, level, ivs, evs, nature) {
  const b = [entry.stats.hp, entry.stats.attack, entry.stats.defense, entry.stats.spAttack, entry.stats.spDefense, entry.stats.speed];
  const core = i => Math.floor((2 * b[i] + ivs[i] + Math.floor(evs[i] / 4)) * level / 100);
  const up = Math.floor(nature / 5), down = nature % 5, byNature = [1, 2, 5, 3, 4];
  return b.map((_, i) => {
    if (i === 0) return core(0) + level + 10;
    const k = byNature.indexOf(i), value = core(i) + 5;
    if (up === down) return value;
    return k === up ? Math.floor(value * 11 / 10) : k === down ? Math.floor(value * 9 / 10) : value;
  });
}

// The moves of a change from `from` to `to` (game numbers, the 4 slots): Kyurem's and Hoopa's own moves for (or back to)
// the base's; a Rotom's appliance move for the last one's, learned in a free slot (else the last) from its plain form,
// and forgotten back to it (Thunder Shock if it knew nothing else)
function newMoves(from, to, known) {
  const moves = [...known];
  const own = form => OWN_MOVES.filter(([each]) => each === form);
  for (const [, mine, base] of own(from)) if (base !== undefined) { const at = moves.indexOf(gameMove(mine)); if (at >= 0) moves[at] = gameMove(base); }
  for (const [, mine, base] of own(to)) if (base !== undefined) { const at = moves.indexOf(gameMove(base)); if (at >= 0) moves[at] = gameMove(mine); }
  const rotomFrom = own(from).find(([, , base]) => base === undefined), rotomTo = own(to).find(([, , base]) => base === undefined);
  if (rotomFrom || rotomTo) {
    const at = rotomFrom ? moves.indexOf(gameMove(rotomFrom[1])) : -1;
    if (rotomTo) {
      const slot = at >= 0 ? at : moves.indexOf(0) >= 0 ? moves.indexOf(0) : 3;
      moves[slot] = gameMove(rotomTo[1]);
    } else if (at >= 0) {
      moves.splice(at, 1); moves.push(0);
      if (!moves.some(Boolean)) moves[0] = gameMove(THUNDER_SHOCK);
    }
  }
  return moves;
}

const LAYOUT = {
  colosseum: { species: 0x00, rnd: 0x04, level: 0x60, moves: 0x78, hp: 0x8a, stats: 0x8c, evs: 0x98, ivs: 0xa4, ivWord: true, ability: 0xcc },
  xd: { species: 0x00, rnd: 0x28, level: 0x11, moves: 0x80, hp: 0x04, stats: 0x90, evs: 0x9c, ivs: 0xa8, ivWord: false, ability: null }
};
// game: 'colosseum' or 'xd'; speciesFromColosseum/toColosseum: trade-convert.js's numbering between the games
function changeForm(bytes, game, to, data, { speciesFromColosseum = (g, id) => id, speciesToColosseum = (g, id) => id } = {}) {
  const at = LAYOUT[game];
  if (!at) throw new Error('That isn\'t a Pokémon of this game.');
  const species = speciesToColosseum(game, bytes.readUInt16BE(at.species)), from = numberOf(species);
  const changer = changerOf(from, data);
  if (!changer || !changer.forms.includes(to) || to === from) throw new Error('That Pokémon can\'t change into that form.');
  const entry = data.species[to];
  if (!entry) throw new Error('The game has no such form.');
  const level = bytes[at.level], rnd = bytes.readUInt32BE(at.rnd);
  const ivs = Array.from({ length: 6 }, (_, i) => (at.ivWord ? bytes.readUInt16BE(at.ivs + 2 * i) : bytes[at.ivs + i]) & 0x1f);
  const evs = Array.from({ length: 6 }, (_, i) => bytes.readUInt16BE(at.evs + 2 * i));
  const stats = statsOf(entry, level, ivs, evs, rnd % 25);
  const hp = bytes.readUInt16BE(at.hp), maxHp = bytes.readUInt16BE(at.stats);
  bytes.writeUInt16BE(speciesFromColosseum(game, gameSpecies(to)), at.species);
  stats.forEach((value, i) => bytes.writeUInt16BE(value, at.stats + 2 * i));
  bytes.writeUInt16BE(hp && maxHp ? Math.max(1, Math.round(hp * stats[0] / maxHp)) : 0, at.hp);
  const slots = Array.from({ length: 4 }, (_, i) => Buffer.from(bytes.subarray(at.moves + 4 * i, at.moves + 4 * i + 4)));
  const known = slots.map(slot => slot.readUInt16BE(0)), wanted = newMoves(from, to, known), moves = [];
  wanted.forEach((move, i) => {
    const was = known.indexOf(move), slot = Buffer.alloc(4);
    if (move && was >= 0) slots[was].copy(slot);   // (a move it keeps, with its PP and PP Ups)
    else if (move) { slot.writeUInt16BE(move, 0); slot[2] = 5; moves.push(move); }   // (a new one: 5 PP, filled at a Pokémon Center)
    slot.copy(bytes, at.moves + 4 * i);
  });
  // Colosseum's ability slot: the second where the form has one (the hidden one's mark, 2, only where it has one)
  if (at.ability !== null) {
    const slot = bytes[at.ability];
    if (slot === 1 && entry.abilities.length < 2) bytes[at.ability] = 0;
    if (slot === 2 && !entry.hidden) bytes[at.ability] = 0;
  }
  return { from, to, name: entry.name, by: changer.by, moves };
}

module.exports = { CHANGERS, changerOf, changeForm, newMoves, gameSpecies, numberOf };
