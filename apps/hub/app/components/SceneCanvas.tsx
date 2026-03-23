"use client";

import dynamic from "next/dynamic";
import styles from "../page.module.css";

const Spline = dynamic(
  () => import("./SplineRuntime").then((module) => module.default),
  { ssr: false },
);

export function SceneCanvas() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <Spline scene="https://prod.spline.design/HoZfJAcQVLvyh6JS/scene.splinecode" />
    </div>
  );
}
