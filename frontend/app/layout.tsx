import type { Metadata } from "next";
import "./globals.css";
import SessionGate from "./SessionGate";

export const metadata: Metadata = {
  title: "Scribe — Chat with Your Documents",
  description: "Talk to your documents by text or voice, grounded in your own sources.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SessionGate>{children}</SessionGate>
      </body>
    </html>
  );
}
