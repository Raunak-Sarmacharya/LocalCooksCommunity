import * as React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { NumericInput } from "./numeric-input"
import { CurrencyInput } from "./currency-input"

describe("number input editing", () => {
  for (const kind of ["integer", "suffix", "decimal", "currency"] as const) {
    it(`allows clearing and replacing a ${kind} value despite parent normalization`, () => {
      const onBlur = vi.fn()
      function Form() {
        const [value, setValue] = React.useState(5)
        const props = {
          value: String(value),
          onValueChange: (raw: string) => setValue(Number(raw) || 5),
          onBlur,
          "aria-label": "Amount",
        }
        return kind === "currency" ? <CurrencyInput {...props} /> :
          <NumericInput {...props} suffix={kind === "suffix" ? "days" : undefined} allowDecimals={kind === "decimal"} />
      }
      render(<Form />)
      const input = screen.getByRole("textbox")
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: "" } })
      expect(input).toHaveValue("")
      fireEvent.change(input, { target: { value: "2" } })
      expect(input).toHaveValue("2")
      if (kind === "decimal" || kind === "currency") {
        fireEvent.change(input, { target: { value: "2." } })
        expect(input).toHaveValue("2.")
        fireEvent.change(input, { target: { value: "2.05" } })
        expect(input).toHaveValue("2.05")
      }
      fireEvent.change(input, { target: { value: "invalid" } })
      expect(input).not.toHaveValue("invalid")
      fireEvent.change(input, { target: { value: "" } })
      fireEvent.blur(input)
      expect(input).toHaveValue("5")
      expect(onBlur).toHaveBeenCalledOnce()
    })
  }

  it("uses updated external values when idle and preserves uncontrolled edits", () => {
    const { rerender } = render(<NumericInput value="5" />)
    rerender(<NumericInput value="12" />)
    expect(screen.getByRole("textbox")).toHaveValue("12")
    rerender(<NumericInput key="uncontrolled" defaultValue="3" />)
    const input = screen.getByRole("textbox")
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "7" } })
    fireEvent.blur(input)
    expect(input).toHaveValue("7")
  })
})
