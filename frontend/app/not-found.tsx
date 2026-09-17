import Link from "next/link";
import { ArrowLeft, Compass } from "@phosphor-icons/react/dist/ssr";
import { ScribeMark } from "./Logo";

export default function NotFound() {
  return (
    <main id="main-content" className="not-found-page">
      <div className="not-found-orbit" aria-hidden="true">
        <span><ScribeMark className="h-7 w-7" /></span>
      </div>
      <p className="not-found-kicker"><Compass size={15} /> Page not found</p>
      <h1>This conversation took a wrong turn.</h1>
      <p>The page may have moved, or the link may no longer be active.</p>
      <div className="not-found-actions">
        <Link href="/" className="not-found-primary"><ArrowLeft size={16} /> Back to Scribe</Link>
        <Link href="/directory" className="not-found-secondary">Browse assistants</Link>
      </div>
    </main>
  );
}
