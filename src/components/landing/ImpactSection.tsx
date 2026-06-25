import { motion } from "framer-motion";

const stats = [
  { value: "124,580", label: "Meals Saved", suffix: "" },
  { value: "48,200", label: "KG Food Rescued", suffix: "kg" },
  { value: "340", label: "NGOs Connected", suffix: "+" },
  { value: "1,250", label: "Active Volunteers", suffix: "" },
];

const ImpactSection = () => {
  return (
    <section className="border-b border-border">
      <div className="container py-16 md:py-20">
        <div className="mb-10">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Platform Impact</span>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-2">
            The Numbers That Matter
          </h2>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 border border-border">
          {stats.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-6 md:p-8 border-r border-b border-border last:border-r-0 text-center"
            >
              <p className="text-3xl md:text-5xl font-mono font-black tracking-tight">
                {s.value}
              </p>
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mt-2">
                {s.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ImpactSection;
