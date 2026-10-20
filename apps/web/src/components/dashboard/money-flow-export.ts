// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Unduh sebagai PNG" / "Salin gambar" of the money flow (FR-D2) under the production CSP: the drawn SVG is cloned
 * with every computed paint and font written into presentation attributes (the page's classes do not reach an
 * image), loaded as a `data:` image (`img-src 'self' data:`), and painted on a canvas at twice its size. No `style`
 * attribute, no blob image source, nothing fetched.
 */

/** Presentation attributes copied from the computed style of every element. */
const PAINT = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity'] as const;
const FONT = ['font-family', 'font-size', 'font-weight'] as const;

/** A self-contained copy of `svg`: computed paint and fonts as attributes, a background, explicit size. */
export function standaloneSvg(svg: SVGSVGElement, background: string): string {
  const { width, height } = svg.getBoundingClientRect();
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const sources = [svg, ...svg.querySelectorAll('*')];
  const targets = [copy, ...copy.querySelectorAll('*')];
  sources.forEach((source, index) => {
    const target = targets[index] as Element;
    const computed = getComputedStyle(source);
    for (const name of PAINT) target.setAttribute(name, computed.getPropertyValue(name));
    if (source instanceof SVGTextElement || source instanceof SVGTSpanElement) {
      for (const name of FONT) target.setAttribute(name, computed.getPropertyValue(name));
    }
    target.removeAttribute('class');
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(Math.round(width)));
  copy.setAttribute('height', String(Math.round(height)));
  const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  backdrop.setAttribute('width', '100%');
  backdrop.setAttribute('height', '100%');
  backdrop.setAttribute('fill', background);
  copy.prepend(backdrop);
  return new XMLSerializer().serializeToString(copy);
}

/** The SVG painted into a PNG at `scale` × its size. */
export async function svgToPng(markup: string, width: number, height: number, scale = 2): Promise<Blob> {
  const bytes = new TextEncoder().encode(markup);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const image = new Image();
  image.src = `data:image/svg+xml;base64,${btoa(binary)}`;
  await image.decode();
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
  const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** The PNG of the drawn `svg` on `background`. */
export function flowPng(svg: SVGSVGElement, background: string): Promise<Blob> {
  const { width, height } = svg.getBoundingClientRect();
  return svgToPng(standaloneSvg(svg, background), width, height);
}

/** Saves `blob` as `filename` through a temporary link. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Some browsers read the URL after the click returns.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
