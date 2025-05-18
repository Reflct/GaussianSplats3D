import * as THREE from "three";
import { fetchWithProgress, delayedExecute, clamp } from "../../Util";
import { SplatBuffer } from "../SplatBuffer";
import { SplatBufferGenerator } from "../SplatBufferGenerator";
import { LoaderStatus } from "../LoaderStatus";
import { UncompressedSplatArray } from "../UncompressedSplatArray";
import { decompressGzipped } from "../Compression";
import { AbortablePromise } from "../../AbortablePromise";

const SPZ_MAGIC = 1347635022;
const FLAG_ANTIALIASED = 1;
const COLOR_SCALE = 0.15;

/**
 * Convert 16-bit half-precision float to full precision float
 * @param h - Half-precision float value
 * @returns Full precision float value
 */
function halfToFloat(h: number): number {
  const sgn = (h >> 15) & 0x1;
  const exponent = (h >> 10) & 0x1f;
  const mantissa = h & 0x3ff;

  const signMul = sgn === 1 ? -1.0 : 1.0;
  if (exponent === 0) {
    return (signMul * Math.pow(2, -14) * mantissa) / 1024;
  }

  if (exponent === 31) {
    return mantissa !== 0 ? NaN : signMul * Infinity;
  }

  return signMul * Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
}

/**
 * Unquantize spherical harmonics coefficient
 * @param x - Quantized coefficient value
 * @returns Unquantized coefficient value
 */
function unquantizeSH(x: number): number {
  return (x - 128.0) / 128.0;
}

/**
 * Get dimensions for a given spherical harmonics degree
 * @param degree - Spherical harmonics degree
 * @returns Number of coefficients per dimension
 */
function dimForDegree(degree: number): number {
  switch (degree) {
    case 0:
      return 0;
    case 1:
      return 3;
    case 2:
      return 8;
    case 3:
      return 15;
    default:
      console.error(`[SPZ: ERROR] Unsupported SH degree: ${degree}`);
      return 0;
  }
}

/**
 * Interface for unpacked splat
 */
interface UnpackedSplat {
  position: number[];
  scale: number[];
  rotation: number[];
  alpha?: number;
  color: number[];
  sh: number[];
}

/**
 * Interface for packed gaussians data
 */
interface PackedGaussians {
  numPoints: number;
  shDegree: number;
  fractionalBits: number;
  antialiased: boolean;
  positions: Uint8Array;
  scales: Uint8Array;
  rotations: Uint8Array;
  alphas: Uint8Array;
  colors: Uint8Array;
  sh: Uint8Array;
}

/**
 * Interface for header data
 */
interface SpzHeader {
  magic: number;
  version: number;
  numPoints: number;
  shDegree: number;
  fractionalBits: number;
  flags: number;
  reserved: number;
}

/**
 * Convert unpacked splat to uncompressed splat
 */
