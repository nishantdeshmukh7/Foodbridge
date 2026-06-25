import { Link } from "react-router-dom";
import { Clock, Package, Users, Truck } from "lucide-react";

const Navbar = () => {
  return (
    <nav className="border-b border-border bg-background sticky top-0 z-50">
      <div className="container flex items-center justify-between h-14">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary flex items-center justify-center">
            <Package className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-sm uppercase tracking-wider">FoodBridge</span>
        </Link>

        <div className="hidden md:flex items-center gap-0 border border-border divide-x divide-border">
          <Link to="/" className="px-4 py-2 text-xs uppercase tracking-wider font-medium hover:bg-primary hover:text-primary-foreground transition-colors">
            Home
          </Link>
          <Link to="/how-it-works" className="px-4 py-2 text-xs uppercase tracking-wider font-medium hover:bg-primary hover:text-primary-foreground transition-colors">
            How It Works
          </Link>
          <Link to="/login" className="px-4 py-2 text-xs uppercase tracking-wider font-medium hover:bg-primary hover:text-primary-foreground transition-colors">
            Login
          </Link>
          <Link to="/register" className="px-4 py-2 text-xs uppercase tracking-wider font-semibold bg-primary text-primary-foreground hover:brightness-110 transition-all">
            Get Started
          </Link>
        </div>

        <Link to="/register" className="md:hidden btn-dispatch !w-auto !py-2 text-xs">
          Start
        </Link>
      </div>
    </nav>
  );
};

export default Navbar;
