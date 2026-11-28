"""Authoritative per-reel editing state.

Every reel of every Surah owns exactly one JSON file under
``Draft/<Surah folder>/Reel_XXX.json``. That file is the single source of
truth for the reel's audio boundaries, approvals, video settings, editing
progress and export record.

The browser only keeps the *selection* (which Surah and which reel are
open) in localStorage. Everything else lives in these files, so work
survives a refresh, a browser restart and a Flask restart.

Legacy ``Output/plans/NNN.json`` files are planning input only. They are
read to seed missing reels but they never overwrite a newer draft.
"""
from __future__ import annotations

import json
import math
import os
import re
import tempfile
import threading
from pathlib import Path

# ---------------------------------------------------------------- statuses

DRAFT = 'draft'
AUDIO_APPROVED = 'audio_approved'
VIDEO_APPROVED = 'video_approved'
EXPORTED = 'exported'

STATUSES = (DRAFT, AUDIO_APPROVED, VIDEO_APPROVED, EXPORTED)

_LOCK = threading.RLock()

# Boundary tolerance in seconds; MP3 timings are not exact.
EPS = 0.001

# RELEASE_AUDIT Phase 3 (item 18): drafts accept only known top-level fields,
# and each field is size-checked so a stray data: URL cannot balloon the tree.
# Nested objects (video_settings, editing_progress, export ...) keep their own
# internal shape; the cap applies to the serialised value as a whole.
SCHEMA_VERSION = 1
MAX_FIELD_CHARS = 100_000
ALLOWED_DRAFT_KEYS = frozenset({
    'schema_version', 'surah', 'surah_folder', 'reel',
    'audio_start', 'audio_end', 'audio_approved', 'audio_filename',
    'audio_source', 'source', 'recording_id',
    'status', 'video_approved', 'export',
    'video_settings', 'editing_progress', 'approved_video_settings',
    'proposed_start', 'proposed_end', 'updated_at',
    'superseded', 'superseded_reason',
})


class DraftError(Exception):
    """A draft operation was refused. `detail` explains what would change."""

    def __init__(self, message, detail=None, status=400):
        super().__init__(message)
        self.message = message
        self.detail = detail or {}
        self.status = status


# ------------------------------------------------------------- locating files


def draft_root(root: Path, source_id: str | None = None) -> Path:
    """Where drafts of a source live.

    The built-in Al-Ajmi library keeps using ``Draft/`` exactly as before.
    Any other recording gets its own namespace below ``Draft/_sources``, so
    an Al-Ajmi approval can never be reused by a different recitation.
    """
    if not source_id or source_id == 'legacy':
        return root / 'Draft'
    return root / 'Draft' / '_sources' / source_id


def ensure_layout(root: Path) -> None:
    """Create the runtime directories a fresh clone needs.

    Safe to call on every start: existing files are never touched. Drafts are
    still the sole authority; these directories are only their containers.
    """
    with _LOCK:
        for relative in ('Draft', 'Output/previews', 'Output/reels'):
            (root / relative).mkdir(parents=True, exist_ok=True)


def surah_folders(root: Path, source_id: str | None = None) -> dict:
    """Map Surah number -> Draft folder. Only existing folders are used.

    A fresh clone has no ``Draft/`` until its first use. That is an empty
    library, not a server error (RELEASE_AUDIT Phase 2, item 11).
    """
    base = draft_root(root, source_id)
    if not base.is_dir():
        return {}
    found = {}
    for folder in sorted(base.iterdir()):
        if not folder.is_dir():
            continue
        match = re.match(r'^(\d{3})(?:\D|$)', folder.name)
        if not match:
            continue
        number = int(match.group(1))
        if 1 <= number <= 114 and number not in found:
            found[number] = folder
    return found


def surah_folder(root: Path, surah: int, source_id: str | None = None) -> Path:
    folders = surah_folders(root, source_id)
    if surah in folders:
        return folders[surah]
    if source_id and source_id != 'legacy':
        # A new source has no draft folder yet. Give it a deterministic name;
        # nothing is written until the user actually saves or approves.
        from audio_sources import surah_folder_name
        return draft_root(root, source_id) / surah_folder_name(root, surah)
    raise DraftError(f'No Draft folder for Surah {surah:03}', status=404)


