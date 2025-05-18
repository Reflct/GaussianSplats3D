import { SceneFormat } from "./SceneFormat";

export const sceneFormatFromPath = (path: string): number | null => {
  if (path.endsWith(".ply")) return SceneFormat.Ply;
  else if (path.endsWith(".splat")) return SceneFormat.Splat;
  else if (path.endsWith(".ksplat")) return SceneFormat.KSplat;
  else if (path.endsWith(".spz")) return SceneFormat.Spz;
  return null;
};
