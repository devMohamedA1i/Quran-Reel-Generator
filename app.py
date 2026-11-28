"""Local-only Quran Video Studio web application."""
from pathlib import Path
from threading import Thread, Lock
import io, json, os, sys, uuid, shutil, subprocess, traceback
from flask import (Flask, jsonify, request, send_file, send_from_directory,
                   render_template, abort)
from quran import (load_surahs, backgrounds, selected_verses, background_by_id,
                   font_path, background_fingerprint)
from quran_display import opening_card_seconds
from renderer import validate_settings, render_sample, render_overlay_png, export
import audio_sources
import quran_assets
import draft_store
import reciter_manager

ROOT = Path(os.environ['QVS_ROOT']).resolve() if os.environ.get('QVS_ROOT') else Path(__file__).resolve().parent
# RELEASE_AUDIT Phase 2: a fresh clone must have its runtime containers before
# the first request. Existing drafts and outputs are never touched here.
draft_store.ensure_layout(ROOT)

# The legacy per-verse renderer needs one MP3 per Ayah (NNNVVV.mp3). Those
# files are not part of this project and the built-in collection is one master
# MP3 per Surah, so the feature cannot work. Its entry points are disabled;
# the supported Reel queue/draft export path is unchanged.
LEGACY_PER_VERSE_DISABLED = True
LEGACY_UNAVAILABLE = (
    'The legacy per-verse renderer is unavailable: the per-verse recitation '
    'files it requires are not part of this project. Use the Reel queue to '
    'review, approve and export a Reel.'
)

app = Flask(__name__, static_folder=str(ROOT / 'static'), template_folder=str(ROOT / 'templates'))
app.json.ensure_ascii = False
jobs = {}
lock = Lock()

FRONTEND_DIST = ROOT / 'frontend' / 'dist'


@app.get('/favicon.ico')
def favicon():
    icon = ROOT / 'static' / 'quran-header-icon.png'
    if icon.is_file():
        return send_file(icon, mimetype='image/png')
    abort(404)


@app.get('/')
def home():
    dist_index = FRONTEND_DIST / 'index.html'
    if dist_index.is_file() and request.args.get('legacy') != '1':
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return render_template('index.html')


@app.get('/assets/<path:filename>')
def frontend_assets(filename):
    # Serve live Assets/banner.png and Assets/fonts/* directly so updates appear immediately
    if filename == 'banner.png' or filename.startswith('fonts/'):
        live_root = ROOT / 'Assets'
        live_target = (live_root / filename).resolve()
        if str(live_target).startswith(str(live_root.resolve())) and live_target.is_file():
            return send_from_directory(live_root, filename)
    assets_dir = FRONTEND_DIST / 'assets'
    if assets_dir.is_dir():
        target = (assets_dir / filename).resolve()
        if str(target).startswith(str(assets_dir.resolve())) and target.is_file():
            return send_from_directory(assets_dir, filename)
    abort(404)


# ---- Progressive Quran Setup (10 reciters, real MP3Quran download, verify) --

@app.get('/api/setup/reciters')
def setup_reciters():
    return jsonify(reciters=reciter_manager.list_setup_reciters(ROOT))


@app.post('/api/setup/download/<reciter_id>')
def setup_download_start(reciter_id):
    try:
        state = reciter_manager.start_download(ROOT, reciter_id)
        return jsonify(state), 202 if state.get('state') == 'downloading' else 200
    except ValueError as exc:
        return jsonify(error=str(exc)), 404


@app.get('/api/setup/download/<reciter_id>')
def setup_download_status(reciter_id):
    try:
        return jsonify(reciter_manager.get_download_status(ROOT, reciter_id))
    except ValueError as exc:
        return jsonify(error=str(exc)), 404


@app.post('/api/setup/download/<reciter_id>/cancel')
def setup_download_cancel(reciter_id):
    return jsonify(reciter_manager.cancel_download(reciter_id))


@app.post('/api/setup/verify/<reciter_id>')
def setup_verify(reciter_id):
    data = request.get_json(silent=True) or {}
    activate = data.get('activate', True)
    try:
        result = reciter_manager.verify_reciter(ROOT, reciter_id, activate=bool(activate))
        return jsonify(result)
    except ValueError as exc:
        return jsonify(error=str(exc)), 404
    except audio_sources.AudioSourceError as exc:
        return jsonify(error=exc.message), exc.status


@app.get('/api/outputs')
def list_outputs():
    """List existing exported reels for the active source."""
    source = _source_arg()
    base = ROOT / 'Output' / 'reels'
    if source and source != 'legacy':
        base = base / '_sources' / source
    items = []
    if base.is_dir():
        for mp4 in sorted(base.rglob('*.mp4'), key=lambda p: p.stat().st_mtime, reverse=True):
            # Exclude other sources when listing legacy
            if not source or source == 'legacy':
                if '_sources' in mp4.relative_to(base).parts:
                    continue
            st = mp4.stat()
            items.append({
                'name': mp4.name,
                'path': mp4.relative_to(ROOT).as_posix(),
                'size_bytes': st.st_size,
                'modified': st.st_mtime,
                'folder': mp4.parent.name,
            })
    return jsonify(outputs=items[:100], source=source)


@app.post('/api/duration')
def timing():
    """Real MP3-based duration; guidance only, never a truncation rule."""
    if LEGACY_PER_VERSE_DISABLED:
        return jsonify(error=LEGACY_UNAVAILABLE), 410
    from functools import lru_cache
    from quran import audio_for, selected_verses, load_surahs
    from renderer import duration

    opts = request.get_json(force=True)
    try:
        sn = int(opts['surah'])
        start = int(opts['start'])
        end = int(opts['end'])
        surah, verses = selected_verses(ROOT, sn, start, end)
        open_secs = float(opts.get('opening_seconds', 3))
        close_secs = float(opts.get('closing_seconds', 3))
        if not (1.5 <= open_secs <= 8 and 1.5 <= close_secs <= 8):
            raise ValueError('Invalid opening/closing duration')
        lengths = [cached_audio_duration(str(audio_for(ROOT, sn, int(v['numberInSurah'])))) for v in verses]
        # Al-Fatiha 1 is itself the basmala, recited on the opening card.
        # For other Surahs, a manually split basmala remains part of the
        # original first audio, so it must not be counted twice.
        fatiha_opening = sn == 1 and start == 1
        split = (not fatiha_opening and sn != 9 and start == 1
                 and bool(opts.get('split_basmala_audio', False)))
        split_sec = float(opts.get('basmala_split_seconds', 2.6))
        if split and not (0.2 <= split_sec < lengths[0] - 0.5):
            raise ValueError('Basmala audio split exceeds first verse recording')
        intro = lengths[0] if fatiha_opening else (split_sec if split else open_secs)
        recitation = sum(lengths) - (lengths[0] if fatiha_opening else split_sec if split else 0)
        total = intro + recitation + close_secs
        return jsonify(total_seconds=round(total, 2), opening_seconds=round(intro, 2),
                       recitation_seconds=round(recitation, 2), closing_seconds=round(close_secs, 2),
                       verse_count=len(verses), above_90=total>90, above_180=total>180,
                       complete=True)
    except (ValueError, KeyError, FileNotFoundError, RuntimeError) as exc:
        return jsonify(error=str(exc)), 400


from functools import lru_cache
from renderer import duration as probe_duration
@lru_cache(maxsize=7000)
def cached_audio_duration(filename):
    return probe_duration(Path(filename))

@app.get('/api/library')
def library():
    try:
        ss=load_surahs(ROOT)
        surahs=[{'number':s['number'],'name':s['name'],'englishName':s.get('englishName',''),'verses':len(s['ayahs'])} for s in ss]
    except Exception as e:
        return jsonify(error=str(e),surahs=[],backgrounds=[]),503
    bgs=backgrounds(ROOT)
    return jsonify(surahs=surahs,backgrounds=[{k:b[k] for k in ('id','name','filename','kind')} for b in bgs],font_ok=(ROOT/'Assets/fonts/UthmanicHafs1Ver18.ttf').is_file(),ffmpeg_ok=bool(shutil.which('ffmpeg')))


@app.get('/api/reciters')
def reciters_directory():
    """Serve the local, versioned reciter directory.

    The directory is a plain JSON file in the project. It is read from disk
    so the interface works offline; the provider links it contains are only
    opened when the user asks for them.
    """
    path = ROOT / 'reciters.json'
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        return jsonify(error=f'The reciter directory could not be read: {exc}'), 500
    return jsonify(payload)


# ---- Phase 1: local Quran audio folders ------------------------------------
# The selected folder is read in place. No file is uploaded, copied or
# modified. The source id scopes every cache, plan, draft and export.

def _source_arg():
    return request.args.get('source') or None


@app.get('/api/audio-library')
def audio_library_status():
    try:
        source = audio_sources.active(ROOT)
    except audio_sources.AudioSourceError as exc:
        return jsonify(error=exc.message, source=None,
                       legacy_available=audio_sources.legacy_available(ROOT)), exc.status
    return jsonify(
        source=audio_sources.public(source),
        legacy_available=audio_sources.legacy_available(ROOT),
    )


