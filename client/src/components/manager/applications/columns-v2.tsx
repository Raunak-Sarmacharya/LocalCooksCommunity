"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal, Eye, MessageCircle, Check, X, ChefHat, Building2, FileText, Clock, Ban } from "lucide-react"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Application } from "./types"
import { cn } from "@/lib/utils"

/**
 * Enterprise-grade Status Badge Component
 * Handles all application states including tier progression
 */
function ApplicationStatusBadge({ application }: { application: Application }) {
    const status = application.status;
    const tier = application.current_tier ?? 1;
    const hasStep2 = !!application.tier2_completed_at;

    // Pending Review (new application)
    if (status === "inReview") {
        return (
            <Badge variant="warning">
                <Clock className="h-3 w-3 mr-1" />
                Pending Review
            </Badge>
        )
    }

    // Approved states with tier awareness
    if (status === "approved") {
        // Step 2 Needs Review (Chef submitted Step 2, manager needs to review)
        if (tier === 2 && hasStep2) {
            return (
                <Badge variant="warning">
                    <Clock className="h-3 w-3 mr-1" />
                    Step 2 Review
                </Badge>
            )
        }

        // Step 1 Approved (waiting for chef to submit Step 2)
        if (tier === 1) {
            return (
                <Badge variant="info">
                    <Check className="h-3 w-3 mr-1" />
                    Step 1 Done
                </Badge>
            )
        }

        // Fully Approved (can book kitchens)
        if (tier >= 3) {
            return (
                <Badge variant="success">
                    <Check className="h-3 w-3 mr-1" />
                    Approved
                </Badge>
            )
        }

        // Edge case fallback
        return (
            <Badge variant="info">
                In Progress
            </Badge>
        )
    }

    // Rejected
    if (status === "rejected") {
        return (
            <Badge variant="outline" className="text-destructive border-destructive/30">
                <X className="h-3 w-3 mr-1" />
                Rejected
            </Badge>
        )
    }

    // Cancelled
    if (status === "cancelled") {
        return (
            <Badge variant="outline" className="text-muted-foreground">
                Cancelled
            </Badge>
        )
    }

    return <Badge variant="outline">{status}</Badge>
}

/**
 * Document indicators showing what documents the applicant has submitted
 */
function DocumentIndicators({ application }: { application: Application }) {
    const hasFoodSafety = !!application.foodSafetyLicenseUrl;
    const hasFoodEstablishment = !!application.foodEstablishmentCertUrl;
    const tierData = (application.tier_data || {}) as Record<string, any>;
    const hasInsurance = !!tierData.tierFiles?.['tier2_insurance_document'];

    if (!hasFoodSafety && !hasFoodEstablishment && !hasInsurance) {
        return <span className="text-xs text-gray-400">No documents</span>;
    }

    return (
        <div className="flex items-center gap-1">
            {hasFoodSafety && (
                <span className="inline-flex items-center px-1.5 py-0.5 bg-green-50 text-green-600 rounded text-[10px] font-medium">
                    <FileText className="h-2.5 w-2.5 mr-0.5" />
                    Cert
                </span>
            )}
            {hasFoodEstablishment && (
                <span className="inline-flex items-center px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">
                    <FileText className="h-2.5 w-2.5 mr-0.5" />
                    License
                </span>
            )}
            {hasInsurance && (
                <span className="inline-flex items-center px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded text-[10px] font-medium">
                    <FileText className="h-2.5 w-2.5 mr-0.5" />
                    Insurance
                </span>
            )}
        </div>
    )
}

/**
 * Step Progress indicator
 */
function StepProgress({ application }: { application: Application }) {
    const tier = application.current_tier ?? 1;
    const hasStep2 = !!application.tier2_completed_at;
    const isFullyApproved = application.status === 'approved' && tier >= 3;
    
    // Calculate progress
    let step1Complete = application.status === 'approved' || tier >= 2;
    let step2Complete = isFullyApproved;
    
    return (
        <div className="flex items-center gap-1">
            <div className={cn(
                "w-2 h-2 rounded-full",
                step1Complete ? "bg-emerald-500" : "bg-gray-300"
            )} title="Step 1" />
            <div className={cn(
                "w-4 h-0.5",
                step1Complete ? "bg-emerald-500" : "bg-gray-300"
            )} />
            <div className={cn(
                "w-2 h-2 rounded-full",
                step2Complete ? "bg-emerald-500" : hasStep2 ? "bg-amber-500" : "bg-gray-300"
            )} title="Step 2" />
        </div>
    )
}

export interface ApplicationColumnsConfig {
    onSelect: (app: Application) => void;
    onApprove?: (app: Application) => void;
    onReject?: (app: Application) => void;
    onChat?: (app: Application) => void;
    onRevoke?: (app: Application) => void;
    unreadCounts?: Record<number, number>;
}

