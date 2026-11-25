'use strict';

// Pokémon Black, White, Black 2 and White 2 saves (Generation 5, Nintendo DS), for bringing their Pokémon into
// Colosseum or XD (src/save-import.js): which game, the trainer, the party and the PC boxes, read from the save file
// alone. A save is 512 KB, as Diamond, Pearl and Platinum's are (emulators: .sav, RetroArch's .srm, DeSmuME's .dsv with
// its own footer after it). From PKHeX's documented structures (SaveUtil IsG5BW/IsG5B2W2, SaveBlockAccessor5BW and
// 5B2W2, SAV5, BoxLayout5, PlayerData5, PK5):
// - the save's main copy is its first 0x24000 bytes (Black and White) or 0x26000 (Black 2 and White 2), in blocks;
//   each block's CRC-16 (CCITT, as Generation 4's) is two bytes after its end, and a table of them all sits 0x100
//   before the copy's end, whose own CRC says which pair of games the save is;
// - the boxes' names, then 24 boxes of 30 136-byte Pokémon (each box a block of its own, 0x1000 apart), the party (a
//   count, then six 220-byte Pokémon) and the trainer are at the same places in both;
// - a Pokémon is enciphered as Generation 4's is (src/ds-save.js decipher): four 32-byte blocks shuffled by its
//   personality and enciphered with its checksum.
const ds = require('./ds-save');

const SAVE_SIZE = 0x80000;
const BOXES = 24, PER_BOX = 30, BOX_SIZE = 136, PARTY_SIZE = 220;
const BOX_NAMES = { at: 0x00000, length: 0x3E0 };
const PARTY = { at: 0x18E00, length: 0x534 };
const TRAINER_AT = 0x19400;
const boxBlock = box => ({ at: 0x400 + box * 0x1000, length: 0xFF0 });
// Each pair of games: the main copy's size, the checksum table's length, the trainer block's length
const GAMES = {
  bw: { name: 'Black/White', size: 0x24000, table: 0x8C, trainer: 0x68 },
  b2w2: { name: 'Black 2/White 2', size: 0x26000, table: 0x94, trainer: 0xB0 }
};
// the trainer's game (PlayerData5 0x1F), for the name shown
const VERSIONS = { 20: 'White', 21: 'Black', 22: 'White 2', 23: 'Black 2' };

// Whether the block's CRC-16, two bytes after it, is its own
function whole(buffer, { at, length }) {
  if (at + length + 4 > buffer.length) return false;
  return ds.crc16(buffer.subarray(at, at + length)) === buffer.readUInt16LE(at + length + 2);
}
// Which pair of games the save is by its checksum table (0x100 before the main copy's end, its CRC 0x0E after it), or null
function detect(buffer) {
  if (buffer.length < SAVE_SIZE) return null;
  for (const [id, game] of Object.entries(GAMES)) {
    const at = game.size - 0x100;
    if (ds.crc16(buffer.subarray(at, at + game.table)) === buffer.readUInt16LE(at + game.table + 0x0E)) return id;
  }
  return null;
}

// A Generation 5 name (16-bit codes; 0xFFFF or 0 ends it) as its codes, at most `count`
function codes(bytes, count) {
  const out = [];
  for (let i = 0; i < count && i * 2 + 1 < bytes.length; i++) {
    const code = bytes.readUInt16LE(i * 2);
    if (code === 0xFFFF || code === 0) break;
    out.push(code);
  }
  return out;
}

// What the save is, or an error with a reason for players: { game, gameName, trainer (codes), trainerId, secretId,
// party: [{ data, whole }], boxes: [{ name (codes), pokemon: [{ data, whole } | null] }] }, each Pokémon deciphered as
// src/ds-save.js decipher gives it (136 bytes).
function parse(buffer) {
  const id = detect(buffer);
  if (!id) throw new Error("This isn't a Pokémon Black, White, Black 2 or White 2 save, or it's damaged.");
  const game = GAMES[id];
  const trainerBlock = { at: TRAINER_AT, length: game.trainer };
  if (!whole(buffer, trainerBlock) || !whole(buffer, PARTY)) throw new Error(`This ${game.name} save's trainer or party is damaged.`);
  if (!whole(buffer, BOX_NAMES) || Array.from({ length: BOXES }, (_, b) => boxBlock(b)).some(block => !whole(buffer, block)))
    throw new Error(`This ${game.name} save's PC boxes are damaged.`);
  const count = Math.min(6, buffer[PARTY.at + 4]);
  const party = [];
  for (let i = 0; i < count; i++) {
    const at = PARTY.at + 8 + i * PARTY_SIZE;
    const mon = ds.decipher(buffer.subarray(at, at + PARTY_SIZE));
    if (mon) party.push(mon);
  }
  const boxes = Array.from({ length: BOXES }, (_, b) => ({
    name: codes(buffer.subarray(BOX_NAMES.at + 4 + b * 0x28, BOX_NAMES.at + 4 + b * 0x28 + 0x14), 10),
    pokemon: Array.from({ length: PER_BOX }, (_, i) => {
      const at = boxBlock(b).at + i * BOX_SIZE;
      return ds.decipher(buffer.subarray(at, at + BOX_SIZE));
    })
  }));
  const t = TRAINER_AT;
  return { game: id, gameName: VERSIONS[buffer[t + 0x1F]] || game.name, trainer: codes(buffer.subarray(t + 4, t + 0x14), 8),
    trainerId: buffer.readUInt16LE(t + 0x14), secretId: buffer.readUInt16LE(t + 0x16), party, boxes };
}

module.exports = { SAVE_SIZE, GAMES, BOXES, BOX_SIZE, PARTY_SIZE, PARTY, TRAINER_AT, BOX_NAMES, boxBlock, detect, parse, codes };
