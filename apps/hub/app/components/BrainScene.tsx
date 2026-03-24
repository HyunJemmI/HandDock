import Spline from "@splinetool/react-spline/next";
import styles from "../page.module.css";

const BRAIN_SCENE = "https://prod.spline.design/EXPOU2fNqMpVU5e5/scene.splinecode";

export function BrainScene() {
  if (!BRAIN_SCENE.startsWith("http")) {
    return <div className={styles.brainSceneFallback} aria-hidden="true" />;
  }

  return (
    <main>
      <Spline scene={BRAIN_SCENE} />
    </main>
  );
}
