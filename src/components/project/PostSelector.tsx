import React, { useEffect, useState } from "react"

import { Toast } from "~components/ui/Toast"

import { createPost, getPost, getPosts, updatePostTitle } from "../../core/api"
import { SEARCH_DEBOUNCE_MS } from "../../core/config"
import type { WPPost } from "../../core/types"
import { useDebouncedCallback } from "../../hooks/useDebounce"
import { Button } from "../ui/Button"
import { ErrorText } from "../ui/ErrorText"
import { Input } from "../ui/Input"
import { Spinner } from "../ui/Spinner"
import { PostRow } from "./PostRow"

interface PostSelectorProps {
  token: string
  refreshKey?: number
  onSelect: (post: WPPost) => void
}

export function PostSelector({
  token,
  refreshKey,
  onSelect
}: PostSelectorProps) {
  const [query, setQuery] = useState("")
  const [posts, setPosts] = useState<WPPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const search = useDebouncedCallback(async (q: string, p: number) => {
    setLoading(true)
    setError(null)
    try {
      const { posts: results, totalPages: tp } = await getPosts(q, token, p)
      setPosts(results)
      setTotalPages(tp)
    } catch {
      setError("Не вдалося завантажити пости")
    } finally {
      setLoading(false)
    }
  }, SEARCH_DEBOUNCE_MS)

  useEffect(() => {
    setQuery("")
    search("", 1)
  }, [token, refreshKey])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    setPage(1)
    search(e.target.value, 1)
  }

  const handleClone = async (post: WPPost) => {
    const full = await getPost(post.id, token)
    const newPost = await createPost(
      `${post.title.rendered} (copy)`,
      full.acf.content,
      token
    )
    onSelect(newPost)
  }

  const handleRename = async (post: WPPost, newTitle: string) => {
    const updated = await updatePostTitle(post.id, newTitle, token)
    setPosts((prev) =>
      prev.map((p) => (p.id === post.id ? { ...p, title: updated.title } : p))
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <Input
        placeholder="Пошук документації…"
        value={query}
        onChange={handleChange}
        autoFocus
      />

      {error && <Toast type="error" message={error} />}

      <div className="relative flex-col flex flex-1 min-h-20">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded bg-white/40">
            <Spinner />
          </div>
        )}

        {!loading && posts.length === 0 && !error && (
          <p className="py-4 text-center text-xs text-gray-400">
            {query ? "Нічого не знайдено" : "Введіть назву документа"}
          </p>
        )}

        <ul className="flex  flex-col gap-1">
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              onSelect={() => onSelect(post)}
              onClone={() => handleClone(post)}
              onRename={(title) => handleRename(post, title)}
            />
          ))}
        </ul>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-auto">
          <Button
            variant="secondary"
            size="sm"
            disabled={page === 1 || loading}
            onClick={() => {
              setPage(page - 1)
              search(query, page - 1)
            }}>
            ← Назад
          </Button>
          <span className="text-xs text-gray-400">
            {page} / {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page === totalPages || loading}
            onClick={() => {
              setPage(page + 1)
              search(query, page + 1)
            }}>
            Далі →
          </Button>
        </div>
      )}
    </div>
  )
}
