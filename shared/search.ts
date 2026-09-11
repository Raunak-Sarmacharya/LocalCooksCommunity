export type SearchPortal = "chef" | "manager" | "admin";

export type SearchBreadcrumb = {
  label: string;
  url?: string;
};

export type GlobalSearchResult = {
  id: string;
  type: "navigation" | "location" | "kitchen" | "storage" | "equipment";
  title: string;
  snippet: string;
  url: string;
  view?: string;
  breadcrumb: SearchBreadcrumb[];
  score: number;
};

export type GlobalSearchResponse = {
  query: string;
  results: GlobalSearchResult[];
};

export type GeneratedSearchContentDocument = {
  id: string;
  locale: "en-CA" | "fr-CA" | "uk";
  audience: "chef" | "manager";
  collection: string;
  anchor: string;
  title: string;
  body: string;
};
