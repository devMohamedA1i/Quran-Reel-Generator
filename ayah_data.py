"""Local Quran text and Ayah timing.

Text comes from ``Assets/Quran Text/``:
  uthmani.json   - the Uthmani Arabic of every verse
  chapters.json  - Surah name, transliteration, translation, verse count
  sources.json   - where the text came from

Ayah timings come from ``Assets/Quran Timing/NNN.json`` (milliseconds).
Entry 0 of a timing file is the opening Bismillah, entry 1 is Ayah 1.
"""
from pathlib import Path
import json
import re
from functools import lru_cache

TEXT_DIR = 'Assets/Quran Text'
TIMING_DIR = 'Assets/Quran Timing'

BISMILLAH_TEXT = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ'


@lru_cache(maxsize=1)
def _chapters(root: str):
    path = Path(root) / TEXT_DIR / 'chapters.json'
    if not path.is_file():
        raise FileNotFoundError(f'Quran chapters missing: {path}')
    data = json.loads(path.read_text(encoding='utf-8'))
    chapters = data.get('chapters') if isinstance(data, dict) else data
    if not chapters or len(chapters) != 114:
        raise ValueError('Unexpected chapter structure')
    return chapters


@lru_cache(maxsize=1)
def _uthmani(root: str):
    path = Path(root) / TEXT_DIR / 'uthmani.json'
    if not path.is_file():
        raise FileNotFoundError(f'Quran text missing: {path}')
    data = json.loads(path.read_text(encoding='utf-8'))
    if len(data) != 114:
        raise ValueError('Unexpected Quran text structure')
    return data


@lru_cache(maxsize=1)
def _sources(root: str):
    path = Path(root) / TEXT_DIR / 'sources.json'
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except ValueError:
        return []
    return data.get('sources', data) if isinstance(data, dict) else data


@lru_cache(maxsize=1)
def _waqf(root: str):
    """The Quranic pause signs that follow each word.

    ``uthmani.json`` carries the Uthmani text without the waqf marks, so
    the marks are kept in their own small file next to it. The file is
    optional: without it the text is shown exactly as it is stored.
    """
    path = Path(root) / TEXT_DIR / 'waqf.json'
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        int(surah): {
            int(verse): {int(word): signs for word, signs in marks.items()}
            for verse, marks in verses.items()
        }
        for surah, verses in data.items()
        if isinstance(verses, dict)
    }


_WAQF_SIGNS = frozenset('\u06d6\u06d7\u06d8\u06d9\u06da\u06db\u06e9')


def _apply_waqf(text: str, marks: dict) -> str:
    """Put the pause signs back after the words they belong to."""
    if not marks:
        return text
    words = text.split()
    if not words:
        return text
    parts = []
    for index, word in enumerate(words):
        parts.append(word)
        raw_signs = marks.get(index)
        if raw_signs:
            signs = ''.join(ch for ch in raw_signs if ch in _WAQF_SIGNS)
            if signs:
                parts.append(signs)
    return ' '.join(parts)


def chapter_info(root: Path, surah: int):
    """Name, transliteration and verse count of a Surah."""
    chapters = _chapters(str(root))
    for chapter in chapters:
        if int(chapter['id']) == int(surah):
            return chapter
    raise ValueError(f'Unknown Surah {surah}')


def surah_name(root: Path, surah: int) -> str:
    """The Surah name in the form the studio shows."""
    chapter = chapter_info(root, surah)
    name = chapter['name']
    # Keep the "Surah of ..." form the interface has always used.
    if not name.startswith('سُورَةُ'):
        name = f'سُورَةُ {name}'
    if not name.endswith('ِ'):
        name = name + 'ِ'
    return name


def verse_text(root: Path, surah: int, verse: int) -> str:
    """The Uthmani text of one verse, with its pause signs."""
    verses = _uthmani(str(root)).get(str(int(surah)))
    if not verses or not 1 <= verse <= len(verses):
        raise ValueError(f'Invalid verse {surah}:{verse}')
    marks = _waqf(str(root)).get(int(surah), {}).get(int(verse), {})
    return _apply_waqf(verses[verse - 1]['text'], marks)


def all_verses(root: Path, surah: int) -> list:
    """Every verse of a Surah as {number, text}."""
    verses = _uthmani(str(root)).get(str(int(surah)))
    if not verses:
        raise ValueError(f'Unknown Surah {surah}')
    signs = _waqf(str(root)).get(int(surah), {})
    return [
        {
            'number': v['verse'],
            'text': _apply_waqf(v['text'], signs.get(int(v['verse']), {})),
        }
        for v in verses
    ]


