export function ErrorText({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return <p className="text-xs text-red-500">{message}</p>
}
