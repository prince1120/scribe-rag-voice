import Link from "next/link";
import { ArrowUpRight, Bot, BookOpen, LifeBuoy, Mic, QrCode, Share2 } from "lucide-react";

const steps = [
  { label: "Set the assistant", detail: "Give it a clear role, tone, and handoff rules.", href: "/agent", icon: Bot },
  { label: "Attach official material", detail: "Add manuals, policies, and approved answers.", href: "/agent#assistant-knowledge", icon: BookOpen },
  { label: "Test a real question", detail: "Check text and voice before customers use it.", href: "/agent#assistant-test", icon: Mic },
  { label: "Share support access", detail: "Create customer links or a product QR code.", href: "/products", icon: Share2 },
];

export function WorkspaceGuide() {
  return (
    <section className="workspace-guide" aria-labelledby="workspace-guide-title">
      <div className="workspace-guide-heading">
        <div>
          <h2 id="workspace-guide-title">Make every product question easier to resolve</h2>
          <p>Set the rules, attach approved material, test the experience, then share it with customers.</p>
        </div>
        <div className="workspace-guide-actions">
          <Link href="/inbox?tab=support" className="workspace-guide-support"><LifeBuoy size={16} aria-hidden="true" /> Support requests</Link>
          <Link href="/products" className="workspace-guide-product"><QrCode size={17} aria-hidden="true" /> Product QR setup <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </div>
      <ol className="workspace-guide-steps">
        {steps.map(({ label, detail, href, icon: Icon }) => (
          <li key={label}>
            <Link href={href}>
              <span className="workspace-guide-step-top"><Icon size={19} aria-hidden="true" /><ArrowUpRight size={16} aria-hidden="true" /></span>
              <h3>{label}</h3>
              <p>{detail}</p>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
