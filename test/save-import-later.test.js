'use strict';

// Import from Generation 5 and 6 saves (src/gen5-save.js, src/gen6-save.js, src/save-import.js). The saves here are
// built by this file's own encoder from the published formats (PKHeX's PK5, PK6, SAV5, SAV6 and PokeCrypto): no real
// Black, White, X, Y, Omega Ruby or Alpha Sapphire save has been read.
const test = require('node:test');
const assert = require('node:assert/strict');
const ds = require('../src/ds-save');
const gen5Save = require('../src/gen5-save');
const gen6Save = require('../src/gen6-save');
const si = require('../src/save-import');
const convert = require('../src/trade-convert');

const FULL = { game: 'colosseum', laterPokemon: true, laterMoves: true, laterItems: true, gen6Pokemon: true, gen6Moves: true, gen6Items: true, hiddenAbilities: true };
const OLD = { game: 'colosseum', laterPokemon: false, laterMoves: false, laterItems: false, gen6Pokemon: false, gen6Moves: false, gen6Items: false, hiddenAbilities: false };
const text = codes => String.fromCharCode(...codes);
const units = word => [...word].map(c => c.charCodeAt(0));
const shinyXor = (otId, pid) => (otId >>> 16) ^ (otId & 0xFFFF) ^ (pid >>> 16) ^ (pid & 0xFFFF);
const isGcShiny = (otId, rnd) => shinyXor(otId, rnd) < 8;
const OT_ID = ((54321 << 16) | 12345) >>> 0;

// PKHeX's CRC16_CCITT, as published (Checksums.cs), to check the one the saves are read with
function pkhexCrc(bytes) {
  let top = 0xFF, bot = 0xFF;
  for (const b of bytes) {
    let x = b ^ top;
    x ^= x >> 4;
    top = (bot ^ (x >> 3) ^ (x << 4)) & 0xFF;
    bot = (x ^ (x << 5)) & 0xFF;
  }
  return (top << 8) | bot;
}

// Each block's place for its id (PokeCrypto's BlockPosition): the stored block at order[id] is block id
const shuffle = (plain, order, size) => {
  const out = Buffer.alloc(plain.length);
  for (let id = 0; id < 4; id++) plain.copy(out, order[id] * size, id * size, id * size + size);
  return out;
};
const sum16 = (b, from, to) => { let s = 0; for (let i = from; i < to; i += 2) s = (s + b.readUInt16LE(i)) & 0xFFFF; return s; };

// ---- a PK5 (136 bytes, 220 in the party) ----
function pk5({ pid = 0x5A5A00F0, otId = OT_ID, species = 571, item = 0, exp = 125000, ability = 149, hidden = false, moves = [539, 247, 417], pp = [10, 15, 20],
  evs = [4, 252, 0, 252, 0, 0], ivWord = 31 | (31 << 5) | (31 << 10) | (31 << 15) | (31 << 20) | (31 << 25), hoenn = 0, female = false, form = 0, nature = 15,
  nickname = 'Zoroark', otName = 'Touko', language = 2, hometown = 21, ball = 4, metLevel = 30, party = true, badChecksum = false } = {}) {
  const b = Buffer.alloc(136);
  b.writeUInt32LE(pid >>> 0, 0);
  b.writeUInt16LE(species, 0x08); b.writeUInt16LE(item, 0x0A); b.writeUInt32LE(otId >>> 0, 0x0C); b.writeUInt32LE(exp, 0x10);
  b[0x14] = 120; b[0x15] = ability; b[0x17] = language;
  Buffer.from(evs).copy(b, 0x18);
  moves.forEach((move, i) => { b.writeUInt16LE(move, 0x28 + 2 * i); b[0x30 + i] = pp[i]; });
  b.writeUInt32LE(ivWord >>> 0, 0x38); b.writeUInt32LE(hoenn >>> 0, 0x3C);
  b[0x40] = (female ? 2 : 0) | (form << 3); b[0x41] = nature; b[0x42] = hidden ? 1 : 0;
  [...units(nickname), 0xFFFF].forEach((code, i) => b.writeUInt16LE(code, 0x48 + 2 * i));
  b[0x5F] = hometown;
  [...units(otName), 0xFFFF].forEach((code, i) => b.writeUInt16LE(code, 0x68 + 2 * i));
  b[0x83] = ball; b[0x84] = metLevel | 0x80;
  const sum = sum16(b, 8, 136) ^ (badChecksum ? 1 : 0);
  const out = Buffer.alloc(party ? 220 : 136);
  b.copy(out, 0, 0, 8);
  out.writeUInt16LE(sum, 6);
  ds.cipher(shuffle(b.subarray(8, 136), ds.ORDERS[((pid >>> 13) & 31) % 24], 32), sum).copy(out, 8);
  if (party) { const extra = Buffer.alloc(84); extra[4] = 50; ds.cipher(extra, pid).copy(out, 136); }
  return out;
}

