"use client";

import Spline from "@splinetool/react-spline/next";
import styles from "../page.module.css";

export function SceneCanvas() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <Spline scene="https://prod.spline.design/HoZfJAcQVLvyh6JS/scene.splinecode" />
    </div>
  );
}
