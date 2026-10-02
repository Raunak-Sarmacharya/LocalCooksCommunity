import * as React from "react"
import { ManagerShell } from "@/layouts/ManagerShell"
import type { ManagerBreadcrumb } from "@/lib/manager-kitchens-navigation"
import type { ManagerGettingStartedProps } from "@/components/manager/ManagerGettingStarted"

/**
 * DashboardLayout — the manager dashboard's shell.
 *
 * This used to BE the shell. It is now a thin adapter over `ManagerShell` so that the dashboard and
 * the standalone manager routes render the same chrome from one implementation. The prop surface is
 * unchanged, which is why `ManagerBookingDashboard` needed no edit.
 *
 * `showScopePicker` stays off: the dashboard owns its own location/kitchen picker and its own
 * `?view=`/`?kit=` handling, and two pickers writing the same params is the bug this avoids.
 */
interface DashboardLayoutProps {
    showBookings?: boolean;
    showStorageBookings?: boolean;
    showApplications?: boolean;
    showRevenue?: boolean;
    children: React.ReactNode;
    activeView: string;
    onViewChange: (view: string) => void;
    locations: Array<any>;
    selectedLocation: any;
    onLocationChange: (location: any) => void;
    onCreateLocation?: () => void;
    breadcrumbs?: ManagerBreadcrumb[];
    managerGettingStarted?: ManagerGettingStartedProps;
}

export default function DashboardLayout({
    children,
    activeView,
    onViewChange,
    locations,
    selectedLocation,
    onLocationChange,
    onCreateLocation,
    breadcrumbs,
    managerGettingStarted,
    showBookings = true,
    showStorageBookings = true,
    showApplications = true,
    showRevenue = true,
}: DashboardLayoutProps) {
    return (
        <ManagerShell
            activeView={activeView}
            onViewChange={onViewChange}
            locations={locations}
            selectedLocation={selectedLocation}
            onLocationChange={onLocationChange}
            onCreateLocation={onCreateLocation}
            breadcrumbs={breadcrumbs}
            managerGettingStarted={managerGettingStarted}
            showBookings={showBookings}
            showStorageBookings={showStorageBookings}
            showApplications={showApplications}
            showRevenue={showRevenue}
        >
            {children}
        </ManagerShell>
    )
}
