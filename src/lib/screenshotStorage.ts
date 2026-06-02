export function screenshotStoreKey(sessionKey: string, id: string): string {
  return `jackShot:${sessionKey}:${id}`
}

export async function putScreenshot(
  sessionKey: string,
  id: string,
  dataUrl: string
): Promise<void> {
  await chrome.storage.local.set({ [screenshotStoreKey(sessionKey, id)]: dataUrl })
}

export async function getScreenshot(
  sessionKey: string,
  id: string
): Promise<string | undefined> {
  const key = screenshotStoreKey(sessionKey, id)
  const r = await chrome.storage.local.get(key)
  return r[key] as string | undefined
}

export async function deleteScreenshot(
  sessionKey: string,
  id: string
): Promise<void> {
  await chrome.storage.local.remove(screenshotStoreKey(sessionKey, id))
}

export async function compressDataUrl(
  dataUrl: string,
  maxWidth = 1600,
  quality = 0.85
): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, maxWidth / bmp.width)
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(out)
  })
}
