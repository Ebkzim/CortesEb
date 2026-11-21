export function PageLoading({ label = 'Carregando a tela…' }: { label?: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="page-loading__label">
        <span className="spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="page-loading__skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
