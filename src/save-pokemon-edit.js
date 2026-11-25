'use strict';

// Editing a Pokémon directly in a Colosseum or XD card save (only while the game is closed).
//
// Unlike trade-convert.js (which constructs a fresh Pokémon buffer for cross-game trading and strips Shadow data,
// leftover bytes and mail), this module updates a Pokémon's existing bytes in place so everything the editor doesn't
// touch (OT name/ID, met location/level, origin, ribbons, contest stats, markings, mail, Shadow ID and heart gauge,
// fateful encounter flag) stays intact.
//
// All fields exchanged with the renderer use Colosseum's numbering (the same numbering battle-data.js and team-sets.js
// use), converting to/from XD's numbering at the save boundary. Shadow moves (Colosseum 355–357, XD 355–374) carry
// their raw game ID so a Shadow Pokémon keeps them untouched.

const savePokemon = require('./save-pokemon');
const convert = require('./trade-convert');
const teamSets = require('./team-sets');
const saveImport = require('./save-import');
const entries = require('./shadow-entries');
const gen4 = require('./generations/gen4.json');
const gen6 = require('./generations/gen6.json');
const fairy = require('./generations/fairy.json');
const gen3Learnsets = require('./generations/gen3-learnsets.json').species;
const gen4Learnsets = require('./generations/gen4-learnsets.json').species;
const gen6Learnsets = require('./generations/gen6-learnsets.json').species;
const gen4Items = require('./generations/gen4-items.json').items;
const gen6Items = require('./generations/gen6-items.json').items;

const SHADOW_MOVES = { colosseum: [355, 357], xd: [355, 374] };
const LATER_SPECIES = [413, 519];
const GEN6_SPECIES = [520, 773];
const LATER_MOVES = [358, 470];
const GEN6_MOVES = [471, 624];
const FAIRY_MOVES = [577, 580, 586, 587, 588, 608, 611];
const LATER_ITEMS = [0x224, 0x289];
const GEN6_ITEMS = [0x28a, 0x2a4];
const XD_BONSLY_COLO = 464, XD_MUNCHLAX_COLO = 472;
const SHEDINJA = 303;
const GROWTH = ['mediumFast', 'erratic', 'fluctuating', 'mediumSlow', 'fast', 'slow'];

const BALLS = [
  { id: 1, name: 'Master Ball' }, { id: 2, name: 'Ultra Ball' }, { id: 3, name: 'Great Ball' },
  { id: 4, name: 'Poké Ball' }, { id: 5, name: 'Safari Ball' }, { id: 6, name: 'Net Ball' },
  { id: 7, name: 'Dive Ball' }, { id: 8, name: 'Nest Ball' }, { id: 9, name: 'Repeat Ball' },
  { id: 10, name: 'Timer Ball' }, { id: 11, name: 'Luxury Ball' }, { id: 12, name: 'Premier Ball' }
];

// Colosseum's own runtime Shadow table (shadow-entries.js C_RUNTIME): +4 is the Shadow's personality.
const C_RUNTIME_PID = id => 0x1b020 + 0xc * id + 4;
// XD's darkPokemon record (shadow-convert.js XD_RECORD): ball nibble in +4 bits 8..11, IVs at +0x0b, personality at +0x1c.
const XD_RECORD_IVS = 0x0b, XD_RECORD_PID = 0x1c;

// Colosseum's Shadow Rush is 356; XD's Shadow moves are 356..373 (355 and 374 unused).
const SHADOW_MOVE_NAMES = {
  colosseum: { 356: 'Shadow Rush' },
  xd: {
    356: 'Shadow Rush', 357: 'Shadow Blitz', 358: 'Shadow Break', 359: 'Shadow End',
    360: 'Shadow Wave', 361: 'Shadow Rave', 362: 'Shadow Storm', 363: 'Shadow Fire',
    364: 'Shadow Bolt', 365: 'Shadow Chill', 366: 'Shadow Blast', 367: 'Shadow Sky',
    368: 'Shadow Hold', 369: 'Shadow Mist', 370: 'Shadow Panic', 371: 'Shadow Down',
    372: 'Shadow Shed', 373: 'Shadow Half'
  }
};

const within = (range, n) => n >= range[0] && n <= range[1];
const isShadowMove = (game, rawId) => Boolean(SHADOW_MOVES[game] && within(SHADOW_MOVES[game], rawId));
const shadowMoveName = (game, rawId) => SHADOW_MOVE_NAMES[game]?.[rawId] || `Shadow Move #${rawId}`;
const isShiny = (otId, rnd) => (((otId >>> 16) ^ (otId & 0xffff) ^ (rnd >>> 16) ^ (rnd & 0xffff)) >>> 0) < 8;
const int = (value, low, high, fallback) => Number.isInteger(value) && value >= low && value <= high ? value : fallback;

