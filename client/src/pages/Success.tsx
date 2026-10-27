import { useEffect } from "react";
import { useLocation } from "wouter";

/** Old "application received" page: the dashboard's Selling tracker shows the same, inside the app. */
export default function Success() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/dashboard?view=applications", { replace: true }); }, [navigate]);
  return null;
}
