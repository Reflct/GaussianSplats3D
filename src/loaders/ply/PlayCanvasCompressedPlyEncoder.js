import { getSphericalHarmonicsComponentCountForDegree } from "../../Util.js";
import * as THREE from "three";

/**
 * ============================================================================
 * BIT PACKING UTILITIES
 * ============================================================================
 *
 * This class provides utility functions for packing normalized values into bit fields.
 * These functions are used to compress various data types (positions, rotations, scales, colors)
 * into fixed-size integers to reduce memory usage.
 */
class BitPacker {
  /**
   * Pack a normalized value into a specified number of bits
   *
   * This function takes a value in the range [0,1] and packs it into a specified number of bits.
   * For example, if bits=8, the value 0.5 would be packed as 127 (half of 255).
   *
   * @param {number} value - Value in range [0,1]
   * @param {number} bits - Number of bits to pack into
   * @returns {number} - Packed value
   */
  static packUnorm(value, bits) {
    const t = (1 << bits) - 1;
    return Math.floor(value * t) & t;
  }

  /**
   * Pack a 3D vector into a 32-bit integer with 11,10,11 bit format
   *
   * This function packs a 3D vector into a 32-bit integer using a 11,10,11 bit format.
   * This provides a good balance between precision and memory usage.
   *
   * @param {number} x - X component in range [0,1]
   * @param {number} y - Y component in range [0,1]
   * @param {number} z - Z component in range [0,1]
   * @returns {number} - Packed 32-bit integer
   */
  static pack111011(x, y, z) {
    return (
      (this.packUnorm(x, 11) << 21) |
      (this.packUnorm(y, 10) << 11) |
      this.packUnorm(z, 11)
    );
  }

  /**
   * Pack a 4D vector into a 32-bit integer with 8,8,8,8 bit format
   *
   * This function packs a 4D vector (like a color with alpha) into a 32-bit integer
   * using 8 bits per component. This is commonly used for RGBA colors.
   *
   * @param {number} x - X component in range [0,1]
   * @param {number} y - Y component in range [0,1]
   * @param {number} z - Z component in range [0,1]
   * @param {number} w - W component in range [0,1]
   * @returns {number} - Packed 32-bit integer
   */
  static pack8888(x, y, z, w) {
    return (
      (this.packUnorm(x, 8) << 24) |
      (this.packUnorm(y, 8) << 16) |
      (this.packUnorm(z, 8) << 8) |
      this.packUnorm(w, 8)
    );
  }

  /**
   * Pack a quaternion into a 32-bit integer with 2,10,10,10 format
   *
   * This function packs a quaternion into a 32-bit integer using a 2,10,10,10 bit format.
   * The first 2 bits store which component is the largest, and the remaining 30 bits
   * store the other three components. This is a common technique for quaternion compression.
   *
   * @param {number} x - X component
   * @param {number} y - Y component
   * @param {number} z - Z component
   * @param {number} w - W component
   * @returns {number} - Packed 32-bit integer
   */
  static packRot(x, y, z, w) {
    const norm = Math.sqrt(2) * 0.5;

    // Find the largest component to determine which component to omit
    const absX = Math.abs(x);
    const absY = Math.abs(y);
    const absZ = Math.abs(z);
    const absW = Math.abs(w);

    let largest;
    let a;
    let b;
    let c;

    // Determine which component is the largest
    if (absW >= absX && absW >= absY && absW >= absZ) {
      largest = 0; // w is largest
      a = x;
      b = y;
      c = z;
    } else if (absX >= absY && absX >= absZ) {
      largest = 1; // x is largest
      a = w;
      b = y;
      c = z;
    } else if (absY >= absZ) {
      largest = 2; // y is largest
      a = w;
      b = x;
      c = z;
    } else {
      largest = 3; // z is largest
      a = w;
      b = x;
      c = y;
    }

    // Convert to the compressed format
    // Normalize and shift to [0,1] range for packing
    a = a / norm + 0.5;
    b = b / norm + 0.5;
    c = c / norm + 0.5;

    // Pack into 32-bit integer: 2 bits for largest component, 10 bits each for the other three
    return (
      (largest << 30) |
      (this.packUnorm(a, 10) << 20) |
      (this.packUnorm(b, 10) << 10) |
      this.packUnorm(c, 10)
    );
  }
}

