"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";
import { works } from "../work-data";
import { SceneCanvas } from "./SceneCanvas";

type TrackingState = {
  ready: boolean;
  permission: "idle" | "pending" | "granted" | "denied";
  gesture: "open" | "closed" | "searching";
  hoveredSlug: string | null;
  hoveredName: string;
};

const HOLD_MS = 900;

function getClosedFistScore(points: Array<{ x: number; y: number }>) {
  const wrist = points[0];
  const indexTip = points[8];
  const middleTip = points[12];
  const ringTip = points[16];
  const pinkyTip = points[20];
  const indexMcp = points[5];
  const middleMcp = points[9];
  const ringMcp = points[13];
  const pinkyMcp = points[17];

  const handScale = Math.hypot(indexMcp.x - pinkyMcp.x, indexMcp.y - pinkyMcp.y) || 1;
  const curled =
    Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y) +
    Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y) +
    Math.hypot(ringTip.x - wrist.x, ringTip.y - wrist.y) +
    Math.hypot(pinkyTip.x - wrist.x, pinkyTip.y - wrist.y);

  return curled / handScale;
}

export function HandDockHome() {
  const [state, setState] = useState<TrackingState>({
    ready: false,
    permission: "idle",
    gesture: "searching",
    hoveredSlug: null,
    hoveredName: "None",
  });
  const [pointer, setPointer] = useState({ x: 160, y: 160 });
  const holdRef = useRef<{ slug: string | null; startedAt: number }>({
    slug: null,
    startedAt: 0,
  });
  const activatedRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let handLandmarker: { close: () => void; detectForVideo: (video: HTMLVideoElement, now: number) => { landmarks: Array<Array<{ x: number; y: number }>> } } | null = null;
    let mounted = true;

    async function setup() {
      setState((current) => ({ ...current, permission: "pending" }));

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 960, height: 720 },
          audio: false,
        });
      } catch {
        if (!mounted) {
          return;
        }
        setState((current) => ({
          ...current,
          permission: "denied",
          ready: false,
          gesture: "searching",
        }));
        return;
      }

      if (!mounted || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const moduleUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";
      const vision = (await import(/* webpackIgnore: true */ moduleUrl)) as {
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
            ) => { landmarks: Array<Array<{ x: number; y: number }>> };
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

      setState((current) => ({
        ...current,
        permission: "granted",
        ready: true,
      }));

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
            hoveredName: "Searching",
          }));
          frameRef.current = requestAnimationFrame(loop);
          return;
        }

        const cursor = hand[9];
        const x = (1 - cursor.x) * window.innerWidth;
        const y = cursor.y * window.innerHeight;
        setPointer({ x, y });
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true, pointerType: "mouse" }),
        );

        const fistScore = getClosedFistScore(hand);
        const closed = fistScore < 5.35;
        const hovered = document.elementFromPoint(x, y)?.closest("[data-work-slug]");
        const hoveredSlug = hovered?.getAttribute("data-work-slug") ?? null;
        const hoveredName = hovered?.getAttribute("data-work-name") ?? "None";

        if (closed && hoveredSlug) {
          if (holdRef.current.slug !== hoveredSlug) {
            holdRef.current = { slug: hoveredSlug, startedAt: performance.now() };
            activatedRef.current = null;
          }

          const elapsed = performance.now() - holdRef.current.startedAt;
          if (elapsed >= HOLD_MS && activatedRef.current !== hoveredSlug) {
            activatedRef.current = hoveredSlug;
            (hovered as HTMLElement).click();
          }
        } else {
          holdRef.current = { slug: hoveredSlug, startedAt: performance.now() };
          if (!closed) {
            activatedRef.current = null;
          }
        }

        setState((current) => ({
          ...current,
          gesture: closed ? "closed" : "open",
          hoveredSlug,
          hoveredName,
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
      if (handLandmarker) {
        handLandmarker.close();
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const statusLabel =
    state.permission === "denied"
      ? "Camera blocked"
      : state.ready
        ? "Gesture dock live"
        : "Preparing camera";

  return (
    <main className={styles.shell}>
      <SceneCanvas />
      <div className={styles.veil} />

      <div className={styles.content}>
        <section className={styles.hero}>
          <div>
            <div className={styles.badge}>HandDock / local portal</div>
          </div>

          <div className={styles.headlineWrap}>
            <h1 className={styles.title}>Enter works with your hand.</h1>
            <p className={styles.subtitle}>
              The robot follows your motion in Spline, while the dock listens to your camera.
              Move your hand to aim. Make a fist and hold briefly over a card to enter without a
              mouse.
            </p>

            <div className={styles.guide}>
              <span className={styles.guideDot} />
              <span>{statusLabel}</span>
            </div>
          </div>
        </section>

        <aside className={styles.side}>
          <section className={`${styles.panel} ${styles.statusPanel}`}>
            <p className={styles.eyebrow}>Status</p>
            <h2 className={styles.panelTitle}>Gesture-first archive</h2>
            <p className={styles.panelCopy}>
              This page is static-deploy ready. The only live inputs are the webcam stream and your
              hand landmarks in the browser.
            </p>

            <div className={styles.statusGrid}>
              <div className={styles.statusItem}>
                <p className={styles.statusLabel}>Camera</p>
                <p className={styles.statusValue}>{state.permission}</p>
              </div>
              <div className={styles.statusItem}>
                <p className={styles.statusLabel}>Gesture</p>
                <p className={styles.statusValue}>{state.gesture}</p>
              </div>
              <div className={styles.statusItem}>
                <p className={styles.statusLabel}>Target</p>
                <p className={styles.statusValue}>{state.hoveredName}</p>
              </div>
              <div className={styles.statusItem}>
                <p className={styles.statusLabel}>Select</p>
                <p className={styles.statusValue}>Fist + hold {HOLD_MS / 1000}s</p>
              </div>
            </div>
          </section>

          <section className={`${styles.panel} ${styles.dock}`}>
            <div className={styles.dockHeader}>
              <div>
                <h2 className={styles.dockTitle}>Work Dock</h2>
                <p className={styles.dockCopy}>Static slots for your vibe-coded results.</p>
              </div>
            </div>

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
                      <h3 className={styles.linkName}>{work.name}</h3>
                      <span className={styles.linkTag}>{work.status}</span>
                    </div>
                    <p className={styles.linkDescription}>{work.description}</p>
                    <div className={styles.linkMeta}>
                      {work.stack.map((item) => (
                        <span key={item} className={styles.metaPill}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </aside>
      </div>

      <div
        className={`${styles.reticle} ${state.gesture === "closed" ? styles.reticleClosed : ""}`}
        style={{ transform: `translate3d(${pointer.x}px, ${pointer.y}px, 0)` }}
      >
        <div className={styles.reticleCore} />
        <div className={styles.reticleLabel}>
          {state.gesture === "closed" ? "Fist select" : "Hand cursor"}
        </div>
      </div>

      <video ref={videoRef} className={styles.video} autoPlay muted playsInline />
    </main>
  );
}
