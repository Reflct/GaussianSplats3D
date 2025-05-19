import { SplatBuffer } from "../SplatBuffer";
import { UncompressedSplatArray } from "../UncompressedSplatArray";
import * as THREE from "three";
import { clamp } from "../../Util";
import { TypedArray, PlyElement } from "./PlyLoader";

// Helper functions for packing values
const pack111011 = (array: TypedArray, v: THREE.Vector3): void => {
  if (!array) return;
  const x = Math.round(v.x * 2047);
  const y = Math.round(v.y * 1023);
  const z = Math.round(v.z * 2047);
  array[0] = (x << 21) | (y << 11) | z;
};

const packRot = (array: TypedArray, q: THREE.Quaternion): void => {
  if (!array) return;
  const x = Math.round((q.x + 0.5) * 1023);
  const y = Math.round((q.y + 0.5) * 1023);
  const z = Math.round((q.z + 0.5) * 1023);
  const w = Math.round((q.w + 0.5) * 1023);
  array[0] = (w << 30) | (x << 20) | (y << 10) | z;
};

const pack8888 = (array: TypedArray, v: THREE.Vector4): void => {
  if (!array) return;
  const x = Math.round(v.x * 255);
  const y = Math.round(v.y * 255);
  const z = Math.round(v.z * 255);
  const w = Math.round(v.w * 255);
  array[0] = (x << 24) | (y << 16) | (z << 8) | w;
};

// Type definitions
interface PositionExtremes {
  minX: TypedArray;
  maxX: TypedArray;
  minY: TypedArray;
  maxY: TypedArray;
  minZ: TypedArray;
  maxZ: TypedArray;
}

interface ScaleExtremes {
  minScaleX: TypedArray;
  maxScaleX: TypedArray;
  minScaleY: TypedArray;
  maxScaleY: TypedArray;
  minScaleZ: TypedArray;
  maxScaleZ: TypedArray;
}

interface ColorExtremes {
  minR: TypedArray;
  maxR: TypedArray;
  minG: TypedArray;
  maxG: TypedArray;
  minB: TypedArray;
  maxB: TypedArray;
}

interface ElementStorageArrays {
  colorExtremes: {
    minR: TypedArray;
    maxR: TypedArray;
    minG: TypedArray;
    maxG: TypedArray;
    minB: TypedArray;
    maxB: TypedArray;
  };
  positionExtremes: {
    minX: TypedArray;
    maxX: TypedArray;
    minY: TypedArray;
    maxY: TypedArray;
    minZ: TypedArray;
    maxZ: TypedArray;
  };
  scaleExtremes: {
    minScaleX: TypedArray;
    maxScaleX: TypedArray;
    minScaleY: TypedArray;
    maxScaleY: TypedArray;
    minScaleZ: TypedArray;
    maxScaleZ: TypedArray;
  };
  position: TypedArray;
  rotation: TypedArray;
  scale: TypedArray;
  color: TypedArray;
  sh?: {
    [key: string]: TypedArray;
  };
}

