import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import GradientHero from "@/components/ui/GradientHero";
import FadeInSection from "@/components/ui/FadeInSection";
import { 
  ChefHat, Clock, DollarSign, Users, Target, Utensils, FileCheck, 
  Building2, Calendar, ArrowRight, CheckCircle2, X, TrendingUp,
  MessageSquare, Shield, Heart, Leaf, Globe, Quote, Mail
} from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";

export default function ChefLanding() {
  const { user } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");

  // Fetch real kitchens data
  const { data: kitchens = [], isLoading: kitchensLoading } = useQuery({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/public/kitchens");
      if (!response.ok) throw new Error("Failed to fetch kitchens");
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch real platform statistics
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/public/stats"],
    queryFn: async () => {
      const response = await fetch("/api/public/stats");
      if (!response.ok) throw new Error("Failed to fetch stats");
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash) {
        const element = document.querySelector(hash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    if (window.location.hash) {
      setTimeout(handleHashChange, 100);
    }
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleGetStarted = () => {
    if (!user) {
      navigate('/auth');
    } else {
      navigate('/apply');
    }
  };

  const handleNewsletterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement newsletter signup
    alert("Thank you for signing up! Check your email for the First 30 Days playbook.");
    setEmail("");
  };

  return (
    <div className="min-h-screen flex flex-col bg-light-gray">
      <Header />
      <main className="flex-grow">
        {/* PART 1: HERO SECTION */}
        <GradientHero variant="warm" className="pt-28 pb-16 md:pt-36 md:pb-24 px-4">
          <div className="container mx-auto max-w-4xl text-center">
            <FadeInSection>
              <h1 className="text-4xl md:text-6xl font-bold mb-6 text-gray-900">
                Your Cooking Speaks for Itself.
                <br />
                <span className="text-primary">Everything Else Shouldn't.</span>
              </h1>
            </FadeInSection>
            
            <FadeInSection delay={1}>
              <div className="text-left max-w-3xl mx-auto space-y-6 mb-8 text-lg text-gray-700">
              <p className="font-semibold">You might be:</p>
              <ul className="space-y-3 list-disc list-inside">
                <li>A line cook in someone else's kitchen, 14 hours a day, watching the owner take credit for YOUR food</li>
                <li>A home chef selling on Marketplace, coordinating 30 WhatsApp chats, getting ghosted by customers who ghost you after you buy ingredients</li>
                <li>A culinary professional exhausted by the system, ready to build something real</li>
              </ul>
              <p>Or maybe you're all three at different times.</p>
              
              <p className="font-semibold mt-6">Here's what all of you have in common:</p>
              <p>Your food is good. Your customers love it. You're making money.</p>
              <p>But you're doing it the hard way—managing spreadsheets, chasing payments, answering the same questions 50 times a week, explaining your delivery zones to every single customer.</p>
              <p className="font-semibold text-primary">You're trading your passion for logistics management.</p>
              <p className="text-2xl font-bold text-primary">Local Cooks fixes that.</p>
              </div>
            </FadeInSection>

            <FadeInSection delay={2}>
              <div className="grid md:grid-cols-3 gap-6 mb-8 text-left max-w-4xl mx-auto">
                <Card className="border-2 card-hover">
                <CardHeader>
                  <CardTitle className="text-lg">For the Restaurant Burnout Escape:</CardTitle>
                  <CardDescription className="text-base">
                    You leave the kitchen. You keep your skills. You own what you create.
                    <br /><br />
                    Keep 100% during trial. Work 10 hours a week or 40—your choice.
                    <br /><br />
                    Cook your food, not their food. Build your brand, not their business.
                  </CardDescription>
                </CardHeader>
              </Card>
              
                <Card className="border-2 card-hover">
                  <CardHeader>
                    <CardTitle className="text-lg">For the Marketplace Seller Scaling Up:</CardTitle>
                  <CardDescription className="text-base">
                    You're already winning. Your customers prove it.
                    <br /><br />
                    We just take the chaos out of the process.
                    <br /><br />
                    One organized inbox. Professional payments. Customer data.
                    <br /><br />
                    Everything you need to grow what you've already built.
                  </CardDescription>
                </CardHeader>
              </Card>
              
                <Card className="border-2 card-hover">
                  <CardHeader>
                    <CardTitle className="text-lg">For anyone caught between:</CardTitle>
                  <CardDescription className="text-base">
                    It's time to stop choosing between:
                    <br /><br />
                    <span className="text-red-600">✗</span> Freedom but no structure
                    <br />
                    <span className="text-red-600">✗</span> Security but no autonomy
                    <br />
                    <span className="text-red-600">✗</span> Your passion but someone else's profit
                    <br /><br />
                    <span className="font-semibold">Local Cooks is the bridge.</span>
                    <br /><br />
                    One platform. Professional operations. Your complete control. Your food. Your business.
                  </CardDescription>
                  </CardHeader>
                </Card>
              </div>
            </FadeInSection>

            <FadeInSection delay={3}>
              <div className="space-y-4 mb-8">
                <Button
                  onClick={handleGetStarted}
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-white font-semibold py-6 px-8 text-lg btn-glow"
                >
                  Start Your Application
                </Button>
              <p className="text-sm text-gray-600">
                Approved in 24 hours. Keep 100% during trial.
                <br />
                Your next chapter starts this week.
              </p>
              <Button
                variant="outline"
                size="lg"
                className="mt-4"
                onClick={() => {
                  document.getElementById('earnings')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                See How Much Chefs Like You Earn
              </Button>
              </div>
            </FadeInSection>
          </div>
        </GradientHero>

        {/* PART 2: BENEFITS GRID (6 BENEFITS) */}
        <section className="py-16 px-4 bg-white">
          <div className="container mx-auto max-w-6xl">
            <FadeInSection>
              <h2 className="text-4xl font-bold text-center mb-12">Why Local Cooks Works</h2>
            </FadeInSection>
            
            <div className="grid md:grid-cols-2 gap-8">
              {/* Benefit 1 */}
              <FadeInSection delay={1}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                    <Target className="h-6 w-6 text-blue-600" />
                  </div>
                  <CardTitle className="text-xl">Stop Managing the Business. Start Being a Chef.</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-gray-700">
                  <div>
                    <p className="font-semibold mb-2">If you're in a restaurant:</p>
                    <p>You spend 70% of your shift managing systems that aren't yours—communicating with the pass, managing prep stations, cleaning station 3. Your brilliance goes to executing someone else's menu.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-2">If you're selling on Marketplace:</p>
                    <p>You spend 70% of your day managing customer chaos—30 WhatsApp messages, payment coordination, delivery logistics. Your skill is hidden behind logistical friction.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-2 text-primary">On Local Cooks:</p>
                    <ul className="space-y-2">
                      <li>✓ Customer questions? Our team answers them</li>
                      <li>✓ Payment chaos? Handled. Professional payment processing. Weekly payouts.</li>
                      <li>✓ Delivery logistics? We coordinate. You cook.</li>
                      <li>✓ Customer issues? We mediate. We protect your rating.</li>
                      <li>✓ Data tracking? You see everything. Orders, patterns, preferences.</li>
                    </ul>
                    <p className="mt-4 font-semibold">The result: 80% of your energy goes to cooking. The other 20% to business decisions that actually matter.</p>
                  </div>
                </CardContent>
              </Card>
              </FadeInSection>

              {/* Benefit 2 */}
              <FadeInSection delay={1}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                    <DollarSign className="h-6 w-6 text-green-600" />
                  </div>
                  <CardTitle className="text-xl">Zero Platform Fees During Trial. Keep Everything You Earn.</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-gray-700">
                  <div>
                    <p className="font-semibold mb-2">Right now (Trial Phase):</p>
                    <p>Keep 100% of your sales. We're building this for chefs, so we're waiving our cut.</p>
                    <p className="text-sm italic">Standard payment processing fees apply (2.9% + 30¢ via Stripe)</p>
                    <div className="mt-4 p-4 bg-gray-50 rounded">
                      <p className="font-semibold">Example:</p>
                      <p>Customer pays $30 for your meal</p>
                      <p>Stripe takes $1.17 (2.9% + 30¢)</p>
                      <p className="font-bold text-green-600">YOU KEEP: $28.83</p>
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold mb-2">After Trial Phase:</p>
                    <p>We'll transition to our standard model: 15-20% platform fee. But here's why that still works better than everything else:</p>
                    <p className="mt-2">Compare to DoorDash/Uber Eats: 65-70% to you (30-35% they take)</p>
                    <p className="font-semibold text-primary mt-4">We're highest commission because we do the most work. And we're transparent about it.</p>
                  </div>
                </CardContent>
              </Card>
              </FadeInSection>

              {/* Benefit 3 */}
              <FadeInSection delay={2}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
                    <Utensils className="h-6 w-6 text-orange-600" />
                  </div>
                  <CardTitle className="text-xl">Your Menu. Your Vision. Your Brand.</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-gray-700">
                  <div>
                    <p className="font-semibold mb-2">Restaurant Kitchen Reality:</p>
                    <p>The menu gets decided in a meeting. You execute it. Your ideas? They compete with "what the owner thinks will sell." You're a tool. A skilled tool. But a tool nonetheless.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-2">Marketplace Seller Reality:</p>
                    <p>You DO have menu freedom. But you're stuck selling whatever you happen to cook that day, hoping customers want it and coordinate properly via messages. No strategy. No testing. Just hoping.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-2 text-primary">On Local Cooks:</p>
                    <p>You build your menu. Customers see it before ordering. You test what works. You optimize based on real data. Your Indian curries. Your Italian pasta. Your Newfoundland traditions. Your fusion experiments. Whatever represents you as a chef.</p>
                    <p className="mt-4 font-semibold">You're not a restaurant line cook or a marketplace seller. You're a chef with a brand.</p>
                  </div>
                </CardContent>
              </Card>
              </FadeInSection>

              {/* Benefit 4 */}
              <FadeInSection delay={2}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                    <FileCheck className="h-6 w-6 text-purple-600" />
                  </div>
                  <CardTitle className="text-xl">Regulatory Compliance Without the Financial Barrier</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-gray-700">
                  <div>
                    <p className="font-semibold mb-2">The Barrier Nobody Talks About:</p>
                    <p>You want to cook professionally (legally). You need a commercial kitchen. That costs $40,000 to build OR $800-3,000/month to rent.</p>
                    <p className="mt-2">Local Cooks breaks this barrier down.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-2 text-primary">Kitchen Marketplace: Affordable Professional Space</p>
                    <p>Browse certified commercial kitchens in your area. $15-32/hour depending on amenities and location. Start with 4 hours/week while you test the market. Scale to 8, 12, 16 hours as orders grow.</p>
                    <p className="mt-4 font-semibold">The Math:</p>
                    <p>By month 3-4, your orders pay for the kitchen. By month 6, you're scaling. By month 12, you've built a legitimate, documented business.</p>
                  </div>
                </CardContent>
              </Card>
              </FadeInSection>

              {/* Benefit 5 */}
              <FadeInSection delay={3}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center mb-4">
                    <Users className="h-6 w-6 text-pink-600" />
                  </div>
                  <CardTitle className="text-xl">You Own the Relationship. Not the Platform.</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-gray-700">
                  <div>
                    <p className="font-semibold mb-2">The DoorDash/UberEats Problem:</p>
                    <p>They own your customer. You're a vendor. They're the brand. If you leave the platform, your customers disappear.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-2">The Marketplace Reality:</p>
                    <p>You DO have your customers. But they're scattered. 30 WhatsApp contacts. 20 Instagram DMs. 10 Facebook messages. You can't email them. You can't analyze patterns.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-2 text-primary">On Local Cooks:</p>
                    <p>Your profile is your brand. Your customers see your story, your food, your personality. You collect customer contact information (permission-based, ethically). Your customer base is an asset YOU OWN.</p>
                    <p className="mt-4 font-semibold">This is the difference between having a gig on an app and owning an actual food brand.</p>
                  </div>
                </CardContent>
              </Card>
              </FadeInSection>

              {/* Benefit 6 */}
              <FadeInSection delay={3}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
                    <Heart className="h-6 w-6 text-indigo-600" />
                  </div>
                  <CardTitle className="text-xl">Mentorship from Chefs Who've Already Done This</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-gray-700">
                  <div>
                    <p className="font-semibold mb-2">Restaurant Kitchen Isolation:</p>
                    <p>You're in a hierarchy. Other line cooks are competition for the best stations. Senior chefs aren't mentoring. They're gatekeeping. Knowledge is hoarded.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-2">Marketplace Seller Isolation:</p>
                    <p>You're alone. No peer network. No one to ask "am I pricing right?" No one to share suppliers who won't flake out.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-2 text-primary">On Local Cooks:</p>
                    <p>Private community (just our chefs). Slack channel. Real conversations. You learn from chefs 6 months ahead of you. You help chefs 6 months behind. You build a network, not just a revenue stream.</p>
                    <p className="mt-4 font-semibold">This community is why chefs stay on Local Cooks. The app is great. But the people? That's the real competitive advantage.</p>
                  </div>
                </CardContent>
              </Card>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* PART 3: TRIAL PHASE HIGHLIGHT */}
        <section className="py-16 px-4 bg-gradient-to-r from-primary/10 to-orange-100">
          <div className="container mx-auto max-w-4xl text-center">
            <FadeInSection>
              <h2 className="text-4xl font-bold mb-6">Trial Phase: Keep 100% to Prove We're Worth It</h2>
              <p className="text-lg text-gray-700 mb-8">
              We're not asking you to trust us yet. During trial, you keep everything. Every dollar customers pay (minus Stripe's 2.9% + 30¢). We handle customer management, order coordination, payment processing, data tracking, delivery logistics, and customer support. You keep 100%.
            </p>
            <div className="bg-white p-6 rounded-lg shadow-lg text-left max-w-2xl mx-auto">
              <p className="font-semibold mb-4">Trial Phase Details:</p>
              <ul className="space-y-2">
                <li>✓ Duration: Trial period as specified</li>
                <li>✓ Commission: 0% (platform fee waived)</li>
                <li>✓ Payment processing: 2.9% + 30¢ (Stripe standard)</li>
                <li>✓ Minimum order volume: None</li>
                <li>✓ Exit: Free to leave anytime</li>
              </ul>
              <p className="mt-4 font-semibold text-primary">What you pay: Only what Stripe charges. What you earn: Everything else.</p>
            </div>
            </FadeInSection>
          </div>
        </section>

        {/* PART 4: HOW IT WORKS (3-STEP FLOW) */}
        <section className="py-16 px-4 bg-white">
          <div className="container mx-auto max-w-6xl">
            <FadeInSection>
              <h2 className="text-4xl font-bold text-center mb-12">How It Works</h2>
            </FadeInSection>
            <div className="grid md:grid-cols-3 gap-8">
              <FadeInSection delay={1}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 mx-auto">
                    <span className="text-2xl font-bold text-blue-600">1</span>
                  </div>
                  <CardTitle className="text-xl text-center">15 Minutes to Get Started</CardTitle>
                </CardHeader>
                <CardContent className="text-gray-700">
                  <p>We need to know you. Not a corporate bio. The real story. What cuisines do you cook? What's your background? Why do you cook? Upload a photo. Share 3-5 sentences about yourself. Once you submit, we review in 24 hours. Most chefs are approved and live on the same day.</p>
                </CardContent>
              </Card>
              </FadeInSection>

              <FadeInSection delay={2}>
                <Card className="border-2 card-hover">
                  <CardHeader>
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 mx-auto">
                      <span className="text-2xl font-bold text-green-600">2</span>
                    </div>
                    <CardTitle className="text-xl text-center">Make Your Food Impossible to Ignore</CardTitle>
                  </CardHeader>
                  <CardContent className="text-gray-700">
                    <p>Food is visual. Your food is beautiful. We guide you through uploading great menu items: Clear, well-lit photos of actual food you cook. Ingredient lists and dietary info. Price per serving or full order. Prep time. Your menu is your storefront. Make it count.</p>
                  </CardContent>
                </Card>
              </FadeInSection>

              <FadeInSection delay={3}>
                <Card className="border-2 card-hover">
                <CardHeader>
                  <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-4 mx-auto">
                    <span className="text-2xl font-bold text-purple-600">3</span>
                  </div>
                  <CardTitle className="text-xl text-center">Orders Come In. You Cook. Money Goes to Your Account.</CardTitle>
                </CardHeader>
                <CardContent className="text-gray-700">
                  <p>Customers browse menus. They order your food. The order flows into your app with all details. You cook. You keep 100% during trial. (Only Stripe charges apply: 2.9% + 30¢) Weekly payouts to your bank account. Transparent earnings dashboard shows exactly what you made.</p>
                </CardContent>
              </Card>
              </FadeInSection>
            </div>
          </div>
        </section>

        {/* PART 5: REALITY CHECK */}
        <section className="py-16 px-4 bg-gray-50">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-4xl font-bold text-center mb-12">From Chaos to Clarity. From Scrambling to System.</h2>
            <div className="grid md:grid-cols-2 gap-8">
              <Card className="border-2 border-red-200">
                <CardHeader>
                  <CardTitle className="text-xl text-red-600">IF YOU'RE IN A RESTAURANT:</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-gray-700">
                  <p><X className="inline h-4 w-4 text-red-600" /> 14-16 hour shifts for a fixed paycheck</p>
                  <p><X className="inline h-4 w-4 text-red-600" /> No autonomy over menu or plating</p>
                  <p><X className="inline h-4 w-4 text-red-600" /> Exhausted even when you're winning</p>
                  <p><X className="inline h-4 w-4 text-red-600" /> Building someone else's brand</p>
                  <p className="mt-4 font-semibold">RESULT: You're trapped. Good at your job, but trapped.</p>
                </CardContent>
              </Card>

              <Card className="border-2 border-red-200">
                <CardHeader>
                  <CardTitle className="text-xl text-red-600">IF YOU'RE SELLING ON MARKETPLACE:</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-gray-700">
                  <p><X className="inline h-4 w-4 text-red-600" /> 30 WhatsApp conversations per day</p>
                  <p><X className="inline h-4 w-4 text-red-600" /> Customers asking "Can you deliver?" 50 times/week</p>
                  <p><X className="inline h-4 w-4 text-red-600" /> Multiple payment methods with zero tracking</p>
                  <p><X className="inline h-4 w-4 text-red-600" /> Phone exploding with notifications</p>
                  <p><X className="inline h-4 w-4 text-red-600" /> No data. No patterns. Just hope.</p>
                  <p className="mt-4 font-semibold">RESULT: You're winning but exhausted. Viral but chaotic.</p>
                </CardContent>
              </Card>
            </div>

            <Card className="border-2 border-green-200 mt-8">
              <CardHeader>
                <CardTitle className="text-xl text-green-600">ON LOCAL COOKS (DURING TRIAL - KEEP 100%):</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-gray-700">
                <div>
                  <p className="font-semibold mb-2">If Restaurant Chef:</p>
                  <ul className="space-y-1">
                    <li><CheckCircle2 className="inline h-4 w-4 text-green-600" /> Keep 100% of earnings (only Stripe 2.9% + 30¢)</li>
                    <li><CheckCircle2 className="inline h-4 w-4 text-green-600" /> Cook YOUR food, not theirs</li>
                    <li><CheckCircle2 className="inline h-4 w-4 text-green-600" /> 10-20 hours/week (you decide)</li>
                    <li><CheckCircle2 className="inline h-4 w-4 text-green-600" /> Build your brand (asset you own)</li>
                    <li><CheckCircle2 className="inline h-4 w-4 text-green-600" /> Work-life balance is real</li>
                  </ul>
                </div>
                <div>
                  <p className="font-semibold mb-2">If Marketplace Seller:</p>
                  <ul className="space-y-1">
                    <li><CheckCircle2 className="inline h-4 w-4 text-green-600" /> One organized inbox (not 30 chats)</li>
                    <li><CheckCircle2 className="inline h-4 w-4 text-green-600" /> Professional payment system (automatic)</li>
                    <li><CheckCircle2 className="inline h-4 w-4 text-green-600" /> Customer data (patterns, preferences)</li>
                    <li><CheckCircle2 className="inline h-4 w-4 text-green-600" /> Legitimate operations (regulated)</li>
                    <li><CheckCircle2 className="inline h-4 w-4 text-green-600" /> Growth that feels sustainable</li>
                  </ul>
                </div>
                <p className="mt-4 font-semibold text-primary">RESULT (Both): Your passion and your business align.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* PART 6: EARNINGS MODEL SECTION */}
        <section id="earnings" className="py-16 px-4 bg-white">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-4xl font-bold text-center mb-8">Trial Phase: Keep 100%. Then 80-85%. Then Decide.</h2>
            <p className="text-lg text-center text-gray-700 mb-12">
              During trial, you keep everything. See how it works. See the difference it makes. Then decide if 15-20% is worth the infrastructure.
            </p>

            <div className="space-y-8">
              <Card className="border-2 border-green-200 bg-green-50">
                <CardHeader>
                  <CardTitle className="text-2xl text-green-700">TRIAL PHASE - KEEP 100% DURING TESTING</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-gray-700">
                  <div className="flex justify-between">
                    <span>Customer Order Value:</span>
                    <span className="font-semibold">$30</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Food Cost (ingredients):</span>
                    <span className="text-red-600">-$8 (27%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Your Profit Per Order:</span>
                    <span className="font-semibold">$22</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Payment Processing (Stripe):</span>
                    <span className="text-red-600">-$1.17 (2.9% + 30c)</span>
                  </div>
                  <div className="flex justify-between border-t-2 pt-2 mt-2">
                    <span className="font-bold text-lg">YOU KEEP (NET):</span>
                    <span className="font-bold text-lg text-green-600">$20.83 per order ✓✓✓</span>
                  </div>
                  <p className="text-sm italic mt-4">NOTE: Zero platform fees during trial. Only standard payment processing applies.</p>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-2xl">AFTER TRIAL - STANDARD MODEL: 80-85% TO YOU</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-gray-700">
                  <div className="flex justify-between">
                    <span>Customer Order Value:</span>
                    <span className="font-semibold">$30</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Food Cost (ingredients):</span>
                    <span className="text-red-600">-$8 (27%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Your Profit Per Order:</span>
                    <span className="font-semibold">$22</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Local Cooks Fee (15-20%):</span>
                    <span className="text-red-600">-$4.50</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Payment Processing (Stripe):</span>
                    <span className="text-red-600">-$1.17 (2.9% + 30c)</span>
                  </div>
                  <div className="flex justify-between border-t-2 pt-2 mt-2">
                    <span className="font-bold text-lg">YOU KEEP (NET):</span>
                    <span className="font-bold text-lg text-green-600">$16.33 per order ✓</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-xl">EARNINGS AT DIFFERENT SCALES</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-gray-700">
                  <div>
                    <p className="font-semibold">TESTING PHASE: 5 orders/week (using trial 100%)</p>
                    <p>$20.83 × 5 × 4 weeks = <span className="font-bold text-green-600">$416/month</span></p>
                    <p className="text-sm">➜ Side income while you keep your day job</p>
                  </div>
                  <div>
                    <p className="font-semibold">PART-TIME: 15 orders/week (after trial, standard rates)</p>
                    <p>$16.33 × 15 × 4 weeks = <span className="font-bold text-green-600">$980/month</span></p>
                    <p className="text-sm">➜ Meaningful income alongside employment</p>
                  </div>
                  <div>
                    <p className="font-semibold">SERIOUS PART-TIME: 30 orders/week</p>
                    <p>$16.33 × 30 × 4 weeks = <span className="font-bold text-green-600">$1,960/month</span></p>
                    <p className="text-sm">➜ Full-time equivalent for some chefs</p>
                  </div>
                  <div>
                    <p className="font-semibold">FULL-TIME: 50 orders/week</p>
                    <p>$16.33 × 50 × 4 weeks = <span className="font-bold text-green-600">$3,266/month</span></p>
                    <p className="text-sm">➜ Approaching professional income</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* PART 7: KITCHEN MARKETPLACE SECTION */}
        <section className="py-16 px-4 bg-light-gray">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-4xl font-bold text-center mb-4">No Kitchen? No Problem.</h2>
            <p className="text-xl text-center text-gray-700 mb-12">
              Professional Space. Affordable Hours. Proven Results.
            </p>
            <p className="text-center text-gray-600 mb-12 max-w-3xl mx-auto">
              The #1 question from chefs ready to go pro: "I want to start, but I don't have a commercial kitchen certified. What do I do?"
              <br /><br />
              You don't need to commit to an expensive build or lease. Our Kitchen Marketplace solves this. Browse real commercial kitchens in your area. Book by the hour. Start small. Scale as you grow.
            </p>

            {kitchensLoading ? (
              <div className="text-center mb-12">
                <p className="text-gray-600">Loading kitchens...</p>
              </div>
            ) : kitchens.length > 0 ? (
              <div className="grid md:grid-cols-3 gap-8 mb-12">
                {kitchens.slice(0, 3).map((kitchen: any) => (
                  <Card key={kitchen.id} className="border-2">
                    <CardHeader>
                      <Building2 className="h-12 w-12 text-blue-600 mb-4" />
                      <CardTitle>{kitchen.name}</CardTitle>
                      <CardDescription>
                        {kitchen.locationName ? `📍 ${kitchen.locationName}` : kitchen.locationAddress ? `📍 ${kitchen.locationAddress}` : ""}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-gray-700">
                      {kitchen.description && (
                        <p className="text-sm">{kitchen.description}</p>
                      )}
                      <Button 
                        className="w-full mt-4" 
                        onClick={() => navigate('/portal/book')}
                      >
                        Book This Kitchen
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center mb-12">
                <Button 
                  size="lg" 
                  onClick={() => navigate('/portal/book')}
                  className="bg-primary hover:bg-primary/90 text-white font-semibold py-6 px-8 text-lg"
                >
                  <Building2 className="h-5 w-5 mr-2" />
                  Browse Available Kitchens
                </Button>
              </div>
            )}

            <Card className="border-2 bg-blue-50">
              <CardHeader>
                <CardTitle className="text-2xl">Own a Commercial Kitchen with Empty Hours?</CardTitle>
              </CardHeader>
              <CardContent className="text-gray-700">
                <p className="mb-4">
                  Partner with Local Cooks and monetize your empty kitchen hours.
                </p>
                <p className="mb-4 font-semibold">How it works:</p>
                <ul className="space-y-2 mb-4">
                  <li>✓ List your kitchen (you set the price)</li>
                  <li>✓ Chefs book (we handle scheduling)</li>
                  <li>✓ You do facility checks (minimal effort)</li>
                  <li>✓ Get paid weekly to your account</li>
                </ul>
                <Button onClick={() => navigate('/portal/book')}>
                  List Your Kitchen
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* PART 8: SOCIAL PROOF */}
        <section className="py-16 px-4 bg-white">
          <div className="container mx-auto max-w-6xl">
            <h2 className="text-4xl font-bold text-center mb-12">Join Our Growing Community</h2>
            <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
              Chefs from across Newfoundland are building their culinary businesses on Local Cooks. 
              Join a community of passionate cooks who are turning their skills into sustainable businesses.
            </p>
            <div className="text-center">
              <Button
                onClick={handleGetStarted}
                size="lg"
                className="bg-primary hover:bg-primary/90 text-white font-semibold py-6 px-8 text-lg"
              >
                Start Your Journey Today
              </Button>
            </div>
          </div>
        </section>

        {/* PART 9: FAQ */}
        <section className="py-16 px-4 bg-gray-50">
          <div className="container mx-auto max-w-4xl">
            <h2 className="text-4xl font-bold text-center mb-12">Frequently Asked Questions</h2>
            
            <div className="space-y-6">
              <Card className="border-2">
                <CardHeader>
                  <CardTitle>How long does approval take?</CardTitle>
                </CardHeader>
                <CardContent className="text-gray-700">
                  <p><strong>A:</strong> 15 minutes to apply. 24 hours to hear back. We review your profile, food story, menu, and photos. We're looking for chefs who care about quality. Fast approval because we want you live and earning ASAP.</p>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader>
                  <CardTitle>Do I need a commercial kitchen already?</CardTitle>
                </CardHeader>
                <CardContent className="text-gray-700">
                  <p><strong>A:</strong> No. Many of our chefs use our Kitchen Marketplace. If you have a certified kitchen, start immediately. If not: Browse available kitchens, book by the hour. $15-32/hour depending on location and amenities. By month 3-4, orders pay for the kitchen.</p>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader>
                  <CardTitle>What exactly happens during trial phase?</CardTitle>
                </CardHeader>
                <CardContent className="text-gray-700">
                  <p><strong>A:</strong> You keep 100% of your sales (minus only Stripe's 2.9% + 30¢). We handle customer management, order coordination, payment processing, delivery logistics, data tracking, and customer support. You experience full infrastructure with zero commission cost.</p>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader>
                  <CardTitle>Can I quit my restaurant job and go full-time?</CardTitle>
                </CardHeader>
                <CardContent className="text-gray-700">
                  <p><strong>A:</strong> Yes, but strategically. Most chefs: Month 1-2: Work restaurant job + cook 5-10 hours/week. Month 3-4: Build reviews, test demand. Month 5-6: Restaurant job + 15-20 hours/week. Month 7+: Quit when you're making 80%+ of your restaurant salary. Fastest: 6 months. Most common: 9-12 months.</p>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader>
                  <CardTitle>I'm already on Facebook Marketplace. Will this replace it?</CardTitle>
                </CardHeader>
                <CardContent className="text-gray-700">
                  <p><strong>A:</strong> No. It complements it. Orders flow through Local Cooks (organized). Payments process through Local Cooks (professional). Customer data lives in Local Cooks (actionable). You can still post to Facebook/Instagram. Your social media still drives traffic TO Local Cooks. Think: Facebook Marketplace = Discovery channel. Local Cooks = Professional operations.</p>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader>
                  <CardTitle>What if I fail? Can I quit?</CardTitle>
                </CardHeader>
                <CardContent className="text-gray-700">
                  <p><strong>A:</strong> Yes, completely free to leave. No contracts. No commitments. No penalties. Want to pause for a month? Done. Want to quit? Done. Want to come back later? We reactivate you. You're an independent operator, not an employee.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* PART 10: CLOSING + NEWSLETTER */}
        <section className="py-16 px-4 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-4xl md:text-5xl font-bold mb-8">Your Skill Deserves Better. Your Life Deserves Better. It's Time.</h2>
            
            <div className="text-left max-w-3xl mx-auto space-y-6 mb-12 text-lg">
              <div>
                <p className="font-semibold mb-2">TO THE RESTAURANT CHEFS:</p>
                <p>For years, you've cooked in someone else's vision. Answered to someone else's standards. Made someone else rich. You're done. And you're right to be done. What if the next great meal you cook is for yourself? Your food. Your rules. Your kitchen. Your customers. Your brand. Your business.</p>
              </div>
              
              <div>
                <p className="font-semibold mb-2">TO THE MARKETPLACE SELLERS:</p>
                <p>You've proven the demand is real. Your customers prove it every day. But you're doing it the hard way—managing chaos, coordinating chaos, living in chaos. What if everything else just... worked? One organized system. Professional operations. Your food. Your customers. Your data. Your business.</p>
              </div>
              
              <div>
                <p className="font-semibold mb-2">TO EVERYONE:</p>
                <p>Local Cooks isn't about maximum hustle or venture-backed hype. It's about cooking with freedom, earning what you're worth, building a community, expressing your creativity, living on your terms, actually having time. You've trained long enough. Your skill deserves to be rewarded. Your life deserves to be lived. It's time to build something that's yours.</p>
              </div>
            </div>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20 mb-12">
              <CardHeader>
                <CardTitle className="text-2xl text-white">
                  {statsLoading ? (
                    "Join Chefs Building the Future of Food in Newfoundland"
                  ) : stats?.totalChefs ? (
                    `Join ${stats.totalChefs}+ Chefs Building the Future of Food in Newfoundland`
                  ) : (
                    "Join Chefs Building the Future of Food in Newfoundland"
                  )}
                </CardTitle>
                <CardDescription className="text-white/80">
                  Get weekly tips: menu pricing, customer communication, scaling strategies, and stories from chefs who made the jump. Real strategies. No fluff. Just what works.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleNewsletterSubmit} className="flex gap-4">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="flex-1 px-4 py-3 rounded-lg text-gray-900"
                    required
                  />
                  <Button type="submit" className="bg-primary hover:bg-primary/90">
                    Send Me the Chef Tips
                  </Button>
                </form>
                <p className="text-sm text-white/70 mt-2">✓ No spam. No nonsense. ✓ Just real strategies that work. ✓ Unsubscribe anytime.</p>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Button
                onClick={handleGetStarted}
                size="lg"
                className="bg-white text-gray-900 hover:bg-gray-100 font-semibold py-6 px-8 text-lg"
              >
                Start Your Application Now
              </Button>
              <p className="text-lg">
                Approved in 24 hours. Keep 100% during trial.
                <br />
                Whether you're leaving a restaurant or scaling from Marketplace,
                <br />
                your next chapter starts this week.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
