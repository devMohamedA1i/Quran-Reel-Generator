"""Start the local studio and open the system's default browser when ready."""
from pathlib import Path
import json
import os
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import build_opener, ProxyHandler
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
OPENER = build_opener(ProxyHandler({}))  # localhost must not use an HTTP proxy


def ready(url):
    try:
        with OPENER.open(url + 'api/health', timeout=.8) as response:
            return json.load(response).get('app') == 'quran-reel-generator'
    except (OSError, URLError, ValueError, AttributeError):
        return False


def open_browser(url):
    if not webbrowser.open(url, new=2):
        print(f'Open this address in your browser: {url}', flush=True)


def main():
    port = int(os.environ.get('QVS_PORT', '5055'))
    if not 1024 <= port <= 65535:
        raise ValueError('QVS_PORT must be between 1024 and 65535.')
    url = f'http://127.0.0.1:{port}/'
    if ready(url):
        print('Quran Reel Generator is already running. Opening your browser.', flush=True)
        open_browser(url)
        return 0
    with socket.socket() as check:
        if check.connect_ex(('127.0.0.1', port)) == 0:
            raise RuntimeError(f'Port {port} is being used by another app. Close that app or choose a different QVS_PORT.')
    print('Starting Quran Reel Generator…', flush=True)
    process = subprocess.Popen([sys.executable, str(ROOT/'app.py')], cwd=str(ROOT))
    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('The server stopped before it was ready. Check the error above and the setup steps in README.md.')
            if ready(url):
                print(f'Ready: {url}\nKeep this Terminal window open. Press Ctrl+C to stop the app.', flush=True)
                open_browser(url)
                return process.wait()
            time.sleep(.25)
        raise RuntimeError('The server did not become ready within 90 seconds.')
    except KeyboardInterrupt:
        print('\nStopping Quran Reel Generator.', flush=True)
        return 0
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f'Cannot start Quran Reel Generator: {error}', file=sys.stderr)
        sys.exit(1)
