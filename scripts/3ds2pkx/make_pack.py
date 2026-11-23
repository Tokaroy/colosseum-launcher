"""A Pokémon pack (models/N/ folders for the launcher) directly from a decrypted 3DS Gen 7 ROM.

usage: make_pack.py [--by-number] [--keep] ROM_3DS OUT_DIR PACK_NAME NUMBER...

Each National Pokédex NUMBER becomes a folder (named after the Pokémon, or with --by-number its
number, as the launcher keeps them) with:
  pokemon.json       Stats, types, abilities, level-up moves, TM moves and evolutions
  model.pkx          3DS battle model converted to GameCube PKX (convert.py)
  model-shiny.pkx    Shiny battle model (reusing geometry/skeleton/animations)
  body.png, body-shiny.png, face.png, face-shiny.png   Menu pictures drawn from the models (portrait.py),
                     or the 3DS's own 2D portraits from /a/2/4/4 where they can't be
  cry.wav            Cry from /a/0/7/3 (cries.py)
  forms/NAME/        Each of its other models, as the 3DS has them: its female one, Megas, Primal Reversion, Zen Mode,
                     Blade Forme, every Vivillon pattern (model.pkx, model-shiny.pkx and the four pictures), and
                     forms/forms.json listing them ([{folder, name, form, female}])
  model-form1.pkx, model-form1-shiny.pkx   The form it changes into in battle (BATTLE_FORMS), which the game shows
  models-version.txt Converter version stamp (remade.json)

A NUMBER below 494 (a Pokémon the game has a model of already) gets only its forms/.
"""
import json
import os
import sys

import convert
import cries
import rom3ds
import usumdata

CREDITS = (
    "StarsMmd: the models are written by his Blender-Addon-Gamecube-Models (GPL-3.0). "
    "gdkchan: the 3DS GFModel/GFMotion/PICA200 format reference from SPICA."
)
COLOSSEUM_MOVES = 354
COLOSSEUM_ABILITIES = 76
BASES = {
    'Grass': ['Treecko', 'Grovyle', 'Sceptile'],
    'Fire': ['Torchic', 'Combusken', 'Blaziken'],
    'Water': ['Mudkip', 'Marshtomp', 'Swampert'],
    'Normal': ['Zigzagoon', 'Linoone', 'Linoone'],
    'Electric': ['Electrike', 'Manectric', 'Manectric'],
    'Bug': ['Wurmple', 'Silcoon', 'Beautifly'],
    'Flying': ['Taillow', 'Swellow', 'Swellow'],
    'Psychic': ['Ralts', 'Kirlia', 'Gardevoir'],
    'Rock': ['Aron', 'Lairon', 'Aggron'],
    'Ground': ['Trapinch', 'Vibrava', 'Flygon'],
    'Ghost': ['Shuppet', 'Banette', 'Banette'],
    'Ice': ['Snorunt', 'Glalie', 'Glalie'],
    'Dragon': ['Bagon', 'Shelgon', 'Salamence'],
    'Dark': ['Poochyena', 'Mightyena', 'Mightyena'],
    'Steel': ['Beldum', 'Metang', 'Metagross'],
    'Poison': ['Gulpin', 'Swalot', 'Swalot'],
    'Fighting': ['Makuhita', 'Hariyama', 'Hariyama'],
    'Fairy': ['Ralts', 'Kirlia', 'Gardevoir'],
}

FIRST_3DS = 494   # below, the disc's or Battle Revolution's model is the base one; only the forms come from the 3DS
FORMS = 'forms'
FORM_FILES = ('model.pkx', 'model-shiny.pkx', 'body.png', 'body-shiny.png', 'face.png', 'face-shiny.png')
# The form each changes into in battle, which the game swaps its model to (a pack's model-form1.pkx): Darmanitan's Zen
# Mode, Meloetta's Pirouette Forme and Aegislash's Blade Forme
BATTLE_FORMS = {555: 1, 648: 1, 681: 1}
# Forms the games' text names no better than 'One form' or the Pokémon's own name: Unown's letters, Arceus's types,
# Genesect's drives (forms 1 on, in the games' order)
FORM_NAMES = {
    201: ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
          'Y', 'Z', 'Exclamation Mark', 'Question Mark'],
    493: ['Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric',
          'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy'],
    649: ['Douse Drive', 'Shock Drive', 'Burn Drive', 'Chill Drive'],
}
REMADE = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'remade.json'), encoding='utf-8'))
STAMP = 'models-version.txt'
here = {}


