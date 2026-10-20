/* تطبيق المواقيف — الواجهة. بلا اعتماديات خارجية، يعمل من ملفات ثابتة بلا خادم. */
(function () {
    'use strict';

    const h = L.esc;
    const root = document.getElementById('app');
    const S = { all: [], token: 0, lastBackup: null, pin: null, locked: false, hiddenAt: 0 };

    const BELONGING_TYPES = ['هاتف', 'حاسوب', 'محفظة', 'مبلغ نقدي', 'مجوهرات', 'أخرى'];
    const TABS = [
        { k: 'open', t: 'الحاليون', f: st => L.isOpen(st) },
        { k: 'overdue', t: 'متجاوزون', f: st => st.key === 'overdue' },
        { k: 'near', t: 'قريبو الإفراج', f: st => st.key === 'near' },
        { k: 'released', t: 'أُخلي سبيلهم', f: st => st.key === 'released' },
        { k: 'referred', t: 'أُحيلوا', f: st => st.key === 'referred' },
        { k: 'all', t: 'الكل', f: st => st.key !== 'voided' },
        { k: 'voided', t: 'الملغاة', f: st => st.key === 'voided' }
    ];

    /* ================= أدوات عامة ================= */
    function normDigits(s) {
        return String(s == null ? '' : s)
            .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
            .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06F0))
            .replace(/[٫٬]/g, '')
            .replace(/∕|⁄|／/g, '/');
    }
    function fmtDateTime(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const p = n => (n < 10 ? '0' : '') + n;
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    function num(s) { return `<span class="num">${h(s)}</span>`; }
    function logEv(rec, text) {
        (rec.log = rec.log || []).push({ at: new Date().toISOString(), text });
    }
    function toast(msg, bad) {
        const old = document.getElementById('toast');
        if (old) old.remove();
        const t = document.createElement('div');
        t.id = 'toast';
        t.className = 'toast' + (bad ? ' bad' : '');
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2800);
    }
    async function reload() { S.all = await Storage.all(); }
    function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

    /* ================= النوافذ والنماذج ================= */
    function openModal(inner, cls) {
        closeModal();
        const bg = document.createElement('div');
        bg.className = 'modal-bg';
        bg.id = 'modalbg';
        bg.innerHTML = `<div class="modal ${cls || ''}">${inner}</div>`;
        document.body.appendChild(bg);
        bg.addEventListener('mousedown', e => { if (e.target === bg) bg.dispatchEvent(new Event('dismiss')); });
        return bg;
    }
    function closeModal() { const m = document.getElementById('modalbg'); if (m) m.remove(); }

    function fieldHtml(f) {
        const id = 'f_' + f.name;
        const v = f.value == null ? '' : f.value;
        let inp;
        if (f.type === 'textarea') {
            inp = `<textarea id="${id}" name="${f.name}">${h(v)}</textarea>`;
        } else if (f.type === 'select') {
            inp = `<select id="${id}" name="${f.name}">${(f.options || []).map(o =>
                `<option value="${h(o)}"${o === v ? ' selected' : ''}>${h(o)}</option>`).join('')}</select>`;
        } else {
            const t = f.type || 'text';
            inp = `<input id="${id}" name="${f.name}" type="${t}" value="${h(v)}"` +
                ((t === 'number' || f.numeric) ? ' inputmode="numeric"' : '') +
                (f.min != null ? ` min="${f.min}"` : '') + (f.max != null ? ` max="${f.max}"` : '') +
                (f.ltr ? ' dir="ltr" style="text-align:right"' : '') +
                (f.placeholder ? ` placeholder="${h(f.placeholder)}"` : '') +
                (f.suggest ? ` list="${id}_list"` : '') + ' autocomplete="off">';
            if (f.suggest) inp += `<datalist id="${id}_list">${f.suggest.map(o => `<option value="${h(o)}">`).join('')}</datalist>`;
        }
        return `<div class="field" data-f="${f.name}"><label for="${id}">${h(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>` +
            inp + (f.hint ? `<div class="hint">${h(f.hint)}</div>` : '') + '<div class="errmsg" hidden></div></div>';
    }
    function readValues(scope, fields) {
        const out = {};
        fields.forEach(f => {
            const el = scope.querySelector(`[name="${f.name}"]`);
            let v = el ? el.value : '';
            v = String(v).trim();
            if (f.digits) v = normDigits(v);
            out[f.name] = v;
        });
        return out;
    }
    function showErrors(scope, errs) {
        scope.querySelectorAll('.field').forEach(fd => {
            const msg = errs[fd.dataset.f];
            fd.classList.toggle('err', !!msg);
            const e = fd.querySelector('.errmsg');
            e.hidden = !msg;
            e.textContent = msg || '';
        });
        const first = scope.querySelector('.field.err');
        if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    function validateFields(fields, vals) {
        const errs = {};
        fields.forEach(f => {
            if (f.required && !vals[f.name]) errs[f.name] = 'هذا الحقل مطلوب';
            else if (f.type === 'date' && vals[f.name] && !L.isValidDate(vals[f.name])) errs[f.name] = 'تاريخ غير صالح';
            else if (f.type === 'number' && vals[f.name] && !(parseInt(vals[f.name], 10) >= (f.min != null ? f.min : 0))) {
                errs[f.name] = `يجب أن يكون الرقم ${f.min != null ? f.min : 0} أو أكبر`;
            }
        });
        return errs;
    }

    // نافذة نموذج عامة: تُرجع القيم أو null عند الإلغاء. validate(values) تُرجع كائن أخطاء {حقل: رسالة}
    function askForm(o) {
        return new Promise(resolve => {
            const fields = o.fields || [];
            const m = openModal(`<h3>${h(o.title)}</h3>${o.intro ? `<p>${o.intro}</p>` : ''}
                <form id="mf" novalidate>${fields.map(fieldHtml).join('')}
                <div class="actions"><button type="button" class="btn ghost" data-m="cancel">إلغاء</button>
                <button type="submit" class="btn ${o.danger ? 'danger' : ''}">${h(o.ok || 'حفظ')}</button></div></form>`);
            const form = m.querySelector('#mf');
            const done = v => { closeModal(); resolve(v); };
            m.addEventListener('dismiss', () => done(null));
            m.querySelector('[data-m="cancel"]').addEventListener('click', () => done(null));
            form.addEventListener('submit', e => {
                e.preventDefault();
                const vals = readValues(form, fields);
                let errs = validateFields(fields, vals);
                if (!Object.keys(errs).length && o.validate) errs = o.validate(vals) || {};
                if (Object.keys(errs).length) return showErrors(form, errs);
                done(vals);
            });
            const first = form.querySelector('input,textarea,select');
            if (first && !('ontouchstart' in window)) first.focus();
        });
    }
    function confirmDialog(title, text, okLabel, danger) {
        return new Promise(resolve => {
            const m = openModal(`<h3>${h(title)}</h3><p>${text}</p>
                <div class="actions"><button class="btn ghost" data-m="no">إلغاء</button>
                <button class="btn ${danger ? 'danger' : ''}" data-m="yes">${h(okLabel || 'موافق')}</button></div>`);
            const done = v => { closeModal(); resolve(v); };
            m.addEventListener('dismiss', () => done(false));
            m.querySelector('[data-m="no"]').addEventListener('click', () => done(false));
            m.querySelector('[data-m="yes"]').addEventListener('click', () => done(true));
        });
    }

    /* ================= التصدير (تنزيل / مشاركة / نسخ) ================= */
    function download(filename, mime, text) {
        const url = URL.createObjectURL(new Blob([text], { type: mime }));
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    }
    async function copyText(text) {
        try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* بديل */ }
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        return ok;
    }
    function canShareFiles() {
        try {
            return !!(navigator.share && navigator.canShare &&
                navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] }));
        } catch (e) { return false; }
    }
    function exportDialog(title, filename, mime, text, onUsed) {
        const share = canShareFiles();
        const m = openModal(`<h3>${h(title)}</h3>
            <p class="sub">${h(filename)} — ${Math.max(1, Math.round(text.length / 1024))} ك.ب</p>
            <div class="btn-row">
                <button class="btn" data-m="dl">⬇ تنزيل الملف</button>
                ${share ? '<button class="btn gold" data-m="share">↗ مشاركة</button>' : ''}
                <button class="btn ghost" data-m="copy">⧉ نسخ النص</button>
            </div>
            <p class="sub" style="margin-top:10px">إن لم يبدأ التنزيل (بعض التطبيقات المحوّلة تمنعه) فاستخدم «مشاركة» أو «نسخ النص».</p>
            <div class="actions"><button class="btn ghost" data-m="close">إغلاق</button></div>`);
        const used = () => { if (onUsed) onUsed(); };
        m.querySelector('[data-m="close"]').addEventListener('click', closeModal);
        m.addEventListener('dismiss', closeModal);
        m.querySelector('[data-m="dl"]').addEventListener('click', () => { download(filename, mime, text); used(); toast('تم طلب التنزيل'); });
        m.querySelector('[data-m="copy"]').addEventListener('click', async () => {
            const ok = await copyText(text);
            toast(ok ? 'تم نسخ النص' : 'تعذّر النسخ', !ok);
            if (ok) used();
        });
        const sh = m.querySelector('[data-m="share"]');
        if (sh) sh.addEventListener('click', async () => {
            try {
                await navigator.share({ title, files: [new File([text], filename, { type: mime })] });
                used();
            } catch (e) { /* ألغى المستخدم المشاركة */ }
        });
    }

    /* ================= الهيكل العام ================= */
    function shell(body, o) {
        o = o || {};
        const nav = (hash, key, ic, label, cls) =>
            `<a href="${hash}" class="${cls || ''}${o.nav === key ? ' active' : ''}"><span class="ic">${ic}</span>${label}</a>`;
        root.innerHTML = `
            <header class="topbar">
                ${o.back ? '<button class="back-btn" data-act="back" aria-label="رجوع">&rarr;</button>' : '<span class="logo"><img src="assets/brand/syria-eagle.svg" alt=""></span>'}
                <div class="ttl"><b>${h(o.title || 'قسم المواقيف')}</b><span>${h(o.sub || 'إدارة أمن المطارات والمنافذ البرية والبحرية')}</span></div>
                ${o.back ? '<span class="logo"><img src="assets/brand/syria-eagle.svg" alt=""></span>' : ''}
            </header>
            <main class="wrap">${body}</main>
            <nav class="bottomnav">
                ${nav('#/', 'home', '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>', 'الرئيسية')}
                ${nav('#/list', 'list', '<svg viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="17.5" rx="2"/><path d="M9 3.5h6v3H9z"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/></svg>', 'الموقوفون')}
                ${nav('#/new', 'new', '+', 'إضافة', 'add')}
                ${nav('#/backup', 'backup', '<svg viewBox="0 0 24 24"><path d="M12 3v11"/><path d="m7.5 9.5 4.5 4.5 4.5-4.5"/><path d="M4 16v3.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg>', 'النسخ والتصدير')}
            </nav>`;
        window.scrollTo(0, 0);
    }

    function itemCard(d) {
        const st = L.status(d);
        const rem = L.remainingText(st);
        const remCls = st.overdue ? 'bad' : (st.near ? 'warn' : '');
        return `<a class="item ${st.key}" href="#/d/${d.id}">
            <div class="row1"><span class="nm">${h(d.name)}</span><span class="badge ${st.key}">${h(st.label)}</span></div>
            <div class="sub">توقيف رقم ${num(d.number)}${d.complaintNo ? ' — الشكوى ' + num(d.complaintNo) : ''}</div>
            ${d.violation || d.workplace ? `<div class="sub">${h([d.violation, d.workplace].filter(Boolean).join(' · '))}</div>` : ''}
            <div class="sub">منذ ${num(d.detentionDate)} · المدة المسموحة ${st.total} يوم${d.orderingAuthority ? ' · ' + h(d.orderingAuthority) : ''}</div>
            ${rem ? `<div class="rem ${remCls}">${h(rem)}</div>` : ''}
        </a>`;
    }

    /* ================= الرئيسية ================= */
    function viewHome() {
        const live = S.all.filter(d => !d.isVoided);
        const sts = live.map(d => ({ d, st: L.status(d) }));
        const open = sts.filter(x => L.isOpen(x.st));
        const overdue = sts.filter(x => x.st.key === 'overdue');
        const near = sts.filter(x => x.st.key === 'near');
        const month = L.monthOf(L.today());
        const relMonth = sts.filter(x => x.st.key === 'released' && L.monthOf(x.d.releaseDate) === month);

        let html = '';
        if (!S.all.length) {
            html = `<div class="card empty"><img class="emblem" src="assets/brand/syria-eagle.svg" alt="">
                <h2>أهلاً بك في تطبيق المواقيف</h2>
                <p>لا توجد سجلات بعد. أضف أول موقوف، أو استورد نسخة احتياطية سابقة.</p>
                <div class="btn-row"><a class="btn" href="#/new">+ إضافة موقوف</a><a class="btn ghost" href="#/backup">استيراد نسخة احتياطية</a></div></div>`;
            return shell(html, { nav: 'home' });
        }
        const daysSinceBackup = S.lastBackup ? L.daysBetween(S.lastBackup.slice(0, 10)) : null;
        if (daysSinceBackup === null || daysSinceBackup >= 7) {
            html += `<div class="alertbox warn">${daysSinceBackup === null ? 'لم تأخذ نسخة احتياطية بعد.' : `آخر نسخة احتياطية قبل ${daysSinceBackup} يوم.`}
                البيانات محفوظة على هذا الهاتف فقط — إن فُقد أو مُسح التطبيق ضاعت. <a href="#/backup" style="color:inherit;text-decoration:underline">خذ نسخة الآن</a></div>`;
        }
        html += `<div class="stat-grid">
            <a class="stat primary" href="#/list?tab=open"><div class="n">${open.length}</div><div class="l">موقوفون حالياً</div></a>
            <a class="stat ${overdue.length ? 'alert' : ''}" href="#/list?tab=overdue"><div class="n">${overdue.length}</div><div class="l">تجاوزوا المدة</div></a>
            <a class="stat ${near.length ? 'warn' : ''}" href="#/list?tab=near"><div class="n">${near.length}</div><div class="l">قريبو انتهاء المدة</div></a>
            <a class="stat ok" href="#/list?tab=released"><div class="n">${relMonth.length}</div><div class="l">أُخلي سبيلهم هذا الشهر</div></a>
        </div>`;

        const alerts = overdue.concat(near).sort((a, b) => a.st.remaining - b.st.remaining).slice(0, 10);
        html += `<div class="card"><h2>تنبيهات المدة <span class="cnt">(${overdue.length + near.length})</span></h2>` +
            (alerts.length ? alerts.map(x => itemCard(x.d)).join('') : '<div class="empty" style="padding:10px">لا توجد تنبيهات — كل الموقوفين ضمن المدة المسموحة ✓</div>') + '</div>';
        html += '<div class="btn-row"><a class="btn" href="#/new">+ إضافة موقوف</a><a class="btn ghost" href="#/list">بحث في السجلات</a></div>';
        shell(html, { nav: 'home' });
    }

    /* ================= القائمة والبحث ================= */
    function listParts(tab, q) {
        const base = S.all.filter(d => L.matches(d, q)).map(d => ({ d, st: L.status(d) }));
        const chips = TABS.map(t => {
            const n = base.filter(x => t.f(x.st)).length;
            return `<a class="chip${t.k === tab ? ' active' : ''}" href="#/list?tab=${t.k}${q ? '&q=' + encodeURIComponent(q) : ''}">${t.t}<span class="n">${n}</span></a>`;
        }).join('');
        const cur = TABS.find(t => t.k === tab) || TABS[0];
        const rows = base.filter(x => cur.f(x.st));
        if (tab === 'open' || tab === 'overdue' || tab === 'near') rows.sort((a, b) => a.st.remaining - b.st.remaining);
        else if (tab === 'released') rows.sort((a, b) => (b.d.releaseDate || '').localeCompare(a.d.releaseDate || ''));
        else rows.sort((a, b) => b.d.id - a.d.id);
        const list = rows.length ? rows.map(x => itemCard(x.d)).join('')
            : `<div class="empty"><div class="big">🔍</div>${q ? 'لا نتائج مطابقة للبحث.' : 'لا توجد سجلات في هذا التصنيف.'}</div>`;
        return { chips, list, rows: rows.map(x => x.d) };
    }
    function viewList(query) {
        const tab = TABS.some(t => t.k === query.tab) ? query.tab : 'open';
        let q = query.q || '';
        shell(`<input class="search" id="q" type="search" placeholder="بحث بالاسم أو رقم التوقيف أو رقم الشكوى…" value="${h(q)}">
            <div class="chips" id="chips"></div><div id="results"></div>
            <div class="btn-row" style="margin-top:6px"><button class="btn ghost small" data-act="export-list">⬇ تصدير القائمة الحالية (CSV)</button></div>`, { nav: 'list', title: 'الموقوفون' });
        const draw = () => {
            const p = listParts(tab, q);
            const chipsEl = document.getElementById('chips');
            chipsEl.innerHTML = p.chips;
            document.getElementById('results').innerHTML = p.list;
            root._rows = p.rows;
            // يُبقي التبويب النشط ظاهراً داخل الشريط القابل للتمرير (دون تحريك الصفحة نفسها)
            const act = chipsEl.querySelector('.chip.active');
            if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'center' });
        };
        draw();
        document.getElementById('q').addEventListener('input', e => {
            q = e.target.value;
            history.replaceState(null, '', `#/list?tab=${tab}${q ? '&q=' + encodeURIComponent(q) : ''}`);
            draw();
        });
    }

    /* ================= إضافة / تعديل ================= */
    const VIOLATIONS = Object.values(window.VIOLATION_GROUPS || {}).flat();
    function detentionFields(isNew, d) {
        d = d || {};
        const f = [
            { name: 'number', label: 'رقم التوقيف', required: true, digits: true, ltr: true, value: d.number || '',
                hint: 'اكتب رقم التوقيف كما هو في سجل القسم — مثال: 12/2026' },
            { name: 'name', label: 'الاسم الكامل للموقوف', required: true, value: d.name },
            { name: 'workplace', label: 'مكان العمل', value: d.workplace, hint: 'القسم أو الفرع أو الإدارة التي يعمل فيها' },
            { name: 'violation', label: 'المخالفة', value: d.violation, suggest: VIOLATIONS,
                hint: 'اختر من القائمة الرسمية أو اكتب المخالفة' },
            { name: 'complaintNo', label: 'رقم الشكوى / الوارد', value: d.complaintNo, digits: true, ltr: true, hint: 'اختياري — مثال: 524/2025' },
            { name: 'detentionDate', label: 'تاريخ التوقيف', type: 'date', required: true, value: d.detentionDate || L.today(), max: L.today() },
            { name: 'proposedDays', label: 'المدة المقترحة (أيام)', type: 'number', required: true, min: 1, value: d.proposedDays },
            { name: 'orderingAuthority', label: 'الجهة الآمرة بالتوقيف', required: true, value: d.orderingAuthority },
            { name: 'healthIn', label: 'الحالة الصحية عند الدخول', type: 'textarea', value: d.healthIn }
        ];
        if (!isNew) f.push({ name: 'healthOut', label: 'الحالة الصحية عند الخروج', type: 'textarea', value: d.healthOut });
        return f;
    }
    function validateDetention(vals, id) {
        const errs = {};
        if (vals.name.length < 2) errs.name = 'اكتب الاسم الكامل';
        if (L.isValidDate(vals.detentionDate) && vals.detentionDate > L.today()) errs.detentionDate = 'لا يمكن أن يكون تاريخ التوقيف في المستقبل';
        if (vals.number !== undefined) {
            vals.number = L.normNumber(vals.number);
            if (!L.isValidNumber(vals.number)) errs.number = 'اكتب رقم التوقيف — مثال 12/2026';
            else if (S.all.some(x => L.normNumber(x.number) === vals.number && x.id !== id)) errs.number = 'هذا الرقم مستخدم لموقوف آخر';
        }
        return errs;
    }

    function viewForm(id) {
        const d = id ? S.all.find(x => x.id === id) : null;
        if (id && !d) return notFound();
        const fields = detentionFields(!d, d);
        shell(`<div class="card"><h2>${d ? 'تعديل بيانات التوقيف' : 'تسجيل موقوف جديد'}</h2>
            <form id="df" novalidate>${fields.map(fieldHtml).join('')}
            <div class="btn-row"><button type="submit" class="btn">حفظ</button><button type="button" class="btn ghost" data-act="back">إلغاء</button></div></form></div>`,
            { back: true, nav: d ? 'list' : 'new', title: d ? 'تعديل' : 'موقوف جديد' });

        const form = document.getElementById('df');
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const vals = readValues(form, fields);
            let errs = validateFields(fields, vals);
            if (!Object.keys(errs).length) errs = validateDetention(vals, id);
            if (Object.keys(errs).length) return showErrors(form, errs);

            if (!d) {
                const dup = S.all.find(x => !x.isVoided && L.isOpen(L.status(x)) && x.name === vals.name);
                if (dup && !(await confirmDialog('اسم مطابق لموقوف حالي',
                    `يوجد موقوف حالي بنفس الاسم (${h(dup.name)} — توقيف رقم ${num(dup.number)}). هل تريد المتابعة وتسجيل توقيف جديد؟`, 'متابعة'))) return;
                const rec = {
                    number: vals.number, name: vals.name, workplace: vals.workplace, violation: vals.violation, complaintNo: vals.complaintNo,
                    detentionDate: vals.detentionDate, proposedDays: parseInt(vals.proposedDays, 10),
                    orderingAuthority: vals.orderingAuthority, healthIn: vals.healthIn, healthOut: '',
                    releaseDate: '', referredTo: '', referralDate: '', extensions: [], belongings: [],
                    isVoided: false, voidReason: '', log: []
                };
                logEv(rec, `تسجيل التوقيف رقم ${rec.number} لمدة ${rec.proposedDays} يوم (الجهة الآمرة: ${rec.orderingAuthority})`);
                const newId = await Storage.put(rec);
                await reload();
                toast('تم تسجيل الموقوف');
                go('#/d/' + newId);
            } else {
                const before = JSON.stringify([d.name, d.workplace, d.violation, d.complaintNo, d.detentionDate, d.proposedDays, d.orderingAuthority, d.healthIn, d.healthOut]);
                if (vals.number !== d.number) { logEv(d, `تعديل رقم التوقيف من ${d.number} إلى ${vals.number}`); d.number = vals.number; }
                Object.assign(d, {
                    name: vals.name, workplace: vals.workplace, violation: vals.violation, complaintNo: vals.complaintNo, detentionDate: vals.detentionDate,
                    proposedDays: parseInt(vals.proposedDays, 10), orderingAuthority: vals.orderingAuthority,
                    healthIn: vals.healthIn, healthOut: vals.healthOut
                });
                const after = JSON.stringify([d.name, d.workplace, d.violation, d.complaintNo, d.detentionDate, d.proposedDays, d.orderingAuthority, d.healthIn, d.healthOut]);
                if (before !== after) logEv(d, 'تعديل بيانات التوقيف');
                await Storage.put(d);
                await reload();
                toast('تم حفظ التعديل');
                go('#/d/' + id);
            }
        });
    }

    /* ================= صفحة الموقوف ================= */
    let objectUrls = [];
    function revokeUrls() { objectUrls.forEach(u => URL.revokeObjectURL(u)); objectUrls = []; }

    async function viewDetail(id) {
        const token = ++S.token;
        const d = S.all.find(x => x.id === id);
        if (!d) return notFound();
        const st = L.status(d);
        const atts = await Storage.attachmentsOf(id);
        if (token !== S.token) return;
        revokeUrls();

        const kv = (k, v, full) => `<div${full ? ' class="full"' : ''}><div class="k">${h(k)}</div><div class="v">${v}</div></div>`;
        const open = L.isOpen(st);
        const unreturned = (d.belongings || []).filter(b => !b.returned);
        let alerts = '';
        if (d.isVoided) alerts += `<div class="alertbox info">هذا السجل ملغى${d.voidReason ? ' — السبب: ' + h(d.voidReason) : ''}.</div>`;
        if (st.overdue) alerts += `<div class="alertbox bad">⚠ تجاوز هذا الموقوف المدة المسموحة بـ ${-st.remaining} يوم (${st.daysSince} يوم من أصل ${st.total}).</div>`;
        else if (st.near) alerts += `<div class="alertbox warn">⏰ ${st.remaining === 0 ? 'تنتهي المدة المسموحة اليوم' : 'تنتهي المدة المسموحة غداً'} (${num(st.expectedRelease)}).</div>`;
        if (!open && !d.isVoided && unreturned.length) alerts += `<div class="alertbox warn">لديه ${unreturned.length} من الممتلكات لم تُرجَع بعد.</div>`;

        let facts = kv('مكان العمل', h(d.workplace || '-')) + kv('المخالفة', h(d.violation || '-')) +
            kv('رقم الشكوى', d.complaintNo ? num(d.complaintNo) : '-') +
            kv('تاريخ التوقيف', num(d.detentionDate)) +
            kv('المدة المقترحة الأصلية', st.total - L.extraDays(d) + ' يوم') +
            kv('مجموع التمديدات', L.extraDays(d) + ' يوم') +
            kv('المدة الكلية المسموحة', st.total + ' يوم');
        if (open) facts += kv('الأيام منذ التوقيف', st.daysSince + ' يوم') + kv('الموعد المتوقع للإخلاء', num(st.expectedRelease));
        facts += kv('الجهة الآمرة بالتوقيف', h(d.orderingAuthority || '-'), true);
        facts += kv('الحالة الصحية عند الدخول', h(d.healthIn || '-'), true);
        if (d.releaseDate) facts += kv('تاريخ إخلاء السبيل', num(d.releaseDate)) + kv('مدة التوقيف الفعلية', L.daysBetween(d.detentionDate, d.releaseDate) + ' يوم');
        if (d.referredTo) facts += kv('أُحيل إلى', h(d.referredTo)) + kv('تاريخ الإحالة', num(d.referralDate || '-'));
        if (d.healthOut) facts += kv('الحالة الصحية عند الخروج', h(d.healthOut), true);

        let actions = '';
        if (!d.isVoided) {
            if (open) actions += `<div class="btn-row" style="margin-bottom:8px">
                <button class="btn" data-act="extend" data-id="${id}">⏱ تمديد</button>
                <button class="btn ok" data-act="release" data-id="${id}">✔ إخلاء سبيل</button>
                <button class="btn gold" data-act="refer" data-id="${id}">↗ إحالة لجهة أخرى</button></div>`;
            actions += `<div class="btn-row"><a class="btn ghost small" href="#/d/${id}/edit">✎ تعديل البيانات</a>` +
                (!open ? `<button class="btn ghost small" data-act="reopen" data-id="${id}">↩ تصحيح: إلغاء الإغلاق</button>` : '') + '</div>';
        }

        const exts = (d.extensions || []).map((e, i) => `<div class="sub-item"><div class="top"><div><b>+${h(e.days)} يوم</b> — ${num(e.date)}
            <div class="meta">${e.approvedBy ? 'الموافق: ' + h(e.approvedBy) : ''}${e.notes ? ' · ' + h(e.notes) : ''}</div></div>
            ${d.isVoided ? '' : `<button class="link-btn" data-act="del-ext" data-id="${id}" data-sub="${i}">حذف</button>`}</div></div>`).join('');

        const bels = (d.belongings || []).map((b, i) => `<div class="sub-item"><div class="top"><div><b>${h(b.type)}</b> × ${h(b.quantity)}
            <div class="meta">${h(b.description || '')}${b.condition ? ' · الحالة: ' + h(b.condition) : ''}</div>
            <div class="meta">${b.returned ? `<span style="color:var(--ok);font-weight:700">أُرجع ${num(b.returnedDate)}${b.returnedTo ? ' إلى ' + h(b.returnedTo) : ''}</span>${b.returnNotes ? ' · ' + h(b.returnNotes) : ''}` : '<span style="color:var(--warn);font-weight:700">لم يُرجَع بعد</span>'}</div></div>
            ${d.isVoided ? '' : `<div>${b.returned ? '' : `<button class="link-btn pri" data-act="return-bel" data-id="${id}" data-sub="${i}">إرجاع</button>`}
            <button class="link-btn" data-act="del-bel" data-id="${id}" data-sub="${i}">حذف</button></div>`}</div></div>`).join('');

        const attHtml = atts.map(a => {
            const isImg = (a.type || '').indexOf('image/') === 0;
            let inner = '📄';
            if (isImg) { const u = URL.createObjectURL(a.blob); objectUrls.push(u); inner = `<img src="${u}" alt="">`; }
            return `<div class="thumb"><div class="box" data-act="view-att" data-id="${a.id}">${inner}</div><div class="nm">${h(a.name)}</div></div>`;
        }).join('');

        const log = (d.log || []).slice().reverse().map(x => `<li><span class="at">${h(fmtDateTime(x.at))}</span>${h(x.text)}</li>`).join('');

        shell(`<div class="card"><div class="row1" style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
                <div><div class="nm" style="font-size:1.25rem;font-weight:900;color:var(--primary)">${h(d.name)}</div>
                <div class="sub">توقيف رقم ${num(d.number)}</div></div><span class="badge ${st.key}">${h(st.label)}</span></div></div>
            ${alerts}
            <div class="card"><div class="kv">${facts}</div></div>
            ${actions}
            <div class="card" style="margin-top:12px"><h3>التمديدات <span class="cnt">(${(d.extensions || []).length})</span></h3>${exts || '<div class="sub">لا توجد تمديدات.</div>'}</div>
            <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">الممتلكات الشخصية <span class="cnt">(${(d.belongings || []).length})</span></h3>
                ${d.isVoided ? '' : `<button class="btn small ghost" data-act="add-bel" data-id="${id}">+ إضافة</button>`}</div>
                <div style="margin-top:8px">${bels || '<div class="sub">لا توجد ممتلكات مسجلة.</div>'}</div></div>
            <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">المرفقات <span class="cnt">(${atts.length})</span></h3>
                ${d.isVoided || !Storage.attachmentsSupported ? '' : `<button class="btn small ghost" data-act="add-att" data-id="${id}">+ رفع</button><input type="file" id="attfile" hidden multiple accept="image/*,application/pdf">`}</div>
                <div style="margin-top:10px" class="thumbs">${attHtml || `<div class="sub">${Storage.attachmentsSupported ? 'لا توجد مرفقات (صور الكتب الموقّعة مثلاً).' : 'المرفقات غير متاحة في وضع التخزين البديل لهذا الجهاز.'}</div>`}</div></div>
            <div class="card"><h3>سجل العمليات</h3><ul class="timeline">${log || '<li>—</li>'}</ul></div>
            ${d.isVoided
                ? `<button class="btn ghost block" data-act="unvoid" data-id="${id}">استرجاع السجل الملغى</button>`
                : `<button class="btn ghost block" style="color:var(--bad);border-color:var(--bad)" data-act="void" data-id="${id}">إلغاء هذا السجل…</button>`}`,
            { back: true, nav: 'list', title: 'بطاقة الموقوف' });

        const fileInput = document.getElementById('attfile');
        if (fileInput) fileInput.addEventListener('change', async () => {
            const files = Array.from(fileInput.files || []);
            let okCount = 0;
            for (const f of files) {
                if (f.size > 10 * 1024 * 1024) { toast(`الملف ${f.name} أكبر من 10 م.ب`, true); continue; }
                if (!(f.type.indexOf('image/') === 0 || f.type === 'application/pdf')) { toast(`نوع الملف ${f.name} غير مدعوم`, true); continue; }
                await Storage.addAttachment({ detentionId: id, name: f.name, type: f.type, size: f.size, blob: f });
                okCount++;
            }
            if (okCount) {
                logEv(d, `رفع ${okCount} مرفق`);
                await Storage.put(d);
                await reload();
                toast('تم رفع المرفقات');
            }
            route();
        });
    }

    /* ----- عمليات صفحة الموقوف ----- */
    const minDateErr = (val, d, label) =>
        (L.isValidDate(val) && val < d.detentionDate) ? `${label} قبل تاريخ التوقيف (${d.detentionDate})` : null;

    const actions = {
        back() { if (history.length > 1) history.back(); else go('#/list'); },

        async extend(id) {
            const d = S.all.find(x => x.id === id);
            const v = await askForm({
                title: 'تمديد مدة التوقيف',
                intro: `المدة الحالية المسموحة: <b>${L.status(d).total}</b> يوم.`,
                fields: [
                    { name: 'date', label: 'تاريخ التمديد', type: 'date', required: true, value: L.today() },
                    { name: 'days', label: 'عدد الأيام المضافة', type: 'number', required: true, min: 1 },
                    { name: 'approvedBy', label: 'الجهة / الشخص الموافق', hint: 'اختياري' },
                    { name: 'notes', label: 'ملاحظات', type: 'textarea' }
                ],
                ok: 'تسجيل التمديد',
                validate: vals => { const e = minDateErr(vals.date, d, 'تاريخ التمديد'); return e ? { date: e } : {}; }
            });
            if (!v) return;
            (d.extensions = d.extensions || []).push({ date: v.date, days: parseInt(v.days, 10), approvedBy: v.approvedBy, notes: v.notes });
            logEv(d, `تمديد التوقيف ${v.days} يوم${v.approvedBy ? ' (الموافق: ' + v.approvedBy + ')' : ''}`);
            await Storage.put(d); await reload(); toast('تم تسجيل التمديد'); route();
        },

        async release(id) {
            const d = S.all.find(x => x.id === id);
            const un = (d.belongings || []).filter(b => !b.returned).length;
            const v = await askForm({
                title: 'إخلاء سبيل',
                intro: un ? `<span style="color:var(--warn);font-weight:700">تنبيه: ${un} من ممتلكاته لم تُرجَع بعد.</span>` : '',
                fields: [
                    { name: 'date', label: 'تاريخ إخلاء السبيل', type: 'date', required: true, value: L.today() },
                    { name: 'healthOut', label: 'الحالة الصحية عند الخروج', type: 'textarea' }
                ],
                ok: 'تأكيد الإخلاء',
                validate: vals => {
                    const e = minDateErr(vals.date, d, 'تاريخ الإخلاء');
                    if (e) return { date: e };
                    if (vals.date > L.today()) return { date: 'لا يمكن أن يكون تاريخ الإخلاء في المستقبل' };
                    return {};
                }
            });
            if (!v) return;
            d.releaseDate = v.date; if (v.healthOut) d.healthOut = v.healthOut;
            logEv(d, `إخلاء سبيل بتاريخ ${v.date} (مدة التوقيف الفعلية ${L.daysBetween(d.detentionDate, v.date)} يوم)`);
            await Storage.put(d); await reload(); toast('تم تسجيل إخلاء السبيل'); route();
        },

        async refer(id) {
            const d = S.all.find(x => x.id === id);
            const v = await askForm({
                title: 'إحالة إلى جهة أخرى',
                fields: [
                    { name: 'entity', label: 'الجهة المُحال إليها', required: true, hint: 'مثال: القضاء العسكري' },
                    { name: 'date', label: 'تاريخ الإحالة', type: 'date', required: true, value: L.today() },
                    { name: 'healthOut', label: 'الحالة الصحية عند الخروج', type: 'textarea' }
                ],
                ok: 'تسجيل الإحالة',
                validate: vals => {
                    const e = minDateErr(vals.date, d, 'تاريخ الإحالة');
                    if (e) return { date: e };
                    if (vals.date > L.today()) return { date: 'لا يمكن أن يكون تاريخ الإحالة في المستقبل' };
                    return {};
                }
            });
            if (!v) return;
            d.referredTo = v.entity; d.referralDate = v.date; if (v.healthOut) d.healthOut = v.healthOut;
            logEv(d, `إحالة إلى ${v.entity} بتاريخ ${v.date}`);
            await Storage.put(d); await reload(); toast('تم تسجيل الإحالة'); route();
        },

        async reopen(id) {
            const d = S.all.find(x => x.id === id);
            const what = d.releaseDate ? 'إخلاء السبيل' : 'الإحالة';
            if (!(await confirmDialog('تصحيح الإغلاق', `سيُلغى تسجيل ${what} ويعود الموقوف إلى حالة «موقوف». يُستعمل فقط لتصحيح خطأ إدخال. هل تتابع؟`, 'نعم، تصحيح', true))) return;
            d.releaseDate = ''; d.referredTo = ''; d.referralDate = '';
            logEv(d, `تصحيح: إلغاء تسجيل ${what}`);
            await Storage.put(d); await reload(); toast('تم التصحيح'); route();
        },

        async 'del-ext'(id, sub) {
            const d = S.all.find(x => x.id === id);
            const e = d.extensions[+sub];
            if (!(await confirmDialog('حذف التمديد', `حذف تمديد ${h(e.days)} يوم بتاريخ ${num(e.date)}؟`, 'حذف', true))) return;
            d.extensions.splice(+sub, 1);
            logEv(d, `حذف تمديد (${e.days} يوم بتاريخ ${e.date})`);
            await Storage.put(d); await reload(); route();
        },

        async 'add-bel'(id) {
            const d = S.all.find(x => x.id === id);
            const v = await askForm({
                title: 'إضافة غرض شخصي',
                fields: [
                    { name: 'type', label: 'نوع الغرض', type: 'select', options: BELONGING_TYPES, value: BELONGING_TYPES[0] },
                    { name: 'description', label: 'الوصف (الماركة / اللون / الرقم التسلسلي)', type: 'textarea' },
                    { name: 'quantity', label: 'الكمية', type: 'number', min: 1, value: 1, required: true },
                    { name: 'condition', label: 'الحالة عند الاستلام' }
                ],
                ok: 'إضافة'
            });
            if (!v) return;
            (d.belongings = d.belongings || []).push({
                type: v.type, description: v.description, quantity: parseInt(v.quantity, 10) || 1,
                condition: v.condition, returned: false, returnedDate: '', returnedTo: '', returnNotes: ''
            });
            logEv(d, `استلام غرض شخصي: ${v.type}${v.description ? ' (' + v.description + ')' : ''}`);
            await Storage.put(d); await reload(); toast('تمت الإضافة'); route();
        },

        async 'return-bel'(id, sub) {
            const d = S.all.find(x => x.id === id);
            const b = d.belongings[+sub];
            const v = await askForm({
                title: `إرجاع: ${b.type}`,
                fields: [
                    { name: 'date', label: 'تاريخ الإرجاع', type: 'date', required: true, value: L.today() },
                    { name: 'to', label: 'سُلِّم إلى', hint: 'اسم المستلم' },
                    { name: 'notes', label: 'ملاحظات', type: 'textarea' }
                ],
                ok: 'تأكيد الإرجاع',
                validate: vals => { const e = minDateErr(vals.date, d, 'تاريخ الإرجاع'); return e ? { date: e } : {}; }
            });
            if (!v) return;
            Object.assign(b, { returned: true, returnedDate: v.date, returnedTo: v.to, returnNotes: v.notes });
            logEv(d, `إرجاع ${b.type}${v.to ? ' إلى ' + v.to : ''} بتاريخ ${v.date}`);
            await Storage.put(d); await reload(); toast('تم تسجيل الإرجاع'); route();
        },

        async 'del-bel'(id, sub) {
            const d = S.all.find(x => x.id === id);
            const b = d.belongings[+sub];
            if (!(await confirmDialog('حذف الغرض', `حذف «${h(b.type)}» من قائمة الممتلكات؟`, 'حذف', true))) return;
            d.belongings.splice(+sub, 1);
            logEv(d, `حذف غرض من القائمة: ${b.type}`);
            await Storage.put(d); await reload(); route();
        },

        'add-att'() { const f = document.getElementById('attfile'); if (f) f.click(); },

        async 'view-att'(attId) {
            const idNum = +location.hash.split('/')[2];
            const atts = await Storage.attachmentsOf(idNum);
            const a = atts.find(x => x.id === attId);
            if (!a) return;
            const isImg = (a.type || '').indexOf('image/') === 0;
            const url = URL.createObjectURL(a.blob);
            const m = openModal(`<h3>${h(a.name)}</h3>
                ${isImg ? `<img src="${url}" alt="" style="max-width:100%;border-radius:10px;display:block;margin:0 auto 12px">` : '<p class="sub">ملف PDF — استخدم «تنزيل» لفتحه.</p>'}
                <div class="actions"><button class="btn ghost" data-m="close">إغلاق</button>
                <button class="btn ghost" data-m="dl">⬇ تنزيل</button>
                <button class="btn danger" data-m="del">حذف</button></div>`);
            const close = () => { URL.revokeObjectURL(url); closeModal(); };
            m.addEventListener('dismiss', close);
            m.querySelector('[data-m="close"]').addEventListener('click', close);
            m.querySelector('[data-m="dl"]').addEventListener('click', () => {
                const link = document.createElement('a'); link.href = url; link.download = a.name; document.body.appendChild(link); link.click(); link.remove();
            });
            m.querySelector('[data-m="del"]').addEventListener('click', async () => {
                if (!(await confirmDialog('حذف المرفق', `حذف «${h(a.name)}» نهائياً؟`, 'حذف', true))) return;
                await Storage.deleteAttachment(a.id);
                const d = S.all.find(x => x.id === idNum);
                if (d) { logEv(d, `حذف مرفق: ${a.name}`); await Storage.put(d); await reload(); }
                URL.revokeObjectURL(url); closeModal(); route();
            });
        },

        async void(id) {
            const d = S.all.find(x => x.id === id);
            const v = await askForm({
                title: 'إلغاء السجل',
                intro: 'يبقى السجل ظاهراً بحالة «ملغى» مع سببه ولا يُحذف نهائياً — للحفاظ على الأثر.',
                fields: [{ name: 'reason', label: 'سبب الإلغاء', type: 'textarea', required: true }],
                ok: 'إلغاء السجل', danger: true
            });
            if (!v) return;
            d.isVoided = true; d.voidReason = v.reason;
            logEv(d, `إلغاء السجل — السبب: ${v.reason}`);
            await Storage.put(d); await reload(); toast('أُلغي السجل'); route();
        },

        async unvoid(id) {
            const d = S.all.find(x => x.id === id);
            if (!(await confirmDialog('استرجاع السجل', 'سيعود السجل إلى القوائم العادية. هل تتابع؟', 'استرجاع'))) return;
            d.isVoided = false; d.voidReason = '';
            logEv(d, 'استرجاع السجل بعد الإلغاء');
            await Storage.put(d); await reload(); toast('تم الاسترجاع'); route();
        },

        'export-list'() {
            const rows = root._rows || [];
            if (!rows.length) return toast('لا توجد سجلات لتصديرها', true);
            exportDialog('تصدير القائمة الحالية', `mawaqif-airports-list-${L.today()}.csv`, 'text/csv;charset=utf-8', L.toCsv(rows));
        }
    };

    /* ================= النسخ الاحتياطي ================= */
    async function viewBackup() {
        const token = ++S.token;
        const attCount = await Storage.attachmentCount();
        const est = await Storage.estimate();
        if (token !== S.token) return;
        const persisted = (navigator.storage && navigator.storage.persisted) ? await navigator.storage.persisted().catch(() => false) : false;
        const mb = est && est.usage != null ? (est.usage / 1048576).toFixed(1) + ' م.ب' : 'غير معروف';

        shell(`
            <div class="card"><h2>حالة التخزين</h2><div class="kv">
                <div><div class="k">عدد السجلات / المرفقات</div><div class="v">${S.all.length} / ${attCount}</div></div>
                <div><div class="k">المساحة المستعملة</div><div class="v">${h(mb)}</div></div>
                <div><div class="k">وضع التخزين</div><div class="v">${Storage.mode === 'idb' ? 'IndexedDB (كامل)' : 'بديل (بدون مرفقات)'}</div></div>
                <div><div class="k">آخر نسخة احتياطية</div><div class="v">${S.lastBackup ? h(fmtDateTime(S.lastBackup)) : 'لم تُؤخذ بعد'}</div></div></div>
                <p class="sub" style="margin-top:10px">البيانات محفوظة على هذا الهاتف فقط. خذ نسخة احتياطية دورياً واحتفظ بها خارج الهاتف.</p>
                ${persisted ? '<div class="alertbox info" style="margin:0">الحفظ الدائم مفعّل ✓</div>' : '<button class="btn ghost small" data-bk="persist">طلب حفظ دائم للبيانات</button>'}
            </div>
            <div class="card"><h2>قفل التطبيق بالرمز السري</h2>
                <p class="sub">${S.pin
                    ? `القفل مفعّل (${S.pin.len} أرقام) — يُطلب الرمز عند الفتح وبعد غياب التطبيق عن الشاشة أكثر من دقيقة.`
                    : 'غير مفعّل. فعّل رمزاً من 4 إلى 6 أرقام لمنع من يمسك الهاتف من رؤية السجلات.'}</p>
                <div class="btn-row">${S.pin
                    ? '<button class="btn small" data-bk="lockNow">🔒 قفل الآن</button><button class="btn ghost small" data-bk="pinChange">تغيير الرمز</button><button class="btn ghost small" data-bk="pinOff">إلغاء القفل</button>'
                    : '<button class="btn" data-bk="pinSet">🔒 تفعيل القفل</button>'}</div>
                <p class="sub" style="margin-top:8px">القفل يمنع العرض فقط ولا يشفّر البيانات المخزّنة، ولا تشمله النسخة الاحتياطية. بعد 5 محاولات خاطئة يتأخر الإدخال تدريجياً.</p></div>
            <div class="card"><h2>نسخة احتياطية كاملة</h2>
                <p class="sub">كل السجلات والمرفقات في ملف واحد (JSON) يمكن استرجاعه على هذا الهاتف أو على هاتف آخر.</p>
                <button class="btn block" data-bk="export">⬇ أخذ نسخة احتياطية</button></div>
            <div class="card"><h2>استرجاع نسخة احتياطية</h2>
                <div class="field"><label>اختر ملف النسخة (.json)</label><input type="file" id="impfile" accept=".json,application/json"></div>
                <div class="field"><label>أو الصق نص النسخة هنا</label><textarea id="imptext" dir="ltr" placeholder="{ &quot;app&quot;: &quot;mawaqif-airports&quot; … }"></textarea></div>
                <div class="field"><label>طريقة الاسترجاع</label><select id="impmode">
                    <option value="merge">دمج مع الموجود (يُبقي الأحدث لكل سجل)</option>
                    <option value="replace">استبدال كل البيانات الحالية</option></select></div>
                <button class="btn gold block" data-bk="import">⬆ استرجاع</button></div>
            <div class="card"><h2>تصدير للجداول</h2>
                <p class="sub">كل السجلات غير الملغاة بصيغة CSV تفتح في Excel.</p>
                <button class="btn ghost block" data-bk="csv">⬇ تصدير الكل (CSV)</button></div>
            <div class="card" style="border-color:#F0B8B3"><h2 style="color:var(--bad)">منطقة الخطر</h2>
                <button class="btn danger block" data-bk="wipe">حذف كل البيانات من هذا الهاتف</button></div>
            <p class="sub" style="text-align:center">تطبيق المواقيف — نسخة مستقلة تعمل بلا خادم</p>`,
            { nav: 'backup', title: 'النسخ والتصدير' });
    }

    async function markBackup() {
        S.lastBackup = new Date().toISOString();
        await Storage.setMeta('lastBackup', S.lastBackup);
    }

    const pinValidate = vals => {
        const e = {};
        if (!/^\d{4,6}$/.test(vals.pin)) e.pin = 'الرمز من 4 إلى 6 أرقام';
        else if (vals.pin2 !== vals.pin) e.pin2 = 'الرمزان غير متطابقين';
        return e;
    };
    const pinField = (name, label) => ({ name, label, type: 'password', numeric: true, digits: true, required: true });
    const curPinField = () => pinField('cur', 'الرمز الحالي');
    const curPinValidate = vals => verifyPin(vals.cur) ? {} : { cur: 'الرمز الحالي غير صحيح' };

    const backupActions = {
        async pinSet() {
            const v = await askForm({
                title: 'تفعيل قفل الرمز السري',
                fields: [pinField('pin', 'الرمز الجديد (4 إلى 6 أرقام)'), pinField('pin2', 'أعد كتابة الرمز')],
                ok: 'تفعيل القفل', validate: pinValidate
            });
            if (!v) return;
            await savePin(makePin(v.pin));
            toast('تم تفعيل القفل');
            viewBackup();
        },
        async pinChange() {
            const v = await askForm({
                title: 'تغيير الرمز السري',
                fields: [curPinField(), pinField('pin', 'الرمز الجديد (4 إلى 6 أرقام)'), pinField('pin2', 'أعد كتابة الرمز الجديد')],
                ok: 'تغيير الرمز',
                validate: vals => Object.assign({}, curPinValidate(vals), pinValidate(vals))
            });
            if (!v) return;
            await savePin(makePin(v.pin));
            toast('تم تغيير الرمز');
            viewBackup();
        },
        async pinOff() {
            const v = await askForm({
                title: 'إلغاء القفل',
                fields: [curPinField()],
                ok: 'إلغاء القفل', danger: true, validate: curPinValidate
            });
            if (!v) return;
            await savePin(null);
            toast('أُلغي القفل');
            viewBackup();
        },
        lockNow() { showLock(); },
        async export() {
            toast('جارٍ تجهيز النسخة…');
            const data = await Storage.exportAll();
            const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
            exportDialog('النسخة الاحتياطية', `mawaqif-airports-backup-${stamp}.json`, 'application/json',
                JSON.stringify(data), () => { markBackup(); });
        },
        csv() {
            const rows = S.all.filter(d => !d.isVoided);
            if (!rows.length) return toast('لا توجد سجلات لتصديرها', true);
            exportDialog('تصدير كل السجلات', `mawaqif-airports-all-${L.today()}.csv`, 'text/csv;charset=utf-8', L.toCsv(rows));
        },
        async persist() {
            const ok = await Storage.requestPersistence();
            toast(ok ? 'تم تفعيل الحفظ الدائم' : 'لم يوافق الجهاز على الحفظ الدائم', !ok);
            viewBackup();
        },
        async import() {
            const fileEl = document.getElementById('impfile');
            let text = document.getElementById('imptext').value.trim();
            if (!text && fileEl.files && fileEl.files[0]) text = await fileEl.files[0].text();
            if (!text) return toast('اختر ملفاً أو الصق نص النسخة', true);
            let data;
            try { data = JSON.parse(text); } catch (e) { return toast('النص ليس JSON صالحاً', true); }
            if (!data || data.app !== 'mawaqif-airports') return toast('الملف ليس نسخة احتياطية لهذا التطبيق', true);
            const mode = document.getElementById('impmode').value;
            const msg = mode === 'replace'
                ? `سيُحذف كل ما هو موجود الآن (${S.all.length} سجل) ويُستبدل بـ ${data.detentions.length} سجل من النسخة. لا يمكن التراجع.`
                : `سيُدمج ${data.detentions.length} سجل من النسخة مع الموجود، ويبقى الأحدث لكل سجل.`;
            if (!(await confirmDialog('تأكيد الاسترجاع', msg, 'استرجاع', mode === 'replace'))) return;
            try {
                const r = await Storage.importAll(data, mode);
                await reload();
                const nums = {};
                let dups = 0;
                S.all.forEach(d => { if (nums[d.number]) dups++; nums[d.number] = 1; });
                toast(`أُضيف ${r.added} · حُدّث ${r.updated} · تُرك ${r.skipped}${dups ? ` — تنبيه: ${dups} رقم توقيف مكرر` : ''}`);
                viewBackup();
            } catch (e) { toast('فشل الاسترجاع: ' + e.message, true); }
        },
        async wipe() {
            const v = await askForm({
                title: 'حذف كل البيانات',
                intro: `سيُحذف <b>${S.all.length}</b> سجل ومرفقاته نهائياً من هذا الهاتف. خذ نسخة احتياطية أولاً إن لم تفعل.`,
                fields: [{ name: 'w', label: 'اكتب كلمة «حذف» للتأكيد', required: true }],
                ok: 'حذف نهائي', danger: true,
                validate: vals => vals.w === 'حذف' ? {} : { w: 'اكتب الكلمة كما هي: حذف' }
            });
            if (!v) return;
            await Storage.clearAll(); await reload();
            toast('تم حذف كل البيانات'); go('#/');
        }
    };

    /* ================= قفل الرمز السري ================= */
    const LOCK_AFTER_MS = 60 * 1000;     // يُقفل التطبيق إن غاب عن الشاشة أكثر من دقيقة
    const NO_FAILS = { n: 0, until: 0 };

    function makePin(pin) {
        const salt = L.randomHex(16);
        return { salt, hash: L.hashPin(pin, salt), len: pin.length };
    }
    function verifyPin(pin) { return !!S.pin && L.hashPin(pin, S.pin.salt) === S.pin.hash; }
    async function savePin(v) { S.pin = v; await Storage.setMeta('pin', v); await Storage.setMeta('pinFails', NO_FAILS); }
    async function readFails() { return (await Storage.getMeta('pinFails')) || NO_FAILS; }

    function showLock() {
        if (!S.pin) return;
        S.locked = true;
        revokeUrls();
        closeModal();
        root.innerHTML = '';
        const old = document.getElementById('lock');
        if (old) old.remove();

        const len = S.pin.len;
        const el = document.createElement('div');
        el.id = 'lock';
        el.className = 'lock';
        el.innerHTML = `<img src="assets/brand/syria-eagle.svg" alt=""><h2>تطبيق المواقيف</h2>
            <div class="msg" id="lockmsg"></div>
            <div class="dots" id="lockdots">${'<i></i>'.repeat(len)}</div>
            <div class="keypad">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
                <button class="sm" data-k="forgot">نسيت<br>الرمز؟</button>
                <button data-k="0">0</button>
                <button data-k="del" aria-label="مسح">⌫</button>
            </div>`;
        document.body.appendChild(el);

        let entered = '';
        let busy = false;
        let timer = null;
        const msg = (t, bad) => { const m = el.querySelector('#lockmsg'); m.textContent = t; m.className = 'msg' + (bad ? ' bad' : ''); };
        const paint = () => el.querySelectorAll('#lockdots i').forEach((d, i) => d.classList.toggle('on', i < entered.length));
        const keys = () => el.querySelectorAll('.keypad button:not([data-k="forgot"])');

        const finish = () => {
            clearTimeout(timer);
            document.removeEventListener('keydown', onKey);
            el.remove();
            S.locked = false;
        };
        const refreshLockout = async () => {
            clearTimeout(timer);
            const f = await readFails();
            const left = Math.ceil((f.until - Date.now()) / 1000);
            if (left > 0) {
                keys().forEach(b => { b.disabled = true; });
                msg('محاولات خاطئة كثيرة — انتظر ' + left + ' ثانية', true);
                timer = setTimeout(refreshLockout, 1000);
            } else {
                keys().forEach(b => { b.disabled = false; });
                if (el.querySelector('#lockmsg').textContent.indexOf('انتظر') !== -1) msg('أدخل الرمز السري');
            }
        };

        async function press(k) {
            if (busy) return;
            if (k === 'forgot') return forgotPin(finish);
            if ((await readFails()).until > Date.now()) return;
            if (k === 'del') { entered = entered.slice(0, -1); return paint(); }
            if (entered.length >= len) return;
            entered += k;
            paint();
            if (entered.length < len) return;

            busy = true;
            await new Promise(r => setTimeout(r, 60));          // يترك المتصفح يرسم النقطة الأخيرة قبل الحساب
            if (verifyPin(entered)) {
                await Storage.setMeta('pinFails', NO_FAILS);
                finish();
                route();
                return;
            }
            const f = Object.assign({}, await readFails());
            f.n++;
            if (f.n >= 5) f.until = Date.now() + Math.min(30 * Math.pow(2, f.n - 5), 900) * 1000;
            await Storage.setMeta('pinFails', f);
            entered = '';
            paint();
            const dots = el.querySelector('#lockdots');
            dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
            busy = false;
            if (f.until > Date.now()) refreshLockout(); else msg('الرمز غير صحيح (' + f.n + ' من 5)', true);
        }
        function onKey(e) {
            const d = normDigits(e.key);
            if (/^[0-9]$/.test(d)) press(d);
            else if (e.key === 'Backspace') press('del');
        }
        el.addEventListener('click', e => {
            const b = e.target.closest('[data-k]');
            if (b && !b.disabled) press(b.dataset.k);
        });
        document.addEventListener('keydown', onKey);
        msg('أدخل الرمز السري');
        refreshLockout();
    }

    // نسيان الرمز: لا استرجاع له. المتاح فقط حذف كل البيانات وإلغاء القفل (ثم استرجاع نسخة احتياطية إن وُجدت)
    async function forgotPin(finishLock) {
        const v = await askForm({
            title: 'نسيت الرمز السري',
            intro: 'لا يمكن استرجاع الرمز. المتاح فقط <b>حذف كل البيانات من هذا الهاتف</b> وإلغاء القفل، ثم استرجاع آخر نسخة احتياطية إن كانت لديك.',
            fields: [{ name: 'w', label: 'اكتب كلمة «حذف» للتأكيد', required: true }],
            ok: 'حذف كل البيانات', danger: true,
            validate: vals => vals.w === 'حذف' ? {} : { w: 'اكتب الكلمة كما هي: حذف' }
        });
        if (!v) return;
        await Storage.clearAll();
        await savePin(null);
        await reload();
        finishLock();
        toast('حُذفت البيانات وأُلغي القفل');
        go('#/');
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { S.hiddenAt = Date.now(); return; }
        if (S.pin && !S.locked && S.hiddenAt && Date.now() - S.hiddenAt > LOCK_AFTER_MS) showLock();
    });

    function notFound() {
        shell('<div class="card empty"><div class="big">❓</div><p>السجل غير موجود.</p><a class="btn" href="#/list">العودة للقائمة</a></div>', { back: true, nav: 'list' });
    }

    /* ================= التوجيه ================= */
    function route() {
        if (S.locked) return;
        S.token++;
        closeModal();
        const raw = (location.hash || '#/').replace(/^#/, '');
        const qi = raw.indexOf('?');
        const path = qi >= 0 ? raw.slice(0, qi) : raw;
        const query = {};
        if (qi >= 0) raw.slice(qi + 1).split('&').forEach(p => { const kv = p.split('='); if (kv[0]) query[kv[0]] = decodeURIComponent(kv[1] || ''); });
        const parts = path.split('/').filter(Boolean);

        if (!parts.length) return viewHome();
        if (parts[0] === 'list') return viewList(query);
        if (parts[0] === 'new') return viewForm(null);
        if (parts[0] === 'backup') return viewBackup();
        if (parts[0] === 'd' && parts[1]) {
            const id = +parts[1];
            return parts[2] === 'edit' ? viewForm(id) : viewDetail(id);
        }
        viewHome();
    }

    root.addEventListener('click', e => {
        const bk = e.target.closest('[data-bk]');
        if (bk) { const fn = backupActions[bk.dataset.bk]; if (fn) fn(); return; }
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const fn = actions[el.dataset.act];
        if (fn) fn(+el.dataset.id, el.dataset.sub, el);
    });
    window.addEventListener('hashchange', route);

    /* ================= الإقلاع ================= */
    (async function boot() {
        try {
            await Storage.init();
            await reload();
            S.lastBackup = (await Storage.getMeta('lastBackup')) || null;
            S.pin = (await Storage.getMeta('pin')) || null;
        } catch (e) {
            root.innerHTML = `<div class="wrap"><div class="card empty"><div class="big">⚠</div><h2>تعذّر تهيئة التخزين</h2><p>${h(e.message)}</p></div></div>`;
            return;
        }
        if (S.pin) showLock(); else route();
        if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
            navigator.serviceWorker.register('sw.js').catch(() => { /* اختياري */ });
        }
    })();
})();
