'use strict';

// Import from a GBA, DS or 3DS save: the Pokémon page's Import button opens a Ruby, Sapphire, Emerald, FireRed or
// LeafGreen save (src/gen3-save.js), a Diamond, Pearl or Platinum one (src/ds-save.js), a Black, White, Black 2 or White 2
// one (src/gen5-save.js) or a decrypted X, Y, Omega Ruby or Alpha Sapphire one (src/gen6-save.js), shows its party and
// PC boxes, and copies the Pokémon picked into the chosen game's save as Online Trades put one in (src/trade-convert.js
// write, then the save's tradeGive: the card with the game closed, the running game otherwise). The file is only read:
// a copy comes over, and the Pokémon stays in the GBA, DS or 3DS game too. One already in the save (the same species, personality and
// trainer) isn't copied twice.
//
// A Pokémon is read into trade-convert.js's form (Colosseum's numbering) field by field:
// - from a GBA save, as Colosseum's own GBA trade does (pkmn-colosseum src/game/gba/gba_misc.c, GBA to GameCube): the
//   game and language codes, names through the game's character table (src/gba-text.js), the leftover bits it carries;
// - from a DS save, as Platinum's Pal Park takes one from a GBA game, the other way round (pokeplatinum
//   src/main_menu/gba_pokemon.c): the Hoenn Pokémon's numbers, items by their GBA numbers, contest ribbons by rank. A DS
//   game has no number Colosseum or XD knows, so one born there says "a Generation 4 game" (12) and no place met;
// - from a Generation 5 or 6 save, the same way: Pokémon from there say "a Generation 4 game" too (the games know no
//   later one), items by their Generation 4 numbers or the Generation 5 and 6 items' rows, and no ribbons from a 3DS
//   game (its ribbons aren't the GBA games'). Those games keep a Pokémon's nature, gender and Unown letter apart from its
//   personality, and Generation 6 calls it shiny by a wider test (16, not 8), but Colosseum and XD work all of them out
//   from the personality: so a Pokémon whose personality wouldn't give its own gets a new personality that does
//   (gamePersonality), the same one each time. A hidden ability comes over as the port marks one (host/species.c):
//   XD's flags bit always; Colosseum's ability byte only with the Hidden abilities mechanic on, as the mark there takes
//   the place of its first or second ability, and the game with the mechanic off would find no ability at all.
// Its level comes from its experience and its stats are worked out afresh (a boxed Pokémon keeps neither), with full
// HP and no status, as after a Pokémon Center. Bringing a DS save's Pokémon needs the game's Generation 4 Pokémon
// setting on (main.js); a Generation 5 or 6 save's Pokémon each need what they are (Generation 4 or Generation 5 and 6
// Pokémon on), said per Pokémon. What the game can't have is said, per Pokémon: an item it can't hold comes off (the
// copy in the save keeps it); an egg, a damaged Pokémon, a move or a form the game hasn't got keep it from coming.
const fs = require('node:fs');
const path = require('node:path');
const gen3 = require('./gen3-save');
const ds = require('./ds-save');
const gen5Save = require('./gen5-save');
const gen6Save = require('./gen6-save');
const gbaText = require('./gba-text');
const convert = require('./trade-convert');
const gen4 = require('./generations/gen4.json');
const gen6 = require('./generations/gen6.json');
const gen6Learnsets = require('./gen6-learnsets');
const transfer = require('./generations/gen4-transfer.json');

const KINDS = { gba: 'GBA', ds: 'DS', bw: 'DS', '3ds': '3DS' };
const FIRST_HOENN = 277, LAST_HOENN = 411, EGG = 412, LATER_OFFSET = 26;
const NATIONAL_OF_HOENN = new Map(Object.entries(transfer.species).map(([national, gba]) => [gba, Number(national)]));
const HOENN_OF_NATIONAL = new Map(Object.entries(transfer.species).map(([national, gba]) => [Number(national), gba]));
// Generation 4, 5 and 6 Pokémon whose other forms have their own stats or types, which the game doesn't have (only the
// first); Floette only its Eternal Flower (form 5)
const FORM_SPECIES = new Map([[386, 'Deoxys'], [413, 'Wormadam'], [479, 'Rotom'], [487, 'Giratina'], [492, 'Shaymin'],
  [641, 'Tornadus'], [642, 'Thundurus'], [645, 'Landorus'], [646, 'Kyurem'], [670, 'Floette'], [710, 'Pumpkaboo'], [711, 'Gourgeist'], [720, 'Hoopa']]);
