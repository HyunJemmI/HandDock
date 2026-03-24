import { BrainScene } from "./components/BrainScene";
import { HandDockHome } from "./components/HandDockHome";
import { RobotScene } from "./components/RobotScene";

export default function Home() {
  return <HandDockHome robotScene={<RobotScene />} brainScene={<BrainScene />} />;
}