def outdated(folder, n):
    try:
        made_by = int(open(os.path.join(folder, STAMP)).read().strip())
    except (OSError, ValueError):
        made_by = 1
    return any(int(version) > made_by and n in numbers for version, numbers in REMADE['remade'].items())


def slug(text):
    out = ''.join(c if c.isalnum() and c.isascii() else '-' for c in text.lower().replace('%', ''))
    return '-'.join(part for part in out.split('-') if part)[:40]


def write(path, blob):
    with open(path + '.part', 'wb') as f:
        f.write(blob)
    os.replace(path + '.part', path)


def make_forms(n, folder, lines):
    """Every other model of the Pokémon (rom3ds.variations) into forms/, each in a folder named after it."""
    rom, game, base = here['rom'], here['game'], here['folders'][n]
    stale, listing, used = outdated(folder, n), [], {slug(game.species(n)['name']), FORMS}
    for form, female, _asset in rom.variations(n):
        own = FORM_NAMES.get(n, [])
        name = 'Female' if female else own[form - 1] if form <= len(own) else game.form_name(n, form) or 'Form %d' % form
        key = 'female' if female else slug(name) or 'form-%d' % form
        if key in used:   # Genesect's drives are all named Genesect; Zygarde has two 10% Formes
            key = '%s-%d' % (key, form)
        used.add(key)
        entry = {'folder': key, 'name': name, 'form': form, 'female': female,
                 'kind': 'female' if female else 'battle' if BATTLE_FORMS.get(n) == form
                 else 'mega' if name.startswith(('Mega ', 'Primal')) else 'form'}
        info = None if female else game.form_info(n, form)
        if n == 493 and not female:   # Arceus's type is its plate's, so its forms share its personal data
            info = {'types': [name]}
        if info:
            entry.update(info)
        listing.append(entry)
        sub = os.path.join(folder, FORMS, key)
        battle = not female and BATTLE_FORMS.get(n) == form
        tops = [os.path.join(folder, 'model-form1.pkx'), os.path.join(folder, 'model-form1-shiny.pkx')] if battle else []
        if here['keep'] and not stale and all(os.path.exists(p) for p in [os.path.join(sub, f) for f in FORM_FILES] + tops):
            continue
        os.makedirs(sub, exist_ok=True)
        drawn = {}
        first, second = convert.convert_pair(rom.read_pokemon_slot(n, form, female), '%s_%s' % (base, key)[:30],
                                             '%s_%s_rare' % (base, key)[:30], log=lambda *a: None, portraits=drawn)
        normal, shiny = drawn.get('normal') or {}, drawn.get('shiny') or {}
        for fname, blob in zip(FORM_FILES, (first, second, normal.get('body'), shiny.get('body'), normal.get('face'), shiny.get('face'))):
            if blob:
                write(os.path.join(sub, fname), blob)
        for path, blob in zip(tops, (first, second)):
            write(path, blob)
        lines.append('  %s/%s: %s, %d bytes%s' % (FORMS, key, name, len(first), ' (its battle form)' if battle else ''))
    if listing:
        os.makedirs(os.path.join(folder, FORMS), exist_ok=True)
        with open(os.path.join(folder, FORMS, 'forms.json'), 'w', encoding='utf-8') as f:
            json.dump(listing, f, indent=2, ensure_ascii=False)


