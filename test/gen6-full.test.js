'use strict';

// Generations 5 and 6 under X and Y's rules: their Pokémon, moves, abilities and held items, as the launcher offers and
// checks them (src/generations.js, src/formats.js, src/team-sets.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const generations = require('../src/generations');
const formats = require('../src/formats');
const teamSets = require('../src/team-sets');
const gen6Learnsets = require('../src/gen6-learnsets');

const FIELDS = ['name', 'types', 'stats', 'abilities', 'gender', 'catchRate', 'baseExp', 'evYield', 'growthRate', 'baseFriendship',
  'height', 'weight', 'levelUp', 'tm', 'evolutions'];
// a wire member (src/story-party.js wireMember) with an item, an ability slot and moves
const wire = (species, { item = 0, ability = 0, moves = [] } = {}) => {
  const m = [0, 0, 0, 0];
  moves.forEach((move, i) => { m[i] = move; });
  return [species, 0, 0, 4, ability, item, 255, m[0], 3, m[1], 3, m[2], 3, m[3], 3, 31, 31, 31, 31, 31, 31, 0, 0, 0, 0, 0, 0, '-'];
};

test('generation 6\'s file has all 721 Pokémon, each with everything a species row needs', () => {
  const data = generations.load(6);
  assert.deepEqual([data.newSpecies, data.newMoves, data.newAbilities], [[494, 721], [355, 621], [77, 191]]);
  assert.equal(Object.keys(data.species).length, 721);
  for (let n = 1; n <= 721; n++) {
    const entry = data.species[n];
    for (const field of FIELDS) assert.ok(entry?.[field] !== undefined, `#${n} has ${field}`);
    assert.equal(entry.name, entry.name.normalize('NFC'), `#${n}'s name is the game's letters`);
    assert.ok(entry.abilities.length >= 1 && entry.levelUp.length >= 1, `#${n}`);
  }
  assert.equal(data.species[494].name, 'Victini');
  assert.equal(data.species[721].name, 'Volcanion');
  assert.equal(data.species[669].name, 'Flabébé');
  assert.equal(data.species[530].hidden, 'Mold Breaker');
  assert.ok(generations.available().find(each => each.generation === 6).hasSpecies);
  assert.deepEqual(generations.pokemonGenerations(6), [4, 6]);
  assert.deepEqual(generations.pokemonGenerations(4), [4]);
});

test('every generation 5 and 6 move plays an old move\'s animation and the port\'s own effect', () => {
  const data = generations.load(6), gen4 = generations.load(4), fairy = generations.loadFairy();
  const key = text => String(text).toLowerCase().replace(/[^a-z]/g, '');
  // Colosseum's own moves, as generation 4's names have them (and Colosseum's own spellings)
  const own = new Set([...Array.from({ length: 354 }, (_, i) => key(gen4.moves[i + 1].name)), 'smellingsalt', 'faintattack']);
  const fairyNames = new Set(Object.values(fairy.newMoves).map(move => move.name));
  for (let n = 468; n <= 621; n++) {
    const move = data.moves[n], how = data.colosseum.moves[move.name];
    assert.ok(how, `${move.name} is in gen6-colosseum.json`);
    assert.ok(own.has(key(how.as)), `${move.name} plays as ${how.as}, one of Colosseum's moves`);
    // the Fairy type's moves play as fairy-colosseum.json has them
    if (fairyNames.has(move.name)) continue;
    assert.equal(move.effect, 'SHOWDOWN', move.name);
    assert.equal(how.effect, 300 + (n - 468), `${move.name}'s effect`);
  }
});

test('abilities of generations 5 and 6 are one past their own in the game, and back', () => {
  for (let n = 1; n <= 191; n++) assert.equal(generations.abilityNumber(generations.colosseumAbility(n)), n, `ability ${n}`);
  assert.equal(generations.colosseumAbility(77), 124, 'Tangled Feet');
  assert.equal(generations.colosseumAbility(124), 125, 'Pickpocket');
  assert.equal(generations.colosseumAbility(191), 192, 'Delta Stream');
  assert.equal(generations.abilityNumber(124), 77);
});

