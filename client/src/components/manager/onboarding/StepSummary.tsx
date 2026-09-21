import type { ReactNode } from "react";
import { CheckCircle, Edit2 } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { CARD_RADIUS, Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { mt } from "@/i18n/manager";

/**
 * The review screen a multi-part onboarding step shows once its work is done.
 *
 * Read-only on purpose. Each group offers Edit — which goes back to the part that owns
 * the thing — rather than an expander holding a second copy of the form. Two editors
 * for one record is how a page ends up disagreeing with itself, and the manager
 * already has one place per field.
 *
 * **One Edit per part, and that is the whole rule.** A step's parts ARE its groups, so a
 * three-part step shows three Edit buttons — one per group — and never one per field. Six
 * buttons over three parts reads as six things to fix, and the manager has to work out
 * that half of them open the same screen. A group lists everything its part collected;
 * it offers exactly one way back to it.
 *
 * One component, four steps. The Business, kitchen listing, availability and
 * requirements steps all close the same way, so they cannot drift into four
 * slightly different reviews — and "actions of the same kind look the same in one
 * card" is the rule the kitchen recap was already built on.
 */
export interface StepSummaryRow {
    key: string;
    /**
     * The field's name. Omit it when the group's title already says it — a row under a
     * "Booking policies" heading does not need to repeat the words.
     */
    label?: string;
    /**
     * Already-formatted. Keep it short: this is a line to scan, and a value that runs long
     * is the caller's to shorten (see `truncateFilename`) rather than the layout's to fold.
     */
    value: string;
}

export interface StepSummarySection {
    key: string;
    /**
     * The group's heading, and the name its Edit announces itself by.
     *
     * Omit `title` AND `part` for a single-pane step: the requirements wizard is one
     * surface, so a group heading there would only repeat the heading above it, and the
     * one Edit already lives on that heading.
     */
    title?: string;
    /**
     * Which part owns this group; Edit navigates there.
     *
     * Omit it when the `heading` already owns the part — a part must never be reachable
     * from two controls, which is the defect this component exists to prevent.
     */
    part?: number;
    rows: StepSummaryRow[];
}

interface StepSummaryProps {
    /** Optional hero — the kitchen recap puts its photo collage here. */
    media?: ReactNode;
    /**
     * Optional headline block above the groups, for a record with a name. It carries its
     * own Edit, so the part it names must not also appear as a section.
     */
    heading?: { title: string; meta?: ReactNode; part: number };
    sections: StepSummarySection[];
    onEdit: (part: number) => void;
    noteTitle: string;
    noteBody: string;
}

export function StepSummary({ media, heading, sections, onEdit, noteTitle, noteBody }: StepSummaryProps) {
    return (
        <Card
            className={cn(
                "overflow-hidden border-0 shadow-[0_8px_30px_rgba(44,44,44,0.07)] ring-1 ring-[#2C2C2C]/[0.05]",
                CARD_RADIUS,
            )}
        >
            {media}

            {heading ? (
                <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
                    <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold tracking-tight text-[#1A1A1A] sm:text-xl">
                            {heading.title}
                        </h3>
                        {heading.meta ? (
                            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">{heading.meta}</div>
                        ) : null}
                    </div>
                    <EditButton label={heading.title} part={heading.part} onEdit={onEdit} />
                </div>
            ) : null}

            {sections.map((section) => {
                const hasHeader = Boolean(section.title) || section.part !== undefined;
                return (
                    <div key={section.key} className="border-t border-border">
                        {hasHeader ? (
                            <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
                                {section.title ? (
                                    <h4 className="text-sm font-semibold text-foreground">{section.title}</h4>
                                ) : (
                                    <div />
                                )}
                                {section.part !== undefined ? (
                                    <EditButton label={section.title ?? ""} part={section.part} onEdit={onEdit} />
                                ) : null}
                            </div>
                        ) : null}

                        <div className={cn("px-4 sm:px-5", hasHeader ? "pb-4 pt-2.5" : "py-4")}>
                            {section.rows.map((row) => (
                                <div key={row.key} className="py-1.5">
                                    {/*
                                      * Three levels, and they have to be three: the group heading is
                                      * the only bold thing, the field name is a smaller, quieter
                                      * line, and the value is what the manager is actually here to
                                      * read — so the value is the readable one. Two similar-looking
                                      * dark labels was the first attempt, and the grouping vanished
                                      * into a wall of same-weight text.
                                      */}
                                    {row.label ? (
                                        <p className="text-xs text-muted-foreground">{row.label}</p>
                                    ) : null}
                                    {/* `break-words`, never `truncate`: a value that wraps grows
                                        its own line, and with no Edit button beside it there is
                                        nothing for it to push around. */}
                                    <p className={cn("break-words text-sm text-foreground", row.label && "mt-0.5")}>
                                        {row.value}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}

            <div className="border-t border-border bg-muted/30 px-4 py-3.5 sm:px-5">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                    {noteTitle}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{noteBody}</p>
            </div>
        </Card>
    );
}

/**
 * The one Edit action, in one shape.
 *
 * Named for what it edits: three buttons reading just "Edit" are useless to a screen
 * reader, which reads them out of context as three identical controls.
 */
function EditButton({ label, part, onEdit }: { label: string; part: number; onEdit: (part: number) => void }) {
    return (
        <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-muted-foreground hover:text-foreground"
            aria-label={label ? `${mt("editSection")} ${label}` : mt("editSection")}
            onClick={() => onEdit(part)}
        >
            <Edit2 className="h-3.5 w-3.5" />
            {mt("editSection")}
        </Button>
    );
}

export default StepSummary;
