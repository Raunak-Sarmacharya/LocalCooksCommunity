import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  MessageCircle,
  Mail,
  Phone,
  Clock,
  HelpCircle,
  BookOpen,
  FileText,
  ChefHat,
  Building,
  CreditCard,
  Shield,
  ExternalLink,
  Headphones,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import { useTidioChat } from "@/components/chat/TidioController";

interface ChefSupportPageProps {
  userEmail?: string;
  userName?: string;
  userId?: string;
}

const faqItems = [
  {
    category: "Getting Started",
    icon: ChefHat,
    questions: [
      {
        q: "How do I complete my chef application?",
        a: "Navigate to the Applications tab in your dashboard and click 'Start New Application'. Complete all required fields including your food safety certifications and kitchen preferences.",
      },
      {
        q: "What documents do I need to upload?",
        a: "You'll need a valid Food Safety License and optionally a Food Establishment Certificate. These can be uploaded in the Document Verification section.",
      },
      {
        q: "How long does application review take?",
        a: "Most applications are reviewed within 24-48 hours. You'll receive an email notification once your application status changes.",
      },
    ],
  },
  {
    category: "Kitchen Bookings",
    icon: Building,
    questions: [
      {
        q: "How do I book a commercial kitchen?",
        a: "Go to 'Discover Kitchens' to browse available kitchens. Once you find one you like, submit a kitchen application. After approval, you can book time slots.",
      },
      {
        q: "Can I cancel or reschedule a booking?",
        a: "Yes, you can manage your bookings from the 'My Bookings' tab. Cancellation policies vary by kitchen - check the specific kitchen's terms.",
      },
      {
        q: "What equipment is included with kitchen rentals?",
        a: "Each kitchen listing shows available equipment. Common items include ovens, refrigeration, prep stations, and storage. Check individual listings for specifics.",
      },
    ],
  },
  {
    category: "Payments & Billing",
    icon: CreditCard,
    questions: [
      {
        q: "How do I set up payments?",
        a: "Connect your Stripe account through the Chef Setup page. This enables you to receive payments from customers and pay for kitchen bookings.",
      },
      {
        q: "When do I get paid for my sales?",
        a: "Payments are processed through Stripe and typically arrive in your bank account within 2-3 business days after a successful transaction.",
      },
      {
        q: "How are kitchen booking fees calculated?",
        a: "Fees are based on hourly rates set by each kitchen, plus any additional services like storage or equipment. You'll see the full breakdown before confirming.",
      },
    ],
  },
  {
    category: "Training & Certification",
    icon: BookOpen,
    questions: [
      {
        q: "Is the food safety training mandatory?",
        a: "While not mandatory to join, completing our training modules helps you understand best practices and may be required by some commercial kitchens.",
      },
      {
        q: "How do I access the training videos?",
        a: "Go to the 'Training' tab in your dashboard. Sample videos are available to all users, with full access granted after application approval.",
      },
      {
        q: "Do I get a certificate after completing training?",
        a: "Yes! Upon completing all training modules, you'll receive a downloadable LocalCooks certification that you can share with kitchens and customers.",
      },
    ],
  },
];

const contactMethods = [
  {
    icon: MessageCircle,
    title: "Live Chat",
    description: "Chat with our support team in real-time",
    action: "Start Chat",
    available: true,
    highlight: true,
  },
  {
    icon: Mail,
    title: "Email Support",
    description: "support@localcooks.ca",
    action: "Send Email",
    available: true,
    href: "mailto:support@localcooks.ca",
  },
  {
    icon: Phone,
    title: "Phone Support",
    description: "(709) 689-2942 • Mon-Fri, 9am-5pm NST",
    action: "Call Now",
    available: true,
    href: "tel:+17096892942",
  },
];

