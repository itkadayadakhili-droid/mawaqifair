// قارئ ملفات Excel (xlsx) و CSV بدون إنترنت وبدون مكتبات خارجية.
// window.readSheet(file) → Promise<Array<Array<string|number>>> (صفوف الورقة الأولى)
(function () {
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  async function inflate(data) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([data]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  // يقرأ فهرس ملف ZIP ويعيد دالة لاستخراج أي ملف داخله كنص
  function openZip(buf) {
    const b = new Uint8Array(buf);
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('الملف ليس ملف Excel حديثاً (xlsx)');
    const count = u16(b, e + 10);
    let p = u32(b, e + 16);
    const files = {};
    const dec = new TextDecoder('utf-8');
    for (let k = 0; k < count && u32(b, p) === 0x02014b50; k++) {
      const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), off = u32(b, p + 42);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      files[name] = { method, csize, off };
      p += 46 + nlen + xlen + clen;
    }
    return async (name) => {
      const f = files[name];
      if (!f) return null;
      const start = f.off + 30 + u16(b, f.off + 26) + u16(b, f.off + 28);
      const raw = b.subarray(start, start + f.csize);
      return dec.decode(f.method === 8 ? await inflate(raw) : raw);
    };
  }

  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const tags = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const colIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  // نص خلية نصية مع تجاهل التلميحات الصوتية
  const textOf = (node) => tags(node, 't').filter((t) => !t.closest || !t.parentNode || t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('');

  async function readXlsx(buf) {
    const get = openZip(buf);
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const first = tags(xml(wb), 'sheet')[0];
      const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      const rel = tags(xml(rels), 'Relationship').find((r) => r.getAttribute('Id') === rid);
      if (rel) { const t = rel.getAttribute('Target').replace(/^\//, ''); sheetPath = t.startsWith('xl/') ? t : 'xl/' + t; }
    }
    const ssText = await get('xl/sharedStrings.xml');
    const shared = ssText ? tags(xml(ssText), 'si').map(textOf) : [];
    const sheet = await get(sheetPath);
    if (!sheet) throw new Error('لم أجد ورقة بيانات داخل الملف');
    const rows = [];
    tags(xml(sheet), 'row').forEach((r) => {
      const idx = parseInt(r.getAttribute('r'), 10) - 1;
      const row = [];
      let next = 0;
      tags(r, 'c').forEach((c) => {
        let ci = colIndex(c.getAttribute('r'));
        if (ci < 0) ci = next;
        next = ci + 1;
        const t = c.getAttribute('t');
        const v = tags(c, 'v')[0];
        let val = '';
        if (t === 's') val = v ? shared[parseInt(v.textContent, 10)] ?? '' : '';
        else if (t === 'inlineStr') val = textOf(c);
        else if (t === 'str' || t === 'e' || t === 'd') val = v ? v.textContent : '';
        else if (t === 'b') val = v ? (v.textContent === '1' ? 'TRUE' : 'FALSE') : '';
        else if (v) { const n = parseFloat(v.textContent); val = isFinite(n) ? n : v.textContent; }
        row[ci] = val;
      });
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      rows[isFinite(idx) && idx >= 0 ? idx : rows.length] = row;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  function readCsv(buf) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('windows-1256').decode(buf); }
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/)[0] || '';
    const sep = [';', '\t', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  window.readSheet = async function (file) {
    const name = String(file.name || '').toLowerCase();
    if (/\.xls$/.test(name)) throw new Error('صيغة xls القديمة غير مدعومة — افتح الملف في Excel واحفظه بصيغة xlsx («حفظ باسم» ← مصنف Excel)');
    const buf = await file.arrayBuffer();
    if (/\.(csv|txt)$/.test(name)) return readCsv(buf);
    return readXlsx(buf);
  };
})();
