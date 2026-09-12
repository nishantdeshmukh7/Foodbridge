import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  ArrowRight, Truck, Users, Building, ShieldCheck,
  Leaf, Heart, Globe, Star, CheckCircle, AlertCircle,
  Package
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

// Phase 16: consolidated from 5 steps to 4, matched 1:1 to the real
// Donation status states (AVAILABLE -> CLAIMED -> PICKED_UP -> DELIVERED).
// Removed: 5km-radius NGO alerts, capacity-based allocation, automated
// volunteer matching, in-app navigation, real-time tracking, photo
// documentation, and digital/recipient signature capture - none of these
// exist. Corrected: the food safety checklist is completed by the DONOR
// when creating the listing, not by the volunteer at pickup. Corrected:
// volunteer assignment is either self-accept by a volunteer or manual
// assignment by an admin - never NGO-initiated.
const detailedSteps = [
  {
    num: "01",
    title: "List Your Surplus",
    desc: "When your restaurant, hotel, or event has leftover food, simply list it on our platform in under 30 seconds.",
    details: [
      "Enter food type and quantity",
      "Set pickup location",
      "Choose expiry window (1-24 hours)",
      "Add optional description",
      "Mark as urgent if time-critical",
      "Confirm the food safety checklist",
    ],
    icon: Package,
  },
  {
    num: "02",
    title: "NGO Claims Donation",
    desc: "Approved NGOs can browse every available donation and claim the ones they can use.",
    details: [
      "View donation details on the dashboard",
      "One-tap claim functionality",
      "Donor and NGO are notified once claimed",
    ],
    icon: Heart,
  },
  {
    num: "03",
    title: "Volunteer Pickup",
    desc: "A volunteer accepts the pickup themselves, or an admin assigns one directly, then collects the food from the donor.",
    details: [
      "Volunteer self-accepts an available pickup, or an admin assigns one",
      "Volunteer confirms the pickup",
      "Food is collected from the donor location",
    ],
    icon: Truck,
  },
  {
    num: "04",
    title: "Delivery & Completion",
    desc: "The volunteer delivers the food to the claiming NGO and marks it complete.",
    details: [
      "Food is transported to the NGO",
      "Volunteer marks the donation delivered",
      "Donor and NGO are both notified",
    ],
    icon: Globe,
  },
];

const useCases = [
  {
    title: "Restaurant End of Day",
    desc: "Hotels and restaurants often have surplus food from daily operations that can still be consumed.",
    icon: Building,
    example: "A restaurant closing at 11 PM with 25 kg of rice and dal that would otherwise be discarded.",
  },
  {
    title: "Event Catering",
    desc: "Weddings, conferences, and parties generate significant leftover food that can be redirected.",
    icon: Users,
    example: "A corporate event with 100 boxed lunches remaining after the program ends.",
  },
  {
    title: "Hostel & Mess",
    desc: "Student hostels and mess facilities frequently have excess food that can help those in need.",
    icon: Building,
    example: "A college hostel mess with leftover breakfast supplies.",
  },
  {
    title: "Bakery Items",
    desc: "Bakeries have fresh items that won't sell after the day ends but are still perfectly safe to consume.",
    icon: Star,
    example: "A bakery with unsold pastries and breads at closing time.",
  },
];

// Phase 16: matches the real checklist a donor confirms when creating a
// listing (see DonorDashboard's New Food Listing form) exactly - no
// fabricated temperature thresholds, time windows, or allergy fields.
const safetyChecklist = [
  "Food prepared in hygienic conditions",
  "Stored at proper temperature",
  "No signs of spoilage",
  "Packed in clean containers",
];

// Phase 16: rewritten for accuracy. Removed a fabricated pickup-time SLA
// (no such guarantee exists), "beverages" as a food type (not one of the
// real options), a volunteer-reimbursement claim (doesn't exist), and a
// claim that NGOs can set food-type/quantity preferences (no such profile
// field exists). Corrected the safety-checklist FAQ to attribute it to the
// donor at listing time, not the volunteer at pickup, and removed the
// fabricated photo-documentation claim. Corrected the expiry FAQ to
// honestly state that expired listings are not automatically removed.
const faqs = [
  {
    q: "How quickly can a donation be picked up?",
    a: "It depends on how quickly a volunteer accepts (or an admin assigns) the pickup after an NGO claims the donation - there's no fixed guarantee. Marking a listing urgent helps it stand out.",
  },
  {
    q: "What types of food can be donated?",
    a: "Cooked food, raw ingredients, packaged food, fruits & vegetables, and bakery items. All items must be safe for consumption and meet our food safety checklist.",
  },
  {
    q: "Is there any cost involved?",
    a: "No, the platform is free for all users - donors, NGOs, and volunteers.",
  },
  {
    q: "How do you ensure food safety?",
    a: "Donors confirm a food safety checklist - hygienic preparation, proper storage temperature, no signs of spoilage, and clean packaging - before a listing can be posted.",
  },
  {
    q: "Can NGOs request specific items?",
    a: "NGOs can browse every available donation and claim the ones that match their needs. There's currently no way to set standing preferences or get notified about specific food types.",
  },
  {
    q: "What happens if food expires before pickup?",
    a: "Currently, the platform does not automatically remove or flag donations once their expiry window passes - the listing stays as-is unless a donor cancels it. We recommend checking expiry times before claiming or assigning a pickup.",
  },
];

