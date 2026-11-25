'use strict';
// Trades between your own games: a Pokémon of your Colosseum save for one of your XD save, with no one else and no
// server (shadowtrade-work/SPEC-trades.md, "Between your games"). The trade window on the Pokémon page shows both saves;
// a Pokémon is picked from each, every stat of both is there to look over, and Trade swaps them. Each is made the other
// game's (trade-convert.js), and each game shows the Pokémon it got (arrivals.js): the running game now, the other the
// next time it's played from the launcher, with its trade evolution then.
//
// At most one of the two games runs (the launcher plays one at a time): that save is changed by the running game, which
// saves itself (shadowtrade.js liveAccess, a build whose hello says trade.1), the other on its card. As Online Trades,
// a Pokémon is never in two places and never lost: the trade is in the journal (state.json here) before either save
// changes, both Pokémon leave their saves before either is given, and a trade cut short (the launcher closed, the game
// closed before it took a Pokémon) is finished later by sync(). The running game goes first: it's the one that may not
// get to it (in a battle, say), and a trade it can't start changes nothing.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const savePokemon = require('./save-pokemon');
const convert = require('./trade-convert');
const { summary, tradeEvolution } = require('./online-trades');

const STATE_VERSION = 1;
const HISTORY = 30;
const GAMES = ['colosseum', 'xd'];
const otherGame = game => (game === 'xd' ? 'colosseum' : 'xd');
const label = game => (game === 'xd' ? 'XD' : 'Colosseum');
const b64 = bytes => Buffer.from(bytes).toString('base64');
const unb64 = text => Buffer.from(String(text || ''), 'base64');
const atOf = game => (game === 'xd' ? savePokemon.XD.at : savePokemon.COLOSSEUM.at);
const identityOf = (game, bytes) => ({ species: bytes.readUInt16BE(0), rnd: bytes.readUInt32BE(atOf(game).rnd), trainer: bytes.readUInt32BE(atOf(game).trainer) });
// a species of `game` in the viewer's game's numbers (the page's Pokédex is the chosen game's)
const speciesFor = (viewer, game, id) => convert.speciesFromColosseum(viewer, convert.speciesToColosseum(game, id));

const COMMAND_ERRORS = {
  'last-pokemon': 'You can\'t trade your last Pokémon that can battle: keep one in your party.',
  shadow: 'A Shadow Pokémon can\'t be traded until it\'s purified.', egg: 'Eggs can\'t be traded.',
  full: 'That save\'s party and PC boxes are full.',
  save: 'The game couldn\'t save, so nothing was traded.', missing: 'That Pokémon isn\'t in the save any more.',
  timeout: 'The game didn\'t reach a moment it could trade in: walk around in the field, outside menus and battles, and trade again.',
  unknown: 'The game didn\'t say whether it traded. The launcher looks at your save and finishes the trade.',
  invalid: 'The game refused the Pokémon. Update the game.'
};
const commandError = result => COMMAND_ERRORS[result.code] || `The game couldn't trade (${result.code}${result.message ? `: ${result.message}` : ''}).`;

function writeAtomic(file, text) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, text);
  try { fs.renameSync(temporary, file); } catch (error) {
    if (process.platform !== 'win32') throw error;
    fs.rmSync(file, { force: true });
    fs.renameSync(temporary, file);
  }
}

// A Pokémon's bytes in a save, by who it is (at `place` first): the save's own lookup
const findIn = (read, identity, place) => savePokemon.findPokemon(read.ctx, identity, place)?.bytes || null;

class LocalTrades {
  // accessFor(game): the save as shadowtrade.js reaches it (cardAccess / liveAccess, null: not now); unavailable(game): why
  // not, in a sentence; receiverFor(game): what that game takes (trade-convert.js); arrivals: arrivals.js, which has each
  // game show the Pokémon it got (null: nothing shown, and no trade evolution).
  constructor({ folder, log = () => {}, onChange = () => {}, accessFor = () => null, unavailable = () => null,
    receiverFor = game => ({ game }), arrivals = null, find = findIn, now = () => Date.now() }) {
    Object.assign(this, { folder, log, onChange, accessFor, unavailable, receiverFor, arrivals, find, now });
    this.file = path.join(folder, 'state.json');
    this.state = this.load();
    this.isOpen = false;
    this.picks = { colosseum: null, xd: null };   // { place, identity, data (base64) }
    this.last = null;                             // the trade the window shows as done (its tradeId), until it's closed
    this.queue = Promise.resolve();
  }

