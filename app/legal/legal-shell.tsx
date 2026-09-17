import Link from "next/link";
import styles from "./legal.module.css";

export function LegalShell({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/">
            <span className={styles.mark} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M2 12V2.5L7 8l5-5.5V12" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            MultiMix
          </Link>
          <Link className={styles.back} href="/">返回登录</Link>
        </header>
        <article className={styles.article}>{children}</article>
      </div>
    </main>
  );
}

export { styles as legalStyles };
