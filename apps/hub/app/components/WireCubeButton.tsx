"use client";

import { useEffect, useRef } from "react";
import styles from "../page.module.css";

type WireCubeButtonProps = {
  active: boolean;
};

const EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;

const VERTICES = [
  { x: -1, y: -1, z: -1 },
  { x: 1, y: -1, z: -1 },
  { x: 1, y: 1, z: -1 },
  { x: -1, y: 1, z: -1 },
  { x: -1, y: -1, z: 1 },
  { x: 1, y: -1, z: 1 },
  { x: 1, y: 1, z: 1 },
  { x: -1, y: 1, z: 1 },
];

function rotate(vertex: { x: number; y: number; z: number }, angleX: number, angleY: number) {
  const cosY = Math.cos(angleY);
  const sinY = Math.sin(angleY);
  const cosX = Math.cos(angleX);
  const sinX = Math.sin(angleX);

  const x = vertex.x * cosY - vertex.z * sinY;
  const z = vertex.x * sinY + vertex.z * cosY;
  const y = vertex.y * cosX - z * sinX;

  return {
    x,
    y,
    z: vertex.y * sinX + z * cosX,
  };
}

export function WireCubeButton({ active }: WireCubeButtonProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let frameId = 0;

    const render = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      const size = 92;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== size * dpr || canvas.height !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, size, size);

      const angleY = now * 0.00072;
      const angleX = now * 0.00046 + 0.55;
      const projected = VERTICES.map((vertex) => {
        const rotated = rotate(vertex, angleX, angleY);
        const depth = 3.8 / (rotated.z + 5);
        return {
          x: size / 2 + rotated.x * depth * 28,
          y: size / 2 + rotated.y * depth * 28,
          depth,
        };
      });

      context.strokeStyle = activeRef.current
        ? "rgba(255, 212, 138, 0.96)"
        : "rgba(245, 247, 251, 0.78)";
      context.lineWidth = activeRef.current ? 1.4 : 1.2;
      context.shadowBlur = activeRef.current ? 16 : 10;
      context.shadowColor = activeRef.current
        ? "rgba(255, 212, 138, 0.32)"
        : "rgba(255, 255, 255, 0.2)";

      EDGES.forEach(([from, to]) => {
        context.beginPath();
        context.moveTo(projected[from].x, projected[from].y);
        context.lineTo(projected[to].x, projected[to].y);
        context.stroke();
      });

      context.shadowBlur = 0;
      projected.forEach((point) => {
        context.beginPath();
        context.fillStyle = activeRef.current
          ? "rgba(255, 225, 168, 0.98)"
          : `rgba(255, 255, 255, ${0.64 + point.depth * 0.2})`;
        context.arc(point.x, point.y, activeRef.current ? 2.6 : 2.2, 0, Math.PI * 2);
        context.fill();
      });

      frameId = window.requestAnimationFrame(render);
    };

    frameId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div
      className={`${styles.cubeGlyph} ${active ? styles.cubeGlyphActive : ""}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className={styles.cubeCanvas} />
    </div>
  );
}
