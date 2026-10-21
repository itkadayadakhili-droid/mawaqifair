// عامل الخدمة: يخزّن هيكل التطبيق (HTML/CSS/JS/خطوط/أيقونات) ليعمل بلا إنترنت بعد أول فتح.
// البيانات نفسها تُحفظ في IndexedDB على الهاتف ولا علاقة لها بهذا الملف.
// عند تعديل أي ملف من الملفات أدناه: غيّر رقم VERSION حتى تتحدّث النسخة المخزّنة عند المستخدمين.
const VERSION = 'mawaqif-airports-v8';
const FILES = [
    './', 'index.html', 'manifest.json',
    'css/app.css', 'js/i18n-en.js', 'js/i18n.js', 'js/xlsx-lite.js', 'js/brand.js', 'js/violations.js', 'js/storage.js', 'js/logic.js', 'js/app.js',
    'assets/brand/syria-eagle.svg',
    'assets/fonts/itfQomraArabic-Regular.otf', 'assets/fonts/itfQomraArabic-Medium.otf', 'assets/fonts/itfQomraArabic-Bold.otf', 'assets/fonts/itfQomraArabic-Black.otf',
    'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/maskable-512.png'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mawaqif-airports-v') && k !== VERSION).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// الملفات من الذاكرة أولاً، وتُحدَّث في الخلفية متى توفّر الاتصال
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        caches.match(e.request).then(hit => {
            const net = fetch(e.request).then(res => {
                if (res && res.ok && new URL(e.request.url).origin === location.origin) {
                    const copy = res.clone();
                    caches.open(VERSION).then(c => c.put(e.request, copy));
                }
                return res;
            }).catch(() => hit);
            return hit || net;
        })
    );
});
