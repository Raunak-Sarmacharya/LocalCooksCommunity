import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Building,
  CheckCircle,
  Clock,
  ChefHat,
  Shield,
  Store,
  ArrowRight,
  MessageCircle,
} from "lucide-react";

interface EmptyApplicationStateProps {
  onStartSellerApplication: () => void;
  onDiscoverKitchens: () => void;
}

export default function EmptyApplicationState({
  onStartSellerApplication,
  onDiscoverKitchens,
}: EmptyApplicationStateProps) {
  return (
    <div className="space-y-8">
      {/* Hero Welcome Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/5 via-primary/10 to-blue-500/5 border border-primary/10 p-8 md:p-12">
        {/* Decorative background elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-primary/10 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-blue-500/10 to-transparent rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />
        
        <div className="relative z-10 text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <ChefHat className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">Welcome to LocalCooks</span>
          </div>
          
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-4">
            Start Your Culinary Journey
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Whether you want to sell your homemade food or cook in professional kitchens, 
            LocalCooks has the perfect path for you. Choose how you'd like to get started.
          </p>
        </div>
      </div>

      {/* Dual Path Cards - Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Path 1: Sell on LocalCooks */}
        <Card className="group relative overflow-hidden border-2 border-primary/20 hover:border-primary/40 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5">
          {/* Top accent bar */}
          <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/60" />
          
          {/* Floating badge */}
          <div className="absolute top-6 right-6">
            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
              Recommended
            </Badge>
          </div>

          <CardHeader className="pb-4 pt-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <Store className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold">Sell on LocalCooks</CardTitle>
            <CardDescription className="text-base">
              Become a verified seller and share your culinary creations with customers in your area.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Benefits list */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Reach Local Customers</p>
                  <p className="text-xs text-muted-foreground">Connect with food lovers in your community</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Secure Payments</p>
                  <p className="text-xs text-muted-foreground">Get paid directly via Stripe Connect</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Build Your Brand</p>
                  <p className="text-xs text-muted-foreground">Create your own storefront and menu</p>
                </div>
              </div>
            </div>

            {/* Process steps */}
            <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
              <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-3">How it works</p>
              <div className="flex items-center justify-between text-xs">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">1</div>
                  <span className="text-muted-foreground">Apply</span>
                </div>
                <div className="flex-1 h-px bg-border mx-2" />
                <div className="flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">2</div>
                  <span className="text-muted-foreground">Verify</span>
                </div>
                <div className="flex-1 h-px bg-border mx-2" />
                <div className="flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">3</div>
                  <span className="text-muted-foreground">Sell</span>
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2 pb-6">
            <Button 
              size="lg" 
              onClick={onStartSellerApplication}
              className="w-full rounded-xl shadow-lg shadow-primary/20 group-hover:shadow-primary/30 transition-all"
            >
              <Store className="h-5 w-5 mr-2" />
              Start Seller Application
              <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </CardFooter>
        </Card>

        {/* Path 2: Cook at Commercial Kitchens */}
        <Card className="group relative overflow-hidden border-2 border-blue-500/20 hover:border-blue-500/40 transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/5">
          {/* Top accent bar */}
          <div className="h-1.5 w-full bg-gradient-to-r from-blue-600 via-blue-500 to-blue-400" />
          
          {/* Floating badge */}
          <div className="absolute top-6 right-6">
            <Badge variant="info" className="text-xs font-semibold">
              Popular
            </Badge>
          </div>

          <CardHeader className="pb-4 pt-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <Building className="h-8 w-8 text-blue-600" />
            </div>
            <CardTitle className="text-2xl font-bold">Cook at Commercial Kitchens</CardTitle>
            <CardDescription className="text-base">
              Access professional kitchen spaces to prepare your food in a certified environment.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Benefits list */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Professional Equipment</p>
                  <p className="text-xs text-muted-foreground">Access commercial-grade kitchen tools</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Flexible Booking</p>
                  <p className="text-xs text-muted-foreground">Book time slots that fit your schedule</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Certified Spaces</p>
                  <p className="text-xs text-muted-foreground">Meet health & safety requirements</p>
                </div>
              </div>
            </div>

            {/* Process steps */}
            <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100">
              <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-3">How it works</p>
              <div className="flex items-center justify-between text-xs">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">1</div>
                  <span className="text-muted-foreground">Discover</span>
                </div>
                <div className="flex-1 h-px bg-blue-200 mx-2" />
                <div className="flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">2</div>
                  <span className="text-muted-foreground">Apply</span>
                </div>
                <div className="flex-1 h-px bg-blue-200 mx-2" />
                <div className="flex flex-col items-center gap-1">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">3</div>
                  <span className="text-muted-foreground">Book</span>
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2 pb-6">
            <Button 
              size="lg" 
              onClick={onDiscoverKitchens}
              className="w-full rounded-xl shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/30 transition-all bg-blue-600 hover:bg-blue-700"
            >
              <Building className="h-5 w-5 mr-2" />
              Discover Kitchens
              <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Bottom info section */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 p-6 bg-muted/30 rounded-2xl border border-border/50">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Shield className="h-5 w-5" />
          <span className="text-sm">Secure & Verified</span>
        </div>
        <div className="hidden sm:block w-px h-4 bg-border" />
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-5 w-5" />
          <span className="text-sm">Quick Approval Process</span>
        </div>
        <div className="hidden sm:block w-px h-4 bg-border" />
        <div className="flex items-center gap-2 text-muted-foreground">
          <MessageCircle className="h-5 w-5" />
          <span className="text-sm">24/7 Support Available</span>
        </div>
      </div>
    </div>
  );
}
