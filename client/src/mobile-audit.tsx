import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import { CustomFieldBuilder } from "./components/manager/requirements/CustomFieldBuilder";
import { StorageCheckinCheckoutEditor, type UnifiedStorageInspectionItem } from "./components/manager/settings/StorageCheckinCheckoutEditor";
import type { CustomField } from "./components/manager/requirements/types";

function Preview() {
  const [fields, setFields] = useState<CustomField[]>([{ id: "business-registration", label: "Business registration document", type: "file", required: false, tier: 1 }]);
  const [items, setItems] = useState<UnifiedStorageInspectionItem[]>([{ id: "storage-condition", label: "Storage unit condition", requiredOnCheckin: true, requiredOnCheckout: true, photoRequired: true }]);
  return <main className="mx-auto max-w-4xl space-y-8 px-4 py-5">
    <section className="rounded-xl border"><div className="p-4"><h1 className="text-lg font-semibold">Custom questions</h1></div><CustomFieldBuilder fields={fields} tier={1} onFieldsChange={setFields} /></section>
    <StorageCheckinCheckoutEditor items={items} onItemsChange={setItems} checkinEnabled={true} onCheckinEnabledChange={() => {}} checkoutEnabled={true} onCheckoutEnabledChange={() => {}} checkinInstructions={null} onCheckinInstructionsChange={() => {}} checkoutInstructions={null} onCheckoutInstructionsChange={() => {}} />
  </main>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
