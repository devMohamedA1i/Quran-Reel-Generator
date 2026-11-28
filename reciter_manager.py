"""Ten-reciter setup catalog, MP3Quran downloader, and reciter-scoped verifier.

Manages the ten approved reciters for the progressive Quran Setup workflow:
  1. Choose Quran Reciter
  2. Download Quran Audio (real MP3Quran streaming download with byte progress)
  3. Verify Quran Files (folder, 114 Surahs, readability, text & timing checks)

All paths are resolved relative to the application root (or QVS_DATA_DIR if
configured). No personal machine paths are ever hardcoded, and existing user
data (including the legacy Al-Ajmi library and Draft/) is never overwritten.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import audio_sources
import ayah_data
import quran_assets

# Exact 10 reciters in the approved order.
TEN_RECITERS: list[dict[str, Any]] = [
    {
        'id': 'abdulbasit',
        'order': 1,
        'name': 'Sheikh Abdul Basit Abdul Samad',
        'name_ar': 'الشيخ عبد الباسط عبد الصمد',
        'country': 'Egypt',
        'country_ar': 'مصر',
        'years': '1927–1988',
        'years_ar': '١٩٢٧–١٩٨٨',
        'details': 'Egypt · 1927–1988',
        'details_ar': 'مصر · ١٩٢٧–١٩٨٨',
        'portrait': '/assets/reciters/abdulbasit.png',
        'folder_name': 'Abdul_Basit_Abdul_Samad',
        'edition': 'Almusshaf Al Mojawwad — Hafs \'an \'Asim (MP3Quran)',
        'edition_id': 'mp3quran-abdulbasit-mojawwad-r1',
        'mp3quran_reciter_id': 51,
        'mp3quran_read_id': 51,
        'mp3quran_server': 'https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r1/',
        'mp3quran_match': ['abdulbasit', 'abdul basit', 'basit'],
        'provider': 'MP3Quran',
        'provider_page': 'https://www.mp3quran.net/eng/basit',
        'timing_compatible': True,
    },
    {
        'id': 'husary',
        'order': 2,
        'name': 'Sheikh Mahmoud Khalil Al-Husary',
        'name_ar': 'الشيخ محمود خليل الحصري',
        'country': 'Egypt',
        'country_ar': 'مصر',
        'years': '1917–1980',
        'years_ar': '١٩١٧–١٩٨٠',
        'details': 'Egypt · 1917–1980',
        'details_ar': 'مصر · ١٩١٧–١٩٨٠',
        'portrait': '/assets/reciters/husary.png',
        'folder_name': 'Mahmoud_Khalil_Al_Husary',
        'edition': 'Murattal — Hafs \'an \'Asim (MP3Quran)',
        'edition_id': 'mp3quran-husary-murattal-r1',
        'mp3quran_reciter_id': 118,
        'mp3quran_read_id': 118,
        'mp3quran_server': 'https://cdn.mp3quran.net/audio/mahmoud-husary/r1/',
        'mp3quran_match': ['husary', 'hussary', 'al-husary'],
        'provider': 'MP3Quran',
        'provider_page': 'https://www.mp3quran.net/eng/husr',
        'timing_compatible': True,
    },
    {
        'id': 'minshawi',
        'order': 3,
        'name': 'Sheikh Mohamed Siddiq El-Minshawi',
        'name_ar': 'الشيخ محمد صديق المنشاوي',
        'country': 'Egypt',
        'country_ar': 'مصر',
        'years': '1920–1969',
        'years_ar': '١٩٢٠–١٩٦٩',
        'details': 'Egypt · 1920–1969',
        'details_ar': 'مصر · ١٩٢٠–١٩٦٩',
        'portrait': '/assets/reciters/minshawi.png',
        'folder_name': 'Mohamed_Siddiq_El_Minshawi',
        'edition': 'Murattal — Hafs \'an \'Asim (MP3Quran)',
        'edition_id': 'mp3quran-minshawi-murattal-r1',
        'mp3quran_reciter_id': 112,
        'mp3quran_read_id': 112,
        'mp3quran_server': 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/',
        'mp3quran_match': ['minshawi', 'minsh'],
        'provider': 'MP3Quran',
        'provider_page': 'https://www.mp3quran.net/eng/minsh',
        'timing_compatible': True,
    },
    {
        'id': 'afasy',
        'order': 4,
        'name': 'Sheikh Mishary Rashid Al-Afasy',
        'name_ar': 'الشيخ مشاري راشد العفاسي',
        'country': 'Kuwait',
        'country_ar': 'الكويت',
        'years': 'Born 1976',
        'years_ar': 'مواليد ١٩٧٦',
        'details': 'Kuwait · Born 1976',
        'details_ar': 'الكويت · مواليد ١٩٧٦',
        'portrait': '/assets/reciters/afasy.png',
        'folder_name': 'Mishary_Rashid_Al_Afasy',
        'edition': 'Murattal — Hafs \'an \'Asim (MP3Quran)',
        'edition_id': 'mp3quran-afasy-murattal-r1',
        'mp3quran_reciter_id': 123,
        'mp3quran_read_id': 123,
        'mp3quran_server': 'https://cdn.mp3quran.net/audio/mishary-alafasy/r1/',
        'mp3quran_match': ['afasy', 'alafasy', 'mishary'],
        'provider': 'MP3Quran',
        'provider_page': 'https://www.mp3quran.net/eng/afs',
        'timing_compatible': True,
    },
    {
        'id': 'sudais',
        'order': 5,
        'name': 'Sheikh Abdul Rahman Al-Sudais',
        'name_ar': 'الشيخ عبد الرحمن السديس',
        'country': 'Saudi Arabia',
        'country_ar': 'السعودية',
        'years': 'Born 1962',
        'years_ar': 'مواليد ١٩٦٢',
        'details': 'Saudi Arabia · Born 1962',
        'details_ar': 'السعودية · مواليد ١٩٦٢',
        'portrait': '/assets/reciters/sudais.png',
        'folder_name': 'Abdul_Rahman_Al_Sudais',
        'edition': 'Murattal — Hafs \'an \'Asim (MP3Quran)',
        'edition_id': 'mp3quran-sudais-murattal-r1',
        'mp3quran_reciter_id': 54,
        'mp3quran_read_id': 54,
        'mp3quran_server': 'https://cdn.mp3quran.net/audio/abdulrahman-sudais/r1/',
        'mp3quran_match': ['sudais', 'alsudais'],
        'provider': 'MP3Quran',
        'provider_page': 'https://www.mp3quran.net/eng/sds',
        'timing_compatible': True,
    },
    {
        'id': 'shuraim',
        'order': 6,
        'name': 'Sheikh Saud Al-Shuraim',
        'name_ar': 'الشيخ سعود الشريم',
        'country': 'Saudi Arabia',
        'country_ar': 'السعودية',
        'years': 'Born 1966',
        'years_ar': 'مواليد ١٩٦٦',
        'details': 'Saudi Arabia · Born 1966',
        'details_ar': 'السعودية · مواليد ١٩٦٦',
        'portrait': '/assets/reciters/shuraim.png',
        'folder_name': 'Saud_Al_Shuraim',
        'edition': 'Murattal — Hafs \'an \'Asim (MP3Quran)',
        'edition_id': 'mp3quran-shuraim-murattal-r1',
        'mp3quran_reciter_id': 31,
        'mp3quran_read_id': 31,
        'mp3quran_server': 'https://cdn.mp3quran.net/audio/saud-shuraim/r1/',
        'mp3quran_match': ['shuraim', 'shur'],
        'provider': 'MP3Quran',
        'provider_page': 'https://www.mp3quran.net/eng/shur',
        'timing_compatible': True,
    },
    {
        'id': 'muaiqly',
        'order': 7,
        'name': 'Sheikh Maher Al-Muaiqly',
        'name_ar': 'الشيخ ماهر المعيقلي',
        'country': 'Saudi Arabia',
        'country_ar': 'السعودية',
        'years': 'Born 1969',
        'years_ar': 'مواليد ١٩٦٩',
        'details': 'Saudi Arabia · Born 1969',
        'details_ar': 'السعودية · مواليد ١٩٦٩',
        'portrait': '/assets/reciters/muaiqly.png',
        'folder_name': 'Maher_Al_Muaiqly',
        'edition': 'Almusshaf Al Mojawwad — Hafs \'an \'Asim (MP3Quran)',
        'edition_id': 'mp3quran-muaiqly-mojawwad-r3',
        'mp3quran_reciter_id': 102,
        'mp3quran_read_id': 133,
        'mp3quran_server': 'https://cdn.mp3quran.net/audio/maher-muaiqly/r3/',
        'mp3quran_match': ['muaiqly', 'maher'],
        'provider': 'MP3Quran',
        'provider_page': 'https://www.mp3quran.net/eng/maher',
        'timing_compatible': True,
    },
    {
        'id': 'ghamdi',
        'order': 8,
        'name': 'Sheikh Saad Al-Ghamdi',
        'name_ar': 'الشيخ سعد الغامدي',
        'country': 'Saudi Arabia',
        'country_ar': 'السعودية',
        'years': 'Born 1967',
        'years_ar': 'مواليد ١٩٦٧',
        'details': 'Saudi Arabia · Born 1967',
        'details_ar': 'السعودية · مواليد ١٩٦٧',
        'portrait': '/assets/reciters/ghamdi.png',
        'folder_name': 'Saad_Al_Ghamdi',
        'edition': 'Murattal — Hafs \'an \'Asim (MP3Quran)',
        'edition_id': 'mp3quran-ghamdi-murattal-r1',
        'mp3quran_reciter_id': 30,
        'mp3quran_read_id': 30,
        'mp3quran_server': 'https://cdn.mp3quran.net/audio/saad-ghamdi/r1/',
        'mp3quran_match': ['ghamdi', 's_gmd'],
        'provider': 'MP3Quran',
        'provider_page': 'https://www.mp3quran.net/eng/s_gmd',
        'timing_compatible': True,
    },
    {
        'id': 'ajmi',
        'order': 9,
        'name': 'Sheikh Ahmad Al-Ajmi',
        'name_ar': 'الشيخ أحمد العجمي',
        'country': 'Saudi Arabia',
        'country_ar': 'السعودية',
        'years': 'Born 1968',
        'years_ar': 'مواليد ١٩٦٨',
        'details': 'Saudi Arabia · Born 1968',
        'details_ar': 'السعودية · مواليد ١٩٦٨',
        'portrait': '/assets/reciters/ajmi.png',
        'folder_name': 'Ahmad_Al_Ajmi',
        'legacy_folder_name': 'Al-Ajmi-114-Surahs',
        'edition': 'Murattal — Hafs \'an \'Asim (MP3Quran)',
        'edition_id': 'mp3quran-ajmi-murattal-r1',
        'mp3quran_reciter_id': 5,
        'mp3quran_read_id': 5,
        'mp3quran_server': 'https://cdn.mp3quran.net/audio/ahmad-ajmi/r1/',
        'mp3quran_match': ['ajmi', 'ajm'],
        'provider': 'MP3Quran',
        'provider_page': 'https://www.mp3quran.net/eng/ajm',
        'timing_compatible': True,
    },
    {
        'id': 'dosari',
        'order': 10,
        'name': 'Sheikh Yasser Al-Dosari',
        'name_ar': 'الشيخ ياسر الدوسري',
        'country': 'Saudi Arabia',
        'country_ar': 'السعودية',
        'years': 'Born 1980',
        'years_ar': 'مواليد ١٩٨٠',
        'details': 'Saudi Arabia · Born 1980',
        'details_ar': 'السعودية · مواليد ١٩٨٠',
        'portrait': '/assets/reciters/dosari.png',
        'folder_name': 'Yasser_Al_Dosari',
        'edition': 'Murattal — Hafs \'an \'Asim (MP3Quran)',
        'edition_id': 'mp3quran-dosari-murattal-r1',
        'mp3quran_reciter_id': 92,
        'mp3quran_read_id': 92,
        'mp3quran_server': 'https://cdn.mp3quran.net/audio/yasser-dosari/r1/',
        'mp3quran_match': ['dosari', 'yasser'],
        'provider': 'MP3Quran',
        'provider_page': 'https://www.mp3quran.net/eng/yasser',
        'timing_compatible': True,
    },
]

_RECITERS_BY_ID: dict[str, dict[str, Any]] = {r['id']: r for r in TEN_RECITERS}

_DOWNLOAD_LOCK = threading.RLock()
_DOWNLOADS: dict[str, dict[str, Any]] = {}


def get_reciter(reciter_id: str) -> dict[str, Any] | None:
    return _RECITERS_BY_ID.get(reciter_id)


def _custom_audio_dir_file(root: Path) -> Path:
    return root / '.audio_dir.json'


def set_custom_audio_dir(root: Path, folder: Path | str | None) -> Path:
    """Persist a user-selected Quran audio directory inside the workspace."""
    cfg = _custom_audio_dir_file(root)
    if not folder:
        if cfg.exists():
            cfg.unlink()
        return (root / 'Assets' / 'audio').resolve()
    resolved = Path(folder).expanduser().resolve()
    if not resolved.is_dir():
        raise ValueError(f'Folder does not exist: {resolved}')
    cfg.write_text(json.dumps({'audio_dir': str(resolved)}, indent=2), encoding='utf-8')
    return resolved


def audio_base_dir(root: Path) -> Path:
    """Configured local data directory for Quran audio (never hardcoded)."""
    override = os.getenv('QVS_AUDIO_DIR', '').strip()
    if override:
        return Path(override).expanduser().resolve()
    cfg = _custom_audio_dir_file(root)
    if cfg.is_file():
        try:
            saved = str(json.loads(cfg.read_text(encoding='utf-8')).get('audio_dir') or '').strip()
            if saved:
                candidate = Path(saved).expanduser().resolve()
                if candidate.is_dir():
                    return candidate
        except Exception:
            pass
    return (root / 'Assets' / 'audio').resolve()


def reciter_audio_dir(root: Path, reciter_id: str) -> tuple[Path, bool]:
    """Return (expected_dir, is_legacy_ajmi) for a reciter.

    For Sheikh Ahmad Al-Ajmi, if the pre-existing legacy folder
    `Assets/audio/Al-Ajmi-114-Surahs` exists on disk, we preserve and use it
    without moving or duplicating any files.
    """
    reciter = get_reciter(reciter_id)
    if not reciter:
        raise ValueError(f'Unknown reciter: {reciter_id}')
    base = audio_base_dir(root)
    # If the user selected a specific reciter folder directly, recognise it cleanly
    if base.name == reciter['folder_name']:
        return base, False
    legacy_name = reciter.get('legacy_folder_name')
    if legacy_name:
        if base.name == legacy_name:
            return base, True
        legacy_path = base / legacy_name
        if legacy_path.is_dir():
            return legacy_path, True
    candidate = base / reciter['folder_name']
    # If a user-selected custom folder doesn't contain this reciter yet (and QVS_AUDIO_DIR wasn't forced),
    # fall back to workspace starter audio if present
    default_base = (root / 'Assets' / 'audio').resolve()
    if not os.getenv('QVS_AUDIO_DIR', '').strip() and not candidate.is_dir() and base != default_base:
        if legacy_name and (default_base / legacy_name).is_dir():
            return default_base / legacy_name, True
        if (default_base / reciter['folder_name']).is_dir():
            return default_base / reciter['folder_name'], False
    return candidate, False


def display_relative_path(root: Path, target: Path) -> str:
    """Human-readable relative path when inside project root, else compact path."""
    try:
        rel = target.resolve().relative_to(root.resolve())
        return ' / '.join(rel.parts)
    except ValueError:
        return str(target)


def _is_valid_mp3(path: Path) -> bool:
    """Check that an MP3 file exists, is non-empty, and has a valid header."""
    try:
        if not path.is_file():
            return False
        size = path.stat().st_size
        if size < 1024:
            return False
        with path.open('rb') as f:
            head = f.read(16)
        if not head:
            return False
        # ID3 tag or MPEG frame sync (0xFF 0xE0..0xFF)
        if head[:3] == b'ID3':
            return True
        if len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
            return True
        # Some MP3s have leading zero padding before sync
        with path.open('rb') as f:
            chunk = f.read(4096)
        return b'ID3' in chunk[:256] or any(
            chunk[i] == 0xFF and (chunk[i + 1] & 0xE0) == 0xE0
            for i in range(len(chunk) - 1)
        )
    except OSError:
        return False


def _scan_reciter_surahs(folder: Path) -> tuple[dict[int, Path], list[str]]:
    """Map Surah numbers (1..114) to MP3 files inside `folder`.

    Supports both flat (`001.mp3`..`114.mp3`) and subfolder
    (`001 - Al-Fatihah/*.mp3`) layouts.
    """
    found: dict[int, Path] = {}
    unreadable: list[str] = []
    if not folder.is_dir():
        return found, unreadable

    for entry in sorted(folder.rglob('*')):
        if not entry.is_file() or entry.suffix.lower() != '.mp3':
            continue
        if entry.name.startswith('.') or entry.name.endswith('.part'):
            continue
        # Extract 1..114 from filename stem or immediate parent folder
        surah = audio_sources._number_from_label(entry.stem)
        if surah is None and entry.parent != folder:
            surah = audio_sources._number_from_label(entry.parent.name)
        if surah is None:
            continue
        if not _is_valid_mp3(entry):
            unreadable.append(entry.name)
            continue
        found.setdefault(surah, entry)
    return found, unreadable


def _check_quran_text(root: Path) -> dict[str, Any]:
    """Verify Quran text availability and structural integrity."""
    text_dir = root / 'Assets' / 'Quran Text'
    chapters_path = text_dir / 'chapters.json'
    uthmani_path = text_dir / 'uthmani.json'
    if not chapters_path.is_file() or not uthmani_path.is_file():
        return {
            'available': False,
            'valid': False,
            'message': 'Quran text dataset not found in Assets/Quran Text/.',
        }
    try:
        chapters = json.loads(chapters_path.read_text(encoding='utf-8')).get('chapters', [])
        uthmani = json.loads(uthmani_path.read_text(encoding='utf-8'))
        verse_count = sum(len(v) for v in uthmani.values()) if isinstance(uthmani, dict) else 0
        ok = len(chapters) == 114 and verse_count == 6236
        return {
            'available': True,
            'valid': ok,
            'chapters': len(chapters),
            'verses': verse_count,
            'message': (
                'Uthmani Quran text verified (114 Surahs, 6,236 Ayahs).'
                if ok else
                f'Quran text incomplete ({len(chapters)} chapters, {verse_count} verses).'
            ),
        }
    except Exception as exc:
        return {
            'available': False,
            'valid': False,
            'message': f'Quran text dataset could not be read: {exc}',
        }


def _check_quran_timings(root: Path, reciter: dict[str, Any], is_legacy: bool,
                         source_id: str | None) -> dict[str, Any]:
    """Check Ayah timing availability and edition compatibility."""
    if is_legacy and reciter.get('timing_compatible'):
        timing_dir = root / 'Assets' / 'Quran Timing'
        files = sorted(timing_dir.glob('???.json')) if timing_dir.is_dir() else []
        if len(files) == 114:
            return {
                'available': True,
                'compatible': True,
                'count': 114,
                'message': 'Ayah timings verified (114 Surahs, compatible edition).',
            }
        return {
            'available': len(files) > 0,
            'compatible': False,
            'count': len(files),
            'message': f'Ayah timing files incomplete ({len(files)}/114). Audio-only mode available.',
        }
    # Check reciter-scoped timing directory under Assets/Quran Timing/reciters/<folder_name>
    reciter_timing_dir = root / 'Assets' / 'Quran Timing' / 'reciters' / reciter['folder_name']
    if reciter_timing_dir.is_dir():
        files = sorted(reciter_timing_dir.glob('???.json'))
        if len(files) == 114:
            return {
                'available': True,
                'compatible': True,
                'count': 114,
                'path': str(reciter_timing_dir),
                'message': f'Ayah timings verified (114 Surahs, MP3Quran read {reciter.get("mp3quran_read_id")}).',
            }
    # For other reciters, check if source-scoped timing was attached
    if source_id:
        try:
            st = quran_assets.status(root, source_id)
            if st.get('timing', {}).get('loaded'):
                return {
                    'available': True,
                    'compatible': True,
                    'count': st['timing'].get('surahs', 0),
                    'message': 'Source-scoped Ayah timings attached.',
                }
        except Exception:
            pass
    return {
        'available': False,
        'compatible': False,
        'count': 0,
        'message': 'Ayah timing dataset is not installed yet; audio-only workflow is active.',
    }


def list_setup_reciters(root: Path) -> list[dict[str, Any]]:
    """Return the exact 10 reciters with current local installation status."""
    result = []
    for reciter in TEN_RECITERS:
        folder, is_legacy = reciter_audio_dir(root, reciter['id'])
        found, unreadable = _scan_reciter_surahs(folder)
        with _DOWNLOAD_LOCK:
            dl = dict(_DOWNLOADS.get(reciter['id']) or {})
        count = len(found)
        installed = count == 114 and not unreadable
        result.append({
            **reciter,
            'save_dir': str(folder),
            'display_path': display_relative_path(root, folder),
            'is_legacy': is_legacy,
            'downloaded_count': count,
            'total_surahs': 114,
            'installed': installed,
            'download_state': dl.get('state', 'completed' if installed else 'idle'),
            'download': dl if dl else None,
        })
    return result


def verify_reciter(root: Path, reciter_id: str, activate: bool = True) -> dict[str, Any]:
    """Verify a reciter's local audio folder, text, timings, and source state."""
    reciter = get_reciter(reciter_id)
    if not reciter:
        raise ValueError(f'Unknown reciter: {reciter_id}')

    folder, is_legacy = reciter_audio_dir(root, reciter_id)
    display_path = display_relative_path(root, folder)
    text_info = _check_quran_text(root)

    if not folder.is_dir():
        return {
            'reciter_id': reciter_id,
            'reciter_name': reciter['name'],
            'status': 'not_found',
            'verified': False,
            'expected_path': display_path,
            'absolute_path': str(folder),
            'found_surahs': 0,
            'missing_surahs': list(range(1, 115)),
            'unreadable_files': [],
            'text': text_info,
            'timings': _check_quran_timings(root, reciter, is_legacy, None),
            'source_id': None,
            'message': f'Please move the downloaded Quran folder to: {display_path}',
        }

    # Check edition metadata if written by downloader
    meta_path = folder / '.reciter_meta.json'
    edition_mismatch = None
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding='utf-8'))
            if meta.get('reciter_id') and meta['reciter_id'] != reciter_id:
                edition_mismatch = (
                    f"Folder metadata belongs to {meta.get('reciter_name', meta['reciter_id'])}, "
                    f"not {reciter['name']}."
                )
        except Exception:
            pass

    found, unreadable = _scan_reciter_surahs(folder)
    missing = [s for s in range(1, 115) if s not in found]

    if not found and not unreadable:
        return {
            'reciter_id': reciter_id,
            'reciter_name': reciter['name'],
            'status': 'not_found',
            'verified': False,
            'expected_path': display_path,
            'absolute_path': str(folder),
            'found_surahs': 0,
            'missing_surahs': missing,
            'unreadable_files': [],
            'text': text_info,
            'timings': _check_quran_timings(root, reciter, is_legacy, None),
            'source_id': None,
            'message': f'Please move the downloaded Quran folder to: {display_path}',
        }

    if edition_mismatch:
        return {
            'reciter_id': reciter_id,
            'reciter_name': reciter['name'],
            'status': 'invalid',
            'verified': False,
            'expected_path': display_path,
            'absolute_path': str(folder),
            'found_surahs': len(found),
            'missing_surahs': missing,
            'unreadable_files': unreadable,
            'text': text_info,
            'timings': _check_quran_timings(root, reciter, is_legacy, None),
            'source_id': None,
            'message': edition_mismatch,
        }

    def _activate_source():
        sid, spub = None, None
        if activate:
            src = audio_sources.register_legacy(root) if is_legacy else audio_sources.scan(root, str(folder))
            if src:
                sid = src['id']
                spub = audio_sources.public(src)
                if not is_legacy:
                    text_dir = root / 'Assets' / 'Quran Text'
                    if text_dir.is_dir():
                        try:
                            quran_assets.load_text(root, sid, text_dir)
                        except Exception:
                            pass
                    reciter_timing_dir = root / 'Assets' / 'Quran Timing' / 'reciters' / reciter['folder_name']
                    if reciter_timing_dir.is_dir():
                        try:
                            quran_assets.load_timing(root, sid, reciter_timing_dir)
                        except Exception:
                            pass
        return sid, spub

    if unreadable or missing:
        parts = []
        parts.append(f'Found {len(found)} of 114 valid Surah MP3 files.')
        if missing:
            preview = ', '.join(f'{s:03d}' for s in missing[:8])
            suffix = f' (+{len(missing) - 8} more)' if len(missing) > 8 else ''
            parts.append(f'Missing {len(missing)} Surahs: {preview}{suffix}.')
        if unreadable:
            parts.append(f'{len(unreadable)} unreadable or corrupted file(s): {", ".join(unreadable[:4])}.')
        # If valid starter/sample Surah(s) exist (e.g. bundled Al-Fatihah), still activate
        # the reciter source so the user can try playing & exporting right away!
        source_id, source_public = _activate_source() if (not unreadable and len(found) > 0) else (None, None)
        return {
            'reciter_id': reciter_id,
            'reciter_name': reciter['name'],
            'status': 'incomplete' if not unreadable else 'invalid',
            'verified': False,
            'expected_path': display_path,
            'absolute_path': str(folder),
            'found_surahs': len(found),
            'missing_surahs': missing,
            'unreadable_files': unreadable,
            'text': text_info,
            'timings': _check_quran_timings(root, reciter, is_legacy, source_id),
            'source_id': source_id,
            'source': source_public,
            'message': ' '.join(parts),
        }

    # All 114 Surahs valid! Activate source in audio_sources so the rest of the app
    # uses this reciter's isolated drafts/exports, and attach shared Quran text +
    # reciter-specific Ayah timings automatically when present.
    source_id, source_public = _activate_source()

    timings_info = _check_quran_timings(root, reciter, is_legacy, source_id)
    return {
        'reciter_id': reciter_id,
        'reciter_name': reciter['name'],
        'status': 'verified',
        'verified': True,
        'expected_path': display_path,
        'absolute_path': str(folder),
        'found_surahs': 114,
        'missing_surahs': [],
        'unreadable_files': [],
        'text': text_info,
        'timings': timings_info,
        'source_id': source_id,
        'source': source_public,
        'message': f'Quran audio found in: {display_path}',
    }


