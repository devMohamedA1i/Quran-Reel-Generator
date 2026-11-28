export function detectDefaultLang() {
  try {
    const saved = localStorage.getItem('qrg.pwa.lang');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {}
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
    if (langs.some((l) => String(l).toLowerCase().startsWith('ar'))) return 'ar';
  } catch {}
  return 'en';
}

export function toArabicDigits(input) {
  return String(input).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

export function formatTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function buildExportFilename(surahObj, reelNum, startSec, endSec, lang) {
  const num = String(surahObj?.id || 1).padStart(3, '0');
  const rPad = String(reelNum || 1).padStart(3, '0');
  const s = formatTime(startSec).replace(/:/g, '-');
  const e = formatTime(endSec).replace(/:/g, '-');
  if (lang === 'ar') {
    const arName = (surahObj?.name || 'الفاتحة').replace(/\s+/g, '-');
    return `${num}_سورة-${arName}_ريل-${rPad}_${s}_إلى_${e}.mp4`;
  }
  const enName = (surahObj?.transliteration || 'Al-Fatihah').replace(/[^A-Za-z0-9-]+/g, '-');
  return `${num}_${enName}_Reel-${rPad}_${s}_to_${e}.mp4`;
}

export const T = {
  en: {
    appName: 'Quran Reel Generator',
    installApp: 'Install App',
    installIosHint: 'On iPhone Safari: tap ≡ (or Share ↑) at the bottom → Share → "Add to Home Screen".',
    chooseReciter: 'Choose Quran Reciter',
    chooseSurah: 'Select Surah',
    verses: 'verses',
    reelQueue: 'Reel Queue',
    reelsUnit: 'Reels',
    reelPrefix: 'Reel',
    activePill: 'Active',
    statusDraft: 'Draft',
    statusExported: 'Exported',
    waveformTitle: 'Waveform Editor',
    fullSurah: 'Full Surah',
    startTime: 'Start',
    endTime: 'End',
    stop: 'Stop',
    resetAudio: 'Reset Audio',
    loadingAudio: 'Loading recitation from MP3Quran…',
    audioError: 'Could not load recitation. Check connection and try again.',
    start: 'Start',
    end: 'End',
    duration: 'Duration',
    zoomIn: 'Zoom',
    zoomOut: 'Zoom',
    resetZoom: 'Fit All',
    snapPause: 'Snap to closest Pause',
    videoStudio: '9:16 Live Preview',
    toolBg: 'Media',
    toolEffect: 'Effects',
    toolSize: 'Size',
    toolPos: 'Position',
    toolBgBox: 'Backdrop',
    toolColor: 'Colour',
    uploadFile: 'Upload File',
    showSurahName: 'Show surah name',
    showAyahNum: 'Show ayah number',
    showEnglish: 'English translation',
    resetVideo: 'Reset Video',
    exportBtn: 'Export Reel',
    exporting: 'Exporting…',
    cancel: 'Cancel',
    exportDone: 'Exported successfully',
    shareBtn: 'Share / Save',
    downloadAgain: 'Download MP4',
    exportUnsupported: 'Your browser does not support on-device MP4 export. Please open in Safari 16.4+ or Chrome.',
    footerLine1: 'Quran Reel Generator · Open Source (MIT License) · Free for All Users · Free Quran Audio via MP3Quran',
    footerLine2: "Please preserve the accuracy and dignity of the Holy Qur'an in every reel you share.",
    footerAuthor: 'Produced by Developer. Mohamed Ali',
  },
  ar: {
    appName: 'مولّد ريلز القرآن',
    installApp: 'تثبيت التطبيق',
    installIosHint: 'على Safari في الآيفون: اضغط ≡ (أو المشاركة ↑) بالأسفل ← مشاركة ← "إضافة إلى الشاشة الرئيسية".',
    chooseReciter: 'اختر القارئ',
    chooseSurah: 'اختر السورة',
    verses: 'آية',
    reelQueue: 'قائمة الريلز',
    reelsUnit: 'ريلز',
    reelPrefix: 'ريل',
    activePill: 'نشط',
    statusDraft: 'مسودة',
    statusExported: 'مُصدَّر',
    waveformTitle: 'محرر الموجة الصوتية',
    fullSurah: 'السورة كاملة',
    startTime: 'البداية',
    endTime: 'النهاية',
    stop: 'إيقاف',
    resetAudio: 'إعادة ضبط الصوت',
    loadingAudio: 'جارٍ تحميل التلاوة من MP3Quran…',
    audioError: 'تعذّر تحميل التلاوة. تحقق من الاتصال وحاول مجدداً.',
    start: 'البداية',
    end: 'النهاية',
    duration: 'المدة',
    zoomIn: 'تكبير',
    zoomOut: 'تصغير',
    resetZoom: 'عرض الكل',
    snapPause: 'التقاط أقرب وقفة',
    videoStudio: 'معاينة حية 9:16',
    toolBg: 'الخلفية',
    toolEffect: 'التأثيرات',
    toolSize: 'الحجم',
    toolPos: 'الموضع',
    toolBgBox: 'التظليل',
    toolColor: 'اللون',
    uploadFile: 'رفع ملف',
    showSurahName: 'إظهار اسم السورة',
    showAyahNum: 'إظهار رقم الآية',
    showEnglish: 'الترجمة الإنجليزية',
    resetVideo: 'إعادة ضبط الفيديو',
    exportBtn: 'تصدير الريل',
    exporting: 'جارٍ التصدير…',
    cancel: 'إلغاء',
    exportDone: 'تم التصدير بنجاح',
    shareBtn: 'مشاركة / حفظ',
    downloadAgain: 'تحميل MP4',
    exportUnsupported: 'متصفحك لا يدعم تصدير MP4 مباشرة. يرجى الفتح في Safari 16.4+ أو Chrome.',
    footerLine1: 'مولّد ريلز القرآن | مفتوح المصدر (رخصة MIT) | مجاني لجميع المستخدمين | تلاوات مجانية من MP3Quran',
    footerLine2: 'نرجو الحفاظ على دقة النص القرآني وتعظيمه في كل مقطع تنشره.',
    footerAuthor: 'إنتاج المطور محمد علي',
  },
};