const unpackedSplatToUncompressedSplat = (function () {
  const tempRotation = new THREE.Quaternion();

  const OFFSET_X = UncompressedSplatArray.OFFSET.X;
  const OFFSET_Y = UncompressedSplatArray.OFFSET.Y;
  const OFFSET_Z = UncompressedSplatArray.OFFSET.Z;

  const OFFSET_SCALE0 = UncompressedSplatArray.OFFSET.SCALE0;
  const OFFSET_SCALE1 = UncompressedSplatArray.OFFSET.SCALE1;
  const OFFSET_SCALE2 = UncompressedSplatArray.OFFSET.SCALE2;

  const OFFSET_ROTATION0 = UncompressedSplatArray.OFFSET.ROTATION0;
  const OFFSET_ROTATION1 = UncompressedSplatArray.OFFSET.ROTATION1;
  const OFFSET_ROTATION2 = UncompressedSplatArray.OFFSET.ROTATION2;
  const OFFSET_ROTATION3 = UncompressedSplatArray.OFFSET.ROTATION3;

  const OFFSET_FDC0 = UncompressedSplatArray.OFFSET.FDC0;
  const OFFSET_FDC1 = UncompressedSplatArray.OFFSET.FDC1;
  const OFFSET_FDC2 = UncompressedSplatArray.OFFSET.FDC2;
  const OFFSET_OPACITY = UncompressedSplatArray.OFFSET.OPACITY;

  const OFFSET_FRC: number[] = [];

  for (let i = 0; i < 45; i++) {
    OFFSET_FRC[i] = UncompressedSplatArray.OFFSET.FRC0 + i;
  }

  const shCoeffMap = [
    dimForDegree(0),
    dimForDegree(1),
    dimForDegree(2),
    dimForDegree(3),
  ];

  const shIndexMap = [
    0, 1, 2, 9, 10, 11, 12, 13, 24, 25, 26, 27, 28, 29, 30, 3, 4, 5, 14, 15, 16,
    17, 18, 31, 32, 33, 34, 35, 36, 37, 6, 7, 8, 19, 20, 21, 22, 23, 38, 39, 40,
    41, 42, 43, 44,
  ];

  return function (
    unpackedSplat: UnpackedSplat,
    unpackedSphericalHarmonicsDegree: number,
    outSphericalHarmonicsDegree: number
  ): number[] {
    outSphericalHarmonicsDegree = Math.min(
      unpackedSphericalHarmonicsDegree,
      outSphericalHarmonicsDegree
    );

    const newSplat = UncompressedSplatArray.createSplat(
      outSphericalHarmonicsDegree
    );
    if (unpackedSplat.scale[0] !== undefined) {
      newSplat[OFFSET_SCALE0] = unpackedSplat.scale[0];
      newSplat[OFFSET_SCALE1] = unpackedSplat.scale[1];
      newSplat[OFFSET_SCALE2] = unpackedSplat.scale[2];
    } else {
      newSplat[OFFSET_SCALE0] = 0.01;
      newSplat[OFFSET_SCALE1] = 0.01;
      newSplat[OFFSET_SCALE2] = 0.01;
    }

    if (unpackedSplat.color[0] !== undefined) {
      newSplat[OFFSET_FDC0] = unpackedSplat.color[0];
      newSplat[OFFSET_FDC1] = unpackedSplat.color[1];
      newSplat[OFFSET_FDC2] = unpackedSplat.color[2];
    } else {
      newSplat[OFFSET_FDC0] = 0;
      newSplat[OFFSET_FDC1] = 0;
      newSplat[OFFSET_FDC2] = 0;
    }

    if (unpackedSplat.alpha !== undefined) {
      newSplat[OFFSET_OPACITY] = unpackedSplat.alpha;
    }

    newSplat[OFFSET_FDC0] = clamp(Math.floor(newSplat[OFFSET_FDC0]), 0, 255);
    newSplat[OFFSET_FDC1] = clamp(Math.floor(newSplat[OFFSET_FDC1]), 0, 255);
    newSplat[OFFSET_FDC2] = clamp(Math.floor(newSplat[OFFSET_FDC2]), 0, 255);
    newSplat[OFFSET_OPACITY] = clamp(
      Math.floor(newSplat[OFFSET_OPACITY]),
      0,
      255
    );

    let outSHCoeff = shCoeffMap[outSphericalHarmonicsDegree];
    let readSHCoeff = shCoeffMap[unpackedSphericalHarmonicsDegree];
    for (let j = 0; j < 3; ++j) {
      for (let k = 0; k < 15; ++k) {
        const outIndex = shIndexMap[j * 15 + k];
        if (k < outSHCoeff && k < readSHCoeff) {
          newSplat[UncompressedSplatArray.OFFSET.FRC0 + outIndex] =
            unpackedSplat.sh[j * readSHCoeff + k];
        }
      }
    }

    tempRotation.set(
      unpackedSplat.rotation[3],
      unpackedSplat.rotation[0],
      unpackedSplat.rotation[1],
      unpackedSplat.rotation[2]
    );
    tempRotation.normalize();

    newSplat[OFFSET_ROTATION0] = tempRotation.x;
    newSplat[OFFSET_ROTATION1] = tempRotation.y;
    newSplat[OFFSET_ROTATION2] = tempRotation.z;
    newSplat[OFFSET_ROTATION3] = tempRotation.w;

    newSplat[OFFSET_X] = unpackedSplat.position[0];
    newSplat[OFFSET_Y] = unpackedSplat.position[1];
    newSplat[OFFSET_Z] = unpackedSplat.position[2];

    return newSplat;
  };
})();

/**
 * Helper function to check sizes (matching C++ checkSizes function)
 * @param packed - Packed Gaussians data
 * @param numPoints - Number of points
 * @param shDim - Spherical harmonics dimension
 * @param usesFloat16 - Whether float16 is used
 * @returns Whether sizes are valid
 */
function checkSizes2(
  packed: PackedGaussians,
  numPoints: number,
  shDim: number,
  usesFloat16: boolean
): boolean {
  if (packed.positions.length !== numPoints * 3 * (usesFloat16 ? 2 : 3))
    return false;
  if (packed.scales.length !== numPoints * 3) return false;
  if (packed.rotations.length !== numPoints * 3) return false;
  if (packed.alphas.length !== numPoints) return false;
  if (packed.colors.length !== numPoints * 3) return false;
  if (packed.sh.length !== numPoints * shDim * 3) return false;
  return true;
}

