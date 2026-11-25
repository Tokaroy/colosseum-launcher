// The Save Pokémon Editor: edit a Pokémon directly in your Colosseum or XD save from the Pokémon tab (only while the
// game is closed). Mirrors the online team builder's set editor (src/team-builder.js) and adds Level and PP Ups.
(() => {
  const $ = id => document.getElementById(id);
  const T = window.coloTeamSets;
  const LIST_LIMIT = 700;
  const SHEDINJA = 303;
  const message = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const number = national => `#${String(national).padStart(3, '0')}`;
  const key = text => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  };
  const typeChip = type => {
    const chip = el('span', { className: 'pokedex-type', textContent: type });
    chip.dataset.type = type.toLowerCase().replace(/\W/g, '');
    return chip;
  };

  let session = null;   // { game, boxName, place, identity, draft, catalog, byId, packById, moveById, itemById, onSaved }
  let view = 'set';     // 'set' | 'picker'
  let list = null;      // open move/item autocomplete dropdown
  let saving = false;
  let gameRunning = false;
  let saveError = '';
  let statsRefs = null;

  const gameLabel = game => (game === 'xd' ? 'Pokémon XD' : 'Pokémon Colosseum');
  const receiver = () => session?.catalog?.receiver || {};
  const rules = () => session?.catalog?.battleRules || 3;
  const battle = () => session?.catalog?.battle || {};

  function speciesInfo(id) {
    if (!session) return { abilities: [], gender: T.GENDER.none, learnset: [] };
    const pack = session.packById.get(id);
    if (pack) return { gender: pack.gender, abilities: pack.abilities, learnset: [] };
    const b = battle(), gen6 = b.generations?.[6]?.species?.[id], gen4 = b.generations?.[4]?.species?.[id], own = b.species?.[id];
    if (id >= 520 && id <= 773) return gen6 || { abilities: [], gender: T.GENDER.none, learnset: [] };
    const row = (rules() >= 6 || receiver().gen6Moves || receiver().hiddenAbilities) ? (gen6 || gen4 || own)
      : (rules() >= 4 || receiver().laterMoves) ? (gen4 || own || gen6)
        : (own || gen4 || gen6);
    return row || { abilities: [], gender: T.GENDER.none, learnset: [] };
  }

  function movesOf() {
    const b = battle(), r = receiver();
    if (r.gen6Moves) return b.generations?.[6]?.moves || b.generations?.[4]?.moves || b.moves || [];
    const base = r.laterMoves ? (b.generations?.[4]?.moves || b.moves || []) : (b.moves || []);
    if (r.fairyType && b.fairy) {
      return [...base.map(move => b.fairy.retyped.includes(move.id) ? { ...move, type: 'Fairy' } : move), ...b.fairy.moves];
    }
    return base;
  }

  function itemsOf() {
    const b = battle(), r = receiver();
    if (r.gen6Items) return b.generations?.[6]?.items || b.generations?.[4]?.items || b.items || [];
    return r.laterItems ? (b.generations?.[4]?.items || b.items || []) : (b.items || []);
  }

  function pickable() {
    if (!session) return [];
    const r = receiver(), allowGen4 = Boolean(r.laterPokemon), allowGen6 = Boolean(r.gen6Pokemon), isXd = session.game === 'xd';
    const out = [];
    for (const entry of session.byId.values()) {
      const id = entry.id;
      const isGen3 = (id >= 1 && id <= 251) || (id >= 277 && id <= 411);
      const isXdOwn = isXd && (id === 464 || id === 472);
      const isGen4 = id >= 413 && id <= 519;
      const isGen56 = id >= 520 && id <= 773;
      if (isGen3 || isXdOwn || (isGen4 && allowGen4) || (isGen56 && allowGen6) || entry.pack) out.push(entry);
    }
    return out.sort((a, b) => (Boolean(a.pack) - Boolean(b.pack)) || ((a.national || 9999) - (b.national || 9999)) || a.name.localeCompare(b.name));
  }

  function sprite(id, size, className = '', shiny = false) {
    const entry = session?.byId.get(id);
    if (!entry?.sprite) return el('span', { className: `tb-no-sprite ${className}`, textContent: entry ? '' : '?' });
    const image = el('img', { src: (shiny && entry.spriteShiny) || entry.sprite, alt: '', width: size, height: size, className });
    image.loading = 'lazy';
    return image;
  }

  function categoryOf(move, hidden) {
    if (rules() >= 4 || receiver().physicalSpecialSplit) {
      return battle().categories?.[rules()]?.[move.id] || battle().categories?.[4]?.[move.id] || move.category;
    }
    if (move.id === T.HIDDEN_POWER && hidden) return T.category(hidden.type);
    return move.power ? T.category(move.type) : 'Status';
  }

  function calcStats(species, base, set, level) {
    const effect = T.natureEffect(set.nature);
    return T.STATS.map((_, i) => {
      const core = Math.floor((2 * (base[i] || 0) + set.ivs[i] + Math.floor(set.evs[i] / 4)) * level / 100);
      if (i === 0) return species === SHEDINJA ? 1 : core + level + 10;
      const value = core + 5;
      return effect?.up === i ? Math.floor(value * 11 / 10) : effect?.down === i ? Math.floor(value * 9 / 10) : value;
    });
  }

  const speciesName = id => session?.byId.get(id)?.name || `#${id}`;
  const learnset = id => new Map([...(speciesInfo(id)?.learnset || []), ...(receiver().fairyType ? (battle().fairy?.learnsets?.[id] || []) : [])]);
  const moveGen = () => (receiver().gen6Moves || rules() >= 6 ? 6 : receiver().laterMoves || rules() >= 4 ? 4 : 3);
  const maxPpOf = (move, ppUps) => (move?.pp ? Math.floor(move.pp * (5 + ppUps) / 5) : null);

  function updateFooter() {
    if (!session) return;
    const { draft } = session;
    const noMoves = !draft.moves.length;
    const note = $('pe-note');
    if (saveError) {
      note.textContent = saveError;
      note.className = 'helper pe-error';
    } else if (gameRunning) {
      note.textContent = 'Close the game to save changes to your save file.';
      note.className = 'helper pe-error';
    } else if (noMoves) {
      note.textContent = 'Choose at least one move before saving.';
      note.className = 'helper pe-error';
    } else {
      note.textContent = 'Your save is backed up first. Saving changes marks this Pokémon as Edited (no Shadowtrade; shown in Online Trades).';
      note.className = 'helper';
    }
    const save = $('pe-save');
    save.disabled = saving || gameRunning || noMoves;
    save.textContent = saving ? 'Saving…' : 'Save to save file';
  }

  function updateHeader() {
    if (!session) return;
    const { draft, place, boxName, game } = session;
    const display = draft.nickname || speciesName(draft.species);
    const where = place.area === 'party' ? `Party, slot ${place.slot + 1}` : `${boxName || `BOX ${place.box + 1}`}, slot ${place.slot + 1}`;
    $('pokemon-editor-title').textContent = display;
    $('pe-subtitle').textContent = `${speciesName(draft.species)} · Lv. ${draft.level} · ${where} · ${gameLabel(game)}`;
  }

  // --- Species picker (Change Pokémon)
  function openPicker() {
    if (!session || session.draft.shadow) return;
    view = 'picker';
    closeList();
    $('pe-search').value = '';
    render();
    $('pe-search').focus();
  }

  function renderPicker() {
    const query = $('pe-search').value.trim().toLowerCase(), digits = query.replace(/^#?0*/, '');
    const matches = pickable().filter(entry => !query || entry.name.toLowerCase().includes(query) || String(entry.national) === digits
      || (entry.types || []).some(type => type.toLowerCase() === query)
      || (entry.abilities || []).some(ability => ability.toLowerCase().includes(query)));
    const dexEl = $('pe-dex');
    dexEl.replaceChildren(...matches.map(entry => {
      const row = el('button', { type: 'button', className: 'tb-dex-row' });
      row.setAttribute('role', 'option');
      const total = (entry.stats || []).reduce((sum, stat) => sum + stat, 0);
      row.append(sprite(entry.id, 36),
        el('span', { className: 'tb-dex-name' }, el('strong', { textContent: entry.name }),
          el('small', { textContent: entry.pack ? 'Pack' : entry.national > 721 ? 'Form' : number(entry.national) })),
        el('span', { className: 'tb-dex-types' }, ...(entry.types || []).map(typeChip)),
        el('span', { className: 'tb-dex-abilities', textContent: (entry.abilities || []).join(' / ') }),
        ...(entry.stats || [0, 0, 0, 0, 0, 0]).map(stat => el('span', { className: 'tb-dex-stat', textContent: stat })),
        el('span', { className: 'tb-dex-stat tb-dex-total', textContent: total }));
      if (entry.id === session.draft.species) row.classList.add('taken');
      row.addEventListener('click', () => pickSpecies(entry.id));
      return row;
    }));
    if (!matches.length) dexEl.append(el('p', { className: 'helper tb-empty', textContent: 'No Pokémon match that.' }));
  }

  function pickSpecies(id) {
    if (!session || session.draft.shadow) return;
    const { draft } = session;
    draft.species = id;
    const info = speciesInfo(id);
    const options = T.genders(info.gender);
    draft.gender = options.length === 1 ? options[0] : (options.includes(draft.gender) ? draft.gender : (options[0] || ''));
    const abilities = (info.abilities || []).filter(a => a.slot !== 2 || receiver().hiddenAbilities);
    if (!abilities.some(a => a.slot === draft.ability)) draft.ability = abilities[0]?.slot ?? 0;
    saveError = '';
    view = 'set';
    render();
  }

  // --- Set editor
  function field(label, control, extra = null, className = '') {
    return el('label', { className: `tb-field ${className}` }, el('span', { textContent: label }), control, extra);
  }

  function itemLabel(draft) {
    if (draft.heldKeyItem && !draft.clearItem) return 'Key item (kept)';
    if (!draft.item) return '';
    return session.itemById.get(draft.item)?.name || `Item #${draft.item}`;
  }

  function itemDocText(draft) {
    if (draft.heldKeyItem && !draft.clearItem) return 'This Pokémon holds a key item. Clear it or pick another item to replace it.';
    if (draft.item) return session.itemById.get(draft.item)?.doc || 'Held item from your save.';
    if (battle().fallback && !itemsOf().length) return 'Set up Pokémon Colosseum\'s disc on the Play page to browse held items.';
    return 'Choose an item for it to hold in battle.';
  }

  function renderSet() {
    const { draft } = session;
    const entry = session.byId.get(draft.species), info = speciesInfo(draft.species);

    const nickname = el('input', { className: 'online-input', type: 'text', maxLength: T.NICKNAME_LENGTH, value: draft.nickname, placeholder: entry?.name || '', spellcheck: false, autocomplete: 'off' });
    nickname.addEventListener('input', () => { draft.nickname = T.cleanNickname(nickname.value); updateHeader(); });
    nickname.addEventListener('change', () => { nickname.value = draft.nickname; updateHeader(); });

    const level = el('input', { className: 'online-input tb-number', type: 'number', min: 1, max: 100, value: draft.level });
    level.setAttribute('aria-label', 'Level');
    level.addEventListener('input', () => {
      const value = Number(level.value);
      if (Number.isFinite(value) && value >= 1 && value <= 100) {
        draft.level = Math.round(value);
        refreshStats();
        updateHeader();
      }
    });
    level.addEventListener('change', () => {
      draft.level = Math.max(1, Math.min(100, Math.round(Number(level.value)) || 1));
      level.value = draft.level;
      refreshStats();
      updateHeader();
    });

    const genderOptions = T.genders(info.gender);
    const gender = el('select');
    for (const option of genderOptions) gender.append(el('option', { value: option, textContent: option === 'M' ? 'Male ♂' : 'Female ♀' }));
    if (!genderOptions.length) gender.append(el('option', { value: '', textContent: 'Genderless' }));
    gender.value = genderOptions.length === 1 ? genderOptions[0] : (genderOptions.includes(draft.gender) ? draft.gender : (genderOptions[0] || ''));
    draft.gender = gender.value;
    gender.disabled = genderOptions.length < 2;
    gender.addEventListener('change', () => { draft.gender = gender.value; });

    const shiny = el('input', { type: 'checkbox', checked: draft.shiny });
    const portrait = el('div', { className: 'tb-portrait' });
    const drawPortrait = () => {
      portrait.replaceChildren(...[sprite(draft.species, 96, '', draft.shiny), draft.shiny ? el('span', { className: 'tb-shiny-mark', title: 'Shiny', textContent: '★' }) : null].filter(Boolean));
    };
    drawPortrait();
    shiny.addEventListener('change', () => { draft.shiny = shiny.checked; drawPortrait(); });

    const ball = el('select');
    for (const each of (battle().balls || [])) ball.append(el('option', { value: each.id, textContent: each.name }));
    ball.value = String(draft.ball);
    ball.addEventListener('change', () => { draft.ball = Number(ball.value); });

    const friendship = el('input', { className: 'online-input tb-number', type: 'number', min: 0, max: 255, value: draft.friendship });
    friendship.addEventListener('change', () => {
      draft.friendship = Math.max(0, Math.min(255, Math.round(Number(friendship.value)) || 0));
      friendship.value = draft.friendship;
    });

    const changeBtn = el('button', { type: 'button', className: 'subtle tb-small', textContent: 'Change Pokémon' });
    if (draft.shadow) {
      changeBtn.disabled = true;
      changeBtn.title = 'A Shadow Pokémon\'s species can\'t be changed.';
    } else {
      changeBtn.addEventListener('click', openPicker);
    }

    const identity = el('div', { className: 'tb-identity' },
      portrait,
      el('div', { className: 'tb-identity-main' },
        el('div', { className: 'tb-species' },
          el('h2', { textContent: entry?.name || speciesName(draft.species) }),
          el('span', { className: 'pokedex-number', textContent: entry ? (entry.pack ? 'Pack' : entry.national > 721 ? 'Form' : number(entry.national)) : '' }),
          el('span', { className: 'pokedex-types' }, ...(entry?.types || []).map(typeChip)),
          draft.shadow ? el('span', { className: 'badge shadow-badge', textContent: 'Shadow Pokémon' }) : null,
          draft.edited ? el('span', { className: 'badge edited-badge', textContent: 'Edited', title: 'Modified with the save editor' }) : null,
          el('span', { className: 'nav-spacer' }),
          changeBtn),
        el('div', { className: 'tb-row pe-row-identity' },
          field('Nickname', nickname),
          field('Level', level, null, 'pe-level'),
          field('Gender', gender),
          field('Poké Ball', ball),
          field('Friendship', friendship, null, 'tb-narrow'),
          el('label', { className: 'tb-check' }, shiny, el('span', { textContent: 'Shiny' })))));

    // Held item & ability
    const itemWrap = el('div', { className: 'tb-move-line' });
    const itemInput = el('input', { className: 'online-input tb-picker-input', type: 'text', value: itemLabel(draft), placeholder: 'No item', spellcheck: false, autocomplete: 'off' });
    const itemClear = el('button', { type: 'button', className: 'tb-clear pe-item-clear', title: 'Clear held item', textContent: '×' });
    itemClear.setAttribute('aria-label', 'Clear held item');
    const itemDoc = el('small', { className: 'tb-doc', textContent: itemDocText(draft) });
    const syncItemField = () => {
      itemInput.value = itemLabel(draft);
      itemDoc.textContent = itemDocText(draft);
      itemClear.hidden = !draft.item && !(draft.heldKeyItem && !draft.clearItem);
    };
    syncItemField();
    itemInput.addEventListener('focus', () => { itemInput.select(); openItems(itemInput, draft, '', syncItemField); });
    itemInput.addEventListener('input', () => openItems(itemInput, draft, itemInput.value, syncItemField));
    itemInput.addEventListener('keydown', event => {
      if (listKeys(event)) return;
      if ((event.key === 'Backspace' || event.key === 'Delete') && !itemInput.value && (draft.item || draft.heldKeyItem)) {
        draft.item = 0; draft.clearItem = true; syncItemField();
      }
    });
    itemInput.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== itemInput) syncItemField(); }, 150));
    itemClear.addEventListener('click', () => { draft.item = 0; draft.clearItem = true; syncItemField(); });
    itemWrap.append(itemInput, itemClear);

    const ability = el('select');
    const abilities = (info.abilities || []).filter(each => each.slot !== 2 || receiver().hiddenAbilities || draft.ability === 2);
    for (const each of abilities) ability.append(el('option', { value: each.slot, textContent: each.hidden || each.slot === 2 ? `${each.name} (Hidden)` : each.name }));
    if (!abilities.length) ability.append(el('option', { value: draft.ability, textContent: `Ability slot ${draft.ability + 1}` }));
    ability.value = String(abilities.some(each => each.slot === draft.ability) ? draft.ability : abilities[0]?.slot ?? draft.ability);
    draft.ability = Number(ability.value);
    ability.disabled = abilities.length < 2;
    const abilityDoc = el('small', { className: 'tb-doc' });
    const showAbility = () => { abilityDoc.textContent = abilities.find(each => each.slot === Number(ability.value))?.doc || ''; };
    ability.addEventListener('change', () => { draft.ability = Number(ability.value); showAbility(); });
    showAbility();

    const traits = el('div', { className: 'tb-row tb-row-traits' },
      field('Held item', itemWrap, itemDoc, 'tb-wide'),
      field('Ability', ability, abilityDoc, 'tb-wide'));
    identity.querySelector('.tb-identity-main').append(traits);

    // Moves
    const moves = el('div', { className: 'tb-moves' });
    for (let slot = 0; slot < 4; slot++) moves.append(moveField(draft, slot));
    const movesNote = el('p', { className: 'helper tb-moves-note' });

    // Stats
    const stats = statsPanel(draft);

    $('pe-set').replaceChildren(identity, el('div', { className: 'tb-columns' },
      el('section', { className: 'tb-card tb-card-moves' }, el('h3', { textContent: 'Moves' }), moves, movesNote),
      el('section', { className: 'tb-card tb-card-stats' }, stats)));
    refreshStats();
    updateHeader();
    updateFooter();
  }

  function moveField(draft, slot) {
    const learned = learnset(draft.species);
    const wrap = el('div', { className: 'tb-move' });
    const input = el('input', { className: 'online-input tb-picker-input', type: 'text', placeholder: `Move ${slot + 1}`, spellcheck: false, autocomplete: 'off' });
    input.setAttribute('aria-label', `Move ${slot + 1}`);
    const clear = el('button', { type: 'button', className: 'tb-clear', title: 'Clear this move', textContent: '×' });
    clear.setAttribute('aria-label', `Clear move ${slot + 1}`);
    const ppUps = el('select', { className: 'pe-pp-ups', title: 'PP Ups applied to this move' });
    ppUps.setAttribute('aria-label', `Move ${slot + 1} PP Ups`);
    for (let n = 0; n <= 3; n++) ppUps.append(el('option', { value: String(n), textContent: n ? `+${n} PP Up` : '0 PP Up' }));
    const facts = el('div', { className: 'tb-move-facts' });

    const show = () => {
      const entry = draft.moves[slot];
      wrap.classList.toggle('filled', Boolean(entry));
      wrap.classList.toggle('pe-shadow-move', Boolean(entry?.shadow));
      if (!entry) {
        input.value = '';
        input.readOnly = false;
        input.disabled = false;
        clear.hidden = true;
        ppUps.hidden = true;
        wrap.classList.remove('odd');
        facts.replaceChildren();
        return;
      }
      if (entry.shadow) {
        input.value = entry.name || `Shadow Move #${entry.rawId}`;
        input.readOnly = true;
        input.disabled = true;
        clear.hidden = true;
        ppUps.hidden = true;
        wrap.classList.remove('odd');
        facts.replaceChildren(
          el('span', { className: 'badge shadow-badge', textContent: 'Shadow' }),
          el('span', { textContent: 'Kept while it is a Shadow Pokémon' })
        );
        return;
      }
      input.readOnly = false;
      input.disabled = false;
      clear.hidden = false;
      ppUps.hidden = false;
      ppUps.value = String(entry.ppUps || 0);
      const move = session.moveById.get(entry.id);
      input.value = move?.name || `Move #${entry.id}`;
      const isPack = session.packById.has(draft.species);
      const odd = !isPack && Boolean(move) && !learned.has(move.id);
      wrap.classList.toggle('odd', odd);
      if (!move) { facts.replaceChildren(el('span', { textContent: `Move #${entry.id}` })); return; }
      const hidden = move.id === T.HIDDEN_POWER ? T.hiddenPower(draft.ivs) : null;
      const category = categoryOf(move, hidden);
      const maxPp = maxPpOf(move, entry.ppUps || 0);
      facts.replaceChildren(
        typeChip(hidden?.type || move.type),
        el('span', { className: `tb-category ${category.toLowerCase()}`, textContent: category }),
        el('span', { textContent: `${hidden ? hidden.power : move.power > 1 ? move.power : '—'} pow` }),
        el('span', { textContent: `${move.accuracy ? `${move.accuracy}%` : '—'} acc` }),
        el('span', { textContent: `${maxPp ?? move.pp} PP` }),
        isPack ? null : (learned.has(move.id)
          ? el('span', { className: 'tb-how', textContent: learned.get(move.id) })
          : el('span', { className: 'tb-how odd', textContent: `Not in Gen ${moveGen()}` }))
      );
    };

    input.addEventListener('focus', () => { if (!input.disabled) { input.select(); openMoves(input, draft, slot, show, ''); } });
    input.addEventListener('input', () => { if (!input.disabled) openMoves(input, draft, slot, show, input.value); });
    input.addEventListener('keydown', event => {
      if (listKeys(event)) return;
      if ((event.key === 'Backspace' || event.key === 'Delete') && !input.value && draft.moves[slot] && !draft.moves[slot].shadow) {
        setMove(draft, slot, 0);
      }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) show(); }, 150));
    clear.addEventListener('click', () => { if (draft.moves[slot] && !draft.moves[slot].shadow) setMove(draft, slot, 0); });
    ppUps.addEventListener('change', () => {
      if (draft.moves[slot] && !draft.moves[slot].shadow) {
        draft.moves[slot].ppUps = Number(ppUps.value) || 0;
        show();
      }
    });

    const line = el('div', { className: 'pe-move-controls' }, el('div', { className: 'tb-move-line pe-move-input-wrap' }, input, clear), ppUps);
    wrap.append(line, facts);
    wrap.refresh = show;
    show();
    return wrap;
  }

  function setMove(draft, slot, id) {
    if (draft.moves[slot]?.shadow) return;
    const moves = draft.moves.slice();
    if (id) {
      const existing = moves.findIndex(m => !m.shadow && m.id === id);
      if (existing >= 0) moves.splice(existing, 1);
      const target = Math.min(slot, moves.length);
      if (moves[target]?.shadow) moves.push({ id, shadow: false, ppUps: 0 });
      else moves[target] = { id, shadow: false, ppUps: 0 };
    } else if (slot < moves.length && !moves[slot]?.shadow) {
      moves.splice(slot, 1);
    }
    draft.moves = moves.filter(Boolean).slice(0, 4);
    saveError = '';
    for (const each of $('pe-set').querySelectorAll('.tb-move')) each.refresh?.();
    refreshStats();
    updateFooter();
  }

  function statsPanel(draft) {
    const entry = session.byId.get(draft.species);
    const nature = el('select');
    T.NATURES.forEach((_, i) => nature.append(el('option', { value: i, textContent: T.natureLabel(i) })));
    nature.value = String(draft.nature);
    nature.addEventListener('change', () => { draft.nature = Number(nature.value); refreshStats(); });

    const levelPill = el('span', { className: 'pe-level-pill', textContent: `Lv. ${draft.level}` });

    const rows = T.STATS.map((_, i) => {
      const base = entry?.stats?.[i] || 0;
      const range = el('input', { type: 'range', min: 0, max: T.EV_MAX, step: 4, value: Math.min(T.EV_MAX, draft.evs[i]), className: 'tb-ev-range' });
      range.setAttribute('aria-label', `${T.STAT_NAMES[i]} EVs`);
      const ev = el('input', { type: 'number', min: 0, max: 255, value: draft.evs[i], className: 'online-input tb-number' });
      ev.setAttribute('aria-label', `${T.STAT_NAMES[i]} EVs`);
      const iv = el('input', { type: 'number', min: 0, max: T.IV_MAX, value: draft.ivs[i], className: 'online-input tb-number' });
      iv.setAttribute('aria-label', `${T.STAT_NAMES[i]} IVs`);
      const setEv = (value, cap = T.EV_MAX) => {
        const others = draft.evs.reduce((sum, each, j) => (j === i ? sum : sum + each), 0);
        draft.evs[i] = Math.max(0, Math.min(cap, T.EV_TOTAL - others, Math.round(Number(value)) || 0));
        range.value = Math.min(T.EV_MAX, draft.evs[i]);
        ev.value = draft.evs[i];
        refreshStats();
      };
      range.addEventListener('input', () => setEv(range.value, T.EV_MAX));
      ev.addEventListener('change', () => setEv(ev.value, 255));
      iv.addEventListener('change', () => {
        draft.ivs[i] = Math.max(0, Math.min(T.IV_MAX, Math.round(Number(iv.value)) || 0));
        iv.value = draft.ivs[i];
        refreshStats();
        for (const each of $('pe-set').querySelectorAll('.tb-move')) each.refresh?.();
      });
      const bar = el('i', { className: 'tb-bar' });
      bar.style.setProperty('--stat', `${Math.min(100, base / 2.55)}%`);
      bar.style.setProperty('--hue', String(Math.min(150, base * 0.9)));
      const total = el('output', { className: 'tb-total' });
      const name = el('span', { className: 'tb-stat-name', textContent: T.STAT_NAMES[i] });
      return { row: el('div', { className: 'tb-stat-row' }, name, el('span', { className: 'tb-base' }, el('b', { textContent: base }), bar), range, ev, iv, total),
        name, total, ev, iv, range };
    });

    const remaining = el('output', { className: 'tb-remaining' });
    const hidden = el('select', { className: 'tb-hidden-power' });
    hidden.append(el('option', { value: '', textContent: 'Set IVs for Hidden Power…' }));
    for (const type of T.HIDDEN_POWER_TYPES) hidden.append(el('option', { value: type, textContent: `Hidden Power ${type}` }));
    hidden.addEventListener('change', () => {
      const ivs = T.hiddenPowerIvs(hidden.value);
      hidden.value = '';
      if (!ivs) return;
      draft.ivs = ivs;
      rows.forEach((row, i) => { row.iv.value = ivs[i]; });
      refreshStats();
      for (const each of $('pe-set').querySelectorAll('.tb-move')) each.refresh?.();
    });

    const reset = el('button', { type: 'button', className: 'text-button', textContent: 'Clear EVs' });
    reset.addEventListener('click', () => { draft.evs = [0, 0, 0, 0, 0, 0]; rows.forEach(row => { row.ev.value = row.range.value = 0; }); refreshStats(); });
    const maxIvs = el('button', { type: 'button', className: 'text-button', textContent: 'All IVs 31' });
    maxIvs.addEventListener('click', () => {
      draft.ivs = [31, 31, 31, 31, 31, 31];
      rows.forEach(row => { row.iv.value = 31; });
      refreshStats();
      for (const each of $('pe-set').querySelectorAll('.tb-move')) each.refresh?.();
    });

    const levelLabel = el('span', { className: 'tb-level-label', textContent: `Lv ${draft.level}` });
    statsRefs = { rows, remaining, levelPill, levelLabel };

    return el('div', { className: 'tb-stats' },
      el('div', { className: 'tb-stats-head' }, el('h3', { textContent: 'Stats' }), levelPill),
      field('Nature', nature, null, 'tb-wide'),
      el('div', { className: 'tb-stat-row tb-stat-labels' }, el('span'), el('span', { textContent: 'Base' }), el('span', { textContent: 'EVs' }), el('span', { textContent: 'IVs' }), levelLabel),
      ...rows.map(row => row.row),
      el('div', { className: 'tb-stats-foot' }, remaining, el('span', { className: 'nav-spacer' }), reset, maxIvs),
      hidden);
  }

  function refreshStats() {
    if (!session || !statsRefs) return;
    const { draft } = session;
    const base = session.byId.get(draft.species)?.stats || [0, 0, 0, 0, 0, 0];
    const totals = calcStats(draft.species, base, draft, draft.level);
    const effect = T.natureEffect(draft.nature);
    statsRefs.rows.forEach((row, i) => {
      row.total.textContent = totals[i];
      row.name.classList.toggle('up', effect?.up === i);
      row.name.classList.toggle('down', effect?.down === i);
      row.name.title = effect?.up === i ? 'Raised by its nature' : effect?.down === i ? 'Lowered by its nature' : '';
    });
    statsRefs.levelPill.textContent = `Lv. ${draft.level}`;
    statsRefs.levelLabel.textContent = `Lv ${draft.level}`;
    const used = draft.evs.reduce((sum, ev) => sum + ev, 0), left = Math.max(0, T.EV_TOTAL - used);
    statsRefs.remaining.textContent = `${left} EVs left of ${T.EV_TOTAL}`;
    statsRefs.remaining.classList.toggle('done', left < 4);

    const note = $('pe-set').querySelector('.tb-moves-note');
    if (note) {
      const learned = learnset(draft.species), isPack = session.packById.has(draft.species);
      const odd = isPack ? [] : draft.moves.filter(m => !m.shadow && !learned.has(m.id)).map(m => session.moveById.get(m.id)?.name).filter(Boolean);
      const hasHp = draft.moves.some(m => !m.shadow && m.id === T.HIDDEN_POWER);
      note.textContent = !draft.moves.length ? 'A Pokémon needs at least one move.'
        : odd.length ? `${speciesName(draft.species)} doesn't normally learn ${odd.join(' or ')} in Gen ${moveGen()}. It can still be saved with ${odd.length === 1 ? 'it' : 'them'}.`
        : hasHp ? `Hidden Power is ${T.hiddenPower(draft.ivs).type}, ${T.hiddenPower(draft.ivs).power} power, from its IVs.` : '';
      note.classList.toggle('warn', odd.length > 0 || !draft.moves.length);
    }
  }

  // --- Autocomplete dropdown list (moves and items)
  function openList(input, rows, onPick, header, kind) {
    const box = $('pe-list'), main = $('pe-main');
    box.className = `tb-list ${kind}`;
    list = { input, rows, onPick, active: rows.findIndex(row => row.value !== undefined) };
    box.replaceChildren(...(header ? [header] : []), ...rows.map((row, i) => {
      if (row.value === undefined) return el('div', { className: 'tb-list-group', textContent: row.label });
      const option = el('div', { className: 'tb-list-row', id: `pe-option-${i}`, title: row.title || '' }, ...row.cells);
      option.setAttribute('role', 'option');
      option.addEventListener('mousedown', event => { event.preventDefault(); pick(i); });
      option.addEventListener('mousemove', () => highlight(i, false));
      return option;
    }));
    if (!rows.length) box.append(el('p', { className: 'helper tb-empty', textContent: 'Nothing matches that.' }));
    box.hidden = false;
    const fieldRect = input.getBoundingClientRect(), area = main.getBoundingClientRect();
    const below = area.bottom - fieldRect.bottom - 10, above = fieldRect.top - area.top - 10, under = below >= 240 || below >= above;
    box.style.left = `${Math.max(8, Math.min(fieldRect.left - area.left, area.width - box.offsetWidth - 8))}px`;
    box.style.maxHeight = `${Math.max(150, Math.min(360, under ? below : above))}px`;
    box.style.top = `${(under ? fieldRect.bottom - area.top + 4 : fieldRect.top - area.top - 4 - box.offsetHeight) + main.scrollTop}px`;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'pe-list');
    highlight(list.active, true);
  }

  function closeList() {
    if (list) list.input.setAttribute('aria-expanded', 'false');
    list = null;
    $('pe-list').hidden = true;
  }

  function highlight(i, scroll) {
    if (!list) return;
    list.active = i;
    for (const row of $('pe-list').querySelectorAll('.tb-list-row')) row.classList.toggle('active', row.id === `pe-option-${i}`);
    const row = $(`pe-option-${i}`);
    if (row) list.input.setAttribute('aria-activedescendant', row.id);
    if (scroll) row?.scrollIntoView({ block: 'nearest' });
  }

  function pick(i) {
    const row = list?.rows[i];
    if (!row || row.value === undefined) return;
    const { onPick, input } = list;
    closeList();
    onPick(row.value);
    input.blur();
  }

  function listKeys(event) {
    if (!list) return false;
    const options = list.rows.map((row, i) => (row.value === undefined ? -1 : i)).filter(i => i >= 0);
    const at = options.indexOf(list.active);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = options[Math.max(0, Math.min(options.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next !== undefined) highlight(next, true);
      return true;
    }
    if (event.key === 'Enter') { event.preventDefault(); pick(list.active); return true; }
    if (event.key === 'Escape') { event.preventDefault(); closeList(); return true; }
    if (event.key === 'Tab') closeList();
    return false;
  }

  function moveRow(move, how, hidden) {
    const category = categoryOf(move, hidden);
    return {
      value: move.id, title: move.doc,
      cells: [
        el('span', { className: 'tb-list-name', textContent: move.name }),
        typeChip(hidden?.type || move.type),
        el('span', { className: `tb-category ${category.toLowerCase()}`, textContent: category }),
        el('span', { className: 'tb-list-num', textContent: hidden ? hidden.power : move.power > 1 ? move.power : '—' }),
        el('span', { className: 'tb-list-num', textContent: move.accuracy ? `${move.accuracy}%` : '—' }),
        el('span', { className: 'tb-list-num', textContent: move.pp }),
        el('span', { className: `tb-how${how ? '' : ' odd'}`, textContent: how || '—' }),
        el('span', { className: 'tb-list-doc', textContent: move.doc })
      ]
    };
  }

  function openMoves(input, draft, slot, show, text) {
    const query = key(text);
    const learned = learnset(draft.species), hidden = T.hiddenPower(draft.ivs);
    const matches = move => !query || key(move.name).includes(query) || key(move.type) === query
      || key(categoryOf(move, move.id === T.HIDDEN_POWER ? hidden : null)) === query;
    const taken = new Set(draft.moves.filter((m, i) => i !== slot && !m.shadow).map(m => m.id));
    const allowedMoves = new Map(movesOf().map(m => [m.id, m]));
    const own = [...learned].map(([id, how]) => [allowedMoves.get(id), how]).filter(([move]) => move && matches(move) && !taken.has(move.id));
    own.sort((a, b) => a[0].name.localeCompare(b[0].name));
    const rows = own.map(([move, how]) => moveRow(move, how, move.id === T.HIDDEN_POWER ? hidden : null));
    if (query || !own.length) {
      const others = movesOf().filter(move => !learned.has(move.id) && matches(move) && !taken.has(move.id)).slice(0, LIST_LIMIT);
      if (others.length) {
        if (own.length) rows.push({ label: `Moves ${speciesName(draft.species)} doesn't normally learn in Gen ${moveGen()}` });
        rows.push(...others.map(move => moveRow(move, null, move.id === T.HIDDEN_POWER ? hidden : null)));
      }
    }
    const header = el('div', { className: 'tb-list-row tb-list-head' }, ...['Move', 'Type', 'Category', 'Pow', 'Acc', 'PP', 'Learned', ''].map(label => el('span', { textContent: label })));
    openList(input, rows, id => { setMove(draft, slot, id); show(); }, header, 'moves');
  }

  function openItems(input, draft, text, sync) {
    const query = key(text);
    const rows = query ? [] : [{ value: 0, cells: [el('span', { className: 'tb-list-name', textContent: 'No item' }), el('span', { className: 'tb-list-doc', textContent: 'It holds nothing.' })] }];
    for (const item of itemsOf()) {
      if (query && !key(item.name).includes(query) && !key(item.doc).includes(query)) continue;
      rows.push({ value: item.id, title: item.doc, cells: [el('span', { className: 'tb-list-name', textContent: item.name }), el('span', { className: 'tb-list-doc', textContent: item.doc })] });
    }
    openList(input, rows, id => { draft.item = id; draft.clearItem = true; sync(); }, null, 'items');
  }

  function render() {
    if (!session) return;
    $('pe-picker').hidden = view !== 'picker';
    $('pe-set').hidden = view !== 'set';
    if (view === 'picker') renderPicker();
    else renderSet();
  }

  async function save() {
    if (!session || saving || gameRunning || !session.draft.moves.length) return;
    closeList();
    saving = true;
    saveError = '';
    updateFooter();
    const { place, identity, draft, onSaved } = session;
    try {
      const response = await window.colo.pokemonEditSave({
        place,
        identity,
        changes: {
          species: draft.species,
          nickname: draft.nickname,
          level: draft.level,
          gender: draft.gender,
          shiny: draft.shiny,
          ball: draft.ball,
          friendship: draft.friendship,
          item: draft.item,
          clearItem: draft.clearItem,
          ability: draft.ability,
          nature: draft.nature,
          evs: draft.evs,
          ivs: draft.ivs,
          moves: draft.moves.map(m => (m.shadow ? { shadow: true, rawId: m.rawId } : { id: m.id, ppUps: m.ppUps || 0 }))
        }
      });
      saving = false;
      session = null;
      $('pokemon-editor').close();
      onSaved?.(response);
    } catch (error) {
      saving = false;
      saveError = message(error);
      updateFooter();
    }
  }

  async function open(place, { onSaved } = {}) {
    closeList();
    saveError = '';
    saving = false;
    gameRunning = false;
    const data = await window.colo.pokemonEditOpen(place);
    const { catalog, pokemon } = data;
    const byId = new Map((catalog.dex || []).map(entry => [entry.id, entry]));
    const packById = new Map((catalog.packSpecies || []).map(entry => [entry.id, entry]));
    const b = catalog.battle || {}, r = catalog.receiver || {};
    const primaryMoves = (r.gen6Moves || catalog.battleRules >= 6) ? (b.generations?.[6]?.moves || b.generations?.[4]?.moves || b.moves || [])
      : (r.laterMoves || catalog.battleRules >= 4) ? (b.generations?.[4]?.moves || b.moves || [])
        : (b.moves || []);
    const moveById = new Map(primaryMoves.map(m => [m.id, m]));
    for (const list of [b.generations?.[6]?.moves, b.generations?.[4]?.moves, b.fairy?.moves, b.moves]) {
      for (const m of list || []) if (!moveById.has(m.id)) moveById.set(m.id, m);
    }
    if (r.fairyType && b.fairy && !(r.gen6Moves || catalog.battleRules >= 6)) {
      for (const id of b.fairy.retyped || []) {
        const existing = moveById.get(id);
        if (existing) moveById.set(id, { ...existing, type: 'Fairy' });
      }
    }
    const itemById = new Map((b.items || []).map(item => [item.id, item]));
    for (const list of [b.generations?.[6]?.items, b.generations?.[4]?.items]) {
      for (const item of list || []) if (!itemById.has(item.id)) itemById.set(item.id, item);
    }

    const draft = {
      species: pokemon.species,
      nickname: pokemon.nickname,
      level: pokemon.level,
      gender: pokemon.gender,
      shiny: pokemon.shiny,
      ball: pokemon.ball,
      friendship: pokemon.friendship,
      item: pokemon.item,
      clearItem: false,
      heldKeyItem: pokemon.heldKeyItem,
      rawItem: pokemon.rawItem,
      ability: pokemon.ability,
      nature: pokemon.nature,
      evs: pokemon.evs.slice(),
      ivs: pokemon.ivs.slice(),
      moves: pokemon.moves.map(m => ({ ...m })),
      shadow: pokemon.shadow,
      shadowId: pokemon.shadowId,
      edited: Boolean(pokemon.edited)
    };
    session = { game: data.game, boxName: data.boxName, place: data.place, identity: data.identity, draft, catalog, byId, packById, moveById, itemById, onSaved };
    view = 'set';
    render();
    if (!$('pokemon-editor').open) $('pokemon-editor').showModal();
  }

  function setGameRunning(running) {
    gameRunning = Boolean(running);
    if (session && $('pokemon-editor').open) updateFooter();
  }

  $('pokemon-editor').addEventListener('cancel', event => {
    if (list) { event.preventDefault(); closeList(); }
    else if (view === 'picker') { event.preventDefault(); view = 'set'; render(); }
  });
  $('pokemon-editor').addEventListener('close', () => { closeList(); session = null; saving = false; saveError = ''; });
  $('pe-close').addEventListener('click', () => $('pokemon-editor').close());
  $('pe-cancel').addEventListener('click', () => $('pokemon-editor').close());
  $('pe-save').addEventListener('click', save);
  $('pe-search').addEventListener('input', renderPicker);
  $('pe-search').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('pe-dex').querySelector('.tb-dex-row')?.click(); }
  });
  $('pe-picker-cancel').addEventListener('click', () => { view = 'set'; render(); });
  $('pe-main').addEventListener('scroll', () => { if (list && !list.input.matches(':focus')) closeList(); });
  document.addEventListener('mousedown', event => {
    if (list && !$('pe-list').contains(event.target) && event.target !== list.input) closeList();
  });

  window.coloPokemonEditor = { open, setGameRunning };
})();