def pokemon_json(game, number, folders):
    s = game.species(number)
    # Stand-in types for standalone pack.json (Fairy falls back to Psychic for base Colosseum)
    types = ['Psychic' if t == 'Fairy' else t for t in s['types']]
    types = list(dict.fromkeys(types)) or ['Normal']
    base = BASES.get(s['types'][0], BASES['Normal'])[game.stage_of(number) - 1]
    gender = s['gender']
    spec = {
        'base': base,
        'name': s['name'][:10],
        'description': 'From Pokémon Ultra Sun / Ultra Moon, National Pokédex #%d.' % number,
        'types': types,
        'stats': s['stats'],
        'evYield': s['evYield'],
        'catchRate': s['catchRate'],
        'baseExp': s['baseExp'],
        'baseFriendship': s['baseFriendship'],
        'growthRate': s['growthRate'],
        'gender': 'genderless' if gender == 255 else 100 if gender == 254 else 0 if gender == 0 else round((gender + 1) / 2.56, 1),
        'height': s['height'],
        'weight': s['weight'],
        'moves': [[lvl, mid] for lvl, mid in s['moves'] if mid <= COLOSSEUM_MOVES][:20] or [[1, 33]],
        'tmMoves': sorted({mid for mid in s['tms'] if mid <= COLOSSEUM_MOVES}),
    }
    abilities = [a for a in s['abilities'] if 0 < a <= COLOSSEUM_ABILITIES]
    if abilities:
        spec['abilities'] = abilities[:2]
    evolutions = []
    for method, param, into, _form, level in s['evolutions']:
        target = folders.get(into, into if into <= 386 else None)
        if target is None:
            continue
        if method == 4 and level:
            evolutions.append({'into': target, 'level': level})
        elif method in (1, 2, 3):
            evolutions.append({'into': target, 'friendship': True})
        elif method == 5:
            evolutions.append({'into': target, 'trade': True})
    if evolutions:
        spec['evolutions'] = evolutions[:5]
    return spec


def start(setup):
    rom_path, out, by_number, keep, numbers, cry_map, pokepic_index = setup
    rom = rom3ds.Rom3DS(rom_path)
    game = usumdata.USUMData(rom)
    game._pokepic_index = pokepic_index
    folders = {n: str(n) if by_number else game.species(n)['name'].lower().replace(' ', '-') for n in numbers}
    here.update(rom=rom, game=game, out=out, keep=keep, folders=folders, cry_map=cry_map)


