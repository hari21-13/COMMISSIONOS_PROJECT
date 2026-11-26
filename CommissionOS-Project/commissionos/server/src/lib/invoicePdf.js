// Server copy: branded invoice PDF for e-mail attachments.
const zlib = require('zlib');
// Branded invoice PDFs (subscription invoice, adjustment invoice, dispute invoice).
// Pure JavaScript, no libraries. Uses the organisation's LOGO and THEME COLOURS
// (Organisation Settings -> primary colour / accent colour), defaults: black + red.

const A4_W = 595;
const A4_H = 842;
const DEFAULT_PRIMARY = '#0A0A0B';
const DEFAULT_ACCENT = '#DC2626';

// ---------------------------------------------------------------- helpers
const validHex = (h, fallback) => (/^#[0-9a-fA-F]{6}$/.test(String(h || '')) ? h : fallback);
const rgb = (hex) => [0, 2, 4].map((i) => (parseInt(hex.slice(1).slice(i, i + 2), 16) / 255).toFixed(3));

// light tint of a colour (mix with white) - used for table headers / boxes
const tint = (hex, amount = 0.9) => {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(1).slice(i, i + 2), 16));
  const mixed = c.map((v) => Math.round(v + (255 - v) * amount));
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

// is the colour dark? (decides white or black text on top of it)
const isDark = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1).slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 < 150;
};

