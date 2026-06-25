import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const CTASection = () => {
  return (
    <section className="bg-foreground text-background">
      <div className="container py-16 md:py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
            Every Minute Counts.
            <br />
            <span className="text-primary">Start Saving Food.</span>
          </h2>
          <p className="text-sm opacity-60 mb-8 max-w-lg leading-relaxed">
            Whether you're a restaurant with surplus, an NGO serving communities, or a volunteer ready to deliver — join the network now.
          </p>
          <div className="flex flex-col sm:flex-row gap-0">
            <Link
              to="/register"
              className="bg-primary text-primary-foreground font-semibold px-8 py-4 text-sm uppercase tracking-wider hover:brightness-110 transition-all flex items-center justify-center gap-2"
            >
              Join FoodBridge <ArrowRight className="w-4 h-4" />
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
  );
};

export default CTASection;