/**
 * Unpack Gaussians from packed format to uncompressed format
 * @param packed - Packed Gaussians data
 * @param outSphericalHarmonicsDegree - Output spherical harmonics degree
 * @param directToSplatBuffer - Whether to write directly to splat buffer
 * @param outTarget - Output target (SplatBuffer or UncompressedSplatArray)
 * @param outTargetOffset - Offset in output target
 */
function unpackGaussians(
  packed: PackedGaussians,
  outSphericalHarmonicsDegree: number,
  directToSplatBuffer: boolean,
  outTarget: SplatBuffer | UncompressedSplatArray,
  outTargetOffset: number
): void {
  outSphericalHarmonicsDegree = Math.min(
    outSphericalHarmonicsDegree,
    packed.shDegree
  );
  const numPoints = packed.numPoints;
  const shDim = dimForDegree(packed.shDegree);
  const usesFloat16 = packed.positions.length === numPoints * 3 * 2;

  // Validate sizes
  if (!checkSizes2(packed, numPoints, shDim, usesFloat16)) {
    return;
  }

  const splat: UnpackedSplat = {
    position: [],
    scale: [],
    rotation: [],
    alpha: undefined,
    color: [],
    sh: [],
  };

  let halfData: Uint16Array | undefined;
  if (usesFloat16) {
    halfData = new Uint16Array(
      packed.positions.buffer,
      packed.positions.byteOffset,
      numPoints * 3
    );
  }
  const fullPrecisionPositionScale = 1.0 / (1 << packed.fractionalBits);
  const shCoeffPerChannelPerSplat = dimForDegree(packed.shDegree);
  const SH_C0 = 0.28209479177387814;

  for (let i = 0; i < numPoints; i++) {
    // Splat position
    if (usesFloat16 && halfData) {
      // Decode legacy float16 format
      for (let j = 0; j < 3; j++) {
        splat.position[j] = halfToFloat(halfData[i * 3 + j]);
      }
    } else {
      // Decode 24-bit fixed point coordinates
      for (let j = 0; j < 3; j++) {
        const base = i * 9 + j * 3;
        let fixed32 = packed.positions[base];
        fixed32 |= packed.positions[base + 1] << 8;
        fixed32 |= packed.positions[base + 2] << 16;
        fixed32 |= fixed32 & 0x800000 ? 0xff000000 : 0;
        splat.position[j] = fixed32 * fullPrecisionPositionScale;
      }
    }

    // Splat scale
    for (let j = 0; j < 3; j++) {
      splat.scale[j] = Math.exp(packed.scales[i * 3 + j] / 16.0 - 10.0);
    }

    // Splat rotation
    const r = packed.rotations.subarray(i * 3, i * 3 + 3);
    const xyz = [r[0] / 127.5 - 1.0, r[1] / 127.5 - 1.0, r[2] / 127.5 - 1.0];
    splat.rotation[0] = xyz[0];
    splat.rotation[1] = xyz[1];
    splat.rotation[2] = xyz[2];
    const squaredNorm = xyz[0] * xyz[0] + xyz[1] * xyz[1] + xyz[2] * xyz[2];
    splat.rotation[3] = Math.sqrt(Math.max(0.0, 1.0 - squaredNorm));

    // Splat alpha
    splat.alpha = Math.floor(packed.alphas[i]);

    // Splat color
    for (let j = 0; j < 3; j++) {
      splat.color[j] = Math.floor(
        (((packed.colors[i * 3 + j] / 255.0 - 0.5) / COLOR_SCALE) * SH_C0 +
          0.5) *
          255
      );
    }

    // Splat spherical harmonics
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < shCoeffPerChannelPerSplat; k++) {
        splat.sh[j * shCoeffPerChannelPerSplat + k] = unquantizeSH(
          packed.sh[shCoeffPerChannelPerSplat * 3 * i + k * 3 + j]
        );
      }
    }

    const uncompressedSplat = unpackedSplatToUncompressedSplat(
      splat,
      packed.shDegree,
      outSphericalHarmonicsDegree
    );
    if (directToSplatBuffer) {
      const outBytesPerSplat =
        SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[
          outSphericalHarmonicsDegree
        ].BytesPerSplat;
      const outBase = i * outBytesPerSplat + outTargetOffset;
      SplatBuffer.writeSplatDataToSectionBuffer(
        uncompressedSplat,
        (outTarget as SplatBuffer).bufferData,
        outBase,
        0,
        outSphericalHarmonicsDegree
      );
    } else {
      (outTarget as UncompressedSplatArray).addSplat(uncompressedSplat);
    }
  }
}

