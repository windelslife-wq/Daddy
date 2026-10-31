/**
 * Clipboard helper with a legacy fallback.
 *
 * navigator.clipboard only exists in secure contexts, and the local dev preview is
 * plain HTTP, so the fallback keeps "copy" working there instead of silently doing
 * nothing.
 */
export async function copyText(value) {
  const text = String(value ?? '');
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
