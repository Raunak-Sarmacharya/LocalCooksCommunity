import { useTranslation } from "react-i18next";
import KitchenResourcesPage_en from "./KitchenResourcesPage_en";
import KitchenResourcesPage_fr from "./KitchenResourcesPage_fr";
import KitchenResourcesPage_uk from "./KitchenResourcesPage_uk";

export default function KitchenResourcesPage() {
  const { i18n } = useTranslation();
  
  if (i18n.language.startsWith('fr')) {
    return <KitchenResourcesPage_fr />;
  } else if (i18n.language.startsWith('uk')) {
    return <KitchenResourcesPage_uk />;
  }
  
  return <KitchenResourcesPage_en />;
}