@app.post('/api/audio-library/choose')
def audio_library_choose():
    """Open the macOS folder chooser and register the chosen folder.

    The browser cannot read a local folder path, and uploading a complete
    MP3 library would duplicate it. A native chooser keeps the files where
    they are. If it is unavailable the response asks for a manual path.
    """
    if sys.platform != 'darwin':
        return jsonify(
            error='The native folder picker is available on macOS. '
                  'Enter the folder path instead.',
            manual=True,
        ), 501

    # Do not call a bare ``activate`` first: it waits ~2.1s for the
    # AppleScript app to come forward and only then shows the panel. The
    # native panel is already modal and comes to the front on its own, so
    # launching it directly opens the picker almost immediately.
    script = (
        'POSIX path of (choose folder with prompt '
        '"Choose the folder that contains your Quran MP3 recordings")'
    )
    try:
        result = subprocess.run(
            ['osascript', '-e', script],
            capture_output=True, text=True, timeout=600,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return jsonify(error=f'Could not open the folder picker: {exc}',
                       manual=True), 500

    if result.returncode:
        message = (result.stderr or '').strip()
        if '-128' in message or 'cancel' in message.lower():
            return jsonify(cancelled=True)
        return jsonify(error='Could not open the folder picker: '
                             + message[-300:], manual=True), 500

    path = result.stdout.strip()
    if not path:
        return jsonify(cancelled=True)

    try:
        source = audio_sources.scan(ROOT, path)
    except audio_sources.AudioSourceError as exc:
        return jsonify(error=exc.message, manual=True), exc.status
    return jsonify(source=audio_sources.public(source))


@app.post('/api/audio-library/scan')
def audio_library_scan():
    """Register a folder path supplied by the local fallback field."""
    data = request.get_json(force=True) or {}
    path = (data.get('path') or '').strip()
    if not path:
        return jsonify(error='Enter a folder path first.'), 400
    try:
        source = audio_sources.scan(ROOT, path)
    except audio_sources.AudioSourceError as exc:
        return jsonify(error=exc.message, manual=True), exc.status
    return jsonify(source=audio_sources.public(source))


@app.post('/api/audio-library/legacy')
def audio_library_legacy():
    """Switch back to the built-in Al-Ajmi library."""
    try:
        source = audio_sources.register_legacy(ROOT)
    except audio_sources.AudioSourceError as exc:
        return jsonify(error=exc.message), exc.status
    if source is None:
        return jsonify(error='The built-in Al-Ajmi audio library is not installed.'), 404
    return jsonify(source=audio_sources.public(source))


@app.post('/api/audio-library/<source_id>/assign')
def audio_library_assign(source_id):
    """Confirm which Surah a recording belongs to."""
    data = request.get_json(force=True) or {}
    try:
        source = audio_sources.get(ROOT, source_id)
        other = data.get('move_from')
        if other and str(other) in source['selected']:
            source['selected'].pop(str(other), None)
        surah = data.get('surah')
        source = audio_sources.assign(
            source, str(data.get('recording_id', '')),
            None if surah in (None, '', 'null') else int(surah),
        )
    except (audio_sources.AudioSourceError, TypeError, ValueError) as exc:
        message = getattr(exc, 'message', str(exc))
        status = getattr(exc, 'status', 400)
        return jsonify(error=message), status
    return jsonify(source=audio_sources.public(source))


@app.get('/api/audio-library/<source_id>/file/<recording_id>')
def audio_library_file(source_id, recording_id):
    try:
        source = audio_sources.get(ROOT, source_id)
        recording = audio_sources.recording_by_id(source, recording_id)
    except audio_sources.AudioSourceError as exc:
        return jsonify(error=exc.message), exc.status
    return send_file(recording['path'], mimetype='audio/mpeg', conditional=True)

# ---- Phase 1: optional Quran text and Ayah timing --------------------------
# Both assets are attached to the selected audio source. They are read in
# place; only reviewed timing corrections are written, and those go to a
# separate folder under Output/timings/.

def _asset_source(data=None):
    data = data or {}
    source = data.get('source') or request.args.get('source') or None
    if not source:
        try:
            current = audio_sources.active(ROOT)
        except audio_sources.AudioSourceError:
            current = None
        source = current['id'] if current else None
    if not source:
        raise quran_assets.AssetError(
            'Choose a Quran audio folder first, so the optional files are '
            'associated with the right recording.',
            status=409,
            code='no_audio_source',
        )
    try:
        audio_sources.get(ROOT, source)
    except audio_sources.AudioSourceError as exc:
        raise quran_assets.AssetError(exc.message, status=exc.status)
    return source


def _native_folder(prompt):
    """Open the macOS folder chooser. Returns (path, error_response)."""
    if sys.platform != 'darwin':
        return None, (jsonify(
            error='The native folder picker is available on macOS. '
                  'Enter the folder path instead.',
            manual=True,
        ), 501)
    # As above, skip the slow bare ``activate``; the modal panel fronts itself.
    script = (
        f'POSIX path of (choose folder with prompt "{prompt}")'
    )
    try:
        result = subprocess.run(
            ['osascript', '-e', script],
            capture_output=True, text=True, timeout=600,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, (jsonify(
            error=f'Could not open the folder picker: {exc}', manual=True
        ), 500)
    if result.returncode:
        message = (result.stderr or '').strip()
        if '-128' in message or 'cancel' in message.lower():
            return None, (jsonify(cancelled=True), 200)
        return None, (jsonify(
            error='Could not open the folder picker: ' + message[-300:],
            manual=True,
        ), 500)
    path = result.stdout.strip()
    if not path:
        return None, (jsonify(cancelled=True), 200)
    return path, None


def _asset_payload():
    data = request.get_json(silent=True) or {}
    try:
        source = _asset_source(data)
    except quran_assets.AssetError as exc:
        return None, None, (jsonify(error=exc.message, code=exc.code), exc.status)
    return source, data, None


@app.get('/api/assets/status')
def assets_status():
    source = request.args.get('source') or None
    if not source:
        try:
            current = audio_sources.active(ROOT)
        except audio_sources.AudioSourceError:
            current = None
        source = current['id'] if current else None
    if not source:
        return jsonify(
            source=None,
            text={'loaded': False, 'surahs': [], 'verse_counts': {},
                  'verse_total': 0, 'name': '', 'path': ''},
            timing={'loaded': False, 'surahs': [], 'issues': [],
                    'name': '', 'path': ''},
            text_available=False,
            timing_available=False,
            corrected_surahs=[],
        )
    try:
        audio_sources.get(ROOT, source)
    except audio_sources.AudioSourceError as exc:
        return jsonify(error=exc.message), exc.status
    return jsonify(quran_assets.status(ROOT, source))


@app.post('/api/assets/text/choose')
def assets_text_choose():
    source, data, failure = _asset_payload()
    if failure:
        return failure
    path, error = _native_folder(
        'Choose the folder that contains your Quran text JSON files'
    )
    if error:
        return error
    try:
        info = quran_assets.load_text(ROOT, source, path)
    except quran_assets.AssetError as exc:
        return jsonify(error=exc.message, manual=True, code=exc.code), exc.status
    return jsonify(text=info, status=quran_assets.status(ROOT, source))


@app.post('/api/assets/text/scan')
def assets_text_scan():
    source, data, failure = _asset_payload()
    if failure:
        return failure
    path = (data.get('path') or '').strip()
    if not path:
        return jsonify(error='Enter a Quran text folder path first.',
                       manual=True), 400
    try:
        info = quran_assets.load_text(ROOT, source, path)
    except quran_assets.AssetError as exc:
        return jsonify(error=exc.message, manual=True, code=exc.code), exc.status
    return jsonify(text=info, status=quran_assets.status(ROOT, source))


@app.post('/api/assets/text/remove')
def assets_text_remove():
    source, data, failure = _asset_payload()
    if failure:
        return failure
    info = quran_assets.remove_text(source)
    return jsonify(text=info, status=quran_assets.status(ROOT, source))


@app.post('/api/assets/timing/choose')
def assets_timing_choose():
    source, data, failure = _asset_payload()
    if failure:
        return failure
    path, error = _native_folder(
        'Choose the folder that contains your Ayah timing JSON files'
    )
    if error:
        return error
    return _finish_timing_load(source, path)


@app.post('/api/assets/timing/scan')
def assets_timing_scan():
    source, data, failure = _asset_payload()
    if failure:
        return failure
    path = (data.get('path') or '').strip()
    if not path:
        return jsonify(error='Enter an Ayah timing folder path first.',
                       manual=True), 400
    return _finish_timing_load(source, path)


def _finish_timing_load(source, path):
    try:
        info = quran_assets.load_timing(ROOT, source, path)
    except quran_assets.AssetError as exc:
        return jsonify(error=exc.message, manual=True, code=exc.code), exc.status
    return jsonify(timing=info, status=quran_assets.status(ROOT, source))


@app.post('/api/assets/timing/remove')
def assets_timing_remove():
    source, data, failure = _asset_payload()
    if failure:
        return failure
    info = quran_assets.remove_timing(source)
    return jsonify(timing=info, status=quran_assets.status(ROOT, source))


@app.get('/api/timings/<int:surah>')
def timing_detail(surah):
    source = _source_arg()
    if not 1 <= surah <= 114:
        return jsonify(error='Invalid Surah'), 400
    data = quran_assets.timing_status(ROOT, source, surah)
    data.update(
        surah=surah,
        source=source,
        text_available=quran_assets.text_available(ROOT, source, surah),
    )
    return jsonify(data)


@app.post('/api/timings/<int:surah>/corrections')
def timing_save_corrections(surah):
    data = request.get_json(force=True) or {}
    source = data.get('source') or _source_arg()
    if not 1 <= surah <= 114:
        return jsonify(error='Invalid Surah'), 400
    try:
        result = quran_assets.save_corrections(
            ROOT, source, surah, data.get('entries'),
            recording_id=data.get('recording_id'),
        )
    except quran_assets.AssetError as exc:
        return jsonify(error=exc.message, code=exc.code), exc.status
    result.update(
        surah=surah,
        source=source,
        text_available=quran_assets.text_available(ROOT, source, surah),
    )
    return jsonify(result)


@app.post('/api/timings/<int:surah>/corrections/reset')
def timing_reset_corrections(surah):
    data = request.get_json(silent=True) or {}
    source = data.get('source') or _source_arg()
    if not 1 <= surah <= 114:
        return jsonify(error='Invalid Surah'), 400
    try:
        result = quran_assets.reset_corrections(ROOT, source, surah)
    except quran_assets.AssetError as exc:
        return jsonify(error=exc.message, code=exc.code), exc.status
    result.update(surah=surah, source=source)
    return jsonify(result)


@app.get('/api/timings/<int:surah>/export')
def timing_export(surah):
    source = _source_arg()
    if not 1 <= surah <= 114:
        return jsonify(error='Invalid Surah'), 400
    try:
        filename, payload = quran_assets.export_timing(ROOT, source, surah)
    except quran_assets.AssetError as exc:
        return jsonify(error=exc.message, code=exc.code), exc.status
    buffer = io.BytesIO(
        json.dumps(payload, ensure_ascii=False, indent=2).encode('utf-8')
    )
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype='application/json',
        as_attachment=True,
        download_name=filename,
    )


@app.get('/api/verses/<int:num>')
def verses(num):
    source = _source_arg()
    try:
        if not 1 <= num <= 114:
            raise ValueError('Invalid Surah')
        items = quran_assets.verses(ROOT, source, num)
        name = load_surahs(ROOT)[num - 1]['name']
        return jsonify(
            verses=items,
            name=name,
            source=source,
            text_available=True,
        )
    except quran_assets.AssetError as e:
        return jsonify(
            error=e.message, code=e.code, text_available=False,
            source=source,
        ), e.status
    except Exception as e:
        return jsonify(error=str(e), text_available=False), 400

@app.get('/api/background/<uid>')
def asset(uid):
    try:
        b=background_by_id(ROOT,uid)
        return send_file(b['path'],conditional=True)
    except ValueError: abort(404)

@app.post('/api/preview')
def preview():
    """Compose the still preview in memory. Nothing is written to disk."""
    try:
        opts=request.get_json(force=True)
        buffer=io.BytesIO()
        render_sample(ROOT,opts,buffer)
        buffer.seek(0)
        response=send_file(buffer,mimetype='image/jpeg')
        response.headers['Cache-Control']='no-store'
        return response
    except (ValueError,FileNotFoundError,RuntimeError) as e:
        return jsonify(error=str(e)),400

@app.post('/api/preview-overlay')
def preview_overlay():
    """Transparent Quran text overlay as PNG bytes, for video backgrounds."""
    try:
        opts=request.get_json(force=True)
        data=render_overlay_png(ROOT,opts)
        response=send_file(io.BytesIO(data),mimetype='image/png')
        response.headers['Cache-Control']='no-store'
        return response
    except (ValueError,FileNotFoundError,RuntimeError) as e:
        return jsonify(error=str(e)),400

@app.post('/api/export')
def begin():
    if LEGACY_PER_VERSE_DISABLED:
        return jsonify(error=LEGACY_UNAVAILABLE), 410
    opts=request.get_json(force=True)
    try:
        validate_settings(ROOT,opts)
    except (ValueError,FileNotFoundError) as e:
        return jsonify(error=str(e)),400
    with lock:
        if any(j['state']=='running' for j in jobs.values()):
            return jsonify(error='An export is already running'),409
        job_id=uuid.uuid4().hex[:16]
        jobs[job_id]={'state':'running','percent':0,'message':'Starting render','file':None}
    def worker():
        def update(p,m):
            with lock: jobs[job_id].update(percent=p,message=m)
        try:
            file=export(ROOT,opts,update)
            with lock: jobs[job_id].update(state='done',percent=100,message='Export ready',file=file.name)
        except Exception as exc:
            with lock: jobs[job_id].update(state='error',message=str(exc)[-1800:])
    Thread(target=worker,daemon=True).start()
    return jsonify(job_id=job_id),202

@app.post('/api/preview-video')
def preview_video():
    if LEGACY_PER_VERSE_DISABLED:
        return jsonify(error=LEGACY_UNAVAILABLE), 410
    opts=request.get_json(force=True)
    try:
        validate_settings(ROOT,opts)
    except (ValueError,FileNotFoundError) as e:
        return jsonify(error=str(e)),400
    with lock:
        if any(j['state']=='running' for j in jobs.values()):
            return jsonify(error='A video rendering task is already running'),409
        job_id=uuid.uuid4().hex[:16]
        jobs[job_id]={'state':'running','percent':0,'message':'Creating playable preview','file':None,'type':'preview'}
    def worker():
        def update(percent,message):
            with lock: jobs[job_id].update(percent=percent,message=message)
        try:
            file=export(ROOT,opts,update,preview_mode=True)
            with lock: jobs[job_id].update(state='done',percent=100,message='Playable preview ready',file=file.name)
        except Exception as exc:
            with lock: jobs[job_id].update(state='error',message=str(exc)[-1800:])
    Thread(target=worker,daemon=True).start()
    return jsonify(job_id=job_id),202

@app.get('/api/preview-play/<filename>')
def preview_play(filename):
    if not filename.startswith('Preview_') or not filename.endswith('.mp4') or Path(filename).name != filename:
        abort(404)
    path=ROOT/'Output'/'previews'/filename
    if not path.is_file(): abort(404)
    return send_file(path,mimetype='video/mp4',conditional=True)

@app.get('/api/job/<jid>')
def job(jid):
    with lock: state=jobs.get(jid)
    if not state: abort(404)
    return jsonify(state)

@app.get('/api/play/<filename>')
def play(filename):
    path=ROOT/'Output'/filename
    if not path.is_file() or path.suffix!='.mp4': abort(404)
    return send_file(path,mimetype='video/mp4',conditional=True)

@app.get('/api/output/<filename>')
def output(filename):
    path=ROOT/'Output'/filename
    if not path.is_file() or path.suffix!='.mp4': abort(404)
    return send_file(path,as_attachment=True)



# ---- Full-Surah audio library + reviewable Reel queue ----
from reel_planner import (master_audio, ensure_plan, read_plan, update_segment,
                          plan_is_current, plan_needs_rebuild)
from renderer import export_master_reel
planner_jobs = {}

@app.get('/api/master-audio/<int:surah>')
def full_audio(surah):
    try:
        return send_file(master_audio(ROOT, surah, _source_arg()),
                         mimetype='audio/mpeg', conditional=True)
    except (FileNotFoundError, ValueError, audio_sources.AudioSourceError):
        abort(404)

@app.get('/api/reels/<int:surah>')
def reels_status(surah):
    source=_source_arg()
    try:
        if not 1 <= surah <= 114: raise ValueError('Invalid Surah')
        audio=master_audio(ROOT,surah,source)
        state=read_plan(ROOT,surah,source)
        if state is not None:
            # A plan from another MP3 (or from the old 174s target) is not
            # this Surah's plan. Hide it so the client asks for a rescan
            # instead of showing stale proposals.
            if not plan_is_current(ROOT,surah,state,source) or plan_needs_rebuild(state):
                state=None
            else:
                state['source_changed']=False
        with lock:
            scan=planner_jobs.get(f'{source or "legacy"}:{surah}',{'state':'not_started'})
        return jsonify(plan=state,scan=scan,filename=audio.name,source=source)
    except (ValueError,FileNotFoundError,audio_sources.AudioSourceError) as e:
        return jsonify(error=getattr(e,'message',str(e))),getattr(e,'status',400)

@app.post('/api/reels/<int:surah>/scan')
def reels_scan(surah):
    source=_source_arg()
    job_key=f'{source or "legacy"}:{surah}'
    try:
        master_audio(ROOT,surah,source)
    except (ValueError,FileNotFoundError,audio_sources.AudioSourceError) as e:
        return jsonify(error=getattr(e,'message',str(e))),getattr(e,'status',400)
    existing=read_plan(ROOT,surah,source)
    if existing and plan_is_current(ROOT,surah,existing,source) \
            and not plan_needs_rebuild(existing):
        return jsonify(plan=existing,scan={'state':'done'})
    with lock:
        if planner_jobs.get(job_key,{}).get('state')=='running':
            return jsonify(scan=planner_jobs[job_key]),202
        planner_jobs[job_key]={'state':'running','message':'Scanning for quiet intervals…'}
    def worker():
        try:
            ensure_plan(ROOT,surah,source)
            with lock: planner_jobs[job_key]={'state':'done','message':'Review candidates below'}
        except Exception as e:
            with lock: planner_jobs[job_key]={'state':'error','message':str(e)[-500:]}
    Thread(target=worker,daemon=True).start()
    return jsonify(scan={'state':'running'}),202

@app.post('/api/reels/<int:surah>/<int:index>')
def reels_update(surah,index):
    data=request.get_json(force=True)
    source=data.get('source') or _source_arg()
    try:
        if 'end' in data and 'approve' in data:
            raise ValueError('Change timing and approve in separate actions')
        with lock:
            plan=update_segment(ROOT,surah,index,
                                end=data.get('end'),approve=data.get('approve'),
                                source_id=source)
        return jsonify(plan=plan)
    except (ValueError,FileNotFoundError,audio_sources.AudioSourceError) as e:
        return jsonify(error=getattr(e,'message',str(e))),getattr(e,'status',400)

@app.post('/api/reels/<int:surah>/<int:index>/export')
def reels_export(surah,index):
    opts=request.get_json(force=True)
    source=opts.get('source') or _source_arg()
    try:
        plan=read_plan(ROOT,surah,source)
        if not plan: raise ValueError('First create a Reel plan')
        segment=plan['segments'][index-1]
        if segment['status']!='approved' or not segment['boundary_verified']:
            raise ValueError('Listen and approve the boundary first')
        validate_settings(ROOT,opts)
        path=master_audio(ROOT,surah,source)
        st=path.stat()
        if plan['signature']!={'bytes':st.st_size,'mtime_ns':st.st_mtime_ns}:
            raise ValueError('Master recording has changed')
        if segment['status']=='exported': raise ValueError('Already exported')
    except (ValueError,FileNotFoundError,IndexError,audio_sources.AudioSourceError) as e:
        return jsonify(error=getattr(e,'message',str(e))),getattr(e,'status',400)
    with lock:
        if any(j['state']=='running' for j in jobs.values()):
            return jsonify(error='Another render is running'),409
        jid=uuid.uuid4().hex[:16]
        jobs[jid]={'state':'running','percent':0,'message':'Rendering approved reel','file':None}
    def worker():
        def update(p,m):
            with lock: jobs[jid].update(percent=p,message=m)
        try:
            source_info=audio_sources.get(ROOT,source)
            # RELEASE_AUDIT Phase 4: external sources must never share the
            # built-in Al-Ajmi output directory. Legacy keeps its historical
            # path so existing projects remain compatible.
            if source and source != 'legacy':
                target_dir=export_path(ROOT,surah,index,source)
                filename=f"Surah_{surah:03}_Reel_{index:03}.mp4"
            else:
                target_dir=None
                filename=None
            result=export_master_reel(
                ROOT,opts,surah,segment,update,
                outdir=target_dir,
                filename=filename,
                source_id=source,
                timing_available=audio_sources.timing_compatible(source_info, ROOT),
            )
            update_segment(ROOT,surah,index,output=result.relative_to(ROOT/'Output'),
                           source_id=source)
            with lock: jobs[jid].update(state='done',percent=100,message='Reel ready',file=result.relative_to(ROOT/'Output').as_posix())
        except Exception as e:
            with lock: jobs[jid].update(state='error',message=str(e)[-800:])
    Thread(target=worker,daemon=True).start()
    return jsonify(job_id=jid),202

@app.get('/api/reel-file/<int:surah>/<int:index>')
def reels_play(surah,index):
    source=_source_arg()
    if not 1<=surah<=114 or not 1<=index<=9999: abort(404)
    plan=read_plan(ROOT,surah,source)
    if not plan or index>len(plan['segments']): abort(404)
    seg=plan['segments'][index-1]
    if seg['status']!='exported': abort(404)
    if seg.get('output'):
        path=ROOT/'Output'/seg['output']
    else:
        path=export_path(ROOT,surah,index,source)/f'Surah_{surah:03}_Reel_{index:03}.mp4'
    if not path.is_file(): abort(404)
    return send_file(path,mimetype='video/mp4',conditional=True)


# ---- Authoritative per-reel drafts: Draft/<Surah folder>/Reel_XXX.json ----
from draft_store import (
    DraftError, list_reels, read_reel, save_reel, approve_audio, reset_audio,
    approve_video, reset_video, record_export, surah_folder, surah_duration,
    export_filename, import_legacy, write_reels, reel_file, _now, export_path,
)
import ayah_data

@app.get('/api/drafts/<int:surah>')
def drafts_list(surah):
    """Every reel draft of a Surah. These files are the source of truth."""
    source=_source_arg()
    try:
        folder=surah_folder(ROOT,surah,source)
        dur=round(surah_duration(ROOT,surah,source),3)
        reels=list_reels(ROOT,surah,source_id=source)
        # For a freshly verified reciter with no drafts yet on this Surah,
        # automatically seed Ayah-aligned (or duration-based) initial drafts.
        if not reels and source and source != 'legacy' and dur > 0:
            proposals = []
            if quran_assets.has_timing(ROOT, source, surah):
                try:
                    proposals = quran_assets.propose_reels(ROOT, source, surah, 180.0, dur)
                except Exception:
                    proposals = []
            if not proposals:
                # Fallback: split into ~3-minute segments without losing audio
                seg_start = 0.0
                while seg_start < dur - 0.5:
                    seg_end = min(dur, seg_start + 180.0)
                    if dur - seg_end < 30.0:
                        seg_end = dur
                    proposals.append({'start': round(seg_start, 3), 'end': round(seg_end, 3)})
                    seg_start = seg_end
            seed_files = {}
            for idx, prop in enumerate(proposals, start=1):
                item = draft_store._blank_reel(surah, folder.name, idx, prop['start'], prop['end'])
                item['proposed_start'] = prop['start']
                item['proposed_end'] = prop['end']
                item['source'] = 'ayah-boundary' if quran_assets.has_timing(ROOT, source, surah) else 'duration'
                item['updated_at'] = _now()
                seed_files[reel_file(ROOT, surah, idx, source)] = item
            if seed_files:
                write_reels(ROOT, seed_files)
                reels = list_reels(ROOT, surah, source_id=source)
        return jsonify(
            surah=surah,
            surah_folder=folder.name,
            duration=dur,
            reels=reels,
            source=source,
        )
    except DraftError as e:
        return jsonify(error=e.message,detail=e.detail),e.status
    except audio_sources.AudioSourceError as e:
        return jsonify(error=e.message),e.status

@app.post('/api/drafts/<int:surah>/<int:reel>')
def drafts_save(surah,reel):
    """Save one reel's editing state."""
    data=request.get_json(force=True) or {}
    source=data.get('source') or _source_arg()
    try:
        return jsonify(reel=save_reel(ROOT,surah,reel,data,source_id=source))
    except DraftError as e:
        return jsonify(error=e.message,detail=e.detail),e.status
    except audio_sources.AudioSourceError as e:
        return jsonify(error=e.message),e.status

@app.post('/api/drafts/<int:surah>/<int:reel>/range')
def drafts_update_range(surah,reel):
    """Update a reel's audio_start/audio_end and auto-rebalance following reels."""
    data=request.get_json(silent=True) or {}
    source=data.get('source') or _source_arg()
    try:
        reels=draft_store.update_reel_range(
            ROOT, surah, reel,
            audio_start=data.get('audio_start'),
            audio_end=data.get('audio_end'),
            source_id=source,
        )
        return jsonify(reels=reels)
    except DraftError as e:
        return jsonify(error=e.message,detail=e.detail),e.status
    except audio_sources.AudioSourceError as e:
        return jsonify(error=e.message),e.status

@app.post('/api/drafts/<int:surah>/<int:reel>/approve-audio')
def drafts_approve_audio(surah,reel):
    """Confirm the audio boundaries and keep the queue continuous."""
    data=request.get_json(force=True) or {}
    source=data.get('source') or _source_arg()
    try:
        result=approve_audio(ROOT,surah,reel,end=data.get('end'),
                             confirm=bool(data.get('confirm')),
                             source_id=source)
        return jsonify(result)
    except DraftError as e:
        return jsonify(error=e.message,detail=e.detail),e.status
    except audio_sources.AudioSourceError as e:
        return jsonify(error=e.message),e.status

@app.post('/api/drafts/<int:surah>/<int:reel>/reset-audio')
def drafts_reset_audio(surah,reel):
    """Put the reel back to its originally proposed boundaries."""
    data=request.get_json(force=True) or {}
    source=data.get('source') or _source_arg()
    try:
        return jsonify(reset_audio(ROOT,surah,reel,confirm=bool(data.get('confirm')),
                                   source_id=source))
    except DraftError as e:
        return jsonify(error=e.message,detail=e.detail),e.status
    except audio_sources.AudioSourceError as e:
        return jsonify(error=e.message),e.status

@app.post('/api/drafts/<int:surah>/legacy-import')
def drafts_legacy_import(surah):
    """Migrate older browser work into the drafts, keeping both versions."""
    data=request.get_json(force=True) or {}
    source=data.get('source') or _source_arg()
    try:
        return jsonify(import_legacy(ROOT,surah,data.get('legacy') or {},
                                     source_id=source))
    except DraftError as e:
        return jsonify(error=e.message,detail=e.detail),e.status

@app.get('/api/health')
def local_health():
    return jsonify(app='quran-reel-generator', status='ok')

@app.get('/api/ayahs/<int:surah>')
def ayah_list(surah):
    """Ayah timings of a Surah, for the waveform markers.

    The built-in library uses its own timing files. Any other recording only
    gets markers when timing files were loaded for that same source and fit
    its duration. A recording without timing gets a clear "not available"
    response and the queue stays audio-based.
    """
    source=_source_arg()
    try:
        if not 1 <= surah <= 114:
            raise ValueError('Invalid Surah')
        entries = quran_assets.timings(ROOT, source, surah)
        if not entries:
            raise quran_assets.AssetError(
                f'No timing data for Surah {surah:03d}', status=404,
                code='no_timing',
            )
        recording_id = quran_assets.timing_status(
            ROOT, source, surah
        ).get('recording_id')
        return jsonify(
            surah=surah,
            source=source,
            timing_available=True,
            opening_card_seconds=opening_card_seconds(ROOT,source,surah),
            corrected=quran_assets.is_corrected(ROOT, source, surah),
            recording_id=recording_id,
            ayahs=[
                {'ayah': e['ayah'], 'start': e['start'], 'end': e['end']}
                for e in entries
            ],
        )
    except quran_assets.AssetError as e:
        return jsonify(error=e.message, code=e.code,
                       timing_available=False),e.status
    except ValueError as e:
        return jsonify(error=str(e),timing_available=False),400

@app.get('/api/ayah-at/<int:surah>')
def ayah_at_time(surah):
    """The Ayah that is being recited at a point in time."""
    source=_source_arg()
    try:
        seconds = float(request.args.get('time', 0))
    except (TypeError, ValueError):
        return jsonify(error='Invalid time'),400
    try:
        ayah = quran_assets.ayah_at(ROOT, source, surah, seconds)
        return jsonify(surah=surah, time=seconds, ayah=ayah,
                       source=source, timing_available=True)
    except quran_assets.AssetError as e:
        return jsonify(error=e.message, code=e.code,
                       timing_available=False),e.status
    except ValueError as e:
        return jsonify(error=str(e),timing_available=False),400

@app.post('/api/drafts/<int:surah>/repropose')
def drafts_repropose(surah):
    """Propose reels that end on validated Ayah boundaries.

    Only Reels that are not approved and were never adjusted by hand are
    touched. Everything else keeps the boundaries it has.
    """
    source=_source_arg()
    if not quran_assets.has_timing(ROOT, source, surah):
        return jsonify(error='Ayah aligned proposals need timing data, which is '
                             'not available for this recording. Use the audio '
                             'Reel queue instead.'),409
    try:
        folder = surah_folder(ROOT, surah, source)
        items = list_reels(ROOT, surah, source_id=source)
        duration = surah_duration(ROOT, surah, source)
        proposals = quran_assets.propose_reels(
            ROOT, source, surah, 180.0, duration
        )
        if not proposals:
            raise DraftError(f'No Ayah timings for Surah {surah:03}', status=400)

        changed = []
        kept = []
        superseded = []
        files = {}
        for item in items:
            reel = int(item['reel'])
            current_start = float(item['audio_start'])
            current_end = float(item['audio_end'])
            proposed_start = float(item.get('proposed_start', current_start))
            proposed_end = float(item.get('proposed_end', current_end))
            manual = abs(current_end - proposed_end) > 0.01 or \
                abs(current_start - proposed_start) > 0.01

            if reel > len(proposals):
                # The Ayah aligned proposal needs fewer Reels for this Surah.
                # The extra drafts stay on disk; they are only put aside when
                # they hold no work of their own.
                if item.get('audio_approved') or manual:
                    kept.append(reel)
                    continue
                merged = dict(item)
                merged['superseded'] = True
                merged['superseded_reason'] = (
                    'The Ayah aligned proposal needs fewer Reels for this Surah.'
                )
                merged['updated_at'] = _now()
                files[reel_file(ROOT, surah, reel, source)] = merged
                superseded.append(reel)
                continue

            if item.get('audio_approved') or manual:
                kept.append(reel)
                continue

            proposal = proposals[reel - 1]
            merged = dict(item)
            merged.pop('superseded', None)
            merged.pop('superseded_reason', None)
            merged['audio_start'] = proposal['start']
            merged['audio_end'] = proposal['end']
            merged['proposed_start'] = proposal['start']
            merged['proposed_end'] = proposal['end']
            merged['source'] = 'ayah-boundary'
            merged['updated_at'] = _now()
            files[reel_file(ROOT, surah, reel, source)] = merged
            changed.append(reel)

        if not files:
            return jsonify(
                surah=surah, changed=[], kept=kept, superseded=[],
                message='Every Reel of this Surah is approved or was adjusted by hand.',
            )

        write_reels(ROOT, files)
        return jsonify(
            surah=surah,
            changed=changed,
            kept=kept,
            superseded=superseded,
            long_ayahs=[r['long_ayah'] for r in proposals if r.get('long')],
            reels=list_reels(ROOT, surah, source_id=source),
        )
    except DraftError as e:
        return jsonify(error=e.message, detail=e.detail), e.status

@app.post('/api/drafts/<int:surah>/<int:reel>/approve-video')
def drafts_approve_video(surah,reel):
    """Confirm the video settings of a reel."""
    source=_source_arg()
    try:
        return jsonify(reel=approve_video(ROOT,surah,reel,source_id=source))
    except DraftError as e:
        return jsonify(error=e.message,detail=e.detail),e.status
    except audio_sources.AudioSourceError as e:
        return jsonify(error=e.message),e.status

@app.post('/api/drafts/<int:surah>/<int:reel>/reset-video')
def drafts_reset_video(surah,reel):
    """Clear the video settings and progress, keeping the audio approval."""
    source=_source_arg()
    try:
        return jsonify(reel=reset_video(ROOT,surah,reel,source_id=source))
    except DraftError as e:
        return jsonify(error=e.message,detail=e.detail),e.status
    except audio_sources.AudioSourceError as e:
        return jsonify(error=e.message),e.status

@app.post('/api/drafts/<int:surah>/<int:reel>/export')
def drafts_export(surah,reel):
    """Render the reel with its saved (or submitted) audio range and video settings."""
    data=request.get_json(silent=True) or {}
    source=data.get('source') or _source_arg()
    direct=bool(data.get('direct'))
    try:
        draft=read_reel(ROOT,surah,reel,source)
    except DraftError as e:
        return jsonify(error=e.message,detail=e.detail),e.status
    except audio_sources.AudioSourceError as e:
        return jsonify(error=e.message),e.status

    if direct:
        patch={}
        if data.get('audio_start') is not None:
            patch['audio_start']=float(data['audio_start'])
        if data.get('audio_end') is not None:
            patch['audio_end']=float(data['audio_end'])
        if isinstance(data.get('video_settings'),dict):
            patch['video_settings']=data['video_settings']
        if patch:
            try:
                draft=save_reel(ROOT,surah,reel,patch,source)
            except DraftError as e:
                return jsonify(error=e.message,detail=e.detail),e.status
    else:
        if not draft.get('audio_approved'):
            return jsonify(error='Approve the audio before exporting.'),409
        if draft.get('export') and (ROOT/draft['export']['path']).is_file():
            return jsonify(error='This Reel has already been exported.',detail=draft['export']),409

    settings=dict(draft.get('video_settings') or {})
    settings.setdefault('surah',surah)
    settings.setdefault('effect','fade')
    if not settings.get('background_id'):
        # A Reel that was never given a background uses the studio default.
        from quran import backgrounds as _backgrounds
        available=_backgrounds(ROOT)
        if available:
            settings['background_id']=available[0]['id']
    try:
        validate_settings(ROOT,settings)
    except (ValueError,FileNotFoundError) as e:
        return jsonify(error=str(e)),400

    target_dir=export_path(ROOT,surah,reel,source)
    target_dir.mkdir(parents=True,exist_ok=True)
    folder=surah_folder(ROOT,surah,source)
    filename=export_filename(surah,folder.name,reel,
                             float(draft['audio_start']),float(draft['audio_end']),
                             lang=str(settings.get('text_language') or 'en'))
    target=target_dir/filename
    if target.exists():
        if not direct:
            return jsonify(error='A video already exists at this path; it was not overwritten.'),409
        stem=target.stem
        suffix=target.suffix
        n=2
        while (target_dir/f'{stem}_{n}{suffix}').exists():
            n+=1
        filename=f'{stem}_{n}{suffix}'
        target=target_dir/filename

    with lock:
        if any(j['state']=='running' for j in jobs.values()):
            return jsonify(error='Another render is running'),409
        jid=uuid.uuid4().hex[:16]
        jobs[jid]={'state':'running','percent':0,'message':'Rendering approved reel','file':None}

    def worker():
        import renderer as _renderer
        _renderer.set_current_job(jid)
        def update(p,m):
            if _renderer.is_job_cancelled(jid):
                raise _renderer.ExportCancelled('Export cancelled by user')
            with lock: jobs[jid].update(percent=p,message=m)
        try:
            source_info=audio_sources.get(ROOT,source)
            timing_ok=audio_sources.timing_compatible(source_info, ROOT)
            result=export_master_reel(ROOT,settings,surah,
                                      {'start':draft['audio_start'],
                                       'end':draft['audio_end'],
                                       'id':reel},
                                      update,
                                      outdir=target_dir,
                                      filename=filename,
                                      source_id=source,
                                      timing_available=timing_ok)
            relative=result.relative_to(ROOT).as_posix()
            record_export(ROOT,surah,reel,relative,
                          {'audio_start':draft['audio_start'],
                           'audio_end':draft['audio_end']},
                          source_id=source)
            with lock: jobs[jid].update(state='done',percent=100,
                                        message='Reel ready',file=relative)
        except _renderer.ExportCancelled:
            partial = target_dir / filename
            try:
                if partial.is_file():
                    partial.unlink()
            except OSError:
                pass
            with lock: jobs[jid].update(state='cancelled',message='Export cancelled')
        except Exception as e:
            with lock: jobs[jid].update(state='error',message=str(e)[-800:])
        finally:
            _renderer.clear_current_job(jid)
    Thread(target=worker,daemon=True).start()
    return jsonify(job_id=jid),202


@app.post('/api/job/<job_id>/cancel')
def cancel_job_route(job_id):
    import renderer as _renderer
    with lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify(error='Job not found'), 404
        if job.get('state') == 'running':
            job['state'] = 'cancelled'
            job['message'] = 'Export cancelled'
    _renderer.cancel_export(job_id)
    return jsonify(ok=True, state='cancelled')

@app.get('/api/draft-video/<int:surah>/<int:reel>')
def draft_video(surah,reel):
    """Play back a finished reel of a Surah."""
    source=_source_arg()
    try:
        draft=read_reel(ROOT,surah,reel,source)
    except DraftError:
        abort(404)
    except audio_sources.AudioSourceError:
        abort(404)
    record=draft.get('export')
    if not record or not record.get('path'):
        abort(404)
    path=ROOT/record['path']
    if not path.is_file(): abort(404)
    return send_file(path,mimetype='video/mp4',conditional=True)


@app.post('/api/reveal-export')
def reveal_export_file():
    """Reveal an exported MP4 inside the local Output folder in Finder/Explorer."""
    data = request.get_json(silent=True) or {}
    rel = str(data.get('file') or '').strip()
    out_root = (ROOT / 'Output').resolve()
    reels_dir = (out_root / 'reels').resolve()
    reels_dir.mkdir(parents=True, exist_ok=True)
    target = (ROOT / rel).resolve() if rel else reels_dir
    if not str(target).startswith(str(out_root)):
        return jsonify(error='Invalid output path'), 400
    if not target.exists():
        target = reels_dir
    try:
        if sys.platform == 'darwin':
            if target.is_file():
                subprocess.Popen(['open', '-R', str(target)])
            else:
                subprocess.Popen(['open', str(target)])
        elif sys.platform == 'win32':
            if target.is_file():
                subprocess.Popen(['explorer', '/select,', str(target)])
            else:
                subprocess.Popen(['explorer', str(target)])
        else:
            subprocess.Popen(['xdg-open', str(target.parent if target.is_file() else target)])
        return jsonify(ok=True, path=str(target))
    except Exception as exc:
        return jsonify(error=str(exc)), 500


@app.post('/api/open-audio-folder')
def open_audio_folder():
    """Open the app's local Assets/audio (or reciter subfolder) in Finder/Explorer."""
    data = request.get_json(silent=True) or {}
    sub = str(data.get('folder') or '').strip()
    audio_root = reciter_manager.audio_base_dir(ROOT)
    audio_root.mkdir(parents=True, exist_ok=True)
    target = (audio_root / Path(sub).name).resolve() if sub else audio_root
    if not str(target).startswith(str(audio_root)):
        target = audio_root
    target.mkdir(parents=True, exist_ok=True)
    try:
        if sys.platform == 'darwin':
            subprocess.Popen(['open', str(target)])
        elif sys.platform == 'win32':
            subprocess.Popen(['explorer', str(target)])
        else:
            subprocess.Popen(['xdg-open', str(target)])
        return jsonify(ok=True, path=str(target))
    except Exception as exc:
        return jsonify(error=str(exc)), 500


@app.post('/api/select-audio-folder')
def select_audio_folder():
    """Open a native folder picker so the user can choose where their Quran Audio is saved."""
    try:
        chosen = ''
        if sys.platform == 'darwin':
            res = subprocess.run(
                [
                    'osascript',
                    '-e',
                    'POSIX path of (choose folder with prompt "Select the folder where your Quran Audio is saved:")',
                ],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if res.returncode != 0:
                return jsonify(ok=False, cancelled=True)
            chosen = res.stdout.strip()
        elif sys.platform == 'win32':
            ps = (
                'Add-Type -AssemblyName System.Windows.Forms; '
                '$f = New-Object System.Windows.Forms.FolderBrowserDialog; '
                '$f.Description = "Select the folder where your Quran Audio is saved"; '
                'if ($f.ShowDialog() -eq "OK") { Write-Output $f.SelectedPath }'
            )
            res = subprocess.run(
                ['powershell', '-NoProfile', '-Command', ps],
                capture_output=True,
                text=True,
                timeout=120,
            )
            chosen = res.stdout.strip()
            if not chosen:
                return jsonify(ok=False, cancelled=True)
        else:
            return jsonify(ok=False, error='Folder picker is supported on macOS and Windows.'), 400

        saved = reciter_manager.set_custom_audio_dir(ROOT, chosen)
        return jsonify(ok=True, path=str(saved))
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)), 500


