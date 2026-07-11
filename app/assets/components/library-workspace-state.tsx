export function LibraryWorkspaceLoading({ title }: { title: string }) {
  return (
    <section className="shadcn-prototype-workshop-empty" role="status" aria-live="polite">
      <div>
        <span className="shadcn-prototype-library-loading" aria-hidden="true" />
        <strong>{`正在加载${title}…`}</strong>
      </div>
    </section>
  );
}
