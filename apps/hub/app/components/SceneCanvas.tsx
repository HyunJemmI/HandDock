"use client";

import styles from "../page.module.css";
// @ts-expect-error The package does not expose declarations for this internal bundle path.
import Spline from "../../../../node_modules/@splinetool/react-spline/dist/react-spline.js";

export function SceneCanvas() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <Spline scene="https://prod.spline.design/HoZfJAcQVLvyh6JS/scene.splinecode" />
    </div>
  );
}