def reel_file(root: Path, surah: int, reel: int,
              source_id: str | None = None) -> Path:
    folder = surah_folder(root, surah, source_id)
    if reel < 1 or reel > 999:
        raise DraftError('Invalid reel number')
    return folder / f'Reel_{reel:03}.json'


def surah_duration(root: Path, surah: int, source_id: str | None = None) -> float:
    """Duration of the complete master recording for a Surah."""
    from reel_planner import master_audio, probe_seconds
    try:
        return probe_seconds(master_audio(root, surah, source_id))
    except Exception as exc:  # pragma: no cover - defensive
        raise DraftError(f'Cannot read the master recording: {exc}', status=500)


# ------------------------------------------------------------- reading/writing


def _blank_reel(surah: int, folder_name: str, reel: int, start: float, end: float) -> dict:
    return {
        'schema_version': SCHEMA_VERSION,
        'surah': surah,
        'surah_folder': folder_name,
        'reel': reel,
        'audio_start': round(float(start), 3),
        'audio_end': round(float(end), 3),
        'audio_approved': False,
        'status': DRAFT,
        'video_settings': {},
        'editing_progress': {},
    }


def current_recording_name(root: Path, surah: int,
                           source_id: str | None = None):
    """Filename of the MP3 assigned to this Surah right now.

    Drafts are pinned to the exact recording they were proposed from, so a
    reassignment cannot surface another file's boundaries under this Surah.
    The built-in library keeps its historical behaviour.
    """
    if not source_id or source_id == 'legacy':
        return None
    from audio_sources import AudioSourceError
    from reel_planner import master_audio
    try:
        return master_audio(root, surah, source_id).name
    except (ValueError, FileNotFoundError, OSError, AudioSourceError):
        return None


def _plan_to_drafts(root: Path, surah: int,
                    source_id: str | None = None) -> list:
    """Read the planner's segments for a source that has no drafts yet.

    Returning them as drafts keeps the existing Reel Queue working without
    writing any JSON file simply because a Surah was opened. The files are
    created only when the user saves, adjusts or approves something.
    """
    if not source_id or source_id == 'legacy':
        return []
    from reel_planner import read_plan, plan_is_current, plan_needs_rebuild
    plan = read_plan(root, surah, source_id)
    if not plan:
        return []
    if not plan_is_current(root, surah, plan, source_id) or \
            plan_needs_rebuild(plan):
        return []
    folder = surah_folder(root, surah, source_id)
    items = []
    for segment in plan.get('segments') or []:
        item = _blank_reel(
            surah, folder.name, int(segment['id']),
            float(segment['start']), float(segment['end']),
        )
        item.update({
            'proposed_start': round(float(segment['start']), 3),
            'proposed_end': round(float(segment['end']), 3),
            'source': segment.get('source', 'planner-proposal'),
            'audio_source': source_id,
            'audio_filename': plan.get('audio_filename', ''),
        })
        items.append(item)
    return items


def _materialize(root: Path, surah: int,
                 source_id: str | None = None) -> None:
    """Write the planner's segments as drafts, once, before a real change.

    This is deliberately lazy: opening a Surah, scanning a folder or viewing
    the queue never creates a draft. Approving, resetting or editing does.
    Existing drafts are never replaced.
    """
    if not source_id or source_id == 'legacy':
        return
    folder = surah_folder(root, surah, source_id)
    if folder.is_dir() and any(folder.glob('Reel_*.json')):
        return
    items = _plan_to_drafts(root, surah, source_id)
    if not items:
        raise DraftError(
            'Build the Reel queue for this recording first.', status=404
        )
    updates = {
        folder / f"Reel_{int(item['reel']):03}.json": item for item in items
    }
    write_reels(root, updates)


def read_reel(root: Path, surah: int, reel: int,
              source_id: str | None = None) -> dict:
    path = reel_file(root, surah, reel, source_id)
    if not path.is_file():
        if source_id and source_id != 'legacy':
            for item in _plan_to_drafts(root, surah, source_id):
                if int(item['reel']) == int(reel):
                    return item
        raise DraftError(f'Reel {reel:03} has no draft file', status=404)
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise DraftError(f'Unreadable draft {path.name}: {exc}', status=500)
    if not isinstance(data, dict):
        raise DraftError(f'Draft {path.name} is not a JSON object', status=500)
    current = current_recording_name(root, surah, source_id)
    if current and data.get('audio_filename') and \
            data.get('audio_filename') != current:
        # The Surah was reassigned to another MP3. The old draft stays on
        # disk untouched; it is simply not this recording's reel.
        raise DraftError(
            f'Reel {reel:03} belongs to {data["audio_filename"]}, which is no '
            f'longer the recording for Surah {surah:03}', status=404
        )
    data['video_settings'] = normalise_video_settings(data.get('video_settings'))
    if data.get('approved_video_settings') is not None:
        data['approved_video_settings'] = normalise_video_settings(
            data['approved_video_settings']
        )
    return data


