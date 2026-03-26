import { notFound } from "next/navigation";
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
    const [{ SolarSystemExperience }, { BlackHoleScene }] = await Promise.all([
      import("../../components/SolarSystemExperience"),
      import("../../components/BlackHoleScene"),
    ]);
    return <SolarSystemExperience blackHoleScene={<BlackHoleScene />} />;
  }

  if (slug === "nbv-robotics-lab") {
    const { NBVRoboticsExperience } = await import("../../components/NBVRoboticsExperience");
    return <NBVRoboticsExperience />;
  }

  if (slug === "wall-cl") {
    const { WallClExperience } = await import("../../components/WallClExperience");
    return <WallClExperience />;
  }

  if (slug === "smol") {
    const { SmolExperience } = await import("../../components/SmolExperience");
    return <SmolExperience />;
  }

  return (
    <main className={styles.workShell}>
      <WorkGestureBack />
      <article className={styles.workCard}>
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
