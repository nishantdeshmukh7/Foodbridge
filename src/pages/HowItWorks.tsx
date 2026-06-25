import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { 
  ArrowRight, Clock, Truck, Users, Building, ShieldCheck, 
  Leaf, Heart, Globe, Star, CheckCircle, AlertCircle,
  Phone, Mail, MapPin, Timer, Package, RefreshCw
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

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
      "Mark as urgent if time-critical"
    ],
    icon: Package,
  },
  {
    num: "02",
    title: "NGO Claims Donation",
    desc: "Nearby NGOs receive instant notifications and can claim available donations based on their capacity and requirements.",
    details: [
      "Real-time notifications to NGOs within 5km",
      "View donation details and distance",
      "One-tap claim functionality",
      "Capacity-based allocation",
      "Option to request multiple items"
    ],
    icon: Heart,
  },
  {
    num: "03",
    title: "Volunteer Assignment",
    desc: "Once claimed, volunteers are assigned or can accept pickup requests to transport the food from donor to NGO.",
    details: [
      "Automated volunteer matching",
      "Manual assignment option for NGOs",
      "Volunteer accepts and confirms",
      "Navigation to pickup location",
      "Real-time tracking"
    ],
    icon: Truck,
  },
  {
    num: "04",
    title: "Pickup & Verification",
    desc: "Volunteers arrive at the donor location, verify the food quality through safety checklist, and collect the donation.",
    details: [
      "Arrival confirmation at location",
      "Food safety checklist completion",
      "Quantity verification",
      "Photo documentation",
      "Digital signature capture"
    ],
    icon: ShieldCheck,
  },
  {
    num: "05",
    title: "Delivery & Completion",
    desc: "Food is transported to the assigned NGO and delivered to those in need. Impact is tracked and recorded.",
    details: [
      "Navigation to delivery location",
      "Delivery confirmation",
      "Photo proof of delivery",
      "Recipient signature",
      "Impact metrics updated"
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

const safetyChecklist = [
  "Food prepared in hygienic conditions within the last 24 hours",
  "Stored at proper temperature (hot foods above 60°C, cold foods below 4°C)",
  "No signs of spoilage, discoloration, or unusual odor",
  "Packaged in clean, food-grade containers",
  "Allergy information provided where applicable",
  "Within the suggested expiry time window",
  "Sealed properly for transportation",
];

const faqs = [
  {
    q: "How quickly can a donation be picked up?",
    a: "Most donations are picked up within 1-2 hours of listing. Urgent donations with less than 2 hours expiry are prioritized and typically picked up within 30-45 minutes.",
  },
  {
    q: "What types of food can be donated?",
    a: "We accept cooked food, raw ingredients, packaged items, bakery products, fruits and vegetables, and beverages. All items must be safe for consumption and meet our safety standards.",
  },
  {
    q: "Is there any cost involved?",
    a: "No, the platform is completely free for all users. Donors list food for free, NGOs receive donations at no cost, and volunteers can opt for transportation reimbursements.",
  },
  {
    q: "How do you ensure food safety?",
    a: "We have a mandatory safety checklist that volunteers must complete at pickup. Donors also certify that food meets hygiene standards. All steps are documented with photos.",
  },
  {
    q: "Can NGOs request specific items?",
    a: "Yes, NGOs can browse available donations and claim items that match their needs. They can also set preferences for food types and quantities in their profile.",
  },
  {
    q: "What happens if food expires before pickup?",
    a: "If food expires before being picked up, the donation status is updated to 'EXPIRED' and removed from available listings. This helps maintain food safety standards.",
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
                We take food safety seriously. Every donation goes through a verification process to ensure it reaches recipients safely.
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
                <h3 className="font-bold text-lg">Important Guidelines</h3>
              </div>
              
              <div className="space-y-4">
                <div className="p-4 border border-border">
                  <h4 className="font-semibold text-sm mb-2 text-red-500">Cannot Be Donated</h4>
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

      {/* Timeline Section */}
      <section className="border-b border-border">
        <div className="container py-16 md:py-20">
          <div className="mb-12 text-center">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Average Times</span>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-2">
              What to Expect
            </h2>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="relative">
              <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border" />
              
              {[
                { time: "0 min", title: "Donor Lists Food", desc: "Surplus food is listed on the platform" },
                { time: "5-15 min", title: "NGO Receives Alert", desc: "Nearby NGOs get notified and claim donation" },
                { time: "15-30 min", title: "Volunteer Assigned", desc: "Volunteer accepts and heads to pickup" },
                { time: "30-45 min", title: "Food Picked Up", desc: "Volunteer verifies and collects food" },
                { time: "45-60 min", title: "Delivery Complete", desc: "Food delivered to NGO and impact logged" },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="relative pl-20 pb-8 last:pb-0"
                >
                  <div className="absolute left-4 w-8 h-8 bg-primary flex items-center justify-center rounded-full">
                    <span className="text-xs font-bold text-primary-foreground">{i + 1}</span>
                  </div>
                  <div className="bg-card border border-border p-4">
                    <div className="flex items-center gap-3 mb-1">
                      <Timer className="w-4 h-4 text-primary" />
                      <span className="text-xs font-mono text-primary font-semibold">{item.time}</span>
                    </div>
                    <h4 className="font-bold mb-1">{item.title}</h4>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
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

      {/* Contact Section */}
      <section className="border-b border-border">
        <div className="container py-16 md:py-20">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-black tracking-tight mb-4">
              Still Have Questions?
            </h2>
            <p className="text-muted-foreground mb-8">
              Our team is here to help you understand the process and get started.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a 
                href="mailto:support@foodbridge.com" 
                className="flex items-center justify-center gap-2 border border-border px-6 py-3 hover:bg-card transition-colors"
              >
                <Mail className="w-4 h-4" />
                <span className="text-sm font-semibold">support@foodbridge.com</span>
              </a>
              <a 
                href="tel:+919876543210" 
                className="flex items-center justify-center gap-2 border border-border px-6 py-3 hover:bg-card transition-colors"
              >
                <Phone className="w-4 h-4" />
                <span className="text-sm font-semibold">+91 98765 43210</span>
              </a>
            </div>
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
