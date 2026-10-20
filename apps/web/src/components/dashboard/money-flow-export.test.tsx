// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import '../../styles.css';
import { download, flowPng, standaloneSvg, svgToPng } from './money-flow-export.ts';

async function drawn(): Promise<SVGSVGElement> {
  const screen = await render(
    <svg width={200} height={100} data-testid="flow">
      <rect width={50} height={20} className="fill-blue" />
      <text x={10} y={50} className="fill-fg text-[12px] font-medium">
        Gaji<tspan dx={4}>71%</tspan>
      </text>
    </svg>,
  );
  return screen.getByTestId('flow').element() as unknown as SVGSVGElement;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('money flow export', () => {
  it('copies computed paint and fonts into attributes, without classes or styles', async () => {
    const markup = standaloneSvg(await drawn(), '#141414');
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markup).toContain('width="200"');
    expect(markup).toContain('<rect width="100%" height="100%" fill="#141414"');
    expect(markup).toMatch(/<rect width="50" height="20" fill="rgb\(/);
    expect(markup).toMatch(/font-size="12px"/);
    expect(markup).not.toContain('class=');
    expect(markup).not.toContain('style=');
  });

  it('paints the SVG into a PNG at twice its size', async () => {
    const png = await flowPng(await drawn(), '#141414');
    expect(png.type).toBe('image/png');
    const bitmap = await createImageBitmap(png);
    expect([bitmap.width, bitmap.height]).toEqual([400, 200]);
    const small = await svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', 10, 10, 1);
    expect((await createImageBitmap(small)).width).toBe(10);
  });

  it('downloads through a temporary link and frees the URL afterwards', () => {
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('arus-uang.png');
      expect(this.href).toMatch(/^blob:/);
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    download(new Blob(['x'], { type: 'image/png' }), 'arus-uang.png');
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledOnce();
  });
});
