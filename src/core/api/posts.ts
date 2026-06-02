import { API_BASE_URL, MOCK_MODE } from "../config"
import type { WPAcfElement, WPPost } from "../types"
import { delay, MOCK_POSTS_MUTABLE } from "./mock-data"

type PostsPage = { posts: WPPost[]; totalPages: number }

function authHeader(token: string) {
  return { Authorization: `Basic ${token}` }
}

export async function getPosts(
  search: string,
  token: string,
  page = 1
): Promise<PostsPage> {
  if (MOCK_MODE) {
    await delay()
    const filtered = search
      ? MOCK_POSTS_MUTABLE.filter((p) =>
          p.title.rendered.toLowerCase().includes(search.toLowerCase())
        )
      : MOCK_POSTS_MUTABLE
    return { posts: JSON.parse(JSON.stringify(filtered)), totalPages: 1 }
  }
  const params = new URLSearchParams({
    per_page: "15",
    page: String(page),
    status: "publish,draft",
    _fields: "id,title,slug,link,status",
    ...(search ? { search } : {})
  })
  const res = await fetch(`${API_BASE_URL}/wp-json/wp/v2/posts?${params}`, {
    headers: { ...authHeader(token) },
    credentials: "omit"
  })
  if (!res.ok) throw new Error("Не вдалося завантажити пости")
  const totalPages = parseInt(res.headers.get("X-WP-TotalPages") ?? "1") || 1
  return { posts: await res.json(), totalPages }
}

export async function getPost(postId: number, token: string): Promise<WPPost> {
  if (MOCK_MODE) {
    await delay()
    const post = MOCK_POSTS_MUTABLE.find((p) => p.id === postId)
    if (!post) throw new Error("Пост не знайдено")
    return JSON.parse(JSON.stringify(post))
  }
  const res = await fetch(`${API_BASE_URL}/wp-json/wp/v2/posts/${postId}`, {
    headers: { ...authHeader(token) },
    credentials: "omit"
  })
  if (!res.ok) throw new Error("Не вдалося завантажити пост")
  return res.json()
}

export async function createPost(
  title: string,
  acfContent: WPAcfElement[],
  token: string
): Promise<WPPost> {
  if (MOCK_MODE) {
    await delay(400)
    const newPost: WPPost = {
      id: Date.now(),
      title: { rendered: title },
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      link: "",
      status: "draft",
      acf: { content: JSON.parse(JSON.stringify(acfContent)) }
    }
    MOCK_POSTS_MUTABLE.push(newPost)
    return JSON.parse(JSON.stringify(newPost))
  }
  const res = await fetch(`${API_BASE_URL}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(token) },
    credentials: "omit",
    body: JSON.stringify({
      title,
      acf: { content: acfContent },
      status: "draft"
    })
  })
  if (!res.ok) throw new Error("Не вдалося створити пост")
  return res.json()
}

export async function updatePostTitle(
  postId: number,
  title: string,
  token: string
): Promise<WPPost> {
  if (MOCK_MODE) {
    await delay(300)
    const idx = MOCK_POSTS_MUTABLE.findIndex((p) => p.id === postId)
    if (idx === -1) throw new Error("Пост не знайдено")
    MOCK_POSTS_MUTABLE[idx].title.rendered = title
    return JSON.parse(JSON.stringify(MOCK_POSTS_MUTABLE[idx]))
  }
  const res = await fetch(`${API_BASE_URL}/wp-json/wp/v2/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(token) },
    credentials: "omit",
    body: JSON.stringify({ title })
  })
  if (!res.ok) throw new Error("Не вдалося перейменувати пост")
  return res.json()
}

export async function publishPost(
  postId: number,
  token: string
): Promise<WPPost> {
  if (MOCK_MODE) {
    await delay(300)
    const idx = MOCK_POSTS_MUTABLE.findIndex((p) => p.id === postId)
    if (idx === -1) throw new Error("Пост не знайдено")
    MOCK_POSTS_MUTABLE[idx].status = "publish"
    return JSON.parse(JSON.stringify(MOCK_POSTS_MUTABLE[idx]))
  }
  const res = await fetch(`${API_BASE_URL}/wp-json/wp/v2/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(token) },
    credentials: "omit",
    body: JSON.stringify({ status: "publish" })
  })
  if (!res.ok) throw new Error("Не вдалося опублікувати пост")
  return res.json()
}

export async function updatePostAcf(
  postId: number,
  acfContent: WPAcfElement[],
  token: string
): Promise<WPPost> {
  if (MOCK_MODE) {
    console.log("[docshot] updatePostAcf mock update", { postId, acfContent })
    await delay(500)
    const idx = MOCK_POSTS_MUTABLE.findIndex((p) => p.id === postId)
    if (idx === -1) throw new Error("Пост не знайдено")
    MOCK_POSTS_MUTABLE[idx].acf.content = JSON.parse(JSON.stringify(acfContent))
    return JSON.parse(JSON.stringify(MOCK_POSTS_MUTABLE[idx]))
  }
  const res = await fetch(`${API_BASE_URL}/wp-json/wp/v2/posts/${postId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(token)
    },
    credentials: "omit",
    body: JSON.stringify({ acf: { content: acfContent } })
  })
  if (!res.ok) throw new Error("Не вдалося зберегти зміни")
  return res.json()
}
