import { useEffect } from "react";
import { useLocation } from "wouter";
import { useFirebaseAuth } from "@/hooks/use-auth";

/** /apply (old links, emails): one seller application lives in the dashboard; signed out, sign in first. */
export default function ApplicationForm() {
  const { user, loading } = useFirebaseAuth();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (loading) return;
    if (!user) navigate("/auth?redirect=/apply", { replace: true });
    else navigate(user.role === "admin" ? "/admin" : "/dashboard?view=applications&action=new", { replace: true });
  }, [user, loading, navigate]);
  return null;
}
