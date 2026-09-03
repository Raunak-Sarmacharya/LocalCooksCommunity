"use client"
import { mt } from "@/i18n/manager";

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal, Eye, MessageCircle, Check, X, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Application } from "./types"

// Status Badge Component — tier-aware so Step 1 approval is visible to admins
function StatusBadge({ application }: { application: Application }) {
    const status = application.status;
    const tier = application.current_tier ?? 1;
    const hasStep2 = !!application.tier2_completed_at;

    if (status === "inReview") {
        return <Badge variant="warning">{mt("pendingReview")}</Badge>;
    }
    if (status === "approved") {
        if (tier === 2 && hasStep2) {
            return <Badge variant="warning">{mt("step2Review")}</Badge>;
        }
        if (tier === 1) {
            return <Badge variant="info">{mt("step1Done")}</Badge>;
        }
        if (tier >= 3) {
            return <Badge variant="success">{mt("approved")}</Badge>;
        }
        return <Badge variant="info">{mt("inProgress")}</Badge>;
    }
    if (status === "rejected") {
        return (
            <Badge variant="outline" className="text-destructive border-destructive/30">{mt("rejected")}</Badge>
        );
    }
    return <Badge variant="outline">{status}</Badge>;
}

interface ApplicationColumnsProps {
    onApprove?: (app: Application) => void;
    onReject?: (app: Application) => void;
    onChat?: (app: Application) => void;
    onViewDocuments?: (app: Application) => void;
    onReview?: (app: Application) => void;
}

export function getApplicationColumns({
    onApprove,
    onReject,
    onChat,
    onViewDocuments,
    onReview
}: ApplicationColumnsProps): ColumnDef<Application>[] {
    return [
        {
            accessorKey: "fullName",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="pl-0"
                >{mt("applicant")}<ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="font-medium text-gray-900">{row.getValue("fullName")}</span>
                    <span className="text-xs text-gray-500">{row.original.email}</span>
                </div>
            ),
        },
        {
            accessorKey: "kitchenPreference",
            header: mt("kitchenTypeHeader"),
            cell: ({ row }) => {
                const pref = row.getValue("kitchenPreference") as string;
                return (
                    <span className="capitalize text-sm text-gray-700">
                        {pref === "commercial" ? mt("commercial") : pref === "home" ? mt("homeKitchen") : mt("notSure")}
                    </span>
                )
            },
        },
        {
            accessorKey: "status",
            header: mt("status"),
            cell: ({ row }) => <StatusBadge application={row.original} />,
            filterFn: (row, id, value) => {
                return value === 'all' || row.getValue(id) === value
            },
        },
        {
            accessorKey: "createdAt",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >{mt("applied")}<ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => (
                <span className="text-sm text-gray-600">
                    {new Date(row.getValue("createdAt")).toLocaleDateString()}
                </span>
            ),
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const app = row.original

                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">{mt("openMenu")}</span>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{mt("actions")}</DropdownMenuLabel>

                            {(app.status === "approved" || app.status === "inReview") && onChat && (
                                <DropdownMenuItem onClick={() => onChat(app)}>
                                    <MessageCircle className="mr-2 h-4 w-4" />{mt("chatWithChef")}</DropdownMenuItem>
                            )}

                            {(app.foodSafetyLicenseUrl || app.foodEstablishmentCertUrl) && onViewDocuments && (
                                <DropdownMenuItem onClick={() => onViewDocuments(app)}>
                                    <Eye className="mr-2 h-4 w-4" />{mt("viewDocuments")}</DropdownMenuItem>
                            )}

                            {app.status === "inReview" && (
                                <>
                                    <DropdownMenuSeparator />
                                    {onReview && (
                                        <DropdownMenuItem onClick={() => onReview(app)}>
                                            <ExternalLink className="mr-2 h-4 w-4" />{mt("reviewApplication")}</DropdownMenuItem>
                                    )}
                                    {onApprove && (
                                        <DropdownMenuItem onClick={() => onApprove(app)} className="text-green-600">
                                            <Check className="mr-2 h-4 w-4" />{mt("approve")}</DropdownMenuItem>
                                    )}
                                    {onReject && (
                                        <DropdownMenuItem onClick={() => onReject(app)} className="text-red-600">
                                            <X className="mr-2 h-4 w-4" />{mt("reject")}</DropdownMenuItem>
                                    )}
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            },
        },
    ]
}
