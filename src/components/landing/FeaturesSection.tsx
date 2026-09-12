import { motion } from "framer-motion";
import { MapPin, Bell, Truck, ShieldCheck, BarChart3 } from "lucide-react";

// Phase 16: corrected to describe what's actually implemented. Previously
// claimed an "automated allocation engine" matching by distance/capacity
// (no such matching exists - NGOs browse and claim manually), a
// time-slot scheduling workflow (doesn't exist), and volunteer
// navigation/proof-of-delivery submission (neither exists). "Food Safety
// Validation" and "Impact Tracking" were accurate and are kept, with
// "Impact Tracking" reworded to make clear it's an admin-facing
// dashboard, not a public real-time feed.
const features = [
  {
    icon: MapPin,
    title: "Browse & Claim",
    desc: "NGOs see every available donation and claim the ones they can use, in one tap.",
  },
  {
    icon: Bell,
    title: "Status Notifications",
    desc: "Donors and NGOs are notified as a donation is claimed, picked up, and delivered.",
  },
  {
    icon: Truck,
    title: "Volunteer Pickup",
    desc: "Volunteers accept an available pickup, or an admin assigns one directly.",
  },
  {
    icon: ShieldCheck,
    title: "Food Safety Checklist",
    desc: "Donors confirm a short hygiene and handling checklist before a listing can be posted.",
  },
  {
    icon: BarChart3,
    title: "Admin Analytics",
    desc: "Admins see real, database-backed counts of donations, claims, and deliveries.",
  },
];

const FeaturesSection = () => {
  return (
    <section className="border-b border-border">
      <div className="container py-16 md:py-20">
        <div className="mb-10">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Platform Capabilities</span>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-2">
            Built for Speed & Scale
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 border border-border">
          {features.map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="p-6 border-b border-r border-border last:border-r-0 hover:bg-card transition-colors"
            >
              <f.icon className="w-5 h-5 text-primary mb-3" />
              <h3 className="font-bold text-sm uppercase tracking-wider mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
