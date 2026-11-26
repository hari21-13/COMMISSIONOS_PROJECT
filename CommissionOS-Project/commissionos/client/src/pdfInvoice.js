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

export const pdfSafe = (t) =>
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

export const wrapText = (text, maxChars) => {
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

export const inr = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------- PDF writer (text, rectangles, lines, one JPEG)
export function buildPdfBytes(ops, logo) {
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
      `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`,
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

// ---------------------------------------------------------------- logo (browser only): any image -> JPEG bytes
export async function logoToJpeg(dataUrl, size = 160) {
  if (!dataUrl || typeof document === 'undefined') return null;
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; // transparent logos get a white backing
    ctx.fillRect(0, 0, size, size);
    const scale = Math.min(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    const jpeg = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    const bin = atob(jpeg);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return { bytes, width: size, height: size };
  } catch (err) {
    return null;
  }
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
export function subscriptionInvoiceOps(inv, org, logo, support = {}) {
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


// ---------------------------------------------------------------- 1b) subscription RECEIPT (certificate style, red + black)
export function subscriptionReceiptOps(inv, org, logo, support = {}) {
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

// ---------------------------------------------------------------- 2) adjustment invoice (Disputes & Adjustments)
export function adjustmentInvoiceOps(adj, org, logo) {
  const k = kit(org, logo);
  const { T, R, L } = k;
  k.header({ title: 'ADJUSTMENT INVOICE', subtitle: 'Authorised commission adjustment', id: adj.id, date: adj.date, status: adj.status });

  k.party(40, 152, 'ISSUED TO', adj.employee, [`Statement: ${adj.statementId || '-'}`, `Adjustment type: ${adj.type || '-'}`]);
  k.party(340, 152, 'ISSUED BY', (org && (org.legalEntity || org.name)) || '', orgLines(org));

  k.tableHead(262, [
    { x: 52, label: 'DESCRIPTION' }, { x: 330, label: 'STATEMENT' }, { x: 548, label: 'AMOUNT', align: 'right' },
  ]);
  T(52, 310, adj.type || 'Adjustment', 11, { bold: true });
  wrapText(adj.reason || '-', 52).slice(0, 4).forEach((l, i) => T(52, 326 + i * 12, l, 9, { color: '#52525B' }));
  T(330, 310, adj.statementId || '-', 10);
  T(548, 310, inr(adj.amount), 10, { bold: true, align: 'right' });
  L(40, 555, 380, '#E4E4E7');

  R(330, 400, 225, 36, k.primary);
  R(330, 400, 4, 36, k.accent);
  T(346, 423, 'NET ADJUSTMENT', 11, { bold: true, color: k.onPrimary });
  T(540, 423, inr(adj.amount), 12.5, { bold: true, color: k.onPrimary, align: 'right' });

  T(40, 400, 'REQUESTED BY', 8.5, { bold: true, color: k.accent });
  T(40, 416, adj.requestedBy || '-', 10);
  T(40, 440, 'AUDIT NOTE', 8.5, { bold: true, color: k.accent });
  wrapText('The locked commission statement is never edited; this adjustment is recorded separately and applied to the next payout.', 60)
    .forEach((l, i) => T(40, 455 + i * 12, l, 9, { color: '#52525B' }));
  k.footer();
  return k.ops;
}

// ---------------------------------------------------------------- 3) dispute invoice (case summary with amounts)
export function disputeInvoiceOps(d, org, logo) {
  const k = kit(org, logo);
  const { T, R, L } = k;
  k.header({ title: 'DISPUTE INVOICE', subtitle: 'Commission dispute case', id: d.id, date: d.createdDate, status: d.status });

  k.party(40, 152, 'RAISED BY', d.employee, [`Statement: ${d.statementId || '-'}`, `Transaction: ${d.transactionId || '-'}`]);
  k.party(340, 152, 'HANDLED BY', d.assignedTo || '-', [(org && (org.legalEntity || org.name)) || '']);

  const diff = Number(d.claimedAmount || 0) - Number(d.currentAmount || 0);
  k.tableHead(262, [
    { x: 52, label: 'DESCRIPTION' }, { x: 380, label: 'CURRENT', align: 'right' },
    { x: 462, label: 'EXPECTED', align: 'right' }, { x: 548, label: 'DIFFERENCE', align: 'right' },
  ]);
  T(52, 310, 'Commission under dispute', 11, { bold: true });
  wrapText(d.reason || '-', 46).slice(0, 3).forEach((l, i) => T(52, 326 + i * 12, l, 9, { color: '#52525B' }));
  T(380, 310, inr(d.currentAmount), 10, { align: 'right' });
  T(462, 310, inr(d.claimedAmount), 10, { align: 'right' });
  T(548, 310, inr(diff), 10, { bold: true, align: 'right' });
  L(40, 555, 366, '#E4E4E7');

  R(330, 384, 225, 36, k.primary);
  R(330, 384, 4, 36, k.accent);
  T(346, 407, 'AMOUNT IN DISPUTE', 10.5, { bold: true, color: k.onPrimary });
  T(540, 407, inr(Math.max(diff, 0)), 12.5, { bold: true, color: k.onPrimary, align: 'right' });
  T(40, 392, 'SUPPORTING DOCUMENT', 8.5, { bold: true, color: k.accent });
  T(40, 408, d.document || '-', 10);

  T(40, 452, 'DISCUSSION TIMELINE', 8.5, { bold: true, color: k.accent });
  let y = 470;
  (Array.isArray(d.comments) ? d.comments : []).slice(0, 6).forEach((c) => {
    T(40, y, `${c.author || ''}  -  ${c.time || ''}`, 9, { bold: true });
    wrapText(c.text || '', 100).slice(0, 2).forEach((l, i) => T(40, y + 12 + i * 11, l, 9, { color: '#52525B' }));
    y += 38;
  });
  k.footer();
  return k.ops;
}

// ---------------------------------------------------------------- browser download
export async function downloadPdf(filename, ops, org) {
  const logo = org && org.logoDataUrl ? await logoToJpeg(org.logoDataUrl) : null;
  const bytes = buildPdfBytes(typeof ops === 'function' ? ops(logo) : ops, logo);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}