#!/usr/bin/env python3
"""Fresh-install preflight for Quran Reel Generator (RELEASE_AUDIT Phase 2).

Prints an actionable line per check and exits non-zero if any check fails.
Read-only: it never creates, moves or modifies a file.

Usage:
    .venv/bin/python scripts/preflight.py
    .venv/bin/python scripts/preflight.py --skip-data   # CI / source-only clone

The media checks (font, Quran text and timing datasets) fail on a source-only
clone by design. Copy your authorised media into Assets/ first, then rerun.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from importlib.metadata import PackageNotFoundError, version as package_version
from dataclasses import dataclass
from pathlib import Path

MIN_PYTHON = (3, 10)
ROOT = Path(__file__).resolve().parent.parent
DATA_CHECKS = {'font', 'text', 'timing'}


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str


def check_python() -> Check:
    found = sys.version_info[:2]
    ok = found >= MIN_PYTHON
    detail = (f'Python {".".join(map(str, found))} found; '
              f'{".".join(map(str, MIN_PYTHON))}+ required')
    if not ok:
        detail += '. Install a newer Python, recreate .venv, and rerun.'
    return Check('python', ok, detail)


def check_imports() -> list[Check]:
    results = []
    for name, package in (('flask', 'flask'), ('pillow', 'PIL')):
        try:
            __import__(package)
        except ImportError as exc:
            results.append(Check(
                name, False,
                f'{package} missing ({exc}). Run: pip install -r requirements.txt'
            ))
            continue
        try:
            version = package_version(name)
        except PackageNotFoundError:
            version = 'unknown'
        results.append(Check(name, True, f'{package} {version} available'))
    if 'PIL' in sys.modules:
        try:
            from PIL import features
            ok = bool(features.check('raqm'))
            results.append(Check(
                'raqm', ok,
                'Pillow RAQM support present' if ok else
                'Pillow lacks RAQM; Arabic shaping breaks silently. '
                'Install Pillow with RAQM (e.g. Homebrew FriBidi + HarfBuzz '
                'or a distro Pillow build) and rerun.'
            ))
        except Exception as exc:  # pragma: no cover - defensive
            results.append(Check('raqm', False, f'RAQM probe failed: {exc}'))
    return results


def check_binaries() -> Check:
    missing = [name for name in ('ffmpeg', 'ffprobe') if not shutil.which(name)]
    ok = not missing
    detail = ('ffmpeg and ffprobe found on PATH' if ok else
              'Missing ' + ', '.join(missing) +
              '. Install FFmpeg and ensure both binaries are on PATH.')
    return Check('binaries', ok, detail)


def check_layout(root: Path) -> Check:
    """A fresh source checkout has no runtime folders yet; that is not a failure.

    app.py creates Draft/, Output/previews/ and Output/reels/ on first start,
    so preflight stays read-only and still passes on a clean clone.
    """
    needed = ('Draft', 'Output/previews', 'Output/reels')
    missing = [name for name in needed if not (root / name).is_dir()]
    if not missing:
        return Check('layout', True, 'Runtime directories present')
    return Check('layout', True,
                 'Runtime directories not created yet (' + ', '.join(missing) +
                 '); app.py creates them on first start.')


def check_font(root: Path) -> Check:
    path = root / 'Assets/fonts/UthmanicHafs1Ver18.ttf'
    ok = path.is_file()
    detail = ('Font present' if ok else
              f'Font missing: {path}. Copy the licensed Uthmanic Hafs v18 TTF '
              'into Assets/fonts/ (media is not bundled).')
    return Check('font', ok, detail)


def check_text(root: Path) -> Check:
    base = root / 'Assets/Quran Text'
    try:
        chapters = json.loads((base / 'chapters.json').read_text(encoding='utf-8'))['chapters']
        uthmani = json.loads((base / 'uthmani.json').read_text(encoding='utf-8'))
        ok = len(chapters) == 114 and len(uthmani) >= 114
        detail = f'{len(chapters)} chapters, {len(uthmani)} text Surahs'
        if not ok:
            detail += '; expected 114 chapters and at least 114 text Surahs.'
    except (OSError, ValueError, KeyError) as exc:
        ok = False
        detail = f'Cannot read Quran text datasets under {base}: {exc}. ' \
                 'Copy authorised text data into Assets/Quran Text/.'
    return Check('text', ok, detail)


def check_timing(root: Path) -> Check:
    base = root / 'Assets/Quran Timing'
    files = list(base.glob('???.json')) if base.is_dir() else []
    ok = len(files) == 114
    detail = f'{len(files)} timing files; expected 114 (001.json–114.json).'
    if not ok:
        detail += ' Copy authorised timing data into Assets/Quran Timing/.'
    return Check('timing', ok, detail)


def run_checks(root: Path | str, include_data: bool = True) -> list[Check]:
    """Run every check against *root* and return the list of results."""
    root = Path(root)
    checks = [check_python(), *check_imports(), check_binaries(),
              check_layout(root)]
    if include_data:
        checks += [check_font(root), check_text(root), check_timing(root)]
    return checks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=str(ROOT),
                        help='project root (default: this script\'s parent)')
    parser.add_argument('--skip-data', action='store_true',
                        help='skip font/text/timing checks (source-only clone)')
    args = parser.parse_args(argv)

    checks = run_checks(args.root, include_data=not args.skip_data)
    for item in checks:
        print(f"[{'OK  ' if item.ok else 'FAIL'}] {item.name:9} {item.detail}")
    failed = [item.name for item in checks if not item.ok]
    if failed:
        print(f'\nPreflight FAILED: {", ".join(failed)}.')
        return 1
    print('\nPreflight OK.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
