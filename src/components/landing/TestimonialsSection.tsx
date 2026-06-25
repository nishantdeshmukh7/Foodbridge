import { motion } from "framer-motion";

const testimonials = [
  {
    quote: "We used to throw away 30 kg of food every night. Now it reaches people who need it within an hour of closing.",
    name: "Priya Sharma",
    role: "Restaurant Manager, Hotel Saravana",
  },
  {
    quote: "The dispatch system is faster than anything we've used. Our volunteers know exactly where to go and when.",
    name: "Amit Desai",
    role: "Operations Head, Feed The City NGO",
  },
  {
    quote: "I pick up 3-4 deliveries after work every evening. The app makes routing effortless.",
    name: "Rahul Nair",
    role: "Volunteer, Mumbai",
  },
];

const TestimonialsSection = () => {
  return (
    <section className="border-b border-border bg-card">
      <div className="container py-16 md:py-20">
        <div className="mb-10">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Testimonials</span>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-2">
            From The Field
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-border bg-background">
          {testimonials.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-6 md:p-8 border-r border-b border-border last:border-r-0"
            >
              <p className="text-sm leading-relaxed mb-6">"{t.quote}"</p>
              <div>
                <p className="text-sm font-bold">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
