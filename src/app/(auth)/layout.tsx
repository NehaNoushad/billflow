import { Zap, Repeat, ShieldCheck, Receipt } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-white">
            <Zap className="size-4" />
          </div>
          <span className="text-lg font-bold tracking-wide text-white">BILLFLOW</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl leading-tight font-semibold text-white">Recurring revenue, run on autopilot.</h2>
          <p className="mt-3 text-sidebar-foreground/80">Quotes, subscriptions, invoices, payments and revenue intelligence for B2B SaaS teams — in one place.</p>
          <ul className="mt-8 space-y-4 text-sm">
            {[
              { icon: Repeat, t: "Automated recurring billing with duplicate-proof invoicing" },
              { icon: Receipt, t: "GST-ready taxes, discounts and partial payments" },
              { icon: ShieldCheck, t: "AI Revenue Guard flags leakage before it costs you" },
            ].map(({ icon: Icon, t }) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-primary">
                  <Icon className="size-4" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-sidebar-foreground/50">© {new Date().getFullYear()} BILLFLOW</p>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
