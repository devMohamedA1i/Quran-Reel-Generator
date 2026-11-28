"""Presentation only: canonical Arabic is never rewritten or translated by AI."""
from functools import lru_cache
import json
import re
from pathlib import Path


@lru_cache(maxsize=4)
def english_dataset(root):
    path = Path(root) / 'Assets/Quran Text/english_saheeh.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    import ayah_data
    arabic = ayah_data._uthmani(str(root))
    keys = {f'{s}:{v["verse"]}' for s, verses in arabic.items() for v in verses}
    if set(data['verses']) != keys or any(not v['text'].strip() for v in data['verses'].values()):
        raise ValueError('English translation must contain every Quran verse exactly once.')
    return data


def display_verse(root, surah, number, arabic, settings):
    english = settings.get('text_language', 'ar') == 'en'
    show_name = settings.get('show_surah_name') is True
    show_number = settings.get('show_ayah_number') is True and number > 0
    if not (english or show_name or show_number):
        return arabic
    import ayah_data
    source_surah, source_verse = (1, 1) if number == 0 else (surah, number)
    canonical = ayah_data.verse_text(Path(root), source_surah, source_verse)
    if english and arabic.strip() != canonical.strip():
        raise ValueError('Arabic text differs from the verified Hafs text; English pairing is unavailable.')
    shown_arabic = arabic
    if show_number:
        digits = str(number).translate(str.maketrans('0123456789','٠١٢٣٤٥٦٧٨٩'))
        shown_arabic += f' ﴿{digits}﴾'
    result = {'arabic':shown_arabic}
    if show_name:
        chapter = ayah_data.chapter_info(Path(root), surah)
        result['surah_name'] = 'سورة ' + chapter['name']
        if english:
            en_name = chapter.get('transliteration') or chapter.get('translation') or ''
            if en_name:
                result['surah_name_en'] = f'Surah {en_name}'
    if english:
        data = english_dataset(str(root))
        text = data['verses'][f'{source_surah}:{source_verse}']['text']
        # The publisher includes a leading verse label. Treat it as metadata:
        # preserve original source bytes, and control the visible number here.
        prefix = f'({source_verse}) '
        shown_english = text[len(prefix):] if text.startswith(prefix) else text
        shown_english = re.sub(r'\[\d+\]', '', shown_english).strip()
        if show_number:
            shown_english = f'{shown_english} ({number})'
        result['english'] = shown_english
        meta = data['metadata']
        result['credit'] = f'Noor International Center | QuranEnc.com | v{meta["version"]}'
    return result


def opening_entry(root, source, surah):
    """Return a validated opening interval, excluding Fatiha and At-Tawbah."""
    if int(surah) in (1, 9):
        return None
    import quran_assets
    try:
        entries = quran_assets.timings(Path(root), source, int(surah))
    except quran_assets.AssetError:
        return None
    return next((e for e in entries if e['index'] == 0 and e['end'] > e['start']), None)


def opening_text(root, settings):
    import ayah_data
    surah = int(settings.get('surah',1))
    return display_verse(root, surah, 1 if surah==1 else 0, ayah_data.verse_text(Path(root), 1, 1), settings)


def opening_card_seconds(root, source, surah, start=0):
    """Readable silent prelude only for recordings with a very short opening."""
    if float(start) > .01:
        return 0
    import quran_assets
    if not quran_assets.text_available(Path(root), source, surah):
        return 0
    entry = opening_entry(root, source, surah)
    return 3 if entry and 0 < entry['end']-entry['start'] < 1 else 0
