'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gciSave = require('../src/gci-save');
const pcBoxes = require('../src/pc-boxes');
const xdSave = require('../src/xd-save');
const sp = require('../src/save-pokemon');
const edit = require('../src/save-pokemon-edit');
const teamSets = require('../src/team-sets');
const saveImport = require('../src/save-import');
const tradeConvert = require('../src/trade-convert');
const { summary: tradeSummary } = require('../src/online-trades');

const utf16 = (bytes, offset, value) => Buffer.from(value, 'utf16le').swap16().copy(bytes, offset);
const OT = 0xae3b618b;

const folder = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colo-saveedit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

function makeColosseumPokemon({ species = 197, rnd = 0x12345678, trainer = OT, nickname = 'UMBREON', level = 30, exp = 27000,
  moves = [[93, 25, 0], [50, 20, 1]], item = 0, hp = 100, stats = [100, 50, 80, 45, 95, 50],
  evs = [0, 0, 0, 0, 0, 0], ivs = [15, 15, 15, 15, 15, 15], friendship = 70, ball = 4, ability = 0,
  egg = false, shadowId = 0, heart = -100 } = {}) {
  const b = Buffer.alloc(0x138);
  b.writeUInt16BE(species, 0);
  b.writeUInt32BE(rnd >>> 0, 0x04);
  b.writeUInt32BE(0x0b030202, 0x08);   // attest
  b.writeUInt16BE(0x2a, 0x0c);         // met location
  b[0x0e] = 25;                        // met level
  b[0x0f] = ball;
  b[0x10] = 0;                         // otGender
  b.writeUInt32BE(trainer >>> 0, 0x14);
  utf16(b, 0x18, 'WES');
  utf16(b, 0x2e, nickname);
  utf16(b, 0x44, nickname);
  b.writeUInt32BE(exp >>> 0, 0x5c);
  b[0x60] = level;
  moves.forEach(([id, pp, ups], i) => {
    b.writeUInt16BE(id, 0x78 + i * 4);
    b[0x78 + i * 4 + 2] = pp;
    b[0x78 + i * 4 + 3] = ups;
  });
  b.writeUInt16BE(item, 0x88);
  b.writeUInt16BE(hp, 0x8a);
  stats.forEach((v, i) => b.writeUInt16BE(v, 0x8c + i * 2));
  evs.forEach((v, i) => b.writeUInt16BE(v, 0x98 + i * 2));
  ivs.forEach((v, i) => b.writeUInt16BE(v, 0xa4 + i * 2));
  b.writeUInt16BE(friendship, 0xb0);
  b[0xb2] = 12;                        // contest Cool
  b[0xbd] = 1;                         // Champion ribbon
  b[0xcb] = egg ? 1 : 0;
  b[0xcc] = ability;
  b[0xcf] = 0x0a;                      // markings
  b[0xd0] = 0xff;                      // no mail
  b.writeUInt16BE(shadowId, 0xd8);
  b.writeInt32BE(heart, 0xdc);
  b.writeUInt32BE(1, 0xf8);            // fateful encounter
  b.writeUInt32BE(0xdeadbeef, 0x110);  // untouched spare word
  return b;
}

function makeColosseumCard(dir, copies, extra = null) {
  const data = Buffer.alloc(gciSave.SIZE);
  for (let index = 0; index < 3; index++) {
    const copy = copies[index];
    const plain = Buffer.alloc(gciSave.SLOT_SIZE);
    plain[0] = 1; plain[1] = 1;
    if (copy) {
      plain.writeInt32BE(copy.count ?? 3 - index, 4);
      utf16(plain, 0x78, 'WES');
      plain.writeUInt32BE(OT, 0xa4);
      (copy.party || []).forEach((p, i) => p.copy(plain, 0xa8 + i * 0x138));
      for (let box = 0; box < 3; box++) utf16(plain, 0xb90 + box * 0x24a4, `BOX${box + 1}`);
      for (const [where, p] of Object.entries(copy.boxes || {})) {
        const [box, slot] = where.split(':').map(Number);
        if (box < 3) p.copy(plain, 0xb90 + box * 0x24a4 + 0x14 + slot * 0x138);
      }
      for (let n = 1; n <= 0x60; n++) {
        plain.writeUInt16BE(20, 0x1b4ac + 0x18 * n + 0x16);
        plain.writeUInt16BE(0xffff, 0x1b4ac + 0x18 * n + 0x14);
      }
      if (copy.runtimePid) {
        for (const [id, pid] of Object.entries(copy.runtimePid)) plain.writeUInt32BE(pid >>> 0, 0x1b020 + 0xc * Number(id) + 4);
      }
      if (extra) pcBoxes.writeStamp(plain, pcBoxes.fnv64(extra));
    }
    gciSave.scramble(plain).copy(data, gciSave.SLOT_START + index * gciSave.SLOT_SIZE);
  }
  fs.writeFileSync(path.join(dir, 'pokemon_colosseum.dat'), data);
  if (extra) pcBoxes.writeEntries(dir, [{ hash: pcBoxes.fnv64(extra), data: extra }], []);
}

