import { Button } from "../ui/Button"

interface DestinationButtonProps {
  active: boolean
  disabled?: boolean
  onClick: (e?: React.MouseEvent) => void
}

export function DestinationButton({
  active,
  disabled,
  onClick
}: DestinationButtonProps) {
  return (
    <Button
      variant={active ? "primary" : "secondary"}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Збережіть зміни перед вибором цілі" : undefined}
      className="shrink-0">
      {active ? "✓ Обрано" : "Обрати"}
    </Button>
  )
}
