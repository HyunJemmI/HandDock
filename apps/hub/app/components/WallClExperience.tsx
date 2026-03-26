"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./WallClExperience.module.css";
import { WorkGestureBack } from "./WorkGestureBack";

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
  phaseLabel: string;
  contactLabel: string;
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

const HARDWARE_BLOCKS = [
  {
    title: "좌우 구동 암",
    description: "Adafruit PWM 보드로 제어되는 듀얼 서보 구동 암. climb-robot의 arm angle 스윙 패턴을 기준으로 예상.",
  },
  {
    title: "접촉 패드 / 전자석",
    description: "원본 Arduino 코드의 `magnetL`, `magnetR`, `magnetC` 구성을 참고해 좌우 접점과 중앙 보조 접점을 배치.",
  },
  {
    title: "센터 프레임",
    description: "배터리, MCU, IMU, 자석 전원 분배를 수용하는 브리지형 알루미늄 바디. 벽면에 평행하게 하중을 분산한다.",
  },
  {
    title: "압착 / 흡착 보조",
    description: "표면 재질에 따라 전자석만으로 부족할 수 있어, 실사용 추정안에는 얇은 진공 패드 또는 고무 마찰패드를 병행한다.",
  },
];

const CONTROL_STACK = [
  "PCA9685 PWM Driver",
  "Dual Servo Shoulder Joints",
  "STM32 / Arduino-class MCU",
  "IMU + Wall Normal Estimator",
  "Battery + Magnet Driver",
];

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
      phaseLabel: "Body advance",
      contactLabel: "좌우 접점 고정",
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
      phaseLabel: "Upper re-anchor",
      contactLabel: "바디 스윙 / 자세 복원",
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
    phaseLabel: "Anchor recovery",
    contactLabel: "중앙 접점 유지",
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
      Array.from({ length: 12 }, (_, index) => {
        const y = -40 + index * WALL_ROW_SPACING + pose.wallShift;
        return {
          id: `row-${index}`,
          y,
        };
      }),
    [pose.wallShift],
  );

  return (
    <main className={styles.shell}>
      <WorkGestureBack />

      <div className={styles.grid}>
        <section className={styles.stageCard}>
          <div className={styles.headerRow}>
            <div>
              <p className={styles.eyebrow}>WallCL</p>
              <h1 className={styles.title}>Wall-climbing robot gait simulator</h1>
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
                  const isCenterActive =
                    columnIndex === 1 && pose.phaseLabel === "Anchor recovery" && Math.abs(row.y - pose.center.y) < 28;
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

              <text x="62" y="86" className={styles.svgLabel}>
                CONTACT GRID
              </text>
              <text x="62" y="114" className={styles.svgCopy}>
                climb-robot의 2-arm kinematics를 브라우저 SVG 시뮬레이션으로 재구성
              </text>
            </svg>
          </div>

          <div className={styles.footerGrid}>
            <div className={styles.footerCard}>
              <span className={styles.footerLabel}>현재 동작</span>
              <strong>{pose.phaseLabel}</strong>
              <p>{pose.contactLabel}</p>
            </div>
            <div className={styles.footerCard}>
              <span className={styles.footerLabel}>예상 제어</span>
              <strong>Servo + Magnet sequence</strong>
              <p>좌우 암 각도와 중앙 자석 락을 번갈아 사용해 body를 위로 전진시킨다.</p>
            </div>
            <div className={styles.footerCard}>
              <span className={styles.footerLabel}>하중 해석</span>
              <strong>Bridge frame</strong>
              <p>벽면 방향 하중은 중앙 프레임에 모으고, 양쪽 암은 접점 교대와 자세 복원에 집중한다.</p>
            </div>
          </div>
        </section>

        <aside className={styles.hardwareCard}>
          <div className={styles.hardwareHeader}>
            <p className={styles.eyebrow}>Predicted Hardware</p>
            <h2 className={styles.subtitle}>예상 하드웨어 디자인</h2>
          </div>

          <svg viewBox="0 0 420 320" className={styles.hardwareSvg} aria-label="Predicted wall climbing robot hardware">
            <rect x="150" y="136" width="120" height="48" rx="18" fill="rgba(12,12,12,0.94)" stroke="rgba(255,255,255,0.16)" />
            <rect x="170" y="118" width="80" height="18" rx="9" fill="rgba(240,199,140,0.18)" stroke="rgba(240,199,140,0.56)" />
            <line x1="150" y1="160" x2="96" y2="110" stroke="rgba(255,255,255,0.88)" strokeWidth="8" strokeLinecap="round" />
            <line x1="270" y1="160" x2="324" y2="110" stroke="rgba(255,255,255,0.88)" strokeWidth="8" strokeLinecap="round" />
            <circle cx="96" cy="110" r="24" fill="#090909" stroke="#f0c78c" strokeWidth="4" />
            <circle cx="324" cy="110" r="24" fill="#090909" stroke="#f0c78c" strokeWidth="4" />
            <circle cx="210" cy="196" r="18" fill="rgba(240,199,140,0.88)" />
            <line x1="210" y1="184" x2="210" y2="232" stroke="rgba(240,199,140,0.62)" strokeWidth="4" />
            <line x1="210" y1="232" x2="120" y2="272" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
            <line x1="96" y1="110" x2="42" y2="64" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
            <line x1="324" y1="110" x2="382" y2="64" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
            <line x1="170" y1="126" x2="126" y2="40" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
            <text x="18" y="60" className={styles.calloutLabel}>
              magnetic pad
            </text>
            <text x="334" y="60" className={styles.calloutLabel}>
              servo shoulder
            </text>
            <text x="74" y="290" className={styles.calloutLabel}>
              center support magnet
            </text>
            <text x="70" y="34" className={styles.calloutLabel}>
              battery + controller bridge
            </text>
          </svg>

          <div className={styles.listBlock}>
            {HARDWARE_BLOCKS.map((block) => (
              <article key={block.title} className={styles.featureCard}>
                <h3>{block.title}</h3>
                <p>{block.description}</p>
              </article>
            ))}
          </div>

          <div className={styles.stackBlock}>
            <span className={styles.stackLabel}>Control Stack</span>
            <div className={styles.stackPills}>
              {CONTROL_STACK.map((item) => (
                <span key={item} className={styles.stackPill}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
