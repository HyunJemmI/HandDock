import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../page.module.css";
import { works } from "../../work-data";

export function generateStaticParams() {
  return works.map((work) => ({ slug: work.slug }));
}

export default async function WorkPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const work = works.find((item) => item.slug === slug);

  if (!work) {
    notFound();
  }

  return (
    <main className={styles.workShell}>
      <article className={styles.workCard}>
        <Link href="/" className={styles.backLink}>
          Back to dock
        </Link>
        <p className={styles.eyebrow}>{work.status}</p>
        <h1 className={styles.panelTitle}>{work.name}</h1>
        <p className={styles.panelCopy}>{work.description}</p>
        <div className={styles.linkMeta}>
          {work.stack.map((item) => (
            <span key={item} className={styles.metaPill}>
              {item}
            </span>
          ))}
        </div>
      </article>
    </main>
  );
}
