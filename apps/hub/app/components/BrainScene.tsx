import Spline from "@splinetool/react-spline/next";
import styles from "../page.module.css";

const BRAIN_SCENE = "loading...";

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