// A Black/White (or Black 2/White 2) save: each block with its CRC two bytes after it and in the checksum table
function gen5File({ game = 'bw', party = [], boxed = [], trainer = 'Touko', version = 21, damage = null } = {}) {
  const info = gen5Save.GAMES[game], data = Buffer.alloc(gen5Save.SAVE_SIZE);
  [...units(trainer), 0xFFFF].forEach((code, i) => data.writeUInt16LE(code, gen5Save.TRAINER_AT + 4 + 2 * i));
  data.writeUInt16LE(12345, gen5Save.TRAINER_AT + 0x14); data.writeUInt16LE(54321, gen5Save.TRAINER_AT + 0x16);
  data[gen5Save.TRAINER_AT + 0x1F] = version;
  data[gen5Save.PARTY.at + 4] = party.length;
  party.forEach((mon, i) => mon.copy(data, gen5Save.PARTY.at + 8 + i * 220));
  for (const { box, slot, mon } of boxed) mon.copy(data, gen5Save.boxBlock(box).at + slot * 136);
  [...units('Box 1'), 0xFFFF].forEach((code, i) => data.writeUInt16LE(code, 4 + 2 * i));
  const blocks = [[0, gen5Save.BOX_NAMES], ...Array.from({ length: 24 }, (_, b) => [1 + b, gen5Save.boxBlock(b)]),
    [26, gen5Save.PARTY], [27, { at: gen5Save.TRAINER_AT, length: info.trainer }]];
  const table = info.size - 0x100;
  for (const [id, { at, length }] of blocks) {
    const crc = ds.crc16(data.subarray(at, at + length));
    data.writeUInt16LE(crc, at + length + 2);
    data.writeUInt16LE(crc, table + 2 * id);
  }
  data.writeUInt16LE(ds.crc16(data.subarray(table, table + info.table)), table + info.table + 0x0E);
  if (damage) data[damage] ^= 0xFF;
  return data;
}

// ---- a PK6 (232 bytes, 260 in the party) ----
function pk6({ ec = 0x13572468, pid = 0x00000000, otId = OT_ID, species = 662, item = 0, exp = 30000, ability = 177, abilityNumber = 4, nature = 3, female = true,
  form = 0, evs = [0, 252, 0, 252, 4, 0], moves = [413, 53, 512], pp = [15, 15, 15], ivWord = 20 | (21 << 5) | (22 << 10) | (23 << 15) | (24 << 20) | (25 << 25),
  nickname = 'Fletchinder', otName = 'Serena', language = 2, hometown = 24, ball = 4, metLevel = 17, ribbons = 0, handler = 0, nicknamed = false, party = true,
  badChecksum = false } = {}) {
  const b = Buffer.alloc(0xE8);
  b.writeUInt32LE(ec >>> 0, 0);
  b.writeUInt16LE(species, 0x08); b.writeUInt16LE(item, 0x0A); b.writeUInt32LE(otId >>> 0, 0x0C); b.writeUInt32LE(exp, 0x10);
  b[0x14] = ability; b[0x15] = abilityNumber; b.writeUInt32LE(pid >>> 0, 0x18); b[0x1C] = nature; b[0x1D] = (female ? 2 : 0) | (form << 3);
  Buffer.from(evs).copy(b, 0x1E);
  b[0x30] = ribbons;
  [...units(nickname), 0].forEach((code, i) => b.writeUInt16LE(code, 0x40 + 2 * i));
  moves.forEach((move, i) => { b.writeUInt16LE(move, 0x5A + 2 * i); b[0x62 + i] = pp[i]; });
  b.writeUInt32LE((ivWord | (nicknamed ? 1 << 31 : 0)) >>> 0, 0x74);
  b[0x93] = handler; b[0xA2] = 200; b[0xCA] = 90;
  [...units(otName), 0].forEach((code, i) => b.writeUInt16LE(code, 0xB0 + 2 * i));
  b[0xDC] = ball; b[0xDD] = metLevel | 0x80; b[0xDF] = hometown; b[0xE3] = language;
  const sum = sum16(b, 8, 0xE8) ^ (badChecksum ? 1 : 0);
  b.writeUInt16LE(sum, 6);
  const out = Buffer.alloc(party ? 0x104 : 0xE8);
  b.copy(out, 0, 0, 8);
  ds.cipher(shuffle(b.subarray(8, 0xE8), ds.ORDERS[((ec >>> 13) & 31) % 24], 56), ec).copy(out, 8);
  if (party) { const extra = Buffer.alloc(0x1C); extra[4] = 30; ds.cipher(extra, ec).copy(out, 0xE8); }
  return out;
}

