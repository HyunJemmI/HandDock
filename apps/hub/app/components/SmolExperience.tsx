"use client";

import { useEffect, useMemo, useState } from "react";
import shellStyles from "../page.module.css";
import styles from "./SmolExperience.module.css";

type SampleSpec = {
  id: string;
  stage: string;
  dataSource: string;
  encoder: string;
  color: string;
  note: string;
  target: string;
  lineBase: number;
  recoveryBase: number;
};

type TrackPoint = {
  x: number;
  y: number;
};

type TrackPose = {
  point: TrackPoint;
  angle: number;
};

const SAMPLES: SampleSpec[] = [
  {
    id: "glare-lane",
    stage: "Data synthesis",
    dataSource: "KITTI / nuScenes",
    encoder: "ResNet / CLIP-style encoder",
    color: "#7aa3ff",
    note: "광원 강도 변형과 반사광 합성을 통해 원본 lane mask와 동일한 정답을 유지한 채 glare pair를 만든다.",
    target: "lane mask",
    lineBase: 0.42,
    recoveryBase: 0.36,
  },
  {
    id: "contrastive-pair",
    stage: "Contrastive alignment",
    dataSource: "Original vs A'",
    encoder: "Siamese / SimCLR / BYOL",
    color: "#f0c78c",
    note: "원본과 노이즈 이미지 A, A'를 같은 feature space로 끌어당겨 line geometry가 노이즈보다 우선되게 학습한다.",
    target: "shared embedding",
    lineBase: 0.5,
    recoveryBase: 0.48,
  },
  {
    id: "domain-gap",
    stage: "Feature adaptation",
    dataSource: "Real to Synthetic",
    encoder: "MMD / CORAL / Adv",
    color: "#ff8a6b",
    note: "feature alignment를 추가해 glare domain으로 넘어간 뒤에도 lane topology가 무너지지 않게 만든다.",
    target: "domain invariance",
    lineBase: 0.54,
    recoveryBase: 0.52,
  },
  {
    id: "deploy-lite",
    stage: "Realtime deployment",
    dataSource: "On-device",
    encoder: "MobileNet / EfficientNet",
    color: "#8af4dd",
    note: "최종 배치는 경량 backbone을 사용해 주행 중 실시간으로 lane confidence를 유지하는 방향을 목표로 한다.",
    target: "edge robustness",
    lineBase: 0.6,
    recoveryBase: 0.56,
  },
];

const METHOD_CARDS = [
  {
    title: "빛 번짐 데이터 생성",
    copy: "StyleGAN, CycleGAN 계열 아이디어를 이용해 glare와 reflection이 강한 synthetic frame을 만든다.",
  },
  {
    title: "동일 정답 학습",
    copy: "원본 이미지와 노이즈 이미지를 같은 GT lane mask로 지도해 illumination보다 lane geometry가 우선되게 만든다.",
  },
  {
    title: "도메인 적응",
    copy: "MMD, CORAL, adversarial alignment를 붙여 real-to-synthetic 간 feature gap을 줄인다.",
  },
  {
    title: "경량 네트워크",
    copy: "실시간 적용 단계에서는 EfficientNet, MobileNet 계열로 backbone을 축소한다.",
  },
];

const BASE_TRACK_POINTS: TrackPoint[] = [
  { x: 56, y: 178 },
  { x: 72, y: 116 },
  { x: 118, y: 72 },
  { x: 194, y: 60 },
  { x: 276, y: 78 },
  { x: 316, y: 124 },
  { x: 304, y: 184 },
  { x: 248, y: 214 },
  { x: 190, y: 220 },
  { x: 142, y: 206 },
  { x: 114, y: 176 },
  { x: 126, y: 138 },
  { x: 172, y: 112 },
  { x: 226, y: 114 },
  { x: 254, y: 144 },
  { x: 246, y: 176 },
  { x: 204, y: 190 },
  { x: 160, y: 180 },
  { x: 138, y: 152 },
  { x: 126, y: 186 },
];

