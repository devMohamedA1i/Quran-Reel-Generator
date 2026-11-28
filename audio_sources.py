"""Local Quran audio folder discovery and source isolation (Phase 1).

A user may point the studio at any folder of MP3 recordings. The scanner walks
the folder recursively, so both common layouts work without renaming:

  * flat          Mishary/001.mp3, Mishary/002.mp3, ...
  * subfolders    Al-Ajmi-114-Surahs/001 - Al-Fatihah/recording.mp3, ...

Nothing is copied, moved or written here. A selected folder is registered in
memory under a stable id derived from its absolute path. Every other part of
the application (waveform cache, reel plans, drafts, exports) includes that id
so two recordings can never silently share state.

Surah identification deliberately refuses to guess. A filename number and a
folder number that disagree, an ambiguous name, or two recordings that claim
the same Surah all become "needs confirmation" entries that the user resolves
in the interface.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import unicodedata
from pathlib import Path

import ayah_data

LEGACY_ID = 'legacy'
LEGACY_REL = Path('Assets') / 'audio' / 'Al-Ajmi-114-Surahs'
_MP3 = '.mp3'
_REGISTRY: dict[str, dict] = {}
_LOCK = threading.RLock()
_ACTIVE_ID: str | None = None


class AudioSourceError(Exception):
    """A folder or recording cannot be used. `status` is an HTTP suggestion."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# ------------------------------------------------------------------ text help

_ARABIC_DIGITS = str.maketrans(
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
    '01234567890123456789',
)

_ALEF = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي'})


def _ascii_digits(text: str) -> str:
    return text.translate(_ARABIC_DIGITS)


