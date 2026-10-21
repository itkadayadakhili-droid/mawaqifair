/* طبقة التخزين المحلي على الهاتف.
   الأساس: IndexedDB (يدعم المرفقات). إن رفضه المحوّل/الـWebView يُستعمل localStorage بديلاً (بدون مرفقات). */
(function (w) {
    'use strict';

    var DB_NAME = 'mawaqif-airports-db';
    var DB_VER = 1;
    var LS_DET = 'mawaqif-airports.detentions.v1';
    var LS_META = 'mawaqif-airports.meta.v1';
    var idb = null;
    var Storage = { mode: 'idb', attachmentsSupported: true };

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    Storage.uid = uid;

    /* ---------- IndexedDB ---------- */
    function openIdb() {
        return new Promise(function (resolve, reject) {
            if (!w.indexedDB) return reject(new Error(__t('IndexedDB غير متاح')));
            var req;
            try { req = w.indexedDB.open(DB_NAME, DB_VER); } catch (e) { return reject(e); }
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains('detentions')) {
                    db.createObjectStore('detentions', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('attachments')) {
                    var s = db.createObjectStore('attachments', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('detentionId', 'detentionId');
                }
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'key' });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error(__t('فشل فتح قاعدة البيانات'))); };
            req.onblocked = function () { reject(new Error(__t('قاعدة البيانات مقفلة'))); };
        });
    }

    // ينفّذ عملية داخل معاملة ويُرجع نتيجة آخر طلب
    function idbTx(stores, mode, fn) {
        return new Promise(function (resolve, reject) {
            var t = idb.transaction(stores, mode);
            var result;
            var last = fn(t);
            if (last && typeof last === 'object' && 'onsuccess' in last) {
                last.onsuccess = function () { result = last.result; };
            }
            t.oncomplete = function () { resolve(result); };
            t.onerror = function () { reject(t.error); };
            t.onabort = function () { reject(t.error || new Error(__t('أُلغيت العملية'))); };
        });
    }

    /* ---------- localStorage (بديل) ---------- */
    function lsRead() {
        try { return JSON.parse(w.localStorage.getItem(LS_DET) || '[]'); } catch (e) { return []; }
    }
    function lsWrite(arr) {
        w.localStorage.setItem(LS_DET, JSON.stringify(arr));
    }
    function lsMetaRead() {
        try { return JSON.parse(w.localStorage.getItem(LS_META) || '{}'); } catch (e) { return {}; }
    }

    /* ---------- التهيئة ---------- */
    Storage.init = function () {
        return openIdb().then(function (db) {
            idb = db;
            // اختبار كتابة/قراءة فعلي: بعض الـWebView يفتح القاعدة ثم يفشل عند الكتابة
            return idbTx(['meta'], 'readwrite', function (t) {
                t.objectStore('meta').put({ key: '_probe', value: Date.now() });
            }).then(function () {
                Storage.mode = 'idb';
                Storage.attachmentsSupported = true;
            });
        }).catch(function () {
            try {
                w.localStorage.setItem('_probe', '1');
                w.localStorage.removeItem('_probe');
            } catch (e) {
                return Promise.reject(new Error(__t('لا يتوفر أي تخزين محلي على هذا الجهاز')));
            }
            Storage.mode = 'ls';
            Storage.attachmentsSupported = false;
        });
    };

    /* ---------- السجلات ---------- */
    Storage.all = function () {
        if (Storage.mode === 'ls') return Promise.resolve(lsRead());
        return idbTx(['detentions'], 'readonly', function (t) { return t.objectStore('detentions').getAll(); })
            .then(function (r) { return r || []; });
    };

    // keepTimestamps: يُستعمل عند الاستيراد فقط ليبقى تاريخ آخر تعديل كما في المصدر
    Storage.put = function (rec, keepTimestamps) {
        if (!keepTimestamps || !rec.updatedAt) rec.updatedAt = new Date().toISOString();
        if (!rec.uid) rec.uid = uid();
        if (!rec.createdAt) rec.createdAt = rec.updatedAt;
        if (Storage.mode === 'ls') {
            var arr = lsRead();
            if (!rec.id) {
                var max = 0;
                arr.forEach(function (x) { if (x.id > max) max = x.id; });
                rec.id = max + 1;
            }
            var i = arr.findIndex(function (x) { return x.id === rec.id; });
            if (i >= 0) arr[i] = rec; else arr.push(rec);
            lsWrite(arr);
            return Promise.resolve(rec.id);
        }
        return idbTx(['detentions'], 'readwrite', function (t) { return t.objectStore('detentions').put(rec); });
    };

    /* ---------- المرفقات ---------- */
    Storage.attachmentsOf = function (detId) {
        if (Storage.mode === 'ls') return Promise.resolve([]);
        return idbTx(['attachments'], 'readonly', function (t) {
            return t.objectStore('attachments').index('detentionId').getAll(detId);
        }).then(function (r) { return r || []; });
    };

    Storage.addAttachment = function (att) {
        if (Storage.mode === 'ls') return Promise.reject(new Error(__t('المرفقات غير مدعومة في وضع التخزين البديل')));
        att.createdAt = new Date().toISOString();
        return idbTx(['attachments'], 'readwrite', function (t) { return t.objectStore('attachments').add(att); });
    };

    Storage.attachmentCount = function () {
        if (Storage.mode === 'ls') return Promise.resolve(0);
        return idbTx(['attachments'], 'readonly', function (t) { return t.objectStore('attachments').count(); })
            .then(function (n) { return n || 0; });
    };

    Storage.deleteAttachment = function (id) {
        return idbTx(['attachments'], 'readwrite', function (t) { t.objectStore('attachments').delete(id); });
    };

    /* ---------- الإعدادات الصغيرة (آخر نسخة احتياطية...) ---------- */
    Storage.getMeta = function (key) {
        if (Storage.mode === 'ls') return Promise.resolve(lsMetaRead()[key]);
        return idbTx(['meta'], 'readonly', function (t) { return t.objectStore('meta').get(key); })
            .then(function (r) { return r ? r.value : undefined; });
    };
    Storage.setMeta = function (key, value) {
        if (Storage.mode === 'ls') {
            var m = lsMetaRead();
            m[key] = value;
            w.localStorage.setItem(LS_META, JSON.stringify(m));
            return Promise.resolve();
        }
        return idbTx(['meta'], 'readwrite', function (t) { t.objectStore('meta').put({ key: key, value: value }); });
    };

    /* ---------- النسخ الاحتياطي ---------- */
    function blobToDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { reject(fr.error); };
            fr.readAsDataURL(blob);
        });
    }
    function dataUrlToBlob(url) {
        var parts = url.split(',');
        var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream';
        var bin = atob(parts[1]);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new Blob([u8], { type: mime });
    }

    Storage.exportAll = function () {
        return Storage.all().then(function (dets) {
            var byId = {};
            dets.forEach(function (d) { byId[d.id] = d; });
            var attPromise = Storage.mode === 'ls' ? Promise.resolve([]) :
                idbTx(['attachments'], 'readonly', function (t) { return t.objectStore('attachments').getAll(); });
            return attPromise.then(function (atts) {
                return Promise.all((atts || []).map(function (a) {
                    var owner = byId[a.detentionId];
                    if (!owner) return null;
                    return blobToDataUrl(a.blob).then(function (url) {
                        return { detUid: owner.uid, name: a.name, type: a.type, size: a.size, createdAt: a.createdAt, dataUrl: url };
                    });
                }));
            }).then(function (attOut) {
                return {
                    app: 'mawaqif-airports',
                    version: 1,
                    exportedAt: new Date().toISOString(),
                    detentions: dets,
                    attachments: attOut.filter(Boolean)
                };
            });
        });
    };

    Storage.clearAll = function () {
        if (Storage.mode === 'ls') {
            w.localStorage.removeItem(LS_DET);
            return Promise.resolve();
        }
        return idbTx(['detentions', 'attachments'], 'readwrite', function (t) {
            t.objectStore('detentions').clear();
            t.objectStore('attachments').clear();
        });
    };

    // mode: 'merge' (يدمج بحسب المعرّف الفريد uid ويُبقي الأحدث) أو 'replace' (يستبدل كل شيء)
    Storage.importAll = function (data, mode) {
        if (!data || data.app !== 'mawaqif-airports' || !Array.isArray(data.detentions)) {
            return Promise.reject(new Error(__t('الملف ليس نسخة احتياطية صالحة لهذا التطبيق')));
        }
        var added = 0, updated = 0, skipped = 0;
        var start = mode === 'replace' ? Storage.clearAll() : Promise.resolve();
        return start.then(function () { return Storage.all(); }).then(function (existing) {
            var byUid = {};
            existing.forEach(function (d) { byUid[d.uid] = d; });
            var chain = Promise.resolve();
            var uidToId = {};
            existing.forEach(function (d) { uidToId[d.uid] = d.id; });

            data.detentions.forEach(function (inc) {
                chain = chain.then(function () {
                    var cur = byUid[inc.uid];
                    var rec = JSON.parse(JSON.stringify(inc));
                    if (cur) {
                        if ((inc.updatedAt || '') > (cur.updatedAt || '')) {
                            rec.id = cur.id;
                            return Storage.put(rec, true).then(function () { updated++; });
                        }
                        skipped++;
                        return null;
                    }
                    delete rec.id;
                    return Storage.put(rec, true).then(function (id) {
                        uidToId[rec.uid] = id;
                        added++;
                    });
                });
            });

            return chain.then(function () {
                if (Storage.mode === 'ls') return null;
                var attChain = Promise.resolve();
                (data.attachments || []).forEach(function (a) {
                    attChain = attChain.then(function () {
                        var detId = uidToId[a.detUid];
                        if (!detId) return null;
                        return Storage.attachmentsOf(detId).then(function (have) {
                            var dup = have.some(function (h) { return h.name === a.name && h.size === a.size; });
                            if (dup) return null;
                            return Storage.addAttachment({
                                detentionId: detId, name: a.name, type: a.type, size: a.size,
                                blob: dataUrlToBlob(a.dataUrl)
                            });
                        });
                    });
                });
                return attChain;
            });
        }).then(function () {
            return { added: added, updated: updated, skipped: skipped };
        });
    };

    Storage.estimate = function () {
        if (w.navigator.storage && w.navigator.storage.estimate) {
            return w.navigator.storage.estimate().catch(function () { return null; });
        }
        return Promise.resolve(null);
    };
    Storage.requestPersistence = function () {
        if (w.navigator.storage && w.navigator.storage.persist) {
            return w.navigator.storage.persist().catch(function () { return false; });
        }
        return Promise.resolve(false);
    };

    w.Storage = Storage;
})(window);
