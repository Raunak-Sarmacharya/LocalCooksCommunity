import { Link } from "wouter";
import { Facebook, Phone, Mail, MapPin, Heart, ChefHat } from "lucide-react";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";

export default function Footer() {
  return (
    <footer className="bg-gradient-to-t from-slate-900 to-slate-800 text-white pt-12 pb-6 px-4">
      <div className="container mx-auto">
        <div className="flex flex-col md:flex-row justify-between mb-8 pb-8 border-b border-white/10">
          <div className="mb-8 md:mb-0 md:w-1/3">
            <div className="mb-5">
              <Logo variant="white" className="h-14 w-auto" />
            </div>
            <p className="text-gray-300 mb-6 max-w-md">
              Connecting talented home chefs with hungry customers. We're building more than a platform – we're creating a community where cooks and customers connect directly.
            </p>
            <Button
              asChild
              variant="outline"
              className="rounded-full border-white/20 bg-white/5 hover:bg-white/10 hover-standard text-white"
            >
              <Link href="/apply">
                <ChefHat className="mr-2 h-4 w-4" />
                Join as a Cook
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 md:w-3/5">
            <div>
              <h3 className="text-lg font-bold mb-4 text-primary">Contact Us</h3>
              <ul className="space-y-3">
                <li className="flex items-center gap-2 text-gray-300 hover:text-white hover-text">
                  <Mail className="h-4 w-4 text-primary" />
                  <span>admin@localcook.shop</span>
                </li>
                <li className="flex items-center gap-2 text-gray-300 hover:text-white hover-text">
                  <Phone className="h-4 w-4 text-primary" />
                  <span>(709) 689-2942</span>
                </li>
                <li className="flex items-center gap-2 text-gray-300 hover:text-white hover-text">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span>St. John's, NL, Canada</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-bold mb-4 text-primary">Quick Links</h3>
              <ul className="space-y-2">
                <li>
                  <Link href="/#how-it-works" className="text-gray-300 hover:text-white hover-text">
                    How It Works
                  </Link>
                </li>
                <li>
                  <Link href="/#benefits" className="text-gray-300 hover:text-white hover-text">
                    Benefits
                  </Link>
                </li>
                <li>
                  <Link href="/#about" className="text-gray-300 hover:text-white hover-text">
                    About Us
                  </Link>
                </li>
                <li>
                  <Link href="/apply" className="text-gray-300 hover:text-white hover-text">
                    Apply Now
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-bold mb-4 text-primary">Connect</h3>
              <div className="flex space-x-4 mb-6">
                <a
                  href="https://www.facebook.com/LocalCooks"
                  className="bg-white/10 p-2 rounded-full hover:bg-primary/80 hover-standard"
                  aria-label="Facebook"
                  target="_blank"
                >
                  <Facebook className="h-5 w-5" />
                </a>
              </div>
              <p className="text-sm text-gray-400">
                Subscribe to our newsletter for the latest updates and opportunities.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center text-sm text-gray-400">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <p>&copy; {new Date().getFullYear()} Local Cooks. All rights reserved.</p>

          </div>
          <div className="flex mt-4 md:mt-0">
            <span className="flex items-center">
              Made with <Heart className="h-3 w-3 mx-1 text-primary" /> in St. John's, NL
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
