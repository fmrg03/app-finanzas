/**
 * Reduce una foto antes de subirla: máximo 2000 px por lado, JPEG 85 %.
 * Si el navegador puede decodificarla (incluye HEIC en Safari), la reconvierte a JPEG.
 * Los PDF se envían tal cual.
 */
export async function prepareReceipt(file: File): Promise<Blob> {
  if (file.type === 'application/pdf') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // que la API decida si el formato es válido
  }
  const MAX = 2000;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.type === 'image/jpeg' && file.size < 2_500_000) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
}