/**
 * ============================================================================
 * PLY HEADER GENERATION
 * ============================================================================
 *
 * This class handles the generation of PLY headers for the compressed PLY format.
 * The header describes the structure of the data that follows in the binary section.
 */
class PlyHeaderGenerator {
  /**
   * Generate a PLY header for the given parameters
   *
   * This function creates a PLY header that describes the structure of the data.
   * The header includes information about the number of chunks, vertices, and
   * spherical harmonics components, as well as the properties of each element.
   *
   * @param {number} chunkCount - Number of chunks
   * @param {number} splatCount - Number of splats
   * @param {number} sphericalHarmonicsDegree - Degree of spherical harmonics
   * @returns {string} - PLY header text
   */
  static generateHeader(chunkCount, splatCount, sphericalHarmonicsDegree) {
    // Start with the PLY magic number and format
    let headerText = "ply\n";
    headerText += "format binary_little_endian 1.0\n";
    headerText += "comment Generated by SuperSplat 1.15.0\n";

    // Add chunk element with its properties
    // Chunks store min/max values for positions, scales, and colors
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

    // Add vertex element with its properties
    // Vertices store packed positions, rotations, scales, and colors
    headerText += `element vertex ${splatCount}\n`;
    headerText += "property uint packed_position\n";
    headerText += "property uint packed_rotation\n";
    headerText += "property uint packed_scale\n";
    headerText += "property uint packed_color\n";

    // Add spherical harmonics element if needed
    // Spherical harmonics store additional lighting information
    if (sphericalHarmonicsDegree > 0) {
      headerText += `element sh ${splatCount}\n`;
      const shCount = getSphericalHarmonicsComponentCountForDegree(
        sphericalHarmonicsDegree
      );
      for (let i = 0; i < shCount; i++) {
        headerText += `property uchar f_rest_${i}\n`;
      }
    }

    // End the header
    headerText += "end_header\n";
    return headerText;
  }
}

/**
 * ============================================================================
 * CHUNK DATA HANDLING
 * ============================================================================
 *
 * This class handles the management of chunk data, which stores min/max values
 * for positions, scales, and colors. These values are used to normalize and
 * denormalize the data during compression and decompression.
 */
class ChunkDataHandler {
  /**
   * Initialize min/max arrays for chunks
   *
   * This function creates and initializes arrays to store min/max values for each chunk.
   * These arrays are used to normalize and denormalize the data during compression
   * and decompression.
   *
   * @param {number} chunkCount - Number of chunks
   * @returns {Object} - Object containing min/max arrays
   */
  static initializeChunkArrays(chunkCount) {
    // Create arrays for position min/max values
    const minX = new Float32Array(chunkCount);
    const maxX = new Float32Array(chunkCount);
    const minY = new Float32Array(chunkCount);
    const maxY = new Float32Array(chunkCount);
    const minZ = new Float32Array(chunkCount);
    const maxZ = new Float32Array(chunkCount);

    // Create arrays for scale min/max values
    const minScaleX = new Float32Array(chunkCount);
    const maxScaleX = new Float32Array(chunkCount);
    const minScaleY = new Float32Array(chunkCount);
    const maxScaleY = new Float32Array(chunkCount);
    const minScaleZ = new Float32Array(chunkCount);
    const maxScaleZ = new Float32Array(chunkCount);

    // Create arrays for color min/max values
    const minR = new Float32Array(chunkCount);
    const maxR = new Float32Array(chunkCount);
    const minG = new Float32Array(chunkCount);
    const maxG = new Float32Array(chunkCount);
    const minB = new Float32Array(chunkCount);
    const maxB = new Float32Array(chunkCount);

    // Initialize min/max arrays with extreme values
    for (let i = 0; i < chunkCount; i++) {
      // Initialize position min/max with extreme values
      minX[i] = Infinity;
      maxX[i] = -Infinity;
      minY[i] = Infinity;
      maxY[i] = -Infinity;
      minZ[i] = Infinity;
      maxZ[i] = -Infinity;

      // Initialize scale min/max with extreme values
      minScaleX[i] = Infinity;
      maxScaleX[i] = -Infinity;
      minScaleY[i] = Infinity;
      maxScaleY[i] = -Infinity;
      minScaleZ[i] = Infinity;
      maxScaleZ[i] = -Infinity;

      // Initialize color min/max with extreme values
      minR[i] = 255.0;
      maxR[i] = 0.0;
      minG[i] = 255.0;
      maxG[i] = 0.0;
      minB[i] = 255.0;
      maxB[i] = 0.0;
    }

    // Return all arrays in a single object for easy access
    return {
      minX,
      maxX,
      minY,
      maxY,
      minZ,
      maxZ,
      minScaleX,
      maxScaleX,
      minScaleY,
      maxScaleY,
      minScaleZ,
      maxScaleZ,
      minR,
      maxR,
      minG,
      maxG,
      minB,
      maxB,
    };
  }

