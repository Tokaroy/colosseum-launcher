'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ways = require('../src/evolution-ways');

test('each of the game\'s ways of evolving is said for the player', () => {
  assert.equal(ways.describe(4, 16).text, 'Level 16');
  assert.equal(ways.describe(5, 0).text, 'Trade');
  assert.equal(ways.describe(6, 199).text, 'Trade holding Metal Coat');
  assert.equal(ways.describe(7, 96).text, 'Thunder Stone');
  assert.equal(ways.describe(1, 0).text, 'High friendship');
  assert.equal(ways.describe(9, 20).text, 'Level 20, Attack equal to Defense');
  // the ways the game can't make say so
  for (const kind of [2, 3, 15]) {
    const way = ways.describe(kind, 170);
    assert.equal(way.blocked, true);
    assert.match(way.note, /can't/);
  }
});

test('kind 16 is XD\'s shards on XD\'s disc, and the port\'s known move in the launcher\'s rows', () => {
  assert.equal(ways.describe(16, 516, { game: 'xd' }).text, 'High friendship, Sun Shard in the bag');
  assert.equal(ways.describe(16, 246).text, 'Level up knowing Ancient Power');
  assert.equal(ways.describe(17, 340, { speciesName: () => 'Remoraid' }).text, 'Level up with Remoraid in the party');
  assert.equal(ways.describe(19, 35).text, 'Level 35, female');
  // a row's 6 bytes: kind, 0, condition, into
  assert.equal(ways.describeBytes(Buffer.from([0, 0, 0, 0, 0, 0, 4, 0, 0, 36, 0, 6]), 6).text, 'Level 36');
});

test('an item or place evolution made a level says how Platinum has it', () => {
  assert.equal(ways.platinumWay(126, 467), 'In Platinum, it evolves when traded holding a Magmarizer.');
  assert.equal(ways.platinumWay(299, 476), 'In Platinum, it evolves as it levels up at Mt. Coronet.');
  assert.equal(ways.platinumWay(215, 461), 'In Platinum, it evolves as it levels up holding a Razor Claw at night.');
  assert.equal(ways.platinumWay(281, 475), 'In Platinum, it evolves with a Dawn Stone.');
  // the game has the item, or Platinum evolves it by level: nothing to add
  assert.equal(ways.platinumWay(25, 26), null);
  assert.equal(ways.platinumWay(1, 2), null);
  // Eevee's Moss and Ice Rocks: a Leaf Stone and NeverMeltIce stand in, so nothing is left that the game can't make
  assert.deepEqual(ways.platinumOnly(470), []);
  assert.match(ways.platinumWay(133, 471), /NeverMeltIce stands in/);
  // generations 5 and 6's, as the 3DS games have them
  assert.match(ways.platinumWay(686, 687), /upside down/);
  assert.match(ways.platinumWay(133, 700), /Affection/);
  assert.equal(ways.describe(20, 212).text, 'Level up holding NeverMeltIce');
  assert.equal(ways.describe(21, 18).text, 'High friendship, knowing a Fairy-type move');
  assert.equal(ways.describe(22, 32).text, 'Level 32, a Dark type in the party');
});

test('a lower level comes first, and the higher is had by stopping it', () => {
  const [gardevoir, gallade] = ways.overlappingLevels([ways.describe(4, 30), ways.describe(18, 35)], ['Gardevoir', 'Gallade']);
  assert.equal(gardevoir.note, 'From level 35, a male one evolves into Gallade instead.');
  assert.equal(gallade.note, 'It evolves into Gardevoir at level 30 first: press B to stop that, and it evolves into Gallade from level 35.');
  const [glalie, froslass] = ways.overlappingLevels([ways.describe(4, 42), ways.describe(19, 35)], ['Glalie', 'Froslass']);
  assert.match(glalie.note, /^A female one evolves into Froslass at level 35 first/);
  assert.equal(froslass.note, 'From level 42, it evolves into Glalie instead.');
  // one for each gender at the same level overlap in nothing
  assert.deepEqual(ways.overlappingLevels([ways.describe(19, 20), ways.describe(18, 20)], ['Wormadam', 'Mothim']).map(way => way.note), [undefined, undefined]);
});
