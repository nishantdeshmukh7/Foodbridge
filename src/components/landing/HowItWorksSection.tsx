import { motion } from "framer-motion";

const steps = [
  {
    num: "01",
    title: "Donors List Surplus",
    desc: "Restaurant closes at 11 PM. 25 kg of rice expires in 2 hours. List it in 30 seconds.",
  },
  {
    num: "02",
    title: "NGOs Request Nearby",
    desc: "NGOs within 5 km radius get instant alerts. Request pickup with one tap.",
  },
  {
    num: "03",
    title: "Volunteers Dispatch",
    desc: "Nearest volunteer accepts. Gets navigation, pickup confirmation, and delivery route.",
  },
  {
    num: "04",
    title: "Food Delivered",
    desc: "Proof of delivery captured. Impact logged. Waste prevented. Community fed.",
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
