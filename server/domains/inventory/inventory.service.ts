
import { InventoryRepository } from "./inventory.repository";
import { InsertStorageListing, InsertEquipmentListing } from "./inventory.types";

export class InventoryService {
    private repo: InventoryRepository;

    constructor(repo?: InventoryRepository) {
        this.repo = repo || new InventoryRepository();
    }

    // ===== STORAGE =====

    async createStorageListing(data: any) {
        // Validation logic can go here
        return this.repo.createStorageListing(data);
    }

    async getStorageListingsByKitchen(kitchenId: number) {
        return this.repo.getStorageListingsByKitchenId(kitchenId);
    }

    async getStorageListingById(id: number) {
        return this.repo.getStorageListingById(id);
    }

    async updateStorageListing(id: number, updates: any) {
        return this.repo.updateStorageListing(id, updates);
    }

    async deleteStorageListing(id: number) {
        return this.repo.deleteStorageListing(id);
    }

    // ===== EQUIPMENT =====

    async createEquipmentListing(data: any) {
        return this.repo.createEquipmentListing(data);
    }

    async getEquipmentListingsByKitchen(kitchenId: number) {
        return this.repo.getEquipmentListingsByKitchenId(kitchenId);
    }

    async getEquipmentListingById(id: number) {
        return this.repo.getEquipmentListingById(id);
    }

    async updateEquipmentListing(id: number, updates: any) {
        return this.repo.updateEquipmentListing(id, updates);
    }

    /**
     * Removing equipment never destroys booking history: with upcoming/open bookings it is refused (turn it off for new
     * bookings instead); with only past bookings it is archived (hidden, kept for receipts); with none it is deleted.
     */
    async deleteEquipmentListing(id: number): Promise<{ archived: boolean }> {
        const usage = await this.repo.getEquipmentBookingUsage(id);
        if (usage.open > 0) throw new EquipmentListingInUseError();
        if (usage.total > 0) {
            await this.repo.archiveEquipmentListing(id);
            return { archived: true };
        }
        await this.repo.deleteEquipmentListing(id);
        return { archived: false };
    }
}

export class EquipmentListingInUseError extends Error {
    constructor() {
        super('This equipment has upcoming bookings. Turn it off for new bookings instead.');
        this.name = 'EquipmentListingInUseError';
    }
}

export const inventoryService = new InventoryService();
