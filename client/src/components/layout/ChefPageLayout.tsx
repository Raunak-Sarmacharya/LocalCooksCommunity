import { useLocation } from "wouter";
import {
  LayoutDashboard,
  FileText,
  Calendar,
  BookOpen,
  MessageCircle,
  Search,
  User,
  LogOut,
  Bell,
  Building2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useFirebaseAuth } from "@/hooks/use-auth";


import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
  SidebarMenuBadge,
} from "@/components/ui/sidebar";

interface NavItem {
  id: string;
  label: string;
  icon: any;
  path?: string;
  badge?: number;
}

interface ChefPageLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
  title?: string;
  description?: string;
}

export function ChefPageLayout({
  children,
  activeTab,
  onTabChange,
  title,
  description,
}: ChefPageLayoutProps) {
  const { user, logout } = useFirebaseAuth();
  const [, navigate] = useLocation();

  const navItems: NavItem[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "applications", label: "My Applications", icon: FileText },
    { id: "kitchen-applications", label: "Kitchen Access", icon: Building2 },
    { id: "bookings", label: "My Bookings", icon: Calendar },
    { id: "training", label: "Training", icon: BookOpen },
    { id: "messages", label: "Messages", icon: MessageCircle, badge: 0 },
    { id: "discover", label: "Discover Kitchens", icon: Search, path: "/compare-kitchens" },
  ];

  const handleTabChange = (tabId: string) => {
    const item = navItems.find(i => i.id === tabId);
    if (item?.path) {
      navigate(item.path);
    } else {
      onTabChange(tabId);
    }
  };

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        <Sidebar collapsible="icon" className="border-r">
          <SidebarHeader className="h-16 flex items-center px-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold shadow-sm">
                LC
              </div>
              <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                <span className="font-bold text-sm tracking-tight">Chef Portal</span>
                <span className="text-[10px] text-muted-foreground">Local Cooks Community</span>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="px-2">
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={activeTab === item.id}
                    onClick={() => handleTabChange(item.id)}
                    tooltip={item.label}
                    className={cn(
                      "px-3 py-5 rounded-lg transition-all",
                      activeTab === item.id 
                        ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground" 
                        : "hover:bg-muted"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
                        {item.badge}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-4 border-t bg-muted/5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 px-2 py-2 group-data-[collapsible=icon]:hidden">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-xs font-bold shadow-sm ring-2 ring-background">
                  {user?.displayName?.[0] || user?.username?.[0] || "U"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate text-foreground">{user?.displayName || user?.username}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold opacity-70">Chef Account</p>
                </div>
              </div>
              
              <div className="space-y-1">
                <SidebarMenuButton size="sm" onClick={() => navigate("/profile")} className="w-full text-muted-foreground hover:text-foreground">
                  <User className="h-4 w-4" />
                  <span className="group-data-[collapsible=icon]:hidden">Profile Settings</span>
                </SidebarMenuButton>
                <SidebarMenuButton size="sm" onClick={() => logout()} className="w-full text-destructive hover:text-destructive hover:bg-destructive/10">
                  <LogOut className="h-4 w-4" />
                  <span className="group-data-[collapsible=icon]:hidden">Sign Out</span>
                </SidebarMenuButton>
              </div>
            </div>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <header className="h-16 border-b flex items-center justify-between px-4 md:px-8 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-20">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="h-9 w-9" />
              <Separator orientation="vertical" className="h-6" />
              <div className="flex flex-col">
                {title && <h1 className="text-sm font-bold tracking-tight text-foreground">{title}</h1>}
                {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="text-muted-foreground relative h-9 w-9 hover:bg-muted">
                <Bell className="h-4 w-4" />
                <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 bg-destructive rounded-full border border-background"></span>
              </Button>
              <div className="hidden sm:flex items-center px-3 py-1 bg-muted/30 rounded-full border border-border/50">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
              </div>
            </div>
          </header>

          <ScrollArea className="flex-1 bg-muted/5">
            <div className="p-4 md:p-8 lg:p-10">
              <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                {children}
              </div>
            </div>
          </ScrollArea>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