export class PlayCanvasCompressedPlyEncoder {
  static encodeToCompressedPly(
    splatBuffer: SplatBuffer,
    comments?: string[]
  ): ArrayBuffer {
    // Get splat count and spherical harmonics degree from the buffer
    const { splatCount, sphericalHarmonicsDegree } =
      this.extractFromUncompressedBuffer(splatBuffer);

    // Get compression level from the buffer
    const compressionLevel = splatBuffer.compressionLevel || 0;

    // Create storage arrays for the PLY data
    const chunkCount = Math.ceil(splatCount / 256);
    const storageArrays: ElementStorageArrays = {
      colorExtremes: {
        minR: new Float32Array(chunkCount),
        maxR: new Float32Array(chunkCount),
        minG: new Float32Array(chunkCount),
        maxG: new Float32Array(chunkCount),
        minB: new Float32Array(chunkCount),
        maxB: new Float32Array(chunkCount),
      },
      positionExtremes: {
        minX: new Float32Array(chunkCount),
        maxX: new Float32Array(chunkCount),
        minY: new Float32Array(chunkCount),
        maxY: new Float32Array(chunkCount),
        minZ: new Float32Array(chunkCount),
        maxZ: new Float32Array(chunkCount),
      },
      scaleExtremes: {
        minScaleX: new Float32Array(chunkCount),
        maxScaleX: new Float32Array(chunkCount),
        minScaleY: new Float32Array(chunkCount),
        maxScaleY: new Float32Array(chunkCount),
        minScaleZ: new Float32Array(chunkCount),
        maxScaleZ: new Float32Array(chunkCount),
      },
      position: new Uint32Array(splatCount),
      rotation: new Uint32Array(splatCount),
      scale: new Uint32Array(splatCount),
      color: new Uint32Array(splatCount),
      sh: {},
    };

    // Initialize spherical harmonics arrays if needed
    if (sphericalHarmonicsDegree > 0) {
      const shCount = getSphericalHarmonicsComponentCountForDegree(
        sphericalHarmonicsDegree
      );
      const shArrayType =
        compressionLevel === 1
          ? Uint16Array
          : compressionLevel === 2
          ? Uint8Array
          : Float32Array;

      for (let i = 0; i < shCount; i++) {
        storageArrays.sh![`f_rest_${i}`] = new shArrayType(splatCount);
      }
    }

    // Calculate bytes per splat
    const bytesPerSplat =
      SplatBuffer.CompressionLevels[compressionLevel].SphericalHarmonicsDegrees[
        sphericalHarmonicsDegree
      ].BytesPerSplat;
    const dataOffset =
      SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes;

    // Process each splat
    const tempSplat = UncompressedSplatArray.createSplat(
      sphericalHarmonicsDegree
    );
    for (let i = 0; i < splatCount; i++) {
      // Read splat data from buffer
      const baseOffset = i * bytesPerSplat + dataOffset;
      const dataView = new DataView(splatBuffer.bufferData, baseOffset);

      // Read position
      tempSplat[UncompressedSplatArray.OFFSET.X] = dataView.getFloat32(0, true);
      tempSplat[UncompressedSplatArray.OFFSET.Y] = dataView.getFloat32(4, true);
      tempSplat[UncompressedSplatArray.OFFSET.Z] = dataView.getFloat32(8, true);

      // Read scale
      tempSplat[UncompressedSplatArray.OFFSET.SCALE0] = dataView.getFloat32(
        12,
        true
      );
      tempSplat[UncompressedSplatArray.OFFSET.SCALE1] = dataView.getFloat32(
        16,
        true
      );
      tempSplat[UncompressedSplatArray.OFFSET.SCALE2] = dataView.getFloat32(
        20,
        true
      );

      // Read rotation
      tempSplat[UncompressedSplatArray.OFFSET.ROTATION0] = dataView.getFloat32(
        24,
        true
      );
      tempSplat[UncompressedSplatArray.OFFSET.ROTATION1] = dataView.getFloat32(
        28,
        true
      );
      tempSplat[UncompressedSplatArray.OFFSET.ROTATION2] = dataView.getFloat32(
        32,
        true
      );
      tempSplat[UncompressedSplatArray.OFFSET.ROTATION3] = dataView.getFloat32(
        36,
        true
      );

      // Read color
      tempSplat[UncompressedSplatArray.OFFSET.FDC0] = dataView.getFloat32(
        40,
        true
      );
      tempSplat[UncompressedSplatArray.OFFSET.FDC1] = dataView.getFloat32(
        44,
        true
      );
      tempSplat[UncompressedSplatArray.OFFSET.FDC2] = dataView.getFloat32(
        48,
        true
      );
      tempSplat[UncompressedSplatArray.OFFSET.OPACITY] = dataView.getFloat32(
        52,
        true
      );

      // Read spherical harmonics if present
      if (sphericalHarmonicsDegree > 0) {
        const shOffset =
          SplatBuffer.CompressionLevels[compressionLevel]
            .SphericalHarmonicsOffsetBytes;
        const shCount = getSphericalHarmonicsComponentCountForDegree(
          sphericalHarmonicsDegree
        );
        const bytesPerComponent =
          SplatBuffer.CompressionLevels[compressionLevel]
            .BytesPerSphericalHarmonicsComponent;

        for (let j = 0; j < shCount; j++) {
          let value: number;
          if (compressionLevel === 0) {
            value = dataView.getFloat32(shOffset + j * 4, true);
          } else if (compressionLevel === 1) {
            value = THREE.DataUtils.fromHalfFloat(
              dataView.getUint16(shOffset + j * 2, true)
            );
          } else {
            value = (dataView.getUint8(shOffset + j) / 255) * 8 - 4;
          }
          tempSplat[UncompressedSplatArray.OFFSET.FRC0 + j] = value;
        }
      }

      // Compress the splat data
      this.compressBaseSplat(
        tempSplat,
        i,
        storageArrays.position,
        storageArrays.positionExtremes,
        storageArrays.scale,
        storageArrays.scaleExtremes,
        storageArrays.rotation,
        storageArrays.colorExtremes,
        storageArrays.color
      );

      // Compress spherical harmonics if present
      if (sphericalHarmonicsDegree > 0 && storageArrays.sh) {
        this.compressSphericalHarmonics(
          i,
          Object.values(storageArrays.sh),
          sphericalHarmonicsDegree,
          sphericalHarmonicsDegree,
          tempSplat
        );
      }
    }

    // Create PLY elements from storage arrays
    const elements = this.createElementDataFromStorageArrays(
      storageArrays,
      splatCount,
      sphericalHarmonicsDegree
    );

    // Create the final PLY buffer
    const headerSize = this.calculatePlyHeaderSize(elements, comments);
    const dataSize = this.calculatePlyDataSize(elements);
    const totalSize = headerSize + dataSize;
    const plyBuffer = new ArrayBuffer(totalSize);

    // Write PLY header
    this.writePlyHeader(
      plyBuffer,
      elements,
      splatCount,
      sphericalHarmonicsDegree,
      comments
    );

    // Write PLY data
    this.writePlyData(plyBuffer, elements, headerSize);

    return plyBuffer;
  }

