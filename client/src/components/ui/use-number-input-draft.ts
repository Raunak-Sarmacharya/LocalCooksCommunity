import * as React from "react"

// Keep intermediate edits (empty, "1.", "1.0") even when a caller parses
// the value or substitutes a default. Reconcile with its value on blur.
export function useNumberInputDraft({ value, defaultValue, onFocus, onBlur }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [draft, setDraft] = React.useState(() => String(value ?? defaultValue ?? ""))
  const [editing, setEditing] = React.useState(false)
  return {
    setDraft,
    inputProps: {
      value: editing || value === undefined ? draft : value,
      onFocus: (event: React.FocusEvent<HTMLInputElement>) => {
        setDraft(event.currentTarget.value)
        setEditing(true)
        onFocus?.(event)
      },
      onBlur: (event: React.FocusEvent<HTMLInputElement>) => {
        setEditing(false)
        onBlur?.(event)
      },
    },
  }
}
