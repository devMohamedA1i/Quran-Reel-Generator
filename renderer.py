"""Local Quran video renderer using Pillow RAQM and FFmpeg. No cloud services."""
from pathlib import Path
import io
import json
import math
import os
import shutil
import subprocess
import tempfile
import threading
import uuid
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps, features
from quran import BASMALA, ENDING, selected_verses, audio_for, font_path, background_by_id, verse_display_text

W, H = 720, 1280
FPS = 30

from quran_display import display_verse, opening_entry, opening_text, opening_card_seconds


class ExportCancelled(RuntimeError):
    """Raised when the user cancels an active reel export."""


_JOB_LOCAL = threading.local()
_PROC_LOCK = threading.Lock()
_ACTIVE_PROCS = {}
_CANCELLED_JOBS = set()


def set_current_job(job_id):
    _JOB_LOCAL.job_id = job_id
    with _PROC_LOCK:
        _CANCELLED_JOBS.discard(job_id)


def clear_current_job(job_id):
    _JOB_LOCAL.job_id = None
    with _PROC_LOCK:
        _ACTIVE_PROCS.pop(job_id, None)
        _CANCELLED_JOBS.discard(job_id)


def is_job_cancelled(job_id=None):
    jid = job_id if job_id is not None else getattr(_JOB_LOCAL, 'job_id', None)
    if not jid:
        return False
    with _PROC_LOCK:
        return jid in _CANCELLED_JOBS


def cancel_export(job_id):
    with _PROC_LOCK:
        _CANCELLED_JOBS.add(job_id)
        proc = _ACTIVE_PROCS.get(job_id)
    if proc is not None and proc.poll() is None:
        try:
            proc.terminate()
        except OSError:
            pass


def command(args):
    jid = getattr(_JOB_LOCAL, 'job_id', None)
    if jid and is_job_cancelled(jid):
        raise ExportCancelled('Export cancelled by user')
    if not jid:
        result = subprocess.run(args, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError((result.stderr or result.stdout)[-2600:])
        return result
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    with _PROC_LOCK:
        if jid in _CANCELLED_JOBS:
            try:
                proc.terminate()
            except OSError:
                pass
            raise ExportCancelled('Export cancelled by user')
        _ACTIVE_PROCS[jid] = proc
    try:
        stdout, stderr = proc.communicate()
    finally:
        with _PROC_LOCK:
            if _ACTIVE_PROCS.get(jid) is proc:
                _ACTIVE_PROCS.pop(jid, None)
    if is_job_cancelled(jid):
        raise ExportCancelled('Export cancelled by user')
    if proc.returncode:
        raise RuntimeError((stderr or stdout)[-2600:])
    return subprocess.CompletedProcess(args, proc.returncode, stdout, stderr)


def duration(path):
    result = command(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(path)])
    return float(json.loads(result.stdout)['format']['duration'])


def choose_font(text, font, max_w, max_h, requested, direction="rtl", line_height=2.0):
    for px in range(int(requested), 17, -1):
        f = ImageFont.truetype(str(font),px,layout_engine=ImageFont.Layout.RAQM)
        drawer = ImageDraw.Draw(Image.new('RGB',(1,1)))
        lines=[]
        for para in text.split('\n'):
            if not para.strip(): continue
            current=''
            for word in para.split():
                trial = (current+' '+word).strip()
                if current and drawer.textlength(trial,font=f,direction=direction) > max_w:
                    lines.append(current); current=word
                else: current=trial
            if current: lines.append(current)
        step=int(px*line_height)
        if lines and len(lines)*step <= max_h and all(drawer.textlength(t,font=f,direction=direction)<=max_w for t in lines):
            return f,lines,step
    raise ValueError('Text does not fit the frame safe area; reduce font size or verse range.')


_HAFS_FONT_MAP = {}  # KFGQPC v18 text already matches the font


def normalize_quran_for_font(text: str) -> str:
    """Map Tanzil Uthmani codepoints to the glyphs UthmanicHafs1Ver18.ttf renders cleanly."""
    return text