function cleanSaveEvs(evs) {
  let left = teamSets.EV_TOTAL;
  return teamSets.STATS.map((_, i) => {
    const raw = Number(Array.isArray(evs) ? evs[i] : 0);
    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(255, Math.round(raw))) : 0;
    const value = Math.min(clamped, left);
    left -= value;
    return value;
  });
}

function readUtf16(bytes, at, count = 10) {
  const units = [];
  for (let i = 0; i < count; i++) {
    const unit = bytes.readUInt16BE(at + i * 2);
    if (!unit) break;
    units.push(unit);
  }
  return String.fromCharCode(...units);
}

function writeUtf16(bytes, at, text, slots = 11) {
  bytes.fill(0, at, at + slots * 2);
  const chars = [...String(text || '')].slice(0, slots - 1);
  chars.forEach((char, i) => bytes.writeUInt16BE(char.charCodeAt(0), at + i * 2));
}

// Stats in the games' order (HP, Attack, Defense, Sp. Atk, Sp. Def, Speed), using exact integer arithmetic.
function statsOf(species, base, { level, ivs, evs, nature }) {
  const effect = teamSets.natureEffect(nature);
  return base.map((b, i) => {
    const core = Math.floor((2 * b + ivs[i] + Math.floor(evs[i] / 4)) * level / 100);
    if (i === 0) return species === SHEDINJA ? 1 : core + level + 10;
    const value = core + 5;
    if (effect?.up === i) return Math.floor(value * 11 / 10);
    if (effect?.down === i) return Math.floor(value * 9 / 10);
    return value;
  });
}

// Gender ratio from gen4/gen6.json's percentage (0, 12.5, 25, 50, 75, 100, or 'genderless'/null) to the game's 0..255 byte.
function genderRatioOf(entry) {
  if (!entry || entry.gender === null || entry.gender === undefined || entry.gender === 'genderless' || typeof entry.gender !== 'number') return teamSets.GENDER.none;
  if (entry.gender === 0) return teamSets.GENDER.male;
  if (entry.gender === 100) return teamSets.GENDER.female;
  return Math.max(0, Math.min(254, Math.round(entry.gender * 256 / 100) - 1));
}

// Default species metadata for any Gen 1–6 species or alternate form (Colosseum numbering), from gen4/gen6.json.
function defaultSpeciesInfo(colosseumId, { gen6Stats = false } = {}) {
  const national = saveImport.nationalOf(colosseumId);
  const entry = national
    ? ((colosseumId >= GEN6_SPECIES[0] || gen6Stats) ? (gen6.species[national] || gen4.species[national]) : (gen4.species[national] || gen6.species[national]))
    : null;
  if (!entry) return null;
  const s = entry.stats;
  const uniqueAbilities = [...new Set(entry.abilities || [])];
  return {
    id: colosseumId,
    national,
    name: entry.name,
    gameName: entry.gameName || entry.name,
    stats: [s.hp, s.attack, s.defense, s.spAttack, s.spDefense, s.speed],
    growthRate: entry.growthRate || 'mediumFast',
    gender: genderRatioOf(entry),
    abilityCount: Math.max(1, Math.min(2, uniqueAbilities.length || 1)),
    hasHidden: Boolean(gen6.species[national]?.hidden)
  };
}

function defaultMovePp(colosseumId) {
  const national = colosseumId >= 358 ? colosseumId - 3 : colosseumId;
  if (colosseumId >= GEN6_MOVES[0]) return gen6.moves[national]?.pp || fairy.newMoves[national]?.pp || 0;
  return gen4.moves[national]?.pp || gen6.moves[national]?.pp || 0;
}