def _resolve_server_url(reciter: dict[str, Any]) -> str:
    """Return the verified MP3Quran server URL for the reciter."""
    base = reciter['mp3quran_server'].rstrip('/') + '/'
    return base


def get_download_status(root: Path, reciter_id: str) -> dict[str, Any]:
    """Return real-time download progress for a reciter."""
    reciter = get_reciter(reciter_id)
    if not reciter:
        raise ValueError(f'Unknown reciter: {reciter_id}')
    folder, _ = reciter_audio_dir(root, reciter_id)
    display_path = display_relative_path(root, folder)
    with _DOWNLOAD_LOCK:
        state = _DOWNLOADS.get(reciter_id)
        if state:
            return dict(state)
    found, unreadable = _scan_reciter_surahs(folder)
    if len(found) == 114 and not unreadable:
        return {
            'reciter_id': reciter_id,
            'state': 'completed',
            'current_surah': 114,
            'completed_surahs': 114,
            'total_surahs': 114,
            'current_bytes': 0,
            'current_total_bytes': 0,
            'percent': 100,
            'display_path': display_path,
            'error': None,
        }
    return {
        'reciter_id': reciter_id,
        'state': 'idle',
        'current_surah': 0,
        'completed_surahs': len(found),
        'total_surahs': 114,
        'current_bytes': 0,
        'current_total_bytes': 0,
        'percent': int((len(found) / 114) * 100),
        'display_path': display_path,
        'error': None,
    }


