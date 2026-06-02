import { cn } from "../../lib/cn"

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

export function Select({ label, error, id, className, children, ...props }: SelectProps) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, "-")
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-xs font-medium text-gray-400">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          className={cn(
            'w-full appearance-none rounded-md border py-1.5 pl-3 pr-8 text-sm bg-[var(--card)] text-gray-200 focus:outline-none focus:ring-1',
            error
              ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
              : 'border-[var(--border)] focus:border-[var(--primary)] focus:ring-[var(--primary)]',
            className
          )}
          {...props}
        >
          {children}
        </select>
        {/* Simple down arrow for the select, avoiding external icon dependencies */}
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▼</span>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
