"""Two-stage resumable downloader for the 10-reciter MP3Quran dataset.

Stage 1: Verify shared Quran font & text (no duplicates) and download + validate
         114 Ayah timing JSONs for the 9 additional reciters into:
           Assets/Quran Timing/reciters/<Reciter_Folder>/001.json..114.json

Stage 2: Download + validate 114 MP3 audio files for the 9 additional reciters into:
           Assets/audio/<Reciter_Folder>/001.mp3..114.mp3

Existing Al-Ajmi audio (Assets/audio/Al-Ajmi-114-Surahs/) and timings
(Assets/Quran Timing/001.json..114.json) are never touched or overwritten.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import reciter_manager  # noqa: E402

UA = 'QuranReelGenerator/1.0 (+local-studio)'


def _fetch_bytes(url: str, retries: int = 3, timeout: int = 45) -> bytes:
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:
            last_err = exc
            if attempt < retries:
                time.sleep(1.5 * attempt)
    raise RuntimeError(f'Failed {url}: {last_err}')


def _download_mp3_file(url: str, target: Path, retries: int = 3) -> int:
    if target.is_file() and reciter_manager._is_valid_mp3(target):
        return target.stat().st_size
    part = target.with_suffix('.mp3.part')
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as resp:
                with part.open('wb') as out:
                    while True:
                        chunk = resp.read(131072)
                        if not chunk:
                            break
                        out.write(chunk)
            if not reciter_manager._is_valid_mp3(part):
                part.unlink(missing_ok=True)
                raise RuntimeError(f'Invalid MP3 header for {target.name}')
            part.replace(target)
            return target.stat().st_size
        except Exception as exc:
            last_err = exc
            part.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(2.0 * attempt)
    raise RuntimeError(f'Failed {url}: {last_err}')


def run_stage1(workers: int = 8) -> None:
    print('=== STAGE 1: Font, Shared Text & Ayah Timing JSONs ===', flush=True)
    font = ROOT / 'Assets' / 'fonts' / 'UthmanicHafs1Ver18.ttf'
    text_info = reciter_manager._check_quran_text(ROOT)
    print(f'Font: {"OK" if font.is_file() else "MISSING"} ({font.name})', flush=True)
    print(f'Text: {"OK" if text_info["valid"] else "MISSING"} — {text_info["message"]}', flush=True)

    ajmi_timings = sorted((ROOT / 'Assets' / 'Quran Timing').glob('???.json'))
    print(f'Al-Ajmi (existing): {len(ajmi_timings)}/114 timing JSONs preserved untouched.', flush=True)

    for rec in reciter_manager.TEN_RECITERS:
        if rec['id'] == 'ajmi':
            continue
        read_id = rec['mp3quran_read_id']
        dest = ROOT / 'Assets' / 'Quran Timing' / 'reciters' / rec['folder_name']
        dest.mkdir(parents=True, exist_ok=True)
        meta_path = dest / '.timing_meta.json'
        meta_path.write_text(json.dumps({
            'reciter_id': rec['id'],
            'reciter_name': rec['name'],
            'edition_id': rec['edition_id'],
            'mp3quran_reciter_id': rec['mp3quran_reciter_id'],
            'mp3quran_read_id': read_id,
            'mp3quran_server': rec['mp3quran_server'],
            'endpoint': f'https://www.mp3quran.net/api/v3/ayat_timing?surah={{surah}}&read={read_id}',
        }, indent=2), encoding='utf-8')

        def _one_surah(s: int) -> tuple[int, bool, bool]:
            out_path = dest / f'{s:03d}.json'
            if out_path.is_file() and out_path.stat().st_size > 10:
                rows = json.loads(out_path.read_text(encoding='utf-8'))
                return s, isinstance(rows, list) and len(rows) > 0, bool(rows and rows[0].get('ayah') == 0)
            url = f'https://www.mp3quran.net/api/v3/ayat_timing?surah={s}&read={read_id}'
            raw = _fetch_bytes(url)
            rows = json.loads(raw.decode('utf-8'))
            if not isinstance(rows, list) or not rows:
                raise RuntimeError(f'Empty timing list for {rec["id"]} surah {s}')
            out_path.write_bytes(raw)
            return s, True, bool(rows[0].get('ayah') == 0)

        ok_count = 0
        ayah0_count = 0
        errors = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(_one_surah, s) for s in range(1, 115)]
            for fut in concurrent.futures.as_completed(futs):
                try:
                    _, ok, has0 = fut.result()
                    if ok:
                        ok_count += 1
                    if has0:
                        ayah0_count += 1
                except Exception as exc:
                    errors.append(str(exc))

        print(
            f'  {rec["name"]:38} | read={read_id:3} | {ok_count}/114 JSONs | ayah0_surahs={ayah0_count} | errors={len(errors)}',
            flush=True,
        )
        if errors:
            for err in errors[:3]:
                print(f'    ERR: {err}', flush=True)


def run_stage2(workers: int = 6) -> None:
    print('\n=== STAGE 2: Complete 114-Surah MP3 Audio (9 Reciters) ===', flush=True)
    print('Al-Ajmi (existing): Assets/audio/Al-Ajmi-114-Surahs/ preserved untouched.', flush=True)

    for rec in reciter_manager.TEN_RECITERS:
        if rec['id'] == 'ajmi':
            continue
        dest = ROOT / 'Assets' / 'audio' / rec['folder_name']
        dest.mkdir(parents=True, exist_ok=True)
        meta_path = dest / '.reciter_meta.json'
        meta_path.write_text(json.dumps({
            'reciter_id': rec['id'],
            'reciter_name': rec['name'],
            'edition_id': rec['edition_id'],
            'mp3quran_reciter_id': rec['mp3quran_reciter_id'],
            'mp3quran_read_id': rec['mp3quran_read_id'],
            'provider': rec['provider'],
            'server': rec['mp3quran_server'],
        }, indent=2), encoding='utf-8')

        server = rec['mp3quran_server'].rstrip('/') + '/'
        t0 = time.time()
        ok_count = 0
        total_bytes = 0
        errors = []

        def _one_mp3(s: int) -> int:
            fname = f'{s:03d}.mp3'
            return _download_mp3_file(server + fname, dest / fname)

        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(_one_mp3, s): s for s in range(1, 115)}
            for fut in concurrent.futures.as_completed(futs):
                s = futs[fut]
                try:
                    sz = fut.result()
                    ok_count += 1
                    total_bytes += sz
                except Exception as exc:
                    errors.append(f'S{s:03d}: {exc}')

        elapsed = time.time() - t0
        mb = total_bytes / (1024 * 1024)
        print(
            f'  {rec["name"]:38} | {ok_count}/114 MP3s | {mb:7.1f} MB | {elapsed:5.1f}s | errors={len(errors)}',
            flush=True,
        )
        if errors:
            for err in errors[:3]:
                print(f'    ERR: {err}', flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage', choices=('1', '2', 'all'), default='all')
    args = parser.parse_args()
    if args.stage in ('1', 'all'):
        run_stage1()
    if args.stage in ('2', 'all'):
        run_stage2()


if __name__ == '__main__':
    main()