def list_reels(root: Path, surah: int, include_superseded: bool = False,
               source_id: str | None = None) -> list:
    """All reel drafts of a Surah, ordered by reel number.

    Reels that a later Ayah aligned proposal made redundant are left out
    unless they are asked for. Their files stay on disk untouched.
    """
    folder = surah_folder(root, surah, source_id)
    items = []
    current = current_recording_name(root, surah, source_id)
    if folder.is_dir():
        for path in sorted(folder.glob('Reel_*.json')):
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            if not isinstance(data, dict):
                continue
            if data.get('superseded') and not include_superseded:
                continue
            if current and data.get('audio_filename') and \
                    data.get('audio_filename') != current:
                # Left on disk for the recording it belongs to; never shown
                # as a reel of the recording selected now.
                continue
            data['video_settings'] = normalise_video_settings(
                data.get('video_settings')
            )
            items.append(data)
    if not items and source_id and source_id != 'legacy':
        items = _plan_to_drafts(root, surah, source_id)
    items.sort(key=lambda item: int(item.get('reel', 0)))
    return items


# RELEASE_AUDIT item 15: the browser used to persist vertical/opacity while
# the renderer reads vertical_offset/panel_opacity. Normalise at the store
# boundary so every consumer (UI, approval, export) sees the same key names.
VIDEO_SETTINGS_ALIASES = {
    'vertical': 'vertical_offset',
    'opacity': 'panel_opacity',
}


def normalise_video_settings(settings: dict | None) -> dict:
    """Return video settings using the renderer's canonical key names.

    Existing drafts with the old keys keep working without being rewritten;
    when both names are present the canonical one wins.
    """
    result = dict(settings or {})
    for old, new in VIDEO_SETTINGS_ALIASES.items():
        if old in result:
            value = result.pop(old)
            result.setdefault(new, value)
    return result


def _normalise(data: dict) -> dict:
    """Fill in fields an older draft may not have, without losing anything."""
    data.setdefault('schema_version', SCHEMA_VERSION)
    data['video_settings'] = normalise_video_settings(data.get('video_settings'))
    if data.get('approved_video_settings') is not None:
        data['approved_video_settings'] = normalise_video_settings(
            data['approved_video_settings']
        )
    data.setdefault('status', DRAFT)
    data.setdefault('audio_approved', False)
    data.setdefault('video_settings', {})
    data.setdefault('editing_progress', {})
    data.setdefault('video_approved', False)
    data.setdefault('export', None)
    # The original proposal is kept apart so a reset never depends on
    # values that have already been edited.
    if 'proposed_start' not in data:
        data['proposed_start'] = data.get('audio_start', 0.0)
    if 'proposed_end' not in data:
        data['proposed_end'] = data.get('audio_end', 0.0)
    return data


def write_reels(root: Path, updates: dict) -> None:
    """Write several draft files together, with rollback on any failure.

    Every file is staged first and only then moved into place, so a failure
    half way through cannot leave inconsistent boundaries behind.
    """
    with _LOCK:
        staged = []
        originals = {}
        try:
            for path, data in updates.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                originals[path] = path.read_bytes() if path.is_file() else None
                handle, tmp_name = tempfile.mkstemp(
                    dir=str(path.parent), prefix=path.name + '.', suffix='.tmp'
                )
                with os.fdopen(handle, 'w', encoding='utf-8') as fh:
                    json.dump(data, fh, ensure_ascii=False, indent=2)
                    fh.write('\n')
                staged.append((Path(tmp_name), path))
            for tmp, path in staged:
                tmp.replace(path)
        except Exception as exc:
            for path, original in originals.items():
                try:
                    if original is None:
                        path.unlink(missing_ok=True)
                    else:
                        path.write_bytes(original)
                except OSError:
                    pass
            for tmp, _ in staged:
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
            raise DraftError(f'Could not save the draft: {exc}', status=500)


