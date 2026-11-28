const cache = {
  chapters: null,
  uthmani: null,
  english: null,
  timings: new Map(),
};

export async function loadChapters() {
  if (cache.chapters) return cache.chapters;
  const res = await fetch('./data/text/chapters.json');
  const data = await res.json();
  cache.chapters = data.chapters || [];
  return cache.chapters;
}

export async function loadUthmani() {
  if (cache.uthmani) return cache.uthmani;
  const res = await fetch('./data/text/uthmani.json');
  cache.uthmani = await res.json();
  return cache.uthmani;
}

export async function loadEnglish() {
  if (cache.english) return cache.english;
  const res = await fetch('./data/text/english_saheeh.json');
  const data = await res.json();
  cache.english = data.verses || {};
  return cache.english;
}

export function cleanSaheehText(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function loadSurahTimings(reciter, surahNum) {
  const pad = String(surahNum).padStart(3, '0');
  const key = `${reciter?.timingFolder || 'default'}:${pad}`;
  if (cache.timings.has(key)) return cache.timings.get(key);

  const urls = [];
  if (reciter?.timingFolder) {
    urls.push(`./data/timing/reciters/${reciter.timingFolder}/${pad}.json`);
  }
  urls.push(`./data/timing/${pad}.json`);

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length) {
          const norm = rows.map((r) => ({
            ayah: Number(r.ayah),
            start: Number(r.start_time || 0) / 1000,
            end: Number(r.end_time || 0) / 1000,
          }));
          cache.timings.set(key, norm);
          return norm;
        }
      }
    } catch {
      // try fallback
    }
  }
  return [];
}

/**
 * Resolve the verse displayed at a given time (seconds) inside a Surah,
 * returning { ayah, arabic, english, surahNameAr, surahNameEn, alpha }.
 */
export function resolveActiveVerse({
  timeSec,
  surahObj,
  uthmaniMap,
  englishMap,
  timings,
  pauses = [],
  showEnglish = false,
  isPlaying = true,
  effect = 'none',
}) {
  if (!surahObj || !uthmaniMap) return null;
  const sNum = surahObj.id;
  const surahVerses = uthmaniMap[String(sNum)] || [];
  if (!surahVerses.length) return null;

  let entry = null;
  let inInterAyahGap = false;
  if (timings && timings.length) {
    entry = timings.find((r) => timeSec >= r.start && timeSec < r.end);
    if (!entry) {
      const prev = [...timings].reverse().find((r) => timeSec >= r.end);
      const next = timings.find((r) => timeSec < r.start);
      if (prev && next && next.start - prev.end >= 0.25) {
        inInterAyahGap = true;
        entry = prev;
      } else if (prev && timeSec - prev.end < 0.25) {
        entry = prev;
      } else if (next) {
        // Before the first Ayah or in a leading silence
        inInterAyahGap = next.start - timeSec >= 0.25;
        entry = next;
      } else {
        entry = timings[timings.length - 1];
      }
    }
  }

  let ayahNum = entry ? entry.ayah : 1;
  let arabic = '';
  let english = '';

  if (ayahNum === 0) {
    if (sNum === 9) return null;
    const basmala = (uthmaniMap['1'] || [])[0];
    arabic = basmala ? basmala.text : 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';
    if (showEnglish) {
      english = cleanSaheehText(englishMap?.['1:1']?.text || '');
    }
  } else {
    const verseObj = surahVerses.find((v) => Number(v.verse) === ayahNum) || surahVerses[0];
    if (!verseObj) return null;
    ayahNum = Number(verseObj.verse);
    arabic = verseObj.text;
    if (showEnglish) {
      english = cleanSaheehText(englishMap?.[`${sNum}:${ayahNum}`]?.text || '');
    }
  }

  // Smooth cubic ease-in-out helper
  const smooth = (x) => {
    const c = Math.max(0, Math.min(1, x));
    return c * c * (3 - 2 * c);
  };

  // Match Mac app smooth dissolve: crisp (alpha = 1) while paused/scrubbing;
  // strictly monotonic fade-in at Ayah start & fade-out at Ayah end during playback/export (never blinks mid-Ayah).
  let alpha = 1;
  if (isPlaying && entry) {
    const eff = String(effect || 'none');
    const dur = Math.max(0.2, entry.end - entry.start);
    const reqIn = eff.includes('fade_slow') ? 1.0 : eff.includes('fade_fast') ? 0.25 : 0.55;
    const reqOut = eff.includes('fade_slow') ? 0.45 : eff.includes('fade_fast') ? 0.15 : 0.35;
    const fadeIn = Math.min(reqIn, dur * 0.42);
    const fadeOut = Math.min(reqOut, dur * 0.42);

    if (inInterAyahGap || timeSec < entry.start || timeSec >= entry.end) {
      alpha = 0;
    } else if (timeSec - entry.start < fadeIn) {
      alpha = smooth((timeSec - entry.start) / fadeIn);
    } else if (entry.end - timeSec < fadeOut) {
      alpha = smooth((entry.end - timeSec) / fadeOut);
    } else {
      alpha = 1;
    }
  }

  return {
    ayah: ayahNum,
    arabic,
    english,
    surahNameAr: `سورة ${surahObj.name}`,
    surahNameEn: surahObj.transliteration || '',
    alpha,
  };
}
