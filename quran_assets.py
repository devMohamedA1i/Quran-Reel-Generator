"""Optional Quran text and Ayah timing for a local recitation (Phase 1).

Both assets are optional and belong to one audio source. Nothing here copies
or rewrites the user's files:

  * Quran text is read from the folder the user chooses. The existing
    ``uthmani.json`` format is supported, as are per-Surah ``001.json`` files
    containing ``{chapter, verse, text}`` entries.
  * Ayah timing is read from ``NNN.json`` files in the existing format: an
    array whose entry 0 is the opening Bismillah and whose entries 1..N are
    the Ayahs, with ``ayah``, ``start_time`` and ``end_time`` in milliseconds.
  * Manual corrections are written to ``Output/timings/_sources/<source>/``.
    The original timing files are never modified.

A source id is part of every lookup, so text or timing loaded for one
recording can never appear for another. When timing is attached to a
recording, it is also checked against that recording's duration and the
recording it was validated against; an out-of-range or different-recording
timing file is refused instead of guessed.
"""
from __future__ import annotations

import json
import math
import threading
from datetime import datetime, timezone
from pathlib import Path

LEGACY_ID = 'legacy'
_METADATA_FILES = {'chapters', 'sources', 'waqf', 'tafsir', 'translations'}

_TEXT: dict[str, dict] = {}
_TIMING: dict[str, dict] = {}
_LOCK = threading.RLock()
_DURATION_CACHE: dict[tuple, float | None] = {}


class AssetError(Exception):
    """An optional asset cannot be used. `status` is an HTTP suggestion."""

    def __init__(self, message: str, status: int = 400, code: str = ''):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def token(source_id: str | None) -> str:
    return source_id or LEGACY_ID


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except OSError as exc:
        raise AssetError(f'Cannot read {path.name}: {exc}', status=400)
    except ValueError as exc:
        raise AssetError(f'{path.name} is not valid JSON: {exc}', status=400)


def _chapter_from_name(path: Path) -> int | None:
    stem = path.stem.strip()
    if stem.isdigit():
        number = int(stem)
        return number if 1 <= number <= 114 else None
    return None


# ------------------------------------------------------------------ Quran text


def _text_records(payload, fallback_chapter=None):
    """Normalise the supported text shapes into {chapter, verse, text}."""
    records = []

    def add(entry, chapter_hint=None):
        if not isinstance(entry, dict):
            raise AssetError('A text entry is not an object.')
        chapter = entry.get('chapter', chapter_hint)
        verse = entry.get('verse', entry.get('number'))
        text = entry.get('text')
        records.append((chapter, verse, text))

    if isinstance(payload, list):
        for entry in payload:
            add(entry, fallback_chapter)
        return records

    if isinstance(payload, dict):
        if isinstance(payload.get('verses'), list):
            for entry in payload['verses']:
                add(entry, fallback_chapter or payload.get('chapter'))
            return records
        # uthmani.json: {"1": [{"chapter":1,"verse":1,"text":...}, ...]}
        for key, value in payload.items():
            if not isinstance(value, list):
                continue
            chapter = int(key) if str(key).isdigit() else fallback_chapter
            if chapter is None:
                raise AssetError(f'Text group "{key}" has no Surah number.')
            for entry in value:
                add(entry, chapter)
        if records:
            return records

    raise AssetError('This file does not contain Quran text entries.')


def _normalise_text(root: Path, records, label: str) -> dict[int, list]:
    grouped: dict[int, dict[int, str]] = {}
    for chapter, verse, text in records:
        try:
            chapter = int(chapter)
            verse = int(verse)
        except (TypeError, ValueError):
            raise AssetError(f'{label}: every verse needs a Surah and verse number.')
        if not 1 <= chapter <= 114:
            raise AssetError(f'{label}: Surah {chapter} is outside 1–114.')
        if verse < 1:
            raise AssetError(f'{label}: verse numbers must start at 1.')
        if not isinstance(text, str) or not text.strip():
            raise AssetError(f'{label}: Surah {chapter}, verse {verse} has no text.')
        grouped.setdefault(chapter, {})[verse] = text.strip()

    surahs: dict[int, list] = {}
    for chapter, verses in sorted(grouped.items()):
        numbers = sorted(verses)
        if numbers != list(range(1, numbers[-1] + 1)):
            missing = sorted(set(range(1, numbers[-1] + 1)) - set(numbers))
            raise AssetError(
                f'{label}: Surah {chapter:03d} is missing verse '
                f'{missing[0]} (verses must be consecutive).'
            )
        surahs[chapter] = [
            {'number': number, 'text': verses[number]} for number in numbers
        ]
    if not surahs:
        raise AssetError(f'{label}: no Quran text was found.')
    return surahs