@app.get('/guide-screenshots/<path:filename>')
def serve_guide_screenshot(filename):
    shots_dir = (ROOT / 'docs' / 'guide_screenshots').resolve()
    if not shots_dir.is_dir():
        return jsonify(error='Guide screenshots not found'), 404
    return send_from_directory(shots_dir, filename)


@app.get('/user-guide')
def serve_user_guide():
    """Serve the bilingual User Guide inside the app with resolved asset URLs."""
    candidates = [
        ROOT / 'USER_GUIDE.html',
        ROOT.parent / 'USER_GUIDE.html',
    ]
    guide_path = next((p for p in candidates if p.is_file()), None)
    if not guide_path:
        return jsonify(error='User Guide not found'), 404
    html = guide_path.read_text(encoding='utf-8')
    html = html.replace('./Project Development/static/', '/assets/')
    html = html.replace('./Project Development/Assets/', '/assets/')
    html = html.replace('./Project Development/docs/guide_screenshots/', '/guide-screenshots/')
    return html, 200, {'Content-Type': 'text/html; charset=utf-8'}


@app.post('/api/open-guide')
def open_user_guide():
    """Open the bundled User Guide in the system's default browser."""
    import webbrowser
    url = request.host_url.rstrip('/') + '/user-guide'
    try:
        webbrowser.open(url)
        return jsonify(ok=True, url=url)
    except Exception as exc:
        return jsonify(error=str(exc)), 500



