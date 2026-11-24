'use strict';
const test = require('node:test');
const assert = require('node:assert');
const forms = require('../src/forms');
const generations = require('../src/generations');

const data = generations.load(6);
// a Colosseum Pokémon of 0x138 bytes: species, personality, level, moves, stats, EVs, IVs, ability slot
function colosseum(species, level, moves, slot = 0) {
  const b = Buffer.alloc(0x138);
  b.writeUInt16BE(species, 0); b.writeUInt32BE(0, 0x04); b[0x60] = level;   // (personality 0: Hardy, no stat up or down)
  moves.forEach((move, i) => { b.writeUInt16BE(move, 0x78 + 4 * i); b[0x7a + 4 * i] = 10; });
  for (let i = 0; i < 6; i++) b.writeUInt16BE(31, 0xa4 + 2 * i);
  b.writeUInt16BE(100, 0x8a); b.writeUInt16BE(200, 0x8c); b[0xcc] = slot;
  return b;
}

test('the forms a Pokémon can change into, and what canon changes them with', () => {
  assert.deepEqual(forms.changerOf(645, data), { by: 'Reveal Glass', forms: [645, 737] });
  assert.deepEqual(forms.changerOf(737, data).forms, [645, 737], 'from the form back too');
  assert.equal(forms.changerOf(678, data), null, 'a female Meowstic is one from the start');
  assert.equal(forms.changerOf(25, data), null);
});

test('Landorus into its Therian Forme: species, stats from its base stats, HP in proportion, one ability', () => {
  const b = colosseum(645 + 26, 50, [89, 0, 0, 0], 1);
  const done = forms.changeForm(b, 'colosseum', 737, data);
  assert.equal(done.name, 'Landorus-Therian');
  assert.equal(b.readUInt16BE(0), 737 + 26);
  assert.equal(b.readUInt16BE(0x8e), Math.floor((2 * 145 + 31) * 50 / 100) + 5, 'Attack from 145, not 125');
  assert.equal(b.readUInt16BE(0x8a), Math.round(100 * b.readUInt16BE(0x8c) / 200), 'half its HP, as before');
  assert.equal(b[0xcc], 0, 'Therian Forme has one ability');
  assert.throws(() => forms.changeForm(b, 'colosseum', 738, data), /can't change into that form/);
});

test('a form\'s own move takes its place: Kyurem\'s fusion moves, Rotom\'s appliance move, Hoopa\'s Hyperspace Fury', () => {
  const kyurem = colosseum(646 + 26, 70, [549 + 3, 184, 33, 0]);
  forms.changeForm(kyurem, 'colosseum', 738, data);
  assert.deepEqual([0, 1, 2].map(i => kyurem.readUInt16BE(0x78 + 4 * i)), [553 + 3, 559 + 3, 33], 'Freeze Shock, Fusion Bolt');
  forms.changeForm(kyurem, 'colosseum', 646, data);
  assert.deepEqual([0, 1].map(i => kyurem.readUInt16BE(0x78 + 4 * i)), [549 + 3, 184], 'and back');
  const rotom = colosseum(479 + 26, 30, [84, 86, 0, 0]);
  forms.changeForm(rotom, 'colosseum', 728, data);
  assert.deepEqual([0, 1, 2].map(i => rotom.readUInt16BE(0x78 + 4 * i)), [84, 86, 56], 'it learns Hydro Pump');
  forms.changeForm(rotom, 'colosseum', 727, data);
  assert.deepEqual([0, 1, 2].map(i => rotom.readUInt16BE(0x78 + 4 * i)), [84, 86, 315], 'Overheat for Hydro Pump');
  forms.changeForm(rotom, 'colosseum', 479, data);
  assert.deepEqual([0, 1, 2].map(i => rotom.readUInt16BE(0x78 + 4 * i)), [84, 86, 0], 'and forgets it as plain Rotom');
  const hoopa = colosseum(720 + 26, 70, [593 + 3, 0, 0, 0]);
  forms.changeForm(hoopa, 'colosseum', 747, data);
  assert.equal(hoopa.readUInt16BE(0x78), 621 + 3);
});