  private static calculatePlyHeaderSize(
    elements: {
      chunkElement?: PlyElement;
      vertexElement?: PlyElement;
      shElement?: PlyElement;
    },
    comments?: string[]
  ): number {
    let size = 0;
    size += "ply\n".length;
    // Add comment lines if present
    if (comments && comments.length > 0) {
      for (const comment of comments) {
        size += `comment ${comment}\n`.length;
      }
    }
    size += "format binary_little_endian 1.0\n".length;

    if (elements.chunkElement) {
      size += `element chunk ${elements.chunkElement.count}\n`.length;
      elements.chunkElement.properties.forEach((prop) => {
        size += `property ${prop.type} ${prop.name}\n`.length;
      });
    }

    if (elements.vertexElement) {
      size += `element vertex ${elements.vertexElement.count}\n`.length;
      elements.vertexElement.properties.forEach((prop) => {
        size += `property ${prop.type} ${prop.name}\n`.length;
      });
    }

    if (elements.shElement) {
      size += `element sh ${elements.shElement.count}\n`.length;
      elements.shElement.properties.forEach((prop) => {
        size += `property ${prop.type} ${prop.name}\n`.length;
      });
    }

    size += "end_header\n".length;
    return size;
  }

  private static calculatePlyDataSize(elements: {
    chunkElement?: PlyElement;
    vertexElement?: PlyElement;
    shElement?: PlyElement;
  }): number {
    let size = 0;
    if (elements.chunkElement) {
      size += elements.chunkElement.storageSizeBytes;
    }
    if (elements.vertexElement) {
      size += elements.vertexElement.storageSizeBytes;
    }
    if (elements.shElement) {
      size += elements.shElement.storageSizeBytes;
    }
    return size;
  }

  private static writePlyHeader(
    buffer: ArrayBuffer,
    elements: {
      chunkElement?: PlyElement;
      vertexElement?: PlyElement;
      shElement?: PlyElement;
    },
    splatCount: number,
    sphericalHarmonicsDegree: number,
    comments?: string[]
  ): void {
    const encoder = new TextEncoder();
    let offset = 0;

    // Write PLY magic bytes
    const header = new Uint8Array(buffer, offset, 4);
    const result = encoder.encodeInto("ply\n", header);
    if (result.written !== 4) {
      throw new Error("Failed to write PLY magic bytes");
    }
    offset += 4;

    // Write comments if provided
    if (comments && comments.length > 0) {
      for (const comment of comments) {
        const commentLine = `comment ${comment}\n`;
        const commentHeader = new Uint8Array(
          buffer,
          offset,
          commentLine.length
        );
        const commentResult = encoder.encodeInto(commentLine, commentHeader);
        if (commentResult.written !== commentLine.length) {
          throw new Error("Failed to write comment line");
        }
        offset += commentLine.length;
      }
    }

    // Write format line
    const formatLine = "format binary_little_endian 1.0\n";
    const formatHeader = new Uint8Array(buffer, offset, formatLine.length);
    const formatResult = encoder.encodeInto(formatLine, formatHeader);
    if (formatResult.written !== formatLine.length) {
      throw new Error("Failed to write PLY format");
    }
    offset += formatLine.length;

    // Write elements
    if (elements.chunkElement) {
      const chunkHeader = `element chunk ${elements.chunkElement.count}\n`;
      const chunkHeaderArray = new Uint8Array(
        buffer,
        offset,
        chunkHeader.length
      );
      const chunkResult = encoder.encodeInto(chunkHeader, chunkHeaderArray);
      if (chunkResult.written !== chunkHeader.length) {
        throw new Error("Failed to write chunk element header");
      }
      offset += chunkHeader.length;

      // Reorder properties to match original
      const orderedProps = elements.chunkElement.properties.sort((a, b) => {
        const order = [
          "min_x",
          "min_y",
          "min_z",
          "max_x",
          "max_y",
          "max_z",
          "min_scale_x",
          "min_scale_y",
          "min_scale_z",
          "max_scale_x",
          "max_scale_y",
          "max_scale_z",
          "min_r",
          "min_g",
          "min_b",
          "max_r",
          "max_g",
          "max_b",
        ];
        return order.indexOf(a.name) - order.indexOf(b.name);
      });
      orderedProps.forEach((prop) => {
        const propHeader = `property ${prop.type} ${prop.name}\n`;
        const propHeaderArray = new Uint8Array(
          buffer,
          offset,
          propHeader.length
        );
        const propResult = encoder.encodeInto(propHeader, propHeaderArray);
        if (propResult.written !== propHeader.length) {
          throw new Error(`Failed to write property header: ${prop.name}`);
        }
        offset += propHeader.length;
      });
    }
    if (elements.vertexElement) {
      const vertexHeader = `element vertex ${elements.vertexElement.count}\n`;
      const vertexHeaderArray = new Uint8Array(
        buffer,
        offset,
        vertexHeader.length
      );
      const vertexResult = encoder.encodeInto(vertexHeader, vertexHeaderArray);
      if (vertexResult.written !== vertexHeader.length) {
        throw new Error("Failed to write vertex element header");
      }
      offset += vertexHeader.length;

      elements.vertexElement.properties.forEach((prop) => {
        const propHeader = `property ${prop.type} ${prop.name}\n`;
        const propHeaderArray = new Uint8Array(
          buffer,
          offset,
          propHeader.length
        );
        const propResult = encoder.encodeInto(propHeader, propHeaderArray);
        if (propResult.written !== propHeader.length) {
          throw new Error(`Failed to write property header: ${prop.name}`);
        }
        offset += propHeader.length;
      });
    }
    if (elements.shElement) {
      const shHeader = `element sh ${elements.shElement.count}\n`;
      const shHeaderArray = new Uint8Array(buffer, offset, shHeader.length);
      const shResult = encoder.encodeInto(shHeader, shHeaderArray);
      if (shResult.written !== shHeader.length) {
        throw new Error("Failed to write SH element header");
      }
      offset += shHeader.length;

      elements.shElement.properties.forEach((prop) => {
        const propHeader = `property ${prop.type} ${prop.name}\n`;
        const propHeaderArray = new Uint8Array(
          buffer,
          offset,
          propHeader.length
        );
        const propResult = encoder.encodeInto(propHeader, propHeaderArray);
        if (propResult.written !== propHeader.length) {
          throw new Error(`Failed to write property header: ${prop.name}`);
        }
        offset += propHeader.length;
      });
    }

    // Write end header
    const endHeader = new Uint8Array(buffer, offset, 11);
    const endResult = encoder.encodeInto("end_header\n", endHeader);
    if (endResult.written !== 11) {
      throw new Error("Failed to write end header");
    }
  }