def make_one(n):
    rom, game, folders = here['rom'], here['game'], here['folders']
    folder = os.path.join(here['out'], folders[n])
    os.makedirs(folder, exist_ok=True)
    if n < FIRST_3DS:
        lines = ['#%d %s: its forms' % (n, game.species(n)['name'])]
        make_forms(n, folder, lines)
        with open(os.path.join(folder, STAMP), 'w', encoding='utf-8') as f:
            f.write('%d\n' % REMADE['version'])
        return lines
    spec = pokemon_json(game, n, folders)
    with open(os.path.join(folder, 'pokemon.json'), 'w', encoding='utf-8') as f:
        json.dump(spec, f, indent=2, ensure_ascii=False)
    lines = ['#%d %s: base %s' % (n, spec['name'], spec['base'])]

    # Menu pictures: drawn from the models when they are made (below), else the 3DS's own 2D portraits (/a/2/4/4)
    icons = ('body.png', 'body-shiny.png', 'face.png', 'face-shiny.png')
    need_icons = not (here['keep'] and all(os.path.exists(os.path.join(folder, f)) for f in icons)) or outdated(folder, n)

    # Read 3DS model slot once (needed for both Gen 6 cry dev-ID lookup and 3D model conversion)
    slot_data = None
    cry_path = os.path.join(folder, 'cry.wav')
    need_cry = not (here['keep'] and os.path.exists(cry_path))
    stale = outdated(folder, n)
    model_path = os.path.join(folder, 'model.pkx')
    shiny_path = os.path.join(folder, 'model-shiny.pkx')
    need_normal = not (here['keep'] and os.path.exists(model_path) and not stale) or need_icons
    need_shiny = not (here['keep'] and os.path.exists(shiny_path) and not stale) or need_icons

    if need_normal or need_shiny or (need_cry and n > 649):
        slot_data = rom.read_pokemon_slot(n)

    if need_cry:
        cwar_entry = cries.cry_entry_for_species(rom, here['cry_map'], n, slot_data)
        if cwar_entry is not None:
            cwar_data = rom.garc('/a/0/7/3').get_entry(cwar_entry, decomp=False)
            wav_bytes, seconds = cries.cry_wav(cwar_data)
            with open(cry_path + '.part', 'wb') as f:
                f.write(wav_bytes)
            os.replace(cry_path + '.part', cry_path)
            lines.append('  cry.wav: %.2f s' % seconds)

    quiet = lambda *a: None
    made = []
    drawn = {}
    if need_normal and need_shiny:
        first, second = convert.convert_pair(slot_data, folders[n], folders[n] + '_rare', log=quiet, portraits=drawn)
        made = [(model_path, first), (shiny_path, second)]
    elif need_normal:
        made = [(model_path, convert.convert(slot_data, folders[n], shiny=False, log=quiet))]
    elif need_shiny:
        made = [(shiny_path, convert.convert(slot_data, folders[n] + '_rare', shiny=True, log=quiet))]

    if need_icons:
        normal, shiny = drawn.get('normal') or {}, drawn.get('shiny') or {}
        pictures = [normal.get('body'), shiny.get('body'), normal.get('face'), shiny.get('face')]
        if not all(pictures):
            own = game.icon_pngs(n)
            lines.append('  pictures: the 3DS\'s own, as the model couldn\'t be drawn')
            pictures = list(own)   # all four alike
        for fname, blob in zip(icons, pictures):
            if blob:
                p = os.path.join(folder, fname)
                with open(p + '.part', 'wb') as f:
                    f.write(blob)
                os.replace(p + '.part', p)

    for path, pkx in made:
        with open(path + '.part', 'wb') as f:
            f.write(pkx)
        os.replace(path + '.part', path)
        lines.append('  %s: %d bytes' % (os.path.basename(path), len(pkx)))

    make_forms(n, folder, lines)
    with open(os.path.join(folder, STAMP), 'w', encoding='utf-8') as f:
        f.write('%d\n' % REMADE['version'])
    return lines


def main():
    args = sys.argv[1:]
    by_number = '--by-number' in args
    keep = '--keep' in args or bool(os.environ.get('KEEP_MODELS'))
    args = [a for a in args if a not in ('--by-number', '--keep')]
    rom_path, out, pack_name, numbers = args[0], args[1], args[2], [int(n) for n in args[3:]]
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'pack.json'), 'w', encoding='utf-8') as f:
        json.dump({'name': pack_name, 'author': '3ds2pkx, from Pokémon Ultra Sun / Ultra Moon',
                   'credits': CREDITS}, f, indent=2, ensure_ascii=False)

    # Precompute cry map and pokepic index once in parent so workers skip scanning /a/0/7/3 and /a/2/4/4
    with rom3ds.Rom3DS(rom_path) as rom:
        cry_map = cries.build_cry_map(rom)
        pokepic_index = usumdata.USUMData(rom).pokepic_index()

    count = int(os.environ.get('USUM2PKX_JOBS') or 0) or min(4, os.cpu_count() or 1)
    count = max(1, min(count, len(numbers)))
    setup = (rom_path, out, by_number, keep, numbers, cry_map, pokepic_index)
    if count == 1:
        start(setup)
        done = map(make_one, numbers)
    else:
        from concurrent.futures import ProcessPoolExecutor
        pool = ProcessPoolExecutor(count, initializer=start, initargs=(setup,))
        done = pool.map(make_one, numbers)
    for i, lines in enumerate(done, 1):
        print('\n'.join(lines + ['Made %d of %d Pokémon' % (i, len(numbers))]), flush=True)
    if count > 1:
        pool.shutdown()


if __name__ == '__main__':
    main()
