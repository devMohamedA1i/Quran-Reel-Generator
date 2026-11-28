"""Persistent, locally reviewed 3-minute reel queue from one full-Surah MP3.

Silence candidates are NOT Quran verse-boundary verification. Human approval is
required for every cut. We never modify the master recordings.
"""
import json
import math
import re
import subprocess
import threading
import time
from pathlib import Path

TARGET = 180.0  # nominal three-minute Reel; pauses nearby are preferred
_LOCK = threading.RLock()


def master_audio(root: Path, number: int, source_id: str | None = None) -> Path:
    if not 1 <= number <= 114:
        raise ValueError('Surah number must be 1–114')

    # A selected external folder uses the recording the user chose for this
    # Surah. The built-in Al-Ajmi layout keeps its exact historical lookup.
    if source_id and source_id != 'legacy':
        import audio_sources
        source = audio_sources.get(Path(root), source_id)
        recording = audio_sources.recording_for_surah(source, number)
        return Path(recording['path'])

    base = root / 'Assets/audio/Al-Ajmi-114-Surahs'
    if not base.is_dir():
        raise FileNotFoundError(f'Master library not found: {base}')
    matches = [p for p in base.iterdir() if p.is_dir() and re.match(rf'^{number:03}(?:\D|$)', p.name)]
    if len(matches) != 1:
        raise ValueError(f'Expected one folder for Surah {number:03}, found {len(matches)}')
    mp3s = sorted(matches[0].glob('*.mp3'))
    if len(mp3s) != 1:
        raise ValueError(f'Expected one MP3 for Surah {number:03}, found {len(mp3s)}')
    return mp3s[0]


def probe_seconds(path: Path) -> float:
    r = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(path)],capture_output=True,text=True,timeout=30)
    if r.returncode: raise RuntimeError(f'Unreadable MP3: {path.name}')
    value = float(r.stdout.strip())
    if not math.isfinite(value) or value <= 0: raise ValueError('Invalid MP3 duration')
    return value


def scan_silence(path: Path) -> list:
    """Probe complete audio stream; returns centre of quiet intervals."""
    r = subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','info','-i',str(path),'-vn','-af','silencedetect=noise=-37dB:d=0.36','-f','null','-'],capture_output=True,text=True,timeout=720)
    if r.returncode: raise RuntimeError('Audio scan failed: '+r.stderr[-450:])
    starts = [float(x) for x in re.findall(r'silence_start:\s*([0-9.]+)',r.stderr)]
    ends = [float(x) for x in re.findall(r'silence_end:\s*([0-9.]+)',r.stderr)]
    # A truncated final silence_start has no paired end and is intentionally ignored.
    return [(a+b)/2 for a,b in zip(starts,ends) if b > a and b-a >= .36]


def create_segments(total: float, pauses: list, target: float=TARGET) -> list:
    """Sequential proposals; no gaps/overlaps; every candidate needs human review."""
    if total <= 0: raise ValueError('Invalid duration')
    pos=0.0; out=[]
    good=sorted(p for p in pauses if 0 < p < total)
    while pos < total-.02:
        remaining=total-pos
        if remaining <= target+15:
            end=total
            quality='recording-end'
        else:
            near=[p for p in good if pos+30 <= p <= min(total-10,pos+target+35) and p >= pos+target-35]
            if near:
                end=min(near,key=lambda p: (abs(p-(pos+target)),p))
                quality='silence-candidate'
            else:
                # Never silently mark a forced timestamp as safe.
                end=min(total,pos+target)
                quality='unverified-timestamp'
        if end <= pos+.01: raise RuntimeError('Non-advancing segment detected')
        out.append({'id':len(out)+1,'start':round(pos,3),'end':round(end,3),
                    'source':quality,'status':'draft','boundary_verified':False,'output':None})
        pos=end
        if len(out)>10000: raise RuntimeError('Too many segments')
    return out


def _plan_path(root: Path, surah: int, source_id: str | None = None):
    if source_id and source_id != 'legacy':
        return (root/'Output'/'plans'/'_sources'/source_id/f'{surah:03}.json')
    return root/'Output'/'plans'/f'{surah:03}.json'


def read_plan(root: Path, surah: int, source_id: str | None = None):
    path=_plan_path(root,surah,source_id)
    if not path.is_file(): return None
    return json.loads(path.read_text(encoding='utf-8'))


def write_plan(root: Path, surah: int, plan: dict, source_id: str | None = None):
    path=_plan_path(root,surah,source_id)
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
    tmp.replace(path)


def recording_signature(root: Path, surah: int, source_id: str | None = None):
    """The exact MP3 behind a Surah, and a fingerprint of its bytes.

    A source id identifies the chosen folder, not the recording assigned to
    one Surah: the same folder can be re-pointed from 001.mp3 to
    003 alt.mp3. Every plan comparison therefore uses this fingerprint, so a
    reassigned Surah can never reuse the previous recording's proposals.
    """
    path = master_audio(root, surah, source_id)
    st = path.stat()
    return {'bytes': st.st_size, 'mtime_ns': st.st_mtime_ns}, path