  private static writePlyData(
    buffer: ArrayBuffer,
    elements: {
      chunkElement?: PlyElement;
      vertexElement?: PlyElement;
      shElement?: PlyElement;
    },
    headerSize: number
  ): void {
    let offset = headerSize;

    // Write chunk data
    if (elements.chunkElement) {
      elements.chunkElement.properties.forEach((prop) => {
        if (prop.storage) {
          const countToWrite = Math.min(
            prop.storage.length,
            elements.chunkElement!.count
          );
          const storageArray = new Uint8Array(
            prop.storage.buffer,
            prop.storage.byteOffset,
            countToWrite * prop.byteSize
          );
          const targetArray = new Uint8Array(
            buffer,
            offset,
            storageArray.length
          );
          targetArray.set(storageArray);
          offset += storageArray.length;
        }
      });
    }

    // Write vertex data
    if (elements.vertexElement) {
      elements.vertexElement.properties.forEach((prop) => {
        if (prop.storage) {
          const countToWrite = Math.min(
            prop.storage.length,
            elements.vertexElement!.count
          );
          const storageArray = new Uint8Array(
            prop.storage.buffer,
            prop.storage.byteOffset,
            countToWrite * prop.byteSize
          );
          const targetArray = new Uint8Array(
            buffer,
            offset,
            storageArray.length
          );
          targetArray.set(storageArray);
          offset += storageArray.length;
        }
      });
    }

    // Write spherical harmonics data
    if (elements.shElement) {
      elements.shElement.properties.forEach((prop) => {
        if (prop.storage) {
          const countToWrite = Math.min(
            prop.storage.length,
            elements.shElement!.count
          );
          const storageArray = new Uint8Array(
            prop.storage.buffer,
            prop.storage.byteOffset,
            countToWrite * prop.byteSize
          );
          const targetArray = new Uint8Array(
            buffer,
            offset,
            storageArray.length
          );
          targetArray.set(storageArray);
          offset += storageArray.length;
        }
      });
    }
  }

