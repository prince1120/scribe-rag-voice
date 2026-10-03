import type { Metadata, Viewport } from "next";
import { Newsreader, Outfit } from "next/font/google";
import "./globals.css";
import SessionGate from "./SessionGate";
import { AppExperience } from "./components/AppExperience";

const sans = Outfit({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const editorial = Newsreader({ subsets: ["latin"], variable: "--font-editorial", display: "swap", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: {
    default: "Scribe — Business conversations that get work done",
    template: "%s — Scribe",
  },
  description:
    "Build grounded voice and chat assistants for customer questions, scheduling, and support.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://example.com"),
  openGraph: {
    title: "Scribe — Business conversations that get work done",
    description:
      "Build grounded voice and chat assistants for customer questions, scheduling, and support.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#F0EEE6",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={`${sans.variable} ${editorial.variable}`}>
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