const HEADER_SIZE = 16; // 4 + 4 + 4 + 1 + 1 + 1 + 1 bytes
const MAX_POINTS_TO_READ = 10000000;

/**
 * Deserialize packed Gaussians from buffer
 * @param buffer - Buffer containing packed Gaussians
 * @returns Packed Gaussians data
 */
function deserializePackedGaussians(
  buffer: ArrayBuffer
): PackedGaussians | null {
  const view = new DataView(buffer);
  let offset = 0;

  // Read and validate header
  const header: SpzHeader = {
    magic: view.getUint32(offset, true),
    version: view.getUint32(offset + 4, true),
    numPoints: view.getUint32(offset + 8, true),
    shDegree: view.getUint8(offset + 12),
    fractionalBits: view.getUint8(offset + 13),
    flags: view.getUint8(offset + 14),
    reserved: view.getUint8(offset + 15),
  };

  offset += HEADER_SIZE;

  // Validate header
  if (header.magic !== SPZ_MAGIC) {
    console.error("[SPZ ERROR] deserializePackedGaussians: header not found");
    return null;
  }
  if (header.version < 1 || header.version > 2) {
    console.error(
      `[SPZ ERROR] deserializePackedGaussians: version not supported: ${header.version}`
    );
    return null;
  }
  if (header.numPoints > MAX_POINTS_TO_READ) {
    console.error(
      `[SPZ ERROR] deserializePackedGaussians: Too many points: ${header.numPoints}`
    );
    return null;
  }
  if (header.shDegree > 3) {
    console.error(
      `[SPZ ERROR] deserializePackedGaussians: Unsupported SH degree: ${header.shDegree}`
    );
    return null;
  }

  const numPoints = header.numPoints;
  const shDim = dimForDegree(header.shDegree);
  const usesFloat16 = header.version === 1;

  // Initialize result object
  const result: PackedGaussians = {
    numPoints,
    shDegree: header.shDegree,
    fractionalBits: header.fractionalBits,
    antialiased: (header.flags & FLAG_ANTIALIASED) !== 0,
    positions: new Uint8Array(numPoints * 3 * (usesFloat16 ? 2 : 3)),
    scales: new Uint8Array(numPoints * 3),
    rotations: new Uint8Array(numPoints * 3),
    alphas: new Uint8Array(numPoints),
    colors: new Uint8Array(numPoints * 3),
    sh: new Uint8Array(numPoints * shDim * 3),
  };

  // Read data sections
  try {
    const uint8View = new Uint8Array(buffer);
    let positionsSize = result.positions.length;
    let currentOffset = offset;

    result.positions.set(
      uint8View.slice(currentOffset, currentOffset + positionsSize)
    );
    currentOffset += positionsSize;

    result.alphas.set(
      uint8View.slice(currentOffset, currentOffset + result.alphas.length)
    );
    currentOffset += result.alphas.length;

    result.colors.set(
      uint8View.slice(currentOffset, currentOffset + result.colors.length)
    );
    currentOffset += result.colors.length;

    result.scales.set(
      uint8View.slice(currentOffset, currentOffset + result.scales.length)
    );
    currentOffset += result.scales.length;

    result.rotations.set(
      uint8View.slice(currentOffset, currentOffset + result.rotations.length)
    );
    currentOffset += result.rotations.length;

    result.sh.set(
      uint8View.slice(currentOffset, currentOffset + result.sh.length)
    );

    // Verify we read the expected amount of data
    if (currentOffset + result.sh.length !== buffer.byteLength) {
      console.error(
        "[SPZ ERROR] deserializePackedGaussians: incorrect buffer size"
      );
      return null;
    }
  } catch (error) {
    console.error("[SPZ ERROR] deserializePackedGaussians: read error", error);
    return null;
  }

  return result;
}

/**
 * Load SPZ from packed data
 * @param compressedData - Compressed data
 * @returns Packed Gaussians data
 */
async function loadSpzPacked(
  compressedData: ArrayBuffer
): Promise<PackedGaussians | null> {
  try {
    // Convert ArrayBuffer to Uint8Array for decompression
    const compressedUint8 = new Uint8Array(compressedData);
    const decompressed = await decompressGzipped(compressedUint8);
    if (decompressed && decompressed.buffer) {
      return deserializePackedGaussians(decompressed.buffer as ArrayBuffer);
    }
    return null;
  } catch (error) {
    console.error("[SPZ ERROR] loadSpzPacked: decompression error", error);
    return null;
  }
}

