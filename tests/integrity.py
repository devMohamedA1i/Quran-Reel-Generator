"""Read-only integrity check of the live project.

Confirms that the original media, the 610 reel drafts and the Output folder
are untouched, and that no temporary preview images pile up.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = Path(__file__).resolve().parent / 'draft-baseline'

problems = []


def check(name, ok, detail=''):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{' :: ' + detail if detail else ''}")
    if not ok:
        problems.append(name)


# ---- 1. the original media ------------------------------------------------
mp3s = sorted(ROOT.glob('Assets/audio/Al-Ajmi-114-Surahs/*/*.mp3'))
folders = sorted(p for p in (ROOT / 'Assets/audio/Al-Ajmi-114-Surahs').iterdir()
                 if p.is_dir())
check('114 Surah folders exist', len(folders) == 114, f'{len(folders)} folders')
check('114 master MP3s exist', len(mp3s) == 114, f'{len(mp3s)} mp3 files')

unreadable = []
durations = {}
for path in mp3s:
    try:
        out = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=nw=1:nk=1', str(path)],
            capture_output=True, text=True, timeout=30)
        value = float(out.stdout.strip())
        durations[path.name] = value
        if value <= 0:
            unreadable.append(path.name)
    except Exception as exc:
        unreadable.append(f'{path.name}: {exc}')
check('every MP3 is readable with a positive duration',
      not unreadable, '; '.join(unreadable[:3]))

# The work on this project started on 2026-11-11; the master recordings
# must still carry the timestamp they had before it.
SESSION_START = 1794418800   # 2026-11-11 14:00 local
newest = max((path.stat().st_mtime for path in mp3s), default=0)
check('no master recording was written to during the work',
      newest < SESSION_START,
      f'newest master timestamp {newest:.0f} (limit {SESSION_START})')

# ---- 2. the reel drafts ---------------------------------------------------
drafts = sorted(ROOT.glob('Draft/*/Reel_*.json'))
check('610 reel drafts exist', len(drafts) == 610, f'{len(drafts)} files')


def surah_folders():
    """Real Surah folders only; _sources holds a different recording's drafts."""
    return sorted(p for p in (ROOT / 'Draft').iterdir()
                  if p.is_dir() and p.name[:3].isdigit())


check('114 Draft folders exist', len(surah_folders()) == 114)

if BASELINE.is_dir():
    base = sorted(BASELINE.glob('Draft/*/Reel_*.json'))
    changed = []
    for path in base:
        live = ROOT / path.relative_to(BASELINE)
        if not live.is_file():
            changed.append(f'missing {live.name}')
        elif live.read_bytes() != path.read_bytes():
            changed.append(str(live.relative_to(ROOT)))
    check('every draft is byte-identical to the baseline', not changed,
          '; '.join(changed[:3]))
else:
    check('baseline snapshot available', False, str(BASELINE))

h = hashlib.sha256()
for path in drafts:
    h.update(str(path).encode())
    h.update(path.read_bytes())
print(f'      draft sha256: {h.hexdigest()[:32]}')

changed = []
for path in drafts:
    data = json.loads(path.read_text(encoding='utf-8'))
    # Artefacts that only the test suites can leave behind.
    settings = data.get('video_settings') or {}
    if settings.get('text_color', '').upper() == '#FF00FF':
        changed.append(f'{path.name} has the test colour')
    record = data.get('export') or {}
    if '.sandbox' in str(record.get('path', '')):
        changed.append(f'{path.name} points at the sandbox')
check('no draft carries test data', not changed, '; '.join(changed[:3]))

# ---- 4. continuity of every Surah ---------------------------------------
broken = []
for folder in surah_folders():
    reels = []
    for path in sorted(folder.glob('Reel_*.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        # A reel that a later Ayah aligned proposal put aside is no longer
        # part of the chain; its file is kept, its boundaries are not used.
        if data.get('superseded'):
            continue
        reels.append((path, data))
    if not reels:
        broken.append(f'{folder.name}: no reels')
        continue
    prev = None
    for path, data in reels:
        start, end = data['audio_start'], data['audio_end']
        if end <= start:
            broken.append(f'{folder.name}/{path.name}: empty range')
        if prev is not None and abs(prev - start) > 0.01:
            broken.append(f'{folder.name}/{path.name}: gap at {start}')
        prev = end
check('every Surah has continuous reel boundaries', not broken,
      '; '.join(broken[:3]))

# ---- 4b. the reels end on Ayah boundaries ------------------------------
sys.path.insert(0, str(ROOT))
import ayah_data

not_on_ayah = []
for folder in surah_folders():
    surah = int(folder.name[:3])
    entries = [e for e in ayah_data.ayah_timings(str(ROOT), surah) if e['index'] > 0]
    ends = [round(e['end'], 2) for e in entries]
    proposed = []
    for path in sorted(folder.glob('Reel_*.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        if data.get('superseded') or data.get('source') != 'ayah-boundary':
            continue
        proposed.append((path, data))
    for path, data in proposed:
        # The last Reel of a Surah reaches the end of the recording, which
        # can be a little after the last Ayah.
        if path is proposed[-1][0]:
            continue
        if round(float(data['audio_end']), 2) not in ends:
            not_on_ayah.append(f'{folder.name}/{path.name}')
check('every re-proposed reel ends on an Ayah boundary', not not_on_ayah,
      '; '.join(not_on_ayah[:3]))

# ---- 4. no temporary preview images -------------------------------------
previews = ROOT / 'Output' / 'previews'
images = [p for p in previews.glob('*') if p.suffix.lower() in
          {'.jpg', '.jpeg', '.png', '.gif', '.webp'}] if previews.is_dir() else []
check('no temporary preview image was left behind', not images,
      f'{len(images)} image(s) in Output/previews')

# ---- 5. the legacy plan file is preserved -------------------------------
plan = ROOT / 'Output' / 'plans' / '002.json'
check('the legacy plan file is preserved', plan.is_file(),
      f'{plan.stat().st_size} bytes' if plan.is_file() else 'missing')

print()
print('ALL INTEGRITY CHECKS PASSED' if not problems
      else f'PROBLEMS: {problems}')
sys.exit(1 if problems else 0)