# QVS_SECTION3_MERGED_V1: Local background importer
@app.post('/api/background-import')
def qvs_background_import():
    import re
    import uuid
    import subprocess
    from PIL import Image

    kind = request.form.get('kind')
    extensions = {
        'video': {'.mp4','.mov','.m4v','.webm'},
        'image': {'.jpg','.jpeg','.png','.webp'}
    }

    if kind not in extensions:
        return jsonify(error='Choose Videos or Images first'), 400

    entries = request.files.getlist('files')
    if not entries or len(entries) > 20:
        return jsonify(error='Choose 1 to 20 files'), 400

    dest = ROOT/'Assets'/'Background Templates'/(
        'Videos' if kind == 'video' else 'Images'
    )
    dest.mkdir(parents=True,exist_ok=True)
    imported = []
    duplicates = []   # RELEASE_AUDIT Phase 3: hash-based dedup on import

    for item in entries:
        name = Path(item.filename or '').name
        ext = Path(name).suffix.lower()

        if ext not in extensions[kind]:
            return jsonify(error=f'Unsupported file type: {name}'), 400

        safe = re.sub(
            r'[^\w .()-]', '_', Path(name).stem, flags=re.UNICODE
        ).strip(' .')[:80] or 'background'

        target = dest/(safe+ext)
        if target.exists():
            target = dest/(safe+'-'+uuid.uuid4().hex[:8]+ext)

        temporary = dest/('.qvs-upload-'+uuid.uuid4().hex+ext)

        try:
            with temporary.open('wb') as output:
                total = 0
                while True:
                    chunk = item.stream.read(1024*1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > 500*1024*1024:
                        raise ValueError('File exceeds 500 MB limit')
                    output.write(chunk)

            if not total:
                raise ValueError('Empty file')

            if kind == 'image':
                with Image.open(temporary) as im:
                    im.verify()
            else:
                result = subprocess.run(
                    ['ffprobe','-v','error',
                     '-select_streams','v:0',
                     '-show_entries','stream=codec_type',
                     '-of','default=nw=1:nk=1',
                     str(temporary)],
                    capture_output=True,text=True,timeout=40
                )
                if result.returncode or 'video' not in result.stdout:
                    raise ValueError('Invalid video file')

            # Skip an exact re-import. Only files of the same size are hashed,
            # so this stays cheap even with large background videos.
            checksum = background_fingerprint(temporary)
            duplicate = None
            for existing in dest.iterdir():
                if not existing.is_file() or existing == temporary:
                    continue
                if existing.stat().st_size != total:
                    continue
                try:
                    if background_fingerprint(existing) == checksum:
                        duplicate = existing.name
                        break
                except OSError:
                    continue
            if duplicate:
                temporary.unlink(missing_ok=True)
                duplicates.append({'file': name, 'duplicate_of': duplicate})
                continue

            temporary.replace(target)
            imported.append(target.name)

        except (ValueError,OSError,subprocess.TimeoutExpired) as exc:
            temporary.unlink(missing_ok=True)
            return jsonify(error=f'{name}: {exc}',files=imported), 400

    return jsonify(files=imported, duplicates=duplicates)




# QVS_SECTION2_AUDIO_ROUTES_START
from array import array
from functools import lru_cache
import struct
import subprocess

QVS_PROJECT_ROOT = Path(os.environ['QVS_ROOT']).resolve() if os.environ.get('QVS_ROOT') else Path(__file__).resolve().parent
QVS_AUDIO_ROOT = QVS_PROJECT_ROOT / "Assets" / "audio" / "Al-Ajmi-114-Surahs"

def qvs_find_surah_mp3(surah_number: int, source_id: str | None = None) -> Path:
    # A loaded folder supplies the recording the user confirmed for this
    # Surah. The built-in library keeps its exact historical lookup.
    if source_id and source_id != audio_sources.LEGACY_ID:
        source = audio_sources.get(QVS_PROJECT_ROOT, source_id)
        recording = audio_sources.recording_for_surah(source, int(surah_number))
        return Path(recording["path"])

    prefix = f"{int(surah_number):03d}"
    if not QVS_AUDIO_ROOT.exists():
        raise FileNotFoundError(f"Audio root not found: {QVS_AUDIO_ROOT}")
    for folder in sorted(QVS_AUDIO_ROOT.iterdir()):
        if folder.is_dir() and folder.name.startswith(prefix):
            mp3s = sorted(folder.glob("*.mp3"))
            if mp3s:
                return mp3s[0]
    raise FileNotFoundError(f"No full Surah MP3 found for {prefix}")

def qvs_recording_signature(surah_number: int, source_id: str | None = None) -> str:
    """Fingerprint of the exact MP3 chosen for this Surah right now.

    The folder id alone is not an identity: a Surah can be re-pointed to a
    different file inside the same folder. Every duration, peak map, pause
    list and plan is keyed by this fingerprint, so a reassignment can never
    reuse the previous recording's cached result.
    """
    path = qvs_find_surah_mp3(surah_number, source_id)
    try:
        st = path.stat()
    except OSError:
        return ""
    return f"{st.st_size}:{st.st_mtime_ns}"

def qvs_audio_duration(surah_number: int, source_id: str | None = None) -> float:
    return _qvs_audio_duration_cached(
        surah_number, source_id,
        qvs_recording_signature(surah_number, source_id),
    )

@lru_cache(maxsize=256)
def _qvs_audio_duration_cached(surah_number: int, source_id: str | None,
                               recording: str) -> float:
    path = qvs_find_surah_mp3(surah_number, source_id)
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1",
        str(path),
    ]
    out = subprocess.check_output(cmd, text=True).strip()
    return float(out)

