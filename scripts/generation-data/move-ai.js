'use strict';

// Makes src/generations/move-ai.json: for each move past the third generation's (Roost, 355, to Hyperspace Fury, 621),
// the game's own move whose trainer AI (the CPU's value, hit and damage functions: its move row's +0x1C, host/
// pokemonpacks.c and host/xd/packs.c) fits it best, from what Pokémon Showdown's generation 6 data says it does (@pkmn/dex,
// MIT). A new move plays the effect and animation of the move its row is copied from (gen4-colosseum.json's and
// gen6-colosseum.json's `as`), which isn't always one the CPU should judge it by: Drill Run plays as Horn Drill, and
// Light of Ruin as Moonlight. A move the CPU can't use well (Heal Pulse on a foe, Celebrate) is judged as Splash, which
// it rarely picks.
//
// usage: node move-ai.js
const fs = require('node:fs');
const path = require('node:path');
const { Dex } = require('@pkmn/dex');

const OUT = path.join(__dirname, '..', '..', 'src', 'generations', 'move-ai.json');
const dex = Dex.forGen(6);
const GAME_LAST = 354;   // the third generation's last move: the AI's table has these

// By name, where no rule below says it right
const OWN = {
  'Me First': 'Mirror Move', 'Copycat': 'Mirror Move', 'Acupressure': 'Swords Dance', 'Psycho Shift': 'Toxic', 'Captivate': 'Charm',
  'Switcheroo': 'Trick', 'Bestow': 'Trick', 'Miracle Eye': 'Foresight', 'Embargo': 'Disable', 'Heal Block': 'Disable',
  'Gastro Acid': 'Skill Swap', 'Worry Seed': 'Skill Swap', 'Simple Beam': 'Skill Swap', 'Entrainment': 'Skill Swap',
  'Power Trick': 'Psych Up', 'Power Swap': 'Psych Up', 'Guard Swap': 'Psych Up', 'Heart Swap': 'Psych Up',
  'Guard Split': 'Pain Split', 'Power Split': 'Pain Split', 'Topsy-Turvy': 'Haze', 'Defog': 'Sweet Scent',
  'Healing Wish': 'Memento', 'Lunar Dance': 'Memento', 'Final Gambit': 'Explosion', 'Lucky Chant': 'Safeguard',
  'Tailwind': 'Agility', 'Aqua Ring': 'Ingrain', 'Fairy Lock': 'Mean Look', 'Rage Powder': 'Follow Me',
  'Sticky Web': 'Spikes', 'Stealth Rock': 'Spikes', 'Toxic Spikes': 'Spikes', 'Parting Shot': 'Growl',
  'Electro Ball': 'Return', 'Gyro Ball': 'Return', 'Heavy Slam': 'Low Kick', 'Heat Crash': 'Low Kick', 'Grass Knot': 'Low Kick',
  'Rototiller': 'Growth', 'Flower Shield': 'Growth', 'Magnetic Flux': 'Growth', 'Aromatic Mist': 'Helping Hand',
  'Hold Hands': 'Helping Hand', 'After You': 'Helping Hand', 'Quash': 'Helping Hand', 'Ally Switch': 'Helping Hand',
  'Geomancy': 'Calm Mind', 'Belly Drum': 'Belly Drum', 'Nature Power': 'Nature Power'
};
// Field and odd ones the CPU has no good use for, or would misuse: judged as Splash (its value function rarely picks it)
const IDLE = new Set(['Heal Pulse', 'Celebrate', 'Happy Hour', 'Ion Deluge', 'Electrify', 'Powder', 'Telekinesis', 'Soak',
  'Forest\'s Curse', 'Trick-or-Treat', 'Reflect Type', 'Wonder Room', 'Magic Room', 'Crafty Shield', 'Magnet Rise']);
const FIELD = { 'Trick Room': 'Mist', 'Gravity': 'Mist', 'Electric Terrain': 'Sunny Day', 'Grassy Terrain': 'Sunny Day',
  'Misty Terrain': 'Safeguard', 'Mud Sport': 'Mud Sport', 'Water Sport': 'Water Sport' };
const STATUS = { par: 'Thunder Wave', slp: 'Hypnosis', psn: 'Poison Powder', tox: 'Toxic', brn: 'Will-O-Wisp' };
const SECONDARY_STATUS = { brn: 'Flamethrower', par: 'Thunderbolt', frz: 'Ice Beam', psn: 'Sludge Bomb', tox: 'Poison Fang', slp: 'Tackle' };
const TARGET_DROP = { atk: 'Aurora Beam', def: 'Iron Tail', spa: 'Mist Ball', spd: 'Psychic', spe: 'Icy Wind', accuracy: 'Mud-Slap', evasion: 'Tackle' };

