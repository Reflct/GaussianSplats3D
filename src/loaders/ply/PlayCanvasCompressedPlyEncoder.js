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

    const minR = new Uint8Array(chunkCount);
    const maxR = new Uint8Array(chunkCount);
    const minG = new Uint8Array(chunkCount);
    const maxG = new Uint8Array(chunkCount);
    const minB = new Uint8Array(chunkCount);
    const maxB = new Uint8Array(chunkCount);

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

      minR[i] = 255;
      maxR[i] = 0;
      minG[i] = 255;
      maxG[i] = 0;
      minB[i] = 255;
      maxB[i] = 0;
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
      minScaleX[chunkIndex] = Math.min(
        minScaleX[chunkIndex],
        Math.log(scaleVec.x)
      );
      maxScaleX[chunkIndex] = Math.max(
        maxScaleX[chunkIndex],
        Math.log(scaleVec.x)
      );
      minScaleY[chunkIndex] = Math.min(
        minScaleY[chunkIndex],
        Math.log(scaleVec.y)
      );
      maxScaleY[chunkIndex] = Math.max(
        maxScaleY[chunkIndex],
        Math.log(scaleVec.y)
      );
      minScaleZ[chunkIndex] = Math.min(
        minScaleZ[chunkIndex],
        Math.log(scaleVec.z)
      );
      maxScaleZ[chunkIndex] = Math.max(
        maxScaleZ[chunkIndex],
        Math.log(scaleVec.z)
      );

      // Update min/max for color
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
        (Math.log(scaleVec.x) - minScaleX[chunkIndex]) /
        (maxScaleX[chunkIndex] - minScaleX[chunkIndex]);
      const normalizedScaleY =
        (Math.log(scaleVec.y) - minScaleY[chunkIndex]) /
        (maxScaleY[chunkIndex] - minScaleY[chunkIndex]);
      const normalizedScaleZ =
        (Math.log(scaleVec.z) - minScaleZ[chunkIndex]) /
        (maxScaleZ[chunkIndex] - minScaleZ[chunkIndex]);
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
        // This part would need to be implemented based on how spherical harmonics are stored in the splat buffer
        // For now, we'll leave it as a placeholder
      }
    }

    // Create the PLY header
    let headerText = "ply\n";
    headerText += "format binary_little_endian 1.0\n";
    headerText += "comment Generated by PlayCanvasCompressedPlyEncoder\n";

    // Add chunk element
    headerText += `element chunk ${chunkCount}\n`;
    headerText += "property float min_x\n";
    headerText += "property float max_x\n";
    headerText += "property float min_y\n";
    headerText += "property float max_y\n";
    headerText += "property float min_z\n";
    headerText += "property float max_z\n";
    headerText += "property float min_scale_x\n";
    headerText += "property float max_scale_x\n";
    headerText += "property float min_scale_y\n";
    headerText += "property float max_scale_y\n";
    headerText += "property float min_scale_z\n";
    headerText += "property float max_scale_z\n";
    headerText += "property uchar min_r\n";
    headerText += "property uchar max_r\n";
    headerText += "property uchar min_g\n";
    headerText += "property uchar max_g\n";
    headerText += "property uchar min_b\n";
    headerText += "property uchar max_b\n";

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
    const chunkDataSize = chunkCount * (12 * 4 + 6); // 12 floats + 6 uchars per chunk
    const vertexDataSize = splatCount * 16; // 4 uints per vertex
    const shDataSize =
      sphericalHarmonicsDegree > 0
        ? splatCount *
          getSphericalHarmonicsComponentCountForDegree(sphericalHarmonicsDegree)
        : 0;

    // Create the output buffer
    const totalSize = headerSize + chunkDataSize + vertexDataSize + shDataSize;
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
      dataView.setFloat32(offset, minX[i], true);
      dataView.setFloat32(offset + 4, maxX[i], true);
      dataView.setFloat32(offset + 8, minY[i], true);
      dataView.setFloat32(offset + 12, maxY[i], true);
      dataView.setFloat32(offset + 16, minZ[i], true);
      dataView.setFloat32(offset + 20, maxZ[i], true);
      dataView.setFloat32(offset + 24, minScaleX[i], true);
      dataView.setFloat32(offset + 28, maxScaleX[i], true);
      dataView.setFloat32(offset + 32, minScaleY[i], true);
      dataView.setFloat32(offset + 36, maxScaleY[i], true);
      dataView.setFloat32(offset + 40, minScaleZ[i], true);
      dataView.setFloat32(offset + 44, maxScaleZ[i], true);
      dataView.setUint8(offset + 48, minR[i]);
      dataView.setUint8(offset + 49, maxR[i]);
      dataView.setUint8(offset + 50, minG[i]);
      dataView.setUint8(offset + 51, maxG[i]);
      dataView.setUint8(offset + 52, minB[i]);
      dataView.setUint8(offset + 53, maxB[i]);
      offset += 54;
    }

    // Write the vertex data
    for (let i = 0; i < splatCount; i++) {
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
          dataView.setUint8(offset, shArrays[j][i]);
          offset += 1;
        }
      }
    }

    return outputBuffer;
  }
}
