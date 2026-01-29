"use client"

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal, Pencil, MapPin, ExternalLink, Settings } from "lucide-react"

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

// Define the Location type based on what's used in the app
export type LocationData = {
    id: number
    name: string
    address: string
    kitchenLicenseStatus?: string
    notificationEmail?: string
    // Add other fields as needed
}

interface LocationColumnsProps {
    onEdit: (location: LocationData) => void;
    onManage: (location: LocationData) => void;
    onViewDetails: (location: LocationData) => void;
}

export const getLocationColumns = ({ onEdit, onManage, onViewDetails }: LocationColumnsProps): ColumnDef<LocationData>[] => [
    {
        accessorKey: "name",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Name
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => (
            <div className="font-medium">{row.getValue("name")}</div>
        ),
    },
    {
        accessorKey: "address",
        header: "Address",
        cell: ({ row }) => <div className="max-w-[300px] truncate">{row.getValue("address")}</div>,
    },
    {
        accessorKey: "kitchenLicenseStatus",
        header: "Status",
        cell: ({ row }) => {
            const status = row.getValue("kitchenLicenseStatus") as string

            let variant: "default" | "secondary" | "destructive" | "outline" = "secondary"
            let label = "Pending"

            if (status === 'approved') {
                variant = "default" // Or a custom 'success' variant if available in Badge
                label = "Approved"
            } else if (status === 'rejected') {
                variant = "destructive"
                label = "Rejected"
            } else {
                variant = "secondary" // Pending
                label = "Pending"
            }

            return (
                <Badge variant={variant} className="capitalize">
                    {label}
                </Badge>
            )
        },
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const location = row.original

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
                        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(location.name)}>
                            Copy Location Name
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onManage(location)}>
                            <Settings className="mr-2 h-4 w-4" />
                            Manage Settings
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(location)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onViewDetails(location)}>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            View Details
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    },
]
