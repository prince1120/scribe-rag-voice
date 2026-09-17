import type { Metadata } from "next";
import "./globals.css";
import SessionGate from "./SessionGate";
import { AppExperience } from "./components/AppExperience";

export const metadata: Metadata = {
  title: {
    default: "Scribe — Business conversations that get work done",
    template: "%s — Scribe",
  },
  description:
    "Build grounded voice and chat assistants for customer questions, scheduling, and support.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <AppExperience />
        <SessionGate>{children}</SessionGate>
      </body>
    </html>
  );
}
