import { ScribeMark } from "./Logo";

export default function Loading() {
  return (
    <main id="main-content" className="app-loading" aria-label="Loading Scribe">
      <div className="app-loading-brand">
        <span className="app-loading-mark" aria-hidden="true">
          <ScribeMark className="h-5 w-5" />
        </span>
        <span>Scribe</span>
      </div>
      <div className="app-loading-shell" aria-hidden="true">
        <aside className="app-loading-rail ds-skeleton" />
        <section className="app-loading-canvas">
          <div className="app-loading-line is-title ds-skeleton" />
          <div className="app-loading-line ds-skeleton" />
          <div className="app-loading-grid">
            <div className="ds-skeleton" />
            <div className="ds-skeleton" />
            <div className="ds-skeleton" />
          </div>
          <div className="app-loading-panel ds-skeleton" />
        </section>
      </div>
      <span className="sr-only">Loading your workspace</span>
    </main>
  );
}