  load() {
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (state.version === STATE_VERSION) return { journal: [], history: [], ...state };
    } catch (_) { /* a new one */ }
    return { version: STATE_VERSION, journal: [], history: [] };
  }

  save() {
    fs.mkdirSync(this.folder, { recursive: true });
    writeAtomic(this.file, JSON.stringify(this.state, null, 2));
    this.onChange();
  }

  // one thing at a time: the saves are changed one step at a time, in order
  serial(work) {
    const run = this.queue.then(work, work);
    this.queue = run.catch(error => this.log(`Trades between your games: ${error.message}`));
    return run;
  }

  // ---- the window ----

  open() {
    if (this.state.journal.length) { this.isOpen = true; this.onChange(); return; }
    for (const game of GAMES) {
      if (!this.accessFor(game)?.read()) throw new Error(this.unavailable(game) || `There is no ${label(game)} save to trade from yet.`);
    }
    this.isOpen = true;
    this.picks = { colosseum: null, xd: null };
    this.last = null;
    this.onChange();
  }

  close() {
    this.isOpen = false;
    this.picks = { colosseum: null, xd: null };
    this.last = null;
    this.onChange();
  }

  // The Pokémon at `place` ({ area, box, slot }) of `game`'s save for the trade, or null to take it back.
  pick(game, place) {
    if (!GAMES.includes(game)) throw new Error('No such game.');
    if (!this.isOpen) throw new Error('Open the trade between your games first.');
    if (this.state.journal.length) throw new Error('A trade is under way.');
    this.last = null;
    if (!place) { this.picks[game] = null; this.onChange(); return; }
    const read = this.accessFor(game)?.read();
    if (!read) throw new Error(this.unavailable(game) || `There is no ${label(game)} save to trade from yet.`);
    const list = place.area === 'party' ? read.model.party : read.model.boxes[place.box]?.pokemon;
    const pokemon = list?.[place.slot];
    const problem = savePokemon.tradeProblem(read.model, pokemon);
    if (problem) throw new Error(problem);
    const identity = { species: pokemon.species, rnd: pokemon.rnd, trainer: pokemon.trainer };
    const bytes = this.find(read, identity, place);
    if (!bytes) throw new Error('That Pokémon isn\'t in the save any more.');
    this.picks[game] = { place, identity, data: b64(bytes) };
    this.onChange();
  }

  // What the other game would make of a Pokémon of `game`'s (its bytes): its problems, and its trade evolution there.
  judge(game, bytes) {
    const to = otherGame(game);
    try {
      const made = convert.convert(game, bytes, { ...this.receiverFor(to), game: to });
      return { problems: made.problems.map(problem => problem.text), bytes: made.bytes, evolvesInto: made.bytes && !made.problems.length ? tradeEvolution(to, made.bytes) : 0 };
    } catch (_) { return { problems: ['That Pokémon\'s data is damaged.'], bytes: null, evolvesInto: 0 }; }
  }

  // ---- the trade ----

  trade() {
    return this.serial(async () => {
      if (this.state.journal.length) throw new Error('A trade is under way.');
      const sides = [];
      for (const game of GAMES) {
        const pick = this.picks[game];
        if (!pick) throw new Error(`Pick a Pokémon from your ${label(game)} save too.`);
        const access = this.accessFor(game), read = access?.read();
        if (!read) throw new Error(this.unavailable(game) || `Your ${label(game)} save can't be reached now.`);
        // as it is now (a level gained in the game since it was picked, say)
        const bytes = this.find(read, pick.identity, pick.place);
        if (!bytes) { this.picks[game] = null; this.onChange(); throw new Error(`The Pokémon you picked from your ${label(game)} save isn't there any more. Pick again.`); }
        const all = [...read.model.party, ...read.model.boxes.flatMap(box => box.pokemon)].filter(Boolean);
        const problem = savePokemon.tradeProblem(read.model, all.find(each => each.species === pick.identity.species && each.rnd === pick.identity.rnd && each.trainer === pick.identity.trainer));
        if (problem) throw new Error(problem);
        const judged = this.judge(game, bytes);
        if (judged.problems.length) throw new Error(`${label(otherGame(game))} can't take it: ${judged.problems[0]}`);
        sides.push({ game, mode: access.mode, trainer: read.model.trainer || null, identity: pick.identity, place: pick.place, data: b64(bytes) });
      }
      // the running game first (see above)
      sides.sort((a, b) => (a.mode === 'live' ? 0 : 1) - (b.mode === 'live' ? 0 : 1));
      const entry = { tradeId: crypto.randomBytes(8).toString('hex'), stage: 'trading', createdAt: this.now(), message: null,
        sides: sides.map(({ mode, ...side }) => ({ ...side, taken: false, taking: false, given: false, placed: null, evolvesInto: 0 })) };
      this.state.journal.push(entry);
      this.last = entry.tradeId;
      this.save();
      await this.step(entry, { first: true });
      return entry.tradeId;
    });
  }

  // A trade's next steps from where its journal entry is, as far as each can go now. first: the trade has just started,
  // and a side the running game couldn't take from calls it off (and says why) rather than waiting.
  async step(entry, { first = false } = {}) {
    if (entry.stage === 'trading') {
      for (const side of entry.sides) {
        if (side.taken) continue;
        const access = this.accessFor(side.game);
        if (!access) { entry.message = this.unavailable(side.game) || `Waiting for your ${label(side.game)} save.`; this.save(); return; }
        if (side.taking) {
          // a take that didn't say how it went: the save says
          if (!access.has(side.identity)) { side.taken = true; side.taking = false; this.save(); continue; }
          side.taking = false;
        }
        side.taking = true;
        this.save();
        const taken = await access.tradeTake(side.identity, side.place);
        if (taken.ok) {
          side.taken = true; side.taking = false; entry.message = null;
          this.save();
          this.log(`Trades between your games: ${summary(side.game, unb64(side.data)).nickname} left your ${label(side.game)} save.`);
          continue;
        }
        if (taken.code === 'unknown') { entry.message = commandError(taken); this.save(); return; }
        side.taking = false;
        if (!entry.sides.some(each => each.taken)) {
          // nothing has left either save: the trade didn't happen
          this.state.journal = this.state.journal.filter(each => each !== entry);
          this.save();
          const error = new Error(commandError(taken));
          if (first) throw error;
          this.log(`Trades between your games: called off (${error.message})`);
          return;
        }
        // the other's has left its save: it goes back
        entry.stage = 'returning';
        entry.message = `${commandError(taken)} Your other Pokémon goes back where it was.`;
        this.save();
        break;
      }
    }
    if (entry.stage === 'trading') {
      // both are out: each goes into the other's save, the card first (it can't be busy), then the running game's
      const order = [...entry.sides].sort((a, b) => (this.accessFor(a.game)?.mode === 'live' ? 1 : 0) - (this.accessFor(b.game)?.mode === 'live' ? 1 : 0));
      for (const side of order) {
        if (side.given) continue;
        const from = entry.sides.find(each => each !== side);
        const made = this.judge(from.game, unb64(from.data));
        if (!made.bytes || made.problems.length) {
          // the game's settings changed since (a later generation turned off): both go back
          entry.stage = 'returning';
          entry.message = `${label(side.game)} can't take it now: ${made.problems[0] || 'it couldn\'t be made that game\'s'} Both Pokémon go back where they were.`;
          this.save();
          break;
        }
        if (!(await this.give(entry, side, made.bytes))) return;
        side.evolvesInto = made.evolvesInto;
        this.save();
      }
    }
    if (entry.stage === 'returning') {
      for (const side of entry.sides) {
        if (!side.taken || side.given) continue;
        const own = convert.convert(side.game, unb64(side.data), { ...this.receiverFor(side.game), game: side.game, laterPokemon: true, laterMoves: true, laterItems: true, gen6Pokemon: true, gen6Moves: true, gen6Items: true });
        if (!(await this.give(entry, side, own.bytes || unb64(side.data)))) return;
      }
    }
    if (entry.sides.every(side => side.given || (entry.stage === 'returning' && !side.taken))) this.finish(entry);
  }

  // A Pokémon into `side`'s save: true once it's there.
  async give(entry, side, bytes) {
    const access = this.accessFor(side.game);
    if (!access) { entry.message = this.unavailable(side.game) || `Waiting for your ${label(side.game)} save.`; this.save(); return false; }
    const identity = identityOf(side.game, bytes);
    const given = access.has(identity) ? { ok: true, already: true } : await access.tradeGive(bytes);
    if (!given.ok) { entry.message = commandError(given); this.save(); return false; }
    side.given = true;
    side.placed = { identity, place: given.area ? { area: given.area, box: given.box, slot: given.slot } : null, data: b64(bytes) };
    entry.message = null;
    this.save();
    return true;
  }

  finish(entry) {
    const returned = entry.stage === 'returning';
    if (!returned && this.arrivals) {
      for (const side of entry.sides) {
        const from = entry.sides.find(each => each !== side);
        this.arrivals.add({ game: side.game, kind: 'local', from: `your ${label(from.game)} save`, data: side.placed.data, identity: side.placed.identity,
          place: side.placed.place, evolvesInto: side.evolvesInto || 0, tradeId: `${entry.tradeId}:${side.game}` });
      }
    }
    this.state.journal = this.state.journal.filter(each => each !== entry);
    this.state.history.unshift({ tradeId: entry.tradeId, at: this.now(), returned, reason: returned ? entry.message : null,
      sides: entry.sides.map(side => ({ game: side.game, trainer: side.trainer, sent: side.data, received: returned ? null : side.placed.data,
        evolvesInto: returned ? 0 : side.evolvesInto || 0, evolved: returned || !side.evolvesInto ? false : !this.arrivals })) });
    this.state.history = this.state.history.slice(0, HISTORY);
    if (this.last === entry.tradeId) this.picks = { colosseum: null, xd: null };
    this.save();
    this.log(returned ? 'Trades between your games: called off, both Pokémon are back where they were.'
      : `Trades between your games: ${entry.sides.map(side => `${summary(side.game, unb64(side.data)).nickname} went to ${label(otherGame(side.game))}`).join(', ')}.`);
  }

  // A game has shown the Pokémon it got (arrivals.js; tradeId "<trade>:<game>"): result.evolved, the species it evolved into
  arrived(tradeId, result) {
    const [id, game] = String(tradeId).split(':');
    const side = this.state.history.find(each => each.tradeId === id)?.sides.find(each => each.game === game);
    if (!side) return;
    side.evolved = Boolean(result?.evolved);
    if (side.evolvesInto && !side.evolved && result?.ok) side.evolvesInto = 0;   // it didn't evolve after all
    side.shown = true;
    this.save();
  }

  // Every trade the journal has: as far as each can go now (the launcher started, a game linked or closed).
  sync() {
    return this.serial(async () => {
      for (const entry of [...this.state.journal]) await this.step(entry);
    });
  }

  // ---- what the page shows (in the viewer's game's numbers: the page's Pokédex is the chosen game's) ----

  view(viewer) {
    const saves = {}, picks = {};
    for (const game of GAMES) {
      const access = this.accessFor(game);
      let read = null;
      try { read = access?.read() || null; } catch (_) { read = null; }
      saves[game] = { ready: Boolean(read), source: read ? access.mode : null, trainer: read?.model.trainer || null,
        notice: read ? null : this.unavailable(game) || `There is no ${label(game)} save yet.`,
        model: this.isOpen && read ? this.modelView(game, read.model, viewer) : null };
      const pick = this.picks[game];
      if (pick && this.isOpen) {
        const bytes = unb64(pick.data), judged = this.judge(game, bytes);
        picks[game] = { place: pick.place, summary: summary(game, bytes, viewer), problems: judged.problems,
          evolvesInto: judged.evolvesInto ? speciesFor(viewer, otherGame(game), judged.evolvesInto) : 0 };
      } else picks[game] = null;
    }
    const entry = this.state.journal[0] || null;
    const sideView = side => ({ game: side.game, trainer: side.trainer || null, sent: summary(side.game, unb64(side.data || side.sent), viewer),
      received: side.received || side.placed ? summary(side.game, unb64(side.received || side.placed.data), viewer) : null,
      taken: Boolean(side.taken), given: Boolean(side.given), evolvesInto: side.evolvesInto ? speciesFor(viewer, side.game, side.evolvesInto) : 0,
      evolved: Boolean(side.evolved), shown: Boolean(side.shown), live: saves[side.game].source === 'live' });
    const history = this.state.history.slice(0, HISTORY).map(item => ({ tradeId: item.tradeId, at: item.at, returned: item.returned, reason: item.reason || null, sides: item.sides.map(sideView) }));
    return {
      open: this.isOpen, viewer, other: otherGame(viewer), saves, picks,
      canTrade: Boolean(this.isOpen && !entry && GAMES.every(game => saves[game].ready && picks[game] && !picks[game].problems.length)),
      trade: entry ? { tradeId: entry.tradeId, stage: entry.stage, message: entry.message || null, sides: entry.sides.map(sideView) } : null,
      last: !entry && this.last ? history.find(item => item.tradeId === this.last) || null : null,
      history
    };
  }

  // A save's party and boxes for the picker: each Pokémon in the viewer's numbers, with why it can't be traded (null: it can)
  modelView(game, model, viewer) {
    const each = pokemon => pokemon && { ...pokemon, species: speciesFor(viewer, game, pokemon.species), tradeProblem: savePokemon.tradeProblem(model, pokemon) };
    return { game, trainer: model.trainer, party: model.party.map(each), boxes: model.boxes.map(box => ({ name: box.name, pokemon: box.pokemon.map(each) })) };
  }
}

module.exports = { LocalTrades, otherGame };
