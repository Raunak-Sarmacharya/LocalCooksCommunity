"use client"

import { useState } from "react"
import { DataTable } from "@/components/ui/data-table"
import { getApplicationColumns } from "../columns"
import { Application, ApplicationsTableProps } from "../types"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function ApplicationsTable({
    data,
    isLoading,
    onApprove,
    onReject,
    onOpenChat,
    onViewDocuments,
    onReview
}: ApplicationsTableProps) {
    const columns = getApplicationColumns({
        onApprove,
        onReject,
        onChat: onOpenChat,
        onViewDocuments,
        onReview
    })

    const [statusFilter, setStatusFilter] = useState<string>("all")

    // Filter logic handled by DataTable or pre-filtered data passed in?
    // The previous implementation had Tabs. 
    // We can filter the data here before passing to DataTable or use DataTable's column filtering.
    // Let's filter here for simplicity to mimic the Tabs behavior but in a table view

    const filteredData = data.filter(app => {
        if (statusFilter === "all") return true;
        if (statusFilter === "pending") return app.status === "inReview";
        return app.status === statusFilter;
    });

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 w-full max-w-sm">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Filter by status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Applications</SelectItem>
                            <SelectItem value="pending">Pending Review</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <DataTable
                columns={columns}
                data={filteredData}
                filterColumn="fullName"
                filterPlaceholder="Filter by applicant name..."
            />
        </div>
    )
}
