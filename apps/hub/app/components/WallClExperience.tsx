"use client";

import { useEffect, useMemo, useState } from "react";
import shellStyles from "../page.module.css";
import styles from "./WallClExperience.module.css";

type Point = {
  x: number;
  y: number;
};

type RobotPose = {
  leftAnchor: Point;
  rightAnchor: Point;
  bodyLeft: Point;
  bodyRight: Point;
  center: Point;
  cycleIndex: number;
  cycleProgress: number;
  travelMeters: number;
  wallShift: number;
};

const PI = Math.PI;
const LEN_BODY = 168;
const LEN_ARM = 78;
const DIST = LEN_BODY + Math.sqrt(3) * LEN_ARM;
const START_ANGLE = (PI * 5) / 6;
const END_ANGLE = PI * 2 - getAngle(LEN_ARM, LEN_BODY / 2, DIST / 2);
const CYCLE_SECONDS = 8.8;
const WALL_ROW_SPACING = 62;
const HOLD_COLUMNS = [188, 188 + DIST / 2, 188 + DIST];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function easeInOut(value: number) {
  const clamped = clamp01(value);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function getLength(a: number, b: number, theta: number) {
  return Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(theta));
}

function getAngle(a: number, b: number, c: number) {
  const denominator = Math.max(0.0001, 2 * a * b);
  const ratio = Math.max(-1, Math.min(1, (a * a + b * b - c * c) / denominator));
  return Math.acos(ratio);
}

function anchorAngle(left: number, right: number) {
  const h = LEN_ARM * (Math.sin(left) - Math.sin(right));
  const ru = Math.asin(Math.max(-1, Math.min(1, h / DIST)));
  const aaR = (3 * PI) / 2 - right + ru;
  return [left + right + aaR - PI / 2, PI / 2 + aaR] as const;
}

function oppositeAngle(angle: number) {
  const a = getLength(LEN_BODY, LEN_ARM, angle);
  if (angle > PI) {
    return -getAngle(a, LEN_BODY, LEN_ARM) + getAngle(a, LEN_ARM, DIST);
  }

  return getAngle(a, LEN_BODY, LEN_ARM) + getAngle(a, LEN_ARM, DIST);
}