def _validate_patch_field(key: str, value) -> None:
    """Reject unknown or oversized fields before they reach a draft file."""
    if key not in ALLOWED_DRAFT_KEYS:
        raise DraftError(f'Unknown draft field: {key}')
    try:
        size = len(json.dumps(value, ensure_ascii=False))
    except (TypeError, ValueError) as exc:
        raise DraftError(f'Draft field {key} is not JSON-serialisable: {exc}')
    if size > MAX_FIELD_CHARS:
        raise DraftError(
            f'Draft field {key} is too large ({size} characters; '
            f'limit {MAX_FIELD_CHARS}).'
        )


def save_reel(root: Path, surah: int, reel: int, patch: dict,
              source_id: str | None = None) -> dict:
    """Merge a patch into one reel draft and save it."""
    with _LOCK:
        _materialize(root, surah, source_id)
        data = _normalise(read_reel(root, surah, reel, source_id))

        # A change that was based on an older version of the draft is
        # refused, so a late request can never overwrite newer work.
        expected = (patch or {}).get('expected_updated_at')
        if expected and data.get('updated_at') and expected != data.get('updated_at'):
            raise DraftError(
                'This Reel was changed elsewhere. Reload it before saving again.',
                detail={'current_updated_at': data.get('updated_at')},
                status=409,
            )

        for key, value in (patch or {}).items():
            if key == 'expected_updated_at':
                continue
            _validate_patch_field(key, value)
            if key in ('surah', 'reel', 'surah_folder', 'audio_source'):
                continue
            if key == 'status' and value not in STATUSES:
                raise DraftError(f'Unknown status: {value}')
            if key == 'audio_approved':
                data['audio_approved'] = bool(value)
                continue
            if key == 'video_approved':
                data['video_approved'] = bool(value)
                continue
            if key in ('audio_start', 'audio_end'):
                try:
                    data[key] = round(float(value), 3)
                except (TypeError, ValueError):
                    raise DraftError(f'{key} must be a number')
                continue
            if key in ('video_settings', 'editing_progress'):
                if not isinstance(value, dict):
                    raise DraftError(f'{key} must be an object')
                if key == 'video_settings':
                    value = normalise_video_settings(value)
                merged = dict(data.get(key) or {})
                merged.update(value)
                data[key] = merged
                continue
            data[key] = value

        data['updated_at'] = _now()

        # Changing the video settings after the video was approved makes
        # that approval invalid. Saving the same settings again does not.
        approved = data.get('approved_video_settings')
        if data.get('video_approved') and approved is not None and \
                dict(data.get('video_settings') or {}) != approved:
            data['video_approved'] = False

        _sync_status(data)
        write_reels(root, {reel_file(root, surah, reel, source_id): data})
        return data


