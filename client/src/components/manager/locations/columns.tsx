"use client"
import { mt } from "@/i18n/manager";

import { ColumnDef } from "@tanstack/react-table"
import { ArrowUpDown, MoreHorizontal, Pencil, Settings } from "lucide-react"

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
}

export const getLocationColumns = ({ onEdit, onManage }: LocationColumnsProps): ColumnDef<LocationData>[] => [
    {
        accessorKey: "name",
        header: ({ column }) => {
            return (
                <Button
                    variant="ghost"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >{mt("name")}<ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        cell: ({ row }) => (
            <div className="font-medium">{row.getValue("name")}</div>
        ),
    },
    {
        accessorKey: "address",
        header: mt("address"),
        cell: ({ row }) => <div className="max-w-[300px] truncate">{row.getValue("address")}</div>,
    },
    {
        accessorKey: "kitchenLicenseStatus",
        header: mt("status"),
        cell: ({ row }) => {
            const status = row.getValue("kitchenLicenseStatus") as string

            let variant: "success" | "secondary" | "destructive" | "warning" = "warning"
            let label = mt("pending")

            if (status === 'approved') {
                variant = "success"
                label = mt("approved")
            } else if (status === 'rejected') {
                variant = "destructive"
                label = mt("rejected")
            } else {
                variant = "warning"
                label = mt("pending")
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
                            <span className="sr-only">{mt("openMenu")}</span>
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{mt("actions")}</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(location.name)}>{mt("copyLocationName")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(location)}>
                            <Pencil className="mr-2 h-4 w-4" />{mt("editDetails")}</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    },
]
