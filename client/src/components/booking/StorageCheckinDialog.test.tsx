import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import i18n from "@/i18n"

const duties = vi.hoisted(() => ({ arrival: null as Record<string, unknown> | null }))
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }))
vi.mock("@/hooks/use-storage-duties", () => ({ useStorageDuties: () => ({ data: { arrival: duties.arrival }, isPending: false, error: null }) }))
vi.mock("./PhotoRequirementUploader", () => ({ PhotoRequirementUploader: () => null, flattenPhotos: () => [],
  areAllRequiredPhotosUploaded: (requirements: Array<{ required?: boolean }>) => !requirements.some(photo => photo.required !== false) }))

import { StorageCheckinDialog } from "./StorageCheckinDialog"

beforeAll(async () => {
  if (!i18n.isInitialized) await new Promise<void>(resolve => i18n.on("initialized", () => resolve()))
  await i18n.changeLanguage("en-CA")
})
afterEach(cleanup)

const show = () => render(<QueryClientProvider client={new QueryClient()}><I18nextProvider i18n={i18n}>
  <StorageCheckinDialog open onOpenChange={() => {}} storageBooking={{ id: 51, startDate: "2026-10-29" }} />
</I18nextProvider></QueryClientProvider>)

it("lets the chef move in when the kitchen has no arrival checklist", () => {
  duties.arrival = { enabled: false, items: [], photos: [], instructions: "" }
  show()
  expect(screen.getByRole("button", { name: "Confirm move-in" })).toBeEnabled()
})

it("still waits for a required photo when the kitchen asks for one", () => {
  duties.arrival = { enabled: true, items: [], photos: [{ id: "p1", label: "Shelf", required: true }], instructions: "" }
  show()
  expect(screen.getByRole("button", { name: "Confirm move-in" })).toBeDisabled()
})

it("shows a photo task once, as its photo slot, and counts it as what's left", () => {
  duties.arrival = { enabled: true, items: [{ id: "p1", label: "Shelf photo", required: true }, { id: "lbl", label: "Label containers", required: true }],
    photos: [{ id: "p1", label: "Shelf photo", required: true }], instructions: "" }
  show()
  expect(screen.getAllByRole("checkbox")).toHaveLength(1)
  expect(screen.getByText("Complete 2 required tasks to continue")).toBeInTheDocument()
})
