"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";
import { works } from "../work-data";
import { SceneCanvas } from "./SceneCanvas";

type Landmark = { x: number; y: number };

type TrackingState = {
  gesture: "open" | "pinch" | "neutral" | "searching";
  hoveredSlug: string | null;
};

type VisionModule = {
  FilesetResolver: {
    forVisionTasks: (path: string) => Promise<unknown>;
  };
  HandLandmarker: {
    createFromOptions: (
      resolver: unknown,
      options: Record<string, unknown>,
    ) => Promise<{
      close: () => void;
      detectForVideo: (
        video: HTMLVideoElement,
        now: number,
      ) => { landmarks: Array<Array<Landmark>> };
    }>;
  };
};

const HOLD_MS = 280;
const DOCK_VISIBILITY_MS = 2200;
const POINTER_SMOOTHING = 0.34;
const PINCH_THRESHOLD = 0.42;
const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;
const FINGERTIP_COLORS = ["#f7c66a", "#8af4dd", "#f4f7fb", "#f39bd8", "#78b9ff"];
const loadVisionModule = new Function("moduleUrl", "return import(moduleUrl)") as (
  moduleUrl: string,
) => Promise<VisionModule>;

function distance(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getHandScale(points: Landmark[]) {
  return distance(points[5], points[17]) || 1;
}

function getPrimaryHand(hands: Landmark[][]) {
  return [...hands].sort((left, right) => getHandScale(right) - getHandScale(left))[0];
}

function isFingerExtended(points: Landmark[], tipIndex: number, pipIndex: number) {
  return points[tipIndex].y < points[pipIndex].y;
}

function isOpenPalm(points: Landmark[]) {
  const extendedCount = [
    isFingerExtended(points, 8, 6),
    isFingerExtended(points, 12, 10),
    isFingerExtended(points, 16, 14),
    isFingerExtended(points, 20, 18),
  ].filter(Boolean).length;

  const scale = getHandScale(points);
  const spread = distance(points[8], points[20]) / scale;
  const indexLift = (points[5].y - points[8].y) / scale;
  const middleLift = (points[9].y - points[12].y) / scale;

  return extendedCount >= 3 && spread > 1.35 && indexLift > 0.7 && middleLift > 0.7;
}

function isPinching(points: Landmark[]) {
  const scale = getHandScale(points);
  const pinchDistance = distance(points[4], points[8]) / scale;
  return pinchDistance < PINCH_THRESHOLD;
}

function drawFingertipPreview(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  hands: Landmark[][],
  primaryHand: Landmark[] | undefined,
  pinching: boolean,
) {
  if (!canvas || !video) {
    return;
  }

  if (!video.videoWidth || !video.videoHeight) {
    return;
  }

  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  hands.forEach((hand, handIndex) => {
    FINGERTIP_INDICES.forEach((tipIndex, tipOrder) => {
      const point = hand[tipIndex];
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;

      context.beginPath();
      context.fillStyle = FINGERTIP_COLORS[tipOrder];
      context.arc(x, y, hand === primaryHand && tipIndex === 8 ? 12 : 8, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.lineWidth = handIndex === 0 ? 2.5 : 1.5;
      context.strokeStyle = "rgba(0, 0, 0, 0.65)";
      context.arc(x, y, hand === primaryHand && tipIndex === 8 ? 14 : 10, 0, Math.PI * 2);
      context.stroke();
    });
  });

  if (primaryHand) {
    context.beginPath();
    context.moveTo(primaryHand[4].x * canvas.width, primaryHand[4].y * canvas.height);
    context.lineTo(primaryHand[8].x * canvas.width, primaryHand[8].y * canvas.height);
    context.lineWidth = 4;
    context.strokeStyle = pinching ? "rgba(247, 198, 106, 0.92)" : "rgba(255, 255, 255, 0.45)";
    context.stroke();
  }
}

export function HandDockHome() {
  const [state, setState] = useState<TrackingState>({
    gesture: "searching",
    hoveredSlug: null,
  });
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [dockVisible, setDockVisible] = useState(false);
  const dockVisibleRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0 });
  const holdRef = useRef<{ slug: string | null; startedAt: number }>({
    slug: null,
    startedAt: 0,
  });
  const activatedRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const dockTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasPointerRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let handLandmarker: {
      close: () => void;
      detectForVideo: (
        video: HTMLVideoElement,
        now: number,
      ) => { landmarks: Array<Array<Landmark>> };
    } | null = null;
    let mounted = true;

    function revealDock() {
      dockVisibleRef.current = true;
      setDockVisible(true);
      if (dockTimerRef.current) {
        window.clearTimeout(dockTimerRef.current);
      }
      dockTimerRef.current = window.setTimeout(() => {
        dockVisibleRef.current = false;
        setDockVisible(false);
      }, DOCK_VISIBILITY_MS);
    }

    async function setup() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch {
        if (mounted) {
          setState((current) => ({
            ...current,
            gesture: "searching",
          }));
        }
        return;
      }

      if (!mounted || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      await videoRef.current.play().catch(() => undefined);

      const vision = await loadVisionModule("/vendor/mediapipe/vision_bundle.mjs");
      const resolver = await vision.FilesetResolver.forVisionTasks("/vendor/mediapipe");

      try {
        handLandmarker = await vision.HandLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath: "/vendor/mediapipe/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });
      } catch {
        handLandmarker = await vision.HandLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath: "/vendor/mediapipe/hand_landmarker.task",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });
      }

      if (!mounted) {
        handLandmarker?.close();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const loop = () => {
        if (!videoRef.current || !handLandmarker) {
          return;
        }

        const result = handLandmarker.detectForVideo(videoRef.current, performance.now());
        const hands = result.landmarks;
        const hand = getPrimaryHand(hands);

        if (!hand) {
          drawFingertipPreview(previewCanvasRef.current, videoRef.current, [], undefined, false);
          holdRef.current = { slug: null, startedAt: 0 };
          activatedRef.current = null;
          setState((current) => ({
            ...current,
            gesture: "searching",
            hoveredSlug: null,
          }));
          frameRef.current = requestAnimationFrame(loop);
          return;
        }

        const cursor = hand[8];
        const targetX = (1 - cursor.x) * window.innerWidth;
        const targetY = cursor.y * window.innerHeight;
        if (!hasPointerRef.current) {
          pointerRef.current = { x: targetX, y: targetY };
          hasPointerRef.current = true;
        }
        const nextPointer = {
          x: pointerRef.current.x + (targetX - pointerRef.current.x) * POINTER_SMOOTHING,
          y: pointerRef.current.y + (targetY - pointerRef.current.y) * POINTER_SMOOTHING,
        };
        pointerRef.current = nextPointer;
        setPointer(nextPointer);

        window.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: nextPointer.x,
            clientY: nextPointer.y,
            bubbles: true,
          }),
        );
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: nextPointer.x,
            clientY: nextPointer.y,
            bubbles: true,
            pointerType: "mouse",
          }),
        );

        const palmOpen = isOpenPalm(hand);
        const pinching = isPinching(hand);
        drawFingertipPreview(previewCanvasRef.current, videoRef.current, hands, hand, pinching);
        if (palmOpen) {
          revealDock();
        }

        const hovered = document
          .elementFromPoint(nextPointer.x, nextPointer.y)
          ?.closest("[data-work-slug]");
        const hoveredSlug = dockVisibleRef.current
          ? hovered?.getAttribute("data-work-slug") ?? null
          : null;

        if (pinching && hoveredSlug) {
          if (holdRef.current.slug !== hoveredSlug) {
            holdRef.current = { slug: hoveredSlug, startedAt: performance.now() };
            activatedRef.current = null;
          }

          if (
            performance.now() - holdRef.current.startedAt >= HOLD_MS &&
            activatedRef.current !== hoveredSlug
          ) {
            activatedRef.current = hoveredSlug;
            (hovered as HTMLElement).click();
          }
        } else {
          holdRef.current = { slug: hoveredSlug, startedAt: performance.now() };
          if (!pinching) {
            activatedRef.current = null;
          }
        }

        setState((current) => ({
          ...current,
          gesture: pinching ? "pinch" : palmOpen ? "open" : "neutral",
          hoveredSlug,
        }));

        frameRef.current = requestAnimationFrame(loop);
      };

      frameRef.current = requestAnimationFrame(loop);
    }

    setup();

    return () => {
      mounted = false;
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      if (dockTimerRef.current) {
        window.clearTimeout(dockTimerRef.current);
      }
      if (handLandmarker) {
        handLandmarker.close();
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <main className={styles.shell}>
      <SceneCanvas />
      <div className={styles.blackVignette} />

      <aside className={`${styles.dockRail} ${dockVisible ? styles.dockRailVisible : ""}`}>
        <div className={styles.linkList}>
          {works.map((work) => {
            const active = state.hoveredSlug === work.slug;

            return (
              <Link
                key={work.slug}
                href={`/works/${work.slug}`}
                data-work-slug={work.slug}
                data-work-name={work.name}
                className={`${styles.linkCard} ${active ? styles.linkCardActive : ""}`}
              >
                <div className={styles.linkTop}>
                  <h2 className={styles.linkName}>{work.name}</h2>
                  <span className={styles.linkTag}>{work.status}</span>
                </div>
                <p className={styles.linkDescription}>{work.description}</p>
              </Link>
            );
          })}
        </div>
      </aside>

      <div
        className={`${styles.reticle} ${state.gesture === "pinch" ? styles.reticlePinch : ""} ${
          dockVisible ? styles.reticleVisible : ""
        }`}
        style={{ transform: `translate3d(${pointer.x}px, ${pointer.y}px, 0)` }}
      >
        <div className={styles.reticleCore} />
      </div>

      <div className={styles.previewDock}>
        <video ref={videoRef} className={styles.previewVideo} autoPlay muted playsInline />
        <canvas ref={previewCanvasRef} className={styles.previewCanvas} />
      </div>
    </main>
  );
}