const HowItWorks = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Hero Section */}
      <section className="border-b border-border">
        <div className="container py-16 md:py-20">
          <div className="max-w-3xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Complete Guide
              </span>
              <h1 className="text-4xl md:text-6xl font-black tracking-tight mt-2 mb-6">
                How FoodBridge
                <br />
                <span className="text-primary">Works</span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mb-8">
                A complete walkthrough of our food redistribution process. From listing surplus food to delivering meals to those in need — every step matters.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  to="/register"
                  className="bg-primary text-primary-foreground font-semibold px-6 py-3 text-sm uppercase tracking-wider hover:brightness-110 transition-all flex items-center gap-2"
                >
                  Get Started <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/#impact"
                  className="border border-border font-semibold px-6 py-3 text-sm uppercase tracking-wider hover:bg-card transition-all flex items-center gap-2"
                >
                  See Our Impact
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Detailed Steps Section */}
      <section className="border-b border-border bg-card">
        <div className="container py-16 md:py-20">
          <div className="mb-12">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Step by Step</span>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-2">
              The Complete Workflow
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl">
              From the moment surplus food is listed to when it reaches those in need — here's exactly what happens at each stage.
            </p>
          </div>

          <div className="space-y-6">
            {detailedSteps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="border border-border bg-background"
              >
                <div className="p-6 md:p-8">
                  <div className="flex flex-col md:flex-row gap-6 md:items-start">
                    <div className="flex-shrink-0">
                      <div className="w-14 h-14 bg-primary/10 flex items-center justify-center">
                        <step.icon className="w-7 h-7 text-primary" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-xs font-mono text-primary font-semibold uppercase">
                          Step {step.num}
                        </span>
                      </div>
                      <h3 className="font-bold text-xl md:text-2xl mb-3">{step.title}</h3>
                      <p className="text-muted-foreground leading-relaxed mb-4">{step.desc}</p>
                      
                      <div className="bg-card p-4 border border-border">
                        <h4 className="text-xs font-semibold uppercase tracking-wider mb-3">What happens:</h4>
                        <ul className="space-y-2">
                          {step.details.map((detail, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm">
                              <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                              <span className="text-muted-foreground">{detail}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="border-b border-border">
        <div className="container py-16 md:py-20">
          <div className="mb-12">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Real Scenarios</span>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-2">
              What Can Be Donated?
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl">
              Learn about the different types of surplus food that can be redirected through our platform.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {useCases.map((useCase, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="border border-border bg-card p-6"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <useCase.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg mb-2">{useCase.title}</h3>
                    <p className="text-sm text-muted-foreground mb-3">{useCase.desc}</p>
                    <div className="bg-background border border-border p-3">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Example: </span>
                        {useCase.example}
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Safety Section */}
      <section className="border-b border-border bg-card">
        <div className="container py-16 md:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Safety First</span>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-2 mb-4">
                Food Safety Standards
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-6">
                We take food safety seriously. Every donor confirms this checklist before a listing can be posted.
              </p>

              <div className="space-y-4">
                {safetyChecklist.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-background border border-border p-6">
              <div className="flex items-center gap-3 mb-6">
                <AlertCircle className="w-6 h-6 text-amber-500" />
                <h3 className="font-bold text-lg">Guidance For Donors</h3>
              </div>
              {/* Phase 16: reworded from "Important Guidelines" / "Cannot Be
                  Donated" framing, which implied the platform checks and
                  enforces these specifics (a 4-hour sitting-out limit,
                  reheated-food detection). No such enforcement exists -
                  the only real check is the donor's own checklist
                  confirmation above. This is now explicitly self-check
                  guidance for the donor, not a claimed platform capability. */}

              <div className="space-y-4">
                <div className="p-4 border border-border">
                  <h4 className="font-semibold text-sm mb-2 text-red-500">Please Don't List</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Expired or spoiled food</li>
                    <li>• Food that has been sitting out for more than 4 hours</li>
                    <li>• Reheated food that wasn't consumed</li>
                    <li>• Food with damaged packaging</li>
                  </ul>
                </div>
                
                <div className="p-4 border border-border">
                  <h4 className="font-semibold text-sm mb-2 text-green-500">Recommended</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Freshly prepared food within same day</li>
                    <li>• Properly stored and packaged items</li>
                    <li>• Items with clear labeling</li>
                    <li>• Food that can be easily transported</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="border-b border-border bg-card">
        <div className="container py-16 md:py-20">
          <div className="mb-12">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Questions</span>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-2">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
            {faqs.map((faq, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="border border-border bg-background p-5"
              >
                <h4 className="font-bold mb-2">{faq.q}</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-foreground text-background">
        <div className="container py-16 md:py-20">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-4">
              <Leaf className="w-6 h-6 text-primary" />
              <span className="text-xs font-mono uppercase tracking-wider">Join the Movement</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Ready to Make a Difference?
              <br />
              <span className="text-primary">Every Meal Counts.</span>
            </h2>
            <p className="text-sm opacity-60 mb-8 max-w-lg leading-relaxed">
              Whether you're a restaurant with surplus food, an NGO serving communities, or a volunteer ready to help — your contribution matters.
            </p>
            <div className="flex flex-col sm:flex-row gap-0">
              <Link
                to="/register"
                className="bg-primary text-primary-foreground font-semibold px-8 py-4 text-sm uppercase tracking-wider hover:brightness-110 transition-all flex items-center justify-center gap-2"
              >
                Create Account <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/login"
                className="border border-background/30 text-background font-semibold px-8 py-4 text-sm uppercase tracking-wider hover:bg-background hover:text-foreground transition-all flex items-center justify-center"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default HowItWorks;