test('generations 5 and 6\'s held items are there, by the engine\'s numbers', () => {
  const { items } = require('../src/generations/gen6-items.json');
  const byId = new Map(items.map(item => [item.id, item]));
  const names = ['Assault Vest', 'Eviolite', 'Rocky Helmet', 'Weakness Policy', 'Air Balloon', 'Red Card', 'Ring Target', 'Binding Band',
    'Absorb Bulb', 'Cell Battery', 'Eject Button', 'Float Stone', 'Luminous Moss', 'Snowball', 'Safety Goggles', 'Normal Gem',
    'Pixie Plate', 'Roseli Berry', 'Kee Berry', 'Maranga Berry', 'Douse Drive', 'Shock Drive', 'Burn Drive', 'Chill Drive',
    'Prism Scale', 'Whipped Dream', 'Sachet'];
  names.forEach((name, i) => {
    const item = byId.get(650 + i);
    assert.equal(item?.name, name, `item ${650 + i}`);
    assert.ok(item.doc.length > 10, name);
    assert.equal(Boolean(item.berry), name.endsWith('Berry'), name);
  });
  assert.equal(formats.gen6Item(676), true);
  assert.equal(formats.gen6Item(677), false);
  assert.equal(teamSets.itemGeneration(676), 6);
  // the trade items are a level in the story, as generation 4's are
  const data = generations.load(6);
  assert.deepEqual(generations.evolutionOf(data, { into: 685, trade: 'Whipped Dream' }, n => n), { into: 'generation:685', level: 40 });
  assert.deepEqual(generations.evolutionOf(data, { into: 683, trade: 'Sachet' }, n => n), { into: 'generation:683', level: 40 });
  assert.equal(data.colosseum.evolutionItems['Dusk Stone'], 35, 'generation 4\'s kept');
});

test('a generation 5 Pokémon says so, and a sixth\'s its own', () => {
  const data = generations.load(6), game = { moves: new Map(), abilities: new Map(), types: [], species: [] };
  assert.equal(generations.speciesSpec(game, data, 530, []).description, 'Generation 5, National Pokédex #530.');
  assert.equal(generations.speciesSpec(game, data, 650, []).description, 'Generation 6, National Pokédex #650.');
  assert.equal(generations.speciesSpec(game, data, 669, []).name, 'FLABÉBÉ');
  // without Gen 6 types, a Fairy Pokémon is its other type, or Normal
  assert.deepEqual(generations.withoutFairy(['Grass', 'Fairy']), ['Grass']);
  assert.deepEqual(generations.withoutFairy(['Fairy']), ['Normal']);
  assert.deepEqual(generations.withoutFairy(['Fire', 'Flying']), ['Fire', 'Flying']);
});

test('a Generation 6 party has generations 5 and 6\'s Pokémon and moves; no other does', () => {
  const EXCADRILL = 556, DRILL_RUN = 532, HYPERSPACE_FURY = 624, MOONBLAST = 588;
  assert.equal(teamSets.validSpecies(EXCADRILL, 6), true);
  assert.equal(teamSets.validSpecies(EXCADRILL, 4), false);
  assert.equal(teamSets.validSpecies(748, 6), false);
  assert.equal(teamSets.speciesGeneration(EXCADRILL), 6);
  assert.equal(teamSets.moveGeneration(DRILL_RUN), 6);
  assert.equal(teamSets.moveGeneration(MOONBLAST), 3, 'a Fairy move: any party in a room with the type');
  const set = teamSets.normalizeSet({ species: EXCADRILL, moves: [DRILL_RUN, HYPERSPACE_FURY, 625], ability: 2 }, EXCADRILL, 6);
  assert.deepEqual([set.moves, set.ability], [[DRILL_RUN, HYPERSPACE_FURY], 2]);
  assert.deepEqual(teamSets.normalizeSet({ species: EXCADRILL, moves: [DRILL_RUN] }, EXCADRILL, 4).moves, []);
});

test('a Generation 5 Pokémon with its move and hidden ability is legal under X and Y\'s rules, and only there', () => {
  const EXCADRILL = 556, DRILL_RUN = 532, EARTHQUAKE = 89;
  assert.ok(gen6Learnsets.learns(EXCADRILL, DRILL_RUN));
  assert.ok(gen6Learnsets.hasHidden(EXCADRILL), 'Mold Breaker');
  const names = { species: () => 'Excadrill', move: id => ({ [DRILL_RUN]: 'Drill Run', [EARTHQUAKE]: 'Earthquake' })[id] };
  const problems = (rules, member = wire(EXCADRILL, { ability: 2, moves: [DRILL_RUN, EARTHQUAKE] })) =>
    formats.problems({ format: 'hoenn', ...rules }, [EXCADRILL], [member], names).filter(each => !/your party has/.test(each));
  assert.deepEqual(problems({ battleRules: 6 }), []);
  const four = problems({ battleRules: 4 });
  assert.ok(four.includes('Excadrill is a Generation 5 Pokémon, which play only under X and Y battle rules.'), four.join('\n'));
  assert.ok(four.includes('Excadrill knows Drill Run, a Generation 5 or 6 move, which play only under X and Y battle rules.'), four.join('\n'));
  assert.ok(four.some(each => /hidden ability/.test(each)), four.join('\n'));
  // a move it couldn't learn, under X and Y's rules
  assert.deepEqual(problems({ battleRules: 6 }, wire(EXCADRILL, { moves: [57] })), ['Excadrill can\'t learn move #57 in the sixth generation.']);
  // the fifth and sixth's legendaries are restricted or mythical
  assert.ok(formats.RESTRICTED.includes(743), 'Yveltal');
  assert.ok(formats.MYTHICAL.includes(520), 'Victini');
});