def _parse_text_file(root: Path, path: Path) -> dict[int, list]:
    payload = _read_json(path)
    records = _text_records(payload, _chapter_from_name(path))
    return _normalise_text(root, records, path.name)


def load_text(root: Path, source_id: str | None, folder) -> dict:
    """Read and attach a Quran text folder (or a single JSON file)."""
    path = Path(str(folder or '')).expanduser()
    if not str(folder or '').strip():
        raise AssetError('Choose a Quran text folder first.')
    if not path.exists():
        raise AssetError(f'Text folder not found: {path}', status=404)
    if not path.is_dir() and not path.is_file():
        raise AssetError(f'Not a file or folder: {path}', status=400)

    surahs: dict[int, list] = {}
    files: list[str] = []

    if path.is_file():
        candidates = [path]
    else:
        uthmani = path / 'uthmani.json'
        if uthmani.is_file():
            candidates = [uthmani]
        else:
            candidates = [
                item for item in sorted(path.glob('*.json'))
                if item.is_file() and item.stem.lower() not in _METADATA_FILES
            ]
    if not candidates:
        raise AssetError(
            'No Quran text JSON files were found. Use uthmani.json or '
            'per-Surah files such as 001.json.',
            status=400,
        )

    for item in candidates:
        parsed = _parse_text_file(root, item)
        for chapter, verses in parsed.items():
            if chapter in surahs:
                raise AssetError(
                    f'Surah {chapter:03d} appears in more than one text file. '
                    'Remove the duplicate before loading the folder.'
                )
            surahs[chapter] = verses
        files.append(item.name)

    total = sum(len(verses) for verses in surahs.values())
    info = {
        'path': str(path),
        'name': path.name,
        'files': files,
        'surahs': surahs,
        'verse_counts': {chapter: len(verses) for chapter, verses in surahs.items()},
        'verse_total': total,
    }
    with _LOCK:
        _TEXT[token(source_id)] = info
    return public_text(source_id)


def remove_text(source_id: str | None) -> dict:
    with _LOCK:
        _TEXT.pop(token(source_id), None)
    return public_text(source_id)


def public_text(source_id: str | None) -> dict:
    with _LOCK:
        info = _TEXT.get(token(source_id))
    if not info:
        return {
            'loaded': False,
            'name': '',
            'path': '',
            'surahs': [],
            'verse_counts': {},
            'verse_total': 0,
        }
    return {
        'loaded': True,
        'name': info['name'],
        'path': info['path'],
        'files': list(info['files']),
        'surahs': sorted(info['surahs']),
        'verse_counts': dict(info['verse_counts']),
        'verse_total': info['verse_total'],
    }


def text_available(root: Path, source_id: str | None, surah: int) -> bool:
    if token(source_id) == LEGACY_ID:
        return True          # the built-in Uthmani text is always available
    with _LOCK:
        info = _TEXT.get(token(source_id))
    return bool(info and int(surah) in info['surahs'])


def verses(root: Path, source_id: str | None, surah: int) -> list:
    """The verses of one Surah from the text attached to this recording.

    The built-in Al-Ajmi text is only returned for the built-in library. An
    external recording without text gets an explicit error, never a
    substituted reciter's text.
    """
    surah = int(surah)
    if not 1 <= surah <= 114:
        raise AssetError('Surah must be between 1 and 114.', status=400)
    with _LOCK:
        info = _TEXT.get(token(source_id))
    if info is None and token(source_id) == LEGACY_ID:
        import ayah_data
        return ayah_data.all_verses(Path(root), surah)
    if not info:
        raise AssetError(
            'No Quran text is loaded for this recording. Reels can still be '
            'created and exported without text.',
            status=409,
            code='no_text',
        )
    if surah not in info['surahs']:
        raise AssetError(
            f'The loaded Quran text has no Surah {surah:03d}.',
            status=404,
            code='text_surah_missing',
        )
    return [dict(verse) for verse in info['surahs'][surah]]


