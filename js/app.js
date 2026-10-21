/* تطبيق المواقيف — الواجهة. بلا اعتماديات خارجية، يعمل من ملفات ثابتة بلا خادم. */
(function () {
    'use strict';

    const h = L.esc;
    const root = document.getElementById('app');
    const S = { all: [], token: 0, lastBackup: null, pin: null, locked: false, hiddenAt: 0 };

    const BELONGING_TYPES = ['هاتف', 'حاسوب', 'محفظة', 'مبلغ نقدي', 'مجوهرات', 'أخرى'];
    const TABS = [
        { k: 'open', t: __t('الحاليون'), f: st => L.isOpen(st) },
        { k: 'overdue', t: __t('متجاوزون'), f: st => st.key === 'overdue' },
        { k: 'near', t: __t('قريبو الإفراج'), f: st => st.key === 'near' },
        { k: 'released', t: __t('أُخلي سبيلهم'), f: st => st.key === 'released' },
        { k: 'referred', t: __t('أُحيلوا'), f: st => st.key === 'referred' },
        { k: 'all', t: __t('الكل'), f: st => st.key !== 'voided' },
        { k: 'incomplete', t: __t('غير مكتملة'), f: st => st.key === 'incomplete' },
        { k: 'voided', t: __t('الملغاة'), f: st => st.key === 'voided' }
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
            if (f.required && !vals[f.name]) errs[f.name] = __t('هذا الحقل مطلوب');
            else if (f.type === 'date' && vals[f.name] && !L.isValidDate(vals[f.name])) errs[f.name] = __t('تاريخ غير صالح');
            else if (f.type === 'number' && vals[f.name] && !(parseInt(vals[f.name], 10) >= (f.min != null ? f.min : 0))) {
                errs[f.name] = `${__t("يجب أن يكون الرقم")} ${f.min != null ? f.min : 0} ${__t("أو أكبر")}`;
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
                <div class="actions"><button type="button" class="btn ghost" data-m="cancel">${__t("إلغاء")}</button>
                <button type="submit" class="btn ${o.danger ? 'danger' : ''}">${h(o.ok || __t('حفظ'))}</button></div></form>`);
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
                <div class="actions"><button class="btn ghost" data-m="no">${__t("إلغاء")}</button>
                <button class="btn ${danger ? 'danger' : ''}" data-m="yes">${h(okLabel || __t('موافق'))}</button></div>`);
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
            <p class="sub">${h(filename)} — ${Math.max(1, Math.round(text.length / 1024))} ${__t("ك.ب")}</p>
            <div class="btn-row">
                <button class="btn" data-m="dl">⬇ ${__t("تنزيل الملف")}</button>
                ${share ? ("<button class=\"btn gold\" data-m=\"share\">↗ " + __t("مشاركة") + "</button>") : ''}
                <button class="btn ghost" data-m="copy">⧉ ${__t("نسخ النص")}</button>
            </div>
            <p class="sub" style="margin-top:10px">${__t("إن لم يبدأ التنزيل (بعض التطبيقات المحوّلة تمنعه) فاستخدم «مشاركة» أو «نسخ النص».")}</p>
            <div class="actions"><button class="btn ghost" data-m="close">${__t("إغلاق")}</button></div>`);
        const used = () => { if (onUsed) onUsed(); };
        m.querySelector('[data-m="close"]').addEventListener('click', closeModal);
        m.addEventListener('dismiss', closeModal);
        m.querySelector('[data-m="dl"]').addEventListener('click', () => { download(filename, mime, text); used(); toast(__t('تم طلب التنزيل')); });
        m.querySelector('[data-m="copy"]').addEventListener('click', async () => {
            const ok = await copyText(text);
            toast(ok ? __t('تم نسخ النص') : __t('تعذّر النسخ'), !ok);
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
                ${o.back ? ("<button class=\"back-btn\" data-act=\"back\" aria-label=\"" + __t("رجوع") + "\">&rarr;</button>") : '<span class="logo"><img src="assets/brand/syria-eagle.svg" alt=""></span>'}
                <button class="lang-btn" type="button" onclick="setAppLang('${window.APP_LANG === 'en' ? 'ar' : 'en'}')">${window.APP_LANG === 'en' ? __t('عربي') : 'EN'}</button>
                <div class="ttl"><b>${h(o.title || __t('قسم المواقيف'))}</b><span>${h(o.sub || __t('إدارة أمن المطارات والمنافذ البرية والبحرية'))}</span></div>
                ${o.back ? '<span class="logo"><img src="assets/brand/syria-eagle.svg" alt=""></span>' : ''}
            </header>
            <main class="wrap">${body}</main>
            <nav class="bottomnav">
                ${nav('#/', 'home', '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>', __t('الرئيسية'))}
                ${nav('#/list', 'list', '<svg viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="17.5" rx="2"/><path d="M9 3.5h6v3H9z"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/></svg>', __t('الموقوفون'))}
                ${nav('#/new', 'new', '+', __t('إضافة'), 'add')}
                ${nav('#/reports', 'reports', '<svg viewBox="0 0 24 24"><path d="M6 3.5h9l3 3V21H6z"/><path d="M9 17v-3M12 17v-6M15 17v-4"/></svg>', __t('التقارير'))}
                ${nav('#/backup', 'backup', '<svg viewBox="0 0 24 24"><path d="M12 3v11"/><path d="m7.5 9.5 4.5 4.5 4.5-4.5"/><path d="M4 16v3.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg>', __t('النسخ والتصدير'))}
            </nav>`;
        window.scrollTo(0, 0);
    }

    function itemCard(d) {
        const st = L.status(d);
        const rem = L.remainingText(st);
        const remCls = st.overdue ? 'bad' : (st.near ? 'warn' : '');
        return `<a class="item ${st.key}" href="#/d/${d.id}">
            <div class="row1"><span class="nm">${h(d.name)}</span><span class="badge ${st.key}">${h(st.label)}</span></div>
            ${d.selfNo ? `<div class="sub">${__t("الرقم الذاتي")}: ${num(d.selfNo)}</div>` : ''}
            <div class="sub">${__t("توقيف رقم")} ${d.number ? num(d.number) : "—"}${d.complaintNo ? __t(' — الشكوى ') + num(d.complaintNo) : ''}</div>
            ${d.violation || d.workplace || d.detentionPlace ? `<div class="sub">${h([d.violation, d.workplace, d.detentionPlace].filter(Boolean).join(' · '))}</div>` : ''}
            <div class="sub">${__t("منذ")} ${num(d.detentionDate || "—")}${st.total ? ` · ${__t("المدة المسموحة")} ${st.total} ${__t("يوم")}` : ""}${d.orderingAuthority ? ' · ' + h(d.orderingAuthority) : ''}</div>
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
                <h2>${__t("أهلاً بك في تطبيق المواقيف")}</h2>
                <p>${__t("لا توجد سجلات بعد. أضف أول موقوف، أو استورد نسخة احتياطية سابقة.")}</p>
                <div class="btn-row"><a class="btn" href="#/new">+ ${__t("إضافة موقوف")}</a><a class="btn ghost" href="#/backup">${__t("استيراد نسخة احتياطية")}</a></div></div>`;
            return shell(html, { nav: 'home' });
        }
        const daysSinceBackup = S.lastBackup ? L.daysBetween(S.lastBackup.slice(0, 10)) : null;
        if (daysSinceBackup === null || daysSinceBackup >= 7) {
            html += `<div class="alertbox warn">${daysSinceBackup === null ? __t('لم تأخذ نسخة احتياطية بعد.') : `${__t("آخر نسخة احتياطية قبل")} ${daysSinceBackup} ${__t("يوم.")}`}
                ${__t("البيانات محفوظة على هذا الهاتف فقط — إن فُقد أو مُسح التطبيق ضاعت.")} <a href="#/backup" style="color:inherit;text-decoration:underline">${__t("خذ نسخة الآن")}</a></div>`;
        }
        const incompleteN = live.filter(d => missingOf(d).length).length;
        if (incompleteN) html += `<a class="alertbox info" style="display:block;text-decoration:none" href="#/list?tab=incomplete">✎ ${incompleteN} ${__t("سجلات غير مكتملة (مستوردة من Excel مثلاً) — اضغط لإكمالها")}</a>`;
        html += `<div class="stat-grid">
            <a class="stat primary" href="#/list?tab=open"><div class="n">${open.length}</div><div class="l">${__t("موقوفون حالياً")}</div></a>
            <a class="stat ${overdue.length ? 'alert' : ''}" href="#/list?tab=overdue"><div class="n">${overdue.length}</div><div class="l">${__t("تجاوزوا المدة")}</div></a>
            <a class="stat ${near.length ? 'warn' : ''}" href="#/list?tab=near"><div class="n">${near.length}</div><div class="l">${__t("قريبو انتهاء المدة")}</div></a>
            <a class="stat ok" href="#/list?tab=released"><div class="n">${relMonth.length}</div><div class="l">${__t("أُخلي سبيلهم هذا الشهر")}</div></a>
        </div>`;

        const alerts = overdue.concat(near).sort((a, b) => a.st.remaining - b.st.remaining).slice(0, 10);
        html += `<div class="card"><h2>${__t("تنبيهات المدة")} <span class="cnt">(${overdue.length + near.length})</span></h2>` +
            (alerts.length ? alerts.map(x => itemCard(x.d)).join('') : ("<div class=\"empty\" style=\"padding:10px\">" + __t("لا توجد تنبيهات — كل الموقوفين ضمن المدة المسموحة") + " ✓</div>")) + '</div>';
        html += ("<div class=\"btn-row\"><a class=\"btn\" href=\"#/new\">+ " + __t("إضافة موقوف") + "</a><a class=\"btn ghost\" href=\"#/list\">" + __t("بحث في السجلات") + "</a></div>");
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
            : `<div class="empty"><div class="big">🔍</div>${q ? __t('لا نتائج مطابقة للبحث.') : __t('لا توجد سجلات في هذا التصنيف.')}</div>`;
        return { chips, list, rows: rows.map(x => x.d) };
    }
    function viewList(query) {
        const tab = TABS.some(t => t.k === query.tab) ? query.tab : 'open';
        let q = query.q || '';
        shell(`<input class="search" id="q" type="search" placeholder="${__t("بحث بالاسم أو رقم التوقيف أو رقم الشكوى")}…" value="${h(q)}">
            <div class="chips" id="chips"></div><div id="results"></div>
            <div class="btn-row" style="margin-top:6px"><button class="btn ghost small" data-act="export-list">⬇ ${__t("تصدير القائمة الحالية")} (CSV)</button></div>`, { nav: 'list', title: __t('الموقوفون') });
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
            { name: 'number', label: __t('رقم التوقيف'), required: true, digits: true, ltr: true, value: d.number || '',
                hint: __t('اكتب رقم التوقيف كما هو في سجل القسم — مثال: 12/2026') },
            { name: 'name', label: __t('الاسم الكامل للموقوف'), required: true, value: d.name },
            { name: 'motherName', label: __t('اسم الأم'), value: d.motherName },
            { name: 'birth', label: __t('التولد'), value: d.birth, digits: true, ltr: true, hint: __t('سنة الولادة أو تاريخها') },
            { name: 'selfNo', label: __t('الرقم الذاتي'), value: d.selfNo, digits: true, ltr: true },
            { name: 'detentionPlace', label: __t('مكان التوقيف'), value: d.detentionPlace, hint: __t('مثال: نظارة مطار دمشق الدولي') },
            { name: 'workplace', label: __t('مكان العمل'), value: d.workplace, hint: __t('القسم أو الفرع أو الإدارة التي يعمل فيها') },
            { name: 'violation', label: __t('المخالفة'), value: d.violation, suggest: VIOLATIONS,
                hint: __t('اختر من القائمة الرسمية أو اكتب المخالفة') },
            { name: 'complaintNo', label: __t('رقم الشكوى / الوارد'), value: d.complaintNo, digits: true, ltr: true, hint: __t('اختياري — مثال: 524/2025') },
            { name: 'detentionDate', label: __t('تاريخ التوقيف'), type: 'date', required: true, value: d.detentionDate || L.today(), max: L.today() },
            { name: 'proposedDays', label: __t('المدة المقترحة (أيام)'), type: 'number', required: !(d.releaseDate || d.referredTo), min: 1, value: d.proposedDays || '' },
            { name: 'orderingAuthority', label: __t('الجهة الآمرة بالتوقيف'), required: true, value: d.orderingAuthority },
            { name: 'healthIn', label: __t('الحالة الصحية عند الدخول'), type: 'textarea', value: d.healthIn }
        ];
        if (!isNew) f.push({ name: 'healthOut', label: __t('الحالة الصحية عند الخروج'), type: 'textarea', value: d.healthOut });
        return f;
    }
    function validateDetention(vals, id) {
        const errs = {};
        if (vals.name.length < 2) errs.name = __t('اكتب الاسم الكامل');
        if (L.isValidDate(vals.detentionDate) && vals.detentionDate > L.today()) errs.detentionDate = __t('لا يمكن أن يكون تاريخ التوقيف في المستقبل');
        if (vals.number !== undefined) {
            vals.number = L.normNumber(vals.number);
            if (!L.isValidNumber(vals.number)) errs.number = __t('اكتب رقم التوقيف — مثال 12/2026');
            else if (S.all.some(x => L.normNumber(x.number) === vals.number && x.id !== id)) errs.number = __t('هذا الرقم مستخدم لموقوف آخر');
        }
        return errs;
    }

    function viewForm(id) {
        const d = id ? S.all.find(x => x.id === id) : null;
        if (id && !d) return notFound();
        const fields = detentionFields(!d, d);
        shell(`<div class="card"><h2>${d ? __t('تعديل بيانات التوقيف') : __t('تسجيل موقوف جديد')}</h2>
            <form id="df" novalidate>${fields.map(fieldHtml).join('')}
            <div class="btn-row"><button type="submit" class="btn">${__t("حفظ")}</button><button type="button" class="btn ghost" data-act="back">${__t("إلغاء")}</button></div></form></div>`,
            { back: true, nav: d ? 'list' : 'new', title: d ? __t('تعديل') : __t('موقوف جديد') });

        const form = document.getElementById('df');
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const vals = readValues(form, fields);
            let errs = validateFields(fields, vals);
            if (!Object.keys(errs).length) errs = validateDetention(vals, id);
            if (Object.keys(errs).length) return showErrors(form, errs);

            if (!d) {
                const dup = S.all.find(x => !x.isVoided && L.isOpen(L.status(x)) && x.name === vals.name);
                if (dup && !(await confirmDialog(__t('اسم مطابق لموقوف حالي'),
                    `${__t("يوجد موقوف حالي بنفس الاسم")} (${h(dup.name)} — ${__t("توقيف رقم")} ${num(dup.number)}). ${__t("هل تريد المتابعة وتسجيل توقيف جديد؟")}`, __t('متابعة')))) return;
                const rec = {
                    number: vals.number, name: vals.name, motherName: vals.motherName, birth: vals.birth, selfNo: vals.selfNo, detentionPlace: vals.detentionPlace, workplace: vals.workplace, violation: vals.violation, complaintNo: vals.complaintNo,
                    detentionDate: vals.detentionDate, proposedDays: parseInt(vals.proposedDays, 10),
                    orderingAuthority: vals.orderingAuthority, healthIn: vals.healthIn, healthOut: '',
                    releaseDate: '', referredTo: '', referralDate: '', extensions: [], belongings: [],
                    isVoided: false, voidReason: '', log: []
                };
                logEv(rec, `${__t("تسجيل التوقيف رقم")} ${rec.number} ${__t("لمدة")} ${rec.proposedDays} ${__t("يوم (الجهة الآمرة")}: ${rec.orderingAuthority})`);
                const newId = await Storage.put(rec);
                await reload();
                toast(__t('تم تسجيل الموقوف'));
                go('#/d/' + newId);
            } else {
                const before = JSON.stringify([d.name, d.motherName, d.birth, d.selfNo, d.detentionPlace, d.workplace, d.violation, d.complaintNo, d.detentionDate, d.proposedDays, d.orderingAuthority, d.healthIn, d.healthOut]);
                if (vals.number !== d.number) { logEv(d, `${__t("تعديل رقم التوقيف من")} ${d.number} ${__t("إلى")} ${vals.number}`); d.number = vals.number; }
                Object.assign(d, {
                    name: vals.name, motherName: vals.motherName, birth: vals.birth, selfNo: vals.selfNo, detentionPlace: vals.detentionPlace, workplace: vals.workplace, violation: vals.violation, complaintNo: vals.complaintNo, detentionDate: vals.detentionDate,
                    proposedDays: parseInt(vals.proposedDays, 10) || 0, orderingAuthority: vals.orderingAuthority,
                    healthIn: vals.healthIn, healthOut: vals.healthOut
                });
                const after = JSON.stringify([d.name, d.motherName, d.birth, d.selfNo, d.detentionPlace, d.workplace, d.violation, d.complaintNo, d.detentionDate, d.proposedDays, d.orderingAuthority, d.healthIn, d.healthOut]);
                if (before !== after) logEv(d, __t('تعديل بيانات التوقيف'));
                await Storage.put(d);
                await reload();
                toast(__t('تم حفظ التعديل'));
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
        const missing = d.isVoided ? [] : missingOf(d);
        if (missing.length) alerts += `<div class="alertbox warn">✎ ${__t("السجل غير مكتمل — أكمل")}: ${h(missing.join('، '))} <a href="#/d/${d.id}/edit" style="color:inherit;text-decoration:underline">${__t("تعديل البيانات")}</a></div>`;
        if (d.isVoided) alerts += `<div class="alertbox info">${__t("هذا السجل ملغى")}${d.voidReason ? __t(' — السبب: ') + h(d.voidReason) : ''}.</div>`;
        if (st.overdue) alerts += `<div class="alertbox bad">⚠ ${__t("تجاوز هذا الموقوف المدة المسموحة بـ")} ${-st.remaining} ${__t("يوم")} (${st.daysSince} ${__t("يوم من أصل")} ${st.total}).</div>`;
        else if (st.near) alerts += `<div class="alertbox warn">⏰ ${st.remaining === 0 ? __t('تنتهي المدة المسموحة اليوم') : __t('تنتهي المدة المسموحة غداً')} (${num(st.expectedRelease)}).</div>`;
        if (!open && !d.isVoided && unreturned.length) alerts += `<div class="alertbox warn">${__t("لديه")} ${unreturned.length} ${__t("من الممتلكات لم تُرجَع بعد.")}</div>`;

        let facts = kv(__t('اسم الأم'), h(d.motherName || '-')) + kv(__t('التولد'), d.birth ? num(d.birth) : '-') +
            kv(__t('الرقم الذاتي'), d.selfNo ? num(d.selfNo) : '-') + kv(__t('مكان التوقيف'), h(d.detentionPlace || '-')) +
            kv(__t('مكان العمل'), h(d.workplace || '-')) + kv(__t('المخالفة'), h(d.violation || '-')) +
            kv(__t('رقم الشكوى'), d.complaintNo ? num(d.complaintNo) : '-') +
            kv(__t('تاريخ التوقيف'), num(d.detentionDate)) +
            kv(__t('المدة المقترحة الأصلية'), st.total - L.extraDays(d) + __t(' يوم')) +
            kv(__t('مجموع التمديدات'), L.extraDays(d) + __t(' يوم')) +
            kv(__t('المدة الكلية المسموحة'), st.total + __t(' يوم'));
        if (open) facts += kv(__t('الأيام منذ التوقيف'), st.daysSince + __t(' يوم')) + kv(__t('الموعد المتوقع للإخلاء'), num(st.expectedRelease));
        facts += kv(__t('الجهة الآمرة بالتوقيف'), h(d.orderingAuthority || '-'), true);
        facts += kv(__t('الحالة الصحية عند الدخول'), h(d.healthIn || '-'), true);
        if (d.releaseDate) facts += kv(__t('تاريخ إخلاء السبيل'), num(d.releaseDate)) + kv(__t('مدة التوقيف الفعلية'), L.daysBetween(d.detentionDate, d.releaseDate) + __t(' يوم'));
        if (d.referredTo) facts += kv(__t('أُحيل إلى'), h(d.referredTo)) + kv(__t('تاريخ الإحالة'), num(d.referralDate || '-'));
        if (d.healthOut) facts += kv(__t('الحالة الصحية عند الخروج'), h(d.healthOut), true);

        let actions = '';
        if (!d.isVoided) {
            if (open) actions += `<div class="btn-row" style="margin-bottom:8px">
                <button class="btn" data-act="extend" data-id="${id}">⏱ ${__t("تمديد")}</button>
                <button class="btn ok" data-act="release" data-id="${id}">✔ ${__t("إخلاء سبيل")}</button>
                <button class="btn gold" data-act="refer" data-id="${id}">↗ ${__t("إحالة لجهة أخرى")}</button></div>`;
            actions += `<div class="btn-row"><a class="btn ghost small" href="#/d/${id}/edit">✎ ${__t("تعديل البيانات")}</a>` +
                (!open ? `<button class="btn ghost small" data-act="reopen" data-id="${id}">↩ ${__t("تصحيح: إلغاء الإغلاق")}</button>` : '') + '</div>';
        }

        const exts = (d.extensions || []).map((e, i) => `<div class="sub-item"><div class="top"><div><b>+${h(e.days)} ${__t("يوم")}</b> — ${num(e.date)}
            <div class="meta">${e.approvedBy ? __t('الموافق: ') + h(e.approvedBy) : ''}${e.notes ? ' · ' + h(e.notes) : ''}</div></div>
            ${d.isVoided ? '' : `<button class="link-btn" data-act="del-ext" data-id="${id}" data-sub="${i}">${__t("حذف")}</button>`}</div></div>`).join('');

        const bels = (d.belongings || []).map((b, i) => `<div class="sub-item"><div class="top"><div><b>${h(b.type)}</b> × ${h(b.quantity)}
            <div class="meta">${h(b.description || '')}${b.condition ? __t(' · الحالة: ') + h(b.condition) : ''}</div>
            <div class="meta">${b.returned ? `<span style="color:var(--ok);font-weight:700">${__t("أُرجع")} ${num(b.returnedDate)}${b.returnedTo ? __t(' إلى ') + h(b.returnedTo) : ''}</span>${b.returnNotes ? ' · ' + h(b.returnNotes) : ''}` : ("<span style=\"color:var(--warn);font-weight:700\">" + __t("لم يُرجَع بعد") + "</span>")}</div></div>
            ${d.isVoided ? '' : `<div>${b.returned ? '' : `<button class="link-btn pri" data-act="return-bel" data-id="${id}" data-sub="${i}">${__t("إرجاع")}</button>`}
            <button class="link-btn" data-act="del-bel" data-id="${id}" data-sub="${i}">${__t("حذف")}</button></div>`}</div></div>`).join('');

        const attHtml = atts.map(a => {
            const isImg = (a.type || '').indexOf('image/') === 0;
            let inner = '📄';
            if (isImg) { const u = URL.createObjectURL(a.blob); objectUrls.push(u); inner = `<img src="${u}" alt="">`; }
            return `<div class="thumb"><div class="box" data-act="view-att" data-id="${a.id}">${inner}</div><div class="nm">${h(a.name)}</div></div>`;
        }).join('');

        const log = (d.log || []).slice().reverse().map(x => `<li><span class="at">${h(fmtDateTime(x.at))}</span>${h(x.text)}</li>`).join('');

        shell(`<div class="card"><div class="row1" style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
                <div><div class="nm" style="font-size:1.25rem;font-weight:900;color:var(--primary)">${h(d.name)}</div>
                <div class="sub">${__t("توقيف رقم")} ${d.number ? num(d.number) : "—"}</div></div><span class="badge ${st.key}">${h(st.label)}</span></div></div>
            ${alerts}
            <div class="card"><div class="kv">${facts}</div></div>
            ${actions}
            <div class="card" style="margin-top:12px"><h3>${__t("التمديدات")} <span class="cnt">(${(d.extensions || []).length})</span></h3>${exts || ("<div class=\"sub\">" + __t("لا توجد تمديدات.") + "</div>")}</div>
            <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">${__t("الممتلكات الشخصية")} <span class="cnt">(${(d.belongings || []).length})</span></h3>
                ${d.isVoided ? '' : `<button class="btn small ghost" data-act="add-bel" data-id="${id}">+ ${__t("إضافة")}</button>`}</div>
                <div style="margin-top:8px">${bels || ("<div class=\"sub\">" + __t("لا توجد ممتلكات مسجلة.") + "</div>")}</div></div>
            <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">${__t("المرفقات")} <span class="cnt">(${atts.length})</span></h3>
                ${d.isVoided || !Storage.attachmentsSupported ? '' : `<button class="btn small ghost" data-act="add-att" data-id="${id}">+ ${__t("رفع")}</button><input type="file" id="attfile" hidden multiple accept="image/*,application/pdf">`}</div>
                <div style="margin-top:10px" class="thumbs">${attHtml || `<div class="sub">${Storage.attachmentsSupported ? __t('لا توجد مرفقات (صور الكتب الموقّعة مثلاً).') : __t('المرفقات غير متاحة في وضع التخزين البديل لهذا الجهاز.')}</div>`}</div></div>
            <div class="card"><h3>${__t("سجل العمليات")}</h3><ul class="timeline">${log || '<li>—</li>'}</ul></div>
            ${d.isVoided
                ? `<button class="btn ghost block" data-act="unvoid" data-id="${id}">${__t("استرجاع السجل الملغى")}</button>`
                : `<button class="btn ghost block" style="color:var(--bad);border-color:var(--bad)" data-act="void" data-id="${id}">${__t("إلغاء هذا السجل")}…</button>`}`,
            { back: true, nav: 'list', title: __t('بطاقة الموقوف') });

        const fileInput = document.getElementById('attfile');
        if (fileInput) fileInput.addEventListener('change', async () => {
            const files = Array.from(fileInput.files || []);
            let okCount = 0;
            for (const f of files) {
                if (f.size > 10 * 1024 * 1024) { toast(`${__t("الملف")} ${f.name} ${__t("أكبر من 10 م.ب")}`, true); continue; }
                if (!(f.type.indexOf('image/') === 0 || f.type === 'application/pdf')) { toast(`${__t("نوع الملف")} ${f.name} ${__t("غير مدعوم")}`, true); continue; }
                await Storage.addAttachment({ detentionId: id, name: f.name, type: f.type, size: f.size, blob: f });
                okCount++;
            }
            if (okCount) {
                logEv(d, `${__t("رفع")} ${okCount} ${__t("مرفق")}`);
                await Storage.put(d);
                await reload();
                toast(__t('تم رفع المرفقات'));
            }
            route();
        });
    }

    /* ----- عمليات صفحة الموقوف ----- */
    const minDateErr = (val, d, label) =>
        (L.isValidDate(val) && val < d.detentionDate) ? `${label} ${__t("قبل تاريخ التوقيف")} (${d.detentionDate})` : null;

    const actions = {
        back() { if (history.length > 1) history.back(); else go('#/list'); },

        async extend(id) {
            const d = S.all.find(x => x.id === id);
            const v = await askForm({
                title: __t('تمديد مدة التوقيف'),
                intro: `${__t("المدة الحالية المسموحة")}: <b>${L.status(d).total}</b> ${__t("يوم.")}`,
                fields: [
                    { name: 'date', label: __t('تاريخ التمديد'), type: 'date', required: true, value: L.today() },
                    { name: 'days', label: __t('عدد الأيام المضافة'), type: 'number', required: true, min: 1 },
                    { name: 'approvedBy', label: __t('الجهة / الشخص الموافق'), hint: __t('اختياري') },
                    { name: 'notes', label: __t('ملاحظات'), type: 'textarea' }
                ],
                ok: __t('تسجيل التمديد'),
                validate: vals => { const e = minDateErr(vals.date, d, __t('تاريخ التمديد')); return e ? { date: e } : {}; }
            });
            if (!v) return;
            (d.extensions = d.extensions || []).push({ date: v.date, days: parseInt(v.days, 10), approvedBy: v.approvedBy, notes: v.notes });
            logEv(d, `${__t("تمديد التوقيف")} ${v.days} ${__t("يوم")}${v.approvedBy ? __t(' (الموافق: ') + v.approvedBy + ')' : ''}`);
            await Storage.put(d); await reload(); toast(__t('تم تسجيل التمديد')); route();
        },

        async release(id) {
            const d = S.all.find(x => x.id === id);
            const un = (d.belongings || []).filter(b => !b.returned).length;
            const v = await askForm({
                title: __t('إخلاء سبيل'),
                intro: un ? `<span style="color:var(--warn);font-weight:700">${__t("تنبيه")}: ${un} ${__t("من ممتلكاته لم تُرجَع بعد.")}</span>` : '',
                fields: [
                    { name: 'date', label: __t('تاريخ إخلاء السبيل'), type: 'date', required: true, value: L.today() },
                    { name: 'healthOut', label: __t('الحالة الصحية عند الخروج'), type: 'textarea' }
                ],
                ok: __t('تأكيد الإخلاء'),
                validate: vals => {
                    const e = minDateErr(vals.date, d, __t('تاريخ الإخلاء'));
                    if (e) return { date: e };
                    if (vals.date > L.today()) return { date: __t('لا يمكن أن يكون تاريخ الإخلاء في المستقبل') };
                    return {};
                }
            });
            if (!v) return;
            d.releaseDate = v.date; if (v.healthOut) d.healthOut = v.healthOut;
            logEv(d, `${__t("إخلاء سبيل بتاريخ")} ${v.date} ${__t("(مدة التوقيف الفعلية")} ${L.daysBetween(d.detentionDate, v.date)} ${__t("يوم)")}`);
            await Storage.put(d); await reload(); toast(__t('تم تسجيل إخلاء السبيل')); route();
        },

        async refer(id) {
            const d = S.all.find(x => x.id === id);
            const v = await askForm({
                title: __t('إحالة إلى جهة أخرى'),
                fields: [
                    { name: 'entity', label: __t('الجهة المُحال إليها'), required: true, hint: __t('مثال: القضاء العسكري') },
                    { name: 'date', label: __t('تاريخ الإحالة'), type: 'date', required: true, value: L.today() },
                    { name: 'healthOut', label: __t('الحالة الصحية عند الخروج'), type: 'textarea' }
                ],
                ok: __t('تسجيل الإحالة'),
                validate: vals => {
                    const e = minDateErr(vals.date, d, __t('تاريخ الإحالة'));
                    if (e) return { date: e };
                    if (vals.date > L.today()) return { date: __t('لا يمكن أن يكون تاريخ الإحالة في المستقبل') };
                    return {};
                }
            });
            if (!v) return;
            d.referredTo = v.entity; d.referralDate = v.date; if (v.healthOut) d.healthOut = v.healthOut;
            logEv(d, `${__t("إحالة إلى")} ${v.entity} ${__t("بتاريخ")} ${v.date}`);
            await Storage.put(d); await reload(); toast(__t('تم تسجيل الإحالة')); route();
        },

        async reopen(id) {
            const d = S.all.find(x => x.id === id);
            const what = d.releaseDate ? __t('إخلاء السبيل') : __t('الإحالة');
            if (!(await confirmDialog(__t('تصحيح الإغلاق'), `${__t("سيُلغى تسجيل")} ${what} ${__t("ويعود الموقوف إلى حالة «موقوف». يُستعمل فقط لتصحيح خطأ إدخال. هل تتابع؟")}`, __t('نعم، تصحيح'), true))) return;
            d.releaseDate = ''; d.referredTo = ''; d.referralDate = '';
            logEv(d, `${__t("تصحيح: إلغاء تسجيل")} ${what}`);
            await Storage.put(d); await reload(); toast(__t('تم التصحيح')); route();
        },

        async 'del-ext'(id, sub) {
            const d = S.all.find(x => x.id === id);
            const e = d.extensions[+sub];
            if (!(await confirmDialog(__t('حذف التمديد'), `${__t("حذف تمديد")} ${h(e.days)} ${__t("يوم بتاريخ")} ${num(e.date)}؟`, __t('حذف'), true))) return;
            d.extensions.splice(+sub, 1);
            logEv(d, `${__t("حذف تمديد")} (${e.days} ${__t("يوم بتاريخ")} ${e.date})`);
            await Storage.put(d); await reload(); route();
        },

        async 'add-bel'(id) {
            const d = S.all.find(x => x.id === id);
            const v = await askForm({
                title: __t('إضافة غرض شخصي'),
                fields: [
                    { name: 'type', label: __t('نوع الغرض'), type: 'select', options: BELONGING_TYPES, value: BELONGING_TYPES[0] },
                    { name: 'description', label: __t('الوصف (الماركة / اللون / الرقم التسلسلي)'), type: 'textarea' },
                    { name: 'quantity', label: __t('الكمية'), type: 'number', min: 1, value: 1, required: true },
                    { name: 'condition', label: __t('الحالة عند الاستلام') }
                ],
                ok: __t('إضافة')
            });
            if (!v) return;
            (d.belongings = d.belongings || []).push({
                type: v.type, description: v.description, quantity: parseInt(v.quantity, 10) || 1,
                condition: v.condition, returned: false, returnedDate: '', returnedTo: '', returnNotes: ''
            });
            logEv(d, `${__t("استلام غرض شخصي")}: ${v.type}${v.description ? ' (' + v.description + ')' : ''}`);
            await Storage.put(d); await reload(); toast(__t('تمت الإضافة')); route();
        },

        async 'return-bel'(id, sub) {
            const d = S.all.find(x => x.id === id);
            const b = d.belongings[+sub];
            const v = await askForm({
                title: `${__t("إرجاع")}: ${b.type}`,
                fields: [
                    { name: 'date', label: __t('تاريخ الإرجاع'), type: 'date', required: true, value: L.today() },
                    { name: 'to', label: __t('سُلِّم إلى'), hint: __t('اسم المستلم') },
                    { name: 'notes', label: __t('ملاحظات'), type: 'textarea' }
                ],
                ok: __t('تأكيد الإرجاع'),
                validate: vals => { const e = minDateErr(vals.date, d, __t('تاريخ الإرجاع')); return e ? { date: e } : {}; }
            });
            if (!v) return;
            Object.assign(b, { returned: true, returnedDate: v.date, returnedTo: v.to, returnNotes: v.notes });
            logEv(d, `${__t("إرجاع")} ${b.type}${v.to ? __t(' إلى ') + v.to : ''} ${__t("بتاريخ")} ${v.date}`);
            await Storage.put(d); await reload(); toast(__t('تم تسجيل الإرجاع')); route();
        },

        async 'del-bel'(id, sub) {
            const d = S.all.find(x => x.id === id);
            const b = d.belongings[+sub];
            if (!(await confirmDialog(__t('حذف الغرض'), `${__t("حذف")} «${h(b.type)}» ${__t("من قائمة الممتلكات؟")}`, __t('حذف'), true))) return;
            d.belongings.splice(+sub, 1);
            logEv(d, `${__t("حذف غرض من القائمة")}: ${b.type}`);
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
                ${isImg ? `<img src="${url}" alt="" style="max-width:100%;border-radius:10px;display:block;margin:0 auto 12px">` : ("<p class=\"sub\">" + __t("ملف") + " PDF — " + __t("استخدم «تنزيل» لفتحه.") + "</p>")}
                <div class="actions"><button class="btn ghost" data-m="close">${__t("إغلاق")}</button>
                <button class="btn ghost" data-m="dl">⬇ ${__t("تنزيل")}</button>
                <button class="btn danger" data-m="del">${__t("حذف")}</button></div>`);
            const close = () => { URL.revokeObjectURL(url); closeModal(); };
            m.addEventListener('dismiss', close);
            m.querySelector('[data-m="close"]').addEventListener('click', close);
            m.querySelector('[data-m="dl"]').addEventListener('click', () => {
                const link = document.createElement('a'); link.href = url; link.download = a.name; document.body.appendChild(link); link.click(); link.remove();
            });
            m.querySelector('[data-m="del"]').addEventListener('click', async () => {
                if (!(await confirmDialog(__t('حذف المرفق'), `${__t("حذف")} «${h(a.name)}» ${__t("نهائياً؟")}`, __t('حذف'), true))) return;
                await Storage.deleteAttachment(a.id);
                const d = S.all.find(x => x.id === idNum);
                if (d) { logEv(d, `${__t("حذف مرفق")}: ${a.name}`); await Storage.put(d); await reload(); }
                URL.revokeObjectURL(url); closeModal(); route();
            });
        },

        async void(id) {
            const d = S.all.find(x => x.id === id);
            const v = await askForm({
                title: __t('إلغاء السجل'),
                intro: __t('يبقى السجل ظاهراً بحالة «ملغى» مع سببه ولا يُحذف نهائياً — للحفاظ على الأثر.'),
                fields: [{ name: 'reason', label: __t('سبب الإلغاء'), type: 'textarea', required: true }],
                ok: __t('إلغاء السجل'), danger: true
            });
            if (!v) return;
            d.isVoided = true; d.voidReason = v.reason;
            logEv(d, `${__t("إلغاء السجل — السبب")}: ${v.reason}`);
            await Storage.put(d); await reload(); toast(__t('أُلغي السجل')); route();
        },

        async unvoid(id) {
            const d = S.all.find(x => x.id === id);
            if (!(await confirmDialog(__t('استرجاع السجل'), __t('سيعود السجل إلى القوائم العادية. هل تتابع؟'), __t('استرجاع')))) return;
            d.isVoided = false; d.voidReason = '';
            logEv(d, __t('استرجاع السجل بعد الإلغاء'));
            await Storage.put(d); await reload(); toast(__t('تم الاسترجاع')); route();
        },

        'export-list'() {
            const rows = root._rows || [];
            if (!rows.length) return toast(__t('لا توجد سجلات لتصديرها'), true);
            exportDialog(__t('تصدير القائمة الحالية'), `mawaqif-airports-list-${L.today()}.csv`, 'text/csv;charset=utf-8', L.toCsv(rows));
        }
    };

    /* ================= النسخ الاحتياطي ================= */
    async function viewBackup() {
        const token = ++S.token;
        const attCount = await Storage.attachmentCount();
        const est = await Storage.estimate();
        if (token !== S.token) return;
        const persisted = (navigator.storage && navigator.storage.persisted) ? await navigator.storage.persisted().catch(() => false) : false;
        const mb = est && est.usage != null ? (est.usage / 1048576).toFixed(1) + __t(' م.ب') : __t('غير معروف');

        shell(`
            <div class="card"><h2>${__t("حالة التخزين")}</h2><div class="kv">
                <div><div class="k">${__t("عدد السجلات / المرفقات")}</div><div class="v">${S.all.length} / ${attCount}</div></div>
                <div><div class="k">${__t("المساحة المستعملة")}</div><div class="v">${h(mb)}</div></div>
                <div><div class="k">${__t("وضع التخزين")}</div><div class="v">${Storage.mode === 'idb' ? __t('IndexedDB (كامل)') : __t('بديل (بدون مرفقات)')}</div></div>
                <div><div class="k">${__t("آخر نسخة احتياطية")}</div><div class="v">${S.lastBackup ? h(fmtDateTime(S.lastBackup)) : __t('لم تُؤخذ بعد')}</div></div></div>
                <p class="sub" style="margin-top:10px">${__t("البيانات محفوظة على هذا الهاتف فقط. خذ نسخة احتياطية دورياً واحتفظ بها خارج الهاتف.")}</p>
                ${persisted ? ("<div class=\"alertbox info\" style=\"margin:0\">✓ " + __t("التخزين محمي من الحذف التلقائي — لن يحذف الهاتف البيانات عند امتلاء ذاكرته") + "</div>") : ("<div class=\"alertbox warn\" style=\"margin:0 0 8px\">⚠ " + __t("التخزين غير محمي من الحذف التلقائي — قد يحذف الهاتف البيانات إذا امتلأت ذاكرته. ثبّت التطبيق على الشاشة الرئيسية ثم اضغط الزر.") + "</div><button class=\"btn ghost small\" data-bk=\"persist\">" + __t("طلب حماية البيانات") + "</button>")}
            </div>
            <div class="card"><h2>${__t("قفل التطبيق بالرمز السري")}</h2>
                <p class="sub">${S.pin
                    ? `${__t("القفل مفعّل")} (${S.pin.len} ${__t("أرقام) — يُطلب الرمز عند الفتح وبعد غياب التطبيق عن الشاشة أكثر من دقيقة.")}`
                    : __t('غير مفعّل. فعّل رمزاً من 4 إلى 6 أرقام لمنع من يمسك الهاتف من رؤية السجلات.')}</p>
                <div class="btn-row">${S.pin
                    ? ("<button class=\"btn small\" data-bk=\"lockNow\">🔒 " + __t("قفل الآن") + "</button><button class=\"btn ghost small\" data-bk=\"pinChange\">" + __t("تغيير الرمز") + "</button><button class=\"btn ghost small\" data-bk=\"pinOff\">" + __t("إلغاء القفل") + "</button>")
                    : ("<button class=\"btn\" data-bk=\"pinSet\">🔒 " + __t("تفعيل القفل") + "</button>")}</div>
                <p class="sub" style="margin-top:8px">${__t("القفل يمنع العرض فقط ولا يشفّر البيانات المخزّنة، ولا تشمله النسخة الاحتياطية. بعد 5 محاولات خاطئة يتأخر الإدخال تدريجياً.")}</p></div>
            <div class="card"><h2>${__t("نسخة احتياطية كاملة")}</h2>
                <p class="sub">${__t("كل السجلات والمرفقات في ملف واحد")} (JSON) ${__t("يمكن استرجاعه على هذا الهاتف أو على هاتف آخر.")}</p>
                <button class="btn block" data-bk="export">⬇ ${__t("أخذ نسخة احتياطية")}</button></div>
            <div class="card"><h2>${__t("استرجاع نسخة احتياطية")}</h2>
                <div class="field"><label>${__t("اختر ملف النسخة (.")}json)</label><input type="file" id="impfile" accept=".json,application/json"></div>
                <div class="field"><label>${__t("أو الصق نص النسخة هنا")}</label><textarea id="imptext" dir="ltr" placeholder="{ &quot;app&quot;: &quot;mawaqif-airports&quot; … }"></textarea></div>
                <div class="field"><label>${__t("طريقة الاسترجاع")}</label><select id="impmode">
                    <option value="merge">${__t("دمج مع الموجود (يُبقي الأحدث لكل سجل)")}</option>
                    <option value="replace">${__t("استبدال كل البيانات الحالية")}</option></select></div>
                <button class="btn gold block" data-bk="import">⬆ ${__t("استرجاع")}</button></div>
            <div class="card"><h2>${__t("استيراد موقوفين من ملف Excel")}</h2>
                <p class="sub">${__t("يتعرّف التطبيق على الأعمدة من عناوينها: الاسم الثلاثي، اسم الأم، الرقم الذاتي، التولد، سبب التوقيف، تاريخ التوقيف، تاريخ الخروج، الجهة التي أصدرت التوقيف، مكان العمل، مكان التوقيف. ما ينقص (مثل رقم التوقيف والمدة) تكمله لاحقاً.")}</p>
                <div class="field"><label>${__t("ملف Excel")} (xlsx / csv)</label><input type="file" id="xlsfile" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></div>
                <button class="btn gold block" data-bk="excel">⬆ ${__t("استيراد من Excel")}</button></div>
            <div class="card"><h2>${__t("تصدير للجداول")}</h2>
                <p class="sub">${__t("كل السجلات غير الملغاة بصيغة")} CSV ${__t("تفتح في")} Excel.</p>
                <button class="btn ghost block" data-bk="csv">⬇ ${__t("تصدير الكل")} (CSV)</button></div>
            <div class="card" style="border-color:#F0B8B3"><h2 style="color:var(--bad)">${__t("منطقة الخطر")}</h2>
                <button class="btn danger block" data-bk="wipe">${__t("حذف كل البيانات من هذا الهاتف")}</button></div>
            <p class="sub" style="text-align:center">${__t("تطبيق المواقيف — نسخة مستقلة تعمل بلا خادم")}</p>`,
            { nav: 'backup', title: __t('النسخ والتصدير') });
    }

    async function markBackup() {
        S.lastBackup = new Date().toISOString();
        await Storage.setMeta('lastBackup', S.lastBackup);
    }

    const pinValidate = vals => {
        const e = {};
        if (!/^\d{4,6}$/.test(vals.pin)) e.pin = __t('الرمز من 4 إلى 6 أرقام');
        else if (vals.pin2 !== vals.pin) e.pin2 = __t('الرمزان غير متطابقين');
        return e;
    };
    const pinField = (name, label) => ({ name, label, type: 'password', numeric: true, digits: true, required: true });
    const curPinField = () => pinField('cur', __t('الرمز الحالي'));
    const curPinValidate = vals => verifyPin(vals.cur) ? {} : { cur: __t('الرمز الحالي غير صحيح') };

    const backupActions = {
        async pinSet() {
            const v = await askForm({
                title: __t('تفعيل قفل الرمز السري'),
                fields: [pinField('pin', __t('الرمز الجديد (4 إلى 6 أرقام)')), pinField('pin2', __t('أعد كتابة الرمز'))],
                ok: __t('تفعيل القفل'), validate: pinValidate
            });
            if (!v) return;
            await savePin(makePin(v.pin));
            toast(__t('تم تفعيل القفل'));
            viewBackup();
        },
        async pinChange() {
            const v = await askForm({
                title: __t('تغيير الرمز السري'),
                fields: [curPinField(), pinField('pin', __t('الرمز الجديد (4 إلى 6 أرقام)')), pinField('pin2', __t('أعد كتابة الرمز الجديد'))],
                ok: __t('تغيير الرمز'),
                validate: vals => Object.assign({}, curPinValidate(vals), pinValidate(vals))
            });
            if (!v) return;
            await savePin(makePin(v.pin));
            toast(__t('تم تغيير الرمز'));
            viewBackup();
        },
        async pinOff() {
            const v = await askForm({
                title: __t('إلغاء القفل'),
                fields: [curPinField()],
                ok: __t('إلغاء القفل'), danger: true, validate: curPinValidate
            });
            if (!v) return;
            await savePin(null);
            toast(__t('أُلغي القفل'));
            viewBackup();
        },
        lockNow() { showLock(); },
        async export() {
            toast(__t('جارٍ تجهيز النسخة…'));
            const data = await Storage.exportAll();
            const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
            exportDialog(__t('النسخة الاحتياطية'), `mawaqif-airports-backup-${stamp}.json`, 'application/json',
                JSON.stringify(data), () => { markBackup(); });
        },
        async excel() {
            const f = document.getElementById('xlsfile').files[0];
            if (!f) return toast(__t('اختر ملف Excel أولاً'), true);
            let rows;
            try { rows = await window.readSheet(f); } catch (e) { return toast(e.message, true); }
            const { map, items } = parseExcelRows(rows);
            if (!map) return toast(__t('لم أجد صف العناوين — يجب أن يحتوي عمود «الاسم الثلاثي» وعمودين آخرين على الأقل'), true);
            if (!items.length) return toast(__t('لم أجد أي أسماء في الملف'), true);
            const known = new Set(S.all.filter(d => !d.isVoided).map(dupKey));
            const seen = new Set(), fresh = [], dups = [];
            items.forEach(it => { const k = dupKey(it); if (known.has(k) || seen.has(k)) dups.push(it.name); else { seen.add(k); fresh.push(it); } });
            const cols = Object.keys(map).map(k => __t(EXCEL_LABELS[k] || k)).join('، ');
            const released = fresh.filter(it => it.releaseDate).length;
            const msg = `${__t('الأعمدة التي تعرّف عليها التطبيق')}: ${h(cols)}<br><br>` +
                `${__t('عدد الموقوفين الذين سيُضافون')}: <b>${fresh.length}</b>` + (released ? ` (${released} ${__t('منهم أُخلي سبيلهم')})` : '') + '.' +
                (dups.length ? `<br>${__t('تُرك')} ${dups.length} ${__t('موجود مسبقاً (نفس الرقم الذاتي أو الاسم وتاريخ التوقيف)')}.` : '') +
                `<br><br>${__t('بعد الاستيراد أكمل رقم التوقيف والمدة المقترحة من تبويب «غير مكتملة».')}`;
            if (!fresh.length) return toast(__t('كل الأسماء في الملف موجودة مسبقاً'), true);
            if (!(await confirmDialog(__t('استيراد من Excel'), msg, __t('استيراد')))) return;
            for (const it of fresh) {
                const rec = Object.assign({
                    number: '', name: '', motherName: '', birth: '', selfNo: '', detentionPlace: '', workplace: '', violation: '', complaintNo: '',
                    detentionDate: '', proposedDays: 0, orderingAuthority: '', healthIn: '', healthOut: '',
                    releaseDate: '', referredTo: '', referralDate: '', extensions: [], belongings: [], isVoided: false, voidReason: '', log: []
                }, it);
                logEv(rec, `${__t('استيراد من ملف Excel')} (${f.name})`);
                await Storage.put(rec);
            }
            await reload();
            toast(`${__t('تم الاستيراد')}: ${fresh.length}`);
            go('#/list?tab=' + (fresh.some(it => !it.releaseDate) ? 'incomplete' : 'all'));
        },
        csv() {
            const rows = S.all.filter(d => !d.isVoided);
            if (!rows.length) return toast(__t('لا توجد سجلات لتصديرها'), true);
            exportDialog(__t('تصدير كل السجلات'), `mawaqif-airports-all-${L.today()}.csv`, 'text/csv;charset=utf-8', L.toCsv(rows));
        },
        async persist() {
            const ok = await Storage.requestPersistence();
            toast(ok ? __t('تم تفعيل الحفظ الدائم') : __t('لم يوافق الجهاز على الحفظ الدائم'), !ok);
            viewBackup();
        },
        async import() {
            const fileEl = document.getElementById('impfile');
            let text = document.getElementById('imptext').value.trim();
            if (!text && fileEl.files && fileEl.files[0]) text = await fileEl.files[0].text();
            if (!text) return toast(__t('اختر ملفاً أو الصق نص النسخة'), true);
            let data;
            try { data = JSON.parse(text); } catch (e) { return toast(__t('النص ليس JSON صالحاً'), true); }
            if (!data || data.app !== 'mawaqif-airports') return toast(__t('الملف ليس نسخة احتياطية لهذا التطبيق'), true);
            const mode = document.getElementById('impmode').value;
            const msg = mode === 'replace'
                ? `${__t("سيُحذف كل ما هو موجود الآن")} (${S.all.length} ${__t("سجل) ويُستبدل بـ")} ${data.detentions.length} ${__t("سجل من النسخة. لا يمكن التراجع.")}`
                : `${__t("سيُدمج")} ${data.detentions.length} ${__t("سجل من النسخة مع الموجود، ويبقى الأحدث لكل سجل.")}`;
            if (!(await confirmDialog(__t('تأكيد الاسترجاع'), msg, __t('استرجاع'), mode === 'replace'))) return;
            try {
                const r = await Storage.importAll(data, mode);
                await reload();
                const nums = {};
                let dups = 0;
                S.all.forEach(d => { if (nums[d.number]) dups++; nums[d.number] = 1; });
                toast(`${__t("أُضيف")} ${r.added} · ${__t("حُدّث")} ${r.updated} · ${__t("تُرك")} ${r.skipped}${dups ? ` — ${__t("تنبيه")}: ${dups} ${__t("رقم توقيف مكرر")}` : ''}`);
                viewBackup();
            } catch (e) { toast(__t('فشل الاسترجاع: ') + e.message, true); }
        },
        async wipe() {
            const v = await askForm({
                title: __t('حذف كل البيانات'),
                intro: `${__t("سيُحذف")} <b>${S.all.length}</b> ${__t("سجل ومرفقاته نهائياً من هذا الهاتف. خذ نسخة احتياطية أولاً إن لم تفعل.")}`,
                fields: [{ name: 'w', label: __t('اكتب كلمة «حذف» للتأكيد'), required: true }],
                ok: __t('حذف نهائي'), danger: true,
                validate: vals => vals.w === __t('حذف') ? {} : { w: __t('اكتب الكلمة كما هي: حذف') }
            });
            if (!v) return;
            await Storage.clearAll(); await reload();
            toast(__t('تم حذف كل البيانات')); go('#/');
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
        el.innerHTML = `<img src="assets/brand/syria-eagle.svg" alt=""><h2>${__t("تطبيق المواقيف")}</h2>
            <div class="msg" id="lockmsg"></div>
            <div class="dots" id="lockdots">${'<i></i>'.repeat(len)}</div>
            <div class="keypad">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
                <button class="sm" data-k="forgot">${__t("نسيت")}<br>${__t("الرمز؟")}</button>
                <button data-k="0">0</button>
                <button data-k="del" aria-label="${__t("مسح")}">⌫</button>
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
                msg(__t('محاولات خاطئة كثيرة — انتظر ') + left + __t(' ثانية'), true);
                timer = setTimeout(refreshLockout, 1000);
            } else {
                keys().forEach(b => { b.disabled = false; });
                if (el.querySelector('#lockmsg').textContent.indexOf(__t('انتظر')) !== -1) msg(__t('أدخل الرمز السري'));
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
            if (f.until > Date.now()) refreshLockout(); else msg(__t('الرمز غير صحيح (') + f.n + __t(' من 5)'), true);
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
        msg(__t('أدخل الرمز السري'));
        refreshLockout();
    }

    // نسيان الرمز: لا استرجاع له. المتاح فقط حذف كل البيانات وإلغاء القفل (ثم استرجاع نسخة احتياطية إن وُجدت)
    async function forgotPin(finishLock) {
        const v = await askForm({
            title: __t('نسيت الرمز السري'),
            intro: (__t("لا يمكن استرجاع الرمز. المتاح فقط") + " <b>" + __t("حذف كل البيانات من هذا الهاتف") + "</b> " + __t("وإلغاء القفل، ثم استرجاع آخر نسخة احتياطية إن كانت لديك.")),
            fields: [{ name: 'w', label: __t('اكتب كلمة «حذف» للتأكيد'), required: true }],
            ok: __t('حذف كل البيانات'), danger: true,
            validate: vals => vals.w === __t('حذف') ? {} : { w: __t('اكتب الكلمة كما هي: حذف') }
        });
        if (!v) return;
        await Storage.clearAll();
        await savePin(null);
        await reload();
        finishLock();
        toast(__t('حُذفت البيانات وأُلغي القفل'));
        go('#/');
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { S.hiddenAt = Date.now(); return; }
        if (S.pin && !S.locked && S.hiddenAt && Date.now() - S.hiddenAt > LOCK_AFTER_MS) showLock();
    });

    function notFound() {
        shell(("<div class=\"card empty\"><div class=\"big\">❓</div><p>" + __t("السجل غير موجود.") + "</p><a class=\"btn\" href=\"#/list\">" + __t("العودة للقائمة") + "</a></div>"), { back: true, nav: 'list' });
    }

    /* ================= التقارير (صفحات A4 بنمط تقارير الإدارة، للطباعة أو الحفظ PDF) ================= */
    const BRAND = window.APP_BRAND || { ministry: __t('وزارة الداخلية'), dept: '', logo: '' };
    const REP_TABS = [
        { k: 'current', t: __t('الموقوفون الحاليون'), title: __t('قائمة الموقوفين الحاليين'), dated: false,
            f: st => L.isOpen(st) },
        { k: 'referred', t: __t('المحالون'), title: __t('قائمة الموقوفين المحالين إلى جهات أخرى'), dated: true, dateKey: 'referralDate',
            f: st => st.key === 'referred' },
        { k: 'released', t: __t('المخلى سبيلهم'), title: __t('قائمة الموقوفين المخلى سبيلهم'), dated: true, dateKey: 'releaseDate',
            f: st => st.key === 'released' }
    ];
    const AR_MONTHS = [__t('كانون الثاني'), __t('شباط'), __t('آذار'), __t('نيسان'), __t('أيار'), __t('حزيران'), __t('تموز'), __t('آب'), __t('أيلول'), __t('تشرين الأول'), __t('تشرين الثاني'), __t('كانون الأول')];
    const fmtD = s => { if (!L.isValidDate(s)) return s || '-'; const p = s.split('-'); return `${+p[2]}/${+p[1]}/${p[0]}`; };
    const monthLabel = s => { const p = (s || L.today()).split('-'); return `${AR_MONTHS[+p[1] - 1]} ${p[0]}`; };
    const cnt = (n, one, many, acc) => { if (window.APP_LANG === 'en') return `${n} ${n === 1 ? one : many}`; const r = n % 100; return r >= 3 && r <= 10 ? `${n} ${many}` : r >= 11 && r <= 99 ? `${n} ${acc || one}` : `${n} ${one}`; };

    function reportRows(tab, from, to) {
        const T = REP_TABS.find(t => t.k === tab);
        let rows = S.all.filter(d => !d.isVoided).map(d => ({ d, st: L.status(d) })).filter(x => T.f(x.st));
        if (T.dated) rows = rows.filter(x => { const v = x.d[T.dateKey] || ''; return (!from || v >= from) && (!to || v <= to); });
        if (tab === 'current') rows.sort((a, b) => a.st.remaining - b.st.remaining || (a.d.detentionDate || '').localeCompare(b.d.detentionDate || ''));
        else rows.sort((a, b) => (a.d[T.dateKey] || '').localeCompare(b.d[T.dateKey] || ''));
        return rows;
    }

    function reportColumns(tab) {
        const common = [
            { t: __t('م'), w: 5, v: (x, i) => i + 1 },
            { t: __t('رقم التوقيف'), w: 9, v: x => x.d.number, ltr: true },
            { t: __t('الاسم'), w: 18, v: x => x.d.name, strong: true, right: true, sub: x => x.d.selfNo ? `${__t('الرقم الذاتي')}: ${x.d.selfNo}` : '' },
            { t: __t('مكان التوقيف'), w: 10, v: x => x.d.detentionPlace || '-', right: true },
            { t: __t('مكان العمل'), w: 11, v: x => x.d.workplace || '-', right: true },
            { t: __t('المخالفة'), w: 11, v: x => x.d.violation || '-', right: true },
            { t: __t('تاريخ التوقيف'), w: 9, v: x => fmtD(x.d.detentionDate) }
        ];
        if (tab === 'current') return common.concat([
            { t: __t('المدة المسموحة'), w: 7, v: x => x.st.total + __t(' يوم') },
            { t: __t('الوضع'), w: 10, v: x => x.st.key === 'incomplete' ? __t('بيانات ناقصة') : x.st.remaining < 0 ? `${__t("تجاوز")} ${-x.st.remaining} ${__t("يوم")}` : x.st.remaining === 0 ? __t('تنتهي اليوم') : `${__t("متبقٍّ")} ${x.st.remaining} ${__t("يوم")}`, cls: x => x.st.overdue ? 'bad' : x.st.near ? 'warn' : '' },
            { t: __t('الجهة الآمرة'), w: 10, v: x => x.d.orderingAuthority || '-', right: true }
        ]);
        if (tab === 'referred') return common.concat([
            { t: __t('تاريخ الإحالة'), w: 10, v: x => fmtD(x.d.referralDate) },
            { t: __t('أُحيل إلى'), w: 12, v: x => x.d.referredTo || '-', right: true },
            { t: __t('مدة التوقيف'), w: 6, v: x => L.daysBetween(x.d.detentionDate, x.d.referralDate) + __t(' يوم') }
        ]);
        return common.concat([
            { t: __t('تاريخ الإخلاء'), w: 10, v: x => fmtD(x.d.releaseDate) },
            { t: __t('مدة التوقيف الفعلية'), w: 9, v: x => L.daysBetween(x.d.detentionDate, x.d.releaseDate) + __t(' يوم') },
            { t: __t('الجهة الآمرة'), w: 9, v: x => x.d.orderingAuthority || '-', right: true }
        ]);
    }

    function reportKpis(tab, rows) {
        const n = rows.length;
        if (tab === 'current') {
            const over = rows.filter(x => x.st.overdue).length, near = rows.filter(x => x.st.near).length;
            return [[n, __t('موقوف حالياً')], [over, __t('تجاوزوا المدة')], [near, __t('قريبو انتهاء المدة')], [n - over - near, __t('ضمن المدة')]];
        }
        const days = rows.map(x => L.daysBetween(x.d.detentionDate, tab === 'referred' ? x.d.referralDate : x.d.releaseDate));
        const avg = n ? Math.round(days.reduce((a, b) => a + b, 0) / n) : 0;
        if (tab === 'referred') {
            const dest = new Set(rows.map(x => (x.d.referredTo || '').trim()).filter(Boolean)).size;
            return [[n, __t('موقوف أُحيل')], [dest, __t('جهة محال إليها')], [avg, __t('متوسط أيام التوقيف')], [n ? Math.max(...days) : 0, __t('أطول مدة توقيف')]];
        }
        return [[n, __t('موقوف أُخلي سبيله')], [avg, __t('متوسط أيام التوقيف')], [n ? Math.min(...days) : 0, __t('أقصر مدة')], [n ? Math.max(...days) : 0, __t('أطول مدة')]];
    }

    function reportPages(tab, from, to) {
        const T = REP_TABS.find(t => t.k === tab);
        const rows = reportRows(tab, from, to);
        const cols = reportColumns(tab);
        const grid = `grid-template-columns:${cols.map(c => c.w + 'fr').join(' ')};`;
        const period = !T.dated ? `${__t("حتى تاريخ")} ${fmtD(L.today())}`
            : from && to ? `${__t("خلال الفترة من")} ${fmtD(from)} ${__t("إلى")} ${fmtD(to)}` : from ? `${__t("منذ")} ${fmtD(from)}` : to ? `${__t("حتى")} ${fmtD(to)}` : __t('كل الفترات');
        const header = `<div class="rp-head"><div class="rp-logo">${BRAND.logo ? `<img src="${h(BRAND.logo)}" alt="">` : ''}<div><b>${h(BRAND.ministry)}</b><span>${h(BRAND.dept)}</span></div></div><div class="rp-date">${h(monthLabel(L.today()))}</div></div><div class="rp-gold"></div>`;
        const thead = `<div class="rp-tr rp-th" style="${grid}">${cols.map(c => `<div>${h(c.t)}</div>`).join('')}</div>`;
        const kp = reportKpis(tab, rows);
        const top = `<div class="rp-badge">${__t("قسم المواقيف")}</div><h2 class="rp-title">${h(T.title)}</h2><div class="rp-sub">${h(period)} — ${h(cnt(rows.length, __t('موقوف'), __t('موقوفين'), __t('موقوفاً')))}</div><div class="rp-bar"></div>
            <div class="rp-kpis">${kp.map((k, i) => `<div class="rp-kpi${i === 0 ? ' dark' : ''}"><b>${k[0]}</b><span>${h(k[1])}</span></div>`).join('')}</div>`;
        // توزيع الصفوف على الصفحات حسب الطول التقديري لكل صف
        const lines = x => Math.max(...cols.map((c, ci) => Math.ceil(String(c.v(x, 0)).length * 5.4 / Math.max(20, 714 * c.w / 100 - 10)) + (c.sub && c.sub(x) ? 1 : 0)));
        const chunks = [];
        let cur = [], used = 0;
        rows.forEach((x, i) => {
            const hgt = 12 + 15 * lines(x);
            if (cur.length && used + hgt > (chunks.length ? 860 : 660)) { chunks.push(cur); cur = []; used = 0; }
            cur.push(i); used += hgt;
        });
        if (cur.length || !chunks.length) chunks.push(cur);
        const total = chunks.length;
        return { count: rows.length, html: chunks.map((ids, p) => `<section class="rp">${header}
            <div class="rp-body">${p === 0 ? top : `<div class="rp-cont">${h(T.title)} — ${__t("تتمة")}</div>`}
            <div class="rp-table">${thead}${ids.length ? ids.map(i => { const x = rows[i]; return `<div class="rp-tr${i % 2 ? '' : ' alt'}" style="${grid}">${cols.map(c => `<div class="${c.right ? 'r' : ''}${c.strong ? ' s' : ''}${c.cls ? ' ' + c.cls(x) : ''}"${c.ltr ? ' dir="ltr"' : ''}>${h(String(c.v(x, i)))}${c.sub && c.sub(x) ? `<span class="rp-s2">${h(c.sub(x))}</span>` : ''}</div>`).join('')}</div>`; }).join('')
                : ("<div class=\"rp-none\">" + __t("لا توجد سجلات في هذا التقرير.") + "</div>")}</div></div>
            <div class="rp-foot"><div class="rp-gold"></div><div class="rp-foot-in"><span>${__t("قسم المواقيف")} — ${h(BRAND.dept)}</span><b>${p + 1} / ${total}</b></div></div></section>`).join('') };
    }

    function viewReports(query) {
        const tab = REP_TABS.some(t => t.k === query.tab) ? query.tab : 'current';
        const T = REP_TABS.find(t => t.k === tab);
        const today = L.today();
        const from = query.from != null ? query.from : today.slice(0, 8) + '01';
        const to = query.to != null ? query.to : today;
        const link = (o) => '#/reports?' + Object.entries(Object.assign({ tab, from, to }, o)).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
        const chips = REP_TABS.map(t => `<a class="chip${t.k === tab ? ' active' : ''}" href="${link({ tab: t.k })}">${t.t}<span class="n">${reportRows(t.k, t.dated ? from : '', t.dated ? to : '').length}</span></a>`).join('');
        const rep = reportPages(tab, T.dated ? from : '', T.dated ? to : '');
        const filters = T.dated ? `<div class="card rp-filter"><div class="grid2">
                <div class="field"><label for="rp_from">${__t("من تاريخ")}</label><input id="rp_from" type="date" value="${h(from)}"></div>
                <div class="field"><label for="rp_to">${__t("إلى تاريخ")}</label><input id="rp_to" type="date" value="${h(to)}"></div></div>
                <div class="btn-row"><a class="btn small ghost" href="${link({ from: today.slice(0, 8) + '01', to: today })}">${__t("هذا الشهر")}</a><a class="btn small ghost" href="${link({ from: '', to: '' })}">${__t("كل الفترات")}</a></div></div>` : '';
        shell(`<div class="rp-controls"><div class="chips">${chips}</div>${filters}
            <div class="btn-row" style="margin-bottom:12px"><button class="btn" id="rp_print">⬇ ${__t("تصدير")} PDF / ${__t("طباعة")}</button></div>
            <div class="hint" style="font-size:.78rem;color:var(--muted);margin-bottom:10px">${__t("في نافذة الطباعة اختر «حفظ كملف")} PDF». ${rep.count ? '' : __t('التقرير فارغ حالياً.')}</div></div>
            <div class="rp-wrap"><div class="rp-scale" id="rp_scale">${rep.html}</div></div>`, { nav: 'reports', title: __t('التقارير'), sub: BRAND.dept });
        const fit = () => { const s = document.getElementById('rp_scale'); if (s) s.style.zoom = Math.min(1, s.parentElement.clientWidth / 794); };
        fit();
        window.onresize = fit;
        const fEl = document.getElementById('rp_from'), tEl = document.getElementById('rp_to');
        if (fEl) [fEl, tEl].forEach(el => el.addEventListener('change', () => go(link({ from: fEl.value, to: tEl.value }))));
        document.getElementById('rp_print').addEventListener('click', () => {
            const old = document.title;
            document.title = `${T.title} - ${T.dated ? (from || __t('كل')) + ' - ' + (to || __t('الفترات')) : today}`;
            window.print();
            setTimeout(() => { document.title = old; }, 1500);
        });
    }

    /* ================= استيراد الموقوفين من ملف Excel ================= */
    const XNORM = t => String(t == null ? '' : t).trim().replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْـ]/g, '').replace(/\s+/g, ' ');
    // يتعرّف على العمود من عنوانه (الترتيب مهم: الأدق أولاً)
    function excelColumn(cell) {
        const t = XNORM(cell);
        if (!t) return null;
        if (/تاريخ/.test(t)) return /خروج|اخلاء/.test(t) ? 'releaseDate' : /توقيف|ايقاف|دخول/.test(t) ? 'detentionDate' : null;
        if (/مكان/.test(t) && /توقيف|احتجاز|نظاره/.test(t)) return 'detentionPlace';
        if (/مكان/.test(t) && /عمل|خدمه/.test(t)) return 'workplace';
        if (/اصدر|جهه|امر/.test(t)) return 'orderingAuthority';
        if (/ذاتي/.test(t)) return 'selfNo';
        if (/تولد|مواليد|ولاده/.test(t)) return 'birth';
        if (/سبب|مخالف|تهمه|جرم/.test(t)) return 'violation';
        if (/اسم/.test(t) && /(^|\s)(ال)?ام(\s|$)|الوالده/.test(t)) return 'motherName';
        if (/رقم/.test(t) && /توقيف/.test(t)) return 'number';
        if (/شكوي|وارد/.test(t)) return 'complaintNo';
        if (/مده/.test(t)) return 'proposedDays';
        if (/اسم/.test(t)) return 'name';
        return null;
    }
    // التاريخ: رقم تاريخ Excel، أو نص يوم/شهر/سنة، أو سنة-شهر-يوم → سنة-شهر-يوم
    function excelDate(v) {
        if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
        const s = normDigits(String(v == null ? '' : v)).trim();
        const m = s.match(/(\d{1,4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,4})/);
        if (!m) return '';
        let y, mo, d;
        if (m[1].length === 4) { y = +m[1]; mo = +m[2]; d = +m[3]; } else { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
        if (mo > 12 && d <= 12) [d, mo] = [mo, d];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    function parseExcelRows(rows) {
        let start = 0, map = null;
        for (let i = 0; i < Math.min(15, rows.length); i++) {
            const m = {};
            (rows[i] || []).forEach((c, j) => { const k = excelColumn(c); if (k && m[k] == null) m[k] = j; });
            if (Object.keys(m).length >= 3 && m.name != null) { map = m; start = i + 1; break; }
        }
        if (!map) return { map: null, items: [] };
        const val = (r, k) => (map[k] == null ? '' : r[map[k]]);
        const txt = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
        const items = [];
        rows.slice(start).forEach(r => {
            if (!r || !txt(val(r, 'name'))) return;
            const birthRaw = val(r, 'birth');
            const birth = typeof birthRaw === 'number' && birthRaw > 20000 ? (excelDate(birthRaw) || '').split('-').reverse().join('/') : normDigits(txt(birthRaw));
            items.push({
                name: txt(val(r, 'name')), motherName: txt(val(r, 'motherName')), birth,
                selfNo: L.normNumber(txt(val(r, 'selfNo'))), number: L.normNumber(txt(val(r, 'number'))),
                complaintNo: normDigits(txt(val(r, 'complaintNo'))),
                violation: txt(val(r, 'violation')), workplace: txt(val(r, 'workplace')), detentionPlace: txt(val(r, 'detentionPlace')),
                orderingAuthority: txt(val(r, 'orderingAuthority')),
                detentionDate: excelDate(val(r, 'detentionDate')), releaseDate: excelDate(val(r, 'releaseDate')),
                proposedDays: parseInt(normDigits(txt(val(r, 'proposedDays'))), 10) || 0
            });
        });
        return { map, items };
    }
    const EXCEL_LABELS = { name: 'الاسم الثلاثي', motherName: 'اسم الأم', selfNo: 'الرقم الذاتي', birth: 'التولد', violation: 'سبب التوقيف', detentionDate: 'تاريخ التوقيف', releaseDate: 'تاريخ الخروج', orderingAuthority: 'الجهة التي أصدرت التوقيف', workplace: 'مكان العمل', detentionPlace: 'مكان التوقيف', number: 'رقم التوقيف', complaintNo: 'رقم الشكوى', proposedDays: 'المدة المقترحة' };
    const dupKey = d => (d.selfNo ? 'n:' + L.normNumber(d.selfNo) : 'x:' + XNORM(d.name)) + '|' + (d.detentionDate || '');
    // السجل غير مكتمل: ينقصه رقم التوقيف، أو المدة المقترحة لموقوف ما زال موقوفاً
    const missingOf = d => [!d.number ? __t('رقم التوقيف') : '', !(parseInt(d.proposedDays, 10) > 0) && !d.releaseDate && !d.referredTo ? __t('المدة المقترحة') : '', !d.detentionDate ? __t('تاريخ التوقيف') : ''].filter(Boolean);

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
        if (parts[0] === 'reports') return viewReports(query);
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
            root.innerHTML = `<div class="wrap"><div class="card empty"><div class="big">⚠</div><h2>${__t("تعذّر تهيئة التخزين")}</h2><p>${h(e.message)}</p></div></div>`;
            return;
        }
        if (S.pin) showLock(); else route();
        // حماية البيانات من الحذف التلقائي عند امتلاء ذاكرة الهاتف
        if (navigator.storage && navigator.storage.persisted) {
            navigator.storage.persisted().then(p => { if (!p) Storage.requestPersistence(); }).catch(() => {});
        }
        if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
            // عند وصول نسخة جديدة من التطبيق: إعادة تحميل الصفحة مرة واحدة لتظهر فوراً
            let reloaded = false;
            const hadController = !!navigator.serviceWorker.controller;
            navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
            navigator.serviceWorker.register('sw.js').catch(() => { /* اختياري */ });
        }
    })();
})();
