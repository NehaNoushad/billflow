import { requirePage } from "@/lib/auth/guard";
import { connectDB } from "@/lib/db";
import { getSettings, serialize } from "@/lib/utils-server";
import { emailConfigured } from "@/lib/email";
import { PageHeader, Panel, Tone } from "@/components/app/ui-bits";
import { SettingsForm, DemoReset } from "./settings-client";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePage("settings.manage");
  await connectDB();
  const settings = serialize(await getSettings());
  const ai = process.env.GEMINI_API_KEY ? "Gemini" : process.env.OPENAI_API_KEY ? "OpenAI" : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Settings" description="Company details, billing rules and integrations." />
      <SettingsForm settings={settings} />
      <Panel title="Integrations" description="Configured through environment variables on the server.">
        <ul className="divide-y text-sm">
          <li className="flex items-center justify-between py-2.5">
            <span>
              <span className="font-medium">Email (SMTP)</span>
              <span className="block text-xs text-muted-foreground">Password resets, invoice and quotation emails</span>
            </span>
            {emailConfigured() ? <Tone tone="green">Configured</Tone> : <Tone tone="gray">Not configured</Tone>}
          </li>
          <li className="flex items-center justify-between py-2.5">
            <span>
              <span className="font-medium">AI provider</span>
              <span className="block text-xs text-muted-foreground">Revenue Guard summaries. Without a key, rule-based summaries are used.</span>
            </span>
            {ai ? <Tone tone="green">{ai}</Tone> : <Tone tone="amber">Rule-based fallback</Tone>}
          </li>
          <li className="flex items-center justify-between py-2.5">
            <span>
              <span className="font-medium">Scheduled billing (cron)</span>
              <span className="block text-xs text-muted-foreground">Daily at 06:00 IST via /api/cron/billing</span>
            </span>
            {process.env.CRON_SECRET ? <Tone tone="green">Secret set</Tone> : <Tone tone="red">CRON_SECRET missing</Tone>}
          </li>
          <li className="flex items-center justify-between py-2.5">
            <span>
              <span className="font-medium">Payment gateway</span>
              <span className="block text-xs text-muted-foreground">Payments are recorded manually or simulated — no real money is collected.</span>
            </span>
            <Tone tone="gray">Simulated</Tone>
          </li>
        </ul>
      </Panel>
      {process.env.DEMO_MODE === "true" && <DemoReset />}
    </div>
  );
}
