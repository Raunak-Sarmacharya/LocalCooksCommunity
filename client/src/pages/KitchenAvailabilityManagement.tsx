import { logger } from "@/lib/logger";
import { Calendar as CalendarIcon, Save, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ManagerPageLayout } from "@/components/layout/ManagerPageLayout";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// --- Types ---
interface DateAvailability {
  id: number;
  kitchenId: number;
  specificDate: string;
  specific_date?: string;
  startTime: string | null;
  start_time?: string | null;
  endTime: string | null;
  end_time?: string | null;
  isAvailable: boolean;
  is_available?: boolean;
  reason: string | null;
  maxSlotsPerChef?: number;
  max_slots_per_chef?: number;
  createdAt: string;
  updatedAt: string;
}

interface Booking {
  id: number;
  kitchenId: number;
  chefId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface WeeklyScheduleItem {
  dayOfWeek?: number;
  day_of_week?: number;
  isAvailable?: boolean;
  is_available?: boolean;
  startTime?: string;
  start_time?: string;
  endTime?: string;
  end_time?: string;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const { auth } = await import('@/lib/firebase');
  const currentFirebaseUser = auth.currentUser;
  if (currentFirebaseUser) {
    try {
      const token = await currentFirebaseUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    } catch (error) {
      logger.error('Error getting Firebase token:', error);
    }
  }
  return headers;
}

interface KitchenAvailabilityManagementProps {
  embedded?: boolean;
  initialLocationId?: number;
  initialKitchenId?: number;
  onSaveSuccess?: () => void; // [NEW] Callback when availability is saved
}

export default function KitchenAvailabilityManagement({
  embedded = false,
  initialLocationId,
  initialKitchenId,
  onSaveSuccess
}: KitchenAvailabilityManagementProps) {
  if (embedded) {
    // If embedded, we expect IDs to be passed.
    // If not, we can show a placeholder or just try to render with nulls (which Content handles).
    return (
      <AvailabilityContent
        selectedLocationId={initialLocationId || null}
        selectedKitchenId={initialKitchenId || null}
        onSaveSuccess={onSaveSuccess}
      />
    );
  }

  return (
    <ManagerPageLayout
      title="Availability Management"
      description="Manage recurring schedules and specific date availability"
      showKitchenSelector={true}
    >
      {({ selectedLocationId, selectedKitchenId, isLoading }) => {
        if (isLoading) {
          return (
            <div className="space-y-6">
              <Skeleton className="h-[300px] w-full" />
              <Skeleton className="h-[500px] w-full" />
            </div>
          );
        }
        return (
          <AvailabilityContent
            selectedLocationId={selectedLocationId}
            selectedKitchenId={selectedKitchenId}
          />
        );
      }}
    </ManagerPageLayout>
  );
}

function AvailabilityContent({
  selectedLocationId,
  selectedKitchenId,
  onSaveSuccess
}: {
  selectedLocationId: number | null,
  selectedKitchenId: number | null,
  onSaveSuccess?: () => void
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [date, setDate] = useState<Date | undefined>(new Date());
  const [activeTab, setActiveTab] = useState("weekly");

  // State for date exception dialog
  const [isExceptionDialogOpen, setIsExceptionDialogOpen] = useState(false);
  const [selectedException, setSelectedException] = useState<DateAvailability | null>(null);
  const [exceptionForm, setExceptionForm] = useState({
    isAvailable: false,
    reason: "",
    startTime: "09:00",
    endTime: "17:00",
    maxSlotsPerChef: 1,
  });

  // Alert Dialog State
  const [alertConfig, setAlertConfig] = useState<{
    open: boolean;
    title: string;
    description: string;
    actionType: 'save' | 'delete';
    onConfirm: () => void;
  }>({
    open: false,
    title: "",
    description: "",
    actionType: 'save',
    onConfirm: () => { },
  });

  // State for weekly schedule
  const [weeklySchedule, setWeeklySchedule] = useState<Record<number, WeeklyScheduleItem>>({});
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Queries
  const { data: availabilityExceptions = [], isLoading: isLoadingExceptions } = useQuery({
    queryKey: ['/api/manager/kitchens/date-overrides', selectedKitchenId],
    queryFn: async () => {
      if (!selectedKitchenId) return [];
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/manager/kitchens/${selectedKitchenId}/date-overrides`, { headers });
      if (!res.ok) throw new Error('Failed to fetch exceptions');
      const data = await res.json();

      // Sort exceptions by date ascending
      return data.sort((a: any, b: any) => {
        const dateA = new Date(a.specificDate || a.specific_date).getTime();
        const dateB = new Date(b.specificDate || b.specific_date).getTime();
        return dateA - dateB;
      });
    },
    enabled: !!selectedKitchenId
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ['/api/manager/bookings', selectedKitchenId],
    queryFn: async () => {
      if (!selectedKitchenId) return [];
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/manager/bookings?kitchenId=${selectedKitchenId}`, { headers });
      if (!res.ok) throw new Error('Failed to fetch bookings');
      return res.json();
    },
    enabled: !!selectedKitchenId
  });

  // Load Weekly Schedule
  const loadWeeklySchedule = useCallback(async () => {
    if (!selectedKitchenId) return;

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/availability/${selectedKitchenId}`, { headers });

      if (response.ok) {
        const data = await response.json();
        const scheduleMap: Record<number, WeeklyScheduleItem> = {};
        [0, 1, 2, 3, 4, 5, 6].forEach(day => {
          scheduleMap[day] = { dayOfWeek: day, isAvailable: false, startTime: "09:00", endTime: "17:00" };
        });

        if (Array.isArray(data)) {
          data.forEach((item: any) => {
            const dayOfW = item.dayOfWeek !== undefined ? item.dayOfWeek : item.day_of_week;
            if (dayOfW !== undefined) {
              scheduleMap[dayOfW] = {
                dayOfWeek: dayOfW,
                isAvailable: item.isAvailable !== undefined ? item.isAvailable : item.is_available,
                startTime: item.startTime || item.start_time || "09:00",
                endTime: item.endTime || item.end_time || "17:00"
              };
            }
          });
        }
        setWeeklySchedule(scheduleMap);
      }
    } catch (error) {
      logger.error("Failed to load schedule", error);
    }
  }, [selectedKitchenId]);

  useEffect(() => {
    if (selectedKitchenId) {
      loadWeeklySchedule();
    }
  }, [selectedKitchenId, loadWeeklySchedule]);

  // Mutations
  const createAvailability = useMutation({
    mutationFn: async (data: any) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/manager/kitchens/${selectedKitchenId}/date-overrides`, {
        method: 'POST', headers, body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/manager/kitchens/date-overrides', selectedKitchenId] });
      setIsExceptionDialogOpen(false);
      toast({ title: "Success", description: "Exception saved successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const updateAvailability = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: any }) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/manager/date-overrides/${id}`, {
        method: 'PUT', headers, body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/manager/kitchens/date-overrides', selectedKitchenId] });
      setIsExceptionDialogOpen(false);
      toast({ title: "Success", description: "Exception updated successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const deleteAvailability = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/manager/date-overrides/${id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/manager/kitchens/date-overrides', selectedKitchenId] });
      setIsExceptionDialogOpen(false);
      toast({ title: "Success", description: "Exception removed successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });


  const handleSaveWeeklySchedule = async () => {
    if (!selectedKitchenId) return;
    setIsSavingSchedule(true);
    try {
      const headers = await getAuthHeaders();
      const scheduleArray = Object.values(weeklySchedule).map(item => ({
        kitchenId: selectedKitchenId,
        dayOfWeek: item.dayOfWeek,
        isAvailable: item.isAvailable,
        startTime: item.startTime,
        endTime: item.endTime
      }));

      // Naive sequential save to ensure reliability
      for (const item of scheduleArray) {
        await fetch("/api/manager/availability", { method: "POST", headers, body: JSON.stringify(item) });
      }
      toast({ title: "Success", description: "Weekly schedule saved" });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/availability', selectedKitchenId] });
      // [NEW] Notify parent that save was successful
      if (onSaveSuccess) {
        onSaveSuccess();
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to save", variant: "destructive" });
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const handleDateClick = (clickedDate: Date | undefined) => {
    if (!clickedDate) return;
    setDate(clickedDate);

    // Check for existing exception
    const dateStr = format(clickedDate, 'yyyy-MM-dd');
    const existing = availabilityExceptions.find((ex: any) => {
      const rawDate = ex.specificDate || ex.specific_date;
      if (!rawDate) return false;
      // Extract just the date part (YYYY-MM-DD) from the ISO string to avoid shift
      const exceptionDateStr = typeof rawDate === 'string' ? rawDate.split('T')[0] : format(new Date(rawDate), 'yyyy-MM-dd');
      return exceptionDateStr === dateStr;
    });

    if (existing) {
      setSelectedException(existing);
      setExceptionForm({
        isAvailable: existing.isAvailable ?? false,
        reason: existing.reason || "",
        startTime: existing.startTime || "09:00",
        endTime: existing.endTime || "17:00",
        maxSlotsPerChef: existing.maxSlotsPerChef || 1
      });
    } else {
      setSelectedException(null);
      // Initialize with weekly default for that day
      const dayOfWeek = clickedDate.getDay();
      const weekly = weeklySchedule[dayOfWeek];
      setExceptionForm({
        isAvailable: weekly ? (weekly.isAvailable ?? false) : false,
        reason: "",
        startTime: weekly?.startTime || "09:00",
        endTime: weekly?.endTime || "17:00",
        maxSlotsPerChef: 1
      });
    }
    setIsExceptionDialogOpen(true);
  };

  const handleSaveException = () => {
    if (!date) return;
    const dateStr = format(date, 'yyyy-MM-dd');

    // Validation
    if (exceptionForm.isAvailable && (!exceptionForm.startTime || !exceptionForm.endTime)) {
      toast({ title: "Error", description: "Start and End times are required when available", variant: 'destructive' });
      return;
    }

    const payload = {
      specificDate: dateStr,
      startTime: exceptionForm.isAvailable ? exceptionForm.startTime : null,
      endTime: exceptionForm.isAvailable ? exceptionForm.endTime : null,
      isAvailable: exceptionForm.isAvailable,
      reason: exceptionForm.reason,
      maxSlotsPerChef: exceptionForm.maxSlotsPerChef
    };

    // Check for conflicts if closing a date with bookings
    if (!exceptionForm.isAvailable) {
      const hasBookings = bookings.some((b: Booking) => format(new Date(b.bookingDate), 'yyyy-MM-dd') === dateStr);
      if (hasBookings) {
        setAlertConfig({
          open: true,
          title: "Conflict Warning",
          description: "This date has existing bookings. Closing it will affect chefs. Continue?",
          actionType: 'save',
          onConfirm: () => {
            if (selectedException) updateAvailability.mutate({ id: selectedException.id, data: payload });
            else createAvailability.mutate(payload);
            setAlertConfig(prev => ({ ...prev, open: false }));
          }
        });
        return;
      }
    }

    if (selectedException) {
      updateAvailability.mutate({ id: selectedException.id, data: payload });
    } else {
      createAvailability.mutate(payload);
    }
  };

  const handleDeleteException = () => {
    if (!selectedException) return;
    setAlertConfig({
      open: true,
      title: "Confirm Deletion",
      description: "Are you sure you want to remove this exception? The schedule will revert to weekly defaults.",
      actionType: 'delete',
      onConfirm: () => {
        deleteAvailability.mutate(selectedException.id);
        setAlertConfig(prev => ({ ...prev, open: false }));
      }
    });
  };


  if (!selectedKitchenId) {
    return (
      <Card className="border-dashed h-full">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground h-full">
          <CalendarIcon className="h-12 w-12 mb-4 opacity-20" />
          <h3 className="text-lg font-medium text-foreground mb-1">No Kitchen Selected</h3>
          <p>Select a location and kitchen from the sidebar to manage availability.</p>
        </CardContent>
      </Card>
    );
  }

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
      <Tabs defaultValue="weekly" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="weekly">Weekly Schedule</TabsTrigger>
          <TabsTrigger value="calendar">Exceptions & Calendar</TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="space-y-4 mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="space-y-1">
                <CardTitle>Recurring Weekly Hours</CardTitle>
                <CardDescription>Default hours of operation for this kitchen.</CardDescription>
              </div>
              <Button onClick={handleSaveWeeklySchedule} disabled={isSavingSchedule}>
                {isSavingSchedule ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Schedule
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Day</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead>Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {days.map((dayName, index) => {
                      const schedule = weeklySchedule[index] || { isAvailable: false, startTime: "09:00", endTime: "17:00" };
                      return (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{dayName}</TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              <Switch
                                checked={schedule.isAvailable ?? false}
                                onCheckedChange={(checked) => {
                                  setWeeklySchedule(prev => ({
                                    ...prev,
                                    [index]: { ...prev[index], isAvailable: checked, dayOfWeek: index }
                                  }));
                                }}
                              />
                              <Badge variant={schedule.isAvailable ? "outline" : "secondary"} className={cn("w-16 justify-center", !schedule.isAvailable && "opacity-50")}>
                                {schedule.isAvailable ? "Open" : "Closed"}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            {schedule.isAvailable ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  type="time"
                                  className="w-28 h-8 text-sm"
                                  value={schedule.startTime || "09:00"}
                                  onChange={(e) => {
                                    setWeeklySchedule(prev => ({
                                      ...prev,
                                      [index]: { ...prev[index], startTime: e.target.value }
                                    }));
                                  }}
                                />
                                <span className="text-muted-foreground text-xs">–</span>
                                <Input
                                  type="time"
                                  className="w-28 h-8 text-sm"
                                  value={schedule.endTime || "17:00"}
                                  onChange={(e) => {
                                    setWeeklySchedule(prev => ({
                                      ...prev,
                                      [index]: { ...prev[index], endTime: e.target.value }
                                    }));
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="h-8 flex items-center">
                                <span className="text-sm text-muted-foreground italic">Unavailable</span>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="mt-6">
          {/* Changed md:grid-cols-2 to xl:grid-cols-2 to ensure Calendar has enough space */}
          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="overflow-hidden flex flex-col justify-between">
              <CardHeader>
                <CardTitle>Calendar Overview</CardTitle>
                <CardDescription>Click a date to manage availability exceptions.</CardDescription>
              </CardHeader>
              <CardContent className="p-4 flex justify-center items-center">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={handleDateClick}
                  className="p-3 w-full"
                  modifiers={{
                    updated: (d) => availabilityExceptions.some((ex: any) => {
                      const rawDate = ex.specificDate || ex.specific_date;
                      const exceptionDateStr = typeof rawDate === 'string' ? rawDate.split('T')[0] : format(new Date(rawDate), 'yyyy-MM-dd');
                      return exceptionDateStr === format(d, 'yyyy-MM-dd');
                    }),
                    booked: (d) => bookings.some((b: any) => {
                      const bookingDateStr = typeof b.bookingDate === 'string' ? b.bookingDate.split('T')[0] : format(new Date(b.bookingDate), 'yyyy-MM-dd');
                      return bookingDateStr === format(d, 'yyyy-MM-dd');
                    })
                  }}
                  modifiersClassNames={{
                    updated: "bg-primary/10 text-primary font-bold rounded-full",
                    booked: "after:content-['•'] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:text-destructive after:text-lg"
                  }}
                />
              </CardContent>
              <div className="p-4 border-t bg-muted/10">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="h-2 w-2 p-0 rounded-full border-primary bg-primary/20" />
                    <span>Has overrides</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="h-2 w-2 p-0 rounded-full" />
                    <span>Has bookings</span>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="flex flex-col h-full">
              <CardHeader>
                <CardTitle>Upcoming Exceptions</CardTitle>
                <CardDescription>Deviations from standard weekly hours</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto p-0">
                {isLoadingExceptions ? (
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : availabilityExceptions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <CalendarIcon className="h-10 w-10 mb-2 opacity-20" />
                    <p>No exceptions found.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {availabilityExceptions.map((ex: any) => (
                        <TableRow key={ex.id}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span>{format(new Date(ex.specificDate || ex.specific_date), 'MMM d, yyyy')}</span>
                              {ex.reason && <span className="text-xs text-muted-foreground italic truncate max-w-[120px]">{ex.reason}</span>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {ex.isAvailable ? (
                                <Badge variant="outline" className="w-fit bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary border-primary/20">
                                  {ex.startTime?.slice(0, 5)} - {ex.endTime?.slice(0, 5)}
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="w-fit">
                                  Closed
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedException(ex);
                                setAlertConfig({
                                  open: true,
                                  title: "Confirm Deletion",
                                  description: "Remove this exception?",
                                  actionType: 'delete',
                                  onConfirm: () => {
                                    deleteAvailability.mutate(ex.id);
                                    setAlertConfig(prev => ({ ...prev, open: false }));
                                  }
                                });
                              }}
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Exception Dialog */}
      <Dialog open={isExceptionDialogOpen} onOpenChange={setIsExceptionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{format(date || new Date(), 'MMMM d, yyyy')}</DialogTitle>
            <DialogDescription>Modify availability for this specific date.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center justify-between p-3 border rounded-md bg-muted/20">
              <Label htmlFor="date-available" className="cursor-pointer">Kitchen Available?</Label>
              <Switch
                checked={exceptionForm.isAvailable}
                onCheckedChange={(checked) => setExceptionForm({ ...exceptionForm, isAvailable: checked })}
                id="date-available"
              />
            </div>

            {exceptionForm.isAvailable && (
              <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 fade-in">
                <div className="space-y-2">
                  <Label>Open Time</Label>
                  <Input
                    type="time"
                    value={exceptionForm.startTime}
                    onChange={(e) => setExceptionForm({ ...exceptionForm, startTime: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Close Time</Label>
                  <Input
                    type="time"
                    value={exceptionForm.endTime}
                    onChange={(e) => setExceptionForm({ ...exceptionForm, endTime: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Reason / Note</Label>
              <Input
                value={exceptionForm.reason}
                onChange={(e) => setExceptionForm({ ...exceptionForm, reason: e.target.value })}
                placeholder={exceptionForm.isAvailable ? "e.g. Extended hours" : "e.g. Holiday closure"}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {selectedException && (
              <Button
                variant="destructive"
                type="button"
                onClick={handleDeleteException}
                className="sm:mr-auto"
              >
                Remove Exception
              </Button>
            )}
            <Button onClick={handleSaveException}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Safety Alert Dialog */}
      <AlertDialog open={alertConfig.open} onOpenChange={(open) => setAlertConfig(prev => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {alertConfig.actionType === 'delete' ? <Trash2 className="h-5 w-5 text-destructive" /> : <AlertTriangle className="h-5 w-5 text-amber-500" />}
              {alertConfig.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {alertConfig.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={alertConfig.onConfirm}
              className={alertConfig.actionType === 'delete' ? "bg-destructive hover:bg-destructive/90" : ""}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
