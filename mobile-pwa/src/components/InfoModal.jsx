import React, { useEffect } from 'react';

export default function InfoModal({
  open,
  onClose,
  lang,
  t,
  installPrompt,
  installFeedback,
  isStandalone,
  onInstallClick,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const isAr = lang === 'ar';

  return (
    <div className="mac-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={isAr ? 'حول التطبيق' : 'About & Help'}>
      <div className="mac-modal-sheet" dir={isAr ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
        <div className="mac-modal-head">
          <div className="mac-modal-brand">
            <img src="./assets/quran-header-icon.png" alt="" className="mac-modal-icon" />
            <div>
              <h2 className="mac-modal-title">{t.appName}</h2>
              <span className="mac-modal-sub">
                {isAr ? 'مفتوح المصدر · مجاني ١٠٠٪ لجميع المستخدمين' : 'Open Source · 100% Free for All Users'}
              </span>
            </div>
          </div>
          <button type="button" className="mac-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="mac-modal-body">
          {/* About / README summary */}
          <section className="mac-modal-sec">
            <h3>{isAr ? 'عن التطبيق' : 'About the App'}</h3>
            <p>
              {isAr
                ? 'أداة مجانية ومفتوحة المصدر لإنشاء مقاطع ريلز قرآنية عمودية (9:16) بدقة عالية مع مزامنة الآيات بالخط العثماني (حفص الإصدار ١٨) وترجمة المعاني بالإنجليزية، لـ ١٠ قراء كبار وجميع السور الـ ١١٤ — بدون إعلانات أو اشتراكات أو رفع لبياناتك.'
                : 'A free, open-source studio for creating vertical 9:16 Quran reels synchronized with authentic Uthmani Hafs v18 calligraphy and optional Saheeh International English translation across 10 classic reciters and all 114 Surahs — with zero ads, zero subscriptions, and 100% on-device video rendering.'}
            </p>
            <ul className="mac-modal-list">
              <li>{isAr ? '١٠ قراء معتمدين وجميع السور الـ ١١٤ مع بث مباشر من MP3Quran.' : '10 renowned reciters & all 114 Surahs via free MP3Quran audio.'}</li>
              <li>{isAr ? 'يقسّم التطبيق السورة كاملة تلقائياً إلى مقاطع ريلز جاهزة (~٣ دقائق لكل مقطع) في قائمة الريلز، ويمكنك تعديل طول أي مقطع بحرية من قسم تحرير الصوت (الموجة الصوتية) والتقاط الوقفات.' : 'Automatically divides the full Surah into ready-to-export ~3-minute reels in a Reel Queue list — and you can adjust any clip\'s length anytime from the Audio Editing (Waveform) section with pause snapping.'}</li>
              <li>{isAr ? '١٠ خلفيات فيديو HD جاهزة + رفع خلفياتك الخاصة، ١٨ مؤثر بصري، ٥ أحجام، ٥ مواضع، ٥ خلفيات نص، و٤١ لوناً للخط.' : '10 built-in HD vertical backgrounds + upload your own, 18 video effects, 5 font sizes, 5 text positions, 5 backdrops & 41 text colours.'}</li>
              <li>{isAr ? 'تصدير MP4 محلياً على جهازك (720×1280) جاهز للنشر مباشرة.' : 'On-device MP4 export (720×1280 H.264/AAC) ready to save or share.'}</li>
            </ul>
          </section>

          {/* Quick How to Use */}
          <section className="mac-modal-sec">
            <h3>{isAr ? 'طريقة الاستخدام' : 'How to Use'}</h3>
            <ol className="mac-modal-steps">
              <li>{isAr ? 'اختر القارئ ثم السورة من الأعلى — سيقسّم التطبيق السورة كاملة تلقائياً إلى مقاطع ~٣ دقائق جاهزة في قائمة الريلز.' : 'Choose your Quran reciter and Surah at the top — the app automatically divides the full Surah into ready ~3-minute reels in the Reel Queue list.'}</li>
              <li>{isAr ? 'اختر أي مقطع من قائمة الريلز، وإذا أردت تقصيره أو تطويله عدّل طوله بسهولة من قسم تحرير الصوت بسحب مقبضي البداية (S) والنهاية (E) على الموجة الصوتية.' : 'Pick any reel from the Reel Queue list, and optionally adjust its length in the Audio Editing section by dragging the Start (S) and End (E) handles on the waveform.'}</li>
              <li>{isAr ? 'خصّص الخلفية والمؤثرات وحجم الخط وموضعه ولونه، وبدّل بين (EN / عربي) لإظهار أو إخفاء الترجمة الإنجليزية.' : 'Customize Media, Effects, Size, Position, Backdrop, and Colour. Switch EN / عربي to show or hide English translation.'}</li>
              <li>{isAr ? 'اضغط «تصدير الريل» لحفظ الفيديو مباشرة في جهازك أو مشاركته.' : 'Tap Export Reel to render and save or share your MP4 video.'}</li>
            </ol>
          </section>

          {/* iPhone Instructions */}
          <section className="mac-modal-sec">
            <h3>{isAr ? 'التثبيت والاستخدام على آيفون (Safari)' : 'Install & Use on iPhone (Safari)'}</h3>
            <ol className="mac-modal-steps">
              <li>{isAr ? 'افتح التطبيق في متصفح Safari على الآيفون.' : 'Open the app in Safari on your iPhone.'}</li>
              <li>{isAr ? 'اضغط على أيقونة القائمة (≡) يسار شريط العنوان في الأسفل (أو زر المشاركة ↑ في الإصدارات الأقدم).' : 'Tap the menu icon (≡) on the left of the bottom address bar (or the Share ↑ button on older iOS).'}</li>
              <li>{isAr ? 'اضغط على «مشاركة» (Share ↑).' : 'Tap Share (↑).'}</li>
              <li>{isAr ? 'مرّر للأسفل واختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen) ثم اضغط «إضافة».' : 'Scroll down, tap Add to Home Screen (+), then tap Add.'}</li>
              <li>{isAr ? 'افتح الأيقونة من الشاشة الرئيسية لاستخدامه كتطبيق كامل الشاشة.' : 'Launch the icon from your Home Screen to run full-screen like a native app.'}</li>
            </ol>
          </section>

          {/* Android Instructions + Direct APK Download & PWA Install */}
          <section className="mac-modal-sec">
            <h3>{isAr ? 'التثبيت والاستخدام على أندرويد' : 'Install & Use on Android'}</h3>
            <ol className="mac-modal-steps">
              <li>{isAr ? 'اضغط زر «تحميل تطبيق أندرويد (APK)» أدناه لتحميل التطبيق مباشرة (يعمل حتى من داخل ماسنجر أو واتساب).' : 'Tap Download Android App (.apk) below to download the standalone Android app directly (works even from Messenger or WhatsApp).'}</li>
              <li>{isAr ? 'افتح ملف الـ APK بعد التحميل واضغط «تثبيت» (قد يطلب الهاتف السماح بالتثبيت من هذا المصدر مرة واحدة فقط).' : 'Open the downloaded .apk file and tap Install (Android may ask once to allow installing from your browser).'}</li>
            </ol>
            {!isStandalone && !(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) && (
              <div className="mac-modal-install-wrap">
                <a
                  className="mac-modal-install-btn"
                  href="https://github.com/devMohamedA1i/Quran-Reel-Generator/releases/latest/download/Quran-Reel-Generator-Android.apk"
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                >
                  {isAr ? 'تحميل تطبيق أندرويد (APK)' : 'Download Android App (.apk)'}
                </a>
                {installPrompt && (
                  <button
                    type="button"
                    className="mac-modal-install-btn is-secondary"
                    onClick={onInstallClick}
                  >
                    {isAr ? 'أو تثبيت كتطبيق ويب (Chrome)' : 'Or Install Web App (Chrome)'}
                  </button>
                )}
              </div>
            )}
          </section>

          {/* License, Credits & Disclaimer */}
          <section className="mac-modal-sec mac-modal-credits">
            <h3>{isAr ? 'الرخصة والحقوق' : 'License & Credits'}</h3>
            <p className="mac-credit-main">
              Quran Reel Generator · Open Source (MIT License) · Free for All Users · Free Quran Audio via MP3Quran
            </p>
            <p className="mac-credit-dignity">
              {isAr
                ? 'يرجى الحفاظ على دقة وقدسية القرآن الكريم في كل مقطع تشاركه.'
                : "Please preserve the accuracy and dignity of the Holy Qur'an in every reel you share."}
            </p>
            <p className="mac-credit-author">
              Produced by Developer. Mohamed Ali ·{' '}
              <a href="https://github.com/devMohamedA1i/Quran-Reel-Generator" target="_blank" rel="noopener noreferrer" dir="ltr">
                https://github.com/devMohamedA1i/Quran-Reel-Generator
              </a>
            </p>
            <div className="mac-credit-dua">
              <p>
                {isAr ? (
                  <>
                    إذا لاحظت أي شيء لا يعمل بشكل صحيح، أو ظننت أنني أخطأت في أي جزء من التطبيق، فلا تتردد في التواصل معي عبر{' '}
                    <a href="mailto:dev.mohamed.ali1@gmail.com" dir="ltr">dev.mohamed.ali1@gmail.com</a>{' '}
                    لتنبيهي — ملاحظاتك تساعد في بقاء هذه الأداة دقيقة ونافعة للجميع.
                  </>
                ) : (
                  <>
                    If you notice anything not working correctly, or if you think I made a mistake in any part of the app, please don&apos;t hesitate to contact me at{' '}
                    <a href="mailto:dev.mohamed.ali1@gmail.com" dir="ltr">dev.mohamed.ali1@gmail.com</a>{' '}
                    to enlighten me — your feedback helps keep this tool accurate and beneficial for everyone.
                  </>
                )}
              </p>
              <p>
                {isAr
                  ? 'جزاكم الله خيراً وجعله في ميزان حسناتكم'
                  : "Jazakum Allahu khayran wa ja'alahu fi mizan hasanatikum"}
              </p>
              <p>
                {isAr
                  ? 'لا تنسونا من صالح دعائكم.'
                  : 'Do not forget us in your sincere prayers.'}
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
