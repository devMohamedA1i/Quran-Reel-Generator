import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pwaRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pwaRoot, '..');
const pub = path.join(pwaRoot, 'public');

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function copyFileIfExists(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// 1. UI Icons, Hero Banner & Reciter Portraits
copyFileIfExists(
  path.join(repoRoot, 'frontend/public/assets/quran-header-icon.png'),
  path.join(pub, 'assets/quran-header-icon.png')
);
copyFileIfExists(
  path.join(repoRoot, 'frontend/public/assets/Banner.png'),
  path.join(pub, 'assets/Banner.png')
);
copyFileIfExists(
  path.join(pwaRoot, 'social-preview.png'),
  path.join(pub, 'assets/social-preview.png')
);
copyDir(
  path.join(repoRoot, 'frontend/public/assets/reciters'),
  path.join(pub, 'assets/reciters')
);

// 2. Uthmani Hafs v18 Font & Quran Text JSONs
copyFileIfExists(
  path.join(repoRoot, 'Assets/fonts/UthmanicHafs1Ver18.ttf'),
  path.join(pub, 'data/fonts/UthmanicHafs1Ver18.ttf')
);
for (const name of ['chapters.json', 'uthmani.json', 'english_saheeh.json']) {
  copyFileIfExists(
    path.join(repoRoot, 'Assets/Quran Text', name),
    path.join(pub, 'data/text', name)
  );
}

// 3. Quran Timing (default + per-reciter)
copyDir(
  path.join(repoRoot, 'Assets/Quran Timing'),
  path.join(pub, 'data/timing')
);

// 4. Starter HD Sample Videos + Instant JPEG Thumbnails
// Sample9.mp4 reuses the already-tracked Assets/Background Templates/Videos/Sample1.mp4 (zero git duplication);
// lightweight 720x1280 Sample1..8 & Sample10 + all Sample1..10.jpg thumbnails live in mobile-pwa/samples/.
copyFileIfExists(
  path.join(repoRoot, 'Assets/Background Templates/Videos/Sample1.mp4'),
  path.join(pub, 'data/samples/Sample9.mp4')
);
copyDir(
  path.join(pwaRoot, 'samples'),
  path.join(pub, 'data/samples')
);

console.log('Synced shared Quran assets into mobile-pwa/public/');
