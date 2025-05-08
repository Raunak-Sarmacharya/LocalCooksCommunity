import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export default function CTASection() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  
  const handleApplicationClick = () => {
    // If not logged in, redirect to auth page, otherwise to application form
    navigate(user ? "/apply" : "/auth");
  };
  
  return (
    <section className="py-12 md:py-16 px-4 bg-light-gray">
      <div className="container mx-auto text-center">
        <h2 className="text-2xl md:text-3xl font-bold mb-6">Ready to Start Cooking?</h2>
        <p className="text-lg max-w-2xl mx-auto mb-8">
          Join our growing community of local cooks and share your culinary creations 
          with St. John's.
        </p>
        <Button 
          onClick={handleApplicationClick}
          className="bg-primary hover:bg-opacity-90 text-white font-bold py-3 px-8 rounded-full shadow-lg hover:-translate-y-1 hover-transform hover-shadow"
        >
          Start Your Application
        </Button>
      </div>
    </section>
  );
}