export default function ChefSupportPage({ userEmail, userName, userId }: ChefSupportPageProps) {
  const { openChat } = useTidioChat();

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center gap-4 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
            <Headphones className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Support Center</h1>
            <p className="text-muted-foreground mt-1">Get help with your chef account and kitchen bookings</p>
          </div>
        </div>
      </motion.div>

      {/* Quick Contact Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        {contactMethods.map((method, index) => (
          <Card
            key={method.title}
            className={`relative overflow-hidden transition-all duration-300 hover:shadow-lg ${
              method.highlight
                ? "border-primary/50 bg-gradient-to-br from-primary/5 to-primary/10"
                : "border-border/50"
            }`}
          >
            {method.highlight && (
              <div className="absolute top-0 right-0">
                <Badge className="rounded-none rounded-bl-lg bg-primary text-primary-foreground">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Recommended
                </Badge>
              </div>
            )}
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    method.highlight ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  <method.icon className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg">{method.title}</CardTitle>
                  <CardDescription className="text-sm">{method.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {method.available ? (
                method.href ? (
                  <Button asChild variant={method.highlight ? "default" : "outline"} className="w-full">
                    <a href={method.href}>
                      {method.action}
                      <ExternalLink className="h-4 w-4 ml-2" />
                    </a>
                  </Button>
                ) : (
                  <Button
                    variant={method.highlight ? "default" : "outline"}
                    className="w-full"
                    onClick={openChat}
                  >
                    {method.action}
                    <MessageCircle className="h-4 w-4 ml-2" />
                  </Button>
                )
              ) : (
                <Button variant="outline" className="w-full" disabled>
                  {method.action}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      {/* Support Hours Notice */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <div>
                <p className="font-medium text-blue-900 dark:text-blue-100">Support Hours</p>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Our live chat support is available Monday to Friday, 9:00 AM - 5:00 PM NST. 
                  Outside these hours, leave a message and we'll respond within 24 hours.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* FAQ Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <div className="flex items-center gap-3 mb-6">
          <HelpCircle className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold">Frequently Asked Questions</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {faqItems.map((category, categoryIndex) => (
            <Card key={category.category} className="border-border/50">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <category.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{category.category}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {category.questions.map((item, itemIndex) => (
                  <div key={itemIndex} className="space-y-2">
                    <h4 className="font-medium text-sm text-foreground flex items-start gap-2">
                      <span className="text-primary mt-0.5">Q:</span>
                      {item.q}
                    </h4>
                    <p className="text-sm text-muted-foreground pl-5">{item.a}</p>
                    {itemIndex < category.questions.length - 1 && <Separator className="mt-4" />}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.div>

      {/* Quick Links */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <Card className="border-border/50">
          <CardHeader>
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              <CardTitle>Helpful Resources</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Button variant="outline" asChild className="h-auto py-4 justify-start">
                <a href="/chef-setup" className="flex items-center gap-3">
                  <ChefHat className="h-5 w-5 text-primary" />
                  <div className="text-left">
                    <p className="font-medium">Chef Setup Guide</p>
                    <p className="text-xs text-muted-foreground">Complete your profile</p>
                  </div>
                </a>
              </Button>
              <Button variant="outline" asChild className="h-auto py-4 justify-start">
                <a href="/terms" className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-primary" />
                  <div className="text-left">
                    <p className="font-medium">Terms of Service</p>
                    <p className="text-xs text-muted-foreground">Platform policies</p>
                  </div>
                </a>
              </Button>
              <Button variant="outline" asChild className="h-auto py-4 justify-start">
                <a href="/privacy" className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-primary" />
                  <div className="text-left">
                    <p className="font-medium">Privacy Policy</p>
                    <p className="text-xs text-muted-foreground">Data protection</p>
                  </div>
                </a>
              </Button>
              <Button variant="outline" className="h-auto py-4 justify-start" onClick={openChat}>
                <div className="flex items-center gap-3">
                  <MessageCircle className="h-5 w-5 text-primary" />
                  <div className="text-left">
                    <p className="font-medium">Contact Support</p>
                    <p className="text-xs text-muted-foreground">Chat with us now</p>
                  </div>
                </div>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Still Need Help CTA */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <Card className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-primary/20">
          <CardContent className="py-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center">
                  <Headphones className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Still need help?</h3>
                  <p className="text-muted-foreground">
                    Our support team is here to assist you with any questions or issues.
                  </p>
                </div>
              </div>
              <Button size="lg" onClick={openChat} className="gap-2">
                <MessageCircle className="h-5 w-5" />
                Start Live Chat
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