function selfBoostAi(boosts) {
  const up = Object.keys(boosts).filter(stat => boosts[stat] > 0), most = Math.max(...Object.values(boosts));
  const has = (...stats) => stats.every(stat => up.includes(stat));
  if (has('atk', 'spe') || has('spa', 'spe') && up.includes('atk')) return 'Dragon Dance';
  if (has('spa', 'spd')) return 'Calm Mind';
  if (has('atk', 'def')) return 'Bulk Up';
  if (has('atk', 'spa')) return 'Growth';
  if (has('def', 'spd')) return 'Cosmic Power';
  if (up.length === 1) {
    const [stat] = up;
    if (stat === 'atk') return most >= 2 ? 'Swords Dance' : 'Howl';
    if (stat === 'def') return most >= 3 ? 'Acid Armor' : most >= 2 ? 'Iron Defense' : 'Harden';
    if (stat === 'spa') return 'Tail Glow';
    if (stat === 'spd') return 'Amnesia';
    if (stat === 'spe') return 'Agility';
    if (stat === 'evasion') return 'Double Team';
  }
  return up.includes('atk') ? 'Howl' : 'Growth';
}
function targetDropAi(boosts) {
  const down = Object.keys(boosts).filter(stat => boosts[stat] < 0), most = Math.min(...Object.values(boosts));
  if (down.length > 1) return 'Growl';
  const [stat] = down;
  return { atk: most <= -2 ? 'Charm' : 'Growl', def: most <= -2 ? 'Screech' : 'Leer', spa: most <= -2 ? 'Charm' : 'Growl',
    spd: 'Fake Tears', spe: most <= -2 ? 'Scary Face' : 'String Shot', accuracy: 'Sand-Attack', evasion: 'Sweet Scent' }[stat] || 'Growl';
}

function aiFor(move) {
  if (OWN[move.name]) return OWN[move.name];
  if (IDLE.has(move.name)) return 'Splash';
  if (FIELD[move.name]) return FIELD[move.name];
  if (move.category === 'Status') {
    if (move.stallingMove || /Shield|Guard$|^Mat Block$/.test(move.name)) return 'Protect';
    if (move.status) return STATUS[move.status] || 'Toxic';
    if (move.volatileStatus === 'confusion') return 'Confuse Ray';
    if (move.volatileStatus === 'attract') return 'Attract';
    if (move.flags.heal && (move.target === 'self' || move.heal)) return 'Recover';
    if (move.boosts && (move.target === 'self' || move.target === 'adjacentAllyOrSelf' || move.target === 'allySide')) return selfBoostAi(move.boosts);
    if (move.boosts) return targetDropAi(move.boosts);
    if (move.selfSwitch) return 'Baton Pass';
    return 'Splash';
  }
  // damaging
  if (move.ohko) return 'Fissure';
  if (move.selfdestruct) return 'Explosion';
  if (move.flags.charge) return ['Phantom Force', 'Shadow Force', 'Sky Drop', 'Bounce', 'Dive', 'Dig', 'Fly'].includes(move.name) ? 'Fly' : 'Solar Beam';
  if (move.self?.volatileStatus === 'mustrecharge') return 'Hyper Beam';
  if (move.drain) return 'Giga Drain';
  if (move.recoil) return move.recoil[0] / move.recoil[1] >= 0.33 ? 'Double-Edge' : 'Take Down';
  if (move.multihit) return Array.isArray(move.multihit) ? 'Fury Attack' : move.multihit === 2 ? 'Double Kick' : 'Triple Kick';
  if (move.priority > 0) return 'Quick Attack';
  if (move.priority < 0 || move.forceSwitch) return 'Vital Throw';
  if (move.volatileStatus === 'partiallytrapped') return 'Fire Spin';
  const secondary = move.secondaries?.[0];
  if (secondary?.status) return SECONDARY_STATUS[secondary.status] || 'Tackle';
  if (secondary?.volatileStatus === 'flinch') return 'Headbutt';
  if (secondary?.volatileStatus === 'confusion') return 'Confusion';
  if (secondary?.self?.boosts) return 'Metal Claw';
  if (secondary?.boosts) return TARGET_DROP[Object.keys(secondary.boosts)[0]] || 'Tackle';
  if (move.self?.boosts) return Object.keys(move.self.boosts).includes('spa') ? 'Overheat' : 'Superpower';
  if ((move.critRatio || 1) >= 2) return 'Slash';
  return 'Tackle';
}

const out = {};
for (let n = GAME_LAST + 1; n <= 621; n++) {
  const move = dex.moves.all().find(m => m.num === n && !m.isZ && !m.isMax);
  if (!move) continue;
  const ai = aiFor(move), own = dex.moves.get(ai);
  if (!own.exists || own.num > GAME_LAST) throw new Error(`${move.name}: ${ai} isn't one of the third generation's moves`);
  out[n] = ai;
}
fs.writeFileSync(OUT, `${JSON.stringify({ about: 'Each move past the third generation\'s, by its National number: the game\'s own move whose trainer AI it is judged by (scripts/generation-data/move-ai.js).', moves: out }, null, 1)}\n`);
console.log(`move-ai.json: ${Object.keys(out).length} moves`);
