import { useRoute, useSearch } from 'wouter';
import { mt } from '@/i18n/manager';
import ManagerBookingLayout from '@/layouts/ManagerBookingLayout';
import { CustomerPageView } from '@/components/manager/customers/CustomerPageView';
import { useCustomerPage } from '@/components/manager/customers/use-customers';

/** Full page for one customer: `/manager/customers/:chefId?location=`. */
export default function ManagerCustomerPage() {
  const [, params] = useRoute('/manager/customers/:chefId');
  const search = useSearch();
  const chefId = Number(params?.chefId);
  const requested = Number(new URLSearchParams(search).get('location'));
  const locationParam = Number.isSafeInteger(requested) && requested > 0 ? requested : undefined;
  // The same query the page body uses, so the breadcrumb and sidebar scope cost no extra request.
  const { data, isError } = useCustomerPage(chefId, locationParam, true);
  return (
    <ManagerBookingLayout activeView="customers" bookingLocationId={data?.location.id}
      breadcrumbs={[{ label: mt('cuBreadcrumbCustomers'), href: '/manager/dashboard?view=customers' }, ...(isError ? [] : [{ label: data?.customer.name ?? '…' }])]}>
      <div className="mx-auto w-full max-w-6xl">
        <CustomerPageView chefId={chefId} locationParam={locationParam} />
      </div>
    </ManagerBookingLayout>
  );
}
