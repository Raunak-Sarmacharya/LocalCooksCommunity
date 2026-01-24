"use client"

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

// Status Badge Component
function StatusBadge({ status }: { status: string }) {
    switch (status) {
        case "inReview":
            return (
                <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200">
                    Pending Review
                </Badge>
            )
        case "approved":
            return (
                <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
                    Approved
                </Badge>
            )
        case "rejected":
            return (
                <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200">
                    Rejected
                </Badge>
            )
        default:
            return <Badge variant="outline">{status}</Badge>
    }
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
                >
                    Applicant
                    <ArrowUpDown className="ml-2 h-4 w-4" />
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
            header: "Kitchen Type",
            cell: ({ row }) => {
                const pref = row.getValue("kitchenPreference") as string;
                return (
                    <span className="capitalize text-sm text-gray-700">
                        {pref === "commercial" ? "Commercial" : pref === "home" ? "Home" : "Not Sure"}
                    </span>
                )
            },
        },
        {
            accessorKey: "status",
            header: "Status",
            cell: ({ row }) => <StatusBadge status={row.getValue("status")} />,
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
                >
                    Applied
                    <ArrowUpDown className="ml-2 h-4 w-4" />
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
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>

                            {(app.status === "approved" || app.status === "inReview") && onChat && (
                                <DropdownMenuItem onClick={() => onChat(app)}>
                                    <MessageCircle className="mr-2 h-4 w-4" />
                                    Chat with Chef
                                </DropdownMenuItem>
                            )}

                            {(app.foodSafetyLicenseUrl || app.foodEstablishmentCertUrl) && onViewDocuments && (
                                <DropdownMenuItem onClick={() => onViewDocuments(app)}>
                                    <Eye className="mr-2 h-4 w-4" />
                                    View Documents
                                </DropdownMenuItem>
                            )}

                            {app.status === "inReview" && (
                                <>
                                    <DropdownMenuSeparator />
                                    {onReview && (
                                        <DropdownMenuItem onClick={() => onReview(app)}>
                                            <ExternalLink className="mr-2 h-4 w-4" />
                                            Review Application
                                        </DropdownMenuItem>
                                    )}
                                    {onApprove && (
                                        <DropdownMenuItem onClick={() => onApprove(app)} className="text-green-600">
                                            <Check className="mr-2 h-4 w-4" />
                                            Approve
                                        </DropdownMenuItem>
                                    )}
                                    {onReject && (
                                        <DropdownMenuItem onClick={() => onReject(app)} className="text-red-600">
                                            <X className="mr-2 h-4 w-4" />
                                            Reject
                                        </DropdownMenuItem>
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