/**
 * Loader for SPZ files
 */
export class SpzLoader {
  /**
   * Load SPZ file from URL
   * @param fileName - URL of the SPZ file
   * @param onProgress - Progress callback
   * @param minimumAlpha - Minimum alpha value for splats
   * @param compressionLevel - Compression level
   * @param optimizeSplatData - Whether to optimize the splat data
   * @param outSphericalHarmonicsDegree - Output spherical harmonics degree
   * @param headers - HTTP headers for the request
   * @param sectionSize - Section size for optimization
   * @param sceneCenter - Center of the scene
   * @param blockSize - Block size for optimization
   * @param bucketSize - Bucket size for optimization
   * @returns Promise that resolves to the loaded splat buffer
   */
  static loadFromURL(
    fileName: string,
    onProgress?: (
      percent: number,
      percentStr: string,
      status: LoaderStatus
    ) => void,
    minimumAlpha?: number,
    compressionLevel?: number,
    optimizeSplatData: boolean = true,
    outSphericalHarmonicsDegree: number = 0,
    headers?: Record<string, string>,
    sectionSize?: number,
    sceneCenter?: THREE.Vector3,
    blockSize?: number,
    bucketSize?: number
  ): AbortablePromise<SplatBuffer | undefined> {
    const progressWrapper = onProgress
      ? (
          percent: number,
          label: string,
          chunk?: Uint8Array<ArrayBuffer>,
          fileSize?: number
        ) => {
          onProgress(percent, label, LoaderStatus.Downloading);
        }
      : undefined;

    if (onProgress) onProgress(0, "0%", LoaderStatus.Downloading);
    return fetchWithProgress(fileName, progressWrapper, true, headers).then(
      (fileData) => {
        if (fileData && onProgress)
          onProgress(0, "0%", LoaderStatus.Processing);
        if (!fileData) return undefined;
        return SpzLoader.loadFromFileData(
          fileData,
          minimumAlpha!,
          compressionLevel!,
          optimizeSplatData,
          outSphericalHarmonicsDegree,
          sectionSize,
          sceneCenter,
          blockSize,
          bucketSize
        );
      }
    );
  }

  /**
   * Load SPZ file from file data
   * @param spzFileData - The SPZ file data as an ArrayBuffer
   * @param minimumAlpha - Minimum alpha value for splats
   * @param compressionLevel - Compression level
   * @param optimizeSplatData - Whether to optimize the splat data
   * @param outSphericalHarmonicsDegree - Output spherical harmonics degree
   * @param sectionSize - Section size for optimization
   * @param sceneCenter - Center of the scene
   * @param blockSize - Block size for optimization
   * @param bucketSize - Bucket size for optimization
   * @returns Promise that resolves to the loaded splat buffer
   */
  static async loadFromFileData(
    spzFileData: ArrayBuffer,
    minimumAlpha: number,
    compressionLevel: number,
    optimizeSplatData: boolean,
    outSphericalHarmonicsDegree: number = 0,
    sectionSize?: number,
    sceneCenter?: THREE.Vector3,
    blockSize?: number,
    bucketSize?: number
  ): Promise<SplatBuffer | undefined> {
    await delayedExecute();
    const packed = await loadSpzPacked(spzFileData);

    if (!packed) return undefined;

    outSphericalHarmonicsDegree = Math.min(
      packed.shDegree,
      outSphericalHarmonicsDegree
    );

    const splatArray = new UncompressedSplatArray(outSphericalHarmonicsDegree);

    if (optimizeSplatData) {
      unpackGaussians(
        packed,
        outSphericalHarmonicsDegree,
        false,
        splatArray,
        0
      );
      const splatBufferGenerator = SplatBufferGenerator.getStandardGenerator(
        minimumAlpha,
        compressionLevel,
        sectionSize,
        sceneCenter,
        blockSize,
        bucketSize
      );
      return splatBufferGenerator.generateFromUncompressedSplatArray(
        splatArray
      );
    } else {
      const { splatBuffer, splatBufferDataOffsetBytes } =
        SplatBuffer.preallocateUncompressed(
          packed.numPoints,
          outSphericalHarmonicsDegree
        );
      unpackGaussians(
        packed,
        outSphericalHarmonicsDegree,
        true,
        splatBuffer,
        splatBufferDataOffsetBytes
      );
      return splatBuffer;
    }
  }
}