def update_reel_range(root: Path, surah: int, reel: int,
                      audio_start=None, audio_end=None,
                      source_id: str | None = None) -> list:
    """Update a reel's start/end and automatically cascade & rebalance following reels.

    Never errors with 'no audio left': trailing reels that fall past the Surah
    end are superseded cleanly, and shortening a reel pulls subsequent reels
    back so the queue stays contiguous from end to end.
    """
    with _LOCK:
        _materialize(root, surah, source_id)
        items = _chain(root, surah, source_id)
        idx = next((i for i, r in enumerate(items) if int(r['reel']) == int(reel)), None)
        if idx is None:
            raise DraftError(f'Reel {reel} does not exist for Surah {surah}', status=404)

        dur = surah_duration(root, surah, source_id)
        if dur <= 0.5:
            raise DraftError('Invalid Surah duration', status=400)

        cur = dict(items[idx])
        new_start = round(float(cur['audio_start'] if audio_start is None else audio_start), 3)
        new_end = round(float(cur['audio_end'] if audio_end is None else audio_end), 3)
        new_start = max(0.0, min(new_start, dur - 0.5))
        new_end = max(new_start + 0.5, min(new_end, dur))

        now = _now()
        updates = {}

        # Adjust previous reel's end if it touches or overlaps the new start
        if idx > 0:
            prev = dict(items[idx - 1])
            if new_start > float(prev['audio_start']) + 0.5:
                prev['audio_end'] = new_start
                prev['updated_at'] = now
                _sync_status(prev)
                items[idx - 1] = prev
                updates[reel_file(root, surah, int(prev['reel']), source_id)] = prev

        cur['audio_start'] = new_start
        cur['audio_end'] = new_end
        cur['superseded'] = False
        cur['updated_at'] = now
        _sync_status(cur)
        items[idx] = cur
        updates[reel_file(root, surah, int(cur['reel']), source_id)] = cur

        # Cascade all following reels smoothly; supersede any that fall past the end
        cursor = new_end
        last_active_idx = idx
        for j in range(idx + 1, len(items)):
            nxt = dict(items[j])
            orig_len = max(5.0, round(float(nxt['audio_end']) - float(nxt['audio_start']), 3))
            if cursor >= dur - 0.5:
                nxt['superseded'] = True
                nxt['updated_at'] = now
            else:
                nxt['superseded'] = False
                nxt['audio_start'] = round(cursor, 3)
                nxt['audio_end'] = round(min(dur, cursor + orig_len), 3)
                cursor = float(nxt['audio_end'])
                nxt['updated_at'] = now
                last_active_idx = j
            _sync_status(nxt)
            items[j] = nxt
            updates[reel_file(root, surah, int(nxt['reel']), source_id)] = nxt

        # If shortening left audio uncovered after the last active reel, extend it to dur
        if cursor < dur - 0.5 and last_active_idx > idx:
            tail = dict(items[last_active_idx])
            tail['audio_end'] = round(dur, 3)
            tail['updated_at'] = now
            _sync_status(tail)
            items[last_active_idx] = tail
            updates[reel_file(root, surah, int(tail['reel']), source_id)] = tail

        write_reels(root, updates)
        return list_reels(root, surah, source_id=source_id)


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def _sync_status(data: dict) -> None:
    """Keep `status` consistent with the individual approval flags."""
    if data.get('export') and data.get('status') == EXPORTED:
        return
    if data.get('video_approved'):
        data['status'] = VIDEO_APPROVED
    elif data.get('audio_approved'):
        data['status'] = AUDIO_APPROVED
    else:
        data['status'] = DRAFT


# --------------------------------------------------------------- boundaries


def _chain(root: Path, surah: int, source_id: str | None = None) -> list:
    """All reel drafts of a Surah, normalised and ordered."""
    items = [_normalise(item) for item in list_reels(root, surah, source_id=source_id)]
    if not items:
        raise DraftError(f'No reel drafts for Surah {surah:03}', status=404)
    return items


def _impact_of_shift(items: list, index: int, new_end: float) -> dict:
    """Which reels would move if reel `index` ended at `new_end`."""
    duration = items[-1]['audio_end']
    delta = new_end - items[index]['audio_end']
    moved = []
    if abs(delta) > EPS:
        for position in range(index + 1, len(items)):
            start = items[position]['audio_start'] + delta
            end = items[position]['audio_end'] + delta
            if position == len(items) - 1:
                end = duration
            moved.append({
                'reel': items[position]['reel'],
                'from_start': round(items[position]['audio_start'], 3),
                'from_end': round(items[position]['audio_end'], 3),
                'to_start': round(start, 3),
                'to_end': round(end, 3),
                'approved': bool(items[position].get('audio_approved')),
            })
    return {'delta': round(delta, 3), 'moved': moved}


def _apply_shift(items: list, index: int, new_end: float, confirm: bool) -> tuple:
    """Return the new boundary values for reel `index` and everything after.

    The reel keeps its own length; the following reels keep their lengths
    too and only move. The final reel always ends with the Surah.
    """
    duration = items[-1]['audio_end']
    updates = {}

    updates[index] = {
        'audio_end': round(new_end, 3),
    }

    previous_end = new_end
    for position in range(index + 1, len(items)):
        item = items[position]
        length = item['audio_end'] - item['audio_start']
        start = previous_end
        if position == len(items) - 1:
            end = duration
            if end <= start + EPS:
                raise DraftError(
                    'The last Reel would have no audio left. Shorten an earlier Reel instead.',
                    status=400,
                )
        else:
            end = start + length
            if end > duration:
                end = duration
        updates[position] = {
            'audio_start': round(start, 3),
            'audio_end': round(end, 3),
        }
        previous_end = end

    return updates, previous_end


def _approved_conflict(items: list, index: int, updates: dict) -> dict:
    """Approved reels that a change would move. They are never moved silently."""
    affected = []
    for position, values in updates.items():
        if position == index:
            continue
        item = items[position]
        if not item.get('audio_approved'):
            continue
        moved_start = abs(item['audio_start'] - values['audio_start']) > EPS
        moved_end = abs(item['audio_end'] - values['audio_end']) > EPS
        if moved_start or moved_end:
            affected.append({
                'reel': item['reel'],
                'from_start': round(item['audio_start'], 3),
                'from_end': round(item['audio_end'], 3),
                'to_start': values['audio_start'],
                'to_end': values['audio_end'],
            })
    return {'approved_affected': affected}


