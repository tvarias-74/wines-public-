import { useEffect, useRef, useState } from 'react';
import { newId } from '../domain/text';
import { acquireImageUrl, forgetImage, releaseImageUrl } from '../storage/imageCache';
import { deleteImage, putImage } from '../storage/images';
import { processImageFile } from '../storage/imageProcess';
import { Icon } from './Icon';
import { Modal } from './overlays';

export type ImageState = { state: 'none' } | { state: 'loading' } | { state: 'ready'; url: string } | { state: 'missing' };

/** The URL for a stored photo, loading it on demand and releasing it when no longer shown. */
export function useImageUrl(id: string | undefined, kind: 'thumb' | 'full'): ImageState {
  const [result, setResult] = useState<ImageState>(id ? { state: 'loading' } : { state: 'none' });
  useEffect(() => {
    if (!id) {
      setResult({ state: 'none' });
      return;
    }
    let live = true;
    setResult({ state: 'loading' });
    void acquireImageUrl(id, kind).then((url) => {
      if (live) setResult(url ? { state: 'ready', url } : { state: 'missing' });
    });
    return () => {
      live = false;
      releaseImageUrl(id, kind);
    };
  }, [id, kind]);
  return result;
}

/** A label photo, or a quiet placeholder where there isn't one (or it can't be found). */
export function LabelImage({ id, kind = 'thumb', alt, className = '' }: { id?: string; kind?: 'thumb' | 'full'; alt: string; className?: string }) {
  const img = useImageUrl(id, kind);
  if (img.state === 'ready') return <img className={`label-img ${className}`} src={img.url} alt={alt} loading="lazy" draggable={false} />;
  return (
    <span className={`label-img label-placeholder ${className}`} role="img" aria-label={img.state === 'missing' ? `${alt} (photo not found)` : `${alt} (no photo)`}>
      <Icon name={img.state === 'missing' ? 'alert' : 'image'} size={22} />
    </span>
  );
}

/** Full-screen look at a photo. */
export function ImageViewer({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} wide footer={<button className="btn" onClick={onClose}>Close</button>}>
      <LabelImage id={id} kind="full" alt={title} className="label-large" />
    </Modal>
  );
}

const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/**
 * One side of a bottle's label. On a phone it opens the camera ("Take photo") or the photo library;
 * on a computer it opens the file chooser. The photo is shrunk and stored on this device right away,
 * and `onChange` gets its id (or `undefined` when removed).
 */
export function PhotoSlot({
  label,
  imageId,
  onChange,
  onError,
  disabled,
}: {
  label: string;
  imageId?: string;
  onChange: (id: string | undefined) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const touch = isTouch();

  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const processed = await processImageFile(file);
      const id = newId();
      await putImage({ id, ...processed, createdAt: Date.now() });
      onChange(id);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not use that photo.');
    } finally {
      setBusy(false);
    }
  };

  const reset = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    void take(f);
  };

  return (
    <div className="photo-slot">
      <div className="photo-slot-label">{label}</div>
      <button type="button" className="photo-frame" onClick={() => imageId && setViewing(true)} disabled={!imageId} aria-label={imageId ? `View ${label.toLowerCase()} larger` : `${label}: no photo yet`}>
        <LabelImage id={imageId} kind="thumb" alt={label} />
        {busy && <span className="photo-busy">Saving…</span>}
      </button>
      <div className="photo-actions">
        {touch && (
          <button type="button" className="btn btn-sm" onClick={() => camera.current?.click()} disabled={disabled || busy}>
            <Icon name="camera" size={16} /> {imageId ? 'Retake' : 'Take photo'}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => library.current?.click()} disabled={disabled || busy}>
          <Icon name="image" size={16} /> {touch ? 'Choose…' : imageId ? 'Replace…' : 'Choose photo…'}
        </button>
        {imageId && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={disabled || busy}
            onClick={() => {
              onChange(undefined);
            }}
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={reset} />
      <input ref={library} type="file" accept="image/*" hidden onChange={reset} />
      {viewing && imageId && <ImageViewer id={imageId} title={label} onClose={() => setViewing(false)} />}
    </div>
  );
}

/** Removes a photo's bytes once nothing uses it. Safe to call for an id that is already gone. */
export async function discardImage(id: string | undefined): Promise<void> {
  if (!id) return;
  forgetImage(id);
  try {
    await deleteImage(id);
  } catch {
    /* it will be cleaned up later */
  }
}