const ONLY_FORMS = new Map([[670, [5]]]);
const formMissing = (national, form) => Boolean(form) && FORM_SPECIES.has(national) && (!ONLY_FORMS.has(national) || ONLY_FORMS.get(national).includes(form));
const DS_GAME = 12;   // an attest game the games don't know: a DS game (they show it as from a trade)
const LAST_NATIONAL = 721;
const GEN6_SPECIES = [494 + LATER_OFFSET, LAST_NATIONAL + LATER_OFFSET], GEN6_MOVES = [471, 624], GEN6_ITEMS = [0x28A, 0x2A4];
const within = (range, n) => n >= range[0] && n <= range[1];
// The Generation 5 and 6 held items the game has rows for (src/generations/gen6-items.json, Assault Vest to Sachet), by
// their Generation 5 and 6 numbers (PKHeX's item list); the older items keep their Generation 4 numbers there.
const LATER_ITEMS = { 640: 0x28A, 538: 0x28B, 540: 0x28C, 639: 0x28D, 541: 0x28E, 542: 0x28F, 543: 0x290, 544: 0x291, 545: 0x292,
  546: 0x293, 547: 0x294, 539: 0x295, 648: 0x296, 649: 0x297, 650: 0x298, 564: 0x299, 644: 0x29A, 686: 0x29B, 687: 0x29C, 688: 0x29D,
  116: 0x29E, 117: 0x29F, 118: 0x2A0, 119: 0x2A1, 537: 0x2A2, 646: 0x2A3, 647: 0x2A4 };
const laterItem = id => (id ? LATER_ITEMS[id] || transfer.items[id] || 0 : 0);
// a species' data, the game's own first (gen4.json, the first four generations), then generations 5 and 6's
const speciesData = national => gen4.species[national] || gen6.species[national] || null;
const moveData = national => gen4.moves[national] || gen6.moves[national] || null;

// ---- numbers ----
// a species in Colosseum's numbering from the National Pokédex (a DS save's), and back
function speciesFromNational(n) {
  if (n >= 1 && n <= 251) return n;
  if (HOENN_OF_NATIONAL.has(n)) return HOENN_OF_NATIONAL.get(n);
  if (n >= 387 && n <= LAST_NATIONAL) return n + LATER_OFFSET;
  return 0;
}
function nationalOf(species) {
  if (species >= 1 && species <= 251) return species;
  if (species >= FIRST_HOENN && species <= LAST_HOENN) return NATIONAL_OF_HOENN.get(species) || 0;
  if (species >= 387 + LATER_OFFSET && species <= LAST_NATIONAL + LATER_OFFSET) return species - LATER_OFFSET;
  return 0;
}
const moveFromNational = n => (n >= 355 ? n + 3 : n);
const moveNational = id => (id >= 358 ? id - 3 : id);

// The GBA game codes as the games' attest keeps them (gba_misc.c), by the GBA's own (Sapphire 1 ... Colosseum/XD 15)
const VERSION = { 1: 8, 2: 9, 3: 10, 4: 1, 5: 2, 15: 11 };
// region and language by the GBA and DS language (Japanese 1, English 2, French 3, Italian 4, German 5, Spanish 7, Korean 8)
const LANGUAGE = { 1: [1, 1], 2: [2, 2], 3: [3, 4], 4: [3, 5], 5: [3, 3], 7: [3, 6], 8: [2, 8] };

// ---- level and stats, as the games work them out ----
function expAt(rate, n) {
  if (n <= 1) return 0;
  const cube = n ** 3;
  switch (rate) {
    case 'fast': return Math.floor(4 * cube / 5);
    case 'slow': return Math.floor(5 * cube / 4);
    case 'mediumSlow': return Math.floor(6 * cube / 5) - 15 * n * n + 100 * n - 140;
    case 'erratic':
      if (n <= 50) return Math.floor(cube * (100 - n) / 50);
      if (n <= 68) return Math.floor(cube * (150 - n) / 100);
      if (n <= 98) return Math.floor(cube * Math.floor((1911 - 10 * n) / 3) / 500);
      return Math.floor(cube * (160 - n) / 100);
    case 'fluctuating':
      if (n <= 15) return Math.floor(cube * (Math.floor((n + 1) / 3) + 24) / 50);
      if (n <= 36) return Math.floor(cube * (n + 14) / 50);
      return Math.floor(cube * (Math.floor(n / 2) + 32) / 50);
    default: return cube;
  }
}
function levelOf(rate, exp) {
  let level = 1;
  while (level < 100 && expAt(rate, level + 1) <= exp) level++;
  return level;
}
// stats in the games' order (HP, Attack, Defense, Sp. Atk, Sp. Def, Speed); ivs and evs in that order too
function statsOf(national, level, ivs, evs, nature) {
  const base = speciesData(national).stats;
  const b = [base.hp, base.attack, base.defense, base.spAttack, base.spDefense, base.speed];
  const core = i => Math.floor((2 * b[i] + ivs[i] + Math.floor(evs[i] / 4)) * level / 100);
  // a nature's raised and lowered stats by Attack, Defense, Speed, Sp. Atk, Sp. Def
  const up = Math.floor(nature / 5), down = nature % 5, byNature = [1, 2, 5, 3, 4];
  return b.map((_, i) => {
    if (i === 0) return national === 292 ? 1 : core(0) + level + 10;   // (Shedinja: always 1)
    const k = byNature.indexOf(i), value = core(i) + 5;
    if (up === down) return value;
    return k === up ? Math.floor(value * 11 / 10) : k === down ? Math.floor(value * 9 / 10) : value;
  });
}
function maxPp(id, ups) {
  const move = moveData(moveNational(id));
  return move ? Math.floor(move.pp * (5 + ups) / 5) : 0;
}

