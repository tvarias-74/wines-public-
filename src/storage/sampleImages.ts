import type { CellarData, Colour, Vintage } from '../domain/types';
import { COLOUR_LABEL } from '../domain/types';
import { SAMPLE_PREFIX, setVintageImage } from '../domain/actions';
import { formatYear } from '../domain/text';
import { putImage } from './images';
import { processCanvas } from './imageProcess';

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
  // Drawn at a smaller size (everything below is laid out on 600 × 800 and scaled down): these are
  // stand-ins, and fewer pixels is a quicker demo on a phone.
  c.width = 450;
  c.height = 600;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.scale(0.75, 0.75);
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
    await putImage({ id, ...(await processCanvas(canvas)), createdAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

interface Job {
  vintageId: string;
  side: 'front' | 'back';
  id: string;
  draw: () => HTMLCanvasElement;
}

const PARALLEL = 4;

/** Adds a front label to every demo wine, and a back label to every third one. */
export async function attachSampleLabels(data: CellarData): Promise<CellarData> {
  const bottlings = new Map(data.bottlings.map((b) => [b.id, b]));
  const producers = new Map(data.producers.map((p) => [p.id, p]));
  const demo: Vintage[] = data.vintages.filter((v) => v.id.startsWith(SAMPLE_PREFIX) && !v.images);

  const jobs: Job[] = [];
  demo.forEach((v, n) => {
    const b = bottlings.get(v.bottlingId);
    const p = b && producers.get(b.producerId);
    if (!b || !p) return;
    const place = [b.appellation ?? b.region, b.country].filter(Boolean).join(' · ');
    const job = (side: 'front' | 'back'): Job => ({ vintageId: v.id, side, id: `${SAMPLE_PREFIX}img-${v.id}-${side}`, draw: () => drawLabel(side, p.name, b.name, formatYear(v.year), place, b.colour) });
    jobs.push(job('front'));
    if (n % 3 === 0) jobs.push(job('back'));
  });

  // A few at a time: drawing is on the main thread, but encoding is not, so this keeps every core busy.
  const done: Job[] = [];
  let next = 0;
  const worker = async () => {
    for (let job = jobs[next++]; job; job = jobs[next++]) {
      if (await makeImage(job.id, job.draw())) done.push(job);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  let out = data;
  for (const j of done) out = setVintageImage(out, j.vintageId, j.side, j.id);
  return out;
}