def approve_audio(root: Path, surah: int, reel: int, end=None, confirm: bool = False,
                  source_id: str | None = None) -> dict:
    """Confirm a reel's audio boundaries and keep the queue continuous.

    The reel keeps its place in the queue, the following unapproved reels
    move with it, and an already approved neighbour is never moved without
    an explicit confirmation.
    """
    with _LOCK:
        _materialize(root, surah, source_id)
        items = _chain(root, surah, source_id)
        index = next((i for i, item in enumerate(items)
                      if int(item['reel']) == reel), None)
        if index is None:
            raise DraftError(f'Reel {reel:03} not found', status=404)

        current = items[index]
        if current.get('export'):
            raise DraftError('This Reel has already been exported.', status=409)

        duration = items[-1]['audio_end']
        target = current['audio_end'] if end is None else float(end)

        if not math.isfinite(target) or target <= current['audio_start'] + 1:
            raise DraftError('The ending must be at least one second after the start.')
        if target > duration + EPS:
            raise DraftError('The ending must stay inside the Surah.')

        updates, _ = _apply_shift(items, index, target, confirm)
        impact = _impact_of_shift(items, index, target)
        conflict = _approved_conflict(items, index, updates)

        if conflict['approved_affected'] and not confirm:
            raise DraftError(
                'This change would move an already approved Reel. '
                'Confirm to re-open that Reel for review.',
                detail={'impact': impact, **conflict},
                status=409,
            )

        files = {}
        demoted = []
        for position, values in updates.items():
            item = items[position]
            merged = dict(item)
            merged.update(values)
            if position != index and conflict['approved_affected'] and confirm:
                # An approved neighbour that has to move is re-opened so the
                # user reviews it again. Its own approval is not silently kept.
                if item.get('audio_approved') or item.get('video_approved'):
                    demoted.append(merged['reel'])
                merged['audio_approved'] = False
                merged['video_approved'] = False
                merged['status'] = DRAFT
            merged['updated_at'] = _now()
            files[reel_file(root, surah, merged['reel'], source_id)] = merged

        target_data = files[reel_file(root, surah, reel, source_id)]
        target_data['audio_approved'] = True
        target_data['audio_end'] = round(target, 3)
        if end is not None:
            target_data['source'] = 'manual-adjustment'

        # A reel whose audio range moved can no longer keep its video
        # approval, because the approved video no longer matches the audio.
        for position, values in updates.items():
            merged = files[reel_file(root, surah, items[position]['reel'], source_id)]
            original = items[position]
            new_start = float(values.get('audio_start', original['audio_start']))
            new_end = float(values.get('audio_end', original['audio_end']))
            moved = (
                abs(float(original['audio_start']) - new_start) > EPS
                or abs(float(original['audio_end']) - new_end) > EPS
            )
            if moved and merged.get('video_approved'):
                merged['video_approved'] = False

        for merged in files.values():
            _sync_status(merged)

        write_reels(root, files)
        return {
            'reel': reel,
            'audio_end': target_data['audio_end'],
            'demoted': demoted,
            'impact': impact,
            'reels': list_reels(root, surah, source_id=source_id),
        }