# --------------------------------------------------------------- Ayah timing


def _timing_entries(path: Path, label: str) -> list:
    raw = _read_json(path)
    if not isinstance(raw, list) or not raw:
        raise AssetError(f'{label}: expected a non-empty JSON array of Ayahs.')
    entries = []
    for position, item in enumerate(raw):
        if not isinstance(item, dict):
            raise AssetError(f'{label}: entry {position} is not an object.')
        try:
            ayah = int(item.get('ayah', position))
            start = float(item.get('start_time'))
            end = float(item.get('end_time'))
        except (TypeError, ValueError):
            raise AssetError(
                f'{label}: entry {position} needs numeric ayah, start_time '
                'and end_time.'
            )
        if ayah < 0:
            raise AssetError(f'{label}: entry {position} has a negative Ayah number.')
        if not math.isfinite(start) or not math.isfinite(end):
            raise AssetError(f'{label}: entry {position} has a non-finite time.')
        if start < 0 or end < 0:
            raise AssetError(f'{label}: entry {position} has a negative time.')
        if end < start:
            raise AssetError(
                f'{label}: Ayah {ayah} ends before it starts.'
            )
        extras = {
            key: item[key] for key in ('polygon', 'x', 'y', 'page')
            if key in item
        }
        entries.append({
            'ayah': ayah,
            'start': round(start / 1000.0, 3),
            'end': round(end / 1000.0, 3),
            'start_time': start,
            'end_time': end,
            'extra': extras,
        })
    _check_timing_order(entries, label)
    return entries


def _check_timing_order(entries: list, label: str) -> None:
    numbers = [entry['ayah'] for entry in entries]
    if numbers[0] not in (0, 1):
        raise AssetError(f'{label}: the first Ayah number must be 0 or 1.')
    expected = list(range(numbers[0], numbers[0] + len(numbers)))
    if numbers != expected:
        raise AssetError(
            f'{label}: Ayah numbering must be consecutive '
            f'{numbers[0]}..{expected[-1]}.'
        )
    for previous, current in zip(entries, entries[1:]):
        if current['start'] < previous['end'] - 0.05:
            raise AssetError(
                f'{label}: Ayah {current["ayah"]} starts before Ayah '
                f'{previous["ayah"]} ends.'
            )


def _expected_verses(root: Path, surah: int) -> int | None:
    try:
        import ayah_data
        return len(ayah_data.all_verses(Path(root), surah))
    except Exception:
        return None


def _recording_id(root: Path, source_id: str | None, surah: int):
    if token(source_id) == LEGACY_ID:
        return 'legacy'
    try:
        import audio_sources
        source = audio_sources.get(Path(root), source_id)
        recording = audio_sources.recording_for_surah(source, surah)
        return recording['id']
    except Exception:
        return None


def _recording_duration(root: Path, source_id: str | None, surah: int):
    """Duration of the recording currently chosen for this Surah, cached."""
    try:
        import reel_planner
        path = reel_planner.master_audio(Path(root), surah, source_id)
        stat = path.stat()
        key = (str(path), stat.st_size, stat.st_mtime_ns)
        with _LOCK:
            if key in _DURATION_CACHE:
                return _DURATION_CACHE[key]
        value = reel_planner.probe_seconds(path)
        with _LOCK:
            _DURATION_CACHE[key] = value
        return value
    except Exception:
        return None