@lru_cache(maxsize=128)
def ayah_timings(root: str, surah: int) -> tuple:
    """Ayah timings of a Surah in seconds.

    Returns a tuple of dicts: index 0 is the opening Bismillah, 1..N are
    the Ayahs. Only the timings that are present in the file are used.
    """
    path = Path(root) / TIMING_DIR / f'{int(surah):03d}.json'
    if not path.is_file():
        return ()
    try:
        raw = json.loads(path.read_text(encoding='utf-8'))
    except ValueError as exc:
        raise ValueError(f'Unreadable timing file {path.name}: {exc}')

    out = []
    for entry in raw:
        start = float(entry.get('start_time', 0)) / 1000.0
        end = float(entry.get('end_time', 0)) / 1000.0
        if end < start:
            continue
        out.append({
            'index': int(entry.get('ayah', len(out))),
            'ayah': int(entry.get('ayah', len(out))),
            'start': round(start, 3),
            'end': round(end, 3),
        })
    return tuple(out)


def ayah_at(root: Path, surah: int, seconds: float):
    """The Ayah that is being recited at a point in time, or None."""
    best = None
    for entry in ayah_timings(str(root), surah):
        if entry['index'] == 0:
            continue          # the opening Bismillah is not an Ayah
        if entry['start'] <= seconds < entry['end']:
            return entry['ayah']
        if entry['start'] > seconds:
            break
        best = entry
    # between two Ayahs: keep the last one that has started
    return best['ayah'] if best else None


def timings_for_range(root: Path, surah: int, start: float, end: float) -> list:
    """The Ayah segments that overlap a time range."""
    out = []
    for entry in ayah_timings(str(root), surah):
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


def propose_reels(root: Path, surah: int, target: float = 180.0,
                  duration: float = None) -> list:
    """Propose reels that end on a validated Ayah boundary."""
    entries = [e for e in ayah_timings(str(root), surah) if e['index'] > 0]
    return propose_reels_from(entries, target, duration)


def propose_reels_from(entries: list, target: float = 180.0,
                       duration: float = None) -> list:
    """Propose reels from any validated Ayah timing entries.

    The first reel starts at the beginning of the recording, which carries
    the opening Bismillah. Every reel ends where an Ayah ends, so no Ayah
    is split or repeated. The last reel always reaches the end of the
    recording. An unusually long Ayah is reported so it can be reviewed.
    """
    entries = [e for e in entries if e['index'] > 0]
    if not entries:
        return []

    reels = []
    start = 0.0
    longest = 0.0
    longest_ayah = None

    for entry in entries:
        span = entry['end'] - entry['start']
        if span > longest:
            longest = span
            longest_ayah = entry['ayah']

        if entry['end'] - start < target:
            continue

        # An Ayah that runs for more than 45 seconds cannot be shortened
        # without splitting it, so the reel that holds it is reported.
        reels.append({
            'start': round(start, 3),
            'end': round(entry['end'], 3),
            'end_ayah': entry['ayah'],
            'long': longest > 45,
            'long_ayah': longest_ayah if longest > 45 else None,
            'long_ayah_seconds': round(longest, 1) if longest > 45 else None,
        })
        start = entry['end']
        longest = 0.0
        longest_ayah = None

    if duration is None:
        duration = entries[-1]['end']
    # If the audio recording extends well past the timing file (e.g. a 4-hour Mujawwad
    # recording paired with Murattal timings), slice the remainder into ~target reels
    # instead of dumping hours into one giant final reel.
    pos = start
    while pos < duration - 0.01:
        rem = duration - pos
        end = duration if rem <= target + 15.0 else min(duration, pos + target)
        reels.append({
            'start': round(pos, 3),
            'end': round(end, 3),
            'end_ayah': None,
            'long': False,
        })
        pos = end
    return reels


def longest_ayah(root: Path, surah: int) -> float:
    """The length of the longest Ayah of a Surah."""
    entries = [e for e in ayah_timings(str(root), surah) if e['index'] > 0]
    if not entries:
        return 0.0
    return max(e['end'] - e['start'] for e in entries)


def clear_caches():
    _chapters.cache_clear()
    _uthmani.cache_clear()
    _sources.cache_clear()
    ayah_timings.cache_clear()