  static readSplatDataFromSectionBuffer(
    sectionBuffer: ArrayBuffer,
    bufferOffset: number,
    compressionLevel: number,
    sphericalHarmonicsDegree: number,
    bucketCenter?: THREE.Vector3,
    compressionScaleFactor?: number,
    compressionScaleRange?: number,
    minSphericalHarmonicsCoeff?: number,
    maxSphericalHarmonicsCoeff?: number
  ): number[] {
    const {
      X: OFFSET_X,
      Y: OFFSET_Y,
      Z: OFFSET_Z,
      SCALE0: OFFSET_SCALE0,
      SCALE1: OFFSET_SCALE1,
      SCALE2: OFFSET_SCALE2,
      ROTATION0: OFFSET_ROT0,
      ROTATION1: OFFSET_ROT1,
      ROTATION2: OFFSET_ROT2,
      ROTATION3: OFFSET_ROT3,
      FDC0: OFFSET_FDC0,
      FDC1: OFFSET_FDC1,
      FDC2: OFFSET_FDC2,
      OPACITY: OFFSET_OPACITY,
      FRC0: OFFSET_FRC0,
    } = UncompressedSplatArray.OFFSET;

    const outSplat = UncompressedSplatArray.createSplat(
      sphericalHarmonicsDegree
    );
    const dataView = new DataView(sectionBuffer, bufferOffset);

    // Read position
    let x = dataView.getFloat32(0, true);
    let y = dataView.getFloat32(4, true);
    let z = dataView.getFloat32(8, true);

    // If compression level >= 1, decompress position relative to bucket center
    if (
      compressionLevel >= 1 &&
      bucketCenter &&
      compressionScaleFactor &&
      compressionScaleRange
    ) {
      x = (x - compressionScaleRange) / compressionScaleFactor + bucketCenter.x;
      y = (y - compressionScaleRange) / compressionScaleFactor + bucketCenter.y;
      z = (z - compressionScaleRange) / compressionScaleFactor + bucketCenter.z;
    }

    outSplat[OFFSET_X] = x;
    outSplat[OFFSET_Y] = y;
    outSplat[OFFSET_Z] = z;

    // Read scale
    const scaleX = dataView.getFloat32(12, true);
    const scaleY = dataView.getFloat32(16, true);
    const scaleZ = dataView.getFloat32(20, true);
    outSplat[OFFSET_SCALE0] = Math.exp(scaleX);
    outSplat[OFFSET_SCALE1] = Math.exp(scaleY);
    outSplat[OFFSET_SCALE2] = Math.exp(scaleZ);

    // Read rotation
    const rotX = dataView.getFloat32(24, true);
    const rotY = dataView.getFloat32(28, true);
    const rotZ = dataView.getFloat32(32, true);
    const rotW = dataView.getFloat32(36, true);
    outSplat[OFFSET_ROT0] = rotW;
    outSplat[OFFSET_ROT1] = rotX;
    outSplat[OFFSET_ROT2] = rotY;
    outSplat[OFFSET_ROT3] = rotZ;

    // Read color
    const color = new Uint8Array(sectionBuffer, bufferOffset + 40, 4);
    outSplat[OFFSET_FDC0] = color[0];
    outSplat[OFFSET_FDC1] = color[1];
    outSplat[OFFSET_FDC2] = color[2];
    outSplat[OFFSET_OPACITY] = color[3];

    // Read spherical harmonics if present
    if (
      sphericalHarmonicsDegree > 0 &&
      minSphericalHarmonicsCoeff !== undefined &&
      maxSphericalHarmonicsCoeff !== undefined
    ) {
      const shRange = maxSphericalHarmonicsCoeff - minSphericalHarmonicsCoeff;
      const shCount = getSphericalHarmonicsComponentCountForDegree(
        sphericalHarmonicsDegree
      );

      for (let i = 0; i < shCount; i++) {
        const shValue = dataView.getUint8(44 + i);
        outSplat[OFFSET_FRC0 + i] =
          (shValue / 255) * shRange + minSphericalHarmonicsCoeff;
      }
    }

    return outSplat;
  }

  static compressSphericalHarmonics = (function () {
    const shCoeffMap = [0, 3, 8, 15];
    const shIndexMap = [
      0, 1, 2, 9, 10, 11, 12, 13, 24, 25, 26, 27, 28, 29, 30, 3, 4, 5, 14, 15,
      16, 17, 18, 31, 32, 33, 34, 35, 36, 37, 6, 7, 8, 19, 20, 21, 22, 23, 38,
      39, 40, 41, 42, 43, 44,
    ];

    return function (
      index: number,
      shArray: TypedArray[],
      outSphericalHarmonicsDegree: number,
      readSphericalHarmonicsDegree: number,
      outSplat: number[]
    ): number[] {
      outSplat = outSplat || UncompressedSplatArray.createSplat();
      let outSHCoeff = shCoeffMap[outSphericalHarmonicsDegree];
      let readSHCoeff = shCoeffMap[readSphericalHarmonicsDegree];
      for (let j = 0; j < 3; ++j) {
        for (let k = 0; k < 15; ++k) {
          const outIndex = shIndexMap[j * 15 + k];
          if (k < outSHCoeff && k < readSHCoeff) {
            const compressedValue = Math.round(
              (outSplat[UncompressedSplatArray.OFFSET.FRC0 + outIndex] + 4) *
                (255 / 8)
            );
            const shArrayElement = shArray[j * readSHCoeff + k];
            if (shArrayElement) {
              shArrayElement[index] = Math.max(
                0,
                Math.min(255, compressedValue)
              );
            }
          }
        }
      }

      return outSplat;
    };
  })();