def build_overlay(root, text, settings, heading=''):
    """Build the transparent Quran text overlay and return the image."""
    if not features.check('raqm'):
        raise RuntimeError('Pillow RAQM support required to render Arabic correctly')
    if isinstance(text, dict):
        return build_bilingual_overlay(root, text, settings)
    text = normalize_quran_for_font(text)
    font=font_path(root)
    size=int(settings.get('font_size',42))
    shift=int(settings.get('vertical_offset',0))
    opacity=int(settings.get('panel_opacity',155))
    text_color=settings.get('text_color','#ffffff')
    image=Image.new('RGBA',(W,H),(0,0,0,0))
    d=ImageDraw.Draw(image)
    # Restrict Arabic to a reliable safe-area; avoid clipping diacritical marks.
    max_w=W-126
    f, lines, step=choose_font(text,font,max_w,450,size)
    total=len(lines)*step
    cy=H//2+shift
    top=cy-total//2+step//2
    # A translucent panel ensures contrast on bright user-selected videos.
    pad=52
    d.rounded_rectangle((35,max(80,cy-total//2-pad),W-35,min(H-80,cy+total//2+pad)),radius=26,fill=(5,12,24,opacity))
    for i,line in enumerate(lines):
        d.text((W//2,top+i*step),line,font=f,direction='rtl',anchor='mm',fill=text_color,stroke_width=1,stroke_fill='#0b1525')
    return image


def build_bilingual_overlay(root, text, settings):
    """Fit complete Arabic and complete English; never truncate scripture."""
    if not features.check('raqm'):
        raise RuntimeError('Pillow RAQM support required to render Arabic correctly')
    candidates = [
        Path(root)/'Assets/fonts/English.ttf',
        Path('/System/Library/Fonts/Supplemental/Arial.ttf'),
        Path('C:/Windows/Fonts/arial.ttf'),
        Path('C:/Windows/Fonts/segoeui.ttf'),
        Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
        Path('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'),
    ]
    latin = next((p for p in candidates if p.is_file()), None)
    if latin is None:
        raise FileNotFoundError('English font missing: add Assets/fonts/English.ttf')
    has_english = bool(text.get('english'))
    for size in range(int(settings.get('font_size', 42)), 17, -1):
        af, alines, astep = choose_font(text['arabic'], font_path(root), W-126, 10000, size)
        ef, elines, estep = choose_font(text['english'], latin, W-126, 10000,
                                      max(18, round(size*.58)), 'ltr', 1.4) if has_english else (None,[],0)
        total = len(alines)*astep + (24+len(elines)*estep if has_english else 0)
        total += 44 if text.get('surah_name') else 0
        total += 34 if text.get('surah_name_en') else 0
        if total <= H-240:
            break
    else:
        raise ValueError('Arabic and English do not fit safely; use a shorter verse range.')
    image = Image.new('RGBA', (W,H), (0,0,0,0))
    draw = ImageDraw.Draw(image)
    cy = max(100+total//2, min(H-100-total//2, H//2+int(settings.get('vertical_offset',0))))
    top = cy-total/2
    draw.rounded_rectangle((35,top-24,W-35,top+total+24),radius=26,
                           fill=(5,12,24,int(settings.get('panel_opacity',155))))
    color = settings.get('text_color','#FFFFFF')
    for line in alines:
        draw.text((W//2,top+astep/2),line,font=af,direction='rtl',anchor='mm',fill=color,
                  stroke_width=1,stroke_fill='#0b1525')
        top += astep
    if has_english:
        top += 24
    for line in elines:
        draw.text((W//2,top+estep/2),line,font=ef,direction='ltr',anchor='mm',fill=color)
        top += estep
    if text.get('surah_name'):
        name_font = ImageFont.truetype(str(font_path(root)),26,layout_engine=ImageFont.Layout.RAQM)
        draw.text((W//2,top+22),text['surah_name'],font=name_font,direction='rtl',anchor='mm',fill=color)
        top += 44
    if text.get('surah_name_en'):
        en_name_font = ImageFont.truetype(str(latin),21,layout_engine=ImageFont.Layout.RAQM)
        draw.text((W//2,top+17),text['surah_name_en'],font=en_name_font,direction='ltr',anchor='mm',fill=color)
        top += 34
    return image


def make_overlay(root, text, output, settings, heading=''):
    image = build_overlay(root, text, settings, heading)
    output.parent.mkdir(parents=True,exist_ok=True)
    image.save(output)


VALID_EFFECTS = (
    'none', 'fade', 'slow_zoom', 'pan', 'fade_slow', 'fade_fast',
    'monochrome', 'warm_cinematic', 'cool_cinematic', 'vintage',
    'soft_focus', 'vignette',
    'golden_hour', 'emerald_mist', 'night_calm',
    'soft_dim', 'muted_tone', 'crisp_clear',
)


def parse_effects(effect):
    """Parse single or comma-separated effect string/list into unique valid names."""
    if isinstance(effect, (list, tuple)):
        raw = [str(x).strip() for x in effect if str(x).strip()]
    else:
        raw = [x.strip() for x in str(effect or 'none').split(',') if x.strip()]
    seen = []
    for item in raw:
        if item not in seen:
            seen.append(item)
    return seen or ['none']


def validate_settings(root, opts):
    if opts.get('text_language', 'ar') not in ('ar', 'en'):
        raise ValueError('Invalid text language')
    surah=int(opts.get('surah',112))
    start=int(opts.get('start',1))
    from quran import load_surahs
    end=int(opts.get('end', len(load_surahs(root)[surah-1]['ayahs'])))
    _, verses=selected_verses(root,surah,start,end)
    bg=background_by_id(root,str(opts.get('background_id','')))
    effects=parse_effects(opts.get('effect','fade'))
    if any(eff not in VALID_EFFECTS for eff in effects):
        raise ValueError('Unknown video effect')
    if str(opts.get('resolution','720')) not in ('720',):
        raise ValueError('Only 720p is supported in the first tested build')
    for key,lo,hi,default in [('font_size',24,85,42),('vertical_offset',-230,230,0),('panel_opacity',0,235,155),('opening_seconds',1.5,8,3),('closing_seconds',1.5,8,3)]:
        val=float(opts.get(key,default))
        if not lo<=val<=hi: raise ValueError(f'{key} must be between {lo} and {hi}')
    if not 0.2 <= float(opts.get('basmala_split_seconds',2.6)) <= 12:
        raise ValueError('Invalid basmala split seconds')
    if opts.get('text_color','#ffffff') not in ('#ffffff', '#f8e6c0', '#d9f0ff', '#ffde9a', '#bceee6', '#ffd2de', '#d9c7ff', '#000000', '#ffd700', '#ff8c00', '#ff0000', '#dc143c', '#ff69b4', '#800080', '#0000ff', '#00bfff', '#00ffff', '#008000', '#00ff7f', '#8b4513', '#808080', '#c0c0c0', '#FFFFFF', '#FFFFF0', '#F5F5DC', '#D3D3D3', '#C0C0C0', '#D4AF37', '#FFFF00', '#FFD700', '#FF8C00', '#FF4500', '#FF0000', '#DC143C', '#800000', '#FFC0CB', '#FF69B4', '#FF1493', '#FF00FF', '#E6E6FA', '#D9C7FF', '#4B0082', '#0000FF', '#000080', '#4169E1', '#00BFFF', '#00FFFF', '#008080', '#00FF00', '#00FF7F', '#98FF98', '#808000', '#8B4513', '#D2691E', '#F8E6C0', '#D9F0FF', '#FFDE9A', '#BCEEE6', '#FFD2DE'):
        raise ValueError('Invalid text colour')
    return bg



def qvs_subtle_preview_effect(image, effect):
    """QVS_SUBTLE_EFFECTS_V1: background-only preview effects."""
    from PIL import ImageEnhance, ImageOps

    if effect not in (
        "warm_cinematic", "cool_cinematic",
        "vintage", "soft_focus", "vignette",
        "golden_hour", "emerald_mist", "night_calm",
        "soft_dim", "muted_tone", "crisp_clear",
    ):
        return image

    rgb = image.convert("RGB")

    if effect == "warm_cinematic":
        rgb = ImageEnhance.Color(rgb).enhance(1.12)
        rgb = ImageEnhance.Contrast(rgb).enhance(1.06)
        r, g, b = rgb.split()
        rgb = Image.merge("RGB", (
            r.point(lambda v: min(255, round(v * 1.07))),
            g,
            b.point(lambda v: round(v * 0.95))
        ))

    elif effect == "cool_cinematic":
        r, g, b = rgb.split()
        rgb = Image.merge("RGB", (
            r.point(lambda v: round(v * 0.96)),
            g,
            b.point(lambda v: min(255, round(v * 1.07)))
        ))

    elif effect == "vintage":
        rgb = ImageOps.colorize(
            ImageOps.grayscale(rgb),
            black="#30251c",
            white="#e4c79e"
        )

    elif effect == "soft_focus":
        rgb = rgb.filter(ImageFilter.GaussianBlur(1.4))

    elif effect == "vignette":
        w, h = rgb.size
        mask = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask)

        draw.ellipse(
            (-int(w*.10), -int(h*.06),
             int(w*1.10), int(h*1.06)),
            fill=255
        )

        mask = mask.filter(
            ImageFilter.GaussianBlur(max(12, int(w*.15)))
        )

        dark = ImageEnhance.Brightness(rgb).enhance(0.65)
        rgb = Image.composite(rgb, dark, mask)

    elif effect == "golden_hour":
        rgb = ImageEnhance.Color(rgb).enhance(1.08)
        r, g, b = rgb.split()
        rgb = Image.merge("RGB", (
            r.point(lambda v: min(255, round(v * 1.10))),
            g.point(lambda v: min(255, round(v * 1.03))),
            b.point(lambda v: round(v * 0.88)),
        ))

    elif effect == "emerald_mist":
        rgb = ImageEnhance.Brightness(rgb).enhance(0.92)
        r, g, b = rgb.split()
        rgb = Image.merge("RGB", (
            r.point(lambda v: round(v * 0.88)),
            g.point(lambda v: min(255, round(v * 1.04))),
            b.point(lambda v: min(255, round(v * 1.03))),
        ))

    elif effect == "night_calm":
        rgb = ImageEnhance.Brightness(rgb).enhance(0.76)
        rgb = ImageEnhance.Color(rgb).enhance(0.88)
        r, g, b = rgb.split()
        rgb = Image.merge("RGB", (
            r.point(lambda v: round(v * 0.90)),
            g.point(lambda v: round(v * 0.96)),
            b.point(lambda v: min(255, round(v * 1.08))),
        ))

    elif effect == "soft_dim":
        rgb = ImageEnhance.Brightness(rgb).enhance(0.78)

    elif effect == "muted_tone":
        rgb = ImageEnhance.Color(rgb).enhance(0.62)
        rgb = ImageEnhance.Contrast(rgb).enhance(0.96)

    elif effect == "crisp_clear":
        rgb = ImageEnhance.Contrast(rgb).enhance(1.12)
        rgb = ImageEnhance.Sharpness(rgb).enhance(1.25)

    return rgb.convert("RGBA")


def _preview_arabic_text(root, opts):
    """Sample verse text and heading used by the preview panel.

    In reel mode the composition shows the Ayah that is being recited at
    the given time. The built-in library uses the Al-Ajmi timing data. An
    external recording only ever uses text and timing attached to that same
    source; without text it shows the Surah name, never another reciter's
    verses.
    """
    sn = int(opts.get('surah', 112))
    from quran import load_surahs
    surah = load_surahs(root)[sn-1]
    source = opts.get('source')
    external = bool(source) and source != 'legacy'

    if external:
        import quran_assets
        try:
            text_verses = quran_assets.verses(root, source, sn)
        except quran_assets.AssetError:
            text_verses = []
        heading = surah['name']
        if not text_verses:
            return heading, heading
        number = 1
        if opts.get('reel_mode') and opts.get('preview_time') is not None:
            try:
                found = quran_assets.ayah_at(
                    root, source, sn, float(opts.get('preview_time'))
                )
            except (quran_assets.AssetError, TypeError, ValueError):
                found = None
            timed = quran_assets.has_timing(root, source, sn)
            if found and 1 <= found <= len(text_verses):
                number = found
            elif timed:
                # Inside a gap or after the timed part of the recording:
                # never carry an unrelated verse onto this audio.
                return heading, heading
        else:
            try:
                start = int(opts.get('start') or 1)
            except (TypeError, ValueError):
                start = 1
            number = max(1, min(start, len(text_verses)))
        return (
            verse_display_text(sn, number, text_verses[number-1]['text']),
            f"{heading}  •  {number}",
        )

    surah, verses = selected_verses(
        root, sn,
        int(opts.get('start') or 1),
        len(surah['ayahs']) if opts.get('reel_mode') else int(opts.get('end') or len(surah['ayahs'])),
    )
    number = int(verses[0]['numberInSurah'])

    if opts.get('reel_mode'):
        import ayah_data
        moment = opts.get('preview_time')
        heading = surah['name']
        if moment is not None:
            try:
                ayah = ayah_data.ayah_at(root, sn, float(moment))
            except (ValueError, TypeError):
                ayah = None
            if ayah and 1 <= ayah <= len(verses):
                return verses[ayah - 1]['text'], f"{heading}  •  {ayah}"
            return surah['name'], heading
        return surah['name'], heading

    if int(surah['number']) == 1 and number == 1:
        return BASMALA, ''
    return (
        verse_display_text(int(surah['number']), number, verses[0]['text']),
        f"{surah['name']}  •  {number}",
    )


def preview_text(root, opts):
    sn = int(opts.get('surah',112))
    source = opts.get('source')
    moment = opts.get('preview_time')
    if opts.get('reel_mode') and moment is not None:
        entry = opening_entry(root, source, sn)
        if entry and entry['start'] <= float(moment) < entry['end']:
            import quran_assets
            if quran_assets.text_available(root, source, sn):
                return opening_text(root, opts), ''
    text, heading = _preview_arabic_text(root, opts)
    if '  •  ' in heading:
        number = int(heading.rsplit('  •  ',1)[1])
        return display_verse(root, sn, number, text, opts), heading
    if sn == 1 and text == BASMALA:
        return opening_text(root, opts), heading
    return text, heading


def render_sample(root, opts, out_path):
    """Write the composed still preview.

    `out_path` may be a filesystem path or an open binary stream. A stream
    keeps the preview entirely in memory, so nothing is written to disk.
    """
    bg = validate_settings(root, opts)
    sample_text, heading = preview_text(root, opts)
    overlay = build_overlay(root, sample_text, opts, heading)

    path = bg['path']
    if bg['kind'] == 'video':
        with tempfile.TemporaryDirectory() as folder:
            frame = Path(folder) / 'bg.png'
            command(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                     '-ss', '1', '-i', str(path), '-frames:v', '1', str(frame)])
            img = Image.open(frame).convert('RGB')
            img = _cover(img, opts)
            result = Image.alpha_composite(img, overlay)
            _save_jpeg(result, out_path)
        return

    img = Image.open(path).convert('RGB')
    img = _cover(img, opts)
    result = Image.alpha_composite(img, overlay)
    _save_jpeg(result, out_path)


def _cover(img, opts):
    """Scale and centre-crop the background to the frame size."""
    scale = max(W / img.width, H / img.height)
    img = img.resize((math.ceil(img.width * scale), math.ceil(img.height * scale)),
                     Image.Resampling.LANCZOS)
    img = img.crop(((img.width - W) // 2, (img.height - H) // 2,
                    (img.width + W) // 2, (img.height + H) // 2)).convert('RGBA')
    effects = parse_effects(opts.get('effect', 'fade'))
    if 'monochrome' in effects:
        img = ImageOps.grayscale(img.convert('RGB')).convert('RGBA')
    for eff in effects:
        img = qvs_subtle_preview_effect(img, eff)
    return img


def _save_jpeg(image, out_path):
    rgb = image.convert('RGB')
    if hasattr(out_path, 'write'):
        rgb.save(out_path, format='JPEG', quality=88)
    else:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        rgb.save(out_path, quality=88)


def render_overlay_png(root, opts):
    """Return the transparent Quran text overlay as PNG bytes."""
    validate_settings(root, opts)
    sample_text, heading = preview_text(root, opts)
    image = build_overlay(root, sample_text, opts, heading)
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()


def speech_windows(audio, offset, seconds):
    """Return ONE window [(start, end)] of the ayah's speech inside a segment.

    Only the gap before the first word and after the last word is removed;
    pauses inside the ayah are ignored so text never hides mid-ayah.
    """
    import pause_detect as pd
    try:
        r = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', f'{offset:.3f}',
                            '-t', f'{seconds:.3f}', '-i', str(audio), '-ac', '1', '-ar', str(pd.RATE),
                            '-f', 's16le', '-'], capture_output=True)
        from array import array
        pcm = array('h'); pcm.frombytes(r.stdout[:len(r.stdout) // 2 * 2])
        _, db = pd._frames_db(pcm, 0, seconds)
    except Exception:
        return [(0.0, seconds)]
    if len(db) < 20:
        return [(0.0, seconds)]
    thr = sorted(db)[int(len(db) * 0.9)] - pd.DROP_DB
    loud = [v >= thr for v in db]
    # Use a gentler tail threshold (-6 dB softer) so trailing syllables / madd / ghunnah
    # at the end of an ayah are 100% captured before the text begins to fade out.
    tail_thr = thr - 6.0
    tail_loud = [v >= tail_thr for v in db]
    first = next((i for i in range(len(db) - 2) if all(loud[i:i + 3])), None)
    last = next((i for i in range(len(db) - 1, 1, -1) if all(tail_loud[i - 2:i + 1])), None)
    if first is None or last is None or last <= first:
        return []
    a_ = first * pd.FRAME_S
    # Keep text solid for +0.18s after the final audible syllable so 100% of the sentence completes
    b_ = min(seconds, (last + 1) * pd.FRAME_S + 0.18)
    return [(a_, b_)] if b_ - a_ >= 0.35 else []


def probe_fps(path):
    """Return the source video's native integer/rounded fps (e.g. 24, 25, 30), defaulting to FPS."""
    try:
        raw = subprocess.check_output([
            'ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=r_frame_rate',
            '-of', 'default=noprint_wrappers=1:nokey=1', str(path),
        ], text=True).strip()
        if '/' in raw:
            num, den = raw.split('/', 1)
            val = float(num) / max(1.0, float(den))
        else:
            val = float(raw)
        if not math.isfinite(val) or val < 10:
            return FPS
        rounded = int(round(val))
        # Preserve exact native fps (24/25/30/50/60) so 60fps videos never lose half their frames
        return max(20, min(60, rounded))
    except Exception:
        return FPS


def _seamless_loop_bg(bg, tmp, fade=1.5, out_fps=None):
    """Build a calmly crossfaded seamless loop of a video background once per export."""
    if bg.get('kind') != 'video':
        return bg
    try:
        dur = duration(bg['path'])
    except Exception:
        return bg
    if dur <= 2.2:
        return bg
    target_fps = out_fps or probe_fps(bg['path'])
    # Calm 1.5s dissolve (capped to 1/3 of clip length for short backgrounds)
    fade = min(float(fade), dur / 3.0)
    out = Path(tmp) / 'bg_seamless_loop.mp4'
    # Crossfade the tail [dur-fade .. dur] into the head [0 .. fade], then keep [fade .. dur-fade]
    # so the resulting clip of length (dur - fade) loops seamlessly with -stream_loop -1.
    body_end = dur - fade
    fc = (
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={target_fps},split=3[h][m][t];"
        f"[h]trim=start=0:end={fade:.3f},setpts=PTS-STARTPTS,format=yuva420p,"
        f"fade=t=in:st=0:d={fade:.3f}:alpha=1[head];"
        f"[t]trim=start={body_end:.3f}:end={dur:.3f},setpts=PTS-STARTPTS,format=yuva420p[tail];"
        f"[tail][head]overlay=shortest=1,format=yuv420p[seam];"
        f"[m]trim=start={fade:.3f}:end={body_end:.3f},setpts=PTS-STARTPTS,format=yuv420p[mid];"
        f"[mid][seam]concat=n=2:v=1:a=0,fps={target_fps},format=yuv420p[v]"
    )
    try:
        command([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
            '-i', str(bg['path']),
            '-filter_complex', fc, '-map', '[v]', '-an',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
            '-r', str(target_fps), '-g', str(target_fps), '-keyint_min', str(target_fps),
            '-pix_fmt', 'yuv420p', str(out),
        ])
        if out.is_file() and out.stat().st_size > 0:
            return {**bg, 'path': out, 'fps': target_fps}
    except Exception:
        pass
    return {**bg, 'fps': target_fps}


def make_segment(bg,overlay,audio,path,seconds,effect,audio_start=0,bg_offset=0.0,text_window=None):
    # Consistent audio/video codecs across segments permit lossless concat copy.
    cmd=['ffmpeg','-hide_banner','-loglevel','error','-y']
    if bg['kind']=='video':
        # Frame-exact offset is applied inside the filtergraph (trim) instead of -ss before -i
        # so segments never snap/jump to keyframes across ayah boundaries or loop seams.
        cmd+=['-stream_loop','-1','-i',str(bg['path'])]
    else:
        cmd+=['-loop','1','-framerate',str(FPS),'-i',str(bg['path'])]
    cmd+=['-loop','1','-framerate',str(FPS),'-i',str(overlay)]
    if audio:
        if audio_start > 0: cmd+=['-ss',f'{audio_start:.3f}']
        cmd+=['-i',str(audio)]
        audiomap='2:a:0'
    else:
        cmd+=['-f','lavfi','-i','anullsrc=r=44100:cl=stereo']
        audiomap='2:a:0'
    effects = parse_effects(effect)
    prefix = f'trim=start={bg_offset:.3f}:duration={seconds:.3f},setpts=PTS-STARTPTS,' if (bg['kind'] == 'video' and bg_offset > 0.001) else ''
    base=f'{prefix}scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS}'
    if 'slow_zoom' in effects:
        # zoompan performed after initial crop; one input frame per output frame.
        base+=f",zoompan=z='min(zoom+0.00032,1.13)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS}"
    elif 'pan' in effects:
        base=f"{prefix}scale={W+90}:{H+160}:force_original_aspect_ratio=increase,crop={W}:{H}:x='45+25*sin(t/2)':y=80,setsar=1,fps={FPS}"
    if 'monochrome' in effects:
        base += ',hue=s=0'

    # QVS_SUBTLE_EFFECTS_V1
    visual_filters = {
        "warm_cinematic":
            "eq=contrast=1.06:saturation=1.12,"
            "colorbalance=rs=.07:bs=-.05",

        "cool_cinematic":
            "eq=saturation=1.05,"
            "colorbalance=rs=-.04:bs=.07",

        "vintage":
            "colorchannelmixer="
            "rr=.46:rg=.52:rb=.12:"
            "gr=.34:gg=.58:gb=.08:"
            "br=.25:bg=.46:bb=.12",

        "soft_focus":
            "gblur=sigma=1.4",

        "vignette":
            "vignette=angle=PI/7",

        "golden_hour":
            "eq=saturation=1.08,"
            "colorbalance=rs=.09:gs=.03:bs=-.09",

        "emerald_mist":
            "eq=brightness=-0.06:saturation=0.95,"
            "colorbalance=rs=-.08:gs=.04:bs=.03",

        "night_calm":
            "eq=brightness=-0.16:saturation=0.88,"
            "colorbalance=rs=-.06:bs=.08",

        "soft_dim":
            "eq=brightness=-0.18",

        "muted_tone":
            "eq=saturation=0.62:contrast=0.96",

        "crisp_clear":
            "eq=contrast=1.12,unsharp=5:5:0.6:5:5:0.0",
    }

    for eff in effects:
        selected_filter = visual_filters.get(eff)
        if selected_filter:
            base += "," + selected_filter

    fade_key = next((e for e in ('fade_slow', 'fade_fast', 'fade') if e in effects), 'fade')
    fade_in, fade_out = {'fade': (0.6, 0.3), 'fade_slow': (1.0, 0.4),
                         'fade_fast': (0.25, 0.15)}.get(fade_key, (0.6, 0.3))
    wins = [(0.0, seconds)] if text_window is None else list(text_window)
    n = len(wins)
    if n == 0:
        comp = f'[0:v]{base},format=yuv420p[v]'
    else:
        # Fade ONLY the text overlay alpha: background stays continuous. Text
        # dissolves in when the ayah's first word starts and finishes fading out
        # right as the last word ends so text never lingers in pauses.
        parts = [f'[0:v]{base}[background]']
        labels = ''.join(f'[t{i}]' for i in range(n))
        parts.append(f'[1:v]format=rgba,split={n}{labels}' if n > 1 else '[1:v]format=rgba[t0]')
        for i,(a_,b_) in enumerate(wins):
            fi = max(0.05, min(fade_in, (b_-a_)/2))
            fo = max(0.05, min(fade_out, (b_-a_)/2))
            # Start fade-out AFTER 100% of the spoken sentence finishes (at b_),
            # clamped only so the dissolve completes before the segment ends.
            out_st = max(a_ + fi, min(b_, seconds - fo))
            parts.append(f'[t{i}]fade=t=in:st={a_:.3f}:d={fi:.3f}:alpha=1,'
                         f'fade=t=out:st={out_st:.3f}:d={fo:.3f}:alpha=1[o{i}]')
        prev='background'
        for i in range(n):
            parts.append(f'[{prev}][o{i}]overlay=format=auto[x{i}]'); prev=f'x{i}'
        comp=';'.join(parts)
        comp=comp.rsplit('[x%d]'%(n-1),1)[0]
        comp+=f'[x{n-1}];[x{n-1}]format=yuv420p[v]'
    cmd+=['-filter_complex',comp,'-map','[v]','-map',audiomap,
          '-t',f'{seconds:.3f}','-c:v','libx264','-preset','veryfast','-crf','23','-r',str(FPS),
          '-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-ar','44100','-ac','2',
          '-af','aresample=async=1:first_pts=0,apad','-movflags','+faststart',str(path)]
    command(cmd)


_DEFAULT_MAKE_SEGMENT = make_segment


def _build_base_video_filter(effects, out_fps=FPS):
    """Build the continuous background video filter chain (scale, crop, fps, motion, color looks)."""
    base = f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={out_fps}'
    if 'slow_zoom' in effects:
        base += f",zoompan=z='min(zoom+0.00025,1.13)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={out_fps}"
    elif 'pan' in effects:
        base = f"scale={W+90}:{H+160}:force_original_aspect_ratio=increase,crop={W}:{H}:x='45+25*sin(t/2)':y=80,setsar=1,fps={out_fps}"
    if 'monochrome' in effects:
        base += ',hue=s=0'
    visual_filters = {
        'warm_cinematic': 'eq=contrast=1.06:saturation=1.12,colorbalance=rs=.07:bs=-.05',
        'cool_cinematic': 'eq=saturation=1.05,colorbalance=rs=-.04:bs=.07',
        'vintage': 'colorchannelmixer=rr=.46:rg=.52:rb=.12:gr=.34:gg=.58:gb=.08:br=.25:bg=.46:bb=.12',
        'soft_focus': 'gblur=sigma=1.4',
        'vignette': 'vignette=angle=PI/7',
        'golden_hour': 'eq=saturation=1.08,colorbalance=rs=.09:gs=.03:bs=-.09',
        'emerald_mist': 'eq=brightness=-0.06:saturation=0.95,colorbalance=rs=-.08:gs=.04:bs=.03',
        'night_calm': 'eq=brightness=-0.16:saturation=0.88,colorbalance=rs=-.06:bs=.08',
        'soft_dim': 'eq=brightness=-0.18',
        'muted_tone': 'eq=saturation=0.62:contrast=0.96',
        'crisp_clear': 'eq=contrast=1.12,unsharp=5:5:0.6:5:5:0.0',
    }
    for eff in effects:
        flt = visual_filters.get(eff)
        if flt:
            base += ',' + flt
    return base


def _render_continuous_reel(bg, overlay_events, audio_path, audio_start, audio_dur,
                            prelude_secs, total_secs, effect, tmp, out_path, meta_args,
                            progress=None):
    """Render the entire reel in ONE continuous FFmpeg pass with constant low RAM (~150 MB).

    Instead of stacking N simultaneous infinite overlay streams (which spikes RAM on long reels),
    each Ayah PNG is bounded to its exact short window with `-t` and shifted via `setpts`,
    then released immediately on EOF (`eof_action=pass`). Also streams live FFmpeg `-progress`
    so the UI progress bar advances smoothly from 35% to 98%.
    """
    out_fps = int(bg.get('fps') or (probe_fps(bg['path']) if bg.get('kind') == 'video' else FPS))
    effects = parse_effects(effect)
    fade_key = next((e for e in ('fade_slow', 'fade_fast', 'fade') if e in effects), 'fade')
    fade_in, fade_out = {
        'fade': (0.6, 0.3),
        'fade_slow': (1.0, 0.4),
        'fade_fast': (0.25, 0.15),
    }.get(fade_key, (0.6, 0.3))

    # Build ONE sequential RGBA overlay stream using short bounded PNG inputs + transparent gaps
    # with explicit fps + settb on every segment so image2's default 1/25 timebase NEVER causes
    # duplicate-frame judder when composited onto a 30fps background.
    ov_segments = []
    cursor = 0.0
    for ev in sorted(overlay_events, key=lambda e: e['start']):
        t0 = max(cursor, float(ev['start']))
        t1 = float(ev['end'])
        seg_end = float(ev['seg_end'])
        span = max(0.1, t1 - t0)
        fi = max(0.05, min(fade_in, span / 2.0))
        fo = max(0.05, min(fade_out, span / 2.0))
        out_st_abs = max(t0 + fi, min(t1, seg_end - fo))
        vis_end = min(total_secs, out_st_abs + fo)
        if vis_end <= t0 + 0.05:
            continue
        if t0 > cursor + 0.02:
            ov_segments.append({'kind': 'gap', 'dur': t0 - cursor})
        ov_segments.append({
            'kind': 'png',
            'overlay': ev['overlay'],
            'dur': vis_end - t0,
            'fi': fi,
            'fo': fo,
            'out_st_rel': max(fi, (vis_end - t0) - fo),
        })
        cursor = vis_end
    if total_secs > cursor + 0.02:
        ov_segments.append({'kind': 'gap', 'dur': total_secs - cursor})

    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats']
    if bg['kind'] == 'video':
        cmd += ['-stream_loop', '-1', '-i', str(bg['path'])]
    else:
        cmd += ['-loop', '1', '-framerate', str(out_fps), '-i', str(bg['path'])]

    if audio_path and audio_dur > 0:
        if audio_start > 0:
            cmd += ['-ss', f'{audio_start:.3f}']
        cmd += ['-t', f'{audio_dur:.3f}', '-i', str(audio_path)]
    else:
        cmd += ['-f', 'lavfi', '-t', f'{total_secs:.3f}', '-i', 'anullsrc=r=44100:cl=stereo']

    parts = [
        f"[0:v]{_build_base_video_filter(effects, out_fps)},trim=duration={total_secs:.3f},setpts=PTS-STARTPTS,settb=1/{out_fps}[bg]"
    ]

    if ov_segments:
        in_idx = 2
        ov_labels = []
        for idx, seg in enumerate(ov_segments):
            lbl = f'os{idx}'
            if seg['kind'] == 'gap':
                parts.append(
                    f"color=c=black@0.0:s={W}x{H}:r={out_fps}:d={seg['dur']:.3f},format=rgba,settb=1/{out_fps}[{lbl}]"
                )
            else:
                cmd += ['-loop', '1', '-framerate', str(out_fps), '-t', f"{seg['dur']:.3f}", '-i', str(seg['overlay'])]
                parts.append(
                    f"[{in_idx}:v]fps={out_fps},format=rgba,setpts=PTS-STARTPTS,settb=1/{out_fps},"
                    f"fade=t=in:st=0:d={seg['fi']:.3f}:alpha=1,"
                    f"fade=t=out:st={seg['out_st_rel']:.3f}:d={seg['fo']:.3f}:alpha=1[{lbl}]"
                )
                in_idx += 1
            ov_labels.append(f'[{lbl}]')
        if len(ov_labels) == 1:
            parts.append(f"[bg]{ov_labels[0]}overlay=format=auto:shortest=1:eof_action=pass,fps={out_fps},format=yuv420p[v]")
        else:
            parts.append(f"{''.join(ov_labels)}concat=n={len(ov_labels)}:v=1:a=0,fps={out_fps},settb=1/{out_fps}[ovtrack]")
            parts.append(f"[bg][ovtrack]overlay=format=auto:shortest=1:eof_action=pass,fps={out_fps},format=yuv420p[v]")
    else:
        parts.append(f"[bg]fps={out_fps},format=yuv420p[v]")

    if prelude_secs > 0.001 and audio_path and audio_dur > 0:
        delay_ms = int(round(prelude_secs * 1000))
        parts.append(f"[1:a]aresample=async=1:first_pts=0,adelay={delay_ms}|{delay_ms},apad[a]")
    else:
        parts.append("[1:a]aresample=async=1:first_pts=0,apad[a]")

    cmd += [
        '-filter_complex', ';'.join(parts),
        '-map', '[v]', '-map', '[a]',
        '-t', f'{total_secs:.3f}',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-r', str(out_fps), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
        *meta_args,
        '-movflags', '+faststart',
        str(out_path),
    ]

    # Run FFmpeg with live progress updates & cancellation support
    jid = getattr(_JOB_LOCAL, 'job_id', None)
    if is_job_cancelled(jid):
        raise ExportCancelled('Export cancelled by user')
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if jid:
        with _PROC_LOCK:
            _ACTIVE_PROCS[jid] = proc
    try:
        total_us = max(1.0, total_secs * 1_000_000.0)
        last_pct = 35
        if proc.stdout:
            for line in proc.stdout:
                if is_job_cancelled(jid):
                    proc.terminate()
                    raise ExportCancelled('Export cancelled by user')
                if line.startswith('out_time_us='):
                    try:
                        val = float(line.split('=', 1)[1].strip())
                        if val > 0:
                            frac = max(0.0, min(1.0, val / total_us))
                            next_pct = 35 + int(frac * 62)
                            if next_pct > last_pct:
                                last_pct = next_pct
                                if progress:
                                    progress(last_pct, 'Exporting smooth reel…')
                    except ValueError:
                        pass
        stderr = proc.stderr.read() if proc.stderr else ''
        rc = proc.wait()
        if is_job_cancelled(jid):
            raise ExportCancelled('Export cancelled by user')
        if rc != 0:
            raise RuntimeError((stderr or 'FFmpeg render failed')[-2600:])
    finally:
        if jid:
            with _PROC_LOCK:
                if _ACTIVE_PROCS.get(jid) is proc:
                    _ACTIVE_PROCS.pop(jid, None)


def translation_metadata(root, opts):
    meta_args = ['-metadata', 'artist=Produced by Developer. Mohamed Ali (https://github.com/devMohamedA1i)']
    if opts.get('text_language','ar') != 'en':
        return meta_args
    from quran_display import english_dataset
    meta = english_dataset(str(root))['metadata']
    credit = f'English translation: {meta["title"]} | QuranEnc.com | v{meta["version"]} | https://quranenc.com/en/browse/english_saheeh'
    return ['-metadata', 'comment='+credit] + meta_args


def export(root,opts,progress=None,preview_mode=False):
    bg=validate_settings(root,opts)
    sn=int(opts.get('surah',112))
    from quran import load_surahs
    surah,verses=selected_verses(root,sn,int(opts.get('start',1)),int(opts.get('end',len(load_surahs(root)[sn-1]['ayahs']))))
    # Playable preview intentionally includes the entire selected verse range.
    audios=[]
    for v in verses:
        a=audio_for(root,int(surah['number']),int(v['numberInSurah']))
        audios.append((a,duration(a)))
    outdir=root/'Output'/('previews' if preview_mode else '')
    outdir.mkdir(parents=True,exist_ok=True)
    filename=f"{'Preview' if preview_mode else 'Surah'}_{surah['number']}_{verses[0]['numberInSurah']}-{verses[-1]['numberInSurah']}_Al_Ajmi_{uuid.uuid4().hex[:6]}.mp4"
    final=outdir/filename
    parts=[]
    with tempfile.TemporaryDirectory(prefix='qvs_',dir=str(outdir)) as folder:
        tmp=Path(folder)
        # Always produce independent opening and closing cards.
        # For Al-Fatiha, ayah 1 IS the basmala. Its MP3 belongs to the
        # opening card; it must not produce a second, duplicate verse card.
        surah_number=int(surah['number'])
        first_number=int(verses[0]['numberInSurah'])
        fatiha_basmala=surah_number==1 and first_number==1
        split_enabled=(not fatiha_basmala and bool(opts.get('split_basmala_audio',False))
                       and first_number==1 and surah_number!=9)
        split_seconds=float(opts.get('basmala_split_seconds',2.6))
        first_audio,first_duration=audios[0]
        if split_enabled and not (0.2 <= split_seconds < first_duration-0.5):
            raise ValueError('Basmala audio split must be shorter than first verse recording')
        if fatiha_basmala:
            jobs=[('opening',opening_text(root,opts),first_audio,first_duration,'',0.0)]
        elif split_enabled:
            jobs=[('opening',opening_text(root,opts),first_audio,split_seconds,'',0.0)]
        else:
            jobs=[] if surah_number==9 or first_number!=1 else [('opening',opening_text(root,opts),None,float(opts.get('opening_seconds',3)),'',0.0)]
        for i,(v,(audio,secs)) in enumerate(zip(verses,audios)):
            if fatiha_basmala and i==0:
                continue
            offset=split_seconds if i==0 and split_enabled else 0.0
            number=int(v['numberInSurah'])
            display_text=display_verse(root,surah_number,number,verse_display_text(surah_number,number,v['text']),opts)
            jobs.append((f'ayah{number}',display_text,audio,secs-offset,
                         f"{surah['name']}  •  {number}",offset))
        jobs.append(('closing',ENDING,None,float(opts.get('closing_seconds',3)),'',0.0))
        count=len(jobs)
        bg_dur = duration(bg['path']) if bg['kind'] == 'video' else 0.0
        elapsed = 0.0
        for i,(name,txt,audio,secs,heading,audio_start) in enumerate(jobs):
            png=tmp/f'{i:03}.png'
            mp4=tmp/f'{i:03}.mp4'
            make_overlay(root,txt,png,opts,heading)
            seg_bg_offset = (elapsed % bg_dur) if bg_dur > 0 else 0.0
            tw = speech_windows(audio,audio_start,secs) if (audio and heading) else None
            make_segment(bg,png,audio,mp4,secs,str(opts.get('effect','fade')),audio_start,bg_offset=seg_bg_offset,text_window=tw)
            elapsed += secs
            parts.append(mp4)
            if progress: progress(round((i+1)/count*90),f'Rendered {name} ({i+1}/{count})')
        concat=tmp/'concat.txt'
        concat.write_text(''.join("file '"+p.as_posix().replace("'", "'\\''")+"'\n" for p in parts),encoding='utf-8')
        command(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-c','copy',*translation_metadata(root,opts),'-movflags','+faststart',str(final)])
    if progress: progress(100,'Export complete')
    return final


def export_master_reel(root, opts, surah_number, segment, progress=None,
                       outdir=None, filename=None, source_id=None,
                       timing_available=True):
    """Render an approved, contiguous master-MP3 excerpt without guessing Ayah text.

    The built-in Al-Ajmi excerpt is cut on the validated Ayah boundaries of
    its timing data. An external recording uses the timing and Quran text
    loaded for that same source, and only when both are present. Any other
    recording is rendered as one honest audio excerpt with the Surah name -
    never with guessed or substituted verses. Source audio is never
    speed-adjusted.
    """
    from reel_planner import master_audio
    from quran import load_surahs
    import ayah_data
    bg=validate_settings(root,opts)
    source=master_audio(root,surah_number,source_id)
    start=float(segment['start']); end=float(segment['end'])
    if not (0 <= start < end <= duration(source)+.05):
        raise ValueError('Invalid selected audio range')
    surah=load_surahs(root)[surah_number-1]
    if outdir is None:
        outdir=root/'Output'/'reels'/f'{surah_number:03}'
    outdir=Path(outdir)
    outdir.mkdir(parents=True,exist_ok=True)
    if filename is None:
        filename=f"Surah_{surah_number:03}_Reel_{int(segment['id']):03}.mp4"
    target=outdir/filename
    if target.exists():
        raise ValueError('A reel already exists at this path; refusing to overwrite it')
    with tempfile.TemporaryDirectory(prefix='qvs_reel_',dir=str(outdir)) as directory:
        tmp=Path(directory)
        # Use the original full-Surah recording without
        # adding duplicate opening or closing scenes.
        external = bool(source_id) and source_id != 'legacy'
        verses = None
        ayahs = []
        if external:
            import quran_assets
            try:
                verses = quran_assets.verses(root, source_id, surah_number)
            except quran_assets.AssetError:
                verses = None
            if verses:
                try:
                    ayahs = quran_assets.timings_for_range(
                        root, source_id, surah_number, start, end
                    )
                except quran_assets.AssetError:
                    ayahs = []
        else:
            ayahs = ayah_data.timings_for_range(
                root, surah_number, start, end
            ) if timing_available else []
            if timing_available:
                verses = surah['ayahs']
        opening = opening_entry(root, source_id, surah_number) if timing_available or external else None
        if opening and verses and opening['end'] > start and opening['start'] < end:
            ayahs.insert(0, {'ayah':0, 'start':max(start,opening['start']), 'end':min(end,opening['end'])})
        if not ayahs or not verses:
            # No matching text and timing for this recording: one scene
            # with the Surah name. Never invent verse text or Ayah numbering.
            tasks=[(surah['name'],source,start,end-start)]
        else:
            tasks=[]
            cursor=start
            for entry in ayahs:
                number=int(entry['ayah'])
                if not 0 <= number <= len(verses):
                    continue
                # An external timing file may cover only part of a Reel (for
                # example a different excerpt). Keep every second of the
                # approved audio by filling any gap with the Surah name.
                if entry['start'] > cursor + 0.01:
                    tasks.append((surah['name'],source,cursor,
                                  entry['start']-cursor))
                if number == 0:
                    text=opening_text(root,opts)
                else:
                    verse=verses[number-1]
                    verse_text=verse.get('text','')
                    text=display_verse(root,surah_number,number,verse_display_text(surah_number,number,verse_text),opts)
                heading=f"{surah['name']}  •  {number}"
                tasks.append((heading,source,entry['start'],entry['end']-entry['start'],text))
                cursor=max(cursor,entry['end'])
            if cursor < end - 0.01:
                tasks.append((surah['name'],source,cursor,end-cursor))
        prelude = opening_card_seconds(root,source_id,surah_number,start) if verses and (timing_available or external) else 0
        if prelude:
            tasks.insert(0, ('opening',None,0,prelude,opening_text(root,opts)))
        parts=[]
        loop_bg = _seamless_loop_bg(bg, tmp)
        bg_dur = duration(loop_bg['path']) if loop_bg['kind'] == 'video' else 0.0
        temporary = tmp / 'final.mp4'

        # Single continuous FFmpeg pass (zero segment seams, zero frame glitches, 30fps native smoothness).
        # Falls back to legacy per-segment path only if make_segment was monkey-patched by unit tests.
        if make_segment is _DEFAULT_MAKE_SEGMENT:
            overlay_events = []
            elapsed = 0.0
            for i, (title, audio, offset, secs, *rest) in enumerate(tasks):
                overlay = tmp / f'{i}.png'
                text = rest[0] if rest else None
                if text is None:
                    make_overlay(root, title, overlay, opts)
                else:
                    make_overlay(root, text, overlay, opts, title)
                tw = speech_windows(audio, offset, secs) if (text and audio) else [(0.0, secs)]
                for a_, b_ in (tw or []):
                    overlay_events.append({
                        'overlay': overlay,
                        'start': elapsed + a_,
                        'end': elapsed + b_,
                        'seg_end': elapsed + secs,
                    })
                elapsed += secs
                if progress:
                    progress(int((i + 1) / max(1, len(tasks)) * 30), f'Prepared {title} ({i + 1}/{len(tasks)})')
            if progress:
                progress(35, 'Rendering smooth continuous reel…')
            _render_continuous_reel(
                loop_bg,
                overlay_events,
                source,
                start,
                max(0.0, end - start),
                prelude,
                elapsed,
                opts.get('effect', 'none'),
                tmp,
                temporary,
                translation_metadata(root, opts),
                progress=progress,
            )
            temporary.replace(target)
        else:
            elapsed = 0.0
            for i,(title,audio,offset,secs,*rest) in enumerate(tasks):
                overlay=tmp/f'{i}.png'; clip=tmp/f'{i}.mp4'
                text=rest[0] if rest else None
                if text is None:
                    make_overlay(root,title,overlay,opts)
                else:
                    make_overlay(root,text,overlay,opts,title)
                seg_bg_offset = (elapsed % bg_dur) if bg_dur > 0 else 0.0
                tw = speech_windows(audio,offset,secs) if (text and audio) else None
                make_segment(loop_bg,overlay,audio,clip,secs,opts.get('effect','fade'),offset,bg_offset=seg_bg_offset,text_window=tw)
                elapsed += secs
                parts.append(clip)
                if progress: progress(int((i+1)/len(tasks)*85),f'Rendered {title} ({i+1}/{len(tasks)})')
            manifest=tmp/'concat.txt'
            manifest.write_text(''.join("file '"+p.as_posix().replace("'", "'\\''")+"'\n" for p in parts),encoding='utf-8')
            command(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(manifest),'-c','copy',*translation_metadata(root,opts),'-movflags','+faststart',str(temporary)])
            temporary.replace(target)
    if progress: progress(100,'Reel exported')
    return target

# QVS_SECTION3_EDITING_V2
