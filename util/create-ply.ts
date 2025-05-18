import { KSplatLoader } from "../src/loaders/ksplat/KSplatLoader.js";
import { PlayCanvasCompressedPlyEncoder } from "../src/loaders/ply/PlayCanvasCompressedPlyEncoder.js";
import { SplatBuffer } from "../src/loaders/SplatBuffer.js";
import fs from "fs";
import { delayedExecute } from "./node-util.js";

// Replace the original loadFromFileData method with our Node.js compatible one
// Casting to any to avoid type errors while still maintaining the proper implementation
(KSplatLoader as any).loadFromFileData = function (
  fileData: ArrayBuffer
): Promise<SplatBuffer> {
  return delayedExecute(() => {
    KSplatLoader.checkVersion(fileData);
    return new SplatBuffer(fileData);
  }) as Promise<SplatBuffer>;
};

async function encode(fileData: Buffer): Promise<ArrayBuffer> {
  const splatBuffer = await (KSplatLoader as any).loadFromFileData(
    fileData.buffer
  );
  const plyBuffer =
    PlayCanvasCompressedPlyEncoder.encodeToCompressedPly(splatBuffer);

  return plyBuffer;
}

const fileData = fs.readFileSync("./input.ksplat");
encode(fileData)
  .then((plyBuffer) => {
    // Convert ArrayBuffer to Buffer
    const buffer = Buffer.from(plyBuffer);
    fs.writeFileSync("output.ply", buffer);
    console.log("Done");
  })
  .catch((error) => {
    console.error("Error:", error);
  });