// A personality value matching nature, gender and shininess for this Pokémon's own `otId`.
// Keeps `origRnd` unchanged whenever it already satisfies the requested traits.
function personalityFor(otId, origRnd, { species, nature, gender, shiny }, genderRatio) {
  const options = teamSets.genders(genderRatio);
  const wanted = options.length === 2 && (gender === 'M' || gender === 'F') ? gender : '';
  const matches = pid => {
    if ((pid >>> 0) % 25 !== nature) return false;
    if (isShiny(otId, pid) !== Boolean(shiny)) return false;
    if (wanted && teamSets.genderOf(pid, genderRatio) !== wanted) return false;
    return true;
  };
  if (matches(origRnd >>> 0)) return origRnd >>> 0;

  // Deterministic PRNG seeded from the original PID and edited traits so edits are reproducible.
  let state = 2166136261;
  for (const char of `${origRnd >>> 0}:${otId >>> 0}:${species}:${nature}:${wanted}:${shiny ? 1 : 0}`)
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  state = (state >>> 0) || 0x9e3779b9;
  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };

  const otXor = ((otId >>> 16) ^ (otId & 0xffff)) & 0xffff;
  for (let tries = 0; tries < 200000; tries++) {
    const low = next() & 0xffff;
    if (wanted && ((low & 0xff) < genderRatio ? 'F' : 'M') !== wanted) continue;
    const high = shiny ? ((low ^ otXor ^ (next() & 7)) & 0xffff) : (next() >>> 16);
    const pid = ((high << 16) | low) >>> 0;
    if (matches(pid)) return pid;
  }

  // Direct deterministic fallback: guaranteed to find a match for every valid (nature, gender, shiny).
  for (let low = 0; low <= 0xffff; low++) {
    if (wanted && ((low & 0xff) < genderRatio ? 'F' : 'M') !== wanted) continue;
    if (shiny) {
      for (let d = 0; d < 8; d++) {
        const high = (low ^ otXor ^ d) & 0xffff;
        const pid = ((high << 16) | low) >>> 0;
        if (matches(pid)) return pid;
      }
    } else {
      for (let high = 0; high < 256; high++) {
        const pid = ((high << 16) | low) >>> 0;
        if (matches(pid)) return pid;
      }
    }
  }
  return origRnd >>> 0;
}

// Reads one slot of a save context into the form the Save Pokémon Editor uses (Colosseum numbering).
function readSlot(ctx, place, { speciesInfo = defaultSpeciesInfo } = {}) {
  const found = savePokemon.slotAt(ctx, place);
  if (!found) throw new Error('That slot doesn\'t exist in this save.');
  const b = found.bytes, game = ctx.game, x = game === 'xd';
  const rawSpecies = b.readUInt16BE(0);
  if (!rawSpecies) throw new Error('There is no Pokémon in that slot.');
  const egg = x ? Boolean(b[0x1d] & 0x80) : b[0xcb] !== 0;
  const shadowId = b.readUInt16BE(x ? 0xba : 0xd8);
  let shadow = false;
  if (shadowId) {
    if (x) {
      const record = savePokemon.xdRecord(ctx, shadowId);
      shadow = Boolean(record) && (record[0] >> 5) !== savePokemon.XD_STATUS.purified;
    } else {
      shadow = b.readInt32BE(0xdc) >= 0;
    }
  }
  const species = convert.speciesToColosseum(game, rawSpecies);
  const rnd = b.readUInt32BE(x ? 0x28 : 0x04);
  const otId = b.readUInt32BE(x ? 0x24 : 0x14);
  const rawItem = b.readUInt16BE(x ? 0x02 : 0x88);
  const item = convert.itemToColosseum(game, rawItem);
  const moveAt = x ? 0x80 : 0x78;
  const moves = [];
  for (let i = 0; i < 4; i++) {
    const rawId = b.readUInt16BE(moveAt + 4 * i);
    if (!rawId) continue;
    const pp = b[moveAt + 4 * i + 2], ppUps = Math.min(3, b[moveAt + 4 * i + 3]);
    if (isShadowMove(game, rawId)) moves.push({ id: 0, rawId, shadow: true, name: shadowMoveName(game, rawId), pp, ppUps });
    else moves.push({ id: convert.moveToColosseum(game, rawId).id, rawId, shadow: false, pp, ppUps });
  }
  const info = speciesInfo(species) || defaultSpeciesInfo(species);
  const genderRatio = info?.gender ?? teamSets.GENDER.none;
  const rawNickname = readUtf16(b, x ? 0x4e : 0x2e, 10);
  const defaultUpper = (info?.gameName || info?.name || '').toUpperCase().slice(0, teamSets.NICKNAME_LENGTH);
  const nickname = defaultUpper && rawNickname === defaultUpper ? '' : rawNickname;
  const evs = [0, 1, 2, 3, 4, 5].map(i => b.readUInt16BE((x ? 0x9c : 0x98) + 2 * i));
  const ivs = [0, 1, 2, 3, 4, 5].map(i => (x ? b[0xa8 + i] : b.readUInt16BE(0xa4 + 2 * i)));
  const stats = [0, 1, 2, 3, 4, 5].map(i => b.readUInt16BE((x ? 0x90 : 0x8c) + 2 * i));

  return {
    place: { area: found.area, box: found.box, slot: found.slot },
    identity: { species: rawSpecies, rnd, trainer: otId },
    pokemon: {
      game,
      species,
      rawSpecies,
      nickname,
      rawNickname,
      level: Math.max(1, Math.min(100, b[x ? 0x11 : 0x60] || 1)),
      exp: b.readUInt32BE(x ? 0x20 : 0x5c),
      nature: rnd % 25,
      gender: teamSets.genderOf(rnd, genderRatio),
      shiny: isShiny(otId, rnd),
      ball: int(b[0x0f], 1, 12, 4),
      friendship: Math.min(255, b.readUInt16BE(x ? 0x06 : 0xb0)),
      item: item > 0 ? item : 0,
      rawItem,
      heldKeyItem: item < 0,
      ability: x ? ((b[0x1d] & 0x10) ? 2 : ((b[0x1d] >> 6) & 1)) : (b[0xcc] === 2 ? 2 : (b[0xcc] & 1)),
      moves,
      evs: evs.map(v => Math.min(255, v)),
      ivs: ivs.map(v => Math.min(31, v)),
      hp: b.readUInt16BE(x ? 0x04 : 0x8a),
      stats,
      shadow,
      shadowId,
      egg,
      edited: Boolean(b[x ? 0x1a : 0xce] & savePokemon.EDITED_FLAG),
      otId,
      otName: readUtf16(b, x ? 0x38 : 0x18, 10),
      rnd
    }
  };
}

