// اللغة: العربية (الافتراضية) أو الإنجليزية. __t يترجم نص الواجهة، وبيانات المستخدم لا تمر من هنا أبداً.
(function (w) {
    var lang = 'ar';
    try { lang = w.localStorage.getItem('mawaqif.lang') === 'en' ? 'en' : 'ar'; } catch (e) {}
    w.APP_LANG = lang;
    w.__t = function (s) {
        if (lang !== 'en' || s == null) return s;
        s = String(s);
        var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
        var D = w.I18N_EN || {};
        return D[m[2]] != null ? m[1] + D[m[2]] + m[3] : s;
    };
    // تغيير اللغة يعيد تحميل التطبيق (البيانات لا تتأثر)
    w.setAppLang = function (l) {
        try { w.localStorage.setItem('mawaqif.lang', l === 'en' ? 'en' : 'ar'); } catch (e) {}
        w.location.reload();
    };
    var root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'en' ? 'ltr' : 'rtl';
})(window);
