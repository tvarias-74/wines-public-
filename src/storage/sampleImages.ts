import type { CellarData, Colour, Vintage } from '../domain/types';
import { COLOUR_LABEL } from '../domain/types';
import { SAMPLE_PREFIX, setVintageImage } from '../domain/actions';
import { formatYear } from '../domain/text';
import { putImage } from './images';
import { processImageFile } from './imageProcess';

/**
 * The demo cellar gets drawn placeholder labels (clearly marked "SAMPLE"), so the label gallery has
 * something to show. They are made in the browser; nothing is downloaded.
 */

const BAND: Record<Colour | 'none', string> = {
  red: '#7a1f3d',
  white: '#b89b3c',
  rose: '#d9788f',
  orange: '#d9822b',
  none: '#6a6964',
};

function drawLabel(side: 'front' | 'back', producer: string, bottling: string, year: string, place: string, colour: Colour | undefined): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 800;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#f4ecd8';
  g.fillRect(0, 0, 600, 800);
  g.strokeStyle = BAND[colour ?? 'none'];
  g.lineWidth = 6;
  g.strokeRect(28, 28, 544, 744);
  g.lineWidth = 1.5;
  g.strokeRect(44, 44, 512, 712);
  g.fillStyle = BAND[colour ?? 'none'];
  g.fillRect(44, 330, 512, 14);
  g.textAlign = 'center';
  g.fillStyle = '#2b2118';

  const fit = (text: string, size: number, y: number, weight = '600') => {
    let s = size;
    g.font = `${weight} ${s}px Georgia, 'Times New Roman', serif`;
    while (g.measureText(text).width > 470 && s > 16) {
      s -= 2;
      g.font = `${weight} ${s}px Georgia, 'Times New Roman', serif`;
    }
    g.fillText(text, 300, y);
  };

  if (side === 'front') {
    fit(producer.toUpperCase(), 40, 150, '700');
    fit(bottling, 54, 250, '600');
    fit(year, 120, 520, '700');
    fit(place, 32, 600, '400');
    g.font = '600 22px system-ui, sans-serif';
    g.fillStyle = '#6a6964';
    g.fillText(colour ? COLOUR_LABEL[colour].toUpperCase() : 'WINE', 300, 392);
  } else {
    fit('BACK LABEL', 44, 150, '700');
    g.font = '400 26px Georgia, serif';
    g.fillStyle = '#4b4a46';
    ['Grown, vinified and bottled', 'at the estate.', '', 'Contains sulphites.', 'Serve at 16–18 °C.', '', '750 ml · 13.5% vol.'].forEach((line, i) => g.fillText(line, 300, 270 + i * 48));
  }
  g.font = '600 20px system-ui, sans-serif';
  g.fillStyle = '#b3261e';
  g.fillText('SAMPLE LABEL — NOT A REAL WINE', 300, 728);
  return c;
}

async function makeImage(id: string, canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) return false;
    const p = await processImageFile(png);
    await putImage({ id, ...p, createdAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/** Adds a front label to every demo wine, and a back label to every third one. */
export async function attachSampleLabels(data: CellarData): Promise<CellarData> {
  let next = data;
  const bottlings = new Map(data.bottlings.map((b) => [b.id, b]));
  const producers = new Map(data.producers.map((p) => [p.id, p]));
  const demo: Vintage[] = data.vintages.filter((v) => v.id.startsWith(SAMPLE_PREFIX) && !v.images);
  let n = 0;
  for (const v of demo) {
    const b = bottlings.get(v.bottlingId);
    const p = b && producers.get(b.producerId);
    if (!b || !p) continue;
    const place = [b.appellation ?? b.region, b.country].filter(Boolean).join(' · ');
    const frontId = `${SAMPLE_PREFIX}img-${v.id}-front`;
    if (await makeImage(frontId, drawLabel('front', p.name, b.name, formatYear(v.year), place, b.colour))) next = setVintageImage(next, v.id, 'front', frontId);
    if (n++ % 3 === 0) {
      const backId = `${SAMPLE_PREFIX}img-${v.id}-back`;
      if (await makeImage(backId, drawLabel('back', p.name, b.name, formatYear(v.year), place, b.colour))) next = setVintageImage(next, v.id, 'back', backId);
    }
  }
  return next;
}