function speciesAllowed(game, colosseumId, { receiver = {}, allowedPackSpecies = null, originalSpecies = 0 } = {}) {
  if (colosseumId === originalSpecies) return true;
  if (!Number.isInteger(colosseumId) || colosseumId <= 0) return false;
  if ((colosseumId >= 1 && colosseumId <= 251) || (colosseumId >= 277 && colosseumId <= 411)) return true;
  if (game === 'xd' && (colosseumId === XD_BONSLY_COLO || colosseumId === XD_MUNCHLAX_COLO)) return true;
  if (within(LATER_SPECIES, colosseumId)) return Boolean(receiver.laterPokemon);
  if (within(GEN6_SPECIES, colosseumId)) return Boolean(receiver.gen6Pokemon);
  if (allowedPackSpecies && allowedPackSpecies.has(colosseumId)) return true;
  return false;
}

function moveAllowed(colosseumId, { receiver = {}, originalMoves = new Set() } = {}) {
  if (!Number.isInteger(colosseumId) || colosseumId <= 0) return false;
  if (originalMoves.has(colosseumId)) return true;
  if (colosseumId >= 1 && colosseumId <= 354) return true;
  if (within(LATER_MOVES, colosseumId)) return Boolean(receiver.laterMoves || receiver.gen6Moves);
  if (FAIRY_MOVES.includes(colosseumId)) return Boolean(receiver.gen6Moves || receiver.fairyType);
  if (within(GEN6_MOVES, colosseumId)) return Boolean(receiver.gen6Moves);
  return false;
}