  /**
   * Update min/max values for a chunk
   *
   * This function updates the min/max values for a chunk based on the position,
   * scale, and color of a splat. These values are used to normalize and
   * denormalize the data during compression and decompression.
   *
   * @param {Object} chunkArrays - Object containing min/max arrays
   * @param {number} chunkIndex - Index of the chunk
   * @param {THREE.Vector3} center - Position vector
   * @param {THREE.Vector3} scaleVec - Scale vector
   * @param {THREE.Vector4} colorVec - Color vector
   */
  static updateChunkMinMax(
    chunkArrays,
    chunkIndex,
    center,
    scaleVec,
    colorVec
  ) {
    // Update min/max for position
    chunkArrays.minX[chunkIndex] = Math.min(
      chunkArrays.minX[chunkIndex],
      center.x
    );
    chunkArrays.maxX[chunkIndex] = Math.max(
      chunkArrays.maxX[chunkIndex],
      center.x
    );
    chunkArrays.minY[chunkIndex] = Math.min(
      chunkArrays.minY[chunkIndex],
      center.y
    );
    chunkArrays.maxY[chunkIndex] = Math.max(
      chunkArrays.maxY[chunkIndex],
      center.y
    );
    chunkArrays.minZ[chunkIndex] = Math.min(
      chunkArrays.minZ[chunkIndex],
      center.z
    );
    chunkArrays.maxZ[chunkIndex] = Math.max(
      chunkArrays.maxZ[chunkIndex],
      center.z
    );

    // Update min/max for scale
    chunkArrays.minScaleX[chunkIndex] = Math.min(
      chunkArrays.minScaleX[chunkIndex],
      scaleVec.x
    );
    chunkArrays.maxScaleX[chunkIndex] = Math.max(
      chunkArrays.maxScaleX[chunkIndex],
      scaleVec.x
    );
    chunkArrays.minScaleY[chunkIndex] = Math.min(
      chunkArrays.minScaleY[chunkIndex],
      scaleVec.y
    );
    chunkArrays.maxScaleY[chunkIndex] = Math.max(
      chunkArrays.maxScaleY[chunkIndex],
      scaleVec.y
    );
    chunkArrays.minScaleZ[chunkIndex] = Math.min(
      chunkArrays.minScaleZ[chunkIndex],
      scaleVec.z
    );
    chunkArrays.maxScaleZ[chunkIndex] = Math.max(
      chunkArrays.maxScaleZ[chunkIndex],
      scaleVec.z
    );

    // Update min/max for color (colorVec values are already in 0-255 range)
    chunkArrays.minR[chunkIndex] = Math.min(
      chunkArrays.minR[chunkIndex],
      colorVec.x
    );
    chunkArrays.maxR[chunkIndex] = Math.max(
      chunkArrays.maxR[chunkIndex],
      colorVec.x
    );
    chunkArrays.minG[chunkIndex] = Math.min(
      chunkArrays.minG[chunkIndex],
      colorVec.y
    );
    chunkArrays.maxG[chunkIndex] = Math.max(
      chunkArrays.maxG[chunkIndex],
      colorVec.y
    );
    chunkArrays.minB[chunkIndex] = Math.min(
      chunkArrays.minB[chunkIndex],
      colorVec.z
    );
    chunkArrays.maxB[chunkIndex] = Math.max(
      chunkArrays.maxB[chunkIndex],
      colorVec.z
    );
  }