// An X/Y (or Omega Ruby/Alpha Sapphire) "main" file: the blocks, then the table 0x200 before the end with "BEEF"
function gen6File({ game = 'xy', party = [], boxed = [], trainer = 'Serena', version = 24, damage = null } = {}) {
  const info = gen6Save.GAMES[game], data = Buffer.alloc(info.size);
  const status = gen6Save.STATUS.at;
  data.writeUInt16LE(12345, status); data.writeUInt16LE(54321, status + 2); data[status + 4] = version;
  units(trainer).forEach((code, i) => data.writeUInt16LE(code, status + 0x48 + 2 * i));
  party.forEach((mon, i) => mon.copy(data, gen6Save.PARTY.at + i * 0x104));
  data[gen6Save.PARTY.at + 6 * 0x104] = party.length;
  for (const { box, slot, mon } of boxed) mon.copy(data, info.box.at + (box * 30 + slot) * 0xE8);
  units('BOX 1').forEach((code, i) => data.writeUInt16LE(code, gen6Save.LAYOUT.at + 2 * i));
  const table = info.size - 0x200;
  data.writeUInt32LE(gen6Save.BEEF, table + 0x10);
  for (const block of [gen6Save.LAYOUT, gen6Save.STATUS, gen6Save.PARTY, info.box]) {
    const entry = table + 0x14 + block.id * 8;
    data.writeUInt32LE(block.length, entry); data.writeUInt16LE(block.id, entry + 4);
    data.writeUInt16LE(ds.crc16(data.subarray(block.at, block.at + block.length)), entry + 6);
  }
  if (damage) data[damage] ^= 0xFF;
  return data;
}

test('the saves\' CRC-16 is PKHeX\'s CRC16_CCITT', () => {
  assert.equal(ds.crc16(Buffer.from('123456789')), 0x29B1);
  const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + (i >> 3)) & 0xFF));
  assert.equal(ds.crc16(bytes), pkhexCrc(bytes));
});

test('a PK6 deciphers to what was enciphered, its blocks in their places, and an empty slot is nothing', () => {
  for (const ec of [0, 0x2000, 0x13572468, 0xFFFFFFFF, 0x0003E000]) {
    const mon = gen6Save.decipher(pk6({ ec, party: false }));
    assert.ok(mon.whole, `EC ${ec.toString(16)}`);
    assert.equal(mon.data.readUInt16LE(0x08), 662);
    assert.equal(mon.data.readUInt32LE(0x0C), OT_ID);
    assert.equal(mon.data.readUInt16LE(0x5A), 413);
    assert.equal(text([...Array(6).keys()].map(i => mon.data.readUInt16LE(0xB0 + 2 * i))), 'Serena');
  }
  assert.equal(gen6Save.decipher(Buffer.alloc(0xE8)), null);
  // an empty slot the game wrote as zeros enciphered (EC 0, checksum 0)
  const blank = Buffer.alloc(0xE8);
  ds.cipher(Buffer.alloc(0xE0), 0).copy(blank, 8);
  assert.equal(gen6Save.decipher(blank), null);
  assert.equal(gen6Save.decipher(pk6({ badChecksum: true, party: false })).whole, false);
});