  static extractSplatComponents(splat: number[]): {
    position: [number, number, number];
    scale: [number, number, number];
    rotation: [number, number, number, number];
    color: [number, number, number, number];
    sphericalHarmonics: number[];
  } {
    const {
      X: OFFSET_X,
      Y: OFFSET_Y,
      Z: OFFSET_Z,
      SCALE0: OFFSET_SCALE0,
      SCALE1: OFFSET_SCALE1,
      SCALE2: OFFSET_SCALE2,
      ROTATION0: OFFSET_ROT0,
      ROTATION1: OFFSET_ROT1,
      ROTATION2: OFFSET_ROT2,
      ROTATION3: OFFSET_ROT3,
      FDC0: OFFSET_FDC0,
      FDC1: OFFSET_FDC1,
      FDC2: OFFSET_FDC2,
      OPACITY: OFFSET_OPACITY,
      FRC0: OFFSET_FRC0,
    } = UncompressedSplatArray.OFFSET;

    // Extract position
    const position: [number, number, number] = [
      splat[OFFSET_X],
      splat[OFFSET_Y],
      splat[OFFSET_Z],
    ];

    // Extract scale
    const scale: [number, number, number] = [
      splat[OFFSET_SCALE0],
      splat[OFFSET_SCALE1],
      splat[OFFSET_SCALE2],
    ];

    // Extract rotation (quaternion)
    const rotation: [number, number, number, number] = [
      splat[OFFSET_ROT0],
      splat[OFFSET_ROT1],
      splat[OFFSET_ROT2],
      splat[OFFSET_ROT3],
    ];

    // Extract color (RGBA)
    const color: [number, number, number, number] = [
      splat[OFFSET_FDC0],
      splat[OFFSET_FDC1],
      splat[OFFSET_FDC2],
      splat[OFFSET_OPACITY],
    ];

    // Extract spherical harmonics coefficients
    const sphericalHarmonics: number[] = [];
    for (let i = OFFSET_FRC0; i < splat.length; i++) {
      sphericalHarmonics.push(splat[i]);
    }

    return {
      position,
      scale,
      rotation,
      color,
      sphericalHarmonics,
    };
  }

  static compressBaseSplat = (function () {
    const p = new THREE.Vector3();
    const r = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Vector4();

    const OFFSET = UncompressedSplatArray.OFFSET;

    return function (
      splat: number[],
      chunkSplatIndexOffset: number,
      positionArray: TypedArray,
      positionExtremes: PositionExtremes,
      scaleArray: TypedArray,
      scaleExtremes: ScaleExtremes,
      rotationArray: TypedArray,
      colorExtremes: ColorExtremes,
      colorArray: TypedArray
    ): void {
      // Ensure arrays are not null/undefined
      if (
        !positionArray ||
        !rotationArray ||
        !scaleArray ||
        !colorArray ||
        !splat
      ) {
        return;
      }

      const chunkIndex = Math.floor(chunkSplatIndexOffset / 256);

      // Compress position
      if (
        positionExtremes?.minX &&
        positionExtremes?.maxX &&
        splat[OFFSET.X] !== undefined
      ) {
        p.x =
          (splat[OFFSET.X] - positionExtremes.minX[chunkIndex]) /
          (positionExtremes.maxX[chunkIndex] -
            positionExtremes.minX[chunkIndex]);
      } else {
        p.x = splat[OFFSET.X] || 0;
      }

      if (
        positionExtremes?.minY &&
        positionExtremes?.maxY &&
        splat[OFFSET.Y] !== undefined
      ) {
        p.y =
          (splat[OFFSET.Y] - positionExtremes.minY[chunkIndex]) /
          (positionExtremes.maxY[chunkIndex] -
            positionExtremes.maxY[chunkIndex]);
      } else {
        p.y = splat[OFFSET.Y] || 0;
      }

      if (
        positionExtremes?.minZ &&
        positionExtremes?.maxZ &&
        splat[OFFSET.Z] !== undefined
      ) {
        p.z =
          (splat[OFFSET.Z] - positionExtremes.minZ[chunkIndex]) /
          (positionExtremes.maxZ[chunkIndex] -
            positionExtremes.maxZ[chunkIndex]);
      } else {
        p.z = splat[OFFSET.Z] || 0;
      }

      // Compress rotation
      r.set(
        splat[OFFSET.ROTATION0] || 0,
        splat[OFFSET.ROTATION1] || 0,
        splat[OFFSET.ROTATION2] || 0,
        splat[OFFSET.ROTATION3] || 0
      );
      r.normalize();

      // Compress scale
      if (
        scaleExtremes?.minScaleX &&
        scaleExtremes?.maxScaleX &&
        splat[OFFSET.SCALE0] !== undefined
      ) {
        s.x =
          (Math.log(splat[OFFSET.SCALE0] || 1) -
            scaleExtremes.minScaleX[chunkIndex]) /
          (scaleExtremes.maxScaleX[chunkIndex] -
            scaleExtremes.minScaleX[chunkIndex]);
      } else {
        s.x = Math.log(splat[OFFSET.SCALE0] || 1);
      }

      if (
        scaleExtremes?.minScaleY &&
        scaleExtremes?.maxScaleY &&
        splat[OFFSET.SCALE1] !== undefined
      ) {
        s.y =
          (Math.log(splat[OFFSET.SCALE1] || 1) -
            scaleExtremes.minScaleY[chunkIndex]) /
          (scaleExtremes.maxScaleY[chunkIndex] -
            scaleExtremes.minScaleY[chunkIndex]);
      } else {
        s.y = Math.log(splat[OFFSET.SCALE1] || 1);
      }

      if (
        scaleExtremes?.minScaleZ &&
        scaleExtremes?.maxScaleZ &&
        splat[OFFSET.SCALE2] !== undefined
      ) {
        s.z =
          (Math.log(splat[OFFSET.SCALE2] || 1) -
            scaleExtremes.minScaleZ[chunkIndex]) /
          (scaleExtremes.maxScaleZ[chunkIndex] -
            scaleExtremes.minScaleZ[chunkIndex]);
      } else {
        s.z = Math.log(splat[OFFSET.SCALE2] || 1);
      }

      // Compress color
      if (
        colorExtremes?.minR &&
        colorExtremes?.maxR &&
        splat[OFFSET.FDC0] !== undefined
      ) {
        c.x =
          (splat[OFFSET.FDC0] - colorExtremes.minR[chunkIndex]) /
          (colorExtremes.maxR[chunkIndex] - colorExtremes.minR[chunkIndex]);
      } else {
        c.x = (splat[OFFSET.FDC0] || 0) / 255;
      }

      if (
        colorExtremes?.minG &&
        colorExtremes?.maxG &&
        splat[OFFSET.FDC1] !== undefined
      ) {
        c.y =
          (splat[OFFSET.FDC1] - colorExtremes.minG[chunkIndex]) /
          (colorExtremes.maxG[chunkIndex] - colorExtremes.minG[chunkIndex]);
      } else {
        c.y = (splat[OFFSET.FDC1] || 0) / 255;
      }

      if (
        colorExtremes?.minB &&
        colorExtremes?.maxB &&
        splat[OFFSET.FDC2] !== undefined
      ) {
        c.z =
          (splat[OFFSET.FDC2] - colorExtremes.minB[chunkIndex]) /
          (colorExtremes.maxB[chunkIndex] - colorExtremes.minB[chunkIndex]);
      } else {
        c.z = (splat[OFFSET.FDC2] || 0) / 255;
      }

      c.w = (splat[OFFSET.OPACITY] || 0) / 255;

      // Pack the compressed values into the arrays
      pack111011(positionArray, p);
      packRot(rotationArray, r);
      pack111011(scaleArray, s);
      pack8888(colorArray, c);
    };
  })();