def reset_audio(root: Path, surah: int, reel: int, confirm: bool = False,
                source_id: str | None = None) -> dict:
    """Put a reel back to its originally proposed boundaries.

    Video settings and editing progress are kept. An approved neighbour
    is never moved silently.
    """
    with _LOCK:
        _materialize(root, surah, source_id)
        items = _chain(root, surah, source_id)
        index = next((i for i, item in enumerate(items)
                      if int(item['reel']) == reel), None)
        if index is None:
            raise DraftError(f'Reel {reel:03} not found', status=404)

        current = items[index]
        proposed_end = float(current.get('proposed_end', current['audio_end']))
        proposed_start = float(current.get('proposed_start', current['audio_start']))

        if abs(proposed_end - current['audio_end']) <= EPS and \
           abs(proposed_start - current['audio_start']) <= EPS:
            # Nothing to restore, but the approval is still cleared.
            pass

        updates, _ = _apply_shift(items, index, proposed_end, confirm)
        updates[index]['audio_start'] = round(proposed_start, 3)
        impact = _impact_of_shift(items, index, proposed_end)
        conflict = _approved_conflict(items, index, updates)

        if conflict['approved_affected'] and not confirm:
            raise DraftError(
                'Resetting this Reel would move an already approved Reel. '
                'Confirm to re-open that Reel for review.',
                detail={'impact': impact, **conflict},
                status=409,
            )

        files = {}
        demoted = []
        for position, values in updates.items():
            item = items[position]
            merged = dict(item)
            merged.update(values)
            merged['updated_at'] = _now()
            if position == index:
                merged['audio_approved'] = False
                merged['source'] = 'original-proposal'
                # A changed audio range invalidates the video approval, but
                # the video settings and progress are preserved.
                merged['video_approved'] = False
            elif conflict['approved_affected'] and confirm:
                if item.get('audio_approved') or item.get('video_approved'):
                    demoted.append(merged['reel'])
                merged['audio_approved'] = False
                merged['video_approved'] = False
                merged['status'] = DRAFT
            _sync_status(merged)
            files[reel_file(root, surah, merged['reel'], source_id)] = merged

        write_reels(root, files)
        return {
            'reel': reel,
            'demoted': demoted,
            'impact': impact,
            'reels': list_reels(root, surah, source_id=source_id),
        }


def approve_video(root: Path, surah: int, reel: int,
                  source_id: str | None = None) -> dict:
    """Confirm the video settings of a reel."""
    with _LOCK:
        _materialize(root, surah, source_id)
        data = _normalise(read_reel(root, surah, reel, source_id))
        if not data.get('audio_approved'):
            raise DraftError('Approve the audio before the video.', status=409)
        data['video_approved'] = True
        # Remember what was approved, so saving the same settings again
        # does not take the approval away.
        data['approved_video_settings'] = dict(data.get('video_settings') or {})
        data['updated_at'] = _now()
        _sync_status(data)
        write_reels(root, {reel_file(root, surah, reel, source_id): data})
        return data


def reset_video(root: Path, surah: int, reel: int,
                source_id: str | None = None) -> dict:
    """Clear the video settings and progress, keeping the audio approval."""
    with _LOCK:
        _materialize(root, surah, source_id)
        data = _normalise(read_reel(root, surah, reel, source_id))
        data['video_settings'] = {}
        data['editing_progress'] = {}
        data['video_approved'] = False
        data['updated_at'] = _now()
        _sync_status(data)
        write_reels(root, {reel_file(root, surah, reel, source_id): data})
        return data


def record_export(root: Path, surah: int, reel: int, path: str, info: dict = None,
                  source_id: str | None = None) -> dict:
    """Store the finished video against its reel."""
    with _LOCK:
        _materialize(root, surah, source_id)
        data = _normalise(read_reel(root, surah, reel, source_id))
        data['export'] = {
            'path': path,
            'exported_at': _now(),
            **(info or {}),
        }
        data['status'] = EXPORTED
        data['updated_at'] = _now()
        write_reels(root, {reel_file(root, surah, reel, source_id): data})
        return data


