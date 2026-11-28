"""Inter-ayah pause detection.

A pause is ONLY the silence between the end of one ayah and the start of the
next. Silences inside an ayah are never reported. For every ayah boundary we
look at the audio around it and pick the silent run that contains (or sits
right next to) that boundary.
"""
from array import array
import math
import subprocess

RATE = 8000
FRAME = 160          # 20 ms
FRAME_S = FRAME / RATE
WINDOW = 4.0         # seconds analysed either side of a boundary
REACH = 1.2          # silent run must touch within this distance of boundary
MIN_PAUSE = 0.25     # shorter gaps are not pauses (text just crossfades)
DROP_DB = 7.0        # gap = this many dB below local speech level (reverb-safe)
BRIDGE = 2           # merge silent runs separated by <= 2 frames (40 ms)


def _decode(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(path),
                        '-ac', '1', '-ar', str(RATE), '-f', 's16le', '-'],
                       capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr.decode(errors='ignore')[-500:])
    pcm = array('h')
    pcm.frombytes(r.stdout[:len(r.stdout) // 2 * 2])
    return pcm


def _frames_db(pcm, t0, t1):
    a = max(0, int(t0 * RATE))
    b = min(len(pcm), int(t1 * RATE))
    out = []
    for i in range(a, b - FRAME + 1, FRAME):
        chunk = pcm[i:i + FRAME]
        ms = sum(x * x for x in chunk) / FRAME
        out.append(10 * math.log10(ms + 1e-9))
    return a / RATE, out


def _boundary_pause(pcm, b):
    start, db = _frames_db(pcm, b - WINDOW, b + WINDOW)
    if len(db) < 10:
        return None
    loud = sorted(db)[int(len(db) * 0.9)]
    thr = loud - DROP_DB
    silent = [v < thr for v in db]
    # silent runs [i, j)
    runs, i = [], 0
    while i < len(silent):
        if silent[i]:
            j = i
            while j < len(silent) and silent[j]:
                j += 1
            runs.append([i, j])
            i = j
        else:
            i += 1
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= BRIDGE:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    best, best_d = None, None
    for i, j in merged:
        s, e = start + i * FRAME_S, start + j * FRAME_S
        d = 0.0 if s <= b <= e else min(abs(s - b), abs(e - b))
        if d <= REACH and (best_d is None or d < best_d):
            best, best_d = (s, e), d
    if not best or best[1] - best[0] < MIN_PAUSE:
        return None
    return {'start': round(best[0], 3), 'end': round(best[1], 3), 'boundary': round(b, 3)}


def boundary_pauses(path, ayahs):
    """ayahs: [{'ayah', 'start', 'end'}, ...] sorted. Returns inter-ayah pauses."""
    timed = sorted((a for a in ayahs if a.get('end') is not None),
                   key=lambda a: float(a['start']))
    if len(timed) < 2:
        return []
    pcm = _decode(path)
    out = []
    for prev, nxt in zip(timed, timed[1:]):
        b = (float(prev['end']) + float(nxt['start'])) / 2
        p = _boundary_pause(pcm, b)
        if p:
            # Never let a pause reach into the middle of either ayah.
            p['start'] = max(p['start'], float(prev['start']))
            p['end'] = min(p['end'], float(nxt['end']))
            out.append(p)
    return out
