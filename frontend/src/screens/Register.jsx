import PageHero from "../components/PageHero";
import { RegisterTab } from "./Staff";

export default function Register() {
  return (
    <div className="space-y-6 animate-slide-in" data-testid="register-screen">
      <PageHero
        eyebrow={{ icon: "fa-cash-register", text: "Money hub", color: "text-shGreen" }}
        title="Register."
        highlight="Daily money in one spot."
        subtitle="Sales, credit packs, client payments, refunds, expenses, till adjustments, receipts, cash drawer, closeout, and reports."
        testid="register-hero"
      />
      <RegisterTab />
    </div>
  );
}