const pdfSafe = (t) =>
  String(t ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

// approximate Helvetica text width (points) - good enough for right alignment
const textWidth = (text, size, bold) => {
  let w = 0;
  for (const ch of String(text ?? '')) {
    if (ch === ' ') w += 0.278;
    else if (/[0-9]/.test(ch)) w += 0.556;
    else if (/[ilj.,:;'|!]/.test(ch)) w += 0.26;
    else if (/[mwMW@%]/.test(ch)) w += bold ? 0.9 : 0.85;
    else if (/[A-Z]/.test(ch)) w += bold ? 0.72 : 0.667;
    else if (/[a-z]/.test(ch)) w += bold ? 0.58 : 0.52;
    else w += 0.5;
  }
  return w * size;
};

const wrapText = (text, maxChars) => {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  words.forEach((w) => {
    if ((`${cur} ${w}`).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = `${cur} ${w}`.trim();
  });
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
};

const inr = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------- PDF writer (text, rectangles, lines, one JPEG)
function buildPdfBytes(ops, logo) {
  const enc = new TextEncoder();
  let content = '';
  ops.forEach((o) => {
    if (o.t === 'rect') {
      content += `${rgb(o.color).join(' ')} rg ${o.x} ${A4_H - o.y - o.h} ${o.w} ${o.h} re f\n`;
    } else if (o.t === 'line') {
      content += `${rgb(o.color || '#D4D4D8').join(' ')} RG ${o.width || 0.8} w ${o.x1} ${A4_H - o.y} m ${o.x2} ${A4_H - o.y} l S\n`;
    } else if (o.t === 'text') {
      const x = o.align === 'right' ? o.x - textWidth(o.text, o.size, o.bold) : o.align === 'center' ? o.x - textWidth(o.text, o.size, o.bold) / 2 : o.x;
      content += `BT /${o.bold ? 'F2' : 'F1'} ${o.size} Tf ${rgb(o.color || '#09090B').join(' ')} rg ${x.toFixed(1)} ${A4_H - o.y} Td (${pdfSafe(o.text)}) Tj ET\n`;
    } else if (o.t === 'image' && logo) {
      content += `q ${o.w} 0 0 ${o.h} ${o.x} ${A4_H - o.y - o.h} cm /Im1 Do Q\n`;
    }
  });

  const parts = []; // Uint8Array chunks
  const offsets = [];
  let length = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body.forEach(push);
    push('\nendobj\n');
  };

  const hasLogo = Boolean(logo && logo.bytes);
  push('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${hasLogo ? ' /XObject << /Im1 7 0 R >>' : ''} >> >>`);
  const contentBytes = enc.encode(content);
  object(4, [`<< /Length ${contentBytes.length} >>\nstream\n`, contentBytes, '\nendstream']);
  object(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  object(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  let total = 6;
  if (hasLogo) {
    object(7, [
      `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace ${logo.colorSpace || '/DeviceRGB'} /BitsPerComponent 8 /Filter /${logo.filter || 'DCTDecode'} /Length ${logo.bytes.length} >>\nstream\n`,
      logo.bytes,
      '\nendstream',
    ]);
    total = 7;
  }
  const xref = length;
  let table = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i += 1) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  const out = new Uint8Array(length);
  let pos = 0;
  parts.forEach((p) => { out.set(p, pos); pos += p.length; });
  return out;
}

// ---------------------------------------------------------------- layout kit
function kit(org, logo) {
  const primary = validHex(org && org.primaryColor, DEFAULT_PRIMARY);
  const accent = validHex(org && org.accentColor, DEFAULT_ACCENT);
  const onPrimary = isDark(primary) ? '#FFFFFF' : '#09090B';
  const onPrimarySoft = isDark(primary) ? '#D4D4D8' : '#52525B';
  const ops = [];
  const T = (x, y, text, size = 10, extra = {}) => ops.push({ t: 'text', x, y, text, size, ...extra });
  const R = (x, y, w, h, color) => ops.push({ t: 'rect', x, y, w, h, color });
  const L = (x1, x2, y, color, width) => ops.push({ t: 'line', x1, x2, y, color, width });

  const orgName = (org && org.name) || 'Auron CommissionOS';
  const initials = orgName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  function header({ title, subtitle, id, date, status }) {
    R(0, 0, A4_W, 118, primary);
    R(0, 118, A4_W, 5, accent); // accent stripe in the brand colour
    // logo / monogram
    if (logo && logo.bytes) {
      R(40, 28, 62, 62, '#FFFFFF');
      ops.push({ t: 'image', x: 43, y: 31, w: 56, h: 56 });
    } else {
      R(40, 28, 62, 62, accent);
      T(71, 67, initials || 'AC', 24, { bold: true, color: '#FFFFFF', align: 'center' });
    }
    T(114, 52, orgName, 16, { bold: true, color: onPrimary });
    T(114, 70, (org && org.tagline) || 'Commission management', 9.5, { color: onPrimarySoft });
    if (subtitle) T(114, 86, subtitle, 9, { color: onPrimarySoft });
    T(555, 46, title, 20, { bold: true, color: onPrimary, align: 'right' });
    T(555, 66, id, 11, { bold: true, color: accent === primary ? onPrimary : '#FFFFFF', align: 'right' });
    T(555, 82, `Date: ${date}`, 9.5, { color: onPrimarySoft, align: 'right' });
    if (status) T(555, 98, `Status: ${String(status).toUpperCase()}`, 9.5, { bold: true, color: '#FFFFFF', align: 'right' });
  }

  function party(x, y, label, name, lines) {
    T(x, y, label, 8.5, { bold: true, color: accent });
    T(x, y + 17, name, 11.5, { bold: true });
    lines.filter(Boolean).forEach((l, i) => T(x, y + 33 + i * 13, l, 9.5, { color: '#52525B' }));
  }

  function tableHead(y, cols) {
    R(40, y, 515, 26, tint(accent, 0.9));
    R(40, y, 4, 26, accent);
    cols.forEach((c) => T(c.x, y + 17, c.label, 8.5, { bold: true, color: '#3F3F46', align: c.align }));
  }

  function footer(extra) {
    L(40, 555, 770, accent, 1.2);
    T(40, 788, extra || 'This is a computer-generated document and does not require a signature.', 8.5, { color: '#71717A' });
    T(40, 802, `${orgName}${org && org.address ? `  |  ${org.address}` : ''}`.slice(0, 110), 8.5, { color: '#71717A' });
    R(0, 832, A4_W, 10, primary);
    R(0, 832, 140, 10, accent);
  }

  return { ops, T, R, L, header, party, tableHead, footer, primary, accent, orgName, onPrimary };
}

const orgLines = (org) => [
  ...wrapText((org && org.address) || '', 46),
  `GSTIN: ${(org && org.gstin) || '-'}   PAN: ${(org && org.pan) || '-'}`,
];

// ---------------------------------------------------------------- 1) subscription invoice (paid by admin / user)
function subscriptionInvoiceOps(inv, org, logo, support = {}) {
  const k = kit(org, logo);
  const { T, R, L } = k;
  k.header({ title: 'TAX INVOICE', subtitle: 'SaaS subscription', id: inv.id, date: inv.date, status: inv.status });

  k.party(40, 152, 'BILLED TO', inv.payerName || (org && (org.legalEntity || org.name)) || '', [inv.payerEmail, ...orgLines(org)]);
  k.party(340, 152, 'FROM', 'Auron CommissionOS', [support.email, support.phone, support.hours]);

  k.tableHead(262, [
    { x: 52, label: 'DESCRIPTION' }, { x: 380, label: 'BASE', align: 'right' },
    { x: 462, label: 'GST 18%', align: 'right' }, { x: 548, label: 'TOTAL', align: 'right' },
  ]);
  T(52, 310, inv.plan, 11, { bold: true });
  T(52, 325, 'Auron CommissionOS subscription', 9, { color: '#71717A' });
  T(380, 310, inr(inv.subtotal), 10, { align: 'right' });
  T(462, 310, inr(inv.gst), 10, { align: 'right' });
  T(548, 310, inr(inv.total), 10, { bold: true, align: 'right' });
  L(40, 555, 342, '#E4E4E7');

  R(330, 366, 225, 78, '#FAFAFA');
  T(345, 386, 'Subtotal', 10, { color: '#52525B' });
  T(540, 386, inr(inv.subtotal), 10, { align: 'right' });
  T(345, 404, 'GST (18%)', 10, { color: '#52525B' });
  T(540, 404, inr(inv.gst), 10, { align: 'right' });
  R(330, 414, 225, 32, k.primary);
  R(330, 414, 4, 32, k.accent);
  T(346, 435, 'TOTAL PAID', 11, { bold: true, color: k.onPrimary });
  T(540, 435, inr(inv.total), 12, { bold: true, color: k.onPrimary, align: 'right' });

  T(40, 386, 'PAYMENT METHOD', 8.5, { bold: true, color: k.accent });
  wrapText(inv.method || '-', 38).forEach((l, i) => T(40, 402 + i * 13, l, 10));
  if (inv.razorpayPaymentId) {
    T(40, 440, 'RAZORPAY PAYMENT ID', 8.5, { bold: true, color: k.accent });
    T(40, 455, inv.razorpayPaymentId, 10);
  }
  k.footer(`This is a computer-generated invoice and does not require a signature.${support.email ? `  Questions? ${support.email}` : ''}`);
  return k.ops;
}


function subscriptionReceiptOps(inv, org, logo, support = {}) {
  const k = kit(org, logo);
  const { ops, T, R, L, primary, accent, onPrimary, orgName } = k;
  const cx = A4_W / 2;
  const soft = isDark(primary) ? '#D4D4D8' : '#52525B';
  // double frame (black + red) with corner blocks
  R(18, 18, 559, 806, primary);
  R(22, 22, 551, 798, '#FFFFFF');
  R(28, 28, 539, 786, accent);
  R(31, 31, 533, 780, '#FFFFFF');
  [[18, 18], [551, 18], [18, 798], [551, 798]].forEach(([x, y]) => { R(x, y, 26, 26, primary); R(x + 6, y + 6, 14, 14, accent); });
  // brand band
  R(31, 31, 533, 140, primary);
  R(31, 171, 533, 5, accent);
  const initials = orgName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  if (logo && logo.bytes) {
    R(cx - 31, 44, 62, 62, '#FFFFFF');
    ops.push({ t: 'image', x: cx - 28, y: 47, w: 56, h: 56 });
  } else {
    R(cx - 31, 44, 62, 62, accent);
    T(cx, 85, initials || 'AC', 24, { bold: true, color: '#FFFFFF', align: 'center' });
  }
  T(cx, 128, orgName, 15, { bold: true, color: onPrimary, align: 'center' });
  T(cx, 144, (org && org.tagline) || 'Commission management', 9, { color: soft, align: 'center' });

  const receiptNo = `RCPT-${String(inv.id || '').replace(/^INV-?/i, '')}`;
  T(56, 204, `Receipt No: ${receiptNo}`, 9.5, { bold: true, color: '#3F3F46' });
  T(539, 204, `Date: ${inv.date || ''}`, 9.5, { bold: true, color: '#3F3F46', align: 'right' });

  T(cx, 256, 'PAYMENT RECEIPT', 26, { bold: true, color: primary, align: 'center' });
  L(190, 405, 270, accent, 2);
  T(cx, 288, 'SUBSCRIPTION CONFIRMATION', 9, { bold: true, color: accent, align: 'center' });

  T(cx, 326, 'This is to certify that', 11, { color: '#52525B', align: 'center' });
  T(cx, 356, inv.payerName || inv.payerEmail || 'Valued Customer', 21, { bold: true, color: primary, align: 'center' });
  if (inv.payerEmail) T(cx, 374, inv.payerEmail, 10, { color: '#71717A', align: 'center' });
  T(cx, 404, 'has successfully subscribed to the', 11, { color: '#52525B', align: 'center' });
  T(cx, 432, `${inv.plan || ''}`, 18, { bold: true, color: accent, align: 'center' });
  T(cx, 454, 'of Auron CommissionOS, and the payment has been received in full.', 10.5, { color: '#52525B', align: 'center' });

  R(150, 480, 295, 66, primary);
  R(150, 480, 5, 66, accent);
  T(cx, 502, 'AMOUNT PAID (INCL. GST)', 8.5, { bold: true, color: soft, align: 'center' });
  T(cx, 532, inr(inv.total), 22, { bold: true, color: onPrimary, align: 'center' });

  const rows = [
    ['Invoice number', inv.id],
    ['Subscription plan', inv.plan],
    ['Base amount', inr(inv.subtotal)],
    ['GST (18%)', inr(inv.gst)],
    ['Payment method', inv.method || '-'],
    ['Payment reference', inv.razorpayPaymentId || (inv.source === 'free' ? 'Free first subscription' : '-')],
  ];
  rows.forEach(([label, value], i) => {
    const y = 570 + i * 24;
    if (i % 2 === 0) R(64, y, 467, 24, tint(accent, 0.93));
    R(64, y, 3, 24, accent);
    T(78, y + 16, label, 9.5, { color: '#52525B' });
    T(520, y + 16, String(value ?? '-').slice(0, 48), 9.5, { bold: true, align: 'right' });
  });

  L(80, 240, 752, primary, 1);
  T(160, 766, 'Authorised Signatory', 9, { bold: true, color: '#3F3F46', align: 'center' });
  L(355, 515, 752, primary, 1);
  T(435, 766, 'Customer Support', 9, { bold: true, color: '#3F3F46', align: 'center' });

  T(cx, 790, 'This is a computer-generated receipt and does not require a physical signature.', 8, { color: '#71717A', align: 'center' });
  T(cx, 802, [orgName, support.email, support.phone].filter(Boolean).join('  |  ').slice(0, 100), 8, { color: '#71717A', align: 'center' });
  return ops;
}

// ---------------------------------------------------------------- logo: data URL (JPEG or PNG) -> PDF image
function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), comps: buf[i + 9] };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function decodePng(buf, maxSide = 200) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8; let width; let height; let bitDepth; let colorType; let interlace; let plte = null; let trns = null; const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!width || bitDepth !== 8 || interlace !== 0 || !channels) return null; // unusual PNGs fall back to the monogram
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  // scale down (nearest) and flatten transparency onto white
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = Math.floor(y / scale) * stride + Math.floor(x / scale) * channels;
      let r; let g; let b; let al = 255;
      if (colorType === 0) { r = g = b = px[o]; }
      else if (colorType === 2) { r = px[o]; g = px[o + 1]; b = px[o + 2]; }
      else if (colorType === 3) { const idx = px[o]; r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2]; if (trns && idx < trns.length) al = trns[idx]; }
      else if (colorType === 4) { r = g = b = px[o]; al = px[o + 1]; }
      else { r = px[o]; g = px[o + 1]; b = px[o + 2]; al = px[o + 3]; }
      const k = (y * w + x) * 3;
      rgb[k] = Math.round((r * al + 255 * (255 - al)) / 255);
      rgb[k + 1] = Math.round((g * al + 255 * (255 - al)) / 255);
      rgb[k + 2] = Math.round((b * al + 255 * (255 - al)) / 255);
    }
  }
  return { bytes: new Uint8Array(zlib.deflateSync(rgb)), width: w, height: h, colorSpace: '/DeviceRGB', filter: 'FlateDecode' };
}