const TRACK_CYCLE_SECONDS = 10;
const TRAINING_CYCLE_SECONDS = 14;
const GLARE_CENTER_T = 0.28;
const GLARE_WIDTH = 0.09;
const GLARE_STATUS_WIDTH = 0.06;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function easeInOut(value: number) {
  const clamped = clamp01(value);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function polarToCartesian(radius: number, angle: number) {
  return {
    x: 110 + Math.cos(angle) * radius,
    y: 110 + Math.sin(angle) * radius,
  };
}

function formatMetric(value: number) {
  return `${Math.round(value * 100)}%`;
}

function distance(a: TrackPoint, b: TrackPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function toPath(points: TrackPoint[], closed = true) {
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  return closed ? `${path} Z` : path;
}

function wrappedDistance(a: number, b: number) {
  const difference = Math.abs(a - b);
  return Math.min(difference, 1 - difference);
}

function gaussianWeight(a: number, b: number, sigma: number) {
  const delta = wrappedDistance(a, b);
  return Math.exp(-((delta * delta) / (2 * sigma * sigma)));
}

function getNormal(points: TrackPoint[], index: number) {
  const count = points.length;
  const previous = points[(index - 1 + count) % count];
  const next = points[(index + 1) % count];
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const length = Math.hypot(dx, dy) || 1;

  return {
    x: -dy / length,
    y: dx / length,
  };
}

function offsetTrack(points: TrackPoint[], peakOffset: number) {
  return points.map((point, index) => {
    const ratio = index / points.length;
    const weight = gaussianWeight(ratio, GLARE_CENTER_T, GLARE_WIDTH);
    const normal = getNormal(points, index);

    return {
      x: point.x + normal.x * peakOffset * weight,
      y: point.y + normal.y * peakOffset * weight,
    };
  });
}

function sampleTrack(points: TrackPoint[], t: number): TrackPose {
  const wrapped = ((t % 1) + 1) % 1;
  const segmentLengths = points.map((point, index) => distance(point, points[(index + 1) % points.length]));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  let target = wrapped * totalLength;

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const segmentLength = segmentLengths[index];

    if (target <= segmentLength) {
      const ratio = segmentLength === 0 ? 0 : target / segmentLength;
      return {
        point: {
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio,
        },
        angle: Math.atan2(end.y - start.y, end.x - start.x),
      };
    }

    target -= segmentLength;
  }

  const fallback = points[0];
  const next = points[1];

  return {
    point: fallback,
    angle: Math.atan2(next.y - fallback.y, next.x - fallback.x),
  };
}

function sampleTrackWindow(points: TrackPoint[], startT: number, span: number, steps: number) {
  return Array.from({ length: steps }, (_, index) => {
    const offset = steps === 1 ? 0 : (span * index) / (steps - 1);
    return sampleTrack(points, startT + offset).point;
  });
}

function toDegrees(angle: number) {
  return (angle * 180) / Math.PI;
}

export function SmolExperience() {
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

  const trainingCycle = seconds / TRAINING_CYCLE_SECONDS;
  const trainingIndex = Math.floor(trainingCycle);
  const trainingProgress = easeInOut(trainingCycle - trainingIndex);
  const trackProgress = (seconds % TRACK_CYCLE_SECONDS) / TRACK_CYCLE_SECONDS;
  const activeSample = SAMPLES[trainingIndex % SAMPLES.length];
  const glareOffset = Math.sin(seconds * 0.84) * 18;
  const similarity = 0.38 + trainingProgress * 0.54;
  const domainGap = 0.62 - trainingProgress * 0.46;
  const loss = 1.18 - trainingProgress * 0.82;
  const lineConfidence = clamp01(activeSample.lineBase + trainingProgress * 0.34);
  const recovery = clamp01(activeSample.recoveryBase + trainingProgress * 0.36);
  const baselineLine = clamp01(0.18 + activeSample.lineBase * 0.4 - trainingProgress * 0.06);
  const positives = useMemo(() => {
    const anchor = polarToCartesian(42, -0.92);
    const positive = polarToCartesian(56 - trainingProgress * 26, -0.18 + trainingProgress * 0.56);
    const negatives = [
      polarToCartesian(78, 1.92),
      polarToCartesian(74, 2.72),
      polarToCartesian(68, 0.96),
      polarToCartesian(82, -2.34),
    ];

    return { anchor, positive, negatives };
  }, [trainingProgress]);

  const baselineTrack = useMemo(() => offsetTrack(BASE_TRACK_POINTS, 34), []);
  const smolTrack = useMemo(() => offsetTrack(BASE_TRACK_POINTS, 8), []);
  const baseTrackPath = useMemo(() => toPath(BASE_TRACK_POINTS), []);
  const baselinePose = useMemo(() => sampleTrack(baselineTrack, trackProgress), [baselineTrack, trackProgress]);
  const smolPose = useMemo(() => sampleTrack(smolTrack, trackProgress), [smolTrack, trackProgress]);
  const baselineWindow = useMemo(
    () => toPath(sampleTrackWindow(baselineTrack, trackProgress, 0.18, 14), false),
    [baselineTrack, trackProgress],
  );
  const smolWindow = useMemo(
    () => toPath(sampleTrackWindow(smolTrack, trackProgress, 0.18, 14), false),
    [smolTrack, trackProgress],
  );
  const glareHotspot = useMemo(() => sampleTrack(BASE_TRACK_POINTS, GLARE_CENTER_T).point, []);
  const glareOnCar = gaussianWeight(trackProgress, GLARE_CENTER_T, GLARE_STATUS_WIDTH);
  const baselineStatus = glareOnCar > 0.42 ? "탈선" : "라인 흔들림";
  const smolStatus = glareOnCar > 0.42 ? "정상 주행" : "안정 추종";

  return (
    <main className={styles.shell}>
      <a href="/" className={shellStyles.exitButton}>
        Exit
      </a>

      <div className={styles.layout}>
        <section className={styles.hero}>
          <div className={styles.heroHeader}>
            <div>
              <p className={styles.eyebrow}>SMoL</p>
              <h1 className={styles.title}>DeepRacer-style track 위 glare lane robustness demo</h1>
              <p className={styles.heroCopy}>
                동일한 트랙과 동일한 차량을 10초 주기로 돌리면서, 특정 glare 구간에서 baseline 모델은 lane을 잘못 읽고
                탈선하고 SMoL은 lane을 유지하는 비교 장면을 보여준다.
              </p>
            </div>
            <div className={styles.kpiRow}>
              <div className={styles.kpiCard}>
                <span>Positive similarity</span>
                <strong>{formatMetric(similarity)}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span>NT-Xent loss</span>
                <strong>{loss.toFixed(2)}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span>Domain gap</span>
                <strong>{formatMetric(domainGap)}</strong>
              </div>
              <div className={styles.kpiCard}>
                <span>Track loop</span>
                <strong>10.0 s</strong>
              </div>
            </div>
          </div>

          <div className={styles.cardGrid}>
            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.cardEyebrow}>Training Pair</p>
                  <h2>원본 frame과 glare frame에 같은 lane GT 부여</h2>
                </div>
                <span className={styles.badge}>{activeSample.stage}</span>
              </div>

              <div className={styles.pairGrid}>
                <div className={styles.frameCard}>
                  <span className={styles.frameLabel}>Original</span>
                  <svg viewBox="0 0 320 210" className={styles.sceneSvg} aria-label="Original driving frame">
                    <rect x="0" y="0" width="320" height="210" rx="26" fill="#060606" />
                    <rect x="0" y="0" width="320" height="98" fill="rgba(22,32,54,0.36)" />
                    <circle cx="248" cy="54" r="26" fill="rgba(255,255,255,0.08)" />
                    <path d="M 64 210 L 130 96 L 190 96 L 258 210" fill="rgba(32,32,32,0.88)" />
                    <path d="M 108 210 L 146 96" stroke="rgba(255,255,255,0.65)" strokeWidth="4" strokeDasharray="8 10" />
                    <path d="M 212 210 L 174 96" stroke="rgba(255,255,255,0.65)" strokeWidth="4" strokeDasharray="8 10" />
                    <path d="M 104 190 L 150 110" stroke="rgba(122,163,255,0.9)" strokeWidth="5" />
                    <path d="M 216 190 L 170 110" stroke="rgba(122,163,255,0.9)" strokeWidth="5" />
                  </svg>
                </div>

                <div className={styles.frameCard}>
                  <span className={styles.frameLabel}>Synthetic glare + reflection</span>
                  <svg viewBox="0 0 320 210" className={styles.sceneSvg} aria-label="Glare-augmented driving frame">
                    <rect x="0" y="0" width="320" height="210" rx="26" fill="#050505" />
                    <rect x="0" y="0" width="320" height="98" fill="rgba(34,38,72,0.4)" />
                    <circle cx={248 + glareOffset} cy="48" r="42" fill="rgba(255,236,190,0.28)" />
                    <circle cx={258 + glareOffset * 0.5} cy="56" r="64" fill="rgba(255,236,190,0.16)" />
                    <path d="M 64 210 L 130 96 L 190 96 L 258 210" fill="rgba(32,32,32,0.88)" />
                    <path
                      d="M 108 210 L 146 96"
                      stroke={`rgba(255,255,255,${0.18 + trainingProgress * 0.44})`}
                      strokeWidth="4"
                      strokeDasharray="8 10"
                    />
                    <path
                      d="M 212 210 L 174 96"
                      stroke={`rgba(255,255,255,${0.16 + trainingProgress * 0.46})`}
                      strokeWidth="4"
                      strokeDasharray="8 10"
                    />
                    <path
                      d="M 104 190 L 150 110"
                      stroke={`rgba(122,163,255,${0.3 + trainingProgress * 0.62})`}
                      strokeWidth="5"
                    />
                    <path
                      d="M 216 190 L 170 110"
                      stroke={`rgba(122,163,255,${0.26 + trainingProgress * 0.66})`}
                      strokeWidth="5"
                    />
                    {Array.from({ length: 18 }, (_, index) => (
                      <circle
                        key={index}
                        cx={24 + (index % 6) * 52 + ((index * 17) % 12)}
                        cy={26 + Math.floor(index / 6) * 48 + ((index * 11) % 10)}
                        r="2"
                        fill="rgba(255,255,255,0.18)"
                      />
                    ))}
                  </svg>
                </div>
              </div>

              <div className={styles.trainingMeta}>
                <div className={styles.metaBox}>
                  <span className={styles.statLabel}>Data source</span>
                  <strong>{activeSample.dataSource}</strong>
                </div>
                <div className={styles.metaBox}>
                  <span className={styles.statLabel}>Encoder</span>
                  <strong>{activeSample.encoder}</strong>
                </div>
                <div className={styles.metaBox}>
                  <span className={styles.statLabel}>Shared target</span>
                  <strong>{activeSample.target}</strong>
                </div>
              </div>

              <p className={styles.cardCopy}>{activeSample.note}</p>
            </article>

            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.cardEyebrow}>Embedding Space</p>
                  <h2>Contrastive + domain adaptation 정렬</h2>
                </div>
                <span className={styles.badge}>Feature alignment</span>
              </div>

              <div className={styles.embeddingPanel}>
                <svg viewBox="0 0 220 220" className={styles.embeddingSvg} aria-label="Contrastive embedding plot">
                  <rect x="12" y="12" width="196" height="196" rx="30" fill="rgba(255,255,255,0.02)" />
                  <circle cx="110" cy="110" r="70" fill="none" stroke="rgba(255,255,255,0.08)" />
                  <circle cx="110" cy="110" r="40" fill="none" stroke="rgba(255,255,255,0.06)" />
                  {positives.negatives.map((point, index) => (
                    <circle key={index} cx={point.x} cy={point.y} r="8" fill="rgba(255,255,255,0.18)" />
                  ))}
                  <line
                    x1={positives.anchor.x}
                    y1={positives.anchor.y}
                    x2={positives.positive.x}
                    y2={positives.positive.y}
                    stroke={activeSample.color}
                    strokeWidth="3"
                    opacity="0.8"
                  />
                  <circle cx={positives.anchor.x} cy={positives.anchor.y} r="10" fill="#ffffff" />
                  <circle cx={positives.positive.x} cy={positives.positive.y} r="10" fill={activeSample.color} />
                </svg>

                <div className={styles.embeddingStats}>
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Positive pair</span>
                    <strong>{formatMetric(similarity)}</strong>
                  </div>
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Domain gap</span>
                    <strong>{formatMetric(domainGap)}</strong>
                  </div>
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Lane feature keep</span>
                    <strong>{formatMetric(lineConfidence)}</strong>
                  </div>
                </div>
              </div>

              <div className={styles.methodGrid}>
                {METHOD_CARDS.map((card) => (
                  <article key={card.title} className={styles.methodCard}>
                    <h3>{card.title}</h3>
                    <p>{card.copy}</p>
                  </article>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className={styles.inferenceCard}>
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.cardEyebrow}>DeepRacer Track Comparison</p>
              <h2>같은 트랙, 같은 차량, 다른 모델</h2>
            </div>
            <span className={styles.badge}>10 second lap</span>
          </div>

          <div className={styles.comparisonGrid}>
            <article className={`${styles.trackCard} ${styles.trackCardDanger}`}>
              <div className={styles.trackHeader}>
                <div>
                  <p className={styles.trackEyebrow}>Baseline</p>
                  <h3>glare 구간에서 lane 인식 붕괴</h3>
                </div>
                <span className={styles.trackStateDanger}>{baselineStatus}</span>
              </div>

              <svg viewBox="0 0 360 260" className={styles.trackSvg} aria-label="Baseline track simulation">
                <defs>
                  <radialGradient id="baselineGlare" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(255,236,190,0.42)" />
                    <stop offset="100%" stopColor="rgba(255,236,190,0)" />
                  </radialGradient>
                </defs>
                <rect x="0" y="0" width="360" height="260" rx="28" fill="#060606" />
                <path d={baseTrackPath} fill="none" stroke="rgba(18,18,18,0.98)" strokeWidth="42" strokeLinecap="round" strokeLinejoin="round" />
                <path d={baseTrackPath} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <path d={baseTrackPath} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" strokeDasharray="10 10" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={glareHotspot.x + glareOffset} cy={glareHotspot.y - 8} r="58" fill="url(#baselineGlare)" />
                <path d={baselineWindow} fill="none" stroke="rgba(255,138,107,0.94)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                <g transform={`translate(${baselinePose.point.x} ${baselinePose.point.y}) rotate(${toDegrees(baselinePose.angle)})`}>
                  <rect x="-13" y="-8" width="26" height="16" rx="6" fill="#ff8a6b" />
                  <rect x="-5" y="-6" width="10" height="12" rx="3" fill="#fff4e8" />
                </g>
                <text x="24" y="30" className={styles.trackOverlay}>
                  glare zone
                </text>
                <text x="24" y="238" className={styles.trackMetaText}>
                  detected lane {Math.round(baselineLine * 100)}%
                </text>
              </svg>

              <div className={styles.trackStats}>
                <div className={styles.trackStat}>
                  <span>Model</span>
                  <strong>Baseline</strong>
                </div>
                <div className={styles.trackStat}>
                  <span>Lap</span>
                  <strong>10.0 s</strong>
                </div>
                <div className={styles.trackStat}>
                  <span>Status</span>
                  <strong>{baselineStatus}</strong>
                </div>
              </div>

              <p className={styles.trackCopy}>
                glare 구간에 진입하면 모델이 읽는 lane window가 바깥쪽으로 틀어지고, 차량도 그 인식된 lane을 따라가며 트랙 밖으로 벗어난다.
              </p>
            </article>

            <article className={`${styles.trackCard} ${styles.trackCardSafe}`}>
              <div className={styles.trackHeader}>
                <div>
                  <p className={styles.trackEyebrow}>SMoL</p>
                  <h3>glare 구간에서도 lane 유지</h3>
                </div>
                <span className={styles.trackStateSafe}>{smolStatus}</span>
              </div>

              <svg viewBox="0 0 360 260" className={styles.trackSvg} aria-label="SMoL track simulation">
                <defs>
                  <radialGradient id="smolGlare" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(255,236,190,0.42)" />
                    <stop offset="100%" stopColor="rgba(255,236,190,0)" />
                  </radialGradient>
                </defs>
                <rect x="0" y="0" width="360" height="260" rx="28" fill="#060606" />
                <path d={baseTrackPath} fill="none" stroke="rgba(18,18,18,0.98)" strokeWidth="42" strokeLinecap="round" strokeLinejoin="round" />
                <path d={baseTrackPath} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <path d={baseTrackPath} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" strokeDasharray="10 10" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={glareHotspot.x + glareOffset} cy={glareHotspot.y - 8} r="58" fill="url(#smolGlare)" />
                <path d={smolWindow} fill="none" stroke="rgba(122,163,255,0.96)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                <g transform={`translate(${smolPose.point.x} ${smolPose.point.y}) rotate(${toDegrees(smolPose.angle)})`}>
                  <rect x="-13" y="-8" width="26" height="16" rx="6" fill="#7aa3ff" />
                  <rect x="-5" y="-6" width="10" height="12" rx="3" fill="#eef4ff" />
                </g>
                <text x="24" y="30" className={styles.trackOverlay}>
                  glare zone
                </text>
                <text x="24" y="238" className={styles.trackMetaText}>
                  detected lane {Math.round(lineConfidence * 100)}%
                </text>
              </svg>

              <div className={styles.trackStats}>
                <div className={styles.trackStat}>
                  <span>Model</span>
                  <strong>SMoL</strong>
                </div>
                <div className={styles.trackStat}>
                  <span>Lap</span>
                  <strong>10.0 s</strong>
                </div>
                <div className={styles.trackStat}>
                  <span>Status</span>
                  <strong>{smolStatus}</strong>
                </div>
              </div>

              <p className={styles.trackCopy}>
                같은 glare 구간에서도 lane window가 centerline 근처를 유지하고, 차량도 트랙 위 특정 lane을 따라 안정적으로 한 바퀴를 마친다.
              </p>
            </article>
          </div>

          <div className={styles.bottomGrid}>
            <article className={styles.bottomCard}>
              <span className={styles.statLabel}>트랙 설정</span>
              <h3>동일 track / 동일 car</h3>
              <p>두 패널은 동일한 DeepRacer 스타일 폐곡선 트랙과 동일한 차량 geometry를 사용하고, 모델만 다르게 둔다.</p>
            </article>
            <article className={styles.bottomCard}>
              <span className={styles.statLabel}>lane visualization</span>
              <h3>차량이 보는 lane window</h3>
              <p>차량 앞쪽에 그려지는 선이 현재 모델이 읽는 lane이다. baseline은 glare에서 바깥으로 휘고, SMoL은 track 안쪽을 유지한다.</p>
            </article>
            <article className={styles.bottomCard}>
              <span className={styles.statLabel}>현재 단계</span>
              <h3>{activeSample.stage}</h3>
              <p>{activeSample.note}</p>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
