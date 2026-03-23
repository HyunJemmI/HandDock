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

const HOLD_MS = 280;
const DOCK_VISIBILITY_MS = 2200;
const POINTER_SMOOTHING = 0.34;
const PINCH_THRESHOLD = 0.42;
const loadVisionModule = new Function("moduleUrl", "return import(moduleUrl)") as (
  moduleUrl: string,
) => Promise<unknown>;

function distance(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getHandScale(points: Landmark[]) {
  return distance(points[5], points[17]) || 1;
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

      const vision = (await loadVisionModule(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm",
      )) as {
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

      const resolver = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm",
      );

      handLandmarker = await vision.HandLandmarker.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });

      if (!mounted) {
        handLandmarker.close();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const loop = () => {
        if (!videoRef.current || !handLandmarker) {
          return;
        }

        const result = handLandmarker.detectForVideo(videoRef.current, performance.now());
        const hand = result.landmarks[0];

        if (!hand) {
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

      <video ref={videoRef} className={styles.hiddenVideo} autoPlay muted playsInline />
    </main>
  );
}
