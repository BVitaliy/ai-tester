import { Home } from "lucide-react"

import type { EditorScreen, WPPost } from "../../core/types"
import { Button } from "../ui/Button"

interface BreadcrumbProps {
  post: WPPost | null
  screen: EditorScreen
  onNavigate: (s: EditorScreen) => void
}

export function Breadcrumb({ post, screen, onNavigate }: BreadcrumbProps) {
  return (
    <div className="flex min-w-0 items-center gap-1 text-xs">
      <Button
        variant="ghost"
        size="md"
        className="p-1"
        onClick={() => onNavigate("post-selector")}>
        <Home size={16} />
      </Button>
      {screen !== "post-selector" && post && (
        <>
          <span className="text-gray-300">›</span>
          <span className="truncate px-1 text-blue-600">
            {post.title.rendered}
          </span>
        </>
      )}
    </div>
  )
}
