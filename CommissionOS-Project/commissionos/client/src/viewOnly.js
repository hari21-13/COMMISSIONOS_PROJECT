// View-only / limited-edit mode for non-admin sign-ins.
// The REAL protection is on the server (server/src/lib/permissions.js).
// This file only hides the controls that would be refused anyway.

// words that mean "this changes data"
const WRITE_WORDS = /\b(add|new|create|edit|delete|remove|save|update|approve|reject|lock|unlock|calculate|recalculat\w*|import|upload|reset|restore|record|mark|assign|submit|send|invite|resend|resolve|reverse|request|generate|confirm|post|clear|activate|reassign|batch|reconcile|apply|toggle|suspend|rename|change|set|subscribe|pay|qr)\b|^\+|Save |Reset/i;
// words that are always fine (read / export)
const SAFE_WORDS = /\b(pdf|csv|excel|export|download|print|preview|view|open|close|cancel|history|copy|back|continue|sign ?out|contact|decline)\b/i;
// icon-only buttons: lucide adds these classes to the <svg>
const WRITE_ICONS = ['lucide-pen', 'lucide-edit', 'lucide-trash', 'lucide-plus', 'lucide-lock', 'lucide-unlock', 'lucide-user-x', 'lucide-user-check', 'lucide-rotate-ccw', 'lucide-refresh'];

const isWriteButton = (btn, level) => {
  if (btn.closest('[data-allow="all"]')) return false;
  if (level === 'employee' && btn.closest('[data-allow~="employee"]')) return false;
  if (level === 'user' && btn.closest('[data-allow~="user"]')) return false;
  const text = (btn.textContent || '').trim();
  const label = `${text} ${btn.getAttribute('title') || ''} ${btn.getAttribute('aria-label') || ''}`;
  if (btn.getAttribute('type') === 'submit') return !SAFE_WORDS.test(label);
  if (SAFE_WORDS.test(label)) return false;
  if (WRITE_WORDS.test(label)) return true;
  if (!text) {
    const svg = btn.querySelector('svg');
    const cls = svg ? String(svg.getAttribute('class') || '') : '';
    return WRITE_ICONS.some((w) => cls.includes(w));
  }
  return false;
};

// "Subscribe to <plan>" is the one purchase a view-only user may make
const isPurchase = (btn) => /subscribe|activate|pay |qr/i.test(btn.textContent || '');

export function applyViewOnly(root, level) {
  if (!root) return;
  if (level === 'admin') return;
  root.querySelectorAll('button').forEach((btn) => {
    let hide = isWriteButton(btn, level);
    if (hide && level === 'user' && root.dataset.module === 'billing' && isPurchase(btn)) hide = false;
    if (hide) {
      btn.setAttribute('data-vo-hidden', '1');
      btn.style.display = 'none';
    }
  });
  // forms: make fields read-only (except opted-in forms)
  root.querySelectorAll('form').forEach((form) => {
    const allowed = form.closest('[data-allow="all"]') || form.closest(`[data-allow~="${level}"]`) || (form.dataset.allow || '').split(' ').includes(level) || form.dataset.allow === 'all';
    if (allowed) return;
    form.setAttribute('data-vo-form', '1');
    form.querySelectorAll('input, select, textarea').forEach((el) => {
      if (el.type === 'search' || el.dataset.allow === 'all') return;
      el.setAttribute('disabled', 'true');
    });
  });
  // selects/inputs inside table rows (e.g. a status dropdown)
  root.querySelectorAll('tbody select, tbody input:not([type="search"]), tbody textarea').forEach((el) => {
    if (el.closest('[data-allow="all"]') || el.closest(`[data-allow~="${level}"]`)) return;
    el.setAttribute('disabled', 'true');
  });
}

export function startViewOnlyGuard(root, level) {
  if (!root || level === 'admin') return () => {};
  const run = () => applyViewOnly(root, level);
  run();
  const obs = new MutationObserver(run);
  obs.observe(root, { childList: true, subtree: true });
  return () => obs.disconnect();
}