function getPoint(x: number, y: number, length: number, angle: number): Point {
  return {
    x: x + Math.cos(angle) * length,
    y: y - Math.sin(angle) * length,
  };
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function computePose(seconds: number): RobotPose {
  const cycleFloat = seconds / CYCLE_SECONDS;
  const cycleIndex = Math.floor(cycleFloat);
  const cycleProgress = cycleFloat - cycleIndex;
  const eased = easeInOut(cycleProgress);
  const baseY = 348;
  const liftTravel = cycleFloat * 0.21;
  const wallShift = (cycleFloat * WALL_ROW_SPACING * 0.82) % WALL_ROW_SPACING;

  if (cycleProgress < 0.42) {
    const t = easeInOut(cycleProgress / 0.42);
    const right = lerp(START_ANGLE, END_ANGLE, t);
    const left = oppositeAngle(right);
    const [leftAnchorAngle, rightAnchorAngle] = anchorAngle(left, right);
    const leftAnchor = { x: HOLD_COLUMNS[0], y: baseY };
    const rightAnchor = { x: HOLD_COLUMNS[2], y: baseY };
    const bodyLeft = getPoint(leftAnchor.x, leftAnchor.y, LEN_ARM, leftAnchorAngle);
    const bodyRight = getPoint(rightAnchor.x, rightAnchor.y, LEN_ARM, rightAnchorAngle);

    return {
      leftAnchor,
      rightAnchor,
      bodyLeft,
      bodyRight,
      center: {
        x: (bodyLeft.x + bodyRight.x) / 2,
        y: (bodyLeft.y + bodyRight.y) / 2,
      },
      cycleIndex,
      cycleProgress: eased,
      travelMeters: 0.24 + liftTravel,
      wallShift,
    };
  }

  if (cycleProgress < 0.84) {
    const t = easeInOut((cycleProgress - 0.42) / 0.42);
    const bodyAngle = lerp(END_ANGLE, START_ANGLE, t);
    const right = PI * 2 - oppositeAngle(bodyAngle);
    const left = PI * 2 - bodyAngle;
    const [leftAnchorAngle, rightAnchorAngle] = anchorAngle(left, right);
    const leftAnchor = { x: HOLD_COLUMNS[0], y: baseY };
    const rightAnchor = { x: HOLD_COLUMNS[2], y: baseY };
    const bodyLeft = getPoint(leftAnchor.x, leftAnchor.y, LEN_ARM, leftAnchorAngle);
    const bodyRight = getPoint(rightAnchor.x, rightAnchor.y, LEN_ARM, rightAnchorAngle);

    return {
      leftAnchor,
      rightAnchor,
      bodyLeft,
      bodyRight,
      center: {
        x: (bodyLeft.x + bodyRight.x) / 2,
        y: (bodyLeft.y + bodyRight.y) / 2,
      },
      cycleIndex,
      cycleProgress: eased,
      travelMeters: 0.24 + liftTravel,
      wallShift,
    };
  }

  const t = easeInOut((cycleProgress - 0.84) / 0.16);
  const liftAngle = lerp(PI * 2 - START_ANGLE, START_ANGLE, t);
  const bodyLeft = { x: HOLD_COLUMNS[0] + (LEN_ARM * Math.sqrt(3)) / 2, y: baseY - LEN_ARM / 2 };
  const bodyRight = { x: bodyLeft.x + LEN_BODY, y: bodyLeft.y };
  const leftAnchor = getPoint(bodyLeft.x, bodyLeft.y, LEN_ARM, liftAngle);
  const rightAnchor = getPoint(bodyRight.x, bodyRight.y, LEN_ARM, PI - liftAngle);

  return {
    leftAnchor,
    rightAnchor,
    bodyLeft,
    bodyRight,
    center: {
      x: (bodyLeft.x + bodyRight.x) / 2,
      y: (bodyLeft.y + bodyRight.y) / 2,
    },
    cycleIndex,
    cycleProgress: eased,
    travelMeters: 0.24 + liftTravel,
    wallShift,
  };
}

export function WallClExperience() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let frameId = 0;
    let mounted = true;
    const startedAt = performance.now();

    const loop = () => {
      if (!mounted) {
        return;
      }

      setSeconds((performance.now() - startedAt) / 1000);
      frameId = window.requestAnimationFrame(loop);
    };

    frameId = window.requestAnimationFrame(loop);

    return () => {
      mounted = false;
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const pose = useMemo(() => computePose(seconds), [seconds]);
  const wallRows = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        id: `row-${index}`,
        y: -40 + index * WALL_ROW_SPACING + pose.wallShift,
      })),
    [pose.wallShift],
  );

  return (
    <main className={styles.shell}>
      <a href="/" className={shellStyles.exitButton}>
        Exit
      </a>

      <section className={styles.stageOnly}>
        <div className={styles.headerRow}>
          <div>
            <p className={styles.eyebrow}>WallCL</p>
            <h1 className={styles.title}>Progress</h1>
          </div>
          <div className={styles.metricStrip}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Cycle</span>
              <strong>{pose.cycleIndex + 1}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Progress</span>
              <strong>{formatPercent(pose.cycleProgress)}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Height</span>
              <strong>{pose.travelMeters.toFixed(2)} m</strong>
            </div>
          </div>
        </div>

        <div className={styles.progressRail} aria-hidden="true">
          <div className={styles.progressValue} style={{ width: formatPercent(pose.cycleProgress) }} />
        </div>

        <div className={styles.stageCanvas}>
          <svg viewBox="0 0 760 620" className={styles.svg} aria-label="Wall climbing robot simulation">
            <defs>
              <linearGradient id="wallGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#101010" />
                <stop offset="100%" stopColor="#020202" />
              </linearGradient>
              <linearGradient id="robotGlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#f0c78c" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>
            </defs>

            <rect x="30" y="42" width="700" height="536" rx="34" fill="url(#wallGradient)" />
            {wallRows.map((row) =>
              HOLD_COLUMNS.map((column, columnIndex) => {
                const isLeftActive = columnIndex === 0 && Math.abs(row.y - pose.leftAnchor.y) < 26;
                const isCenterActive = columnIndex === 1 && Math.abs(row.y - pose.center.y) < 28;
                const isRightActive = columnIndex === 2 && Math.abs(row.y - pose.rightAnchor.y) < 26;
                const isActive = isLeftActive || isCenterActive || isRightActive;

                return (
                  <g key={`${row.id}-${column}`}>
                    <circle
                      cx={column}
                      cy={row.y}
                      r={isActive ? 14 : 9}
                      fill={isActive ? "#f0c78c" : "rgba(255,255,255,0.08)"}
                      stroke={isActive ? "rgba(255,255,255,0.76)" : "rgba(255,255,255,0.1)"}
                      strokeWidth={isActive ? 2 : 1}
                    />
                    <circle
                      cx={column}
                      cy={row.y}
                      r={isActive ? 28 : 0}
                      fill={isActive ? "rgba(240,199,140,0.10)" : "transparent"}
                    />
                  </g>
                );
              }),
            )}

            <path
              d={`M ${pose.leftAnchor.x} ${pose.leftAnchor.y} L ${pose.bodyLeft.x} ${pose.bodyLeft.y}`}
              stroke="url(#robotGlow)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d={`M ${pose.rightAnchor.x} ${pose.rightAnchor.y} L ${pose.bodyRight.x} ${pose.bodyRight.y}`}
              stroke="url(#robotGlow)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d={`M ${pose.bodyLeft.x} ${pose.bodyLeft.y} L ${pose.bodyRight.x} ${pose.bodyRight.y}`}
              stroke="rgba(255,255,255,0.92)"
              strokeWidth="13"
              strokeLinecap="round"
            />
            <rect
              x={pose.center.x - 32}
              y={pose.center.y - 22}
              width="64"
              height="44"
              rx="16"
              fill="rgba(10,10,10,0.94)"
              stroke="rgba(255,255,255,0.12)"
            />
            <circle cx={pose.leftAnchor.x} cy={pose.leftAnchor.y} r="15" fill="#111" stroke="#f0c78c" strokeWidth="3" />
            <circle cx={pose.rightAnchor.x} cy={pose.rightAnchor.y} r="15" fill="#111" stroke="#f0c78c" strokeWidth="3" />
            <circle cx={pose.center.x} cy={pose.center.y} r="11" fill="#f0c78c" opacity="0.88" />
          </svg>
        </div>
      </section>
    </main>
  );
}
