import { KitchenApplicationForManager } from "@/hooks/use-manager-kitchen-applications";

export type Application = KitchenApplicationForManager;

export type ApplicationStatus = "inReview" | "approved" | "rejected" | "cancelled";

export interface ApplicationsTableProps {
    data: Application[];
    isLoading: boolean;
    onApprove: (application: Application) => void;
    onReject: (application: Application) => void;
    onOpenChat: (application: Application) => void;
    onViewDocuments: (application: Application) => void;
    onReview: (application: Application) => void;
}