def load_timing(root: Path, source_id: str | None, folder) -> dict:
    """Read and attach one or more existing timing files."""
    path = Path(str(folder or '')).expanduser()
    if not str(folder or '').strip():
        raise AssetError('Choose an Ayah timing folder first.')
    if not path.exists():
        raise AssetError(f'Timing folder not found: {path}', status=404)

    if path.is_file():
        candidates = [path]
    elif path.is_dir():
        candidates = [
            item for item in sorted(path.glob('*.json'))
            if item.is_file() and item.stem.lower() not in _METADATA_FILES
        ]
    else:
        raise AssetError(f'Not a file or folder: {path}', status=400)

    files: dict[int, dict] = {}
    issues: list[dict] = []
    for item in candidates:
        surah = _chapter_from_name(item)
        if surah is None:
            issues.append({
                'file': item.name,
                'error': 'Skipped: the filename is not a Surah number 001–114.',
            })
            continue
        try:
            entries = _timing_entries(item, item.name)
            expected = _expected_verses(root, surah)
            if expected is not None:
                timed = len(entries) - (1 if entries[0]['ayah'] == 0 else 0)
                if timed != expected:
                    raise AssetError(
                        f'{item.name}: {timed} Ayahs are timed but Surah '
                        f'{surah:03d} has {expected}.'
                    )
        except AssetError as exc:
            issues.append({'file': item.name, 'error': exc.message})
            continue
        files[surah] = {
            'path': str(item),
            'name': item.name,
            'entries': entries,
            'recording_id': _recording_id(root, source_id, surah),
        }

    if not files:
        detail = issues[0]['error'] if issues else 'No NNN.json timing files were found.'
        raise AssetError(
            'No usable Ayah timing files were found. ' + detail,
            status=400,
        )

    info = {
        'path': str(path),
        'name': path.name,
        'files': files,
        'issues': issues,
    }
    with _LOCK:
        _TIMING[token(source_id)] = info
    return public_timing(source_id)


def remove_timing(source_id: str | None) -> dict:
    with _LOCK:
        _TIMING.pop(token(source_id), None)
    return public_timing(source_id)


def public_timing(source_id: str | None) -> dict:
    with _LOCK:
        info = _TIMING.get(token(source_id))
    if not info:
        return {
            'loaded': False,
            'name': '',
            'path': '',
            'surahs': [],
            'issues': [],
        }
    return {
        'loaded': True,
        'name': info['name'],
        'path': info['path'],
        'surahs': sorted(info['files']),
        'issues': list(info['issues']),
    }


def has_timing(root: Path, source_id: str | None, surah: int | None = None) -> bool:
    """Whether usable timing exists, optionally validated for one Surah."""
    tok = token(source_id)
    with _LOCK:
        attached = _TIMING.get(tok)
    if tok == LEGACY_ID and not attached:
        if surah is None:
            base = Path(root) / 'Assets/Quran Timing'
            return base.is_dir() and any(base.glob('*.json'))
        return (Path(root) / 'Assets/Quran Timing' / f'{int(surah):03d}.json').is_file()

    if surah is None:
        with _LOCK:
            info = _TIMING.get(tok)
        return bool(info and info['files'])
    try:
        timings(root, tok, surah)
    except AssetError:
        return False
    return True


# ------------------------------------------------------- corrections storage


def _correction_path(root: Path, source_id: str | None, surah: int) -> Path:
    return (
        Path(root) / 'Output' / 'timings' / '_sources' / token(source_id)
        / f'{int(surah):03d}.json'
    )


def _read_correction(root: Path, source_id: str | None, surah: int):
    path = _correction_path(root, source_id, surah)
    if not path.is_file():
        return None
    data = _read_json(path)
    if not isinstance(data, dict) or not isinstance(data.get('entries'), list):
        return None
    return data


def is_corrected(root: Path, source_id: str | None, surah: int) -> bool:
    return _correction_path(root, source_id, surah).is_file()


def corrected_surahs(root: Path, source_id: str | None) -> list[int]:
    """Surahs that have reviewed timing corrections for this source."""
    base = Path(root) / 'Output' / 'timings' / '_sources' / token(source_id)
    if not base.is_dir():
        return []
    return sorted(
        int(item.stem) for item in base.glob('*.json')
        if item.is_file() and item.stem.isdigit()
    )