  /**
   * Write chunk data to the output buffer
   *
   * This function writes the min/max values for each chunk to the output buffer.
   * The values are written in the same order as they appear in the PLY header.
   *
   * @param {DataView} dataView - DataView for writing to the buffer
   * @param {number} offset - Current offset in the buffer
   * @param {Object} chunkArrays - Object containing min/max arrays
   * @param {number} chunkCount - Number of chunks
   * @returns {number} - New offset after writing chunk data
   */
  static writeChunkData(dataView, offset, chunkArrays, chunkCount) {
    for (let i = 0; i < chunkCount; i++) {
      // Write min/max values in the same order as the header
      // Position min/max values
      dataView.setFloat32(offset, chunkArrays.minX[i], true);
      dataView.setFloat32(offset + 4, chunkArrays.minY[i], true);
      dataView.setFloat32(offset + 8, chunkArrays.minZ[i], true);
      dataView.setFloat32(offset + 12, chunkArrays.maxX[i], true);
      dataView.setFloat32(offset + 16, chunkArrays.maxY[i], true);
      dataView.setFloat32(offset + 20, chunkArrays.maxZ[i], true);

      // Scale min/max values
      dataView.setFloat32(offset + 24, chunkArrays.minScaleX[i], true);
      dataView.setFloat32(offset + 28, chunkArrays.minScaleY[i], true);
      dataView.setFloat32(offset + 32, chunkArrays.minScaleZ[i], true);
      dataView.setFloat32(offset + 36, chunkArrays.maxScaleX[i], true);
      dataView.setFloat32(offset + 40, chunkArrays.maxScaleY[i], true);
      dataView.setFloat32(offset + 44, chunkArrays.maxScaleZ[i], true);

      // Color min/max values
      dataView.setFloat32(offset + 48, chunkArrays.minR[i] * 1.0, true);
      dataView.setFloat32(offset + 52, chunkArrays.minG[i] * 1.0, true);
      dataView.setFloat32(offset + 56, chunkArrays.minB[i] * 1.0, true);
      dataView.setFloat32(offset + 60, chunkArrays.maxR[i] * 1.0, true);
      dataView.setFloat32(offset + 64, chunkArrays.maxG[i] * 1.0, true);
      dataView.setFloat32(offset + 68, chunkArrays.maxB[i] * 1.0, true);

      // Move to the next chunk (18 floats * 4 bytes = 72 bytes per chunk)
      offset += 72;
    }
    return offset;
  }
}

/**
 * ============================================================================
 * VERTEX DATA HANDLING
 * ============================================================================
 *
 * This class handles the management of vertex data, which includes positions,
 * rotations, scales, and colors. These values are compressed using the bit
 * packing utilities.
 */
class VertexDataHandler {
  /**
   * Initialize vertex data arrays
   *
   * This function creates arrays to store the compressed vertex data.
   *
   * @param {number} splatCount - Number of splats
   * @returns {Object} - Object containing vertex data arrays
   */
  static initializeVertexArrays(splatCount) {
    // Create arrays for each vertex attribute
    const position = new Uint32Array(splatCount);
    const rotation = new Uint32Array(splatCount);
    const scale = new Uint32Array(splatCount);
    const color = new Uint32Array(splatCount);

    return { position, rotation, scale, color };
  }

