'use strict';

// Pokémon X, Y, Omega Ruby and Alpha Sapphire saves (Generation 6, Nintendo 3DS), for bringing their Pokémon into
// Colosseum or XD (src/save-import.js): which game, the trainer, the party and the PC boxes. Only a decrypted save
// reads: the "main" file a save manager (JKSM, Checkpoint) copies off the 3DS, 0x65600 bytes for X and Y and 0x76000
// for Omega Ruby and Alpha Sapphire. From PKHeX's documented structures (SaveUtil, BlockInfo3DS, SaveBlockAccessor6XY
// and 6AO, SAV6, BoxLayout6, MyStatus6, PK6, PokeCrypto):
// - the save is blocks one after another, each rounded up to 0x200; 0x200 before the end is their table: two
//   timestamps, "BEEF" (0x42454546), then each block's length (u32), id (u16) and CRC-16 (CCITT, as the DS games');
// - the box layout (31 box names), the trainer (MyStatus) and the party (six 260-byte Pokémon, then the count) are at
//   the same places in both; the boxes (31 of 30 232-byte Pokémon) are where each game keeps them;
// - a Pokémon's four 56-byte blocks are shuffled by its encryption constant and enciphered with it (the same generator
//   as Generation 4's), its party stats after them enciphered again from the constant.
const ds = require('./ds-save');

const BOXES = 31, PER_BOX = 30, BOX_SIZE = 0xE8, PARTY_SIZE = 0x104, BLOCK = 56;
const BEEF = 0x42454546;
const LAYOUT = { id: 12, at: 0x04400, length: 0x00440 };
const STATUS = { id: 17, at: 0x14000, length: 0x00170 };
const PARTY = { id: 18, at: 0x14200, length: 0x0061C };
const GAMES = {
  xy: { name: 'X/Y', size: 0x65600, box: { id: 53, at: 0x22600, length: 0x34AD0 } },
  oras: { name: 'Omega Ruby/Alpha Sapphire', size: 0x76000, box: { id: 56, at: 0x33000, length: 0x34AD0 } }
};
// the trainer's game (MyStatus6 +4), for the name shown
const VERSIONS = { 24: 'X', 25: 'Y', 26: 'Alpha Sapphire', 27: 'Omega Ruby' };

// Which game the file is by its size and the table's "BEEF", or null
function detect(buffer) {
  for (const [id, game] of Object.entries(GAMES))
    if (buffer.length === game.size && buffer.readUInt32LE(game.size - 0x1F0) === BEEF) return id;
  return null;
}
// Whether the table says the block is this long and its CRC-16 is the block's
function whole(buffer, game, { id, at, length }) {
  const entry = game.size - 0x200 + 0x14 + id * 8;
  return buffer.readUInt32LE(entry) === length && buffer.readUInt16LE(entry + 4) === id
    && ds.crc16(buffer.subarray(at, at + length)) === buffer.readUInt16LE(entry + 6);
}

// One Pokémon, deciphered: 232 bytes laid out A, B, C, D, with whether it's whole; null for an empty slot (all zeros,
// or zeros enciphered).
function decipher(raw) {
  if (raw.subarray(0, BOX_SIZE).every(byte => !byte)) return null;
  const ec = raw.readUInt32LE(0), checksum = raw.readUInt16LE(6);
  const blocks = ds.cipher(raw.subarray(8, BOX_SIZE), ec);
  const order = ds.ORDERS[((ec >>> 13) & 31) % 24];
  const out = Buffer.alloc(BOX_SIZE);
  raw.copy(out, 0, 0, 8);
  for (let id = 0; id < 4; id++) blocks.copy(out, 8 + id * BLOCK, order[id] * BLOCK, order[id] * BLOCK + BLOCK);
  let sum = 0;
  for (let i = 8; i < BOX_SIZE; i += 2) sum = (sum + out.readUInt16LE(i)) & 0xFFFF;
  const intact = sum === checksum && !(raw.readUInt16LE(4) & 4);
  if (intact && !out.readUInt16LE(8)) return null;
  return { data: out, whole: intact };
}

// A Generation 6 name (UTF-16, 0 ends it) as its codes, at most `count`
function codes(bytes, count) {
  const out = [];
  for (let i = 0; i < count && i * 2 + 1 < bytes.length; i++) {
    const code = bytes.readUInt16LE(i * 2);
    if (code === 0) break;
    out.push(code);
  }
  return out;
}

// What the save is, or an error with a reason for players: { game, gameName, trainer (codes), trainerId, secretId,
// party: [{ data, whole }], boxes: [{ name (codes), pokemon: [{ data, whole } | null] }] }.
function parse(buffer) {
  const id = detect(buffer);
  if (!id) throw new Error("This isn't a decrypted Pokémon X, Y, Omega Ruby or Alpha Sapphire save (the \"main\" file), or it's damaged.");
  const game = GAMES[id];
  if (!whole(buffer, game, STATUS) || !whole(buffer, game, PARTY)) throw new Error(`This ${game.name} save's trainer or party is damaged.`);
  if (!whole(buffer, game, LAYOUT) || !whole(buffer, game, game.box)) throw new Error(`This ${game.name} save's PC boxes are damaged.`);
  const count = Math.min(6, buffer[PARTY.at + 6 * PARTY_SIZE]);
  const party = [];
  for (let i = 0; i < count; i++) {
    const at = PARTY.at + i * PARTY_SIZE;
    const mon = decipher(buffer.subarray(at, at + PARTY_SIZE));
    if (mon) party.push(mon);
  }
  const boxes = Array.from({ length: BOXES }, (_, b) => ({
    name: codes(buffer.subarray(LAYOUT.at + b * 0x22, LAYOUT.at + (b + 1) * 0x22), 16),
    pokemon: Array.from({ length: PER_BOX }, (_, i) => {
      const at = game.box.at + (b * PER_BOX + i) * BOX_SIZE;
      return decipher(buffer.subarray(at, at + BOX_SIZE));
    })
  }));
  const t = STATUS.at;
  return { game: id, gameName: VERSIONS[buffer[t + 4]] || game.name, trainer: codes(buffer.subarray(t + 0x48, t + 0x48 + 0x1A), 12),
    trainerId: buffer.readUInt16LE(t), secretId: buffer.readUInt16LE(t + 2), party, boxes };
}

module.exports = { GAMES, BOXES, BOX_SIZE, PARTY_SIZE, BLOCK, BEEF, LAYOUT, STATUS, PARTY, detect, parse, decipher, codes };
