import { getSphericalHarmonicsComponentCountForDegree } from "../../Util.js";
import * as THREE from "three";

// Pack a normalized value into a specified number of bits
const packUnorm = (value, bits) => {
  const t = (1 << bits) - 1;
  return Math.floor(value * t) & t;
};

// Pack a 3D vector into a 32-bit integer with 11,10,11 bit format
const pack111011 = (x, y, z) => {
  return (packUnorm(x, 11) << 21) | (packUnorm(y, 10) << 11) | packUnorm(z, 11);
};

// Pack a 4D vector into a 32-bit integer with 8,8,8,8 bit format
const pack8888 = (x, y, z, w) => {
  return (
    (packUnorm(x, 8) << 24) |
    (packUnorm(y, 8) << 16) |
    (packUnorm(z, 8) << 8) |
    packUnorm(w, 8)
  );
};

// Pack a quaternion into a 32-bit integer with 2,10,10,10 format
const packRot = (x, y, z, w) => {
  const norm = Math.sqrt(2) * 0.5;

  // Find the largest component
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  const absZ = Math.abs(z);
  const absW = Math.abs(w);

  let largest;
  let a;
  let b;
  let c;

  if (absW >= absX && absW >= absY && absW >= absZ) {
    largest = 0;
    a = x;
    b = y;
    c = z;
  } else if (absX >= absY && absX >= absZ) {
    largest = 1;
    a = w;
    b = y;
    c = z;
  } else if (absY >= absZ) {
    largest = 2;
    a = w;
    b = x;
    c = z;
  } else {
    largest = 3;
    a = w;
    b = x;
    c = y;
  }

  // Convert to the compressed format
  a = a / norm + 0.5;
  b = b / norm + 0.5;
  c = c / norm + 0.5;

  return (
    (largest << 30) |
    (packUnorm(a, 10) << 20) |
    (packUnorm(b, 10) << 10) |
    packUnorm(c, 10)
  );
};