# QVS_WAVEFORM_ENGINE_V1
# A pro-style peak map is built once per Surah: the master MP3 is decoded
# a single time into min/max peaks for every 8 ms of audio. That map is
# cached in memory and on disk, so every zoom level is served instantly and
# behaves identically for a 40-second Surah and a two-hour Surah. Zoom
# levels deeper than one peak bucket decode only the small visible window,
# which is cheap because the window is short.

QVS_WAVE_CACHE_DIR = QVS_PROJECT_ROOT / ".qvs_cache"
QVS_ANALYSIS_RATE = 8000
QVS_BASE_BUCKET = 64                 # 8 ms of audio per peak bucket
QVS_MAX_LIVE_RATE = 44100

try:
    import audioop as _audioop        # removed in Python 3.13, optional below
except Exception:
    _audioop = None

_qvs_analysis_lock = Lock()


def _qvs_peak_cache_file(surah_number: int, source_id: str | None = None) -> Path:
    if source_id and source_id != audio_sources.LEGACY_ID:
        return QVS_WAVE_CACHE_DIR / f"peaks-{source_id}-{int(surah_number):03d}.bin"
    return QVS_WAVE_CACHE_DIR / f"peaks-{int(surah_number):03d}.bin"


def _qvs_write_peak_cache(surah_number, rate, bucket, duration, mins, maxs,
                          source_id: str | None = None, recording: str = ""):
    """Persist the peak map so the next visit opens instantly.

    The recording fingerprint is stored in the header. A file left behind
    by a different MP3 for the same Surah is ignored instead of reused.
    """
    try:
        QVS_WAVE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        target = _qvs_peak_cache_file(surah_number, source_id)
        tmp = target.with_name(target.name + ".tmp")
        signature = (recording or "").encode("utf-8")
        with open(tmp, "wb") as fh:
            fh.write(b"QVSP2\x00")
            fh.write(struct.pack("<I", len(signature)))
            fh.write(signature)
            fh.write(struct.pack("<IIdI", rate, bucket, float(duration), len(mins)))
            fh.write(mins.tobytes())
            fh.write(maxs.tobytes())
        tmp.replace(target)
    except OSError:
        pass


