import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Store,
  Calendar,
  ChevronDown,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatApplicationStatus } from "@/lib/applicationSchema";
import { Application } from "@shared/schema";

interface SellerApplicationCardProps {
  application: Application;
  onCancelApplication: (type: 'chef', id: number) => void;
  onManageDocuments: () => void;
  getStatusVariant: (status: string) => "default" | "secondary" | "destructive" | "outline";
}

export default function SellerApplicationCard({
  application: app,
  onCancelApplication,
  onManageDocuments,
  getStatusVariant,
}: SellerApplicationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Helper function for document status badge
  const getDocStatusBadge = (status: string | undefined) => {
    if (!status || status === 'N/A') return { variant: 'outline' as const, className: 'bg-muted text-muted-foreground' };
    if (status === 'approved') return { variant: 'success' as const, className: '' };
    if (status === 'pending') return { variant: 'secondary' as const, className: 'bg-amber-100 text-amber-800 border-amber-200' };
    if (status === 'rejected') return { variant: 'destructive' as const, className: 'bg-red-100 text-red-800 border-red-200' };
    return { variant: 'outline' as const, className: '' };
  };

  const foodSafetyStatus = ('foodSafetyLicenseStatus' in app ? (app as any).foodSafetyLicenseStatus : undefined);
  const establishmentStatus = ('foodEstablishmentCertStatus' in app ? (app as any).foodEstablishmentCertStatus : undefined);
  const foodSafetyUrl = ('foodSafetyLicenseUrl' in app ? (app as any).foodSafetyLicenseUrl : undefined);
  const establishmentUrl = ('foodEstablishmentCertUrl' in app ? (app as any).foodEstablishmentCertUrl : undefined);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
        <div className={cn(
          "h-1 w-full",
          app.status === 'approved' ? "bg-green-500" :
          app.status === 'inReview' ? "bg-amber-500" :
          app.status === 'rejected' ? "bg-red-500" :
          "bg-muted-foreground/40"
        )} />
        
        {/* Collapsed Header - Always Visible */}
        <CollapsibleTrigger asChild>
          <div className="p-4 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center",
                  app.status === 'approved' ? "bg-green-100" :
                  app.status === 'inReview' ? "bg-amber-100" :
                  app.status === 'rejected' ? "bg-red-100" :
                  "bg-muted"
                )}>
                  <Store className={cn(
                    "h-5 w-5",
                    app.status === 'approved' ? "text-green-600" :
                    app.status === 'inReview' ? "text-amber-600" :
                    app.status === 'rejected' ? "text-red-600" :
                    "text-muted-foreground"
                  )} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground">Seller Application #{app.id}</p>
                    <Badge variant={getStatusVariant(app.status)} className="text-xs uppercase tracking-wider font-bold">
                      {formatApplicationStatus(app.status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Calendar className="h-3 w-3" />
                    Submitted {new Date(app.createdAt || "").toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {app.status !== 'approved' && app.status !== 'cancelled' && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelApplication('chef', app.id);
                    }}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                )}
                <ChevronDown className={cn(
                  "h-5 w-5 text-muted-foreground transition-transform duration-200",
                  isExpanded && "rotate-180"
                )} />
              </div>
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Expanded Content */}
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4 border-t border-border/50 pt-4">
            {/* Status Description */}
            <div className={cn(
              "flex items-start gap-3 p-3 rounded-lg border",
              app.status === 'approved' ? "bg-green-50 border-green-200" :
              app.status === 'inReview' ? "bg-amber-50 border-amber-200" :
              app.status === 'rejected' ? "bg-red-50 border-red-200" :
              "bg-muted/50 border-border"
            )}>
              {app.status === 'approved' ? <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" /> :
               app.status === 'inReview' ? <Clock className="h-4 w-4 text-amber-600 mt-0.5" /> :
               app.status === 'rejected' ? <XCircle className="h-4 w-4 text-red-600 mt-0.5" /> :
               <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5" />}
              <p className="text-sm text-muted-foreground">
                {app.status === 'approved' ? 'Your seller application has been approved. Complete document verification to start selling.' :
                 app.status === 'inReview' ? 'Our team is reviewing your application. You will be notified once a decision is made.' :
                 app.status === 'rejected' ? 'Your application was not approved. Please review the feedback and submit a new application.' :
                 app.status === 'cancelled' ? 'This application has been cancelled.' : ''}
              </p>
            </div>

            {/* Submitted Information */}
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Submitted Information</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-2 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase">Full Name</p>
                  <p className="text-sm font-medium truncate">{app.fullName || 'N/A'}</p>
                </div>
                <div className="p-2 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase">Email</p>
                  <p className="text-sm font-medium truncate">{app.email || 'N/A'}</p>
                </div>
                <div className="p-2 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase">Phone</p>
                  <p className="text-sm font-medium">{app.phone || 'N/A'}</p>
                </div>
                <div className="p-2 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground uppercase">Kitchen Pref</p>
                  <p className="text-sm font-medium capitalize">{app.kitchenPreference || 'N/A'}</p>
                </div>
              </div>
            </div>

            {/* Document Verification */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Documents</p>
                {app.status !== 'cancelled' && app.status !== 'rejected' && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onManageDocuments}>
                    <FileText className="h-3 w-3 mr-1" />
                    Manage
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    <span className="text-sm">Food Safety License</span>
                  </div>
                  {foodSafetyUrl ? (
                    <Badge variant={getDocStatusBadge(foodSafetyStatus).variant} className={cn("text-xs", getDocStatusBadge(foodSafetyStatus).className)}>
                      {foodSafetyStatus || 'Pending'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-muted">Not Uploaded</Badge>
                  )}
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-green-600" />
                    <span className="text-sm">Establishment Cert</span>
                  </div>
                  {establishmentUrl ? (
                    <Badge variant={getDocStatusBadge(establishmentStatus).variant} className={cn("text-xs", getDocStatusBadge(establishmentStatus).className)}>
                      {establishmentStatus || 'Pending'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-muted">Not Uploaded</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Feedback */}
            {app.feedback && (
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/10">
                <p className="text-xs font-bold text-foreground mb-1">Reviewer Feedback</p>
                <p className="text-sm text-muted-foreground italic">{app.feedback}</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
