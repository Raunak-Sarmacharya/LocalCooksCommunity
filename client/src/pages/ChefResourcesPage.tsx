import { useTranslation } from "react-i18next";
import ChefResourcesPage_en from "./ChefResourcesPage_en";
import ChefResourcesPage_fr from "./ChefResourcesPage_fr";
import ChefResourcesPage_uk from "./ChefResourcesPage_uk";

export default function ChefResourcesPage() {
  const { i18n } = useTranslation();
  
  if (i18n.language.startsWith('fr')) {
    return <ChefResourcesPage_fr />;
  } else if (i18n.language.startsWith('uk')) {
    return <ChefResourcesPage_uk />;
  }
  
  return <ChefResourcesPage_en />;
}