  /**
   * Compress vertex data
   *
   * This function compresses the vertex data using the bit packing utilities.
   * The data is normalized using the min/max values from the chunk data.
   *
   * @param {Object} vertexArrays - Object containing vertex data arrays
   * @param {Object} chunkArrays - Object containing min/max arrays
   * @param {number} index - Index of the vertex
   * @param {number} chunkIndex - Index of the chunk
   * @param {THREE.Vector3} center - Position vector
   * @param {THREE.Vector3} scaleVec - Scale vector
   * @param {THREE.Quaternion} rotationQuat - Rotation quaternion
   * @param {THREE.Vector4} colorVec - Color vector
   */
  static compressVertexData(
    vertexArrays,
    chunkArrays,
    index,
    chunkIndex,
    center,
    scaleVec,
    rotationQuat,
    colorVec
  ) {
    // Compress position
    // Normalize the position using the min/max values from the chunk
    const normalizedX =
      (center.x - chunkArrays.minX[chunkIndex]) /
      (chunkArrays.maxX[chunkIndex] - chunkArrays.minX[chunkIndex]);
    const normalizedY =
      (center.y - chunkArrays.minY[chunkIndex]) /
      (chunkArrays.maxY[chunkIndex] - chunkArrays.minY[chunkIndex]);
    const normalizedZ =
      (center.z - chunkArrays.minZ[chunkIndex]) /
      (chunkArrays.maxZ[chunkIndex] - chunkArrays.minZ[chunkIndex]);
    // Pack the normalized position into a 32-bit integer
    vertexArrays.position[index] = BitPacker.pack111011(
      normalizedX,
      normalizedY,
      normalizedZ
    );

    // Compress rotation
    // Pack the rotation quaternion into a 32-bit integer
    vertexArrays.rotation[index] = BitPacker.packRot(
      rotationQuat.x,
      rotationQuat.y,
      rotationQuat.z,
      rotationQuat.w
    );

    // Compress scale
    // Normalize the scale using the min/max values from the chunk
    // We use log scale for better precision with varying scale values
    const normalizedScaleX =
      (Math.log(scaleVec.x) - Math.log(chunkArrays.minScaleX[chunkIndex])) /
      (Math.log(chunkArrays.maxScaleX[chunkIndex]) -
        Math.log(chunkArrays.minScaleX[chunkIndex]));
    const normalizedScaleY =
      (Math.log(scaleVec.y) - Math.log(chunkArrays.minScaleY[chunkIndex])) /
      (Math.log(chunkArrays.maxScaleY[chunkIndex]) -
        Math.log(chunkArrays.minScaleY[chunkIndex]));
    const normalizedScaleZ =
      (Math.log(scaleVec.z) - Math.log(chunkArrays.minScaleZ[chunkIndex])) /
      (Math.log(chunkArrays.maxScaleZ[chunkIndex]) -
        Math.log(chunkArrays.minScaleZ[chunkIndex]));
    // Pack the normalized scale into a 32-bit integer
    vertexArrays.scale[index] = BitPacker.pack111011(
      normalizedScaleX,
      normalizedScaleY,
      normalizedScaleZ
    );

    // Compress color
    // Normalize the color using the min/max values from the chunk
    const normalizedR =
      (colorVec.x - chunkArrays.minR[chunkIndex]) /
      (chunkArrays.maxR[chunkIndex] - chunkArrays.minR[chunkIndex]);
    const normalizedG =
      (colorVec.y - chunkArrays.minG[chunkIndex]) /
      (chunkArrays.maxG[chunkIndex] - chunkArrays.minG[chunkIndex]);
    const normalizedB =
      (colorVec.z - chunkArrays.minB[chunkIndex]) /
      (chunkArrays.maxB[chunkIndex] - chunkArrays.minB[chunkIndex]);
    // Pack the normalized color into a 32-bit integer
    vertexArrays.color[index] = BitPacker.pack8888(
      normalizedR,
      normalizedG,
      normalizedB,
      colorVec.w
    );
  }

