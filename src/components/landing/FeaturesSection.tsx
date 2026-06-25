import { motion } from "framer-motion";
import { Cpu, Clock, Truck, ShieldCheck, BarChart3 } from "lucide-react";

const features = [
  {
    icon: Cpu,
    title: "Smart Food Matching",
    desc: "Automated allocation engine matches surplus food to nearby NGOs based on distance, capacity, and urgency.",
  },
  {
    icon: Clock,
    title: "Real-Time Scheduling",
    desc: "Pickup time-slot selection with confirmation workflow. Every minute counts before expiry.",
  },
  {
    icon: Truck,
    title: "Volunteer Logistics",
    desc: "Volunteers accept tasks, navigate to pickup, deliver, and submit proof — all from one screen.",
  },
  {
    icon: ShieldCheck,
    title: "Food Safety Validation",
    desc: "Mandatory safety checklists ensure every donation meets hygiene and handling standards.",
  },
  {
    icon: BarChart3,
    title: "Impact Tracking",
    desc: "Live dashboards showing meals saved, food rescued, and waste reduction metrics.",
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

          <div className="p-6 border-b border-r border-border flex items-center justify-center bg-card">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">More features shipping →</span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