function logoFromDataUrl(dataUrl) {
  try {
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUrl || ''));
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    if (/png/i.test(m[1])) return decodePng(buf);
    const info = jpegInfo(buf);
    if (!info || (info.comps !== 3 && info.comps !== 1)) return null;
    return { bytes: new Uint8Array(buf), width: info.width, height: info.height, colorSpace: info.comps === 1 ? '/DeviceGray' : '/DeviceRGB', filter: 'DCTDecode' };
  } catch (err) {
    return null; // never block an e-mail because of a logo
  }
}

// the finished invoice as a Buffer, ready to attach to an e-mail
function subscriptionInvoicePdf(inv, org, support) {
  const logo = logoFromDataUrl(org && org.logoDataUrl);
  return Buffer.from(buildPdfBytes(subscriptionInvoiceOps(inv, org, logo, support), logo));
}

// the payment receipt (red + black certificate style) as a Buffer, ready to attach to an e-mail
function subscriptionReceiptPdf(inv, org, support) {
  const logo = logoFromDataUrl(org && org.logoDataUrl);
  return Buffer.from(buildPdfBytes(subscriptionReceiptOps(inv, org, logo, support), logo));
}

module.exports = { subscriptionInvoicePdf, logoFromDataUrl, subscriptionReceiptPdf };