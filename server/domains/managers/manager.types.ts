import { User, InsertUser } from "@shared/schema";

export interface IManagerRepository {
    findAllManagers(): Promise<User[]>;
    findManagerByUserId(userId: number): Promise<User | undefined>;
    updateOnboardingStatus(userId: number, updates: {
        completed?: boolean;
        skipped?: boolean;
        steps?: any
    }): Promise<User | undefined>;

    // Reporting / Dashboard Data
    getRevenueMetrics(managerId: number, startDate?: string, endDate?: string, locationId?: number): Promise<any>;
    findInvoices(managerId: number, filters: InvoiceFilters): Promise<{ invoices: any[], total: number }>;
}

export interface IManagerService {
    getAllManagers(): Promise<User[]>;
    updateOnboarding(userId: number, updates: {
        completed?: boolean;
        skipped?: boolean;
        steps?: any
    }): Promise<User | undefined>;

    getRevenueOverview(managerId: number, query: { startDate?: string; endDate?: string; locationId?: number }): Promise<any>;
    getInvoices(managerId: number, query: InvoiceQuery): Promise<{ invoices: any[], total: number }>;
}

export interface InvoiceFilters {
    startDate?: string | string[];
    endDate?: string | string[];
    locationId?: number;
    limit?: number;
    offset?: number;
}

export interface InvoiceQuery {
    startDate?: string | string[];
    endDate?: string | string[];
    locationId?: string; // Query params come as strings
    limit?: string;
    offset?: string;
}
