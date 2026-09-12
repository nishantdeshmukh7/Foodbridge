import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, Clock, Package, HeartHandshake, Truck as TruckIcon } from "lucide-react";

// Phase 16: this used to be a "Live Dispatch Feed" with hardcoded fake
// entries, a fake pulsing "live" indicator, and fake animated progress
// bars presented as real-time platform activity. None of it was real -
// removed rather than built out, per the Phase 16 truth pass. What
// replaces it below is a plain, clearly-labeled explanation of the actual
// four-stage workflow, matching donationService's real status enum
// (AVAILABLE -> CLAIMED -> PICKED_UP -> DELIVERED).
const workflowStages = [
  { icon: Package, label: "Donor lists surplus food", detail: "Posted with quantity, pickup location, and expiry window." },
  { icon: HeartHandshake, label: "NGO claims it", detail: "Any approved NGO can claim an available listing." },
  { icon: TruckIcon, label: "Volunteer picks it up", detail: "A volunteer accepts, or an admin assigns one." },
  { icon: Clock, label: "Delivered", detail: "Marked complete once it reaches the NGO." },
];

const HeroSection = () => {
  return (
    <section className="border-b border-border">
      <div className="container py-16 md:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="inline-flex items-center gap-2 border border-primary px-3 py-1.5 mb-6">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-mono uppercase text-primary font-semibold tracking-wider">
                  Time-Critical Logistics
                </span>
              </div>

              <h1 className="text-4xl md:text-6xl lg:text-7xl font-black leading-[0.9] tracking-tight mb-6">
                Reduce Food Waste.
                <br />
                <span className="text-primary">Feed Communities.</span>
              </h1>

              <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-lg mb-8">
                A high-speed redistribution platform connecting surplus food from restaurants, hostels, and events to NGOs and volunteers — before it expires.
              </p>

              <div className="flex flex-col sm:flex-row gap-0">
                <Link to="/register?role=donor" className="btn-dispatch flex items-center justify-center gap-2">
                  Donate Food <ArrowRight className="w-4 h-4" />
                </Link>
                <Link to="/register?role=ngo" className="btn-secondary-dispatch flex items-center justify-center gap-2">
                  Request Food
                </Link>
                <Link to="/register?role=volunteer" className="btn-secondary-dispatch flex items-center justify-center gap-2">
                  Volunteer
                </Link>
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="border border-border bg-card"
          >
            <div className="border-b border-border px-4 py-2">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">How a donation moves</span>
            </div>

            {workflowStages.map((stage, i) => (
              <div key={stage.label} className="border-b border-border last:border-b-0 px-4 py-4 flex items-start gap-3">
                <div className="w-8 h-8 flex items-center justify-center bg-primary/10 text-primary shrink-0">
                  <stage.icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    <span className="text-primary font-mono mr-1">{i + 1}.</span>
                    {stage.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{stage.detail}</p>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