// Applies validated edits to the Pokémon at `place` (verified by `identity`) in place on `ctx`.
function applyEdit(ctx, place, identity, changes, options = {}) {
  const { receiver = {}, speciesInfo = defaultSpeciesInfo, movePp = defaultMovePp, allowedPackSpecies = null } = options;
  const game = ctx.game, x = game === 'xd';
  const found = savePokemon.slotAt(ctx, place);
  if (!found) throw new Error('That slot doesn\'t exist in this save.');
  const b = found.bytes;
  const rawSpecies = b.readUInt16BE(0);
  const origRnd = b.readUInt32BE(x ? 0x28 : 0x04);
  const otId = b.readUInt32BE(x ? 0x24 : 0x14);
  if (!rawSpecies || rawSpecies !== identity.species || (origRnd >>> 0) !== (identity.rnd >>> 0) || (otId >>> 0) !== (identity.trainer >>> 0))
    throw new Error('That Pokémon is no longer in that slot. Refresh and try again.');

  const current = readSlot(ctx, place, { speciesInfo }).pokemon;
  if (current.egg) throw new Error('Eggs can\'t be edited.');

  // Species
  let nextSpecies = current.species;
  if (changes.species !== undefined && Number(changes.species) !== current.species) {
    if (current.shadow) throw new Error('A Shadow Pokémon\'s species can\'t be changed.');
    const wanted = Number(changes.species);
    if (!speciesAllowed(game, wanted, { receiver, allowedPackSpecies, originalSpecies: current.species }))
      throw new Error(within(GEN6_SPECIES, wanted)
        ? 'Turn on Generation 5 and 6 Pokémon under Settings → Gameplay to use that Pokémon.'
        : within(LATER_SPECIES, wanted)
          ? 'Turn on Generation 4 Pokémon under Settings → Gameplay to use that Pokémon.'
          : 'That Pokémon isn\'t available in this game.');
    nextSpecies = wanted;
  }
  const speciesChanged = nextSpecies !== current.species;
  const info = speciesInfo(nextSpecies) || defaultSpeciesInfo(nextSpecies, { gen6Stats: Boolean(receiver.gen6Stats) });
  if (!info) throw new Error(`Missing species data for Pokémon #${nextSpecies}.`);

  // Level & EXP
  const level = int(Number(changes.level), 1, 100, current.level);
  const growthRate = info.growthRate || 'mediumFast';
  const minExp = saveImport.expAt(growthRate, level);
  const maxExp = level < 100 ? saveImport.expAt(growthRate, level + 1) : Infinity;
  const exp = (level !== current.level || speciesChanged || current.exp < minExp || current.exp >= maxExp) ? minExp : current.exp;

  // Nature, Gender, Shiny -> Personality (rnd)
  const nature = int(Number(changes.nature), 0, 24, current.nature);
  const genderRatio = info.gender ?? teamSets.GENDER.none;
  const genderOptions = teamSets.genders(genderRatio);
  const gender = genderOptions.length === 2 && (changes.gender === 'M' || changes.gender === 'F')
    ? changes.gender
    : (genderOptions.length === 1 ? genderOptions[0] : (genderOptions.length === 2 ? current.gender : ''));
  const shiny = changes.shiny !== undefined ? Boolean(changes.shiny) : current.shiny;
  const nextRnd = personalityFor(otId, origRnd, { species: nextSpecies, nature, gender, shiny }, genderRatio);

  // Nickname
  const cleanedNick = changes.nickname !== undefined ? teamSets.cleanNickname(changes.nickname) : current.nickname;
  const defaultUpper = (info.gameName || info.name || '').toUpperCase().slice(0, teamSets.NICKNAME_LENGTH);
  const storedNick = cleanedNick || defaultUpper || current.rawNickname;

  // Ball, Friendship, Ability
  const ball = int(Number(changes.ball), 1, 12, current.ball);
  const friendship = int(Number(changes.friendship), 0, 255, current.friendship);
  const wantedAbility = changes.ability !== undefined ? Number(changes.ability) : current.ability;
  const canHidden = Boolean(info.hasHidden && (receiver.hiddenAbilities || current.ability === 2));
  const ability = wantedAbility === 2 && canHidden ? 2 : (info.abilityCount < 2 ? 0 : (wantedAbility === 1 ? 1 : 0));

  // Held item (keep rawItem intact if unchanged, e.g. a non-battle item the user didn't alter)
  let nextRawItem = current.rawItem;
  if (changes.item !== undefined) {
    const wantedItem = Number(changes.item);
    if (wantedItem === 0 && (changes.clearItem || !current.heldKeyItem)) {
      nextRawItem = 0;
    } else if (wantedItem !== current.item) {
      if (!Number.isInteger(wantedItem) || wantedItem < 0 || wantedItem > 0xffff) throw new Error('Invalid held item.');
      if (wantedItem > 0 && within(LATER_ITEMS, wantedItem) && !receiver.laterItems)
        throw new Error('Turn on Generation 4 battle rules under Settings → Gameplay to hold a Generation 4 item.');
      if (wantedItem > 0 && within(GEN6_ITEMS, wantedItem) && !receiver.gen6Items)
        throw new Error('Turn on X and Y battle rules (or Gen 6 items) under Settings → Gameplay to hold a Generation 5 or 6 item.');
      nextRawItem = wantedItem ? convert.itemFromColosseum(game, wantedItem) : 0;
    }
  }

  // Moves (1..4, Shadow moves on Shadow Pokémon preserved, no duplicates, no gaps)
  const origShadowMoves = current.moves.filter(m => m.shadow);
  const origNormalIds = new Set(current.moves.filter(m => !m.shadow).map(m => m.id));
  const origByKey = new Map(current.moves.map(m => [m.shadow ? `s:${m.rawId}` : `n:${m.id}`, m]));
  const rawList = Array.isArray(changes.moves) ? changes.moves : current.moves;
  const nextMoves = [];
  const seen = new Set();

  for (const item of rawList) {
    if (nextMoves.length >= 4 || !item) continue;
    if (item.shadow) {
      const orig = origShadowMoves.find(m => m.rawId === Number(item.rawId));
      if (!orig) continue;
      const k = `s:${orig.rawId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      nextMoves.push({ rawId: orig.rawId, pp: orig.pp, ppUps: orig.ppUps, shadow: true });
      continue;
    }
    const id = typeof item === 'number' ? item : Number(item.id);
    if (!id) continue;
    if (!moveAllowed(id, { receiver, originalMoves: origNormalIds }))
      throw new Error(FAIRY_MOVES.includes(id)
        ? 'Turn on Gen 6 types, Generation 5 and 6 Pokémon, or X and Y battle rules under Settings → Gameplay to teach that move.'
        : within(GEN6_MOVES, id)
          ? 'Turn on Generation 5 and 6 Pokémon or X and Y battle rules under Settings → Gameplay to teach that move.'
          : within(LATER_MOVES, id)
            ? 'Turn on Generation 4 Pokémon or battle rules under Settings → Gameplay to teach that move.'
            : `Move #${id} isn't available in this game.`);
    const k = `n:${id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const orig = origByKey.get(k);
    const ppUps = int(typeof item === 'object' && item.ppUps !== undefined ? Number(item.ppUps) : (orig?.ppUps ?? 0), 0, 3, 0);
    const basePp = movePp(id) || defaultMovePp(id);
    const maxPp = basePp ? Math.floor(basePp * (5 + ppUps) / 5) : (orig?.pp ?? 0);
    const origMaxPp = orig && basePp ? Math.floor(basePp * (5 + orig.ppUps) / 5) : null;
    const pp = (!orig || orig.ppUps !== ppUps || orig.pp > maxPp || (origMaxPp !== null && orig.pp === origMaxPp))
      ? maxPp
      : orig.pp;
    nextMoves.push({ rawId: convert.moveFromColosseum(game, id), pp, ppUps, shadow: false });
  }
  // Ensure every Shadow move on a Shadow Pokémon stays intact even if a client omitted it.
  if (current.shadow) {
    for (const orig of origShadowMoves) {
      const k = `s:${orig.rawId}`;
      if (!seen.has(k) && nextMoves.length < 4) {
        seen.add(k);
        nextMoves.push({ rawId: orig.rawId, pp: orig.pp, ppUps: orig.ppUps, shadow: true });
      }
    }
  }
  if (!nextMoves.length) throw new Error('Choose at least one move.');

  // EVs (0–255 per stat, sum <= 510: retail Gen 3 saves can hold 255 in a stat) and IVs (0–31)
  const evs = Array.isArray(changes.evs) ? cleanSaveEvs(changes.evs) : current.evs.slice();
  const ivs = Array.isArray(changes.ivs) ? changes.ivs.map((v, i) => int(Number(v), 0, 31, current.ivs[i])) : current.ivs.slice();

  // Stats & HP
  const newStats = statsOf(nextSpecies, info.stats, { level, ivs, evs, nature });
  const oldMaxHp = current.stats[0];
  const nextHp = (oldMaxHp === 0 || current.hp >= oldMaxHp || current.hp > newStats[0]) ? newStats[0] : current.hp;

  const movesChanged = nextMoves.length !== current.moves.length || nextMoves.some((m, i) =>
    m.rawId !== current.moves[i].rawId || m.ppUps !== current.moves[i].ppUps);
  const changed = speciesChanged || storedNick !== current.rawNickname || level !== current.level
    || (nextRnd >>> 0) !== (origRnd >>> 0) || ball !== current.ball || friendship !== current.friendship
    || nextRawItem !== current.rawItem || ability !== current.ability || movesChanged
    || evs.some((v, i) => v !== current.evs[i]) || ivs.some((v, i) => v !== current.ivs[i]);

  // --- Write updated fields in place ---
  const flagAt = x ? 0x1a : 0xce;
  const nextRawSpecies = convert.speciesFromColosseum(game, nextSpecies);
  if (!changed) {
    return {
      area: found.area, box: found.box, slot: found.slot,
      nickname: cleanedNick || info.name, species: nextRawSpecies,
      edited: Boolean(b[flagAt] & savePokemon.EDITED_FLAG),
      identity: { species: nextRawSpecies, rnd: nextRnd >>> 0, trainer: otId >>> 0 }
    };
  }
  b.writeUInt16BE(nextRawSpecies, 0);
  b.writeUInt32BE(nextRnd >>> 0, x ? 0x28 : 0x04);
  b[0x0f] = ball;
  writeUtf16(b, x ? 0x4e : 0x2e, storedNick, 11);
  if (speciesChanged) {
    writeUtf16(b, x ? 0x64 : 0x44, defaultUpper || storedNick, 11);
    // A purified former Shadow that changed species drops its historical Shadow id so nothing mismatches.
    if (current.shadowId && !current.shadow) b.writeUInt16BE(0, x ? 0xba : 0xd8);
  }
  b.writeUInt32BE(exp >>> 0, x ? 0x20 : 0x5c);
  b[x ? 0x11 : 0x60] = level;

  const moveAt = x ? 0x80 : 0x78;
  for (let i = 0; i < 4; i++) {
    const move = nextMoves[i], at = moveAt + 4 * i;
    if (move) {
      b.writeUInt16BE(move.rawId, at);
      b[at + 2] = Math.min(255, move.pp);
      b[at + 3] = move.ppUps;
    } else {
      b.fill(0, at, at + 4);
    }
  }

  b.writeUInt16BE(nextRawItem, x ? 0x02 : 0x88);
  b.writeUInt16BE(nextHp, x ? 0x04 : 0x8a);
  newStats.forEach((v, i) => b.writeUInt16BE(v, (x ? 0x90 : 0x8c) + 2 * i));
  evs.forEach((v, i) => b.writeUInt16BE(v, (x ? 0x9c : 0x98) + 2 * i));
  ivs.forEach((v, i) => { if (x) b[0xa8 + i] = v & 0x1f; else b.writeUInt16BE(v & 0x1f, 0xa4 + 2 * i); });
  b.writeUInt16BE(friendship, x ? 0x06 : 0xb0);
  if (x) b[0x1d] = ability === 2 ? ((b[0x1d] & ~0x40) | 0x10) : ((b[0x1d] & ~0x50) | (ability ? 0x40 : 0));
  else b[0xcc] = ability;

  // Mark the Pokémon as edited whenever any field changed (bit 7 of flagAmari; never cleared once set).
  b[flagAt] |= savePokemon.EDITED_FLAG;

  // Keep Shadow records in sync when a Shadow Pokémon's personality, IVs or ball changed.
  if (current.shadow && current.shadowId) {
    if (x) {
      const record = savePokemon.xdRecord(ctx, current.shadowId);
      if (record) {
        const word4 = record.readUInt32BE(0x04);
        record.writeUInt32BE(((word4 & ~0x0f00) | ((ball & 0x0f) << 8)) >>> 0, 0x04);
        ivs.forEach((v, i) => { record[XD_RECORD_IVS + i] = v & 0x1f; });
        record.writeUInt32BE(nextRnd >>> 0, XD_RECORD_PID);
      }
    } else if (nextRnd !== origRnd) {
      if (current.shadowId >= entries.SIDE_FIRST) {
        const idx = current.shadowId - entries.SIDE_FIRST, size = entries.entrySize('colosseum');
        if (ctx.side && (idx + 1) * size <= ctx.side.length && ctx.side.readUInt32BE(idx * size + 8) === origRnd)
          ctx.side.writeUInt32BE(nextRnd >>> 0, idx * size + 8);
      } else if (current.shadowId >= 1 && current.shadowId <= 0x60) {
        const at = C_RUNTIME_PID(current.shadowId);
        if (at + 4 <= ctx.plain.length && ctx.plain.readUInt32BE(at) === origRnd)
          ctx.plain.writeUInt32BE(nextRnd >>> 0, at);
      }
    }
  }

  return {
    area: found.area,
    box: found.box,
    slot: found.slot,
    nickname: cleanedNick || info.name,
    species: nextRawSpecies,
    edited: Boolean(b[flagAt] & savePokemon.EDITED_FLAG),
    identity: { species: nextRawSpecies, rnd: nextRnd >>> 0, trainer: otId >>> 0 }
  };
}

// Fallback battle data built from bundled Gen 3–6 JSON when Colosseum's disc isn't set up (e.g. an XD-only setup).
function fallbackBattleData() {
  const abilityByName = new Map();
  for (const [id, entry] of Object.entries(gen6.abilities)) abilityByName.set(entry.name, { id: Number(id), name: entry.name, doc: entry.description || '' });
  for (const [id, entry] of Object.entries(gen4.abilities)) if (!abilityByName.has(entry.name)) abilityByName.set(entry.name, { id: Number(id), name: entry.name, doc: entry.description || '' });

  const moveId = n => (n >= 355 ? n + 3 : n);
  const allMoves4 = Object.entries(gen4.moves).map(([n, m]) => ({
    id: moveId(Number(n)), national: Number(n), name: m.name, type: m.type, power: m.power, accuracy: m.accuracy,
    pp: m.pp, priority: m.priority, category: m.category, contact: Boolean(m.contact), doc: m.description || ''
  }));
  const gen3Moves = allMoves4.filter(m => m.national <= 354)
    .map(m => ({ ...m, category: m.power ? teamSets.category(m.type) : 'Status' }));
  const gen4Moves = allMoves4.filter(m => m.id <= 470);
  const gen6Moves = Object.entries(gen6.moves).map(([n, m]) => ({
    id: moveId(Number(n)), national: Number(n), name: m.name, type: m.type, power: m.power, accuracy: m.accuracy,
    pp: m.pp, priority: m.priority, category: m.category, contact: Boolean(m.contact), doc: m.description || ''
  }));

  const learnList = (entry, shift) => {
    if (!entry) return [];
    const seen = new Map();
    const add = (id, how) => { const mid = shift ? moveId(id) : id; if (!seen.has(mid)) seen.set(mid, how); };
    for (const [lv, id] of entry.levelUp || []) add(id, `Lv ${lv}`);
    for (const id of entry.tm || []) add(id, 'TM');
    for (const id of entry.tutor || []) add(id, 'Tutor');
    for (const id of entry.egg || []) add(id, 'Egg');
    for (const id of entry.event || []) add(id, 'Event');
    for (const id of entry.sketch || []) add(id, 'Sketch');
    return [...seen];
  };

  const species3 = {}, species4 = {}, dex3 = [], dex4 = [];
  for (const [natStr, entry] of Object.entries(gen4.species)) {
    const national = Number(natStr), id = saveImport.speciesFromNational(national);
    if (!id) continue;
    const gender = genderRatioOf(entry);
    const abilities = (entry.abilities || []).map((name, slot) => {
      const a = abilityByName.get(name);
      return { slot, id: a?.id || 0, name, doc: a?.doc || '' };
    }).filter((a, i, arr) => !i || a.name !== arr[0].name);
    const s = entry.stats;
    const stats = [s.hp, s.attack, s.defense, s.spAttack, s.spDefense, s.speed];
    const dexEntry = { id, national, name: entry.name, types: entry.types, abilities: abilities.map(a => a.name), stats, sprite: null };
    if (national <= 386) {
      species3[id] = { name: entry.name, national, gender, abilities, learnset: learnList(gen3Learnsets[national], false) };
      dex3.push(dexEntry);
    }
    const ls4 = new Map(learnList(gen4Learnsets[national], true));
    for (const [m, how] of learnList(gen3Learnsets[national], false)) if (!ls4.has(m)) ls4.set(m, `${how} (Gen 3)`);
    species4[id] = { name: entry.name, national, gender, abilities, learnset: [...ls4] };
    if (national > 386) dex4.push({ ...dexEntry, generation: 4 });
  }

  const species6 = {}, dex6 = [];
  for (const [natStr, entry] of Object.entries(gen6.species)) {
    const national = Number(natStr);
    const id = national > 721 ? national + 26 : saveImport.speciesFromNational(national);
    if (!id) continue;
    const gender = genderRatioOf(entry);
    const own = (entry.abilities || []).map((name, slot) => {
      const a = abilityByName.get(name);
      return { slot, id: a?.id || 0, name, doc: a?.doc || '' };
    }).filter((a, i, arr) => !i || a.name !== arr[0].name);
    const hiddenAbility = entry.hidden && !own.some(a => a.name === entry.hidden)
      ? { slot: 2, id: abilityByName.get(entry.hidden)?.id || 0, name: entry.hidden, doc: abilityByName.get(entry.hidden)?.doc || '', hidden: true }
      : null;
    const abilities = hiddenAbility ? [...own, hiddenAbility] : own;
    const s = entry.stats;
    const stats = [s.hp, s.attack, s.defense, s.spAttack, s.spDefense, s.speed];
    const ls6 = new Map(learnList(gen6Learnsets[national] || entry, true));
    for (const [m, how] of species4[id]?.learnset || []) if (!ls6.has(m)) ls6.set(m, /\(Gen \d\)$/.test(how) ? how : `${how} (Gen 4)`);
    species6[id] = { name: entry.name, national, gender, abilities, ...(hiddenAbility ? { hidden: hiddenAbility } : {}), learnset: [...ls6] };
    if (national > 386) {
      dex6.push({ id, national, name: entry.name, types: entry.types, abilities: own.map(a => a.name), stats, sprite: null, generation: national <= 493 ? 4 : 6 });
    }
  }

  return {
    fallback: true,
    moves: gen3Moves,
    items: [],
    balls: BALLS,
    species: species3,
    dex: dex3,
    categories: {
      4: Object.fromEntries(gen4Moves.map(m => [m.id, m.category])),
      6: Object.fromEntries(gen6Moves.map(m => [m.id, m.category]))
    },
    generations: {
      4: {
        generation: 4,
        moves: gen4Moves,
        items: gen4Items.map(item => ({ ...item, berry: Boolean(item.berry), generation: 4 })).sort((a, b) => a.name.localeCompare(b.name)),
        species: species4,
        dex: dex4
      },
      6: {
        generation: 6,
        moves: gen6Moves,
        items: gen6Items.map(item => ({ ...item, berry: Boolean(item.berry), generation: item.id >= GEN6_ITEMS[0] ? 6 : 4 })).sort((a, b) => a.name.localeCompare(b.name)),
        species: species6,
        dex: dex6
      }
    }
  };
}

module.exports = {
  BALLS, GROWTH, SHADOW_MOVES, SHADOW_MOVE_NAMES,
  isShadowMove, shadowMoveName, isShiny, statsOf, genderRatioOf, defaultSpeciesInfo, defaultMovePp,
  personalityFor, readSlot, applyEdit, fallbackBattleData
};
