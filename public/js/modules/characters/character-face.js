let modelsReady;

export function faceFilename(imageUrl) {
  const filename = String(imageUrl).split('?')[0].split('/').pop();
  return `${filename.replace(/\.[^.]+$/, '').replace(/-face$/, '')}-face.png`;
}

/** Build the URL for the saved face crop that belongs to a character portrait. */
export function faceImageUrl(imageUrl) {
  const source = String(imageUrl || '');
  if (!source) return '';
  const suffixStart = source.search(/[?#]/);
  const path = suffixStart < 0 ? source : source.slice(0, suffixStart);
  const suffix = suffixStart < 0 ? '' : source.slice(suffixStart);
  const slash = path.lastIndexOf('/');
  const filename = path.slice(slash + 1);
  const stem = filename.replace(/\.[^.]+$/, '').replace(/-face$/, '');
  return `${path.slice(0, slash + 1)}${stem}-face.png${suffix}`;
}

/** Always encode PNG, including when detection is unavailable and the user supplied a JPEG/WebP. */
export async function cropCharacterFace(source, { fallback = true } = {}) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = source;
  });
  let box;
  try {
    if (globalThis.faceapi) {
      modelsReady ||= faceapi.nets.tinyFaceDetector.loadFromUri('/models').catch((error) => {
        modelsReady = null;
        throw error;
      });
      await modelsReady;
      box = (await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions()))?.box;
    }
  } catch (error) {
    console.warn('[Character face] Detection unavailable:', error);
  }
  if (!box && !fallback) return null;
  const side = box
    ? Math.min(img.naturalWidth, img.naturalHeight, Math.ceil(Math.max(box.width, box.height) * 1.5))
    : Math.min(img.naturalWidth, img.naturalHeight);
  const left = box
    ? Math.max(0, Math.min(img.naturalWidth - side, box.x + box.width / 2 - side / 2))
    : (img.naturalWidth - side) / 2;
  const top = box ? Math.max(0, Math.min(img.naturalHeight - side, box.y + box.height / 2 - side / 2)) : 0;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.max(1, Math.min(768, Math.round(side)));
  canvas.getContext('2d').drawImage(img, left, top, side, side, 0, 0, canvas.width, canvas.height);
  return { dataURL: canvas.toDataURL('image/png'), detected: Boolean(box) };
}