// The fields every Pokémon read here works out the same way from its species, experience, IVs, EVs and moves.
function finish(p, national) {
  const entry = speciesData(national);
  if (entry) {
    p.level = levelOf(entry.growthRate, p.exp);
    p.stats = statsOf(national, p.level, p.ivs, p.evs, p.rnd % 25);
    p.hp = p.stats[0];
    for (const move of p.moves) move.pp = Math.min(move.pp, maxPp(move.id, move.ppUps));
  }
  p.nicknameText = String.fromCharCode(...p.nickname);
  return p;
}

// ---- a GBA save's Pokémon (80 bytes in a box, 100 in the party) ----
function fromGba(raw) {
  const personality = raw.readUInt32LE(0), otId = raw.readUInt32LE(4), key = (personality ^ otId) >>> 0;
  const order = gen3.ORDERS[personality % 24];
  const plain = Buffer.alloc(48);
  for (let i = 0; i < 48; i += 4) plain.writeUInt32LE((raw.readUInt32LE(0x20 + i) ^ key) >>> 0, i);
  const sub = letter => plain.subarray(order.indexOf(letter) * 12, order.indexOf(letter) * 12 + 12);
  const g = sub('G'), a = sub('A'), e = sub('E'), m = sub('M');
  let sum = 0;
  for (let i = 0; i < 48; i += 2) sum = (sum + plain.readUInt16LE(i)) & 0xFFFF;
  const flags = raw[0x13], language = raw[0x12];
  const origins = m.readUInt16LE(2), ivWord = m.readUInt32LE(4), ribbons = m.readUInt32LE(8);
  const [region, lang] = LANGUAGE[language] || [0, 0];
  const iv = shift => (ivWord >>> shift) & 31, rank = shift => (ribbons >>> shift) & 7;
  const species = g.readUInt16LE(0), ppBonuses = g[8];
  const p = {
    game: 'gba', species, rnd: personality, attest: [VERSION[(origins >> 7) & 15] || 0, 3, region, lang],
    metLocation: m[1], metLevel: origins & 0x7F, ball: (origins >> 11) & 15, otGender: origins >> 15, otId,
    otName: gbaText.fromGba(raw.subarray(0x14, 0x1B), 7, lang), nickname: gbaText.fromGba(raw.subarray(8, 18), 10, lang),
    exp: g.readUInt32LE(4), level: raw.length >= 100 ? raw[0x54] : 0,
    conditionAmari: raw.length >= 100 ? (raw.readUInt32LE(0x50) & 0xFFFFF000) >>> 0 : 0,
    moves: [0, 1, 2, 3].map(i => ({ id: a.readUInt16LE(2 * i), pp: a[8 + i], ppUps: (ppBonuses >> (2 * i)) & 3, shadow: false })).filter(move => move.id),
    item: g.readUInt16LE(2), hp: 0, stats: [0, 0, 0, 0, 0, 0],
    evs: [e[0], e[1], e[2], e[4], e[5], e[3]], ivs: [iv(0), iv(5), iv(10), iv(20), iv(25), iv(15)],
    friendship: g[9], contest: [e[6], e[7], e[8], e[9], e[10]], ranks: [rank(0), rank(3), rank(6), rank(9), rank(12)], sheen: e[11],
    ribbons: Array.from({ length: 12 }, (_, i) => Boolean(ribbons & (1 << (15 + i)))), ribbonSpare: (ribbons >>> 27) & 15,
    pokerus: m[0], egg: Boolean(ivWord & (1 << 30)) || Boolean(flags & 4), abilitySlot: ivWord >>> 31,
    invalid: Boolean(flags & 1) || sum !== raw.readUInt16LE(0x1C), flagAmari: flags >> 3, markings: raw[0x1B],
    para1Amari: g.readUInt16LE(10), amari: raw.readUInt16LE(0x1E), event: Boolean(ribbons >>> 31), shadowId: 0, shadowNow: false
  };
  p.nicknameOrg = p.nickname;
  if (species === EGG) p.egg = true;
  if (!(species >= 1 && species <= 251) && !(species >= FIRST_HOENN && species <= LAST_HOENN) && species !== EGG) p.invalid = true;
  return { pokemon: finish(p, nationalOf(species)), form: 0 };
}

