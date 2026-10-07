import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KitchenInventoryModals } from './KitchenInventory';
import { resolveEquipmentIcon, resolveStorageIcon } from '@/lib/kitchen-inventory-icons';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: any) => typeof fallback === 'string' ? fallback : fallback.defaultValue }) }));
afterEach(cleanup);
it('keeps preview tabs, item details, prices, and responsive columns in the shared modal', () => {
  const kitchen = { equipment: {
    included: [{ id: 1, equipmentType: 'commercial-oven', category: 'cooking', availabilityType: 'included' as const, brand: 'Acme' }],
    rental: [{ id: 2, equipmentType: 'blender', category: 'food-prep', availabilityType: 'rental' as const, sessionRate: 15 }],
  } };
  render(<KitchenInventoryModals kitchen={kitchen} openModal="equipment" setOpenModal={vi.fn()} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('Included with your booking');
  expect(screen.getByText('Commercial Oven')).toBeInTheDocument();
  expect(screen.getByText('Acme')).toBeInTheDocument();
  expect(screen.getByRole('list').className).toContain('sm:grid-cols-2');
  fireEvent.mouseDown(screen.getByRole('tab', { name: /Optional Rentals/ }), { button: 0, ctrlKey: false });
  expect(screen.getByText('Blender')).toBeInTheDocument();
  expect(screen.getByText('$15.00')).toBeInTheDocument();
});
it('uses item-specific offline icons for equipment and storage', () => {
  expect(resolveEquipmentIcon('commercial_oven', 'cooking')).toBe('mdi:stove');
  expect(resolveEquipmentIcon('wok-station', 'cooking')).toBe('mdi:gas-burner');
  expect(resolveEquipmentIcon('commercial blender')).toBe('mdi:blender-outline');
  expect(resolveStorageIcon('dry', 'Dry shelving unit')).toBe('mdi:bookshelf');
  expect(resolveStorageIcon('cold')).toBe('mdi:fridge-outline');
  expect(resolveStorageIcon('freezer')).toBe('mdi:snowflake');
});
it('renders storage names, types, and prices with the preview layout', () => {
  render(<KitchenInventoryModals kitchen={{ storage: [{ id: 3, name: 'Cold shelf A', storageType: 'cold', pricingModel: 'daily', basePrice: 8 }] }} openModal="storage" setOpenModal={vi.fn()} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('Dry, cold, and freezer space');
  expect(screen.getByText('Cold shelf A')).toBeInTheDocument();
  expect(screen.queryByText('Cold')).not.toBeInTheDocument();
  expect(screen.getByText('$8.00')).toBeInTheDocument();
  expect(screen.getByRole('list').className).toContain('sm:grid-cols-2');
});

