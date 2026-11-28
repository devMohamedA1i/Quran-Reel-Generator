/**
 * Organised frontend API client for the Flask backend.
 * All components communicate with Flask through these functions.
 */

function withSource(url, sourceId) {
  if (!sourceId || sourceId === 'legacy') return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}source=${encodeURIComponent(sourceId)}`;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.detail = data.detail;
    err.data = data;
    throw err;
  }
  return data;
}

function postJson(url, body = {}) {
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const api = {
  withSource,

  // Library & general status
  getLibrary: () => requestJson('/api/library'),
  getAudioLibrary: () => requestJson('/api/audio-library'),

  // Quran Setup (10 reciters, download, verify)
  getSetupReciters: () => requestJson('/api/setup/reciters'),
  startReciterDownload: (reciterId) =>
    postJson(`/api/setup/download/${encodeURIComponent(reciterId)}`),
  getReciterDownloadStatus: (reciterId) =>
    requestJson(`/api/setup/download/${encodeURIComponent(reciterId)}`),
  cancelReciterDownload: (reciterId) =>
    postJson(`/api/setup/download/${encodeURIComponent(reciterId)}/cancel`),
  verifyReciter: (reciterId, activate = true) =>
    postJson(`/api/setup/verify/${encodeURIComponent(reciterId)}`, { activate }),

  // Drafts & Reel Queue
  getDrafts: (surah, sourceId) =>
    requestJson(withSource(`/api/drafts/${surah}`, sourceId)),
  saveDraft: (surah, reel, payload, sourceId) =>
    postJson(withSource(`/api/drafts/${surah}/${reel}`, sourceId), {
      ...payload,
      source: sourceId || undefined,
    }),
  updateReelRange: (surah, reel, { audio_start, audio_end }, sourceId) =>
    postJson(withSource(`/api/drafts/${surah}/${reel}/range`, sourceId), {
      audio_start,
      audio_end,
      source: sourceId || undefined,
    }),
  approveAudio: (surah, reel, { end, confirm = false } = {}, sourceId) =>
    postJson(withSource(`/api/drafts/${surah}/${reel}/approve-audio`, sourceId), {
      end,
      confirm,
      source: sourceId || undefined,
    }),
  resetAudio: (surah, reel, { confirm = false } = {}, sourceId) =>
    postJson(withSource(`/api/drafts/${surah}/${reel}/reset-audio`, sourceId), {
      confirm,
      source: sourceId || undefined,
    }),
  reproposeDrafts: (surah, sourceId) =>
    postJson(withSource(`/api/drafts/${surah}/repropose`, sourceId)),

  // Audio & Waveform & Ayah markers
  getAudioSource: (surah, sourceId) =>
    requestJson(withSource(`/api/audio-source/${surah}`, sourceId)),
  getWaveform: (surah, { start, end, columns = 1200, threshold = -20, minSilence = 0.18 }, sourceId) => {
    const qs = new URLSearchParams({
      start: String(start),
      end: String(end),
      columns: String(columns),
      threshold: String(threshold),
      min_silence: String(minSilence),
    });
    return requestJson(withSource(`/api/surah-waveform/${surah}?${qs.toString()}`, sourceId));
  },
  getPauses: (surah, sourceId) =>
    requestJson(withSource(`/api/speech-pauses/${surah}`, sourceId)),
  getAyahs: (surah, sourceId) =>
    requestJson(withSource(`/api/ayahs/${surah}`, sourceId)),
  getVerses: (surah, sourceId) =>
    requestJson(withSource(`/api/verses/${surah}`, sourceId)),
  audioFileUrl: (surah, sourceId) =>
    withSource(`/api/audio-file/${surah}`, sourceId),

  // Video Preview & Settings & Approval
  approveVideo: (surah, reel, sourceId) =>
    postJson(withSource(`/api/drafts/${surah}/${reel}/approve-video`, sourceId)),
  resetVideo: (surah, reel, sourceId) =>
    postJson(withSource(`/api/drafts/${surah}/${reel}/reset-video`, sourceId)),
  fetchPreviewBlob: async (payload) => {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let msg = `Preview failed (${res.status})`;
      try {
        const d = await res.json();
        if (d.error) msg = d.error;
      } catch {}
      throw new Error(msg);
    }
    return res.blob();
  },
  fetchPreviewOverlayBlob: async (payload) => {
    const res = await fetch('/api/preview-overlay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let msg = `Overlay preview failed (${res.status})`;
      try {
        const d = await res.json();
        if (d.error) msg = d.error;
      } catch {}
      throw new Error(msg);
    }
    return res.blob();
  },
  importBackgrounds: async (kind, files) => {
    const form = new FormData();
    form.append('kind', kind);
    for (const file of files) {
      form.append('files', file);
    }
    return requestJson('/api/background-import', { method: 'POST', body: form });
  },

  // Export & Jobs & Outputs
  exportDraftReel: (surah, reel, sourceId, payload = {}) =>
    postJson(withSource(`/api/drafts/${surah}/${reel}/export`, sourceId), {
      source: sourceId || undefined,
      ...payload,
    }),
  getJob: (jobId) => requestJson(`/api/job/${encodeURIComponent(jobId)}`),
  cancelJob: (jobId) => postJson(`/api/job/${encodeURIComponent(jobId)}/cancel`, {}),
  draftVideoUrl: (surah, reel, sourceId) =>
    withSource(`/api/draft-video/${surah}/${reel}`, sourceId),
  getOutputs: (sourceId) =>
    requestJson(withSource('/api/outputs', sourceId)),
  revealExport: (file) => postJson('/api/reveal-export', { file }),
  openAudioFolder: (folder) => postJson('/api/open-audio-folder', { folder: folder || '' }),
  selectAudioFolder: () => postJson('/api/select-audio-folder', {}),
  openGuide: () => postJson('/api/open-guide', {}),
};