// ---- a DS save's Pokémon (136 bytes deciphered, 236 in the party) ----
// a DS name's codes as the games' characters: what neither game's font has becomes "?"
function dsText(codes, count) {
  return codes.slice(0, count).map(code => {
    if (code === 0) return 0x20;   // (a GBA space Pal Park kept as 0: the DS shows it blank)
    const char = transfer.text[code];
    if (!char) return 0x3F;
    const unit = char.charCodeAt(0);
    if (/\s/u.test(char)) return 0x20;   // (the DS's spaces, wide and narrow)
    return gbaText.KNOWN.has(unit) || (unit >= 0x20 && unit < 0x7F) ? unit : 0x3F;
  });
}
function abilitySlot(national, ability) {
  const names = gen4.species[national]?.abilities || [], name = gen4.abilities[ability]?.name;
  return Math.max(0, names.indexOf(name));
}
function fromDs({ data, whole }) {
  const b = data, national = b.readUInt16LE(0x08), species = speciesFromNational(national);
  const ivWord = b.readUInt32LE(0x38), hoenn = b.readUInt32LE(0x3C), language = b[0x17], hometown = b[0x5F];
  const [region, lang] = LANGUAGE[language] || [2, 2];
  const iv = shift => (ivWord >>> shift) & 31;
  const rank = shift => [0, 1, 2, 3].filter(i => hoenn & (1 << (shift + i))).length;
  const heldGen4 = b.readUInt16LE(0x0A), held = heldGen4 ? transfer.items[heldGen4] : 0;
  const nickname = dsText(ds.codes(b.subarray(0x48, 0x5E), 11), 10);
  const p = {
    game: 'ds', species, rnd: b.readUInt32LE(0), attest: [VERSION[hometown] || DS_GAME, 3, region, lang],
    metLocation: 0, metLevel: b[0x84] & 0x7F, ball: b[0x83], otGender: b[0x84] >> 7, otId: b.readUInt32LE(0x0C),
    otName: dsText(ds.codes(b.subarray(0x68, 0x78), 8), 7), nickname, nicknameOrg: nickname,
    exp: b.readUInt32LE(0x10), level: 0, conditionAmari: 0,
    moves: [0, 1, 2, 3].map(i => ({ id: moveFromNational(b.readUInt16LE(0x28 + 2 * i)), pp: b[0x30 + i], ppUps: Math.min(b[0x34 + i], 3), shadow: false })).filter(move => move.id),
    item: held || 0, hp: 0, stats: [0, 0, 0, 0, 0, 0],
    evs: [b[0x18], b[0x19], b[0x1A], b[0x1C], b[0x1D], b[0x1B]], ivs: [iv(0), iv(5), iv(10), iv(20), iv(25), iv(15)],
    friendship: b[0x14], contest: [b[0x1E], b[0x1F], b[0x20], b[0x21], b[0x22]], ranks: [rank(0), rank(4), rank(8), rank(12), rank(16)], sheen: b[0x23],
    ribbons: Array.from({ length: 12 }, (_, i) => Boolean(hoenn & (1 << (20 + i)))), ribbonSpare: 0,
    pokerus: b[0x82], egg: Boolean(ivWord & (1 << 30)), abilitySlot: abilitySlot(national, b[0x15]),
    invalid: !whole || !species, flagAmari: 0, markings: b[0x16] & 0x0F, para1Amari: 0, amari: 0,
    event: Boolean(b[0x40] & 1), shadowId: 0, shadowNow: false
  };
  return { pokemon: finish(p, national), form: b[0x40] >> 3, heldLost: Boolean(heldGen4 && !held) };
}