function makeXdPokemon({ species = 133, rnd = 0x22334455, trainer = OT, nickname = 'EEVEE', level = 20, exp = 8000,
  moves = [[33, 35, 0], [28, 30, 0]], item = 0, hp = 55, stats = [55, 30, 28, 25, 32, 30],
  evs = [0, 0, 0, 0, 0, 0], ivs = [10, 10, 10, 10, 10, 10], friendship = 70, ball = 4, ability = 0,
  egg = false, shadowId = 0, flagsExtra = 0x05 } = {}) {
  const b = Buffer.alloc(0xc4);
  b.writeUInt16BE(species, 0);
  b.writeUInt16BE(item, 0x02);
  b.writeUInt16BE(hp, 0x04);
  b.writeUInt16BE(friendship, 0x06);
  b.writeUInt16BE(0x11, 0x08);         // metLocation
  b[0x0e] = 10;                        // metLevel
  b[0x0f] = ball;
  b[0x10] = 0;                         // otGender
  b[0x11] = level;
  b[0x14] = 0x07;                      // markings
  b[0x1d] = (egg ? 0x80 : 0) | (ability ? 0x40 : 0) | flagsExtra;
  b.writeUInt32BE(exp >>> 0, 0x20);
  b.writeUInt32BE(trainer >>> 0, 0x24);
  b.writeUInt32BE(rnd >>> 0, 0x28);
  b.writeUInt32BE(1, 0x30);            // fateful encounter
  b.writeUInt32BE(0x0b030202, 0x34);   // attest
  utf16(b, 0x38, 'MICHAEL');
  utf16(b, 0x4e, nickname);
  utf16(b, 0x64, nickname);
  b.writeUInt32BE(0x80000000, 0x7c);   // Champion ribbon
  moves.forEach(([id, pp, ups], i) => {
    b.writeUInt16BE(id, 0x80 + i * 4);
    b[0x80 + i * 4 + 2] = pp;
    b[0x80 + i * 4 + 3] = ups;
  });
  stats.forEach((v, i) => b.writeUInt16BE(v, 0x90 + i * 2));
  evs.forEach((v, i) => b.writeUInt16BE(v, 0x9c + i * 2));
  ivs.forEach((v, i) => { b[0xa8 + i] = v; });
  b.writeUInt16BE(shadowId, 0xba);
  return b;
}

function makeXdCard(dir, copies) {
  const data = Buffer.alloc(0x56000);
  for (let index = 0; index < 2; index++) {
    const copy = copies[index];
    if (!copy) continue;
    const start = xdSave.SLOTS[index];
    data[start] = 1; data[start + 1] = 1; data[start + 2] = 1;
    data.writeInt32BE(copy.count ?? 2 - index, start + 4);
    const plain = Buffer.alloc(xdSave.PACK_SIZE);
    const setSection = (table, bodyOffset) => {
      plain.writeUInt16BE(bodyOffset & 0xffff, table);
      plain.writeUInt16BE(bodyOffset >>> 16, table + 2);
    };
    const heroOff = 0x100, pcOff = 0x1000, darkOff = 0xd000, dayOff = 0x10000, chamberOff = 0x11000, resOff = 0x14000;
    setSection(xdSave.SECTION.hero, heroOff);
    setSection(xdSave.SECTION.pcBox, pcOff);
    setSection(xdSave.SECTION.darkPokemon, darkOff);
    setSection(0x48, dayOff);
    setSection(0x70, chamberOff);
    setSection(xdSave.SECTION.reserve1, resOff);
    const hero = xdSave.BODY + heroOff, pc = xdSave.BODY + pcOff, dark = xdSave.BODY + darkOff;
    utf16(plain, hero, 'MICHAEL');
    plain.writeUInt32BE(OT, hero + 0x2c);
    (copy.party || []).forEach((p, i) => p.copy(plain, hero + 0x30 + i * 0xc4));
    for (let box = 0; box < 8; box++) utf16(plain, pc + box * 0x170c, `BOX${box + 1}`);
    for (const [where, p] of Object.entries(copy.boxes || {})) {
      const [box, slot] = where.split(':').map(Number);
      p.copy(plain, pc + box * 0x170c + 0x14 + slot * 0xc4);
    }
    for (const [idStr, rec] of Object.entries(copy.darkRecords || {})) {
      const id = Number(idStr), at = dark + id * 0x48;
      plain.writeUInt32BE(((rec.status ?? 3) << 29) >>> 0, at);
      plain.writeUInt32BE((((rec.poolExp ?? 123) << 12) | ((rec.ball ?? 4) << 8)) >>> 0, at + 4);
      (rec.ivs || [1, 2, 3, 4, 5, 6]).forEach((v, i) => { plain[at + 0x0b + i] = v; });
      plain.writeUInt16BE(rec.species || 133, at + 0x1a);
      plain.writeUInt32BE((rec.rnd ?? 0) >>> 0, at + 0x1c);
      plain.writeInt32BE(rec.gauge ?? 2000, at + 0x24);
      plain.writeUInt16BE(id, at + 0x3e);
    }
    xdSave.encipher(plain).copy(data, start + xdSave.PACK);
  }
  fs.writeFileSync(path.join(dir, 'PokemonXD.dat'), data);
}

