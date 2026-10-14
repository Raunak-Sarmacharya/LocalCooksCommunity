import { Redirect } from "wouter";
import { useSubdomain } from "@/hooks/use-subdomain";
import EnhancedAuthPage from "@/pages/EnhancedAuthPage";

/** The chef sign-in (with chef marketing) is wrong on the kitchen subdomain; managers sign in at /manager/login. */
export function AuthEntry() {
  const subdomain = useSubdomain();
  if (subdomain === 'kitchen') return <Redirect to={`/manager/login${window.location.search}`} />;
  return <EnhancedAuthPage />;
}