test('a Black or White save: its trainer, party and boxes, the Pokémon in Colosseum\'s numbers', () => {
  // Zoroark (571, the game's 597): Night Daze (539, the game's 542), Shadow Ball, Nasty Plot; Timid (15), female; Eviolite
  const zoroark = pk5({ female: true, item: 538 });
  const boxed = pk5({ species: 1, nickname: 'Bulbasaur', ability: 34, hidden: true, moves: [33], pp: [35], exp: 1000, nature: 0, pid: 0x00000019, party: false });
  const file = si.parse(gen5File({ party: [zoroark], boxed: [{ box: 2, slot: 4, mon: boxed }] }));
  assert.equal(file.kind, 'bw');
  assert.equal(file.gameName, 'Black');
  assert.equal(file.trainer, 'Touko');
  assert.equal(file.trainerId, 12345);
  assert.equal(file.boxes.length, 24);
  assert.equal(file.boxes[0].name, 'Box 1');
  const p = file.party[0].pokemon;
  assert.equal(p.species, 597);
  assert.equal(p.nicknameText, 'Zoroark');
  assert.equal(text(p.otName), 'Touko');
  assert.equal(p.otId, OT_ID);
  assert.deepEqual(p.moves.map(move => move.id), [542, 247, 420]);
  assert.equal(p.item, 0x28B);
  assert.deepEqual(p.attest, [12, 3, 2, 2]);
  assert.deepEqual(p.evs, [4, 252, 0, 0, 0, 252]);
  assert.deepEqual([p.ball, p.metLevel, p.otGender], [4, 30, 1]);
  // its nature (Timid) and gender (female, under Zoroark's 31) made the personality's, as Colosseum reads them
  assert.notEqual(0x5A5A00F0 % 25, 15);
  assert.equal(p.rnd % 25, 15);
  assert.ok((p.rnd & 0xFF) < 31);
  assert.equal(isGcShiny(OT_ID, p.rnd), false);
  // the same Pokémon gets the same personality each time
  assert.equal(si.parse(gen5File({ party: [zoroark] })).party[0].pokemon.rnd, p.rnd);
  // level 50 (medium slow: 125000 experience) and stats from Zoroark's base stats, the 4 EVs in HP
  assert.equal(p.level, 50);
  assert.deepEqual(p.stats, si.statsOf(571, 50, p.ivs, p.evs, 15));
  // Generation 5 and 6 Pokémon need their setting; the Eviolite comes off without X and Y battle rules
  assert.match(si.judge(file.party[0], OLD).problems[0], /Generation 5 or 6 Pokémon/);
  const judged = si.judge(file.party[0], { ...FULL, gen6Items: false });
  assert.deepEqual(judged.problems, []);
  assert.equal(judged.pokemon.item, 0);
  assert.match(judged.notes[0], /Generation 5 or 6 item needs X and Y battle rules/);
  for (const game of ['colosseum', 'xd']) {
    const done = si.judge(file.party[0], { ...FULL, game });
    const back = convert.read(game, done.bytes);
    assert.deepEqual([back.species, back.rnd % 25, back.otId, back.level, back.item, back.nicknameText], [597, 15, OT_ID, 50, 0x28B, 'Zoroark']);
    assert.deepEqual(back.moves.map(move => move.id), [542, 247, 420]);
  }
  // the boxed Bulbasaur's hidden ability (Chlorophyll): marked as the port marks it
  const bulbasaur = file.boxes[2].pokemon[4];
  assert.equal(bulbasaur.pokemon.species, 1);
  assert.equal(bulbasaur.ability.hidden, 'Chlorophyll');
  const marked = si.judge(bulbasaur, FULL);
  assert.equal(marked.bytes[0xCC], 2);
  assert.match(marked.notes.join(' '), /keeps its hidden ability, Chlorophyll/);
  // Colosseum with Hidden abilities off: its first ability, unmarked (the mark would leave it no ability)
  const off = si.judge(bulbasaur, { ...FULL, hiddenAbilities: false });
  assert.equal(off.bytes[0xCC], 0);
  assert.match(off.notes.join(' '), /comes with Overgrow, not its hidden ability Chlorophyll/);
  // XD keeps the mark in a bit of its own beside the ability slot, so it's kept either way
  const xd = si.judge(bulbasaur, { ...FULL, game: 'xd', hiddenAbilities: false });
  assert.equal(xd.bytes[0x1D] & 0x10, 0x10);
  assert.equal(convert.read('xd', xd.bytes).abilitySlot, 0);
  assert.equal(file.boxes[2].pokemon[3], null);
});

