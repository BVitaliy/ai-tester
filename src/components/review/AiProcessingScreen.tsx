import { GEMINI_MODELS } from "../../core/config"
import { Button } from "../ui/Button"
import { ScreenFooter } from "../ui/ScreenFooter"
import { Select } from "../ui/Select"
import { Spinner } from "../ui/Spinner"
import { Toast } from "../ui/Toast"

interface Props {
  flowType?: "screenshot" | "video"
  error?: string
  currentModel?: string
  onModelChange?: (model: string) => void
  onRetry?: () => void
  onCancel?: () => void
}

export function AiProcessingScreen({
  flowType,
  error,
  currentModel,
  onModelChange,
  onRetry,
  onCancel
}: Props) {
  if (error) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <Toast message={error} type="error" />
          {onModelChange && (
            <div className="w-full max-w-xs">
              <Select
                label="Спробувати з іншою моделлю"
                value={currentModel}
                onChange={(e) => onModelChange(e.target.value)}
                className="text-xs">
                {GEMINI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <ScreenFooter>
          <Button variant="secondary" onClick={onCancel}>
            Скасувати
          </Button>
          <Button onClick={onRetry}>Спробувати знову</Button>
        </ScreenFooter>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <Spinner size="lg" />
        <p className="text-sm font-medium text-gray-700">AI генерує опис…</p>
        <p className="text-xs text-gray-400">
          {flowType === "video"
            ? "Аналізуємо відеозапис"
            : "Аналізуємо скріншот та опис"}
        </p>
      </div>
      <ScreenFooter>
        <Button variant="secondary" onClick={onCancel}>
          Скасувати
        </Button>
      </ScreenFooter>
    </div>
  )
}
