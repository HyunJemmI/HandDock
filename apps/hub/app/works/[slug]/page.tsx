import Link from "next/link";
import { notFound } from "next/navigation";
import { BlackHoleScene } from "../../components/BlackHoleScene";
import { NBVRoboticsExperience } from "../../components/NBVRoboticsExperience";
import { SolarSystemExperience } from "../../components/SolarSystemExperience";
import { WorkGestureBack } from "../../components/WorkGestureBack";
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

  if (slug === "solar-orrery") {
    return <SolarSystemExperience blackHoleScene={<BlackHoleScene />} />;
  }

  if (slug === "nbv-robotics-lab") {
    return <NBVRoboticsExperience />;
  }

  return (
    <main className={styles.workShell}>
      <WorkGestureBack />
      <article className={styles.workCard}>
        <Link href="/" className={styles.backLink}>
          Back to dock
        </Link>
        <p className={styles.eyebrow}>{work.status}</p>
        <h1 className={styles.panelTitle}>{work.name}</h1>
        <p className={styles.panelCopy}>{work.description}</p>
        <div className={styles.workMetaGrid}>
          <div className={styles.workMetaBlock}>
            <span className={styles.workMetaLabel}>Year</span>
            <span className={styles.workMetaValue}>{work.year}</span>
          </div>
          <div className={styles.workMetaBlock}>
            <span className={styles.workMetaLabel}>Mode</span>
            <span className={styles.workMetaValue}>{work.interactionType}</span>
          </div>
          <div className={styles.workMetaBlock}>
            <span className={styles.workMetaLabel}>Accent</span>
            <span className={styles.workMetaValue}>{work.accentLabel}</span>
          </div>
        </div>
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