def _plain(text: str) -> str:
    """Lowercase searchable text without diacritics or punctuation."""
    text = _ascii_digits(text or '')
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace('ـ', '')
    text = text.translate(_ALEF)
    text = text.lower()
    text = re.sub(r'[^0-9a-z\u0600-\u06ff]+', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def _skeleton(text: str) -> str:
    """A very tolerant key: drop Latin vowels and collapsed repeats.

    ``Al-Faatiha``, ``Al-Fatihah`` and ``Al Fatiha`` all become ``lfth``.
    Arabic is left intact apart from the normalisation done by ``_plain``.
    """
    text = _plain(text).replace(' ', '')
    text = re.sub(r'[aeiou]', '', text)
    return re.sub(r'(.)\1+', r'\1', text)


def _name_aliases(chapter: dict) -> list[tuple[str, str]]:
    raw = [
        chapter.get('transliteration') or '',
        chapter.get('translation') or '',
        chapter.get('name') or '',
    ]
    aliases: list[tuple[str, str]] = []
    for value in raw:
        plain = _plain(value)
        if not plain:
            continue
        variants = {plain}
        # Al-Faatiha -> faatiha, An-Naas -> naas, Ash-Shams -> shams
        stripped = re.sub(
            r'^(al|an|as|at|ar|ash|ad|az|el|ال)\s+', '', plain
        )
        if stripped and stripped != plain:
            variants.add(stripped)
        for variant in variants:
            aliases.append((variant, _skeleton(variant)))
    return aliases


def _surah_index(root: Path) -> dict:
    """Name aliases for every Surah, from the existing Quran metadata."""
    index = {}
    for chapter in ayah_data._chapters(str(root)):
        number = int(chapter['id'])
        index[number] = _name_aliases(chapter)
    return index


# --------------------------------------------------------------- number hints

# 001, 01, 1, Surah 001, سورة ١, #1, 001 - ...
_LEADING_NUMBER = re.compile(
    r'^\s*(?:surah|surat|sura|chapter|سورة|سوره)?[\s_\-.:#]*(\d{1,3})(?=\D|$)',
    re.IGNORECASE,
)


def _valid_surah(value: int | None) -> int | None:
    return value if value is not None and 1 <= value <= 114 else None


def _leading_surah(text: str) -> int | None:
    match = _LEADING_NUMBER.match(_ascii_digits(text or ''))
    if not match:
        return None
    return _valid_surah(int(match.group(1)))


def _three_digit_surah(text: str) -> int | None:
    for match in re.finditer(r'(?<!\d)(\d{3})(?!\d)', _ascii_digits(text or '')):
        found = _valid_surah(int(match.group(1)))
        if found:
            return found
    return None


def _number_from_label(text: str) -> int | None:
    return _leading_surah(text) or _three_digit_surah(text)


def _name_matches(text: str, index: dict) -> list[int]:
    plain = _plain(text)
    if not plain:
        return []
    padded = f' {plain} '
    whole = _skeleton(plain)
    hits = set()
    for number, aliases in index.items():
        for alias, skeleton in aliases:
            if f' {alias} ' in padded:
                hits.add(number)
                continue
            # Skeleton matching is only safe for distinctive names. Very
            # short names (Nas, Hud, Qaf) must match as whole words above.
            if len(skeleton) >= 4 and (skeleton == whole or skeleton in whole):
                hits.add(number)
    return sorted(hits)


# --------------------------------------------------------------------- scanner


def _walk_mp3s(base: Path):
    """Every MP3 below `base`, at any depth. Hidden folders are skipped."""
    for directory, dirnames, filenames in os.walk(base, followlinks=False):
        dirnames[:] = sorted(
            name for name in dirnames
            if not name.startswith('.') and name != '__MACOSX'
        )
        for name in sorted(filenames):
            if name.startswith('.') or not name.lower().endswith(_MP3):
                continue
            yield Path(directory) / name


def _recording_id(relative: str) -> str:
    return hashlib.sha256(relative.encode('utf-8')).hexdigest()[:12]


def _identify(relative: Path, index: dict) -> dict:
    stem = relative.stem
    parents = list(relative.parts[:-1])

    file_number = _number_from_label(stem)
    folder_numbers = []
    for part in parents:
        found = _number_from_label(part)
        if found:
            folder_numbers.append(found)

    name_hits = set(_name_matches(stem, index))
    for part in parents:
        name_hits.update(_name_matches(part, index))
    name_hits = sorted(name_hits)

    surah = None
    confidence = 'none'
    needs_confirmation = False
    reason = ''

    if file_number:
        surah = file_number
        confidence = 'filename'
        conflicting = sorted({n for n in folder_numbers if n != file_number})
        if conflicting:
            needs_confirmation = True
            confidence = 'conflict'
            reason = (
                f'Filename points to Surah {file_number:03d}, but the folder '
                f'points to Surah {conflicting[0]:03d}.'
            )
        elif folder_numbers:
            confidence = 'filename+folder'
    elif folder_numbers:
        unique = sorted(set(folder_numbers))
        if len(unique) == 1:
            surah = unique[0]
            confidence = 'folder'
        else:
            confidence = 'conflict'
            needs_confirmation = True
            reason = (
                'The parent folders point to different Surahs: '
                + ', '.join(f'{n:03d}' for n in unique) + '.'
            )
    elif len(name_hits) == 1:
        surah = name_hits[0]
        confidence = 'name'
    elif len(name_hits) > 1:
        confidence = 'ambiguous'
        needs_confirmation = True
        reason = (
            'The name matches more than one Surah: '
            + ', '.join(f'{n:03d}' for n in name_hits) + '.'
        )

    if surah is None and not needs_confirmation:
        reason = 'No Surah number or name could be read from this recording.'

    return {
        'id': _recording_id(relative.as_posix()),
        'relative': relative.as_posix(),
        'filename': relative.name,
        'title': relative.stem,
        'surah': surah,
        'confidence': confidence,
        'needs_confirmation': needs_confirmation or surah is None,
        'reason': reason,
    }


def _folder_name_for_surah(root: Path, surah: int) -> str:
    chapter = ayah_data.chapter_info(root, surah)
    return (
        f"{surah:03d} - {chapter.get('transliteration', '')} "
        f"( {chapter.get('translation', '')} ) سورة {chapter.get('name', '')}"
    )


def _recompute(source: dict) -> None:
    """Refresh duplicate flags, the selected recording and available Surahs."""
    recordings = source['recordings']

    groups: dict[int, list[dict]] = {}
    for recording in recordings:
        if recording.get('surah'):
            groups.setdefault(int(recording['surah']), []).append(recording)

    for surah, group in groups.items():
        selected_id = source['selected'].get(str(surah))
        for recording in group:
            recording['duplicate'] = len(group) > 1
            if len(group) > 1 and recording['id'] != selected_id:
                # Never silently pick one of several candidates.
                recording['needs_confirmation'] = True
                if not recording.get('reason'):
                    recording['reason'] = (
                        f'{len(group)} recordings match Surah {surah:03d}. '
                        'Choose the one to use.'
                    )

    available = []
    for surah, group in sorted(groups.items()):
        selected_id = source['selected'].get(str(surah))
        if selected_id and any(r['id'] == selected_id for r in group):
            available.append(surah)
        elif len(group) == 1 and not group[0].get('needs_confirmation'):
            available.append(surah)

    source['available'] = available
    source['needs_review'] = [
        r['id'] for r in recordings if r.get('needs_confirmation')
    ]


def _source_id_for(path: Path) -> str:
    digest = hashlib.sha256(str(path).encode('utf-8')).hexdigest()[:12]
    return f'src-{digest}'


def scan(root: Path, folder: str | Path, *, legacy: bool = False) -> dict:
    """Register a folder of MP3s and return its public description."""
    try:
        path = Path(folder).expanduser()
    except (TypeError, ValueError):
        raise AudioSourceError('That folder path is not valid.')

    if not path.exists():
        raise AudioSourceError(f'Folder not found: {path}', status=404)
    if not path.is_dir():
        raise AudioSourceError(f'Not a folder: {path}', status=400)
    try:
        path = path.resolve()
    except OSError as exc:
        raise AudioSourceError(f'Cannot read that folder: {exc}', status=400)
    if not os.access(path, os.R_OK | os.X_OK):
        raise AudioSourceError(
            f'This folder is not readable: {path}', status=403
        )

    source_id = LEGACY_ID if legacy else _source_id_for(path)
    index = _surah_index(root)

    recordings = []
    for file_path in _walk_mp3s(path):
        try:
            relative = file_path.relative_to(path)
        except ValueError:
            continue
        item = _identify(relative, index)
        item['path'] = str(file_path)
        recordings.append(item)

    source = {
        'id': source_id,
        'name': path.name or str(path),
        'path': str(path),
        'legacy': bool(legacy),
        'timing_compatible': bool(legacy),
        'mp3_count': len(recordings),
        'recordings': recordings,
        'selected': {},
        'available': [],
        'needs_review': [],
    }
    _recompute(source)

    with _LOCK:
        _REGISTRY[source_id] = source
        global _ACTIVE_ID
        _ACTIVE_ID = source_id
    return source


def legacy_available(root: Path) -> bool:
    return (Path(root) / LEGACY_REL).is_dir()


def register_legacy(root: Path) -> dict | None:
    base = Path(root) / LEGACY_REL
    if not base.is_dir():
        return None
    return scan(root, base, legacy=True)


def active(root: Path) -> dict | None:
    """The source last chosen in this process, falling back to the legacy one."""
    with _LOCK:
        source_id = _ACTIVE_ID
        source = _REGISTRY.get(source_id) if source_id else None
        if source is not None and Path(source['path']).is_dir():
            return source
    if legacy_available(root):
        return register_legacy(root)
    return None


def get(root: Path, source_id: str | None) -> dict:
    """Resolve a source id. A missing id means the built-in legacy library."""
    if not source_id or source_id == LEGACY_ID:
        with _LOCK:
            source = _REGISTRY.get(LEGACY_ID)
        if source is None:
            source = register_legacy(root)
        if source is None:
            raise AudioSourceError(
                'The built-in Al-Ajmi audio library is not installed. '
                'Load a Quran audio folder first.',
                status=404,
            )
        return source

    with _LOCK:
        source = _REGISTRY.get(source_id)
    if source is None:
        raise AudioSourceError(
            'That audio folder is no longer loaded. Choose the folder again.',
            status=404,
        )
    base = Path(source['path'])
    if not base.is_dir():
        raise AudioSourceError(
            f'The audio folder has moved or is unavailable: {base}',
            status=410,
        )
    return source


def recording_by_id(source: dict, recording_id: str) -> dict:
    for recording in source['recordings']:
        if recording['id'] == recording_id:
            if not Path(recording['path']).is_file():
                raise AudioSourceError(
                    f'Recording not found: {recording["relative"]}. '
                    'The folder may have moved.',
                    status=404,
                )
            return recording
    raise AudioSourceError('Unknown recording in this folder.', status=404)


def recording_for_surah(source: dict, surah: int) -> dict:
    """The recording the user chose for a Surah, or the only candidate."""
    selected_id = source['selected'].get(str(surah))
    if selected_id:
        return recording_by_id(source, selected_id)

    group = [
        r for r in source['recordings']
        if r.get('surah') and int(r['surah']) == int(surah)
    ]
    if len(group) == 1:
        return recording_by_id(source, group[0]['id'])
    if len(group) > 1:
        raise AudioSourceError(
            f'{len(group)} recordings match Surah {surah:03d}. '
            'Confirm which recording to use in the Choose Surah panel.',
            status=409,
        )
    raise AudioSourceError(
        f'No recording for Surah {surah:03d} in this folder.',
        status=404,
    )


def assign(source: dict, recording_id: str, surah: int | None) -> dict:
    """Confirm, change or clear the Surah a recording belongs to."""
    recording = recording_by_id(source, recording_id)
    if surah is None:
        recording['surah'] = None
        recording['confidence'] = 'none'
        recording['needs_confirmation'] = True
        recording['reason'] = 'Not identified.'
    else:
        if not 1 <= int(surah) <= 114:
            raise AudioSourceError('Surah must be between 1 and 114.')
        surah = int(surah)
        # One chosen recording per Surah. A recording can only belong to one
        # Surah at a time, so any previous assignment of it is removed.
        source['selected'] = {
            key: value for key, value in source['selected'].items()
            if int(key) != surah and value != recording_id
        }
        source['selected'][str(surah)] = recording_id
        recording['surah'] = surah
        recording['confidence'] = 'confirmed'
        recording['needs_confirmation'] = False
        recording['reason'] = 'Confirmed by you.'
    _recompute(source)
    return source


def cache_token(source_id: str | None) -> str:
    """A filename-safe token for waveform caches and plan folders."""
    return LEGACY_ID if not source_id else source_id


def timing_compatible(source: dict, root: Path | None = None) -> bool:
    """Whether Ayah timing can be used for this source.

    The built-in library always has its own timing. Any other folder only
    becomes timing-compatible after the user loads timing files for it.
    """
    if source.get('legacy') and source.get('timing_compatible'):
        return True
    if root is None:
        return False
    import quran_assets
    return quran_assets.has_timing(Path(root), source.get('id'))


def text_compatible(source: dict, root: Path | None = None) -> bool:
    """Whether Quran text is attached to this source."""
    if source.get('legacy'):
        return True
    if root is None:
        return False
    import quran_assets
    return bool(quran_assets.public_text(source.get('id')).get('loaded'))


def public(source: dict | None) -> dict | None:
    if source is None:
        return None
    return {
        'id': source['id'],
        'name': source['name'],
        'path': source['path'],
        'legacy': source['legacy'],
        'timing_compatible': source['timing_compatible'],
        'mp3_count': source['mp3_count'],
        'available': list(source['available']),
        'needs_review': list(source['needs_review']),
        'recordings': [
            {
                'id': r['id'],
                'relative': r['relative'],
                'filename': r['filename'],
                'title': r['title'],
                'surah': r['surah'],
                'confidence': r['confidence'],
                'needs_confirmation': r['needs_confirmation'],
                'duplicate': bool(r.get('duplicate')),
                'reason': r.get('reason', ''),
                'selected_for': next(
                    (int(s) for s, rid in source['selected'].items()
                     if rid == r['id']),
                    None,
                ),
            }
            for r in source['recordings']
        ],
    }


def surah_folder_name(root: Path, surah: int) -> str:
    return _folder_name_for_surah(root, surah)