def _qvs_read_peak_cache(surah_number, source_id: str | None = None,
                         recording: str = ""):
    path = _qvs_peak_cache_file(surah_number, source_id)
    try:
        with open(path, "rb") as fh:
            magic = fh.read(6)
            if magic == b"QVSP1\x00":
                # The first cache format had no recording fingerprint. It is
                # only trusted for the built-in library, whose chosen MP3
                # cannot be reassigned. A copied external cache is rebuilt.
                if source_id and source_id != audio_sources.LEGACY_ID:
                    return None
                header = fh.read(20)
                if len(header) != 20:
                    return None
                rate, bucket, duration, count = struct.unpack("<IIdI", header)
                blob = fh.read()
            elif magic == b"QVSP2\x00":
                raw_length = fh.read(4)
                if len(raw_length) != 4:
                    return None
                stored_length = struct.unpack("<I", raw_length)[0]
                if stored_length > 4096:
                    return None
                stored = fh.read(stored_length).decode("utf-8", "replace")
                if stored != (recording or ""):
                    return None
                header = fh.read(20)
                if len(header) != 20:
                    return None
                rate, bucket, duration, count = struct.unpack("<IIdI", header)
                blob = fh.read()
            else:
                return None
        mins = array("h")
        mins.frombytes(blob[: count * 2])
        maxs = array("h")
        maxs.frombytes(blob[count * 2: count * 4])
        if len(mins) != count or len(maxs) != count:
            return None
        return {
            "rate": rate,
            "bucket": bucket,
            "duration": duration,
            "mins": mins,
            "maxs": maxs,
        }
    except (OSError, ValueError, struct.error):
        return None


