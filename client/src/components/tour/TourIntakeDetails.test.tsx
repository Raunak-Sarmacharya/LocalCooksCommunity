import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { TourIntakeDetails } from "./TourIntakeDetails";

beforeAll(async () => {
  if (!i18n.isInitialized) await new Promise<void>((resolve) => i18n.on("initialized", () => resolve()));
});
afterEach(cleanup);

function showAnswers(data: Record<string, unknown> | null) {
  return render(<I18nextProvider i18n={i18n}><TourIntakeDetails data={data} /></I18nextProvider>);
}

describe("tour intake answers with the app's configured ICU translations", () => {
  it.each([
    ["en-CA", "hours per week", "No", "Not decided yet"],
    ["fr-CA", "heures par semaine", "Non", "Pas encore décidé"],
    ["uk", "годин на тиждень", "Ні", "Ще не визначено"],
  ])("renders saved answers in %s", async (locale, hours, no, undecided) => {
    await i18n.changeLanguage(locale);
    const { container, rerender } = showAnswers({ estimatedWeeklyHours: "5-10", hasLicense: false, targetStartDate: "not_decided" });
    expect(screen.getByText(`5-10 ${hours}`)).toBeInTheDocument();
    expect(screen.getByText(no)).toBeInTheDocument();
    expect(screen.getByText(undecided)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[{}]/);

    rerender(<I18nextProvider i18n={i18n}><TourIntakeDetails data={{ estimatedWeeklyHours: 5 }} /></I18nextProvider>);
    expect(screen.getByText(`5 ${hours}`)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[{}]/);
  });

  it("preserves free text, calendar dates and legacy answers without inventing unanswered values", async () => {
    await i18n.changeLanguage("en-CA");
    const { container, rerender } = showAnswers({ estimatedWeeklyHours: "Evenings and weekends", targetStartDate: "2026-10-07", legacyQuestion: "Saved answer", hasLicense: null, additionalInfo: " " });
    expect(screen.getByText("Evenings and weekends")).toBeInTheDocument();
    expect(screen.getByText("2026-10-07")).toBeInTheDocument();
    expect(screen.getByText("Saved answer")).toBeInTheDocument();
    expect(container.querySelectorAll("dd")).toHaveLength(3);
    expect(screen.queryByText("No")).not.toBeInTheDocument();
    rerender(<I18nextProvider i18n={i18n}><TourIntakeDetails data={null} /></I18nextProvider>);
    expect(container).toBeEmptyDOMElement();
  });
});