  /**
   * Write vertex data to the output buffer
   *
   * This function writes the compressed vertex data to the output buffer.
   *
   * @param {DataView} dataView - DataView for writing to the buffer
   * @param {number} offset - Current offset in the buffer
   * @param {Object} vertexArrays - Object containing vertex data arrays
   * @param {number} splatCount - Number of splats
   * @param {number} totalSize - Total size of the buffer
   * @returns {number} - New offset after writing vertex data
   */
  static writeVertexData(
    dataView,
    offset,
    vertexArrays,
    splatCount,
    totalSize
  ) {
    for (let i = 0; i < splatCount; i++) {
      // Check for buffer overflow
      if (offset + 16 > totalSize) {
        console.error(
          `Buffer overflow: offset ${offset} + 16 > totalSize ${totalSize}`
        );
        throw new Error(
          `Buffer overflow: offset ${offset} + 16 > totalSize ${totalSize}`
        );
      }

      // Write each vertex attribute (4 uints * 4 bytes = 16 bytes per vertex)
      dataView.setUint32(offset, vertexArrays.position[i], true);
      dataView.setUint32(offset + 4, vertexArrays.rotation[i], true);
      dataView.setUint32(offset + 8, vertexArrays.scale[i], true);
      dataView.setUint32(offset + 12, vertexArrays.color[i], true);

      // Move to the next vertex
      offset += 16;
    }
    return offset;
  }
}

/**
 * ============================================================================
 * SPHERICAL HARMONICS HANDLING
 * ============================================================================
 *
 * This class handles the management of spherical harmonics data, which is used
 * for lighting calculations. The data is compressed to reduce memory usage.
 */
class SphericalHarmonicsHandler {
  /**
   * Initialize spherical harmonics arrays
   *
   * This function creates arrays to store the compressed spherical harmonics data.
   *
   * @param {number} splatCount - Number of splats
   * @param {number} sphericalHarmonicsDegree - Degree of spherical harmonics
   * @returns {Array} - Array of Uint8Array for each spherical harmonics component
   */
  static initializeSphericalHarmonicsArrays(
    splatCount,
    sphericalHarmonicsDegree
  ) {
    let shArrays = [];
    if (sphericalHarmonicsDegree > 0) {
      // Calculate the number of spherical harmonics components
      const shCount = getSphericalHarmonicsComponentCountForDegree(
        sphericalHarmonicsDegree
      );
      // Create an array for each component
      for (let i = 0; i < shCount; i++) {
        shArrays.push(new Uint8Array(splatCount));
      }
    }
    return shArrays;
  }

  /**
   * Compress spherical harmonics data
   *
   * This function compresses the spherical harmonics data by normalizing it to
   * the range [0,255] and storing it as unsigned 8-bit integers.
   *
   * @param {Array} shArrays - Array of Uint8Array for each spherical harmonics component
   * @param {SplatBuffer} splatBuffer - The splat buffer
   * @param {number} index - Index of the splat
   * @param {number} sphericalHarmonicsDegree - Degree of spherical harmonics
   */
  static compressSphericalHarmonics(
    shArrays,
    splatBuffer,
    index,
    sphericalHarmonicsDegree
  ) {
    if (sphericalHarmonicsDegree > 0) {
      // Get spherical harmonics data from the splat buffer
      const shData = new Float32Array(
        getSphericalHarmonicsComponentCountForDegree(sphericalHarmonicsDegree)
      );
      splatBuffer.fillSphericalHarmonicsArray(
        shData,
        sphericalHarmonicsDegree,
        null, // transform
        index, // srcFrom
        index, // srcTo
        0, // destFrom
        0 // desiredOutputCompressionLevel
      );

      // Compress each component
      for (let j = 0; j < shData.length; j++) {
        // Normalize to 0-255 range (assuming values are in -4 to 4 range)
        const normalizedValue = (shData[j] + 4) / 8;
        shArrays[j][index] = Math.floor(normalizedValue * 255);
      }
    }
  }