def _write_json_atomic(path: Path, data) -> None:
    """Write one JSON file through a staged temporary file.

    A conflict copy is as important as a draft: an interrupted write must
    not leave a truncated recovery file behind.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=path.name + '.', suffix='.tmp'
    )
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write('\n')
        Path(tmp_name).replace(path)
    except Exception:
        try:
            Path(tmp_name).unlink(missing_ok=True)
        except OSError:
            pass
        raise


def import_legacy(root: Path, surah: int, legacy: dict,
                  source_id: str | None = None) -> dict:
    """Bring older browser work into the drafts without losing anything.

    The previous build kept the queue in browser localStorage. That copy
    is only migrated into drafts that have never been touched. When the
    drafts already hold newer work the browser copy is kept next to them
    as a separate file, so neither version is silently discarded.
    """
    if source_id and source_id != 'legacy':
        return {
            'migrated': False,
            'reason': 'browser drafts belong to the built-in library only',
        }
    reels = (legacy or {}).get('reels') or []
    if not reels:
        return {'migrated': False, 'reason': 'the browser copy held no reels'}

    current = list_reels(root, surah, source_id=source_id)
    if len(reels) != len(current):
        folder = surah_folder(root, surah, source_id)
        target = folder / '_legacy_localstorage.json'
        _write_json_atomic(target, legacy)
        return {
            'migrated': False,
            'reason': 'the browser copy has a different number of reels',
            'kept_at': target.relative_to(root).as_posix(),
        }

    untouched = all(
        not item.get('audio_approved')
        and not item.get('video_approved')
        and not item.get('export')
        and not (item.get('video_settings') or {})
        and not (item.get('editing_progress') or {})
        # The boundaries still match the proposal, so nobody moved them.
        and abs(
            float(item['audio_end'])
            - float(item.get('proposed_end', item['audio_end']))
        ) <= EPS
        and abs(
            float(item['audio_start'])
            - float(item.get('proposed_start', item['audio_start']))
        ) <= EPS
        for item in current
    )
    has_work = any(
        item.get('approved')
        or (
            item.get('end') is not None
            and abs(float(item['end']) - float(item.get('proposed_end', item['end']))) > EPS
        )
        for item in reels
    )

    if not untouched:
        # The drafts already hold newer work. The browser copy is kept next
        # to them so that neither version is silently discarded.
        folder = surah_folder(root, surah, source_id)
        target = folder / '_legacy_localstorage.json'
        _write_json_atomic(target, legacy)
        return {
            'migrated': False,
            'reason': 'the drafts already hold newer work',
            'kept_at': target.relative_to(root).as_posix(),
        }

    if not has_work:
        # Nothing in the browser copy differs from the proposal, so there is
        # nothing to bring over and nothing that could be lost.
        return {'migrated': False, 'reason': 'the browser copy held no changes'}

    updates = {}
    for item in current:
        match = next(
            (entry for entry in reels
             if int(entry.get('id', 0)) == int(item.get('reel', 0))),
            None,
        )
        if not match:
            continue
        merged = dict(item)
        if match.get('start') is not None:
            merged['audio_start'] = round(float(match['start']), 3)
        if match.get('end') is not None:
            merged['audio_end'] = round(float(match['end']), 3)
        merged['source'] = 'migrated-browser-draft'
        merged['updated_at'] = _now()
        updates[reel_file(root, surah, merged['reel'], source_id)] = merged

    write_reels(root, updates)
    return {'migrated': True, 'reels': len(updates)}


def export_path(root: Path, surah: int, reel: int,
                source_id: str | None = None) -> Path:
    """Where a finished reel of a Surah is written."""
    folder = surah_folder(root, surah, source_id)
    if source_id and source_id != 'legacy':
        return (root / 'Output' / 'reels' / '_sources' / source_id
                / folder.name / f'Reel_{reel:03}')
    return root / 'Output' / 'reels' / folder.name / f'Reel_{reel:03}'


def _stamp(seconds: float) -> str:
    total = int(round(float(seconds)))
    return f'{total // 60:02d}-{total % 60:02d}'


def export_filename(surah: int, folder_name: str, reel: int,
                    start: float, end: float, lang: str = 'en') -> str:
    """A safe file name that identifies the Surah and reel in English or Arabic.

    EN: ``002_Al-Baqarah_Reel_001_00-00_to_02-45.mp4``
    AR: ``002_سورة-البقرة_ريل-001_00-00_إلى_02-45.mp4``
    """
    stem = Path(folder_name).name
    pieces = stem.split(' ', 2)
    number = pieces[0] if pieces else f'{surah:03d}'
    name = pieces[2] if len(pieces) > 2 else ''
    if str(lang).lower().startswith('ar'):
        arabic = re.sub(r'[^\u0600-\u06FF\s]+', ' ', name).strip()
        safe_ar = re.sub(r'\s+', '-', arabic).strip('-')
        if not safe_ar:
            safe_ar = f'سورة-{surah:03d}'
        return (f'{number}_{safe_ar}_ريل-{reel:03d}'
                f'_{_stamp(start)}_إلى_{_stamp(end)}.mp4')
    # Keep the readable Latin part of the name, drop the Arabic script and
    # anything else that is not safe in a file name.
    latin = re.sub(r'[^\x00-\x7F]+', ' ', name)
    safe = re.sub(r'[^A-Za-z0-9\-]+', '-', latin).strip('-')
    if not safe:
        safe = f'Surah_{surah:03d}'
    return (f'{number}_{safe}_Reel_{reel:03d}'
            f'_{_stamp(start)}_to_{_stamp(end)}.mp4')
