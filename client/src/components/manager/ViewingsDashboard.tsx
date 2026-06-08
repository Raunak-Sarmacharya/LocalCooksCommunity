/**
 * ViewingsDashboard
 *
 * Manager-facing dashboard for viewing and managing all kitchen viewing bookings.
 * Shows upcoming and past viewings with intake data, status controls, and no-show tracking.
 * Built mobile-first with shadcn/ui components.
 */

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Eye,
  Clock,
  User,
  Loader2,
  MoreHorizontal,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Calendar,
  MapPin,
  RefreshCw,
  Briefcase,
  FileText,
  Settings,
} from "lucide-react"
import { toast } from "sonner"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { format, isPast, isFuture } from "date-fns"
import ViewingSettingsPanel from "./ViewingSettingsPanel"

// ─── Auth Helper ──────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentUser = auth.currentUser
  if (currentUser) {
    const token = await currentUser.getIdToken()
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }
  }
  return { "Content-Type": "application/json" }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ViewingRecord {
  viewing: {
    id: number
    locationId: number
    targetedKitchenId: number | null
    chefId: number
    managerId: number | null
    status: string
    scheduledAt: string
    durationMinutes: number
    chefNotes: string | null
    managerNotes: string | null
    noShowReason: string | null
    intakeData: Record<string, any>
    cancelledBy: string | null
    cancellationReason: string | null
    cancelledAt: string | null
    completedAt: string | null
    createdAt: string
    updatedAt: string
  }
  locationName: string | null
  locationAddress: string | null
  kitchenName: string | null
  chefUsername: string | null
  chefName?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusBadge(status: string) {
  switch (status) {
    case "confirmed":
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
          <CheckCircle className="h-3 w-3 mr-1" />
          Confirmed
        </Badge>
      )
    case "pending":
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" />
          Pending
        </Badge>
      )
    case "cancelled":
      return (
        <Badge variant="secondary">
          <XCircle className="h-3 w-3 mr-1" />
          Cancelled
        </Badge>
      )
    case "completed":
      return (
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
          <CheckCircle className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      )
    case "no_show":
      return (
        <Badge variant="destructive">
          <AlertTriangle className="h-3 w-3 mr-1" />
          No Show
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function getIntakeLabel(key: string): string {
  const labels: Record<string, string> = {
    intendedUse: "Intended Use",
    estimatedWeeklyHours: "Weekly Hours",
    hasLicense: "Has License",
    targetStartDate: "Target Start",
    additionalInfo: "Notes",
  }
  return labels[key] || key
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ViewingsDashboardProps {
  locationId?: number
}

export function ViewingsDashboard({ locationId }: ViewingsDashboardProps) {
  const queryClient = useQueryClient()
  const [selectedViewing, setSelectedViewing] = useState<ViewingRecord | null>(null)
  const [statusAction, setStatusAction] = useState<string>("")
  const [managerNotes, setManagerNotes] = useState("")
  const [noShowReason, setNoShowReason] = useState("")
  const [cancellationReason, setCancellationReason] = useState("")
  const [activeTab, setActiveTab] = useState("upcoming")
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // Fetch viewings
  const queryUrl = locationId
    ? `/api/viewings/manager?locationId=${locationId}`
    : `/api/viewings/manager`

  const { data: viewings, isLoading, refetch } = useQuery<ViewingRecord[]>({
    queryKey: [queryUrl],
    refetchInterval: 30000, // Poll every 30s
    refetchOnWindowFocus: true,
  })

  // Status update mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({
      viewingId,
      status,
      notes,
      noShow,
      cancelReason,
    }: {
      viewingId: number
      status: string
      notes?: string
      noShow?: string
      cancelReason?: string
    }) => {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/viewings/${viewingId}/status`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({
          status,
          managerNotes: notes || undefined,
          noShowReason: noShow || undefined,
          cancellationReason: cancelReason || undefined,
          cancelledBy: status === "cancelled" ? "manager" : undefined,
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || "Failed to update status")
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryUrl] })
      closeSheet()
      toast.success("Viewing status updated!")
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const closeSheet = () => {
    setSelectedViewing(null)
    setStatusAction("")
    setManagerNotes("")
    setNoShowReason("")
    setCancellationReason("")
  }

  const handleStatusAction = (viewing: ViewingRecord, action: string) => {
    setSelectedViewing(viewing)
    setStatusAction(action)
    setManagerNotes(viewing.viewing.managerNotes || "")
  }

  // Split viewings into upcoming/past
  const upcoming =
    viewings?.filter(
      (v) =>
        isFuture(new Date(v.viewing.scheduledAt)) &&
        !["cancelled", "completed", "no_show"].includes(v.viewing.status)
    ) || []

  const past =
    viewings?.filter(
      (v) =>
        isPast(new Date(v.viewing.scheduledAt)) ||
        ["cancelled", "completed", "no_show"].includes(v.viewing.status)
    ) || []

  // Stats
  const confirmedCount = upcoming.filter((v) => v.viewing.status === "confirmed").length
  const pendingCount = upcoming.filter((v) => v.viewing.status === "pending").length

  const renderViewingRow = (record: ViewingRecord) => {
    const { viewing } = record
    const chefName = record.chefName || record.chefUsername?.split("@")[0] || `Chef #${viewing.chefId}`
    const hasIntake =
      viewing.intakeData && Object.keys(viewing.intakeData).length > 0

    return (
      <TableRow
        key={viewing.id}
        className={cn(
          viewing.status === "no_show" && "bg-red-50/50",
          viewing.status === "cancelled" && "opacity-60"
        )}
      >
        <TableCell className="whitespace-nowrap">
          <div className="text-xs sm:text-sm font-medium">
            {format(new Date(viewing.scheduledAt), "MMM d, yyyy")}
          </div>
          <div className="text-xs text-muted-foreground">
            {format(new Date(viewing.scheduledAt), "h:mm a")} ·{" "}
            {viewing.durationMinutes}min
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5 text-xs sm:text-sm">
            <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <span className="truncate max-w-[100px] sm:max-w-none">{chefName}</span>
          </div>
          {hasIntake && (
            <div className="flex items-center gap-1 mt-0.5">
              <FileText className="h-3 w-3 text-blue-500" />
              <span className="text-[10px] text-blue-600">Has intake data</span>
            </div>
          )}
        </TableCell>
        <TableCell className="hidden sm:table-cell">
          <div className="text-xs sm:text-sm truncate max-w-[150px]">
            {record.locationName || "—"}
          </div>
          {record.kitchenName && (
            <div className="text-xs text-muted-foreground">
              {record.kitchenName}
            </div>
          )}
        </TableCell>
        <TableCell>{getStatusBadge(viewing.status)}</TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleStatusAction(record, "view")}>
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {viewing.status === "pending" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleStatusAction(record, "confirm")}
                    className="text-green-600"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Confirm Viewing
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleStatusAction(record, "cancel")}
                    className="text-destructive"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Decline Request
                  </DropdownMenuItem>
                </>
              )}
              {viewing.status === "confirmed" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleStatusAction(record, "complete")}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Mark Completed
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleStatusAction(record, "no_show")}
                    className="text-amber-600"
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Mark No-Show
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleStatusAction(record, "cancel")}
                    className="text-destructive"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel Viewing
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    )
  }

  const renderTable = (data: ViewingRecord[], emptyMessage: string) => {
    if (data.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <Eye className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">{emptyMessage}</p>
        </div>
      )
    }

    return (
      <div className="rounded-md border overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs sm:text-sm">Date & Time</TableHead>
              <TableHead className="text-xs sm:text-sm">Chef</TableHead>
              <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Location</TableHead>
              <TableHead className="text-xs sm:text-sm">Status</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{data.map(renderViewingRow)}</TableBody>
        </Table>
      </div>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Eye className="h-5 w-5 text-primary" />
                Kitchen Viewings
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Manage viewing bookings and track chef visits.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                <RefreshCw className={cn("h-4 w-4 mr-1", isLoading && "animate-spin")} />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setIsSettingsOpen(true)}
                title="Viewing Settings"
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          {/* Stats badges */}
          {viewings && viewings.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                {confirmedCount} Upcoming
              </Badge>
              {pendingCount > 0 && (
                <Badge variant="outline">{pendingCount} Pending</Badge>
              )}
              <Badge variant="secondary">{past.length} Past</Badge>
            </div>
          )}
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="upcoming" className="text-xs sm:text-sm">
                  Upcoming ({upcoming.length})
                </TabsTrigger>
                <TabsTrigger value="past" className="text-xs sm:text-sm">
                  Past ({past.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upcoming" className="mt-4">
                {renderTable(upcoming, "No upcoming viewings.")}
              </TabsContent>

              <TabsContent value="past" className="mt-4">
                {renderTable(past, "No past viewings.")}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* Detail / Action Sheet */}
      <Sheet open={selectedViewing !== null} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedViewing && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {statusAction === "view" && "Viewing Details"}
                  {statusAction === "confirm" && "Confirm Viewing Request"}
                  {statusAction === "complete" && "Mark as Completed"}
                  {statusAction === "no_show" && "Mark as No-Show"}
                  {statusAction === "cancel" && "Cancel Viewing"}
                </SheetTitle>
                <SheetDescription>
                  {format(
                    new Date(selectedViewing.viewing.scheduledAt),
                    "EEEE, MMM d 'at' h:mm a"
                  )}
                </SheetDescription>
              </SheetHeader>

              <div className="py-4 space-y-4">
                {/* Viewing Info */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Chef</span>
                    <span>
                      {selectedViewing.chefName || selectedViewing.chefUsername?.split("@")[0] ||
                        `Chef #${selectedViewing.viewing.chefId}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Location</span>
                    <span>{selectedViewing.locationName || "—"}</span>
                  </div>
                  {selectedViewing.kitchenName && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Kitchen Interest</span>
                      <span>{selectedViewing.kitchenName}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Duration</span>
                    <span>{selectedViewing.viewing.durationMinutes} minutes</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    {getStatusBadge(selectedViewing.viewing.status)}
                  </div>
                </div>

                {/* Chef Notes */}
                {selectedViewing.viewing.chefNotes && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Chef's Notes
                      </p>
                      <p className="text-sm bg-muted/50 p-2 rounded">
                        {selectedViewing.viewing.chefNotes}
                      </p>
                    </div>
                  </>
                )}

                {/* Intake Data */}
                {selectedViewing.viewing.intakeData &&
                  Object.keys(selectedViewing.viewing.intakeData).length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          Pre-Viewing Screening
                        </p>
                        <div className="space-y-1.5 bg-blue-50/50 p-3 rounded-md border border-blue-100">
                          {Object.entries(selectedViewing.viewing.intakeData)
                            .filter(([_, v]) => v !== undefined && v !== "")
                            .map(([key, value]) => (
                              <div
                                key={key}
                                className="flex justify-between text-xs sm:text-sm"
                              >
                                <span className="text-muted-foreground">
                                  {getIntakeLabel(key)}
                                </span>
                                <span className="font-medium">
                                  {typeof value === "boolean"
                                    ? value
                                      ? "Yes"
                                      : "No"
                                    : String(value).replace(/_/g, " ")}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    </>
                  )}

                {/* Action Forms */}
                {statusAction !== "view" && (
                  <>
                    <Separator />

                    {statusAction === "no_show" && (
                      <div className="space-y-2">
                        <Label className="text-sm">No-Show Reason</Label>
                        <Select
                          value={noShowReason}
                          onValueChange={setNoShowReason}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select reason" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="chef_cancelled_late">
                              Chef cancelled late
                            </SelectItem>
                            <SelectItem value="chef_no_response">
                              Chef didn't respond
                            </SelectItem>
                            <SelectItem value="rescheduled_by_manager">
                              Rescheduled by manager
                            </SelectItem>
                            <SelectItem value="weather">Weather</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {statusAction === "cancel" && (
                      <div className="space-y-2">
                        <Label className="text-sm">Cancellation Reason</Label>
                        <Textarea
                          value={cancellationReason}
                          onChange={(e) => setCancellationReason(e.target.value)}
                          placeholder="Reason for cancellation..."
                          rows={2}
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label className="text-sm">Manager Notes (optional)</Label>
                      <Textarea
                        value={managerNotes}
                        onChange={(e) => setManagerNotes(e.target.value)}
                        placeholder="Internal notes..."
                        rows={2}
                      />
                    </div>
                  </>
                )}
              </div>

              {statusAction !== "view" && (
                <SheetFooter className="flex flex-col sm:flex-row gap-2 mt-4">
                  <Button
                    variant="outline"
                    onClick={closeSheet}
                    className="w-full sm:w-auto"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() =>
                      updateStatusMutation.mutate({
                        viewingId: selectedViewing.viewing.id,
                        status:
                          statusAction === "complete"
                            ? "completed"
                            : statusAction === "confirm"
                            ? "confirmed"
                            : statusAction === "no_show"
                            ? "no_show"
                            : "cancelled",
                        notes: managerNotes,
                        noShow: noShowReason,
                        cancelReason: cancellationReason,
                      })
                    }
                    disabled={
                      updateStatusMutation.isPending ||
                      (statusAction === "no_show" && !noShowReason)
                    }
                    className={cn(
                      "w-full sm:w-auto",
                      statusAction === "cancel" && "bg-destructive hover:bg-destructive/90",
                      statusAction === "no_show" && "bg-amber-600 hover:bg-amber-700"
                    )}
                  >
                    {updateStatusMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    {statusAction === "confirm" && "Confirm Viewing"}
                    {statusAction === "complete" && "Mark Completed"}
                    {statusAction === "no_show" && "Confirm No-Show"}
                    {statusAction === "cancel" && "Cancel Viewing"}
                  </Button>
                </SheetFooter>
              )}

              {statusAction === "view" && selectedViewing.viewing.status === "pending" && (
                <SheetFooter className="flex flex-col sm:flex-row gap-2 mt-4 pt-4 border-t">
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setStatusAction("cancel")}
                  >
                    Decline Request
                  </Button>
                  <Button
                    className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
                    onClick={() => setStatusAction("confirm")}
                  >
                    Accept Viewing
                  </Button>
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Settings Sheet */}
      <Sheet open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle>Viewing Settings</SheetTitle>
            <SheetDescription>
              Configure how chefs can book viewings at this location.
            </SheetDescription>
          </SheetHeader>
          <div className="py-2">
            {locationId ? (
              <ViewingSettingsPanel locationId={locationId} />
            ) : (
              <div className="text-center py-12 text-muted-foreground border rounded-lg bg-gray-50/50">
                <Settings className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">Select a location to manage settings</p>
                <p className="text-xs mt-1">Viewing settings are configured per-location.</p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default ViewingsDashboard