def _base_entries(root: Path, source_id: str | None, surah: int) -> list:
    """The original timing for a Surah, before manual corrections."""
    tok = token(source_id)
    with _LOCK:
        info = _TIMING.get(tok)
    if tok == LEGACY_ID and not info:
        import ayah_data
        return [
            {
                'ayah': entry['ayah'],
                'start': entry['start'],
                'end': entry['end'],
                'start_time': entry['start'] * 1000.0,
                'end_time': entry['end'] * 1000.0,
                'extra': {},
            }
            for entry in ayah_data.ayah_timings(str(root), surah)
        ]

    if not info:
        raise AssetError(
            'No Ayah timing files are loaded for this recording. '
            'Reel planning uses the detected pauses only.',
            status=409,
            code='no_timing',
        )
    item = info['files'].get(int(surah))
    if not item:
        raise AssetError(
            f'The loaded timing files have no Surah {int(surah):03d}.',
            status=404,
            code='timing_surah_missing',
        )

    recording_id = _recording_id(root, source_id, surah)
    if item.get('recording_id') and recording_id and \
            item['recording_id'] != recording_id:
        raise AssetError(
            'The timing files were validated against a different recording '
            'for this Surah. They were not used.',
            status=409,
            code='timing_recording_mismatch',
        )
    if not item.get('recording_id') and recording_id:
        item['recording_id'] = recording_id
    return [dict(entry) for entry in item['entries']]


def _check_duration(root: Path, source_id: str | None, surah: int,
                    entries: list) -> None:
    duration = _recording_duration(root, source_id, surah)
    if duration is None:
        return
    last = entries[-1]['end']
    first = entries[0]['start']
    if last > duration + 1.0:
        raise AssetError(
            f'The timing file ends at {last:.1f}s but the recording is only '
            f'{duration:.1f}s long. It was not used.',
            status=409,
            code='timing_out_of_bounds',
        )
    if first > duration:
        raise AssetError(
            'The timing file starts after the end of this recording. '
            'It was not used.',
            status=409,
            code='timing_out_of_bounds',
        )


def _effective(root: Path, source_id: str | None, surah: int) -> tuple:
    correction = _read_correction(root, source_id, surah)
    try:
        base = _base_entries(root, source_id, surah)
    except AssetError as exc:
        if exc.code != 'no_timing' or not correction:
            raise
        # Timing created by hand from loaded text: the correction file is
        # itself the authority, so it can be used without an original file.
        try:
            base = [
                {
                    'ayah': int(item['ayah']),
                    'start': round(float(item['start']), 3),
                    'end': round(float(item['end']), 3),
                    'start_time': float(item['start']) * 1000.0,
                    'end_time': float(item['end']) * 1000.0,
                    'extra': {},
                }
                for item in correction['entries']
            ]
        except (KeyError, TypeError, ValueError):
            raise exc
        _check_timing_order(base, 'Saved corrections')
        _check_duration(root, source_id, surah, base)
        return base, True

    corrected = False
    if correction:
        recording_id = _recording_id(root, source_id, surah)
        stored = correction.get('recording_id')
        if stored and recording_id and stored != recording_id:
            correction = None       # a correction for another recording
        elif isinstance(correction.get('entries'), list):
            by_ayah = {int(item['ayah']): item for item in base}
            for item in correction['entries']:
                try:
                    ayah = int(item['ayah'])
                    start = float(item['start'])
                    end = float(item['end'])
                except (KeyError, TypeError, ValueError):
                    continue
                if ayah in by_ayah:
                    by_ayah[ayah] = {
                        **by_ayah[ayah],
                        'start': round(start, 3),
                        'end': round(end, 3),
                        'start_time': start * 1000.0,
                        'end_time': end * 1000.0,
                    }
            merged = [by_ayah[key] for key in sorted(by_ayah)]
            try:
                _check_timing_order(merged, 'Saved corrections')
            except AssetError:
                merged = base
            else:
                base = merged
                corrected = True
    _check_duration(root, source_id, surah, base)
    return base, corrected


def timings(root: Path, source_id: str | None, surah: int) -> tuple:
    """Effective timings in seconds: index 0 is the Bismillah."""
    entries, _ = _effective(root, source_id, surah)
    return tuple({
        'index': entry['ayah'],
        'ayah': entry['ayah'],
        'start': entry['start'],
        'end': entry['end'],
    } for entry in entries)