  /**
   * Creates element data from storage arrays
   */
  static createElementDataFromStorageArrays(
    storageArrays: ElementStorageArrays,
    count: number,
    sphericalHarmonicsDegree: number
  ): {
    chunkElement?: PlyElement;
    vertexElement?: PlyElement;
    shElement?: PlyElement;
  } {
    const chunkElement: PlyElement = {
      name: "chunk",
      count: Math.ceil(count / 256),
      properties: [],
      storageSizeBytes: 0,
    };

    const vertexElement: PlyElement = {
      name: "vertex",
      count: count,
      properties: [],
      storageSizeBytes: 0,
    };

    const shElement: PlyElement = {
      name: "sh",
      count: count,
      properties: [],
      storageSizeBytes: 0,
    };

    // Add chunk properties (extremes)
    if (storageArrays.colorExtremes) {
      const { minR, maxR, minG, maxG, minB, maxB } =
        storageArrays.colorExtremes;
      if (minR)
        chunkElement.properties.push({
          type: "float",
          name: "min_r",
          storage: minR,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (maxR)
        chunkElement.properties.push({
          type: "float",
          name: "max_r",
          storage: maxR,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (minG)
        chunkElement.properties.push({
          type: "float",
          name: "min_g",
          storage: minG,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (maxG)
        chunkElement.properties.push({
          type: "float",
          name: "max_g",
          storage: maxG,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (minB)
        chunkElement.properties.push({
          type: "float",
          name: "min_b",
          storage: minB,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (maxB)
        chunkElement.properties.push({
          type: "float",
          name: "max_b",
          storage: maxB,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
    }

    if (storageArrays.positionExtremes) {
      const { minX, maxX, minY, maxY, minZ, maxZ } =
        storageArrays.positionExtremes;
      if (minX)
        chunkElement.properties.push({
          type: "float",
          name: "min_x",
          storage: minX,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (maxX)
        chunkElement.properties.push({
          type: "float",
          name: "max_x",
          storage: maxX,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (minY)
        chunkElement.properties.push({
          type: "float",
          name: "min_y",
          storage: minY,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (maxY)
        chunkElement.properties.push({
          type: "float",
          name: "max_y",
          storage: maxY,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (minZ)
        chunkElement.properties.push({
          type: "float",
          name: "min_z",
          storage: minZ,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (maxZ)
        chunkElement.properties.push({
          type: "float",
          name: "max_z",
          storage: maxZ,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
    }

    if (storageArrays.scaleExtremes) {
      const {
        minScaleX,
        maxScaleX,
        minScaleY,
        maxScaleY,
        minScaleZ,
        maxScaleZ,
      } = storageArrays.scaleExtremes;
      if (minScaleX)
        chunkElement.properties.push({
          type: "float",
          name: "min_scale_x",
          storage: minScaleX,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (maxScaleX)
        chunkElement.properties.push({
          type: "float",
          name: "max_scale_x",
          storage: maxScaleX,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (minScaleY)
        chunkElement.properties.push({
          type: "float",
          name: "min_scale_y",
          storage: minScaleY,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (maxScaleY)
        chunkElement.properties.push({
          type: "float",
          name: "max_scale_y",
          storage: maxScaleY,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (minScaleZ)
        chunkElement.properties.push({
          type: "float",
          name: "min_scale_z",
          storage: minScaleZ,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
      if (maxScaleZ)
        chunkElement.properties.push({
          type: "float",
          name: "max_scale_z",
          storage: maxScaleZ,
          byteSize: 4,
          storageSizeByes: 4 * chunkElement.count,
        });
    }

    // Add vertex properties
    if (storageArrays.position) {
      vertexElement.properties.push({
        type: "uint",
        name: "packed_position",
        storage: storageArrays.position,
        byteSize: 4,
        storageSizeByes: 4 * count,
      });
    }
    if (storageArrays.rotation) {
      vertexElement.properties.push({
        type: "uint",
        name: "packed_rotation",
        storage: storageArrays.rotation,
        byteSize: 4,
        storageSizeByes: 4 * count,
      });
    }
    if (storageArrays.scale) {
      vertexElement.properties.push({
        type: "uint",
        name: "packed_scale",
        storage: storageArrays.scale,
        byteSize: 4,
        storageSizeByes: 4 * count,
      });
    }
    if (storageArrays.color) {
      vertexElement.properties.push({
        type: "uint",
        name: "packed_color",
        storage: storageArrays.color,
        byteSize: 4,
        storageSizeByes: 4 * count,
      });
    }

    // Add spherical harmonics properties
    if (storageArrays.sh) {
      const shCount = getSphericalHarmonicsComponentCountForDegree(
        sphericalHarmonicsDegree
      );
      for (let i = 0; i < shCount; i++) {
        const fRestKey = `f_rest_${i}`;
        const fRest = storageArrays.sh[fRestKey];
        if (fRest) {
          shElement.properties.push({
            type: "uchar",
            name: fRestKey,
            storage: fRest,
            byteSize: 1,
            storageSizeByes: count,
          });
        }
      }
    }

    // Calculate storage sizes
    chunkElement.storageSizeBytes = chunkElement.properties.reduce(
      (sum: number, prop: { storageSizeByes: number }) =>
        sum + prop.storageSizeByes,
      0
    );
    vertexElement.storageSizeBytes = vertexElement.properties.reduce(
      (sum: number, prop: { storageSizeByes: number }) =>
        sum + prop.storageSizeByes,
      0
    );
    shElement.storageSizeBytes = shElement.properties.reduce(
      (sum: number, prop: { storageSizeByes: number }) =>
        sum + prop.storageSizeByes,
      0
    );

    return {
      chunkElement:
        chunkElement.properties.length > 0 ? chunkElement : undefined,
      vertexElement:
        vertexElement.properties.length > 0 ? vertexElement : undefined,
      shElement: shElement.properties.length > 0 ? shElement : undefined,
    };
  }

  /**
   * Extracts splat data from an uncompressed buffer
   * @param splatBuffer The uncompressed splat buffer to extract from
   * @returns An object containing the splat count and spherical harmonics degree
   */
  static extractFromUncompressedBuffer(splatBuffer: SplatBuffer): {
    splatCount: number;
    sphericalHarmonicsDegree: number;
  } {
    // Read header data
    const headerArrayUint32 = new Uint32Array(
      splatBuffer.bufferData,
      0,
      SplatBuffer.HeaderSizeBytes / 4
    );
    const headerArrayUint16 = new Uint16Array(
      splatBuffer.bufferData,
      0,
      SplatBuffer.HeaderSizeBytes / 2
    );

    // Extract splat count from header
    const splatCount = headerArrayUint32[4];

    // Read section header to get spherical harmonics degree
    const sectionHeaderArrayUint16 = new Uint16Array(
      splatBuffer.bufferData,
      SplatBuffer.HeaderSizeBytes,
      SplatBuffer.SectionHeaderSizeBytes / 2
    );
    const sphericalHarmonicsDegree = sectionHeaderArrayUint16[20];

    return {
      splatCount,
      sphericalHarmonicsDegree,
    };
  }
}

// Helper function to get number of spherical harmonics components for a given degree
function getSphericalHarmonicsComponentCountForDegree(degree: number): number {
  let shCoeffPerSplat = 0;
  if (degree === 1) {
    shCoeffPerSplat = 9;
  } else if (degree === 2) {
    shCoeffPerSplat = 24;
  } else if (degree === 3) {
    shCoeffPerSplat = 45;
  } else if (degree > 3) {
    throw new Error(
      "getSphericalHarmonicsComponentCountForDegree() -> Invalid spherical harmonics degree"
    );
  }
  return shCoeffPerSplat;
}
