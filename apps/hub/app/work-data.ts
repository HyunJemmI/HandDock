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
    slug: "solar-orrery",
    name: "Solar Orrery",
    description:
      "A gesture-controlled solar system atlas with orbital motion, planetary zoom, and procedural atmospherics.",
    status: "In Progress",
    stack: ["Canvas", "MediaPipe", "Procedural FX"],
    year: "2026",
    interactionType: "Left pinch focus + right pinch drag",
    accentLabel: "Orbit",
    sceneAnchor: { x: -0.56, y: 0.08, z: 0.26 },
    cardOffset: { x: -10, y: 12 },
    priority: 4,
  },
  {
    slug: "nbv-robotics-lab",
    name: "NBV Robotics Lab",
    description:
      "A browser-scale simulation of sequential single-view semantic segmentation, information gain, and grasp-driven scene rearrangement under occlusion.",
    status: "Prototype",
    stack: ["Three.js", "MediaPipe", "Simulation"],
    year: "2026",
    interactionType: "Right pinch grasp + NBV simulation",
    accentLabel: "NBV",
    sceneAnchor: { x: 0.62, y: 0.14, z: 0.34 },
    cardOffset: { x: 14, y: -10 },
    priority: 5,
  },
];
