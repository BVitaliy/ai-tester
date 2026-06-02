import { useCallback, useEffect, useState } from "react"
import type { CaptureFlow } from "../core/types"
import {
  clearCaptureFlow,
  getCaptureFlow,
  setCaptureFlow,
  updateCaptureFlow,
} from "../store/session"

export function useCaptureFlow() {
  const [flow, setFlow] = useState<CaptureFlow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCaptureFlow().then((f) => {
      setFlow(f)
      setLoading(false)
    })
  }, [])

  const refresh = useCallback(async () => {
    const f = await getCaptureFlow()
    setFlow(f)
  }, [])

  const patch = useCallback(
    async (changes: Partial<CaptureFlow>) => {
      await updateCaptureFlow(changes)
      await refresh()
    },
    [refresh],
  )

  const clear = useCallback(async () => {
    await clearCaptureFlow()
    setFlow(null)
  }, [])

  const init = useCallback(async (initial: CaptureFlow) => {
    await setCaptureFlow(initial)
    setFlow(initial)
  }, [])

  return { flow, loading, init, patch, clear, refresh }
}
