import { motion } from "framer-motion";

// Phase 16: corrected to match the real workflow. Previously claimed a
// 5km radius alert system (no distance data exists at all - see the
// Phase 15 report), "nearest volunteer" matching with navigation and a
// delivery route (no such matching or navigation exists), and captured
// proof of delivery (no photo/signature capture exists).
const steps = [
  {
    num: "01",
    title: "Donors List Surplus",
    desc: "Restaurant closes at 11 PM. 25 kg of rice expires in 2 hours. List it in 30 seconds.",
  },
  {
    num: "02",
    title: "NGOs Claim It",
    desc: "Any approved NGO can browse available donations and claim one with a single tap.",
  },
  {
    num: "03",
    title: "A Volunteer Picks Up",
    desc: "A volunteer accepts the pickup themselves, or an admin assigns one directly.",
  },
  {
    num: "04",
    title: "Food Delivered",
    desc: "The volunteer marks it delivered. The donor and NGO are both notified.",
  },
];

const HowItWorksSection = () => {
  return (
    <section className="border-b border-border bg-card">
      <div className="container py-16 md:py-20">
        <div className="mb-10">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Operations Flow</span>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-2">
            How It Works
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 border border-border bg-background">
          {steps.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-6 border-r border-b border-border last:border-r-0 relative"
            >
              <span className="text-5xl font-mono font-black text-primary/15 absolute top-4 right-4">
                {s.num}
              </span>
              <div className="relative z-10">
                <span className="text-xs font-mono text-primary font-semibold uppercase tracking-wider">
                  Step {s.num}
                </span>
                <h3 className="font-bold text-lg mt-2 mb-3">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
