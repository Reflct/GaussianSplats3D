import * as GaussianSplats3D from "../build/gaussian-splats-3d.module.js";
import * as THREE from "three";
import * as fs from "fs";

if (process.argv.length < 4) {
  console.log("Expected at least 2 arguments!");
  console.log(
    'Usage: node create-ksplat.js [path to .PLY or .SPLAT] [output file name] [compression level = 0] [alpha removal threshold = 1] [scene center = "0,0,0"] [block size = 5.0] [bucket size = 256] [spherical harmonics level = 0]'
  );
  process.exit(1);
}

const intputFile = process.argv[2];
const outputFile = process.argv[3];
const compressionLevel =
  process.argv.length >= 5 ? parseInt(process.argv[4]) || 0 : undefined;
const splatAlphaRemovalThreshold =
  process.argv.length >= 6 ? parseInt(process.argv[5]) || 1 : undefined;
const sceneCenter =
  process.argv.length >= 7
    ? new THREE.Vector3().fromArray(
        (process.argv[6] || "0,0,0").split(",").map((s) => Number(s) || 0)
      )
    : undefined;
const blockSize =
  process.argv.length >= 8 ? parseFloat(process.argv[7]) || 5.0 : undefined;
const bucketSize =
  process.argv.length >= 9 ? parseInt(process.argv[8]) || 256 : undefined;
const outSphericalHarmonicsDegree =
  process.argv.length >= 10 ? parseInt(process.argv[9]) || 0 : 0;
const sectionSize = 0;

const fileData = fs.readFileSync(intputFile);
const path = intputFile.toLowerCase().trim();
const format = GaussianSplats3D.LoaderUtils.sceneFormatFromPath(path);
// Cast ArrayBufferLike to ArrayBuffer since we know it's compatible in this context
const splatBuffer = fileBufferToSplatBuffer(
  fileData.buffer as ArrayBuffer,
  format || 0,
  compressionLevel,
  splatAlphaRemovalThreshold
);

fs.writeFileSync(outputFile, Buffer.from(splatBuffer.bufferData));

function fileBufferToSplatBuffer(
  fileBufferData: ArrayBuffer,
  format: number, // Use number instead of enum type
  compressionLevel?: number,
  alphaRemovalThreshold?: number
): GaussianSplats3D.SplatBuffer {
  let splatBuffer: GaussianSplats3D.SplatBuffer;
  // Use numeric comparison instead of enum
  const PLY_FORMAT = 0; // Assuming this is the value for Ply
  const SPLAT_FORMAT = 1; // Assuming this is the value for Splat

  if (format === PLY_FORMAT || format === SPLAT_FORMAT) {
    let splatArray: any;
    if (format === PLY_FORMAT) {
      // @ts-ignore - parseInt result should be a valid number here
      splatArray = GaussianSplats3D.PlyParser.parseToUncompressedSplatArray(
        fileBufferData,
        outSphericalHarmonicsDegree
      );
    } else {
      splatArray =
        GaussianSplats3D.SplatParser.parseStandardSplatToUncompressedSplatArray(
          fileBufferData
        );
    }
    const splatBufferGenerator =
      GaussianSplats3D.SplatBufferGenerator.getStandardGenerator(
        alphaRemovalThreshold,
        compressionLevel,
        sectionSize,
        sceneCenter,
        blockSize,
        bucketSize
      );
    splatBuffer =
      splatBufferGenerator.generateFromUncompressedSplatArray(splatArray);
  } else {
    splatBuffer = new GaussianSplats3D.SplatBuffer(fileBufferData);
  }

  return splatBuffer;
}