test('Colosseum: edits party Pokémon in place, recalculates stats/EXP/PP, preserves untouched fields and checksums', t => {
  const dir = folder(t);
  const umbreon = makeColosseumPokemon({ species: 197, rnd: 0x00000005, level: 30, exp: 27500, hp: 100, stats: [100, 50, 80, 45, 95, 50] });
  makeColosseumCard(dir, [{ party: [umbreon] }]);

  const { copies } = sp.cardCopies(dir, 'colosseum');
  const opened = edit.readSlot(copies[0].ctx, { area: 'party', box: 0, slot: 0 });
  assert.equal(opened.pokemon.species, 197);
  assert.equal(opened.pokemon.nickname, '');   // UMBREON equals species uppercase name
  assert.equal(opened.pokemon.level, 30);

  const result = sp.editCard(dir, 'colosseum', ctx => edit.applyEdit(ctx, opened.place, opened.identity, {
    nickname: 'Moonlight',
    level: 50,
    nature: 20,      // Calm (+SpD, -Atk)
    gender: 'F',
    shiny: true,
    ball: 11,        // Luxury Ball
    friendship: 255,
    item: 200,       // Leftovers
    ability: 0,
    evs: [252, 0, 4, 0, 252, 0],
    ivs: [31, 0, 31, 31, 31, 31],
    moves: [{ id: 92, ppUps: 3 }, { id: 182, ppUps: 1 }, { id: 273, ppUps: 0 }, { id: 185, ppUps: 2 }]
  }));

  assert.equal(result.nickname, 'Moonlight');
  // Verify the save card still validates with gciSave.newestPlain
  const raw = fs.readFileSync(path.join(dir, 'pokemon_colosseum.dat'));
  assert.equal(gciSave.newestPlain(raw).count, 3);

  const after = sp.cardCopies(dir, 'colosseum').copies[0].ctx;
  const reread = edit.readSlot(after, { area: 'party', box: 0, slot: 0 });
  const p = reread.pokemon;
  assert.equal(p.nickname, 'Moonlight');
  assert.equal(p.level, 50);
  assert.equal(p.exp, saveImport.expAt('mediumFast', 50));
  assert.equal(p.nature, 20);
  assert.equal(p.gender, 'F');
  assert.equal(p.shiny, true);
  assert.equal(edit.isShiny(OT, p.rnd), true);
  assert.equal(p.ball, 11);
  assert.equal(p.friendship, 255);
  assert.equal(p.item, 200);
  assert.deepEqual(p.evs, [252, 0, 4, 0, 252, 0]);
  assert.deepEqual(p.ivs, [31, 0, 31, 31, 31, 31]);
  // Umbreon Lv.50 Calm 252 HP / 4 Def / 252 SpD, 31/0/31/31/31/31 IVs:
  // HP: floor((190+31+63)*50/100)+60 = 142+60 = 202
  // Atk: floor((floor((130+0+0)*50/100)+5)*9/10) = floor(70*9/10) = 63
  // Def: floor((220+31+1)*50/100)+5 = 126+5 = 131
  // SpA: floor((120+31+0)*50/100)+5 = 75+5 = 80
  // SpD: floor((floor((260+31+63)*50/100)+5)*11/10) = floor(182*11/10) = 200
  // Spe: floor((130+31+0)*50/100)+5 = 80+5 = 85
  assert.deepEqual(p.stats, [202, 63, 131, 80, 200, 85]);
  assert.equal(p.hp, 202, 'full HP stays full when max HP grows');
  assert.deepEqual(p.moves.map(m => [m.id, m.ppUps, m.pp]), [
    [92, 3, 16],   // Toxic: 10 base PP -> 16 with 3 PP Ups
    [182, 1, 12],  // Protect: 10 base PP -> 12 with 1 PP Up
    [273, 0, 10],  // Wish: 10 base PP
    [185, 2, 28]   // Faint Attack: 20 base PP -> 28 with 2 PP Ups
  ]);

  // Verify untouched fields stayed intact in raw bytes
  const rawMon = after.plain.subarray(0xa8, 0xa8 + 0x138);
  assert.equal(rawMon.readUInt32BE(0x08), 0x0b030202, 'attest preserved');
  assert.equal(rawMon.readUInt16BE(0x0c), 0x2a, 'met location preserved');
  assert.equal(rawMon[0x0e], 25, 'met level preserved');
  assert.equal(rawMon[0xb2], 12, 'contest stat preserved');
  assert.equal(rawMon[0xbd], 1, 'Champion ribbon preserved');
  assert.equal(rawMon[0xcf], 0x0a, 'markings preserved');
  assert.equal(rawMon.readUInt32BE(0xf8), 1, 'fateful encounter preserved');
  assert.equal(rawMon.readUInt32BE(0x110), 0xdeadbeef, 'spare bytes preserved');
});

test('Colosseum: preserves original personality and partial EXP when nature/gender/shiny/level are unchanged', t => {
  const dir = folder(t);
  const origRnd = 0x13579bdf;
  const origExp = saveImport.expAt('mediumFast', 30) + 777;
  const mon = makeColosseumPokemon({ species: 197, rnd: origRnd, level: 30, exp: origExp, hp: 40, stats: [100, 50, 80, 45, 95, 50] });
  makeColosseumCard(dir, [{ party: [mon] }]);

  const ctx = sp.cardCopies(dir, 'colosseum').copies[0].ctx;
  const opened = edit.readSlot(ctx, { area: 'party', box: 0, slot: 0 });
  edit.applyEdit(ctx, opened.place, opened.identity, {
    level: 30,
    nature: opened.pokemon.nature,
    gender: opened.pokemon.gender,
    shiny: opened.pokemon.shiny,
    item: 200,
    moves: [{ id: 93, ppUps: 0 }]
  });
  const after = edit.readSlot(ctx, opened.place).pokemon;
  assert.equal(after.rnd, origRnd >>> 0, 'PID stays identical');
  assert.equal(after.exp, origExp, 'partial EXP progress stays intact');
  assert.equal(after.hp, 40, 'damaged HP stays damaged while <= new max HP');

  // Retail Gen 3 saves can have 255 EVs in a stat: editing must preserve them rather than zeroing them out.
  edit.applyEdit(ctx, opened.place, opened.identity, { evs: [255, 255, 0, 0, 0, 0] });
  assert.deepEqual(edit.readSlot(ctx, opened.place).pokemon.evs, [255, 255, 0, 0, 0, 0]);
});

test('Colosseum: edits Pokémon in extra boxes 4–10 (.boxes file)', t => {
  const dir = folder(t);
  const extra = Buffer.alloc(7 * 0x24a4);
  const espeon = makeColosseumPokemon({ species: 196, nickname: 'ESPEON', level: 25, exp: 15625 });
  espeon.copy(extra, 2 * 0x24a4 + 0x14 + 5 * 0x138);   // box 6 (index 5), slot 5
  makeColosseumCard(dir, [{ party: [makeColosseumPokemon()] }], extra);

  const place = { area: 'box', box: 5, slot: 5 };
  const opened = edit.readSlot(sp.cardCopies(dir, 'colosseum').copies[0].ctx, place);
  sp.editCard(dir, 'colosseum', ctx => edit.applyEdit(ctx, place, opened.identity, {
    nickname: 'Sol',
    level: 75,
    moves: [{ id: 94, ppUps: 3 }]
  }));

  const save = sp.readCard(dir, 'colosseum');
  assert.equal(save.boxes[5].pokemon[5].nickname, 'Sol');
  assert.equal(save.boxes[5].pokemon[5].level, 75);
  assert.deepEqual(save.boxes[5].pokemon[5].moves, [94]);
});

