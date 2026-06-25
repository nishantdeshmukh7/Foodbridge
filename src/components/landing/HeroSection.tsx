import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, Clock } from "lucide-react";

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
            <div className="border-b border-border px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Live Dispatch Feed</span>
              <span className="w-2 h-2 bg-primary animate-pulse" />
            </div>

            {[
              { type: "Cooked Rice & Dal", qty: "25 kg", time: "43 min", from: "Hotel Saravana" },
              { type: "Packaged Sandwiches", qty: "80 pcs", time: "1h 12m", from: "Café Central" },
              { type: "Catering Surplus", qty: "15 kg", time: "28 min", from: "Event Hall #3" },
              { type: "Bread & Pastries", qty: "40 pcs", time: "55 min", from: "Baker's Point" },
            ].map((item, i) => (
              <div key={i} className="border-b border-border relative">
                <div className="absolute top-0 left-0 right-0 h-1 bg-primary/20">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${100 - i * 20}%`, transition: "width 2s" }}
                  />
                </div>
                <div className="px-4 py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{item.type}</p>
                    <p className="text-xs text-muted-foreground">{item.from}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono font-bold">{item.qty}</p>
                    <p className="text-xs font-mono text-primary font-semibold">{item.time}</p>
                  </div>
                </div>
              </div>
            ))}

            <div className="px-4 py-3 text-center">
              <span className="text-xs font-mono text-muted-foreground uppercase">4 Active Dispatches</span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