// ---- a Generation 5 or 6 save's Pokémon (PK5: 136 bytes deciphered; PK6: 232) ----
// A later game's name (Unicode, its own ♂ and ♀) as the games' characters: what neither game's font has becomes "?"
const GENDER_SIGNS = { 0x246D: 0x2642, 0x246E: 0x2640, 0xE08E: 0x2642, 0xE08F: 0x2640 };
function unicodeText(codes, count) {
  return codes.slice(0, count).map(raw => {
    const code = GENDER_SIGNS[raw] || raw;
    if (/\s/u.test(String.fromCharCode(code))) return 0x20;
    return gbaText.KNOWN.has(code) || (code >= 0x20 && code < 0x7F) ? code : 0x3F;
  });
}
const shinyXor = (otId, pid) => ((otId >>> 16) ^ (otId & 0xFFFF) ^ (pid >>> 16) ^ (pid & 0xFFFF)) >>> 0;
// Unown's letter as the GBA games and Colosseum work it out from the personality
const unownLetter = pid => ((((pid >>> 24) & 3) << 6) | (((pid >>> 16) & 3) << 4) | (((pid >>> 8) & 3) << 2) | (pid & 3)) % 28;
// Wurmple evolves into Silcoon (not Cascoon) by its personality's high half (Generation 6: its encryption constant's)
const silcoon = value => ((value >>> 16) % 10) < 5;
// a species' gender ratio as the game keeps it (out of 256, one under: src/pokemon-packs.js), 255 genderless
function genderRatio(national) {
  const gender = speciesData(national)?.gender;
  if (gender === 'genderless') return 255;
  return typeof gender === 'number' ? Math.max(0, Math.min(254, Math.round(gender * 2.56) - 1)) : -1;
}
// A personality the GameCube games read as `want` says (nature: personality % 25; shiny: the trainer's ids XOR its
// halves under 8; female: its low byte under the species' ratio; Unown's letter; Wurmple's evolution): the Pokémon's own
// if it does, else one found from it with the games' generator, so the same Pokémon always gets the same one.
function gamePersonality(pid, otId, want) {
  const fits = c => c % 25 === want.nature && (shinyXor(otId, c) < 8) === want.shiny
    && (want.female === null || ((c & 0xFF) < want.ratio) === want.female)
    && (want.unown === null || unownLetter(c) === want.unown) && (want.silcoon === null || silcoon(c) === want.silcoon);
  if (fits(pid >>> 0)) return pid >>> 0;
  const ids = ((otId >>> 16) ^ (otId & 0xFFFF)) & 0xFFFF;
  let state = pid >>> 0;
  for (let i = 0; i < 0x100000; i++) {
    state = (Math.imul(state, 0x41C64E6D) + 0x6073) >>> 0;
    let high = state >>> 16;
    state = (Math.imul(state, 0x41C64E6D) + 0x6073) >>> 0;
    let low = state >>> 16;
    if (want.female !== null) low = (low & 0xFF00) | (want.female ? (low & 0xFF) % want.ratio : want.ratio + (low & 0xFF) % (256 - want.ratio));
    if (want.shiny) high = (ids ^ low ^ (high & 7)) & 0xFFFF;
    const c = ((high << 16) | low) >>> 0;
    if (fits(c)) return c;
  }
  return pid >>> 0;
}
// Its ability as the game has its species': { slot (its first or second), name, hidden (the hidden ability's name, if
// it has it), missing (the ability it comes with instead, when the game's species hasn't got its own) }
function laterAbility(national, id, hidden) {
  const name = gen6.abilities[id]?.name || '', list = speciesData(national)?.abilities || [];
  const hiddenName = gen6.species[national]?.hidden || '';
  if (hidden || (name && name === hiddenName && !list.includes(name))) return { slot: 0, name, hidden: name || hiddenName, missing: null };
  const slot = list.indexOf(name);
  return { slot: Math.max(0, slot), name, hidden: null, missing: slot < 0 && name && list[0] ? list[0] : null };
}
// Both generations' Pokémon, from their fields (from5 and from6 read them)
function fromLater(f) {
  const species = f.national >= 1 && f.national <= LAST_NATIONAL ? speciesFromNational(f.national) : 0;
  const [region, lang] = LANGUAGE[f.language] || [2, 2];
  const iv = shift => (f.ivWord >>> shift) & 31;
  const held = laterItem(f.item), gender = (f.flags >> 1) & 3, form = f.flags >> 3, ratio = genderRatio(f.national);
  const rnd = gamePersonality(f.pid, f.otId, {
    nature: f.nature < 25 ? f.nature : f.pid % 25,
    shiny: shinyXor(f.otId, f.pid) < (f.generation === 6 ? 16 : 8),
    female: ratio > 0 && ratio < 254 && gender < 2 ? gender === 1 : null, ratio,
    unown: f.national === 201 && form < 28 ? form : null,
    silcoon: f.national === 265 ? silcoon(f.generation === 6 ? f.ec : f.pid) : null
  });
  const ability = laterAbility(f.national, f.ability, f.hidden);
  const nickname = unicodeText(f.nickname, 10);
  const notes = [];
  if (f.nickname.length > 10) notes.push(`Its name is cut to 10 letters, as the game has them: ${String.fromCharCode(...nickname)}.`);
  if (f.ribbonsLost) notes.push('Its ribbons stay behind: the game has only the GBA games\' ribbons.');
  const rank = shift => [0, 1, 2, 3].filter(i => f.hoenn & (1 << (shift + i))).length;
  const p = {
    game: f.generation === 6 ? '3ds' : 'bw', species, rnd, attest: [VERSION[f.hometown] || DS_GAME, 3, region, lang],
    metLocation: 0, metLevel: f.met & 0x7F, ball: f.ball, otGender: f.met >> 7, otId: f.otId >>> 0,
    otName: unicodeText(f.otName, 7), nickname, nicknameOrg: nickname,
    exp: f.exp, level: 0, conditionAmari: 0,
    moves: f.moves.map(move => ({ id: moveFromNational(move.id), pp: move.pp, ppUps: Math.min(move.ppUps, 3), shadow: false })).filter(move => move.id),
    item: held, hp: 0, stats: [0, 0, 0, 0, 0, 0],
    evs: f.evs, ivs: [iv(0), iv(5), iv(10), iv(20), iv(25), iv(15)],
    friendship: f.friendship, contest: f.contest, ranks: [rank(0), rank(4), rank(8), rank(12), rank(16)], sheen: f.sheen,
    ribbons: Array.from({ length: 12 }, (_, i) => Boolean(f.hoenn & (1 << (20 + i)))), ribbonSpare: 0,
    pokerus: f.pokerus, egg: Boolean(f.ivWord & (1 << 30)), abilitySlot: ability.slot,
    invalid: !f.whole || !species, flagAmari: 0, markings: f.markings & 0x0F, para1Amari: 0, amari: 0,
    event: Boolean(f.flags & 1), shadowId: 0, shadowNow: false
  };
  return { pokemon: finish(p, f.national), form, heldLost: Boolean(f.item && !held), ability, notes };
}
// a PK5's moves (0x28), their PP (0x30) and PP Ups (0x34); a PK6's at 0x5A, 0x62, 0x66
const movesAt = (b, at, pp, ups) => [0, 1, 2, 3].map(i => ({ id: b.readUInt16LE(at + 2 * i), pp: b[pp + i], ppUps: b[ups + i] }));
function fromGen5({ data: b, whole }) {
  const pid = b.readUInt32LE(0);
  return fromLater({ generation: 5, whole, national: b.readUInt16LE(0x08), pid, ec: pid, otId: b.readUInt32LE(0x0C), item: b.readUInt16LE(0x0A),
    exp: b.readUInt32LE(0x10), friendship: b[0x14], ability: b[0x15], hidden: Boolean(b[0x42] & 1), markings: b[0x16], language: b[0x17],
    evs: [b[0x18], b[0x19], b[0x1A], b[0x1C], b[0x1D], b[0x1B]], contest: [b[0x1E], b[0x1F], b[0x20], b[0x21], b[0x22]], sheen: b[0x23],
    moves: movesAt(b, 0x28, 0x30, 0x34), ivWord: b.readUInt32LE(0x38), hoenn: b.readUInt32LE(0x3C), flags: b[0x40], nature: b[0x41],
    nickname: gen5Save.codes(b.subarray(0x48, 0x5E), 11), hometown: b[0x5F], otName: gen5Save.codes(b.subarray(0x68, 0x78), 8),
    pokerus: b[0x82], ball: b[0x83], met: b[0x84], ribbonsLost: false });
}
function fromGen6({ data: b, whole }) {
  return fromLater({ generation: 6, whole, national: b.readUInt16LE(0x08), pid: b.readUInt32LE(0x18), ec: b.readUInt32LE(0), otId: b.readUInt32LE(0x0C),
    item: b.readUInt16LE(0x0A), exp: b.readUInt32LE(0x10), ability: b[0x14], hidden: b[0x15] === 4, nature: b[0x1C], flags: b[0x1D],
    evs: [b[0x1E], b[0x1F], b[0x20], b[0x22], b[0x23], b[0x21]], contest: [b[0x24], b[0x25], b[0x26], b[0x27], b[0x28]], sheen: b[0x29],
    markings: b[0x2A], pokerus: b[0x2B], ribbonsLost: b.subarray(0x30, 0x3A).some(byte => byte), hoenn: 0,
    nickname: gen6Save.codes(b.subarray(0x40, 0x5A), 13), moves: movesAt(b, 0x5A, 0x62, 0x66), ivWord: b.readUInt32LE(0x74),
    // the friendship of whoever has it now (0x93: 0 its original trainer)
    friendship: b[0x93] ? b[0xA2] : b[0xCA], otName: gen6Save.codes(b.subarray(0xB0, 0xCA), 13),
    ball: b[0xDC], met: b[0xDD], hometown: b[0xDF], language: b[0xE3] });
}