test('Colosseum: Shadow Pokémon keeps Shadow move, Shadow ID, heart gauge, and blocks species change', t => {
  const dir = folder(t);
  const origRnd = 0x11223344;
  const shadowMon = makeColosseumPokemon({
    species: 296, rnd: origRnd, nickname: 'MAKUHITA', level: 30, exp: 31000,
    moves: [[356, 0, 0], [33, 35, 0]], shadowId: 1, heart: 1500
  });
  makeColosseumCard(dir, [{ party: [shadowMon], runtimePid: { 1: origRnd } }]);

  const ctx = sp.cardCopies(dir, 'colosseum').copies[0].ctx;
  const opened = edit.readSlot(ctx, { area: 'party', box: 0, slot: 0 });
  assert.equal(opened.pokemon.shadow, true);
  assert.equal(opened.pokemon.moves[0].shadow, true);
  assert.equal(opened.pokemon.moves[0].name, 'Shadow Rush');

  assert.throws(() => edit.applyEdit(ctx, opened.place, opened.identity, { species: 197 }), /Shadow Pokémon's species/);

  // Even if the client omits the Shadow move, applyEdit preserves it automatically; changing shiny updates runtime PID.
  edit.applyEdit(ctx, opened.place, opened.identity, {
    shiny: !opened.pokemon.shiny,
    moves: [{ id: 280, ppUps: 2 }]
  });
  const after = edit.readSlot(ctx, opened.place).pokemon;
  assert.equal(after.shadow, true);
  assert.equal(after.shadowId, 1);
  assert.equal(after.moves.some(m => m.shadow && m.rawId === 356), true, 'Shadow Rush preserved');
  assert.equal(after.moves.some(m => !m.shadow && m.id === 280), true, 'Brick Break added');
  assert.equal(ctx.plain.readInt32BE(0xa8 + 0xdc), 1500, 'heart gauge untouched');
  assert.equal(ctx.plain.readUInt32BE(0x1b020 + 0xc * 1 + 4), after.rnd, 'Colosseum Shadow runtime PID synced');
});

test('Colosseum: changing species on a non-Shadow Pokémon updates stats, EXP, default nickname, and clears purified Shadow ID', t => {
  const dir = folder(t);
  // Shedinja test too: species 303 must always have 1 HP!
  const purified = makeColosseumPokemon({ species: 197, nickname: 'UMBREON', level: 40, exp: 64000, shadowId: 5, heart: -100 });
  makeColosseumCard(dir, [{ party: [purified] }]);

  const ctx = sp.cardCopies(dir, 'colosseum').copies[0].ctx;
  const opened = edit.readSlot(ctx, { area: 'party', box: 0, slot: 0 });
  edit.applyEdit(ctx, opened.place, opened.identity, {
    species: 303,    // Shedinja
    level: 50,
    evs: [252, 252, 0, 0, 0, 0],
    ivs: [31, 31, 31, 31, 31, 31],
    moves: [{ id: 247, ppUps: 0 }]
  });
  const after = edit.readSlot(ctx, opened.place).pokemon;
  assert.equal(after.species, 303);
  assert.equal(after.rawNickname, 'SHEDINJA');
  assert.equal(after.nickname, '');
  assert.equal(after.stats[0], 1, 'Shedinja always has 1 HP');
  assert.equal(after.hp, 1);
  assert.equal(after.exp, saveImport.expAt('erratic', 50));
  assert.equal(after.shadowId, 0, 'purified historical Shadow ID cleared on species change');
});

test('XD: edits Pokémon with 1-byte IVs, bit-6 ability, XD Gen 4 numbering, and checksum round-trip', t => {
  const dir = folder(t);
  const eevee = makeXdPokemon({ species: 133, level: 20, ability: 0, flagsExtra: 0x05 });
  makeXdCard(dir, [{ party: [eevee] }]);

  const receiver = { game: 'xd', laterPokemon: true, laterMoves: true, laterItems: true };
  const opened = edit.readSlot(sp.cardCopies(dir, 'xd').copies[0].ctx, { area: 'party', box: 0, slot: 0 });
  assert.equal(opened.pokemon.species, 133);

  sp.editCard(dir, 'xd', ctx => edit.applyEdit(ctx, opened.place, opened.identity, {
    species: 464,    // Colosseum ID for Bonsly -> XD ID 413!
    nickname: '',
    level: 45,
    nature: 3,       // Adamant (+Atk, -SpA)
    ability: 1,      // Rock Head (slot 1)
    item: 0x237,     // Gen 4 Life Orb (Colosseum 0x237 -> XD 0x265)
    evs: [4, 252, 0, 0, 0, 252],
    ivs: [31, 31, 31, 12, 31, 31],
    moves: [{ id: 400, ppUps: 3 }]   // Colosseum Gen 4 move 400 -> XD 417
  }, { receiver }));

  const raw = fs.readFileSync(path.join(dir, 'PokemonXD.dat'));
  const pack = xdSave.newestPack(raw);
  assert.ok(pack, 'XD save checksums are valid after edit');

  const afterCtx = sp.cardCopies(dir, 'xd').copies[0].ctx;
  const slot = sp.slotAt(afterCtx, opened.place);
  assert.equal(slot.bytes.readUInt16BE(0), 413, 'Bonsly written with XD species ID 413');
  assert.equal(slot.bytes.readUInt16BE(0x02), 0x265, 'Gen 4 item shifted +0x2E for XD');
  assert.equal(slot.bytes.readUInt16BE(0x80), 417, 'Gen 4 move shifted +17 for XD');
  assert.deepEqual([...slot.bytes.subarray(0xa8, 0xae)], [31, 31, 31, 12, 31, 31], 'XD 1-byte IVs written');
  assert.equal(slot.bytes[0x1d] & 0x40, 0x40, 'XD ability bit 6 set');
  assert.equal(slot.bytes[0x1d] & 0x05, 0x05, 'other bits of XD flags byte 0x1D preserved');

  const reread = edit.readSlot(afterCtx, opened.place).pokemon;
  assert.equal(reread.species, 464);
  assert.equal(reread.rawSpecies, 413);
  assert.equal(reread.item, 0x237);
  assert.equal(reread.moves[0].id, 400);
  assert.equal(reread.ability, 1);
  assert.equal(reread.rawNickname, 'BONSLY');
});

test('XD: editing a Shadow Pokémon syncs darkPokemon record (PID, IVs, ball) and keeps XD Shadow moves', t => {
  const dir = folder(t);
  const origRnd = 0x44556677;
  const shadowTeddiursa = makeXdPokemon({
    species: 216, rnd: origRnd, nickname: 'TEDDIURSA', level: 11, exp: 1331,
    moves: [[357, 0, 0], [10, 35, 0]], shadowId: 1, ball: 4
  });
  makeXdCard(dir, [{
    party: [shadowTeddiursa],
    darkRecords: { 1: { status: 3, species: 216, rnd: origRnd, ball: 4, ivs: [1, 2, 3, 4, 5, 6], poolExp: 456, gauge: 1200 } }
  }]);

  const opened = edit.readSlot(sp.cardCopies(dir, 'xd').copies[0].ctx, { area: 'party', box: 0, slot: 0 });
  assert.equal(opened.pokemon.shadow, true);
  assert.equal(opened.pokemon.moves[0].name, 'Shadow Blitz');

  sp.editCard(dir, 'xd', ctx => edit.applyEdit(ctx, opened.place, opened.identity, {
    nature: 3,
    shiny: true,
    ball: 12,
    ivs: [31, 31, 31, 31, 31, 31],
    moves: [{ shadow: true, rawId: 357 }, { id: 216, ppUps: 3 }]
  }));

  const afterCtx = sp.cardCopies(dir, 'xd').copies[0].ctx;
  const reread = edit.readSlot(afterCtx, opened.place).pokemon;
  const rec = sp.xdRecord(afterCtx, 1);
  assert.equal(reread.moves[0].rawId, 357, 'Shadow Blitz preserved');
  assert.equal(rec.readUInt32BE(0x1c), reread.rnd, 'darkPokemon PID synced');
  assert.deepEqual([...rec.subarray(0x0b, 0x11)], [31, 31, 31, 31, 31, 31], 'darkPokemon IVs synced');
  assert.equal((rec.readUInt32BE(0x04) >>> 8) & 0x0f, 12, 'darkPokemon ball nibble synced');
  assert.equal(rec.readUInt32BE(0x04) >>> 12, 456, 'darkPokemon poolExp preserved');
  assert.equal(rec.readInt32BE(0x24), 1200, 'darkPokemon gauge preserved');
});

test('validation: rejects eggs, stale identity, empty moves, and disabled Gen 4 species/moves/items', t => {
  const dir = folder(t);
  const mon = makeColosseumPokemon({ species: 197, level: 30 });
  const egg = makeColosseumPokemon({ species: 197, egg: true });
  makeColosseumCard(dir, [{ party: [mon, egg] }]);

  const ctx = sp.cardCopies(dir, 'colosseum').copies[0].ctx;
  const opened = edit.readSlot(ctx, { area: 'party', box: 0, slot: 0 });
  const eggOpened = edit.readSlot(ctx, { area: 'party', box: 0, slot: 1 });

  assert.throws(() => edit.applyEdit(ctx, eggOpened.place, eggOpened.identity, { level: 5 }), /Eggs/);
  assert.throws(() => edit.applyEdit(ctx, opened.place, { ...opened.identity, rnd: 999999 }, { level: 5 }), /no longer in that slot/);
  assert.throws(() => edit.applyEdit(ctx, opened.place, opened.identity, { moves: [] }), /at least one move/);
  assert.throws(() => edit.applyEdit(ctx, opened.place, opened.identity, { species: 420 }, { receiver: { game: 'colosseum', laterPokemon: false } }), /Generation 4 Pokémon/);
  assert.throws(() => edit.applyEdit(ctx, opened.place, opened.identity, { moves: [{ id: 400, ppUps: 0 }] }, { receiver: { game: 'colosseum', laterMoves: false } }), /Generation 4/);
  assert.throws(() => edit.applyEdit(ctx, opened.place, opened.identity, { item: 0x237 }, { receiver: { game: 'colosseum', laterItems: false } }), /Generation 4 battle rules/);
});

test('supports Pokémon pack species with custom base stats and growth rate', t => {
  const dir = folder(t);
  const packMon = makeColosseumPokemon({ species: 1100, nickname: 'FAKEMON', level: 10, exp: 1000 });
  makeColosseumCard(dir, [{ party: [packMon] }]);

  const ctx = sp.cardCopies(dir, 'colosseum').copies[0].ctx;
  const speciesInfo = id => (id === 1100
    ? { id: 1100, name: 'Fakemon', stats: [100, 100, 100, 100, 100, 100], growthRate: 'slow', gender: 127, abilityCount: 2 }
    : edit.defaultSpeciesInfo(id));
  const opened = edit.readSlot(ctx, { area: 'party', box: 0, slot: 0 }, { speciesInfo });
  assert.equal(opened.pokemon.species, 1100);
  edit.applyEdit(ctx, opened.place, opened.identity, {
    level: 50, ability: 1, evs: [0, 0, 0, 0, 0, 0], ivs: [31, 31, 31, 31, 31, 31], nature: 0, moves: [{ id: 33, ppUps: 0 }]
  }, { speciesInfo, allowedPackSpecies: new Set([1100]) });
  const after = edit.readSlot(ctx, opened.place, { speciesInfo }).pokemon;
  assert.equal(after.level, 50);
  assert.equal(after.exp, saveImport.expAt('slow', 50));
  assert.equal(after.ability, 1);
  assert.deepEqual(after.stats, [175, 120, 120, 120, 120, 120]);
});

test('personalityFor finds valid PID for any combination of nature, 12.5% female ratio, and shininess', () => {
  const otId = 0x12345678;
  for (const shiny of [false, true]) {
    for (const gender of ['M', 'F']) {
      for (const nature of [0, 3, 13, 20, 24]) {
        const pid = edit.personalityFor(otId, 0, { species: 1, nature, gender, shiny }, 31);
        assert.equal(pid % 25, nature);
        assert.equal(edit.isShiny(otId, pid), shiny);
        assert.equal(teamSets.genderOf(pid, 31), gender);
      }
    }
  }
});

test('fallbackBattleData provides Gen 3, 4, 5 and 6 species, moves, learnsets, items and balls without a disc', () => {
  const fb = edit.fallbackBattleData();
  assert.equal(fb.fallback, true);
  assert.equal(fb.balls.length, 12);
  assert.ok(fb.moves.length >= 350);
  assert.ok(fb.generations[4].moves.length >= 460);
  assert.ok(fb.generations[4].items.length > 0);
  assert.ok(fb.species[197]?.abilities.length >= 1);
  assert.ok(fb.species[197]?.learnset.length > 0);
  assert.equal(fb.generations[4].dex.length, 107);
  assert.ok(fb.generations[6].moves.length >= 610, 'Gen 6 includes Gen 1-6 moves');
  assert.ok(fb.generations[6].items.some(item => item.id === 0x28a), 'Gen 6 includes Assault Vest');
  assert.equal(fb.generations[6].dex.length, 107 + 228 + 26, 'Gen 6 dex includes Gen 4, Gen 5-6 and alternate forms');
  assert.equal(fb.generations[6].species[520]?.name, 'Victini');
  assert.equal(fb.generations[6].species[520]?.gender, teamSets.GENDER.none, 'Victini is genderless');
  assert.equal(fb.generations[6].species[684]?.name, 'Greninja');
  assert.equal(fb.generations[6].species[684]?.hidden?.name, 'Protean');
  assert.ok(fb.generations[6].species[684]?.learnset.length > 0);
  assert.equal(fb.generations[6].species[773]?.name, 'Hoopa-Unbound');
});

test('Gen 5 and Gen 6: editing species, forms, moves, items and hidden abilities works in Colosseum and XD', t => {
  const dir = folder(t);
  const mon = makeColosseumPokemon({ species: 197, level: 30 });
  makeColosseumCard(dir, [{ party: [mon] }]);

  const ctx = sp.cardCopies(dir, 'colosseum').copies[0].ctx;
  const opened = edit.readSlot(ctx, { area: 'party', box: 0, slot: 0 });

  // Validation rejects Gen 5-6 species, moves and items when disabled
  assert.throws(() => edit.applyEdit(ctx, opened.place, opened.identity, { species: 521 }, { receiver: { game: 'colosseum', laterPokemon: true, gen6Pokemon: false } }), /Generation 5 and 6 Pokémon/);
  assert.throws(() => edit.applyEdit(ctx, opened.place, opened.identity, { species: 684 }, { receiver: { game: 'colosseum', laterPokemon: true, gen6Pokemon: false } }), /Generation 5 and 6 Pokémon/);
  assert.throws(() => edit.applyEdit(ctx, opened.place, opened.identity, { moves: [{ id: 506, ppUps: 0 }] }, { receiver: { game: 'colosseum', laterMoves: true, gen6Moves: false } }), /Generation 5 and 6 Pokémon/);
  assert.throws(() => edit.applyEdit(ctx, opened.place, opened.identity, { moves: [{ id: 588, ppUps: 0 }] }, { receiver: { game: 'colosseum', laterMoves: true, gen6Moves: false, fairyType: false } }), /Gen 6 types/);
  assert.throws(() => edit.applyEdit(ctx, opened.place, opened.identity, { item: 0x28a }, { receiver: { game: 'colosseum', laterItems: true, gen6Items: false } }), /X and Y battle rules/);

  // Fairy move (Moonblast, Colosseum 588) is allowed when fairyType is on even without gen6Moves
  edit.applyEdit(ctx, opened.place, opened.identity, {
    moves: [{ id: 588, ppUps: 1 }]
  }, { receiver: { game: 'colosseum', fairyType: true } });
  const withFairy = edit.readSlot(ctx, opened.place);
  assert.deepEqual(withFairy.pokemon.moves.map(m => [m.id, m.ppUps, m.pp]), [[588, 1, 18]]);

  // Switch to Gen 5 Victini (520, genderless) with V-create (560) and Assault Vest (0x28a), with only Gen 5-6 Pokémon enabled
  const gen6Receiver = { game: 'colosseum', laterPokemon: false, gen6Pokemon: true, gen6Moves: true, gen6Items: true, hiddenAbilities: true, gen6Stats: true };
  edit.applyEdit(ctx, withFairy.place, withFairy.identity, {
    species: 520,
    nickname: '',
    level: 50,
    nature: 0,
    item: 0x28a,
    evs: [0, 0, 0, 0, 0, 0],
    ivs: [31, 31, 31, 31, 31, 31],
    moves: [{ id: 560, ppUps: 3 }]
  }, { receiver: gen6Receiver });
  const victini = edit.readSlot(ctx, opened.place);
  assert.equal(victini.pokemon.species, 520);
  assert.equal(victini.pokemon.rawNickname, 'VICTINI');
  assert.equal(victini.pokemon.gender, '');
  assert.equal(victini.pokemon.item, 0x28a);
  assert.deepEqual(victini.pokemon.stats, [175, 120, 120, 120, 120, 120]);
  assert.deepEqual(victini.pokemon.moves.map(m => [m.id, m.ppUps, m.pp]), [[560, 3, 8]]);

  // Switch to Gen 6 Greninja (684) with Hidden Ability (Protean, slot 2 -> Colosseum 0xCC = 2) and Water Shuriken (597) + Dark Pulse (402, Gen 4 move allowed with gen6Moves)
  edit.applyEdit(ctx, victini.place, victini.identity, {
    species: 684,
    nickname: '',
    level: 50,
    ability: 2,
    moves: [{ id: 597, ppUps: 2 }, { id: 402, ppUps: 0 }]
  }, { receiver: gen6Receiver });
  const greninja = edit.readSlot(ctx, opened.place);
  assert.equal(greninja.pokemon.species, 684);
  assert.equal(greninja.pokemon.rawNickname, 'GRENINJA');
  assert.equal(greninja.pokemon.ability, 2, 'Colosseum hidden ability written to 0xCC = 2 and read back');
  assert.equal(sp.slotAt(ctx, opened.place).bytes[0xcc], 2);
  assert.deepEqual(greninja.pokemon.moves.map(m => [m.id, m.ppUps, m.pp]), [[597, 2, 28], [402, 0, 15]]);

  // XD: Gen 6 Hoopa-Unbound (alternate form 747 -> Colosseum 773 -> XD 775), Greninja hidden ability (0x1D bit 0x10), Gen 6 item & move
  const xdDir = folder(t);
  makeXdCard(xdDir, [{ party: [makeXdPokemon({ species: 133, level: 20, flagsExtra: 0x05 })] }]);
  const xdOpen = edit.readSlot(sp.cardCopies(xdDir, 'xd').copies[0].ctx, { area: 'party', box: 0, slot: 0 });
  sp.editCard(xdDir, 'xd', c => edit.applyEdit(c, xdOpen.place, xdOpen.identity, {
    species: 684,
    nickname: '',
    level: 40,
    ability: 2,
    item: 0x28a,    // Assault Vest -> XD 0x2B8
    moves: [{ id: 588, ppUps: 1 }]   // Moonblast -> XD 605
  }, { receiver: { ...gen6Receiver, game: 'xd' } }));
  const xdAfter = sp.cardCopies(xdDir, 'xd').copies[0].ctx;
  const xdSlot = sp.slotAt(xdAfter, xdOpen.place);
  assert.equal(xdSlot.bytes.readUInt16BE(0), 686, 'Greninja shifted +2 in XD');
  assert.equal(xdSlot.bytes.readUInt16BE(0x02), 0x2b8, 'Gen 6 item shifted +0x2E in XD');
  assert.equal(xdSlot.bytes.readUInt16BE(0x80), 605, 'Gen 6 move shifted +17 in XD');
  assert.equal(xdSlot.bytes[0x1d] & 0x50, 0x10, 'XD hidden ability sets bit 0x10 and clears bit 0x40');
  assert.equal(xdSlot.bytes[0x1d] & 0x05, 0x05, 'other XD flag bits preserved');
  const xdReread = edit.readSlot(xdAfter, xdOpen.place);
  assert.equal(xdReread.pokemon.species, 684);
  assert.equal(xdReread.pokemon.ability, 2);
  assert.equal(xdReread.pokemon.item, 0x28a);

  // Switch to alternate form Hoopa-Unbound (Colosseum 773 -> XD 775) and confirm default nickname is HOOPA
  sp.editCard(xdDir, 'xd', c => edit.applyEdit(c, xdReread.place, xdReread.identity, {
    species: 773,
    nickname: '',
    ability: 0,
    moves: [{ id: 624, ppUps: 0 }]
  }, { receiver: { ...gen6Receiver, game: 'xd' } }));
  const xdFormCtx = sp.cardCopies(xdDir, 'xd').copies[0].ctx;
  const xdFormSlot = sp.slotAt(xdFormCtx, xdOpen.place);
  assert.equal(xdFormSlot.bytes.readUInt16BE(0), 775, 'Hoopa-Unbound shifted +2 in XD');
  assert.equal(xdFormSlot.bytes[0x1d] & 0x50, 0x00, 'switching back to slot 0 clears hidden ability bit');
  const xdFormRead = edit.readSlot(xdFormCtx, xdOpen.place).pokemon;
  assert.equal(xdFormRead.species, 773);
  assert.equal(xdFormRead.rawNickname, 'HOOPA');
  assert.equal(xdFormRead.nickname, '');
});

test('edited flag: marks modified Pokémon in Colosseum and XD, blocks Shadowtrade, and survives Online Trades', t => {
  const dir = folder(t);
  const cleanShadow = makeColosseumPokemon({ species: 296, nickname: 'MAKUHITA', level: 30, exp: 31000, moves: [[356, 0, 0], [33, 35, 0]], shadowId: 1, heart: 1500 });
  const cleanNormal = makeColosseumPokemon({ species: 197, rnd: 0x22222222, nickname: 'UMBREON', level: 30, exp: 27000 });
  makeColosseumCard(dir, [{ party: [cleanNormal, cleanShadow] }]);

  // Before editing: clean Pokémon are not marked edited and Shadow can go to Shadowtrade
  let model = sp.readCard(dir, 'colosseum');
  assert.equal(model.party[0].edited, false);
  assert.equal(model.party[1].edited, false);
  assert.equal(sp.offerProblem(model, model.party[1]), null);

  // Saving with zero changes leaves a clean Pokémon clean
  let ctx = sp.cardCopies(dir, 'colosseum').copies[0].ctx;
  const openNormal = edit.readSlot(ctx, { area: 'party', box: 0, slot: 0 });
  const noOp = edit.applyEdit(ctx, openNormal.place, openNormal.identity, { level: 30, moves: openNormal.pokemon.moves });
  assert.equal(noOp.edited, false, 'unchanged Pokémon stays unedited');

  // Editing the Shadow Pokémon marks it edited and disables Shadowtrade
  const openShadow = edit.readSlot(sp.cardCopies(dir, 'colosseum').copies[0].ctx, { area: 'party', box: 0, slot: 1 });
  const shadowRes = sp.editCard(dir, 'colosseum', c => edit.applyEdit(c, openShadow.place, openShadow.identity, {
    evs: [0, 252, 0, 0, 0, 0]
  }));
  assert.equal(shadowRes.edited, true);
  model = sp.readCard(dir, 'colosseum');
  assert.equal(model.party[1].edited, true);
  assert.equal(sp.offerProblem(model, model.party[1]), 'Edited Pokémon can\'t go to Shadowtrade.');

  // Editing a normal Pokémon marks it edited, shows edited: true in trade summary, and survives Colosseum -> XD conversion
  sp.editCard(dir, 'colosseum', c => edit.applyEdit(c, openNormal.place, openNormal.identity, { level: 55 }));
  const editedBytes = sp.slotAt(sp.cardCopies(dir, 'colosseum').copies[0].ctx, openNormal.place).bytes;
  assert.equal(tradeSummary('colosseum', editedBytes, 'colosseum').edited, true);
  assert.equal(tradeSummary('colosseum', editedBytes, 'xd').edited, true);
  const converted = tradeConvert.convert('colosseum', editedBytes, { game: 'xd', laterPokemon: true, laterMoves: true, laterItems: true });
  assert.equal(converted.problems.length, 0);
  assert.equal(Boolean(converted.bytes[sp.XD.at.edited] & sp.EDITED_FLAG), true, 'edited flag survives Colosseum -> XD trade');
  assert.equal(tradeSummary('xd', converted.bytes, 'xd').edited, true);

  // XD Shadow Pokémon edited in place also gets marked edited and blocked from Shadowtrade
  const xdDir = folder(t);
  const xdShadow = makeXdPokemon({ species: 216, rnd: 0x44556677, nickname: 'TEDDIURSA', level: 11, exp: 1331, moves: [[357, 0, 0], [10, 35, 0]], shadowId: 1 });
  const xdNormal = makeXdPokemon({ species: 133, rnd: 0x11111111, nickname: 'EEVEE', level: 10, exp: 1000 });
  makeXdCard(xdDir, [{ party: [xdNormal, xdShadow], darkRecords: { 1: { status: 3, species: 216, rnd: 0x44556677, gauge: 1200 } } }]);
  const xdOpen = edit.readSlot(sp.cardCopies(xdDir, 'xd').copies[0].ctx, { area: 'party', box: 0, slot: 1 });
  assert.equal(xdOpen.pokemon.edited, false);
  sp.editCard(xdDir, 'xd', c => edit.applyEdit(c, xdOpen.place, xdOpen.identity, { friendship: 200 }));
  const xdModel = sp.readCard(xdDir, 'xd');
  assert.equal(xdModel.party[1].edited, true);
  assert.equal(sp.offerProblem(xdModel, xdModel.party[1]), 'Edited Pokémon can\'t go to Shadowtrade.');
});

test('assertCanEditSave allows editing when trade managers are idle and blocks active trades', t => {
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const root = folder(t);
  const filename = path.resolve(__dirname, '../src/main.js');
  const localRequire = createRequire(filename);
  const electron = {
    ipcMain: { handle() {} },
    app: { requestSingleInstanceLock: () => true, commandLine: { appendSwitch() {} }, on() {},
      whenReady: () => ({ then() {} }), getPath: () => root, getVersion: () => '0.1.3', isPackaged: false },
    BrowserWindow: class {}, dialog: {}, shell: {}, clipboard: {}, net: {}, screen: {},
    protocol: { registerSchemesAsPrivileged() {}, handle() {} }
  };
  const context = {
    require: id => id === 'electron' ? electron : localRequire(id),
    __dirname: path.dirname(filename), process, setTimeout, setInterval, clearInterval, module: { exports: {} }
  };
  vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}
    module.exports = { assertCanEditSave, trades, onlineTrades, localTrades };`, context, { filename });
  const main = context.module.exports;

  // Instantiate all three trade managers (as opening the Pokémon tab does): idle managers must not block editing.
  const st = main.trades();
  const ot = main.onlineTrades();
  const lt = main.localTrades();
  assert.equal(typeof lt.trade, 'function');
  assert.doesNotThrow(() => main.assertCanEditSave('colosseum'));
  assert.doesNotThrow(() => main.assertCanEditSave('xd'));

  // Active local trade blocks editing, and clears once finished.
  lt.state.journal.push({ tradeId: 'local-1', stage: 'trading', sides: [] });
  assert.throws(() => main.assertCanEditSave('colosseum'), /trade in progress/);
  lt.state.journal.length = 0;
  assert.doesNotThrow(() => main.assertCanEditSave('colosseum'));

  // Active online trade blocks editing, and clears once finished.
  ot.server = { trade: { tradeId: 'online-1', stage: 'committed' } };
  assert.throws(() => main.assertCanEditSave('colosseum'), /trade in progress/);
  ot.server = null;
  assert.doesNotThrow(() => main.assertCanEditSave('colosseum'));

  // Busy Shadowtrade blocks editing, and clears once idle.
  st.busy = Promise.resolve();
  assert.throws(() => main.assertCanEditSave('colosseum'), /trade in progress/);
  st.busy = null;
  assert.doesNotThrow(() => main.assertCanEditSave('colosseum'));
});