def plan_is_current(root: Path, surah: int, plan: dict | None,
                    source_id: str | None = None) -> bool:
    """True only when the plan was built from the recording selected now."""
    if not plan:
        return False
    try:
        signature, path = recording_signature(root, surah, source_id)
    except (OSError, ValueError, FileNotFoundError):
        return False
    return (plan.get('signature') == signature
            and plan.get('audio_filename') == path.name)


def plan_needs_rebuild(plan: dict | None) -> bool:
    """A plan built for the old 174s target is reproposed at 180s.

    A plan that already carries human work (approved, exported or manually
    adjusted boundaries) is kept exactly as it is.
    """
    if not plan:
        return False
    try:
        planned_target = float(plan.get('target') or 0)
    except (TypeError, ValueError):
        return False
    if abs(planned_target - TARGET) < 0.001:
        return False
    for segment in plan.get('segments') or []:
        if segment.get('status') in ('approved', 'exported'):
            return False
        if segment.get('source') == 'manual-adjustment':
            return False
    return True


def archive_plan(root: Path, surah: int, source_id: str | None, plan: dict) -> Path:
    """Keep the previous proposals before a rebuild replaces the live plan.

    Nothing the user made is discarded: the old file is copied into
    ``Output/plans/_archive`` and never overwritten.
    """
    folder = root / 'Output' / 'plans' / '_archive'
    if source_id and source_id != 'legacy':
        folder = folder / source_id
    folder.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    target = folder / f'{int(surah):03}-{stamp}.json'
    suffix = 1
    while target.exists():
        target = folder / f'{int(surah):03}-{stamp}-{suffix}.json'
        suffix += 1
    tmp = target.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(target)
    return target


def ensure_plan(root: Path, surah: int, source_id: str | None = None):
    with _LOCK:
        signature, path = recording_signature(root, surah, source_id)
        existing = read_plan(root, surah, source_id)
        if existing:
            current = (existing.get('signature') == signature
                       and existing.get('audio_filename') == path.name)
            if current and not plan_needs_rebuild(existing):
                existing['source_changed'] = False
                return existing
            # The selected recording or the target changed. Copy the old
            # proposals aside, then build proposals for the recording that
            # is selected now. Approved and hand-adjusted plans never get
            # here, so no human work is lost.
            try:
                archive_plan(root, surah, source_id, existing)
            except OSError:
                pass
        total=probe_seconds(path)
        pauses=scan_silence(path)
        plan={'surah':surah,'audio_filename':path.name,'signature':signature,
              'duration':round(total,3),'pause_count':len(pauses),'target':TARGET,
              'segments':create_segments(total,pauses),'source_changed':bool(existing),
              'warning':'Pause candidates are NOT verified Ayah boundaries. Listen to each clip and confirm the correct Quranic stopping point before approving.'}
        write_plan(root,surah,plan,source_id)
        return plan


def update_segment(root:Path,surah:int,index:int,*,end=None,approve=None,output=None,
                   source_id: str | None = None):
    with _LOCK:
        plan=read_plan(root,surah,source_id)
        if not plan: raise ValueError('Generate the Surah plan first')
        path=master_audio(root,surah,source_id)
        st=path.stat()
        if plan['signature'] != {'bytes':st.st_size,'mtime_ns':st.st_mtime_ns}:
            raise ValueError('Master MP3 changed since planning. Existing approvals are frozen.')
        items=plan['segments']
        if not 1<=index<=len(items): raise ValueError('Invalid reel number')
        seg=items[index-1]
        if end is not None:
            if seg['status']!='draft': raise ValueError('Cannot adjust an approved/exported reel')
            new=float(end)
            if not math.isfinite(new) or new <= seg['start']+1 or new > plan['duration']:
                raise ValueError('Ending must be after start and within Surah')
            if index < len(items):
                nxt=items[index]
                if nxt['status']!='draft': raise ValueError('Next reel already approved; cannot move shared boundary')
                if new >= nxt['end']-1: raise ValueError('Ending would erase the next reel')
                nxt['start']=round(new,3)
                nxt['source']='manual-adjustment'
                nxt['boundary_verified']=False
            elif abs(new-plan['duration'])>.03:
                raise ValueError('Last reel must include the rest of the Surah; adjust earlier reels instead')
            seg['end']=round(new,3)
            seg['source']='manual-adjustment'
            seg['boundary_verified']=False
        if approve is not None:
            if approve is True:
                if seg['status']=='exported': raise ValueError('Already exported')
                seg['status']='approved';seg['boundary_verified']=True
            elif approve is False:
                if seg['status']=='exported': raise ValueError('Already exported')
                seg['status']='draft';seg['boundary_verified']=False
        if output is not None:
            if seg['status']!='approved' or not seg['boundary_verified']:
                raise ValueError('Reel must be approved before recording export')
            seg['status']='exported';seg['output']=str(output)
        write_plan(root,surah,plan,source_id)
        return plan
