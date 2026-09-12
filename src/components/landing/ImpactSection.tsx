import { motion } from "framer-motion";
import { MousePointerClick, Bell, ShieldCheck, UserCheck } from "lucide-react";

// Phase 16: this section used to show hardcoded, invented impact numbers
// ("124,580 Meals Saved", etc.) with no data behind them - removed per
// the Phase 16 truth pass rather than replaced with a different arbitrary
// number, and rather than wiring up a new public analytics endpoint just
// to populate a marketing card (the real analytics in this app are
// admin-only and stay that way). What's here instead are qualities that
// are genuinely true of the current product - no numbers, nothing that
// can't be verified by using the app.
const points = [
  { icon: MousePointerClick, label: "Direct Claiming", desc: "NGOs claim available donations themselves - no waiting on a middleman." },
  { icon: Bell, label: "Status Notifications", desc: "Donors and NGOs are notified when a donation is claimed, picked up, and delivered." },
  { icon: ShieldCheck, label: "Contact Stays Private", desc: "Phone numbers are only shared with the people actually involved in a pickup." },
  { icon: UserCheck, label: "Approved NGOs Only", desc: "NGO accounts are reviewed by an admin before they can claim donations." },
];

const ImpactSection = () => {
  return (
    <section id="impact" className="border-b border-border">
      <div className="container py-16 md:py-20">
        <div className="mb-10">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">What You Can Count On</span>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-2">
            Built On A Real Workflow
          </h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 border border-border">
          {points.map((p, i) => (
            <motion.div
              key={p.label}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-6 md:p-8 border-r border-b border-border last:border-r-0"
            >
              <p.icon className="w-5 h-5 text-primary mb-3" />
              <p className="text-sm font-bold uppercase tracking-wider">{p.label}</p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{p.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ImpactSection;
