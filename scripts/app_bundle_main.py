"""Standalone cross-platform desktop app entrypoint for Quran Reel Generator.

Supports both macOS (.app / .dmg) and Windows (.exe):
- Uses bundled static ffmpeg & ffprobe binaries (+ libfribidi on macOS)
- If 'Project Development/' sits next to the app, uses it directly (dev/local layout)
- Otherwise (standalone install), auto-provisions a writable workspace:
  * macOS:   ~/Library/Application Support/Quran Reel Generator/Workspace
             Exports -> ~/Movies/Quran Reel Generator/
  * Windows: %LOCALAPPDATA%/Quran Reel Generator/Workspace
             Exports -> %USERPROFILE%/Videos/Quran Reel Generator/
- Opens inside its own native desktop window (WKWebView on macOS, Edge WebView2 on Windows)
- Shuts down the local server cleanly when the window is closed
"""
from pathlib import Path
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
import webbrowser

OPENER = build_opener(ProxyHandler({}))  # localhost must bypass any HTTP proxy


def _app_support_dir() -> Path:
    if sys.platform == 'win32':
        base = Path(os.environ.get('LOCALAPPDATA') or (Path.home() / 'AppData' / 'Local'))
        return base / 'Quran Reel Generator'
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'Quran Reel Generator'
    return Path.home() / '.local' / 'share' / 'Quran Reel Generator'


def _videos_export_dir() -> Path:
    if sys.platform == 'win32':
        return Path.home() / 'Videos' / 'Quran Reel Generator'
    if sys.platform == 'darwin':
        return Path.home() / 'Movies' / 'Quran Reel Generator'
    return Path.home() / 'Videos' / 'Quran Reel Generator'


LOG_PATH = (
    Path.home() / 'Library' / 'Logs' / 'QuranReelGenerator.log'
    if sys.platform == 'darwin'
    else _app_support_dir() / 'QuranReelGenerator.log'
)


def log(msg: str) -> None:
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open('a', encoding='utf-8') as f:
            f.write(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] {msg}\n')
    except OSError:
        pass


def show_alert(title: str, message: str) -> None:
    """Display a friendly native dialog on macOS or Windows."""
    log(f'ALERT: {title} — {message}')
    if sys.platform == 'darwin':
        safe_title = title.replace('"', '\\"')
        safe_msg = message.replace('"', '\\"')
        try:
            subprocess.run(
                [
                    'osascript',
                    '-e',
                    f'display dialog "{safe_msg}" with title "{safe_title}" buttons {{"OK"}} default button "OK" with icon caution',
                ],
                capture_output=True,
                timeout=30,
            )
            return
        except Exception:
            pass
    elif sys.platform == 'win32':
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, message, title, 0x30)
            return
        except Exception:
            pass
    print(f'{title}: {message}', file=sys.stderr, flush=True)


