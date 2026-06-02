import { API_BASE_URL, MOCK_MODE } from "../config"
import type { WPMedia } from "../types"
import { delay } from "./mock-data"

function authHeader(token: string) {
  return { Authorization: `Basic ${token}` }
}

export async function uploadMedia(
  blob: Blob,
  filename: string,
  token: string
): Promise<WPMedia> {
  if (MOCK_MODE) {
    await delay(800)
    const fakeUrl = `https://documentation.redstone.studio/wp-content/uploads/mock/${filename}`
    return { id: Date.now(), source_url: fakeUrl }
  }
  const res = await fetch(`${API_BASE_URL}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": blob.type || "image/png",
      ...authHeader(token)
    },
    credentials: "omit",
    body: blob
  })
  if (!res.ok) throw new Error("Не вдалося завантажити зображення")
  return res.json()
}
