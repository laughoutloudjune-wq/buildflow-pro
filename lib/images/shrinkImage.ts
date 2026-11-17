/** Shrink a phone photo to at most `maxSide` px on its long side, as JPEG,
 * before uploading - keeps material photos small on a site's mobile data. */
export async function shrinkImage(file: File, maxSide = 640): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('แปลงรูปไม่สำเร็จ'))), 'image/jpeg', 0.8)
  )
}

/** The FormData uploadMaterialImage expects, from a picked file (shrunk when possible). */
export async function materialPhotoForm(file: File): Promise<FormData> {
  const small = await shrinkImage(file).catch(() => file)
  const form = new FormData()
  form.append('file', new File([small], 'photo.jpg', { type: small.type || 'image/jpeg' }))
  return form
}