def timing_status(root: Path, source_id: str | None, surah: int) -> dict:
    """Everything the timing editor needs for one Surah."""
    try:
        entries, corrected = _effective(root, source_id, surah)
    except AssetError as exc:
        return {
            'available': False,
            'error': exc.message,
            'code': exc.code,
            'corrected': is_corrected(root, source_id, surah),
            'ayahs': [],
        }
    recording_id = _recording_id(root, source_id, surah)
    return {
        'available': True,
        'corrected': corrected,
        'recording_id': recording_id,
        'ayahs': [
            {
                'ayah': entry['ayah'],
                'start': entry['start'],
                'end': entry['end'],
                'start_time': round(entry['start'] * 1000.0),
                'end_time': round(entry['end'] * 1000.0),
            }
            for entry in entries
        ],
    }


def ayah_at(root: Path, source_id: str | None, surah: int, seconds: float):
    """The Ayah inside a timed interval, or None.

    Outside the timed part of the recording no verse is shown. This avoids
    carrying the last Ayah onto audio that the timing file does not cover.
    """
    for entry in timings(root, source_id, surah):
        if entry['index'] == 0:
            continue
        if entry['start'] <= seconds < entry['end']:
            return entry['ayah']
    return None


def propose_reels(root: Path, source_id: str | None, surah: int,
                  target: float = 174.0, duration: float | None = None) -> list:
    """Ayah-aligned Reel proposals from the attached timing."""
    import ayah_data
    return ayah_data.propose_reels_from(
        list(timings(root, source_id, surah)), target, duration
    )


def timings_for_range(root: Path, source_id: str | None, surah: int,
                      start: float, end: float) -> list:
    out = []
    for entry in timings(root, source_id, surah):
        if entry['index'] == 0:
            continue
        if entry['end'] <= start or entry['start'] >= end:
            continue
        out.append({
            'ayah': entry['ayah'],
            'start': max(entry['start'], start),
            'end': min(entry['end'], end),
        })
    return out


# --------------------------------------------------------- manual corrections


def _normalise_corrections(entries, base: list, duration: float | None) -> list:
    if not isinstance(entries, list) or not entries:
        raise AssetError('Send at least one Ayah timing.')
    by_ayah = {entry['ayah']: dict(entry) for entry in base}
    for item in entries:
        if not isinstance(item, dict):
            raise AssetError('Every timing row must be an object.')
        try:
            ayah = int(item['ayah'])
        except (KeyError, TypeError, ValueError):
            raise AssetError('Every timing row needs an Ayah number.')
        if ayah not in by_ayah:
            raise AssetError(f'Ayah {ayah} is not part of this Surah timing.')
        raw_start = item.get('start', item.get('start_time'))
        raw_end = item.get('end', item.get('end_time'))
        try:
            start = float(raw_start)
            end = float(raw_end)
        except (TypeError, ValueError):
            raise AssetError(f'Ayah {ayah} needs numeric start and end times.')
        if 'start_time' in item and 'start' not in item:
            start /= 1000.0
        if 'end_time' in item and 'end' not in item:
            end /= 1000.0
        if not math.isfinite(start) or not math.isfinite(end):
            raise AssetError(f'Ayah {ayah} has a non-finite time.')
        if start < 0 or end <= start:
            raise AssetError(f'Ayah {ayah} must end after it starts.')
        if duration is not None and end > duration + 0.05:
            raise AssetError(
                f'Ayah {ayah} ends at {end:.2f}s, beyond the recording '
                f'({duration:.2f}s).',
                status=409,
                code='timing_out_of_bounds',
            )
        by_ayah[ayah].update({
            'start': round(start, 3),
            'end': round(end, 3),
            'start_time': start * 1000.0,
            'end_time': end * 1000.0,
        })
    merged = [by_ayah[key] for key in sorted(by_ayah)]
    _check_timing_order(merged, 'Corrected timing')
    return merged