  /**
   * Write spherical harmonics data to the output buffer
   *
   * This function writes the compressed spherical harmonics data to the output buffer.
   *
   * @param {DataView} dataView - DataView for writing to the buffer
   * @param {number} offset - Current offset in the buffer
   * @param {Array} shArrays - Array of Uint8Array for each spherical harmonics component
   * @param {number} splatCount - Number of splats
   * @param {number} totalSize - Total size of the buffer
   * @returns {number} - New offset after writing spherical harmonics data
   */
  static writeSphericalHarmonicsData(
    dataView,
    offset,
    shArrays,
    splatCount,
    totalSize
  ) {
    if (shArrays.length > 0) {
      for (let i = 0; i < splatCount; i++) {
        for (let j = 0; j < shArrays.length; j++) {
          // Check for buffer overflow
          if (offset + 1 > totalSize) {
            console.error(
              `Buffer overflow: offset ${offset} + 1 > totalSize ${totalSize}`
            );
            throw new Error(
              `Buffer overflow: offset ${offset} + 1 > totalSize ${totalSize}`
            );
          }
          // Write each spherical harmonics component (1 byte per component)
          dataView.setUint8(offset, shArrays[j][i]);
          offset += 1;
        }
      }
    }
    return offset;
  }
}

/**
 * ============================================================================
 * MAIN ENCODER CLASS
 * ============================================================================
 *
 * This class is the main entry point for encoding an UncompressedSplatBuffer
 * to a compressed PLY format. It orchestrates the encoding process using the
 * specialized classes above.
 */
