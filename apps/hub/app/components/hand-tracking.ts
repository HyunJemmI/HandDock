export type Landmark = { x: number; y: number };
export type TrailPoint = { x: number; y: number; time: number };
export type Viewport = { width: number; height: number };
export type VisionModule = {
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
      ) => {
        landmarks: Array<Array<Landmark>>;
        handedness?: Array<Array<{ categoryName: string }>>;
      };
    }>;
  };
};

export const SWIPE_WINDOW_MS = 220;
export const CLUSTER_THRESHOLD = 0.48;
export const GLOBAL_MENU_FLAG_KEY = "handdock-open-menu";
export const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;
export const loadVisionModule = new Function("moduleUrl", "return import(moduleUrl)") as (
  moduleUrl: string,
) => Promise<VisionModule>;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number) {
  return clamp(value, 0, 1);
}

export function distance(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function averagePoint(points: Landmark[]) {
  const total = points.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

export function getHandScale(points: Landmark[]) {
  return distance(points[5], points[17]) || 1;
}

export function getLargestHand(hands: Landmark[][]) {
  return [...hands].sort((left, right) => getHandScale(right) - getHandScale(left))[0];
}

export function splitHandsBySide(
  hands: Landmark[][],
  handedness: Array<Array<{ categoryName: string }>> | undefined,
) {
  const pairs = hands.map((hand, index) => ({
    hand,
    side: handedness?.[index]?.[0]?.categoryName?.toLowerCase() ?? "",
  }));

  const rightHand = pairs.find((pair) => pair.side === "right")?.hand;
  const leftHand = pairs.find((pair) => pair.side === "left")?.hand;

  return {
    rightHand: rightHand ?? getLargestHand(hands),
    leftHand: leftHand ?? (hands.length > 1 ? hands.find((hand) => hand !== rightHand) : undefined),
  };
}

export function getGripPoint(points: Landmark[]) {
  return averagePoint(FINGERTIP_INDICES.map((index) => points[index]));
}

function isFingerExtended(points: Landmark[], tipIndex: number, pipIndex: number) {
  return points[tipIndex].y < points[pipIndex].y;
}

export function isOpenPalm(points: Landmark[]) {
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

export function isHandClustered(points: Landmark[]) {
  const scale = getHandScale(points);
  const centroid = getGripPoint(points);
  const spread =
    FINGERTIP_INDICES.reduce((sum, index) => sum + distance(points[index], centroid), 0) /
    (FINGERTIP_INDICES.length * scale);

  return spread < CLUSTER_THRESHOLD;
}

export function detectBackSwipe(trail: TrailPoint[], viewport: Viewport) {
  if (trail.length < 3) {
    return false;
  }

  const start = trail[0];
  const end = trail[trail.length - 1];
  const duration = end.time - start.time;

  return (
    duration <= SWIPE_WINDOW_MS &&
    start.y < viewport.height * 0.22 &&
    end.y > viewport.height * 0.72 &&
    start.x > viewport.width * 0.56 &&
    end.x < viewport.width * 0.5
  );
}
