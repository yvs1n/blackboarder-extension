import qrcode from 'qrcode-generator';

/**
 * A QR code as an SVG string: dark squares on a light background with the standard 4-module
 * quiet zone, so phone cameras read it reliably. Used for the phone pairing link.
 */
export function qrSvg(text: string, opts: { dark?: string; light?: string; label?: string } = {}): string {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const size = n + quiet * 2;
  const dark = opts.dark || '#18181b';
  const light = opts.light || '#ffffff';
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  const label = String(opts.label || 'QR code').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${label}"><rect width="${size}" height="${size}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