def save_corrections(root: Path, source_id: str | None, surah: int,
                     entries, recording_id: str | None = None) -> dict:
    """Store reviewed times separately; the original timing file is untouched."""
    try:
        base = _base_entries(root, source_id, surah)
    except AssetError as exc:
        if exc.code != 'no_timing' or not text_available(root, source_id, surah):
            raise
        # The user is placing the loaded text by hand. These rows become the
        # recording-specific timing; no original file is touched.
        base = [
            {
                'ayah': verse['number'],
                'start': 0.0,
                'end': 0.0,
                'start_time': 0.0,
                'end_time': 0.0,
                'extra': {},
            }
            for verse in verses(root, source_id, surah)
        ]
    duration = _recording_duration(root, source_id, surah)
    merged = _normalise_corrections(entries, base, duration)
    current = _recording_id(root, source_id, surah)
    if recording_id and current and recording_id != current:
        raise AssetError(
            'The recording changed while the timing was being edited. '
            'Reopen the timing editor before saving.',
            status=409,
            code='timing_recording_mismatch',
        )

    path = _correction_path(root, source_id, surah)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'schema': 'qvs.timing-corrections/1',
        'surah': int(surah),
        'source': token(source_id),
        'recording_id': current,
        'corrected_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'duration': duration,
        'entries': [
            {
                'ayah': entry['ayah'],
                'start': entry['start'],
                'end': entry['end'],
            }
            for entry in merged
        ],
    }
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    temporary.replace(path)
    return timing_status(root, source_id, surah)


def reset_corrections(root: Path, source_id: str | None, surah: int) -> dict:
    _correction_path(root, source_id, surah).unlink(missing_ok=True)
    return timing_status(root, source_id, surah)


def export_timing(root: Path, source_id: str | None, surah: int) -> tuple[str, list]:
    """The corrected timing in the original JSON shape, ready to download."""
    entries, _ = _effective(root, source_id, surah)
    payload = []
    for entry in entries:
        item = {
            'ayah': entry['ayah'],
            'start_time': int(round(entry['start'] * 1000.0)),
            'end_time': int(round(entry['end'] * 1000.0)),
        }
        extras = entry.get('extra') or {}
        for key in ('polygon', 'x', 'y', 'page'):
            if key in extras:
                item[key] = extras[key]
        payload.append(item)
    return f'{int(surah):03d}-timing-corrected.json', payload


# ------------------------------------------------------------------- summary


def status(root: Path, source_id: str | None) -> dict:
    text = public_text(source_id)
    timing = public_timing(source_id)
    tok = token(source_id)
    if tok == LEGACY_ID and not timing.get('loaded'):
        base = Path(root) / 'Assets/Quran Timing'
        source_surahs = sorted(
            int(item.stem) for item in base.glob('*.json')
            if item.stem.isdigit()
        ) if base.is_dir() else []
        if source_surahs:
            timing = {
                'loaded': True,
                'name': 'Built-in Quran Timing',
                'path': str(base),
                'surahs': source_surahs,
                'issues': [],
            }

    # Timing that was placed by hand has no original NNN.json, but its
    # corrections are still valid timing for this recording. Report them so
    # the editor can offer Reset and Export for them too.
    corrected = corrected_surahs(root, source_id)
    if corrected:
        surahs = sorted(set(timing.get('surahs') or []) | set(corrected))
        timing = {
            'loaded': True,
            'name': timing.get('name') or 'Manual timing',
            'path': timing.get('path') or '',
            'surahs': surahs,
            'issues': list(timing.get('issues') or []),
        }
    timing_loaded = bool(timing.get('loaded'))
    if not text.get('loaded') and tok == LEGACY_ID:
        text = {
            'loaded': True,
            'name': 'Built-in Uthmani text',
            'path': str(Path(root) / 'Assets/Quran Text'),
            'files': ['uthmani.json', 'chapters.json'],
            'surahs': list(range(1, 115)),
            'verse_counts': {},
            'verse_total': 6236,
        }

    return {
        'source': source_id,
        'text': text,
        'timing': timing,
        'text_available': bool(text.get('loaded')),
        'timing_available': timing_loaded,
        'corrected_surahs': corrected,
    }


def clear_caches() -> None:
    with _LOCK:
        _TEXT.clear()
        _TIMING.clear()
        _DURATION_CACHE.clear()