export class PlayCanvasCompressedPlyEncoder {
  /**
   * Converts an UncompressedSplatBuffer to a compressed PLY format
   * This is the opposite of PlayCanvasCompressedPlyParser.parseToUncompressedSplatBuffer
   *
   * @param {SplatBuffer} splatBuffer - The uncompressed splat buffer to encode
   * @param {number} chunkSize - The size of each chunk (default: 256)
   * @returns {ArrayBuffer} - The compressed PLY data as an ArrayBuffer
   */
  static encodeToCompressedPly(splatBuffer, chunkSize = 256) {
    const splatCount = splatBuffer.getSplatCount();
    const sphericalHarmonicsDegree =
      splatBuffer.getMinSphericalHarmonicsDegree();

    // Calculate the number of chunks needed
    const chunkCount = Math.ceil(splatCount / chunkSize);

    // Create arrays to store the compressed data
    const position = new Uint32Array(splatCount);
    const rotation = new Uint32Array(splatCount);
    const scale = new Uint32Array(splatCount);
    const color = new Uint32Array(splatCount);

    // Arrays for spherical harmonics if needed
    let shArrays = [];
    if (sphericalHarmonicsDegree > 0) {
      const shCount = getSphericalHarmonicsComponentCountForDegree(
        sphericalHarmonicsDegree
      );
      for (let i = 0; i < shCount; i++) {
        shArrays.push(new Uint8Array(splatCount));
      }
    }

    // Arrays to store min/max values for each chunk
    const minX = new Float32Array(chunkCount);
    const maxX = new Float32Array(chunkCount);
    const minY = new Float32Array(chunkCount);
    const maxY = new Float32Array(chunkCount);
    const minZ = new Float32Array(chunkCount);
    const maxZ = new Float32Array(chunkCount);

    const minScaleX = new Float32Array(chunkCount);
    const maxScaleX = new Float32Array(chunkCount);
    const minScaleY = new Float32Array(chunkCount);
    const maxScaleY = new Float32Array(chunkCount);
    const minScaleZ = new Float32Array(chunkCount);
    const maxScaleZ = new Float32Array(chunkCount);

    const minR = new Float32Array(chunkCount);
    const maxR = new Float32Array(chunkCount);
    const minG = new Float32Array(chunkCount);
    const maxG = new Float32Array(chunkCount);
    const minB = new Float32Array(chunkCount);
    const maxB = new Float32Array(chunkCount);

    // Initialize min/max arrays
    for (let i = 0; i < chunkCount; i++) {
      minX[i] = Infinity;
      maxX[i] = -Infinity;
      minY[i] = Infinity;
      maxY[i] = -Infinity;
      minZ[i] = Infinity;
      maxZ[i] = -Infinity;

      minScaleX[i] = Infinity;
      maxScaleX[i] = -Infinity;
      minScaleY[i] = Infinity;
      maxScaleY[i] = -Infinity;
      minScaleZ[i] = Infinity;
      maxScaleZ[i] = -Infinity;

      minR[i] = 255.0;
      maxR[i] = 0.0;
      minG[i] = 255.0;
      maxG[i] = 0.0;
      minB[i] = 255.0;
      maxB[i] = 0.0;
    }

    // First pass: collect min/max values for each chunk
    const center = new THREE.Vector3();
    const scaleVec = new THREE.Vector3();
    const rotationQuat = new THREE.Quaternion();
    const colorVec = new THREE.Vector4();

    for (let i = 0; i < splatCount; i++) {
      const chunkIndex = Math.floor(i / chunkSize);

      // Get splat data
      splatBuffer.getSplatCenter(i, center);
      splatBuffer.getSplatScaleAndRotation(i, scaleVec, rotationQuat);
      splatBuffer.getSplatColor(i, colorVec);

      // Update min/max for position
      minX[chunkIndex] = Math.min(minX[chunkIndex], center.x);
      maxX[chunkIndex] = Math.max(maxX[chunkIndex], center.x);
      minY[chunkIndex] = Math.min(minY[chunkIndex], center.y);
      maxY[chunkIndex] = Math.max(maxY[chunkIndex], center.y);
      minZ[chunkIndex] = Math.min(minZ[chunkIndex], center.z);
      maxZ[chunkIndex] = Math.max(maxZ[chunkIndex], center.z);

      // Update min/max for scale
      minScaleX[chunkIndex] = Math.min(minScaleX[chunkIndex], scaleVec.x);
      maxScaleX[chunkIndex] = Math.max(maxScaleX[chunkIndex], scaleVec.x);
      minScaleY[chunkIndex] = Math.min(minScaleY[chunkIndex], scaleVec.y);
      maxScaleY[chunkIndex] = Math.max(maxScaleY[chunkIndex], scaleVec.y);
      minScaleZ[chunkIndex] = Math.min(minScaleZ[chunkIndex], scaleVec.z);
      maxScaleZ[chunkIndex] = Math.max(maxScaleZ[chunkIndex], scaleVec.z);

      // Update min/max for color (colorVec values are already in 0-255 range)
      minR[chunkIndex] = Math.min(minR[chunkIndex], colorVec.x);
      maxR[chunkIndex] = Math.max(maxR[chunkIndex], colorVec.x);
      minG[chunkIndex] = Math.min(minG[chunkIndex], colorVec.y);
      maxG[chunkIndex] = Math.max(maxG[chunkIndex], colorVec.y);
      minB[chunkIndex] = Math.min(minB[chunkIndex], colorVec.z);
      maxB[chunkIndex] = Math.max(maxB[chunkIndex], colorVec.z);
    }

    // Second pass: compress the data
    for (let i = 0; i < splatCount; i++) {
      const chunkIndex = Math.floor(i / chunkSize);

      // Get splat data
      splatBuffer.getSplatCenter(i, center);
      splatBuffer.getSplatScaleAndRotation(i, scaleVec, rotationQuat);
      splatBuffer.getSplatColor(i, colorVec);

      // Compress position
      const normalizedX =
        (center.x - minX[chunkIndex]) / (maxX[chunkIndex] - minX[chunkIndex]);
      const normalizedY =
        (center.y - minY[chunkIndex]) / (maxY[chunkIndex] - minY[chunkIndex]);
      const normalizedZ =
        (center.z - minZ[chunkIndex]) / (maxZ[chunkIndex] - minZ[chunkIndex]);
      position[i] = pack111011(normalizedX, normalizedY, normalizedZ);

      // Compress rotation
      rotation[i] = packRot(
        rotationQuat.x,
        rotationQuat.y,
        rotationQuat.z,
        rotationQuat.w
      );

      // Compress scale
      const normalizedScaleX =
        (Math.log(scaleVec.x) - Math.log(minScaleX[chunkIndex])) /
        (Math.log(maxScaleX[chunkIndex]) - Math.log(minScaleX[chunkIndex]));
      const normalizedScaleY =
        (Math.log(scaleVec.y) - Math.log(minScaleY[chunkIndex])) /
        (Math.log(maxScaleY[chunkIndex]) - Math.log(minScaleY[chunkIndex]));
      const normalizedScaleZ =
        (Math.log(scaleVec.z) - Math.log(minScaleZ[chunkIndex])) /
        (Math.log(maxScaleZ[chunkIndex]) - Math.log(minScaleZ[chunkIndex]));
      scale[i] = pack111011(
        normalizedScaleX,
        normalizedScaleY,
        normalizedScaleZ
      );

      // Compress color
      const normalizedR =
        (colorVec.x - minR[chunkIndex]) / (maxR[chunkIndex] - minR[chunkIndex]);
      const normalizedG =
        (colorVec.y - minG[chunkIndex]) / (maxG[chunkIndex] - minG[chunkIndex]);
      const normalizedB =
        (colorVec.z - minB[chunkIndex]) / (maxB[chunkIndex] - minB[chunkIndex]);
      color[i] = pack8888(normalizedR, normalizedG, normalizedB, colorVec.w);

      // Compress spherical harmonics if needed
      if (sphericalHarmonicsDegree > 0) {
        // Get spherical harmonics data
        const shData = new Float32Array(
          getSphericalHarmonicsComponentCountForDegree(sphericalHarmonicsDegree)
        );
        splatBuffer.fillSphericalHarmonicsArray(
          shData,
          sphericalHarmonicsDegree,
          null, // transform
          i, // srcFrom
          i, // srcTo
          0, // destFrom
          0 // desiredOutputCompressionLevel
        );

        // Compress each component
        for (let j = 0; j < shData.length; j++) {
          // Normalize to 0-255 range (assuming values are in -4 to 4 range)
          const normalizedValue = (shData[j] + 4) / 8;
          shArrays[j][i] = Math.floor(normalizedValue * 255);
        }
      }
    }

    // Create the PLY header
    let headerText = "ply\n";
    headerText += "format binary_little_endian 1.0\n";
    headerText += "comment Generated by SuperSplat 1.15.0\n";

    // Add chunk element
    headerText += `element chunk ${chunkCount}\n`;
    // Add properties in the same order as the original
    headerText += "property float min_x\n";
    headerText += "property float min_y\n";
    headerText += "property float min_z\n";
    headerText += "property float max_x\n";
    headerText += "property float max_y\n";
    headerText += "property float max_z\n";
    headerText += "property float min_scale_x\n";
    headerText += "property float min_scale_y\n";
    headerText += "property float min_scale_z\n";
    headerText += "property float max_scale_x\n";
    headerText += "property float max_scale_y\n";
    headerText += "property float max_scale_z\n";
    headerText += "property float min_r\n";
    headerText += "property float min_g\n";
    headerText += "property float min_b\n";
    headerText += "property float max_r\n";
    headerText += "property float max_g\n";
    headerText += "property float max_b\n";

    // Add vertex element
    headerText += `element vertex ${splatCount}\n`;
    headerText += "property uint packed_position\n";
    headerText += "property uint packed_rotation\n";
    headerText += "property uint packed_scale\n";
    headerText += "property uint packed_color\n";

    // Add spherical harmonics element if needed
    if (sphericalHarmonicsDegree > 0) {
      headerText += `element sh ${splatCount}\n`;
      const shCount = getSphericalHarmonicsComponentCountForDegree(
        sphericalHarmonicsDegree
      );
      for (let i = 0; i < shCount; i++) {
        headerText += `property uchar f_rest_${i}\n`;
      }
    }

    headerText += "end_header\n";

    // Calculate the size of the header
    const headerSize = headerText.length;

    // Calculate the size of the data
    const chunkDataSize = chunkCount * 72; // 18 floats * 4 bytes per chunk
    const vertexDataSize = splatCount * 16; // 4 uints per vertex
    const shDataSize =
      sphericalHarmonicsDegree > 0
        ? splatCount *
          getSphericalHarmonicsComponentCountForDegree(sphericalHarmonicsDegree)
        : 0;

    // Create the output buffer with exact size
    const totalSize = headerSize + chunkDataSize + vertexDataSize + shDataSize;
    console.log(`Buffer size calculation:
      Header size: ${headerSize}
      Chunk data size: ${chunkDataSize} (${chunkCount} chunks * 72 bytes)
      Vertex data size: ${vertexDataSize} (${splatCount} vertices * 16 bytes)
      SH data size: ${shDataSize} (${
        sphericalHarmonicsDegree > 0
          ? splatCount *
            getSphericalHarmonicsComponentCountForDegree(
              sphericalHarmonicsDegree
            )
          : 0
      } bytes)
      Total size: ${totalSize}
    `);

    const outputBuffer = new ArrayBuffer(totalSize);
    const dataView = new DataView(outputBuffer);

    // Write the header
    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(headerText);
    const headerArray = new Uint8Array(outputBuffer, 0, headerSize);
    headerArray.set(headerBytes);

    // Write the chunk data
    let offset = headerSize;
    for (let i = 0; i < chunkCount; i++) {
      // Write min/max values in the same order as the header
      dataView.setFloat32(offset, minX[i], true);
      dataView.setFloat32(offset + 4, minY[i], true);
      dataView.setFloat32(offset + 8, minZ[i], true);
      dataView.setFloat32(offset + 12, maxX[i], true);
      dataView.setFloat32(offset + 16, maxY[i], true);
      dataView.setFloat32(offset + 20, maxZ[i], true);
      dataView.setFloat32(offset + 24, minScaleX[i], true);
      dataView.setFloat32(offset + 28, minScaleY[i], true);
      dataView.setFloat32(offset + 32, minScaleZ[i], true);
      dataView.setFloat32(offset + 36, maxScaleX[i], true);
      dataView.setFloat32(offset + 40, maxScaleY[i], true);
      dataView.setFloat32(offset + 44, maxScaleZ[i], true);
      dataView.setFloat32(offset + 48, minR[i] * 1.0, true);
      dataView.setFloat32(offset + 52, minG[i] * 1.0, true);
      dataView.setFloat32(offset + 56, minB[i] * 1.0, true);
      dataView.setFloat32(offset + 60, maxR[i] * 1.0, true);
      dataView.setFloat32(offset + 64, maxG[i] * 1.0, true);
      dataView.setFloat32(offset + 68, maxB[i] * 1.0, true);
      offset += 72; // 18 floats * 4 bytes
    }

    // Write the vertex data
    for (let i = 0; i < splatCount; i++) {
      if (offset + 16 > totalSize) {
        console.error(
          `Buffer overflow: offset ${offset} + 16 > totalSize ${totalSize}`
        );
        throw new Error(
          `Buffer overflow: offset ${offset} + 16 > totalSize ${totalSize}`
        );
      }
      dataView.setUint32(offset, position[i], true);
      dataView.setUint32(offset + 4, rotation[i], true);
      dataView.setUint32(offset + 8, scale[i], true);
      dataView.setUint32(offset + 12, color[i], true);
      offset += 16;
    }

    // Write the spherical harmonics data if needed
    if (sphericalHarmonicsDegree > 0) {
      for (let i = 0; i < splatCount; i++) {
        for (let j = 0; j < shArrays.length; j++) {
          if (offset + 1 > totalSize) {
            console.error(
              `Buffer overflow: offset ${offset} + 1 > totalSize ${totalSize}`
            );
            throw new Error(
              `Buffer overflow: offset ${offset} + 1 > totalSize ${totalSize}`
            );
          }
          dataView.setUint8(offset, shArrays[j][i]);
          offset += 1;
        }
      }
    }

    // Verify we didn't write beyond the buffer
    if (offset > totalSize) {
      console.error(
        `Buffer overflow: final offset ${offset} > totalSize ${totalSize}`
      );
      throw new Error(
        `Buffer overflow: final offset ${offset} > totalSize ${totalSize}`
      );
    }

    return outputBuffer;
  }
}
