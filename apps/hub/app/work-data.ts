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
      "Occlusion 환경에서 single-view semantic segmentation, information gain, 자동 NBV, 그리고 grasp planning을 시뮬레이션하는 브라우저 실험.",
    status: "Prototype",
    stack: ["Three.js", "MediaPipe", "Simulation"],
    year: "2026",
    interactionType: "Left pinch priority + right pinch grasp + speed drag",
    accentLabel: "NBV",
    sceneAnchor: { x: 0.62, y: 0.18, z: 0.34 },
    cardOffset: { x: 14, y: -10 },
    priority: 5,
  },
  {
    slug: "wall-cl",
    name: "WallCL",
    description:
      "코로나 시기 대회 제약, 3D 프린팅 경량화, 전자석 선택, 그리고 2-leg wall climbing gait까지 함께 풀어낸 벽 등반 로봇 시뮬레이터.",
    status: "Prototype",
    stack: ["SVG", "Kinematics", "Hardware Design"],
    year: "2026",
    interactionType: "Auto climb simulation + gesture exit",
    accentLabel: "Climb",
    sceneAnchor: { x: -0.26, y: -0.32, z: 0.44 },
    cardOffset: { x: -12, y: 6 },
    priority: 4,
  },
  {
    slug: "smol",
    name: "SMoL",
    description:
      "빛 번짐 데이터 생성, contrastive alignment, domain adaptation, 그리고 glare-robust line detection을 함께 보여주는 학습 시각화 프로젝트.",
    status: "Prototype",
    stack: ["SVG", "Contrastive Learning", "Lane Detection"],
    year: "2026",
    interactionType: "Auto training narrative + gesture exit",
    accentLabel: "SMoL",
    sceneAnchor: { x: 0.12, y: -0.42, z: 0.18 },
    cardOffset: { x: 10, y: 12 },
    priority: 4,
  },
];
