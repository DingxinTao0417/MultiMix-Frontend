import Link from "next/link";
import BrandMark from "../components/brand-mark";
import styles from "./legal.module.css";

export function LegalShell({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/">
            <BrandMark className={styles.mark} size={32} />
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