export class PlayCanvasCompressedPlyEncoder {
  /**
   * Converts an UncompressedSplatBuffer to a compressed PLY format
   * This is the opposite of PlayCanvasCompressedPlyParser.parseToUncompressedSplatBuffer
   *
   * The encoding process consists of the following steps:
   * 1. Initialize arrays for storing compressed data
   * 2. First pass: collect min/max values for each chunk
   * 3. Second pass: compress the data using the min/max values
   * 4. Generate the PLY header
   * 5. Calculate buffer sizes
   * 6. Create the output buffer
   * 7. Write the header
   * 8. Write the data (chunks, vertices, spherical harmonics)
   * 9. Verify we didn't write beyond the buffer
   *
   * @param {SplatBuffer} splatBuffer - The uncompressed splat buffer to encode
   * @param {number} chunkSize - The size of each chunk (default: 256)
   * @returns {ArrayBuffer} - The compressed PLY data as an ArrayBuffer
   */
  static encodeToCompressedPly(splatBuffer, chunkSize = 256) {
    // Get the number of splats and the degree of spherical harmonics
    const splatCount = splatBuffer.getSplatCount();
    const sphericalHarmonicsDegree =
      splatBuffer.getMinSphericalHarmonicsDegree();

    // Calculate the number of chunks needed
    const chunkCount = Math.ceil(splatCount / chunkSize);

    // Initialize arrays for storing compressed data
    const vertexArrays = VertexDataHandler.initializeVertexArrays(splatCount);
    const chunkArrays = ChunkDataHandler.initializeChunkArrays(chunkCount);
    const shArrays =
      SphericalHarmonicsHandler.initializeSphericalHarmonicsArrays(
        splatCount,
        sphericalHarmonicsDegree
      );

    // Create arrays to store the raw data from the splat buffer
    const centerArray = new Float32Array(splatCount * 3);
    const scaleArray = new Float32Array(splatCount * 3);
    const rotationArray = new Float32Array(splatCount * 4);
    const colorArray = new Uint8Array(splatCount * 4);
    const shArray =
      sphericalHarmonicsDegree > 0
        ? new Float32Array(
            splatCount *
              getSphericalHarmonicsComponentCountForDegree(
                sphericalHarmonicsDegree
              )
          )
        : null;

    // Fill arrays with data from the splat buffer
    splatBuffer.fillSplatCenterArray(centerArray);
    splatBuffer.fillSplatScaleRotationArray(scaleArray, rotationArray);
    splatBuffer.fillSplatColorArray(colorArray);
    if (shArray) {
      splatBuffer.fillSphericalHarmonicsArray(
        shArray,
        sphericalHarmonicsDegree
      );
    }

    // First pass: collect min/max values for each chunk
    for (let i = 0; i < splatCount; i++) {
      const chunkIndex = Math.floor(i / chunkSize);

      // Extract data from the arrays
      const center = new THREE.Vector3(
        centerArray[i * 3],
        centerArray[i * 3 + 1],
        centerArray[i * 3 + 2]
      );

      const scaleVec = new THREE.Vector3(
        scaleArray[i * 3],
        scaleArray[i * 3 + 1],
        scaleArray[i * 3 + 2]
      );

      const colorVec = new THREE.Vector4(
        colorArray[i * 4],
        colorArray[i * 4 + 1],
        colorArray[i * 4 + 2],
        colorArray[i * 4 + 3]
      );

      // Update min/max for the chunk
      ChunkDataHandler.updateChunkMinMax(
        chunkArrays,
        chunkIndex,
        center,
        scaleVec,
        colorVec
      );
    }

    // Second pass: compress the data
    for (let i = 0; i < splatCount; i++) {
      const chunkIndex = Math.floor(i / chunkSize);

      // Extract data from the arrays
      const center = new THREE.Vector3(
        centerArray[i * 3],
        centerArray[i * 3 + 1],
        centerArray[i * 3 + 2]
      );

      const scaleVec = new THREE.Vector3(
        scaleArray[i * 3],
        scaleArray[i * 3 + 1],
        scaleArray[i * 3 + 2]
      );

      const rotationQuat = new THREE.Quaternion(
        rotationArray[i * 4],
        rotationArray[i * 4 + 1],
        rotationArray[i * 4 + 2],
        rotationArray[i * 4 + 3]
      );

      const colorVec = new THREE.Vector4(
        colorArray[i * 4],
        colorArray[i * 4 + 1],
        colorArray[i * 4 + 2],
        colorArray[i * 4 + 3]
      );

      // Compress vertex data
      VertexDataHandler.compressVertexData(
        vertexArrays,
        chunkArrays,
        i,
        chunkIndex,
        center,
        scaleVec,
        rotationQuat,
        colorVec
      );

      // Compress spherical harmonics data
      if (shArray) {
        const shComponentCount = getSphericalHarmonicsComponentCountForDegree(
          sphericalHarmonicsDegree
        );
        for (let j = 0; j < shComponentCount; j++) {
          // Normalize the SH value to [0, 1] range for 8-bit storage
          const shValue = shArray[i * shComponentCount + j];
          const normalizedValue = (shValue + 4) / 8; // Assuming SH values are in [-4, 4] range
          shArrays[j][i] = Math.floor(normalizedValue * 255);
        }
      }
    }

    // Generate the PLY header
    const headerText = PlyHeaderGenerator.generateHeader(
      chunkCount,
      splatCount,
      sphericalHarmonicsDegree
    );

    // Calculate buffer sizes
    const headerSize = headerText.length;
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

    // Create the output buffer and data view
    const outputBuffer = new ArrayBuffer(totalSize);
    const dataView = new DataView(outputBuffer);

    // Write the header
    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(headerText);
    const headerArray = new Uint8Array(outputBuffer, 0, headerSize);
    headerArray.set(headerBytes);

    // Write the data
    let offset = headerSize;

    // Write chunk data
    offset = ChunkDataHandler.writeChunkData(
      dataView,
      offset,
      chunkArrays,
      chunkCount
    );

    // Write vertex data
    offset = VertexDataHandler.writeVertexData(
      dataView,
      offset,
      vertexArrays,
      splatCount,
      totalSize
    );

    // Write spherical harmonics data
    offset = SphericalHarmonicsHandler.writeSphericalHarmonicsData(
      dataView,
      offset,
      shArrays,
      splatCount,
      totalSize
    );

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