def start_download(root: Path, reciter_id: str) -> dict[str, Any]:
    """Start (or resume) a real MP3Quran download of all 114 Surahs."""
    reciter = get_reciter(reciter_id)
    if not reciter:
        raise ValueError(f'Unknown reciter: {reciter_id}')

    folder, is_legacy = reciter_audio_dir(root, reciter_id)
    display_path = display_relative_path(root, folder)

    with _DOWNLOAD_LOCK:
        existing = _DOWNLOADS.get(reciter_id)
        if existing and existing.get('state') == 'downloading':
            return dict(existing)

        found, unreadable = _scan_reciter_surahs(folder)
        if len(found) == 114 and not unreadable:
            done_state = {
                'reciter_id': reciter_id,
                'state': 'completed',
                'current_surah': 114,
                'completed_surahs': 114,
                'total_surahs': 114,
                'current_bytes': 0,
                'current_total_bytes': 0,
                'percent': 100,
                'display_path': display_path,
                'error': None,
            }
            _DOWNLOADS[reciter_id] = done_state
            return dict(done_state)

        state = {
            'reciter_id': reciter_id,
            'state': 'downloading',
            'current_surah': len(found) + 1,
            'completed_surahs': len(found),
            'total_surahs': 114,
            'current_bytes': 0,
            'current_total_bytes': 0,
            'percent': int((len(found) / 114) * 100),
            'display_path': display_path,
            'error': None,
            'cancelled': False,
        }
        _DOWNLOADS[reciter_id] = state

    def _worker() -> None:
        try:
            folder.mkdir(parents=True, exist_ok=True)
            # Write edition metadata (never inside legacy pre-existing folder)
            if not is_legacy:
                meta_path = folder / '.reciter_meta.json'
                if not meta_path.exists():
                    meta_path.write_text(json.dumps({
                        'reciter_id': reciter['id'],
                        'reciter_name': reciter['name'],
                        'edition_id': reciter['edition_id'],
                        'provider': reciter['provider'],
                        'server': reciter['mp3quran_server'],
                    }, indent=2), encoding='utf-8')

            server = _resolve_server_url(reciter)
            already_valid, _ = _scan_reciter_surahs(folder)
            completed = len(already_valid)

            for surah in range(1, 115):
                with _DOWNLOAD_LOCK:
                    if _DOWNLOADS.get(reciter_id, {}).get('cancelled'):
                        _DOWNLOADS[reciter_id]['state'] = 'cancelled'
                        return

                if surah in already_valid:
                    continue

                filename = f'{surah:03d}.mp3'
                target = folder / filename
                part = folder / f'{filename}.part'
                url = f'{server}{filename}'

                with _DOWNLOAD_LOCK:
                    _DOWNLOADS[reciter_id].update(
                        current_surah=surah,
                        completed_surahs=completed,
                        current_bytes=0,
                        current_total_bytes=0,
                        percent=min(99, int((completed / 114) * 100)),
                    )

                req = urllib.request.Request(
                    url,
                    headers={'User-Agent': 'QuranReelGenerator/1.0 (+local-studio)'},
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    total_header = resp.headers.get('Content-Length')
                    total_bytes = int(total_header) if total_header and total_header.isdigit() else 0
                    downloaded = 0
                    with part.open('wb') as out:
                        while True:
                            with _DOWNLOAD_LOCK:
                                if _DOWNLOADS.get(reciter_id, {}).get('cancelled'):
                                    _DOWNLOADS[reciter_id]['state'] = 'cancelled'
                                    return
                            chunk = resp.read(65536)
                            if not chunk:
                                break
                            out.write(chunk)
                            downloaded += len(chunk)
                            frac = (downloaded / total_bytes) if total_bytes > 0 else 0.0
                            overall = int(((completed + frac) / 114) * 100)
                            with _DOWNLOAD_LOCK:
                                _DOWNLOADS[reciter_id].update(
                                    current_bytes=downloaded,
                                    current_total_bytes=total_bytes or downloaded,
                                    percent=min(99, overall),
                                )

                if not _is_valid_mp3(part):
                    try:
                        part.unlink(missing_ok=True)
                    except OSError:
                        pass
                    raise RuntimeError(f'Downloaded Surah {surah:03d} failed MP3 validation.')

                part.replace(target)
                completed += 1
                with _DOWNLOAD_LOCK:
                    _DOWNLOADS[reciter_id].update(
                        completed_surahs=completed,
                        percent=min(99, int((completed / 114) * 100)),
                    )

            # Final validation check
            final_found, final_bad = _scan_reciter_surahs(folder)
            if len(final_found) == 114 and not final_bad:
                with _DOWNLOAD_LOCK:
                    _DOWNLOADS[reciter_id].update(
                        state='completed',
                        current_surah=114,
                        completed_surahs=114,
                        percent=100,
                        error=None,
                    )
            else:
                with _DOWNLOAD_LOCK:
                    _DOWNLOADS[reciter_id].update(
                        state='error',
                        error=f'Download finished with {len(final_found)}/114 valid Surahs.',
                    )
        except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as exc:
            with _DOWNLOAD_LOCK:
                _DOWNLOADS[reciter_id].update(
                    state='error',
                    error=f'Download interrupted: {exc}',
                )

    threading.Thread(target=_worker, daemon=True).start()
    with _DOWNLOAD_LOCK:
        return dict(_DOWNLOADS[reciter_id])


def cancel_download(reciter_id: str) -> dict[str, Any]:
    with _DOWNLOAD_LOCK:
        if reciter_id in _DOWNLOADS:
            _DOWNLOADS[reciter_id]['cancelled'] = True
            if _DOWNLOADS[reciter_id].get('state') == 'downloading':
                _DOWNLOADS[reciter_id]['state'] = 'cancelled'
            return dict(_DOWNLOADS[reciter_id])
    return {'reciter_id': reciter_id, 'state': 'idle'}
