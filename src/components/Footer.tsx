import { Package } from "lucide-react";
import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="border-t border-border bg-foreground text-background">
      <div className="container py-12">
        {/* Phase 16: the Company column (About/Contact/Privacy/Terms) and
            Connect column (social links) were removed rather than fixed.
            None of those four pages existed (all 404'd), and none of the
            three social links pointed anywhere real (href="#"). No real
            pages, contact channel, legal copy, or social accounts exist
            for this project to link to - see the Phase 16 report. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-primary flex items-center justify-center">
                <Package className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-sm uppercase tracking-wider">FoodBridge</span>
            </div>
            <p className="text-sm opacity-60 leading-relaxed max-w-sm">
              High-speed food redistribution. Moving surplus food from donors to communities before it expires.
            </p>
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-wider font-semibold mb-4 opacity-60">Platform</h4>
            <ul className="space-y-2">
              <li><Link to="/register" className="text-sm hover:text-primary transition-colors">Donate Food</Link></li>
              <li><Link to="/register" className="text-sm hover:text-primary transition-colors">Request Food</Link></li>
              <li><Link to="/register" className="text-sm hover:text-primary transition-colors">Volunteer</Link></li>
              <li><Link to="/how-it-works" className="text-sm hover:text-primary transition-colors">How It Works</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-background/20 mt-8 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs opacity-40 font-mono">© 2026 FOODBRIDGE. ALL RIGHTS RESERVED.</p>
          <p className="text-xs opacity-40 font-mono">ZERO WASTE. ZERO HUNGER.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
