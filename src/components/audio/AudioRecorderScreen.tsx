import { useState } from "react"

import { Button } from "../ui/Button"
import { ScreenFooter } from "../ui/ScreenFooter"
import { VoiceTextarea } from "../ui/VoiceTextarea"

interface Props {
  screenshotUrl?: string
  onConfirm: (transcript: string) => void
  onCancel: () => void
}

export function AudioRecorderScreen({ screenshotUrl, onConfirm, onCancel }: Props) {
  const [transcript, setTranscript] = useState("")

  return (
    <div className="flex flex-1 flex-col gap-0">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        {screenshotUrl && (
          <img
            src={screenshotUrl}
            alt="screenshot"
            className="h-48 w-full rounded-lg border border-gray-200 object-contain"
          />
        )}
        <p className="text-sm font-medium text-gray-700">
          Введіть або надиктуйте опис скріншоту
        </p>
        <VoiceTextarea
          value={transcript}
          onChange={setTranscript}
          placeholder="Натисніть мікрофон або введіть текст вручну"
          minHeight="min-h-[120px]"
        />
      </div>

      <ScreenFooter>
        <Button variant="secondary" onClick={onCancel}>
          Скасувати
        </Button>
        <Button disabled={!transcript.trim()} onClick={() => onConfirm(transcript.trim())}>
          Надіслати →
        </Button>
      </ScreenFooter>
    </div>
  )
}
