import { KSplatLoader } from "../src/loaders/ksplat/KSplatLoader.js";
import { PlayCanvasCompressedPlyEncoder } from "../src/loaders/ply/PlayCanvasCompressedPlyEncoder.js";
import { SplatBuffer } from "../src/loaders/SplatBuffer.js";
import fs from "fs";
import { delayedExecute } from "./node-util.js";

// Monkey patch the KSplatLoader to use our Node.js compatible delayedExecute
KSplatLoader.loadFromFileData = function (fileData) {
  return delayedExecute(() => {
    KSplatLoader.checkVersion(fileData);
    return new SplatBuffer(fileData);
  });
};

async function encode(fileData) {
  const splatBuffer = await KSplatLoader.loadFromFileData(fileData);
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
