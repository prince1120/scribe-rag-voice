export function OwnerLoading({ label = "Loading your workspace…" }: { label?: string }) {
  return (
    <div className="owner-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <div className="owner-loading-title ds-skeleton" />
        <div className="owner-loading-sub ds-skeleton" />
        <div className="owner-loading-grid">{[0, 1, 2].map(i => <div className="owner-loading-card ds-skeleton" key={i} />)}</div>
        <div className="owner-loading-panel ds-skeleton" />
      </div>
    </div>
  );
}
