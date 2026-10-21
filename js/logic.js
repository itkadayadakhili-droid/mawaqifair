/* منطق وحدة المواقيف — مطابق لمنطق النظام الأساسي (detention_status / next_detention_number) */
(function (w) {
    'use strict';
    var L = {};

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    L.esc = function (s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    /* ---------- التواريخ (نصوص YYYY-MM-DD، بلا مناطق زمنية) ---------- */
    L.today = function () {
        var d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    };
    function toUtc(s) {
        var p = String(s).split('-');
        return Date.UTC(+p[0], +p[1] - 1, +p[2]);
    }
    L.daysBetween = function (from, to) {
        return Math.round((toUtc(to || L.today()) - toUtc(from)) / 86400000);
    };
    L.addDays = function (s, n) {
        var d = new Date(toUtc(s) + n * 86400000);
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    };
    L.isValidDate = function (s) {
        return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(toUtc(s));
    };
    L.monthOf = function (s) { return (s || '').slice(0, 7); };

    /* ---------- الحالة ---------- */
    L.extraDays = function (d) {
        return (d.extensions || []).reduce(function (a, e) { return a + (parseInt(e.days, 10) || 0); }, 0);
    };

    // يعيد: key / label / overdue / near / remaining / daysSince / total / expectedRelease
    L.status = function (d) {
        var total = (parseInt(d.proposedDays, 10) || 0) + L.extraDays(d);
        var daysSince = Math.max(0, L.daysBetween(d.detentionDate));
        var remaining = total - daysSince;
        var base = {
            total: total, daysSince: daysSince, remaining: remaining,
            expectedRelease: L.addDays(d.detentionDate, total), overdue: false, near: false
        };
        if (d.isVoided) return Object.assign(base, { key: 'voided', label: __t('ملغى') });
        if (d.releaseDate) return Object.assign(base, { key: 'released', label: __t('أُخلي سبيله') });
        if (d.referredTo) return Object.assign(base, { key: 'referred', label: __t('أُحيل إلى جهة أخرى') });
        if (!(parseInt(d.proposedDays, 10) > 0) || !d.detentionDate) return Object.assign(base, { key: 'incomplete', label: __t('بيانات ناقصة'), remaining: 99999, total: 0, expectedRelease: '' });
        if (remaining < 0) return Object.assign(base, { key: 'overdue', label: __t('تجاوز المدة المقترحة'), overdue: true });
        if (remaining <= 1) return Object.assign(base, { key: 'near', label: __t('موقوف — قرب انتهاء المدة'), near: true });
        return Object.assign(base, { key: 'active', label: __t('موقوف حالياً') });
    };

    L.isOpen = function (st) { return st.key === 'active' || st.key === 'near' || st.key === 'overdue' || st.key === 'incomplete'; };

    L.remainingText = function (st) {
        if (!L.isOpen(st)) return '';
        if (st.key === 'incomplete') return __t('أكمل البيانات: المدة المقترحة');
        if (st.remaining < 0) return __t('تجاوز بـ ') + (-st.remaining) + __t(' يوم');
        if (st.remaining === 0) return __t('تنتهي المدة اليوم');
        return __t('متبقّي ') + st.remaining + __t(' يوم');
    };

    /* ---------- الترقيم: يكتبه المستخدم بنفسه كما في سجل القسم (أرقام وفواصل مثل 12/2026 أو 2026-12) ---------- */
    L.normNumber = function (n) {
        return String(n || '').replace(/[٠-٩]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(c); }).replace(/\s+/g, '').trim();
    };
    L.isValidNumber = function (n) { n = L.normNumber(n); return n.length > 0 && n.length <= 30 && /\d/.test(n); };

    /* ---------- مقارنات وتصفية ---------- */
    L.matches = function (d, q) {
        if (!q) return true;
        q = q.trim().toLowerCase();
        return [d.name, d.motherName, d.number, d.selfNo, d.detentionPlace, d.complaintNo, d.violation, d.workplace, d.orderingAuthority, d.referredTo]
            .some(function (x) { return String(x || '').toLowerCase().indexOf(q) !== -1; });
    };

    /* ---------- CSV (BOM ليفتحه Excel بالعربية صحيحاً) ---------- */
    L.toCsv = function (rows) {
        var head = [__t('رقم التوقيف'), __t('الاسم'), __t('اسم الأم'), __t('التولد'), __t('الرقم الذاتي'), __t('مكان التوقيف'), __t('مكان العمل'), __t('المخالفة'), __t('رقم الشكوى'), __t('تاريخ التوقيف'), __t('المدة المقترحة (يوم)'), __t('مجموع التمديد (يوم)'),
            __t('المدة الكلية (يوم)'), __t('الموعد المتوقع للإخلاء'), __t('الجهة الآمرة'), __t('الحالة'), __t('تاريخ الإخلاء'), __t('أُحيل إلى'), __t('تاريخ الإحالة')];
        function cell(v) {
            v = String(v == null ? '' : v);
            return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        }
        var lines = [head.map(cell).join(',')];
        rows.forEach(function (d) {
            var st = L.status(d);
            lines.push([d.number, d.name, d.motherName, d.birth, d.selfNo, d.detentionPlace, d.workplace, d.violation, d.complaintNo, d.detentionDate, d.proposedDays, L.extraDays(d), st.total,
                st.expectedRelease, d.orderingAuthority, st.label, d.releaseDate, d.referredTo, d.referralDate].map(cell).join(','));
        });
        return '﻿' + lines.join('\r\n');
    };

    /* ---------- SHA-256 بجافاسكربت صرف (crypto.subtle غير متاح خارج السياقات الآمنة مثل file://) ---------- */
    var K = [], H0 = [];
    (function () {
        var primes = [];
        for (var n = 2; primes.length < 64; n++) {
            var isP = true;
            for (var i = 0; i < primes.length && primes[i] * primes[i] <= n; i++) {
                if (n % primes[i] === 0) { isP = false; break; }
            }
            if (isP) primes.push(n);
        }
        function frac(x) { return x - Math.floor(x); }
        for (var j = 0; j < 64; j++) K[j] = Math.floor(frac(Math.cbrt(primes[j])) * 4294967296) >>> 0;
        for (var k = 0; k < 8; k++) H0[k] = Math.floor(frac(Math.sqrt(primes[k])) * 4294967296) >>> 0;
    })();

    function sha256(msg) {
        var l = msg.length;
        var total = ((l + 9 + 63) >> 6) << 6;
        var buf = new Uint8Array(total);
        buf.set(msg);
        buf[l] = 0x80;
        var dv = new DataView(buf.buffer);
        dv.setUint32(total - 8, Math.floor(l / 0x20000000));
        dv.setUint32(total - 4, (l << 3) >>> 0);
        var h = H0.slice();
        var wd = new Uint32Array(64);
        for (var off = 0; off < total; off += 64) {
            var i;
            for (i = 0; i < 16; i++) wd[i] = dv.getUint32(off + i * 4);
            for (i = 16; i < 64; i++) {
                var x = wd[i - 15], y = wd[i - 2];
                var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
                var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
                wd[i] = (wd[i - 16] + s0 + wd[i - 7] + s1) >>> 0;
            }
            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
            for (i = 0; i < 64; i++) {
                var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
                var ch = (e & f) ^ (~e & g);
                var t1 = (hh + S1 + ch + K[i] + wd[i]) >>> 0;
                var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
                var maj = (a & b) ^ (a & c) ^ (b & c);
                var t2 = (S0 + maj) >>> 0;
                hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
            }
            h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
            h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
        }
        var out = new Uint8Array(32);
        var odv = new DataView(out.buffer);
        for (var m = 0; m < 8; m++) odv.setUint32(m * 4, h[m]);
        return out;
    }
    function utf8(s) { return new Uint8Array(unescape(encodeURIComponent(s)).split('').map(function (c) { return c.charCodeAt(0); })); }
    function toHex(u8) { return Array.prototype.map.call(u8, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }

    L.sha256Hex = function (str) { return toHex(sha256(utf8(str))); };
    L.randomHex = function (bytes) {
        var u8 = new Uint8Array(bytes);
        (w.crypto || w.msCrypto).getRandomValues(u8);
        return toHex(u8);
    };
    // تجزئة الرمز السري: ملح عشوائي لكل جهاز + تكرار 20000 مرة. هذا قفل للواجهة وليس تشفيراً للبيانات.
    L.hashPin = function (pin, saltHex) {
        var salt = utf8(saltHex);
        var cur = sha256(utf8(saltHex + ':' + pin));
        for (var i = 0; i < 20000; i++) {
            var m = new Uint8Array(cur.length + salt.length);
            m.set(cur);
            m.set(salt, cur.length);
            cur = sha256(m);
        }
        return toHex(cur);
    };

    w.L = L;
})(window);
