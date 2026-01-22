
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

    async deleteEquipmentListing(id: number) {
        return this.repo.deleteEquipmentListing(id);
    }
}

export const inventoryService = new InventoryService();
