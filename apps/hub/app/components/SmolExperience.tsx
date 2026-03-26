"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./SmolExperience.module.css";
import { WorkGestureBack } from "./WorkGestureBack";

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
    note: "feature alignment를 추가해 glare domain으로 넘어간 뒤에도 lane topology와 obstacle edge가 무너지지 않게 만든다.",
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
    note: "최종 배치는 경량 backbone을 사용해 주행 중 실시간으로 line confidence를 유지하는 방향을 목표로 한다.",
    target: "edge robustness",
    lineBase: 0.6,
    recoveryBase: 0.56,
  },
];

const METHOD_CARDS = [
  {
    title: "빛 번짐 데이터 생성",
    copy: "StyleGAN, CycleGAN 계열 아이디어를 이용해 bloom과 glare가 들어간 synthetic frame을 만든다.",
  },
  {
    title: "동일 정답 학습",
    copy: "원본 이미지와 노이즈 이미지를 같은 GT로 지도해 line mask가 illumination보다 우선되게 만든다.",
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

  const cycle = seconds / 14;
  const cycleIndex = Math.floor(cycle);
  const progress = easeInOut(cycle - cycleIndex);
  const activeSample = SAMPLES[cycleIndex % SAMPLES.length];
  const glareOffset = Math.sin(seconds * 0.84) * 28;
  const similarity = 0.38 + progress * 0.54;
  const domainGap = 0.62 - progress * 0.46;
  const loss = 1.18 - progress * 0.82;
  const lineConfidence = clamp01(activeSample.lineBase + progress * 0.34);
  const recovery = clamp01(activeSample.recoveryBase + progress * 0.36);
  const baselineLine = clamp01(0.18 + activeSample.lineBase * 0.4 - progress * 0.06);
  const positives = useMemo(() => {
    const anchor = polarToCartesian(42, -0.92);
    const positive = polarToCartesian(56 - progress * 26, -0.18 + progress * 0.56);
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
              <p className={styles.eyebrow}>SMoL</p>
              <h1 className={styles.title}>빛 노이즈에 강건한 line detection 학습 시각화</h1>
              <p className={styles.heroCopy}>
                glare가 섞인 synthetic frame 생성, contrastive alignment, domain adaptation, 그리고 주행 line detection 복원까지
                한 흐름으로 재구성한 브라우저 데모.
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
                <span>Line recovery</span>
                <strong>{formatMetric(recovery)}</strong>
              </div>
            </div>
          </div>

          <div className={styles.cardGrid}>
            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.cardEyebrow}>Training Pair</p>
                  <h2>원본 이미지와 glare 이미지에 같은 GT를 부여</h2>
                </div>
                <span className={styles.badge}>{activeSample.stage}</span>
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
                    <rect x="182" y="126" width="52" height="28" rx="8" fill={activeSample.color} opacity="0.88" />
                    <rect x="106" y="140" width="34" height="20" rx="8" fill="rgba(255,255,255,0.2)" />
                    <path d="M 104 190 L 150 110" stroke="rgba(122,163,255,0.9)" strokeWidth="5" />
                    <path d="M 216 190 L 170 110" stroke="rgba(122,163,255,0.9)" strokeWidth="5" />
                  </svg>
                </div>

                <div className={styles.frameCard}>
                  <span className={styles.frameLabel}>Synthetic glare + reflection</span>
                  <svg viewBox="0 0 320 210" className={styles.sceneSvg} aria-label="Augmented driving image">
                    <rect x="0" y="0" width="320" height="210" rx="26" fill="#050505" />
                    <rect x="0" y="0" width="320" height="98" fill="rgba(34,38,72,0.4)" />
                    <circle cx={248 + glareOffset} cy="48" r="42" fill="rgba(255,236,190,0.28)" />
                    <circle cx={258 + glareOffset * 0.5} cy="56" r="64" fill="rgba(255,236,190,0.16)" />
                    <path d="M 64 210 L 130 96 L 190 96 L 258 210" fill="rgba(32,32,32,0.88)" />
                    <path d="M 108 210 L 146 96" stroke={`rgba(255,255,255,${0.18 + progress * 0.44})`} strokeWidth="4" strokeDasharray="8 10" />
                    <path d="M 212 210 L 174 96" stroke={`rgba(255,255,255,${0.16 + progress * 0.46})`} strokeWidth="4" strokeDasharray="8 10" />
                    <rect x="182" y="126" width="52" height="28" rx="8" fill={activeSample.color} opacity={0.34 + progress * 0.56} />
                    <path d="M 104 190 L 150 110" stroke={`rgba(122,163,255,${0.3 + progress * 0.62})`} strokeWidth="5" />
                    <path d="M 216 190 L 170 110" stroke={`rgba(122,163,255,${0.26 + progress * 0.66})`} strokeWidth="5" />
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
              <p className={styles.cardEyebrow}>Driving Inference</p>
              <h2>빛 노이즈 상황에서 baseline 대비 더 안정적인 line detection</h2>
            </div>
            <span className={styles.badge}>SMoL inference</span>
          </div>

          <svg viewBox="0 0 760 360" className={styles.inferenceSvg} aria-label="Robust driving inference scene">
            <defs>
              <linearGradient id="roadFade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#050505" />
                <stop offset="100%" stopColor="#0d0d0d" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="760" height="360" rx="30" fill="url(#roadFade)" />
            <line x1="380" y1="28" x2="380" y2="332" stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="8 10" />
            <text x="78" y="44" className={styles.overlayLabel}>
              baseline
            </text>
            <text x="454" y="44" className={styles.overlayLabel}>
              SMoL
            </text>

            <g transform="translate(0 0)">
              <circle cx={214 + glareOffset * 1.3} cy="84" r="62" fill="rgba(255,234,188,0.24)" />
              <circle cx={214 + glareOffset * 0.65} cy="84" r="112" fill="rgba(255,234,188,0.11)" />
              <path d="M 44 332 L 156 88 L 224 88 L 336 332" fill="rgba(34,34,34,0.94)" />
              <path d="M 130 332 L 174 88" stroke={`rgba(122,163,255,${0.16 + baselineLine * 0.46})`} strokeWidth="7" strokeLinecap="round" strokeDasharray="16 14" />
              <path d="M 250 332 L 206 88" stroke={`rgba(122,163,255,${0.14 + baselineLine * 0.42})`} strokeWidth="7" strokeLinecap="round" strokeDasharray="18 18" />
              <rect x="232" y="176" width="76" height="46" rx="14" fill="none" stroke="rgba(255,138,107,0.28)" strokeWidth="4" />
              <text x="66" y="314" className={styles.overlayMeta}>
                line {Math.round(baselineLine * 100)}%
              </text>
            </g>

            <g transform="translate(380 0)">
              <circle cx={214 + glareOffset * 1.3} cy="84" r="62" fill="rgba(255,234,188,0.24)" />
              <circle cx={214 + glareOffset * 0.65} cy="84" r="112" fill="rgba(255,234,188,0.11)" />
              <path d="M 44 332 L 156 88 L 224 88 L 336 332" fill="rgba(34,34,34,0.94)" />
              <path d="M 130 332 L 174 88" stroke={`rgba(122,163,255,${0.28 + lineConfidence * 0.68})`} strokeWidth="8" strokeLinecap="round" />
              <path d="M 250 332 L 206 88" stroke={`rgba(122,163,255,${0.28 + lineConfidence * 0.68})`} strokeWidth="8" strokeLinecap="round" />
              <path d="M 190 332 L 190 120" stroke="rgba(255,255,255,0.34)" strokeWidth="4" strokeDasharray="14 14" />
              <rect x="232" y="176" width="76" height="46" rx="14" fill="none" stroke={`rgba(255,138,107,${0.24 + recovery * 0.62})`} strokeWidth="4" />
              <text x="60" y="314" className={styles.overlayMeta}>
                line {Math.round(lineConfidence * 100)}%
              </text>
              <text x="228" y="170" className={styles.overlayMeta}>
                glare recover {Math.round(recovery * 100)}%
              </text>
            </g>
          </svg>

          <div className={styles.bottomGrid}>
            <article className={styles.bottomCard}>
              <span className={styles.statLabel}>학습 파이프라인</span>
              <h3>원본-증강 동일 정답</h3>
              <p>원본 프레임과 glare augmentation 프레임을 같은 lane GT로 묶어 supervised + contrastive loss를 함께 거는 구조를 상정한다.</p>
            </article>
            <article className={styles.bottomCard}>
              <span className={styles.statLabel}>적용 결과</span>
              <h3>Line robustness</h3>
              <p>빛 번짐으로 일부 edge가 사라지는 상황에서도 차선 topology를 유지해 baseline보다 더 연속적인 line detection을 보인다.</p>
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