// ---- the file ----
// What a file is: { kind: 'gba'|'ds'|'bw'|'3ds', gameName, trainer, trainerId, party: [entry], boxes: [{ name, pokemon: [entry|null] }] },
// each entry { pokemon (trade-convert form), form, heldLost, and from a Generation 5 or 6 save ability (laterAbility)
// and notes }; throws with a reason for players.
function readFile(file) {
  let buffer;
  try { buffer = fs.readFileSync(file); } catch (error) { throw new Error(`Can't read ${path.basename(file)}: ${error.code || error.message}.`); }
  return parse(buffer, path.basename(file));
}
function parse(buffer, name = 'That file') {
  const safe = read => { try { return read(); } catch (_) { return { pokemon: { invalid: true, moves: [], species: 0, nickname: [], nicknameText: '' }, damaged: true }; } };
  if (buffer.length >= gen3.SAVE_SIZE && buffer.length <= gen3.SAVE_SIZE + 0x100) {
    const save = gen3.parse(buffer), { sb1, storage, game } = gen3.blocks(buffer);
    const count = Math.min(6, sb1[game.partyCount]);
    const party = [];
    for (let i = 0; i < count; i++) {
      const raw = sb1.subarray(game.party + i * 100, game.party + (i + 1) * 100);
      if (raw.readUInt32LE(0) || raw.readUInt32LE(4)) party.push(safe(() => fromGba(raw)));
    }
    return { kind: 'gba', game: save.game, gameName: save.gameName, trainer: save.trainer, trainerId: save.trainerId, party,
      boxes: gen3.boxes(storage).map(box => ({ name: box.name, pokemon: box.pokemon.map(raw => raw && safe(() => fromGba(raw))) })) };
  }
  if (buffer.length >= ds.SAVE_SIZE && buffer.length <= ds.SAVE_SIZE + 0x1000 && gen5Save.detect(buffer)) {
    const save = gen5Save.parse(buffer), text = codes => String.fromCharCode(...unicodeText(codes, codes.length)).trim();
    return { kind: 'bw', game: save.game, gameName: save.gameName, trainer: text(save.trainer), trainerId: save.trainerId,
      party: save.party.map(mon => safe(() => fromGen5(mon))),
      boxes: save.boxes.map(box => ({ name: text(box.name), pokemon: box.pokemon.map(mon => mon && safe(() => fromGen5(mon))) })) };
  }
  if (Object.values(gen6Save.GAMES).some(game => buffer.length === game.size)) {
    const save = gen6Save.parse(buffer), text = codes => String.fromCharCode(...unicodeText(codes, codes.length)).trim();
    return { kind: '3ds', game: save.game, gameName: save.gameName, trainer: text(save.trainer), trainerId: save.trainerId,
      party: save.party.map(mon => safe(() => fromGen6(mon))),
      boxes: save.boxes.map(box => ({ name: text(box.name), pokemon: box.pokemon.map(mon => mon && safe(() => fromGen6(mon))) })) };
  }
  if (buffer.length >= ds.SAVE_SIZE && buffer.length <= ds.SAVE_SIZE + 0x1000) {
    let save;
    try { save = ds.parse(buffer); } catch (error) {
      if (!/^This isn't/.test(error.message)) throw error;
      throw new Error("This isn't a Pokémon Diamond, Pearl, Platinum, Black, White, Black 2 or White 2 save, or it's damaged. (HeartGold and SoulSilver saves can't be read yet.)");
    }
    const text = codes => codes.map(code => transfer.text[code] || '?').join('').trim();
    return { kind: 'ds', game: save.game, gameName: save.gameName, trainer: text(save.trainer), trainerId: save.trainerId,
      party: save.party.map(mon => safe(() => fromDs(mon))),
      boxes: save.boxes.map(box => ({ name: text(box.name), pokemon: box.pokemon.map(mon => mon && safe(() => fromDs(mon))) })) };
  }
  throw new Error(`${name} isn't a GBA save (Ruby, Sapphire, Emerald, FireRed, LeafGreen), a DS save (Diamond, Pearl, Platinum, Black, White, Black 2, White 2) or a decrypted 3DS save (X, Y, Omega Ruby, Alpha Sapphire): it's the wrong size.`);
}

// ---- what the game can take ----
const PROBLEM = {
  egg: 'Eggs can\'t come over: hatch it first.',
  invalid: 'This Pokémon\'s data is damaged.',
  'later-species': 'It\'s a Generation 4 Pokémon: turn on Generation 4 Pokémon to bring it.',
  'later-move': 'It knows a Generation 4 move: turn on Generation 4 Pokémon to bring it.',
  'gen6-species': 'It\'s a Generation 5 or 6 Pokémon: turn on Generation 5 and 6 Pokémon to bring it.',
  'gen6-move': 'It knows a Generation 5 or 6 move: turn on Generation 5 and 6 Pokémon to bring it.',
  move: 'It knows a move the game doesn\'t have.',
  'no-moves': 'It knows no moves.',
  pack: 'This Pokémon\'s data is damaged.'
};
// An entry as `receiver.game` would take it (receiver: main.js importReceiver, tradeReceiver's with hiddenAbilities, the
// Hidden abilities mechanic): { bytes (null if it can't come), problems, notes, pokemon } with each problem and note a
// sentence for players.
function judge(entry, receiver) {
  if (entry.damaged) return { bytes: null, problems: [PROBLEM.invalid], notes: [], pokemon: entry.pokemon };
  const p = { ...entry.pokemon, moves: entry.pokemon.moves.map(move => ({ ...move })) };
  const problems = [], notes = [];
  const national = nationalOf(p.species), speciesName = speciesData(national)?.name || 'It';
  if (formMissing(national, entry.form)) problems.push(`Only ${FORM_SPECIES.get(national)}'s usual form is in the game.`);
  notes.push(...(entry.notes || []));
  if (entry.heldLost) notes.push('It comes without its held item: the game doesn\'t have it.');
  // a later game's ability: its hidden one marked as the port marks one (host/species.c), where the game has it
  let markHidden = false;
  const ability = entry.ability, first = speciesData(national)?.abilities?.[0] || 'its first ability';
  if (ability?.hidden) {
    // (female Meowstic's hidden ability isn't the one the game gives Meowstic)
    if (!gen6Learnsets.hasHidden(p.species) || (national === 678 && entry.form)) notes.push(`Its hidden ability, ${ability.hidden}, isn't one the game gives ${speciesName}: it comes with ${first}.`);
    else if (receiver.hiddenAbilities) { markHidden = true; notes.push(`It keeps its hidden ability, ${ability.hidden}.`); }
    else if (receiver.game === 'xd') {
      markHidden = true;
      notes.push(`It keeps its hidden ability, ${ability.hidden}, for when Hidden abilities is on (Settings → Gameplay → Customize rules); until then it has ${first}.`);
    } else notes.push(`It comes with ${first}, not its hidden ability ${ability.hidden}: turn on Hidden abilities (Settings → Gameplay → Customize rules) before you bring it to keep that.`);
  } else if (ability?.missing) notes.push(`It comes with ${ability.missing}: ${speciesName} can't have ${ability.name} in the game.`);
  // EVs past the 510 the games allow (a cheat, or Diamond and Pearl's Pomeg glitch): lowered to 510, each in proportion
  const total = p.evs.reduce((sum, ev) => sum + ev, 0);
  if (total > 510) {
    p.evs = p.evs.map(ev => Math.floor(ev * 510 / total));
    finish(p, nationalOf(p.species));
    notes.push(`Its effort values add up to ${total}, more than the 510 the games allow: they're lowered to 510, and its stats with them.`);
  }
  // an item the game can't have comes off (the copy in the GBA or DS save keeps it)
  const itemCodes = ['item', 'key-item', 'later-item'];
  const found = convert.problems(p, receiver);
  if (found.some(each => itemCodes.includes(each.code))) {
    const later = found.some(each => each.code === 'later-item');
    notes.push(!later ? 'It comes without its held item: the game doesn\'t have it.'
      : within(GEN6_ITEMS, p.item) ? 'It comes without its held item: a Generation 5 or 6 item needs X and Y battle rules.'
        : 'It comes without its held item: a Generation 4 item needs Diamond and Pearl battle rules.');
    p.item = 0;
  }
  for (const each of found) {
    if (itemCodes.includes(each.code)) continue;
    // the Generation 5 and 6 Pokémon and moves say which setting brings them
    if (each.code === 'later-species' && within(GEN6_SPECIES, p.species)) problems.push(PROBLEM['gen6-species']);
    else if (each.code === 'later-move') {
      if (p.moves.some(move => move.id >= 358 && move.id < GEN6_MOVES[0]) && !receiver.laterMoves) problems.push(PROBLEM['later-move']);
      if (p.moves.some(move => within(GEN6_MOVES, move.id)) && !receiver.gen6Moves) problems.push(PROBLEM['gen6-move']);
    } else problems.push(PROBLEM[each.code] || each.text);
  }
  const unique = problems.filter((each, i) => problems.indexOf(each) === i);
  let bytes = null;
  if (!unique.length) {
    bytes = convert.write(receiver.game, p);
    // the mark: XD's flags byte (0x1D) bit 0x10, Colosseum's ability byte (0xCC) 2 (host/species.c colo_pokemon_set_hidden)
    if (markHidden && receiver.game === 'xd') bytes[0x1D] |= 0x10;
    else if (markHidden) bytes[0xCC] = 2;
  }
  return { bytes, problems: unique, notes, pokemon: p, hiddenAbility: markHidden };
}

module.exports = { KINDS, readFile, parse, judge, fromGba, fromDs, fromGen5, fromGen6, gamePersonality, laterItem, unicodeText,
  speciesFromNational, nationalOf, levelOf, expAt, statsOf };