def _qvs_bucket_peaks(block: bytes, bucket: int):
    """min/max of every `bucket` sized group of 16-bit samples."""
    mins = array("h")
    maxs = array("h")
    size = bucket * 2

    if _audioop is not None:
        for offset in range(0, len(block) - size + 1, size):
            low, high = _audioop.minmax(block[offset:offset + size], 2)
            mins.append(low)
            maxs.append(high)
        return mins, maxs

    values = array("h")
    values.frombytes(block)
    for index in range(0, len(values) - bucket + 1, bucket):
        chunk = values[index:index + bucket]
        mins.append(min(chunk))
        maxs.append(max(chunk))
    return mins, maxs


def qvs_analyse_surah(surah_number: int, source_id: str | None = None):
    return _qvs_analyse_surah_cached(
        surah_number, source_id,
        qvs_recording_signature(surah_number, source_id),
    )


@lru_cache(maxsize=8)
def _qvs_analyse_surah_cached(surah_number: int, source_id: str | None,
                              recording: str):
    """Decode the master recording once and keep its peak map."""
    with _qvs_analysis_lock:
        cached = _qvs_read_peak_cache(surah_number, source_id, recording)
        if cached:
            return cached

        return _qvs_build_peak_map(surah_number, source_id, recording)


def _qvs_build_peak_map(surah_number: int, source_id: str | None = None,
                        recording: str = ""):
    path = qvs_find_surah_mp3(surah_number, source_id)
    duration = qvs_audio_duration(surah_number, source_id)
    bucket = QVS_BASE_BUCKET

    cmd = [
        "ffmpeg", "-v", "error",
        "-i", str(path),
        "-ac", "1",
        "-ar", str(QVS_ANALYSIS_RATE),
        "-f", "s16le",
        "-"
    ]

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )

    mins = array("h")
    maxs = array("h")
    leftover = b""
    chunk_bytes = bucket * 2 * 4096

    try:
        while True:
            block = proc.stdout.read(chunk_bytes)
            if not block:
                break
            block = leftover + block
            usable = (len(block) // (bucket * 2)) * (bucket * 2)
            leftover = block[usable:]
            if not usable:
                continue
            low, high = _qvs_bucket_peaks(block[:usable], bucket)
            mins.extend(low)
            maxs.extend(high)
        proc.wait(timeout=120)
    except Exception:
        proc.kill()
        raise
    finally:
        try:
            proc.stdout.close()
        except Exception:
            pass

    if not len(mins):
        raise RuntimeError(
            f"No waveform data could be read for Surah {surah_number}"
        )

    _qvs_write_peak_cache(
        surah_number, QVS_ANALYSIS_RATE, bucket, duration, mins, maxs,
        source_id, recording,
    )

    return {
        "rate": QVS_ANALYSIS_RATE,
        "bucket": bucket,
        "duration": duration,
        "mins": mins,
        "maxs": maxs,
    }


def _qvs_peaks_from_map(analysis, start, end, columns):
    """Peak envelope for a window, read from the cached peak map."""
    mins = analysis["mins"]
    maxs = analysis["maxs"]
    rate = analysis["rate"]
    bucket = analysis["bucket"]
    count = len(mins)
    span = end - start
    out = array("h")

    for column in range(columns):
        first = int((start + span * column / columns) * rate) // bucket
        last = int((start + span * (column + 1) / columns) * rate) // bucket
        if last <= first:
            last = first + 1
        if first < 0:
            first = 0
        if last > count:
            last = count
        if last <= first:
            out.append(0)
            out.append(0)
            continue
        out.append(min(mins[first:last]))
        out.append(max(maxs[first:last]))

    return out


def _qvs_peaks_from_audio(path, start, end, columns):
    """Live peak envelope for a short window, decoded at a matching rate.

    A plain input seek lands on an MP3 frame boundary and leaves the first
    part of that frame as silence, which wipes out a very short window.
    Seeking a second time as an output option lands exactly on the
    requested time, because the resampler keeps the timeline aligned with
    the first seek point.
    """
    span = max(0.0005, end - start)
    wanted = int(columns * 12 / span)
    wanted = max(8000, min(QVS_MAX_LIVE_RATE, wanted))

    guard = min(1.0, max(0.0, start))

    cmd = [
        "ffmpeg", "-v", "error",
        "-ss", f"{start - guard:.6f}",
        "-i", str(path),
        "-ss", f"{guard:.6f}",
        "-t", f"{span:.6f}",
        "-ac", "1",
        "-ar", str(wanted),
        "-f", "s16le",
        "-"
    ]

    raw = subprocess.check_output(cmd)
    values = array("h")
    values.frombytes(raw)
    count = len(values)
    out = array("h")

    if not count:
        return out, wanted, 0

    # One column needs at least one sample, so a very short window cannot
    # offer more columns than the recording actually has samples for.
    usable = max(1, min(columns, count))

    for column in range(usable):
        first = (column * count) // usable
        last = max(first + 1, ((column + 1) * count) // usable)
        out.append(min(values[first:last]))
        out.append(max(values[first:last]))

    return out, wanted, usable


def _qvs_silence_runs(surah_number: int, threshold_db: int, min_duration: float,
                      source_id: str | None = None):
    return _qvs_silence_runs_cached(
        surah_number, threshold_db, min_duration, source_id,
        qvs_recording_signature(surah_number, source_id),
    )


@lru_cache(maxsize=64)
def _qvs_silence_runs_cached(surah_number: int, threshold_db: int,
                             min_duration: float, source_id: str | None,
                             recording: str):
    """Silent stretches of the complete recording, read from the peak map."""
    analysis = qvs_analyse_surah(surah_number, source_id)
    limit = int(32768 * (10 ** (threshold_db / 20.0)))
    runs = []
    opened = None

    for index, (low, high) in enumerate(zip(analysis["mins"], analysis["maxs"])):
        loudest = high if high > -low else -low
        if loudest < limit:
            if opened is None:
                opened = index
        elif opened is not None:
            runs.append((opened, index))
            opened = None

    if opened is not None:
        runs.append((opened, len(analysis["maxs"])))

    bucket = analysis["bucket"]
    rate = analysis["rate"]
    found = []
    for first, last in runs:
        start = first * bucket / rate
        end = last * bucket / rate
        if end - start >= min_duration:
            found.append((start, end))
    return tuple(found)


def qvs_detect_pauses(surah_number: int, source_id: str | None = None):
    return _qvs_detect_pauses_cached(
        surah_number, source_id,
        qvs_recording_signature(surah_number, source_id),
    )


@lru_cache(maxsize=128)
def _qvs_detect_pauses_cached(surah_number: int, source_id: str | None,
                              recording: str):
    """Quiet gaps of the complete recording (default sensitivity)."""
    return [
        {"start": start, "end": end}
        for start, end in _qvs_silence_runs(
            surah_number, -20, 0.18, source_id
        )
    ]

@app.get("/api/audio-source/<int:surah_number>")
def qvs_audio_source(surah_number: int):
    source = _source_arg()
    try:
        path = qvs_find_surah_mp3(surah_number, source)
        source_info = audio_sources.get(ROOT, source)
    except audio_sources.AudioSourceError as exc:
        return jsonify({"error": exc.message}), exc.status
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404
    return jsonify({
        "surah": surah_number,
        "title": path.stem,
        "url": f"/api/audio-file/{surah_number}" + (
            f"?source={source}" if source else ""
        ),
        "duration": qvs_audio_duration(surah_number, source),
        "source": source,
        "timing_available": quran_assets.has_timing(ROOT, source, surah_number),
        "text_available": quran_assets.text_available(ROOT, source, surah_number),
        "corrected": quran_assets.is_corrected(ROOT, source, surah_number),
    })

@app.get("/api/audio-file/<int:surah_number>")
def qvs_audio_file(surah_number: int):
    source = _source_arg()
    try:
        path = qvs_find_surah_mp3(surah_number, source)
    except audio_sources.AudioSourceError as exc:
        return jsonify({"error": exc.message}), exc.status
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404
    return send_file(path, mimetype="audio/mpeg", conditional=True)

@app.get("/api/surah-waveform/<int:surah_number>")
def qvs_surah_waveform(surah_number: int):
    """Peak envelope and quiet gaps for any window of the master recording.

    The window may be the whole Surah or a fraction of a second, so the
    waveform stays accurate at every zoom level.
    """
    source = _source_arg()
    try:
        start = max(0.0, float(request.args.get("start", 0)))
        end = float(request.args.get("end", start + 180))
        columns = int(request.args.get("columns", 1600))
        columns = max(200, min(columns, 4000))
        threshold = int(request.args.get("threshold", -20))
        threshold = max(-70, min(-10, threshold))
        min_silence = float(request.args.get("min_silence", 0.18))
        min_silence = max(0.02, min(5.0, min_silence))
    except Exception as e:
        return jsonify({"error": f"Bad parameters: {e}"}), 400

    if end <= start:
        return jsonify({"error": "End must be after start"}), 400

    try:
        analysis = qvs_analyse_surah(surah_number, source)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except audio_sources.AudioSourceError as e:
        return jsonify({"error": e.message}), e.status

    duration = analysis["duration"] or qvs_audio_duration(surah_number, source)
    end = min(end, duration)
    start = min(start, max(0.0, end - 0.001))
    span = end - start

    bucket_seconds = analysis["bucket"] / analysis["rate"]
    column_seconds = span / columns

    if column_seconds >= bucket_seconds:
        peaks = _qvs_peaks_from_map(analysis, start, end, columns)
        rate = analysis["rate"]
        used = columns
    else:
        path = qvs_find_surah_mp3(surah_number, source)
        peaks, rate, used = _qvs_peaks_from_audio(path, start, end, columns)

    pauses = []
    for pause_start, pause_end in _qvs_silence_runs(
        surah_number, threshold, min_silence, source
    ):
        if pause_end < start or pause_start > end:
            continue
        pauses.append({
            "start": max(start, pause_start),
            "end": min(end, pause_end),
        })

    return jsonify({
        "start": start,
        "end": end,
        "columns": used,
        "sample_rate": rate,
        "duration": duration,
        "peaks": list(peaks),
        "pauses": pauses,
    })

_SPEECH_PAUSE_CACHE = {}


@app.get("/api/speech-pauses/<int:surah_number>")
def qvs_speech_pauses(surah_number: int):
    """Pauses BETWEEN ayahs only (end of one ayah -> start of next).

    Silences inside an ayah are never returned, so text never hides mid-ayah.
    """
    import pause_detect
    source = _source_arg()
    try:
        path = qvs_find_surah_mp3(surah_number, source)
        entries = quran_assets.timings(ROOT, source, surah_number) or []
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except audio_sources.AudioSourceError as e:
        return jsonify({"error": e.message}), e.status
    except quran_assets.AssetError:
        entries = []
    ayahs = [{"ayah": int(x["ayah"]), "start": float(x["start"]), "end": float(x["end"])}
             for x in entries if x.get("end") is not None]
    key = (str(path), path.stat().st_mtime, tuple((a["start"], a["end"]) for a in ayahs))
    if key not in _SPEECH_PAUSE_CACHE:
        _SPEECH_PAUSE_CACHE[key] = pause_detect.boundary_pauses(path, ayahs) if ayahs else []
    return jsonify({"pauses": _SPEECH_PAUSE_CACHE[key]})

# QVS_SECTION2_AUDIO_ROUTES_END

if __name__=='__main__':
    app.run(host='127.0.0.1',port=int(os.getenv('QVS_PORT','5055')),debug=False,threaded=True)
