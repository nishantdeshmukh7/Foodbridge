import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import HeroSection from "@/components/landing/HeroSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import ImpactSection from "@/components/landing/ImpactSection";
import CTASection from "@/components/landing/CTASection";

// Phase 16: TestimonialsSection was removed rather than kept - its three
// "testimonials" were invented quotes attributed to named people who
// don't exist in this project, presented as genuine users. No real,
// sourced testimonials exist to replace them with.
const Index = () => {
  // Phase 16: the "See Our Impact" link on the How It Works page points
  // here as "/#impact" - this app's plain BrowserRouter has no built-in
  // hash-scroll behavior, so without this the link changed the URL but
  // never actually scrolled anywhere (a broken-in-practice link, even
  // though it wasn't a 404).
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    el?.scrollIntoView({ behavior: "smooth" });
  }, [hash]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <ImpactSection />
      <CTASection />
      <Footer />
    </div>
  );
};

export default Index;