test('a Black 2 or White 2 save, a damaged one, and the DS saves told apart', () => {
  const file = si.parse(gen5File({ game: 'b2w2', version: 22, party: [pk5({})] }));
  assert.equal(file.kind, 'bw');
  assert.equal(file.gameName, 'White 2');
  assert.equal(file.party.length, 1);
  // DeSmuME's footer after the 512 KB
  assert.equal(si.parse(Buffer.concat([gen5File({ party: [pk5({})] }), Buffer.from('|<--Snip above here to create a raw sav by excluding this DeSmuME savedata footer:')])).party.length, 1);
  assert.throws(() => si.parse(gen5File({ party: [pk5({})], damage: gen5Save.PARTY.at + 0x20 })), /trainer or party is damaged/);
  assert.throws(() => si.parse(gen5File({ damage: gen5Save.boxBlock(5).at + 3 })), /PC boxes are damaged/);
  assert.throws(() => si.parse(Buffer.alloc(gen5Save.SAVE_SIZE, 0xFF)), /Black, White, Black 2 or White 2 save/);
  // a damaged Pokémon and an egg say so
  const odd = si.parse(gen5File({ party: [pk5({ badChecksum: true }), pk5({ ivWord: 1 << 30 })] }));
  assert.match(si.judge(odd.party[0], FULL).problems[0], /damaged/);
  assert.match(si.judge(odd.party[1], FULL).problems[0], /Eggs can't come/);
});

test('an X or Y save: Generation 6\'s shininess, nature, gender and hidden ability kept, a long name cut', () => {
  // shiny in X and Y (its ids and personality XOR to 12: under 16) but not by Colosseum's test (under 8)
  const pid = (((12345 ^ 54321 ^ 0x0100) ^ 12) << 16 | 0x0100) >>> 0;
  assert.equal(shinyXor(OT_ID, pid), 12);
  const file = si.parse(gen6File({ party: [pk6({ pid, ribbons: 1 })], boxed: [{ box: 30, slot: 29, mon: pk6({ species: 39, nickname: 'Jiggly', ability: 172, abilityNumber: 2, female: false, pid: 0x12345678, party: false }) }] }));
  assert.equal(file.kind, '3ds');
  assert.equal(file.gameName, 'X');
  assert.equal(file.trainer, 'Serena');
  assert.equal(file.boxes.length, 31);
  assert.equal(file.boxes[0].name, 'BOX 1');
  const entry = file.party[0], p = entry.pokemon;
  assert.equal(p.species, 662 + 26);
  assert.equal(isGcShiny(OT_ID, p.rnd), true);
  assert.equal(p.rnd % 25, 3);
  // Fletchinder is half female: its low byte under 127
  assert.ok((p.rnd & 0xFF) < 127);
  assert.equal(p.nicknameText, 'Fletchinde');
  assert.equal(p.friendship, 90);
  assert.deepEqual(p.ribbons, Array(12).fill(false));
  assert.deepEqual(p.moves.map(move => move.id), [416, 53, 515]);
  const judged = si.judge(entry, FULL);
  assert.deepEqual(judged.problems, []);
  assert.match(judged.notes.join(' '), /cut to 10 letters/);
  assert.match(judged.notes.join(' '), /ribbons stay behind/);
  assert.match(judged.notes.join(' '), /keeps its hidden ability, Gale Wings/);
  assert.equal(judged.bytes[0xCC], 2);
  const back = convert.read('colosseum', judged.bytes);
  assert.deepEqual([back.species, back.rnd >>> 0, back.otId], [688, p.rnd, OT_ID]);
  // a Pokémon with an ability the game's species hasn't got (Jigglypuff's Competitive) comes with its first
  const jiggly = si.judge(file.boxes[30].pokemon[29], FULL);
  assert.deepEqual(jiggly.problems, []);
  assert.equal(jiggly.pokemon.abilitySlot, 0);
  assert.match(jiggly.notes.join(' '), /comes with Cute Charm: Jigglypuff can't have Competitive/);
  assert.equal(jiggly.bytes[0xCC], 0);
  // the friendship of who has it now
  assert.equal(si.parse(gen6File({ party: [pk6({ handler: 1 })] })).party[0].pokemon.friendship, 200);
});

test('an Omega Ruby or Alpha Sapphire save, and what can\'t come from a 3DS save', () => {
  const party = [
    pk6({ species: 645, form: 1, ability: 159, abilityNumber: 1, female: false }),     // Therian Landorus
    pk6({ species: 670, form: 5, ability: 166, abilityNumber: 1 }),                      // Eternal Flower Floette
    pk6({ species: 670, form: 2, ability: 166, abilityNumber: 1 }),                      // a Floette of another colour
    pk6({ species: 201, form: 7, ability: 26, abilityNumber: 1, female: false, moves: [237], pp: [15] }),   // Unown H
    pk6({ species: 36, ability: 56, abilityNumber: 1, moves: [585, 33], pp: [15, 35], item: 644 })          // Moonblast, Pixie Plate
  ];
  const file = si.parse(gen6File({ game: 'oras', version: 26, party }));
  assert.equal(file.gameName, 'Alpha Sapphire');
  // a form the game has as a Pokémon of its own: Landorus's Therian Forme
  assert.deepEqual(si.judge(file.party[0], FULL).problems, []);
  assert.equal(si.judge(file.party[0], FULL).pokemon.species, 737 + 26);
  assert.match(si.judge(file.party[1], FULL).problems[0], /Only Floette's usual form/);
  assert.deepEqual(si.judge(file.party[2], FULL).problems, []);
  const unown = si.judge(file.party[3], FULL).pokemon;
  const letter = ((((unown.rnd >>> 24) & 3) << 6) | (((unown.rnd >>> 16) & 3) << 4) | (((unown.rnd >>> 8) & 3) << 2) | (unown.rnd & 3)) % 28;
  assert.equal(letter, 7);
  // Clefable's Moonblast (a Fairy move) needs Generation 5 and 6 moves; the Pixie Plate, X and Y battle rules
  assert.match(si.judge(file.party[4], OLD).problems.join(' '), /move the game doesn't have/);
  const clefable = si.judge(file.party[4], FULL);
  assert.deepEqual(clefable.problems, []);
  assert.equal(clefable.pokemon.item, 0x29A);
  // damaged blocks, and files that aren't a decrypted save
  assert.throws(() => si.parse(gen6File({ game: 'oras', party, damage: gen6Save.PARTY.at + 9 })), /trainer or party is damaged/);
  assert.throws(() => si.parse(gen6File({ damage: gen6Save.GAMES.xy.box.at + 100 })), /PC boxes are damaged/);
  assert.throws(() => si.parse(Buffer.alloc(gen6Save.GAMES.xy.size)), /decrypted Pokémon X, Y/);
  assert.throws(() => si.parse(Buffer.alloc(0x12345), 'x.bin'), /3DS save/);
});

test('a later game\'s Pokémon get a personality Colosseum and XD read as theirs, the same each time', () => {
  for (let n = 0; n < 200; n++) {
    const pid = (Math.imul(n, 0x9E3779B1) ^ 0x5bd1e995) >>> 0, nature = n % 25, shiny = n % 3 === 0, female = n % 2 === 0;
    const want = { nature, shiny, female, ratio: 127, unown: null, silcoon: null };
    const rnd = si.gamePersonality(pid, OT_ID, want);
    assert.equal(rnd % 25, nature);
    assert.equal(isGcShiny(OT_ID, rnd), shiny);
    assert.equal((rnd & 0xFF) < 127, female);
    assert.equal(si.gamePersonality(pid, OT_ID, want), rnd);
  }
  // one already right is kept
  assert.equal(si.gamePersonality(0x00000019, OT_ID, { nature: 0, shiny: false, female: null, ratio: -1, unown: null, silcoon: null }), 0x19);
  // items: the older ones by their Generation 4 numbers (Leftovers), the newer by their own (Assault Vest, Douse Drive), one the game hasn't got none
  assert.deepEqual([si.laterItem(234), si.laterItem(640), si.laterItem(116), si.laterItem(656), si.laterItem(0)], [200, 0x28A, 0x29E, 0, 0]);
  // names: ♂ and ♀ as the DS and 3DS keep them, and a character the games haven't got
  assert.equal(text(si.unicodeText([0x4E, 0x246D, 0xE08F, 0x3000, 0x1F600], 10)), 'N♂♀ ?');
  assert.deepEqual([si.speciesFromNational(494), si.speciesFromNational(721), si.speciesFromNational(722), si.nationalOf(747)], [520, 747, 0, 721]);
});