def _ensure_link_or_copy(dst: Path, src: Path) -> None:
    """Symlink src -> dst when permitted (macOS/Linux); fall back to junction/copy on Windows."""
    if not src.exists():
        return
    if dst.is_symlink():
        try:
            if dst.resolve() == src.resolve():
                return
        except OSError:
            pass
        dst.unlink()
    elif dst.exists():
        return

    dst.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform != 'win32':
        dst.symlink_to(src)
        return

    # On Windows, directory junctions work without Administrator privileges
    if src.is_dir():
        res = subprocess.run(
            ['cmd', '/c', 'mklink', '/J', str(dst), str(src)],
            capture_output=True,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        if res.returncode == 0:
            return
        shutil.copytree(src, dst, dirs_exist_ok=True)
    else:
        try:
            os.link(src, dst)
        except OSError:
            shutil.copy2(src, dst)


def provision_standalone_workspace(bundle_data: Path) -> Path:
    """Provision a writable user workspace backed by bundled read-only assets."""
    ws = _app_support_dir() / 'Workspace'
    ws.mkdir(parents=True, exist_ok=True)

    for rel in ('frontend', 'static', 'templates', 'docs', 'USER_GUIDE.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md'):
        src = bundle_data / rel
        if src.exists():
            _ensure_link_or_copy(ws / rel, src)

    assets_ws = ws / 'Assets'
    assets_ws.mkdir(parents=True, exist_ok=True)
    assets_src = bundle_data / 'Assets'
    for rel in ('fonts', 'Quran Text', 'Quran Timing', 'licences', 'banner.png'):
        src = assets_src / rel
        if src.exists():
            _ensure_link_or_copy(assets_ws / rel, src)

    # Writable Background Templates folder seeded with symlinks/copies of bundled starter samples
    bg_ws = assets_ws / 'Background Templates'
    bg_ws.mkdir(parents=True, exist_ok=True)
    bg_src = assets_src / 'Background Templates'
    if bg_src.is_dir():
        for sub in bg_src.iterdir():
            if sub.name.startswith('.'):
                continue
            if sub.is_dir():
                sub_ws = bg_ws / sub.name
                sub_ws.mkdir(parents=True, exist_ok=True)
                for item in sub.iterdir():
                    if not item.name.startswith('.'):
                        _ensure_link_or_copy(sub_ws / item.name, item)
            else:
                _ensure_link_or_copy(bg_ws / sub.name, sub)

    # Writable audio folder seeded with 1 starter Surah (Al-Fatihah) for each of the 10 reciters
    audio_ws = assets_ws / 'audio'
    audio_ws.mkdir(parents=True, exist_ok=True)
    audio_src = assets_src / 'audio'
    if audio_src.is_dir():
        for rec_dir in audio_src.iterdir():
            if rec_dir.name.startswith('.') or not rec_dir.is_dir():
                continue
            rec_ws = audio_ws / rec_dir.name
            rec_ws.mkdir(parents=True, exist_ok=True)
            for item in rec_dir.iterdir():
                if not item.name.startswith('.'):
                    _ensure_link_or_copy(rec_ws / item.name, item)

    (ws / 'Draft').mkdir(parents=True, exist_ok=True)

    movies_out = _videos_export_dir()
    movies_out.mkdir(parents=True, exist_ok=True)
    _ensure_link_or_copy(ws / 'Output', movies_out)

    return ws.resolve()


def resolve_project_root() -> Path:
    if os.environ.get('QVS_ROOT'):
        return Path(os.environ['QVS_ROOT']).resolve()

    if getattr(sys, 'frozen', False):
        exe = Path(sys.executable).resolve()
        # 1) Prefer adjacent 'Project Development' folder if present (local/dev folder)
        if sys.platform == 'darwin':
            for parent in exe.parents:
                if parent.suffix == '.app':
                    outer = parent.parent
                    for cand in (outer / 'Project Development', outer):
                        if (cand / 'Assets').is_dir() and (cand / 'frontend' / 'dist').is_dir():
                            return cand.resolve()
                    break
        else:
            for cand in (exe.parent / 'Project Development', exe.parent.parent / 'Project Development'):
                if (cand / 'Assets').is_dir() and (cand / 'frontend' / 'dist').is_dir():
                    return cand.resolve()

        # 2) Standalone install: provision writable workspace from bundled data
        meipass = getattr(sys, '_MEIPASS', None)
        if meipass:
            bundle_data = Path(meipass) / 'bundle_data'
            if (bundle_data / 'Assets').is_dir() and (bundle_data / 'frontend' / 'dist').is_dir():
                return provision_standalone_workspace(bundle_data)

        raise FileNotFoundError(
            'Could not locate Quran Reel Generator assets.\n\n'
            'Please re-install Quran Reel Generator from the installer.'
        )

    return Path(__file__).resolve().parents[1]


def configure_bundled_binaries() -> None:
    meipass = getattr(sys, '_MEIPASS', None)
    if not meipass:
        return
    meipass_path = Path(meipass)
    bin_dir = meipass_path / 'bin'
    if bin_dir.is_dir():
        os.environ['PATH'] = str(bin_dir) + os.pathsep + os.environ.get('PATH', '')
        log(f'Prepended bundled bin dir to PATH: {bin_dir}')
    if sys.platform == 'darwin':
        for name in ('libfribidi.dylib', 'libfribidi.0.dylib'):
            fribidi = meipass_path / name
            if fribidi.is_file():
                try:
                    import ctypes
                    ctypes.CDLL(str(fribidi), mode=ctypes.RTLD_GLOBAL)
                    log(f'Preloaded bundled {name}: {fribidi}')
                    break
                except OSError as exc:
                    log(f'Warning: could not preload {name} ({exc})')


def server_ready(url: str) -> bool:
    try:
        with OPENER.open(url + 'api/health', timeout=0.8) as resp:
            return json.load(resp).get('app') == 'quran-reel-generator'
    except (OSError, URLError, ValueError, AttributeError):
        return False


def open_native_window(url: str) -> bool:
    """Open the studio in a native desktop window (WKWebView on macOS, Edge WebView2 on Windows)."""
    try:
        import webview

        storage_dir = _app_support_dir() / 'WebView'
        storage_dir.mkdir(parents=True, exist_ok=True)
        webview.create_window(
            title='Quran Reel Generator',
            url=url,
            width=1420,
            height=920,
            min_size=(1024, 680),
            resizable=True,
            background_color='#f6f1e7',
        )
        start_kwargs = {'private_mode': False, 'storage_path': str(storage_dir)}
        if sys.platform == 'win32':
            start_kwargs['gui'] = 'edgechromium'
        webview.start(**start_kwargs)
        return True
    except Exception as exc:
        log(f'Native window unavailable ({exc}); falling back to default browser.')
        return False


def main() -> int:
    port = int(os.environ.get('QVS_PORT', '5055'))
    url = f'http://127.0.0.1:{port}/'

    if server_ready(url):
        log('Already running; opening native window.')
        if os.environ.get('QVS_NO_BROWSER') != '1':
            if not open_native_window(url):
                webbrowser.open(url, new=2)
        return 0

    with socket.socket() as check:
        if check.connect_ex(('127.0.0.1', port)) == 0:
            show_alert(
                'Quran Reel Generator',
                f'Port {port} is already being used by another application.\n\nClose that app and try opening Quran Reel Generator again.',
            )
            return 1

    server = None
    try:
        root = resolve_project_root()
        os.environ['QVS_ROOT'] = str(root)
        os.chdir(root)
        configure_bundled_binaries()
        log(f'Starting Quran Reel Generator with ROOT={root}')

        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from werkzeug.serving import make_server
        import app as qvs_app

        server = make_server('127.0.0.1', port, qvs_app.app, threaded=True)

        def handle_signal(_signum, _frame):
            log('Received stop signal; shutting down server.')
            threading.Thread(target=server.shutdown, daemon=True).start()

        signal.signal(signal.SIGTERM, handle_signal)
        signal.signal(signal.SIGINT, handle_signal)

        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if server_ready(url):
                log(f'Server ready at {url}.')
                break
            time.sleep(0.15)
        else:
            raise RuntimeError('The local studio server did not become ready in time.')

        if os.environ.get('QVS_NO_BROWSER') == '1':
            while thread.is_alive():
                thread.join(timeout=1.0)
            return 0

        opened_native = open_native_window(url)
        if not opened_native:
            webbrowser.open(url, new=2)
            while thread.is_alive():
                thread.join(timeout=1.0)
        return 0
    except Exception as exc:
        log('FATAL:\n' + traceback.format_exc())
        show_alert(
            'Quran Reel Generator Could Not Start',
            f'{exc}\n\nDetails were saved to:\n{LOG_PATH}',
        )
        return 1
    finally:
        if server is not None:
            log('Shutting down local server cleanly.')
            try:
                server.shutdown()
            except Exception:
                pass


if __name__ == '__main__':
    sys.exit(main())