export function getApplicationColumnsV2({
    onSelect,
    onApprove,
    onReject,
    onChat,
    onRevoke,
    unreadCounts = {}
}: ApplicationColumnsConfig): ColumnDef<Application>[] {
    return [
        {
            accessorKey: "fullName",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="pl-0 font-semibold text-gray-700"
                >
                    Applicant
                    <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
                </Button>
            ),
            cell: ({ row }) => {
                const app = row.original;
                const initials = app.fullName
                    ?.split(' ')
                    .map(n => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2) || 'CH';

                return (
                    <div 
                        className="flex items-center gap-3 cursor-pointer group"
                        onClick={() => onSelect(app)}
                    >
                        <Avatar className="h-9 w-9 border-2 border-[#208D80]/20">
                            <AvatarFallback className="bg-[#208D80]/10 text-[#208D80] text-xs font-semibold">
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col min-w-0">
                            <span className="font-medium text-gray-900 group-hover:text-[#208D80] transition-colors truncate">
                                {app.fullName}
                            </span>
                            <span className="text-xs text-gray-500 truncate">{app.email}</span>
                        </div>
                    </div>
                )
            },
        },
        {
            accessorKey: "location",
            header: "Location",
            cell: ({ row }) => {
                const location = row.original.location;
                return location ? (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Building2 className="h-3.5 w-3.5 text-gray-400" />
                        <span className="truncate max-w-[150px]">{location.name}</span>
                    </div>
                ) : (
                    <span className="text-gray-400 text-sm">—</span>
                );
            },
        },
        {
            id: "progress",
            header: "Progress",
            cell: ({ row }) => <StepProgress application={row.original} />,
        },
        {
            accessorKey: "status",
            header: "Status",
            cell: ({ row }) => <ApplicationStatusBadge application={row.original} />,
            filterFn: (row, id, value) => {
                if (value === 'all') return true;
                const app = row.original;
                const tier = app.current_tier ?? 1;
                const hasStep2 = !!app.tier2_completed_at;
                
                switch (value) {
                    case 'pending':
                        return app.status === 'inReview' || (app.status === 'approved' && tier === 2 && hasStep2);
                    case 'awaiting-step2':
                        return app.status === 'approved' && tier === 1;
                    case 'approved':
                        return app.status === 'approved' && tier >= 3;
                    case 'rejected':
                        return app.status === 'rejected';
                    default:
                        return true;
                }
            },
        },
        {
            id: "documents",
            header: "Documents",
            cell: ({ row }) => <DocumentIndicators application={row.original} />,
        },
        {
            accessorKey: "createdAt",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                    className="font-semibold text-gray-700"
                >
                    Applied
                    <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
                </Button>
            ),
            cell: ({ row }) => (
                <span className="text-sm text-gray-600">
                    {new Date(row.getValue("createdAt")).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    })}
                </span>
            ),
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const app = row.original;
                const unreadCount = unreadCounts[app.id] || 0;
                const canChat = app.status === 'approved' || app.chat_conversation_id;
                const tier = app.current_tier ?? 1;
                const isFullyApproved = app.status === 'approved' && tier >= 3;

                return (
                    <div className="flex items-center justify-end gap-1">
                        {canChat && onChat && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onChat(app);
                                }}
                                className="h-8 w-8 p-0 relative"
                            >
                                <MessageCircle className="h-4 w-4 text-gray-500" />
                                {unreadCount > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                )}
                            </Button>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                
                                <DropdownMenuItem onClick={() => onSelect(app)}>
                                    <Eye className="mr-2 h-4 w-4" />
                                    View Details
                                </DropdownMenuItem>

                                {canChat && onChat && (
                                    <DropdownMenuItem onClick={() => onChat(app)}>
                                        <MessageCircle className="mr-2 h-4 w-4" />
                                        Open Chat
                                        {unreadCount > 0 && (
                                            <Badge variant="secondary" className="ml-auto text-xs">
                                                {unreadCount}
                                            </Badge>
                                        )}
                                    </DropdownMenuItem>
                                )}

                                {app.status === "inReview" && (
                                    <>
                                        <DropdownMenuSeparator />
                                        {onApprove && (
                                            <DropdownMenuItem 
                                                onClick={() => onApprove(app)} 
                                                className="text-emerald-600 focus:text-emerald-600"
                                            >
                                                <Check className="mr-2 h-4 w-4" />
                                                Approve Step 1
                                            </DropdownMenuItem>
                                        )}
                                        {onReject && (
                                            <DropdownMenuItem 
                                                onClick={() => onReject(app)} 
                                                className="text-red-600 focus:text-red-600"
                                            >
                                                <X className="mr-2 h-4 w-4" />
                                                Reject
                                            </DropdownMenuItem>
                                        )}
                                    </>
                                )}

                                {isFullyApproved && onRevoke && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem 
                                            onClick={() => onRevoke(app)} 
                                            className="text-red-600 focus:text-red-600"
                                        >
                                            <Ban className="mr-2 h-4 w-4" />
                                            Revoke Access
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )
            },
        },
    ]
}
