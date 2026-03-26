"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./LclExperience.module.css";
import { WorkGestureBack } from "./WorkGestureBack";

type SampleSpec = {
  id: string;
  label: string;
  semantic: string;
  color: string;
  note: string;
  laneConfidenceBase: number;
  obstacleConfidenceBase: number;
};

const SAMPLES: SampleSpec[] = [
  {
    id: "lane-glare",
    label: "Lane Pair",
    semantic: "차선 경계",
    color: "#7aa3ff",
    note: "강한 좌측 상단 글레어가 생겨도 원본 lane feature와 augmented lane feature를 가깝게 유지한다.",
    laneConfidenceBase: 0.52,
    obstacleConfidenceBase: 0.46,
  },
  {
    id: "vehicle-flare",
    label: "Vehicle Pair",
    semantic: "전방 차량",
    color: "#f0c78c",
    note: "차량 외곽선이 부분적으로 날아가도 전역 구조 feature가 가까운 위치로 정렬된다.",
    laneConfidenceBase: 0.58,
    obstacleConfidenceBase: 0.55,
  },
  {
    id: "cone-reflection",
    label: "Cone Pair",
    semantic: "도로 콘",
    color: "#ff8a6b",
    note: "반사광과 센서 bloom이 있어도 작은 장애물 feature를 positive pair로 묶는다.",
    laneConfidenceBase: 0.5,
    obstacleConfidenceBase: 0.6,
  },
  {
    id: "ped-shadow",
    label: "Pedestrian Pair",
    semantic: "보행자 / 그림자",
    color: "#8af4dd",
    note: "밝기 변화와 그림자 노이즈를 넘어서 사람 silhouette를 안정된 embedding으로 보존한다.",
    laneConfidenceBase: 0.54,
    obstacleConfidenceBase: 0.57,
  },
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

function polarToCartesian(radius: number, angle: number) {
  return {
    x: 110 + Math.cos(angle) * radius,
    y: 110 + Math.sin(angle) * radius,
  };
}

function formatMetric(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function LclExperience() {
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

  const cycle = seconds / 12;
  const cycleIndex = Math.floor(cycle);
  const progress = easeInOut(cycle - cycleIndex);
  const activeSample = SAMPLES[cycleIndex % SAMPLES.length];
  const glareOffset = Math.sin(seconds * 0.8) * 24;
  const similarity = 0.34 + progress * 0.61;
  const loss = 1.46 - progress * 1.08;
  const laneConfidence = clamp01(activeSample.laneConfidenceBase + progress * 0.35);
  const obstacleConfidence = clamp01(activeSample.obstacleConfidenceBase + progress * 0.34);
  const suppression = 0.38 + progress * 0.54;
  const positives = useMemo(() => {
    const anchor = polarToCartesian(42, -0.88);
    const positive = polarToCartesian(52 - progress * 22, -0.34 + progress * 0.42);
    const negatives = [
      polarToCartesian(78, 1.92),
      polarToCartesian(74, 2.72),
      polarToCartesian(68, 0.96),
      polarToCartesian(82, -2.34),
    ];

    return { anchor, positive, negatives };
  }, [progress]);

  return (
    <main className={styles.shell}>
      <WorkGestureBack />

      <div className={styles.layout}>
        <section className={styles.hero}>
          <div className={styles.heroHeader}>
            <div>
              <p className={styles.eyebrow}>LCL</p>
              <h1 className={styles.title}>Light-noise contrastive learning visualizer</h1>
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
                <span>Suppression</span>
                <strong>{formatMetric(suppression)}</strong>
              </div>
            </div>
          </div>

          <div className={styles.cardGrid}>
            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.cardEyebrow}>Positive Pair</p>
                  <h2>원본 이미지와 빛 노이즈 증강 이미지 매칭</h2>
                </div>
                <span className={styles.badge}>{activeSample.label}</span>
              </div>

              <div className={styles.pairGrid}>
                <div className={styles.frameCard}>
                  <span className={styles.frameLabel}>Original</span>
                  <svg viewBox="0 0 320 210" className={styles.sceneSvg} aria-label="Original driving image">
                    <rect x="0" y="0" width="320" height="210" rx="26" fill="#060606" />
                    <rect x="0" y="0" width="320" height="98" fill="rgba(22,32,54,0.36)" />
                    <circle cx="248" cy="54" r="26" fill="rgba(255,255,255,0.08)" />
                    <path d="M 64 210 L 130 96 L 190 96 L 258 210" fill="rgba(32,32,32,0.88)" />
                    <path d="M 108 210 L 146 96" stroke="rgba(255,255,255,0.65)" strokeWidth="4" strokeDasharray="8 10" />
                    <path d="M 212 210 L 174 96" stroke="rgba(255,255,255,0.65)" strokeWidth="4" strokeDasharray="8 10" />
                    <rect x="182" y="126" width="52" height="28" rx="8" fill={activeSample.color} opacity="0.9" />
                    <rect x="106" y="140" width="34" height="20" rx="8" fill="rgba(255,255,255,0.2)" />
                  </svg>
                </div>

                <div className={styles.frameCard}>
                  <span className={styles.frameLabel}>Glare + light noise</span>
                  <svg viewBox="0 0 320 210" className={styles.sceneSvg} aria-label="Augmented driving image">
                    <rect x="0" y="0" width="320" height="210" rx="26" fill="#050505" />
                    <rect x="0" y="0" width="320" height="98" fill="rgba(34,38,72,0.4)" />
                    <circle cx={248 + glareOffset} cy="48" r="42" fill="rgba(255,236,190,0.28)" />
                    <circle cx={258 + glareOffset * 0.5} cy="56" r="64" fill="rgba(255,236,190,0.16)" />
                    <path d="M 64 210 L 130 96 L 190 96 L 258 210" fill="rgba(32,32,32,0.88)" />
                    <path d="M 108 210 L 146 96" stroke={`rgba(255,255,255,${0.22 + progress * 0.5})`} strokeWidth="4" strokeDasharray="8 10" />
                    <path d="M 212 210 L 174 96" stroke={`rgba(255,255,255,${0.18 + progress * 0.54})`} strokeWidth="4" strokeDasharray="8 10" />
                    <rect x="182" y="126" width="52" height="28" rx="8" fill={activeSample.color} opacity={0.34 + progress * 0.56} />
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

              <p className={styles.cardCopy}>{activeSample.note}</p>
            </article>

            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.cardEyebrow}>Embedding Space</p>
                  <h2>Contrastive embedding alignment</h2>
                </div>
                <span className={styles.badge}>{activeSample.semantic}</span>
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
                    <span className={styles.statLabel}>Negative margin</span>
                    <strong>{formatMetric(0.52 + progress * 0.33)}</strong>
                  </div>
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Queue consistency</span>
                    <strong>{formatMetric(0.48 + progress * 0.39)}</strong>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.inferenceCard}>
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.cardEyebrow}>Driving Inference</p>
              <h2>빛 반사에도 강건한 line / obstacle detection</h2>
            </div>
            <span className={styles.badge}>Robustness Demo</span>
          </div>

          <svg viewBox="0 0 760 360" className={styles.inferenceSvg} aria-label="Robust driving inference scene">
            <defs>
              <linearGradient id="roadFade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#050505" />
                <stop offset="100%" stopColor="#0d0d0d" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="760" height="360" rx="30" fill="url(#roadFade)" />
            <circle cx={590 + glareOffset * 1.8} cy="78" r="64" fill="rgba(255,234,188,0.26)" />
            <circle cx={588 + glareOffset * 0.8} cy="82" r="118" fill="rgba(255,234,188,0.12)" />
            <path d="M 170 360 L 310 76 L 452 76 L 592 360" fill="rgba(34,34,34,0.94)" />
            <path d="M 282 360 L 344 76" stroke={`rgba(122,163,255,${0.24 + laneConfidence * 0.72})`} strokeWidth="8" strokeLinecap="round" />
            <path d="M 480 360 L 418 76" stroke={`rgba(122,163,255,${0.24 + laneConfidence * 0.72})`} strokeWidth="8" strokeLinecap="round" />
            <path d="M 382 360 L 382 102" stroke="rgba(255,255,255,0.38)" strokeWidth="4" strokeDasharray="14 14" />
            <rect x="454" y="184" width="108" height="72" rx="16" fill="none" stroke={`rgba(255,138,107,${0.24 + obstacleConfidence * 0.76})`} strokeWidth="4" />
            <text x="466" y="178" className={styles.overlayLabel}>
              obstacle {Math.round(obstacleConfidence * 100)}%
            </text>
            <rect x="294" y="150" width="62" height="42" rx="12" fill="none" stroke={`rgba(138,244,221,${0.2 + progress * 0.7})`} strokeWidth="4" />
            <text x="292" y="142" className={styles.overlayLabel}>
              lane prior {Math.round(laneConfidence * 100)}%
            </text>
          </svg>

          <div className={styles.bottomGrid}>
            <article className={styles.bottomCard}>
              <span className={styles.statLabel}>학습 파이프라인</span>
              <h3>원본-증강 매칭</h3>
              <p>빛 반사, bloom, sensor noise를 준 이미지를 positive pair로 묶고, feature encoder가 semantic identity를 유지하도록 유도한다.</p>
            </article>
            <article className={styles.bottomCard}>
              <span className={styles.statLabel}>적용 결과</span>
              <h3>Lane / obstacle robustness</h3>
              <p>표면 반사나 역광으로 edge가 깨지는 상황에서도 lane topology와 obstacle silhouette를 더 안정적으로 유지한다.</p>
            </article>
            <article className={styles.bottomCard}>
              <span className={styles.statLabel}>현재 샘플</span>
              <h3>{activeSample.semantic}</h3>
              <p>{activeSample.note}</p>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
