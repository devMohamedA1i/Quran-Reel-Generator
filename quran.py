"""Local Quran asset loading and recitation indexing."""
from pathlib import Path
import json
import re

BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ'
ENDING = 'صدَق ٱللَّهُ ٱلْعَظِيمُ'


def _quran_word(word: str) -> str:
    """Ignore diacritics and common Quranic marks for prefix comparison only."""
    import unicodedata
    chars=[]
    for ch in unicodedata.normalize('NFKD',word):
        if unicodedata.category(ch).startswith('M') or ch in ('ـ', 'ٰ'):
            continue
        if ch in 'ٱأإآ': ch='ا'
        chars.append(ch)
    return ''.join(chars)


def verse_display_text(surah_number: int, verse_number: int, text: str) -> str:
    """Separate the prefixed basmala from verse 1 when another verse follows.

    Al-Fatiha 1 is itself the basmala; it is handled on the opening card.
    Other verses are left unchanged unless a basmala actually prefixes verse 1.
    """
    if verse_number != 1 or surah_number in (1, 9):
        return text
    words=text.split()
    if len(words) > 4 and [_quran_word(w) for w in words[:4]] == ['بسم','الله','الرحمن','الرحيم']:
        return ' '.join(words[4:])
    return text


def load_surahs(root: Path):
    """Every Surah with its verses, from Assets/Quran Text.

    The text now comes from uthmani.json and the Surah information from
    chapters.json. The old Assets/quran/quran_uthmani_api.json is no
    longer used.
    """
    import ayah_data
    surahs = []
    for chapter in ayah_data._chapters(str(root)):
        number = int(chapter['id'])
        verses = ayah_data.all_verses(root, number)
        surahs.append({
            'number': number,
            'name': ayah_data.surah_name(root, number),
            'nameSimple': chapter['name'],
            'englishName': chapter.get('transliteration', ''),
            'englishNameTranslation': chapter.get('translation', ''),
            'revelationType': str(chapter.get('type', '')).capitalize(),
            'ayahs': [
                {
                    'number': verse['number'],
                    'numberInSurah': verse['number'],
                    'text': verse['text'],
                }
                for verse in verses
            ],
        })
    if len(surahs) != 114 or sum(len(s['ayahs']) for s in surahs) != 6236:
        raise ValueError('Unexpected Quran text structure or verse count')
    return surahs


def selected_verses(root: Path, surah_number: int, start: int, end: int):
    surahs = load_surahs(root)
    if not 1 <= surah_number <= 114:
        raise ValueError('Invalid surah number')
    surah = surahs[surah_number - 1]
    if not 1 <= start <= end <= len(surah['ayahs']):
        raise ValueError('Invalid verse range')
    return surah, surah['ayahs'][start - 1:end]


def audio_for(root: Path, surah: int, verse: int):
    filename = f'{surah:03}{verse:03}.mp3'
    base = root / 'Assets/audio'
    # Reuse both locations from the earlier tests and the extracted complete ZIP.
    candidates = [base/'al_ajmi_128k'/filename, base/'Al-Ajmi'/filename]
    for path in candidates:
        if path.is_file():
            return path
    for path in base.rglob(filename) if base.is_dir() else ():
        if path.is_file():
            return path
    raise FileNotFoundError(f'Al-Ajmi audio missing for {surah}:{verse} ({filename}). Extract full ZIP under Assets/audio/Al-Ajmi/.')


def font_path(root: Path):
    path = root / 'Assets/fonts/UthmanicHafs1Ver18.ttf'
    if not path.is_file():
        raise FileNotFoundError(f'Font missing: {path}')
    return path


# RELEASE_AUDIT Phase 3 (item 17): a background id must survive a file rename
# so drafts keep resolving. The manifest lives in .qvs_cache (never inside the
# possibly symlinked Assets tree) and maps a stable id to its current path.
BACKGROUND_MANIFEST = '.qvs_cache/background-ids.json'


def _background_manifest_path(root: Path) -> Path:
    return root / BACKGROUND_MANIFEST


def _read_background_manifest(root: Path) -> dict:
    path = _background_manifest_path(root)
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'version': 1, 'entries': {}}
    if not isinstance(data, dict) or not isinstance(data.get('entries'), dict):
        return {'version': 1, 'entries': {}}
    return data


def _write_background_manifest(root: Path, data: dict) -> None:
    """Write the id manifest atomically; a crash must not truncate it."""
    import os
    import tempfile
    path = _background_manifest_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix='background-ids.', suffix='.tmp'
    )
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write('\n')
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def background_fingerprint(path: Path) -> str:
    """Content hash used only when importing, to skip exact duplicates."""
    import hashlib
    digest = hashlib.sha256()
    with Path(path).open('rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def backgrounds(root: Path):
    base = root / 'Assets/Background Templates'
    if not base.exists():
        return []
    import hashlib, re
    manifest = _read_background_manifest(root)
    entries = manifest['entries']
    changed = False
    used = set()
    files = []
    def _nat_key(p):
        return (0 if 'Videos' in p.relative_to(base).parts else 1,
                [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', p.stem)])
    for p in sorted(
        list((base / 'Videos').rglob('*')) +
        list((base / 'Images').rglob('*')),
        key=_nat_key,
    ):
        if (p.is_file() and not p.name.startswith('.')
            and (
                ('Videos' in p.relative_to(base).parts
                 and p.suffix.lower() in {'.mp4', '.mov', '.m4v', '.webm'})
                or
                ('Images' in p.relative_to(base).parts
                 and p.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'})
            )):
            relative = p.relative_to(base).as_posix()
            legacy_id = hashlib.sha256(relative.encode()).hexdigest()[:16]
            # Prefer a manifest entry already pointing at this path: its id is
            # the one drafts may reference, even after a rename.
            entry_key = next(
                (key for key, value in entries.items()
                 if value.get('filename') == relative),
                None,
            )
            if entry_key:
                uid = entry_key
                entry = entries[uid]
                if entry.get('size') != p.stat().st_size:
                    entry['size'] = p.stat().st_size
                    changed = True
            else:
                # A file may have been renamed. Reuse the id of an entry whose
                # old path is gone and whose basename matches this file.
                missing = [
                    (key, value) for key, value in entries.items()
                    if value.get('filename')
                    and not (base / value['filename']).is_file()
                ]
                by_name = [
                    key for key, value in missing
                    if Path(value['filename']).name == p.name
                ]
                size = p.stat().st_size
                by_size = [
                    key for key, value in missing
                    if value.get('size') == size
                ]
                candidate = (by_name or (by_size if len(by_size) == 1 else [None]))[0]
                uid = candidate or legacy_id
                entries[uid] = dict(
                    entries.get(uid) or {}, filename=relative, size=size
                )
                changed = True
            used.add(uid)
            files.append({
                'id': uid,
                'legacy_id': legacy_id,
                'name': p.stem.replace('_', ' '),
                'filename': relative,
                'kind': 'video' if p.suffix.lower() in {'.mp4', '.mov', '.m4v', '.webm'} else 'image',
                'path': p,
            })
    # Forget ids whose files were deleted; a re-added file gets a fresh id.
    for key in list(entries):
        if key not in used and not (base / str(entries[key].get('filename', ''))).is_file():
            del entries[key]
            changed = True
    if changed:
        _write_background_manifest(root, manifest)
    return files


def background_by_id(root: Path, uid: str):
    match = next(
        (b for b in backgrounds(root) if uid in (b['id'], b['legacy_id'])),
        None,
    )
    if not match:
        raise ValueError('Background not found')
    return match
