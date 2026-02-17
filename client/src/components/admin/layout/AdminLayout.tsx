import { useState } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar, type AdminSection } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import { CommandMenu } from "@/components/command-menu";

interface AdminLayoutProps {
  activeSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
  onLogout: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  pendingReviewCount?: number;
  pendingLicensesCount?: number;
  children: React.ReactNode;
}

export function AdminLayout({
  activeSection,
  onSectionChange,
  onLogout,
  onRefresh,
  isRefreshing,
  pendingReviewCount,
  pendingLicensesCount,
  children,
}: AdminLayoutProps) {
  const [isCommandOpen, setIsCommandOpen] = useState(false);

  return (
    <SidebarProvider>
      <AdminSidebar
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        onLogout={onLogout}
        pendingReviewCount={pendingReviewCount}
        pendingLicensesCount={pendingLicensesCount}
      />
      <SidebarInset>
        <AdminHeader
          activeSection={activeSection}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          onSearchClick={() => setIsCommandOpen(true)}
        />
        <main className="flex-1 overflow-auto">
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </SidebarInset>
      <CommandMenu
        open={isCommandOpen}
        onOpenChange={setIsCommandOpen}
        onViewChange={(view) => onSectionChange(view as AdminSection)}
        onLogout={onLogout}
        portalType="admin"
      />
    </SidebarProvider>
  );
}
