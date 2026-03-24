export type WorkItem = {
  slug: string;
  name: string;
  description: string;
  status: string;
  stack: string[];
  year: string;
  interactionType: string;
  accentLabel: string;
  sceneAnchor: {
    x: number;
    y: number;
    z: number;
  };
  cardOffset: {
    x: number;
    y: number;
  };
  priority: number;
};

export const works: WorkItem[] = [
  {
    slug: "gesture-atrium",
    name: "Gesture Atrium",
    description:
      "Hand-tracking entrance hall for testing cursorless navigation and spatial selection.",
    status: "Prototype",
    stack: ["Spline", "MediaPipe", "Next.js"],
    year: "2026",
    interactionType: "Index pointer + left-hand command",
    accentLabel: "Entry",
    sceneAnchor: { x: -0.92, y: -0.18, z: 0.42 },
    cardOffset: { x: -18, y: 4 },
    priority: 3,
  },
  {
    slug: "spline-remix-lab",
    name: "Spline Remix Lab",
    description:
      "Community Spline scenes imported and reworked into reusable interactive modules.",
    status: "Collecting",
    stack: ["Spline", "Scene remix", "Adapter layer"],
    year: "2026",
    interactionType: "Scene remix archive",
    accentLabel: "Remix",
    sceneAnchor: { x: 0.72, y: -0.3, z: 0.8 },
    cardOffset: { x: 14, y: -16 },
    priority: 2,
  },
  {
    slug: "camera-rituals",
    name: "Camera Rituals",
    description:
      "A static archive slot for future vibe-coded works driven by camera, posture, and gesture.",
    status: "Reserved",
    stack: ["Camera", "Gesture", "Archive"],
    year: "2027",
    interactionType: "Posture-driven archive",
    accentLabel: "Ritual",
    sceneAnchor: { x: 0.18, y: 0.88, z: -0.14 },
    cardOffset: { x: 10, y: -12 },
    priority: 1,
  },
  {
    slug: "solar-orrery",
    name: "Solar Orrery",
    description:
      "A gesture-controlled solar system atlas with orbital motion, planetary zoom, and procedural atmospherics.",
    status: "In Progress",
    stack: ["Canvas", "MediaPipe", "Procedural FX"],
    year: "2026",
    interactionType: "Left-hand zoom/click + right-hand drag",
    accentLabel: "Orbit",
    sceneAnchor: { x: 0.94, y: 0.1, z: 0.18 },
    cardOffset: { x: 18, y: 14 },
    priority: 4,
  },
];
