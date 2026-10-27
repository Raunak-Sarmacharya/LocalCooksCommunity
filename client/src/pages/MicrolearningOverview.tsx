import { useEffect } from "react";
import { useLocation } from "wouter";

/** Old /microlearning links: the videos live in the dashboard's Resources now (owner, Oct 27). */
export default function MicrolearningOverview() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/dashboard?view=resources", { replace: true }); }, [navigate]);
  return null;
}
