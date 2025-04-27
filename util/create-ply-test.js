import fs from "fs";
import path from "path";
import { PlayCanvasCompressedPlyParser } from "../src/loaders/ply/PlayCanvasCompressedPlyParser.js";
import { PlayCanvasCompressedPlyEncoder } from "../src/loaders/ply/PlayCanvasCompressedPlyEncoder.js";
import { PlyParserUtils } from "../src/loaders/ply/PlyParserUtils.js";
import { PlyFormat } from "../src/loaders/ply/PlyFormat.js";

// Function to convert Node.js Buffer to ArrayBuffer
function bufferToArrayBuffer(buffer) {
  // Create a new ArrayBuffer with the same size as the Buffer
  const arrayBuffer = new ArrayBuffer(buffer.length);

  // Create a Uint8Array view of the ArrayBuffer
  const uint8Array = new Uint8Array(arrayBuffer);

  // Copy the Buffer data to the Uint8Array
  for (let i = 0; i < buffer.length; i++) {
    uint8Array[i] = buffer[i];
  }

  return arrayBuffer;
}

// Function to convert ArrayBuffer to Node.js Buffer
function arrayBufferToBuffer(arrayBuffer) {
  return Buffer.from(arrayBuffer);
}

// Function to compare two ArrayBuffers
function compareArrayBuffers(buffer1, buffer2) {
  if (buffer1.byteLength !== buffer2.byteLength) {
    console.error(
      `Buffer size mismatch: ${buffer1.byteLength} vs ${buffer2.byteLength}`
    );
    console.error(
      `Difference: ${buffer1.byteLength - buffer2.byteLength} bytes`
    );

    // Analyze the structure of both files
    analyzePlyStructure(buffer1, "Original");
    analyzePlyStructure(buffer2, "Encoded");

    return false;
  }

  const view1 = new Uint8Array(buffer1);
  const view2 = new Uint8Array(buffer2);

  // Compare header (text part)
  let headerEndIndex = -1;
  for (let i = 0; i < view1.length; i++) {
    if (
      i + 10 < view1.length &&
      view1[i] === 101 && // 'e'
      view1[i + 1] === 110 && // 'n'
      view1[i + 2] === 100 && // 'd'
      view1[i + 3] === 95 && // '_'
      view1[i + 4] === 104 && // 'h'
      view1[i + 5] === 101 && // 'e'
      view1[i + 6] === 97 && // 'a'
      view1[i + 7] === 100 && // 'd'
      view1[i + 8] === 101 && // 'e'
      view1[i + 9] === 114 && // 'r'
      view1[i + 10] === 10
    ) {
      // '\n'
      headerEndIndex = i + 11;
      break;
    }
  }

  if (headerEndIndex === -1) {
    console.error("Could not find end of header in the first buffer");
    return false;
  }

  // Compare headers
  const header1 = new TextDecoder().decode(view1.slice(0, headerEndIndex));
  const header2 = new TextDecoder().decode(view2.slice(0, headerEndIndex));

  if (header1 !== header2) {
    console.error("Header mismatch:");
    console.error("Original header:", header1);
    console.error("Encoded header:", header2);

    // Compare header lines
    const headerLines1 = header1.split("\n");
    const headerLines2 = header2.split("\n");

    console.error("Header line comparison:");
    for (
      let i = 0;
      i < Math.max(headerLines1.length, headerLines2.length);
      i++
    ) {
      if (i >= headerLines1.length) {
        console.error(
          `Line ${i + 1}: Missing in original, present in encoded: "${
            headerLines2[i]
          }"`
        );
        continue;
      }
      if (i >= headerLines2.length) {
        console.error(
          `Line ${i + 1}: Present in original, missing in encoded: "${
            headerLines1[i]
          }"`
        );
        continue;
      }
      if (headerLines1[i] !== headerLines2[i]) {
        console.error(`Line ${i + 1}: Different`);
        console.error(`  Original: "${headerLines1[i]}"`);
        console.error(`  Encoded:  "${headerLines2[i]}"`);
      }
    }

    return false;
  }

  // Align to 4-byte boundary for data comparison
  const alignedOffset = Math.ceil(headerEndIndex / 4) * 4;

  // Compare data with more detailed logging
  for (let i = alignedOffset; i < view1.length; i++) {
    if (view1[i] !== view2[i]) {
      console.error(`Data mismatch at byte ${i}: ${view1[i]} vs ${view2[i]}`);
      console.error(
        `Context: ${i - alignedOffset} bytes from data section start`
      );
      // Log surrounding bytes for context
      const contextStart = Math.max(alignedOffset, i - 16);
      const contextEnd = Math.min(view1.length, i + 16);
      console.error(
        "Original context:",
        Array.from(view1.slice(contextStart, contextEnd))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ")
      );
      console.error(
        "Encoded context:",
        Array.from(view2.slice(contextStart, contextEnd))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ")
      );
      return false;
    }
  }

  return true;
}

// Function to analyze the structure of a PLY file
function analyzePlyStructure(buffer, label) {
  const view = new Uint8Array(buffer);

  // Find header end
  let headerEndIndex = -1;
  for (let i = 0; i < view.length; i++) {
    if (
      i + 10 < view.length &&
      view[i] === 101 && // 'e'
      view[i + 1] === 110 && // 'n'
      view[i + 2] === 100 && // 'd'
      view[i + 3] === 95 && // '_'
      view[i + 4] === 104 && // 'h'
      view[i + 5] === 101 && // 'e'
      view[i + 6] === 97 && // 'a'
      view[i + 7] === 100 && // 'd'
      view[i + 8] === 101 && // 'e'
      view[i + 9] === 114 && // 'r'
      view[i + 10] === 10
    ) {
      // '\n'
      headerEndIndex = i + 11;
      break;
    }
  }

  if (headerEndIndex === -1) {
    console.error(`Could not find end of header in the ${label} buffer`);
    return;
  }

  // Parse header
  const header = new TextDecoder().decode(view.slice(0, headerEndIndex));
  const headerLines = header.split("\n");

  console.log(`\n${label} PLY Structure Analysis:`);
  console.log(`Header size: ${headerEndIndex} bytes`);
  console.log(`Data size: ${buffer.byteLength - headerEndIndex} bytes`);
  console.log("\nHeader contents:");
  console.log(header);
  console.log("\nHeader line by line:");
  headerLines.forEach((line, i) => console.log(`${i + 1}: ${line}`));

  // Extract element counts
  let chunkCount = 0;
  let vertexCount = 0;
  let shCount = 0;
  let currentElement = null;

  for (const line of headerLines) {
    if (line.startsWith("element ")) {
      const parts = line.split(" ");
      currentElement = parts[1];
      const count = parseInt(parts[2], 10);

      if (currentElement === "chunk") {
        chunkCount = count;
      } else if (currentElement === "vertex") {
        vertexCount = count;
      } else if (currentElement === "sh") {
        shCount = count;
      }
    }
  }

  console.log(`Chunk count: ${chunkCount}`);
  console.log(`Vertex count: ${vertexCount}`);
  console.log(`Spherical harmonics count: ${shCount}`);

  // Calculate expected data sizes
  const alignedOffset = Math.ceil(headerEndIndex / 4) * 4;
  const chunkDataSize = chunkCount * 54; // 12 floats (4 bytes each) + 6 uchars
  const vertexDataSize = vertexCount * 16; // 4 uints (4 bytes each)
  const shDataSize = shCount * getSphericalHarmonicsComponentCount(header);

  console.log(`Expected chunk data size: ${chunkDataSize} bytes`);
  console.log(`Expected vertex data size: ${vertexDataSize} bytes`);
  console.log(`Expected SH data size: ${shDataSize} bytes`);
  console.log(
    `Total expected data size: ${
      chunkDataSize + vertexDataSize + shDataSize
    } bytes`
  );
  console.log(`Actual data size: ${buffer.byteLength - alignedOffset} bytes`);
}

// Helper function to get spherical harmonics component count from header
function getSphericalHarmonicsComponentCount(header) {
  const headerLines = header.split("\n");
  let shComponentCount = 0;

  for (const line of headerLines) {
    if (line.startsWith("property uchar f_rest_")) {
      shComponentCount++;
    }
  }

  return shComponentCount;
}

// Main test function
function testPlyRoundTrip(testPlyPath) {
  console.log(`Testing PLY round trip with file: ${testPlyPath}`);

  try {
    // Read the test PLY file as a Buffer and convert to ArrayBuffer
    const fileBuffer = fs.readFileSync(testPlyPath);

    const originalPlyBuffer = bufferToArrayBuffer(fileBuffer);

    console.log(
      `Read original PLY file: ${originalPlyBuffer.byteLength} bytes`
    );

    // Determine the PLY format
    const plyFormat =
      PlyParserUtils.determineHeaderFormatFromPlyBuffer(originalPlyBuffer);
    console.log(`PLY format: ${plyFormat}`);

    if (plyFormat !== PlyFormat.PlayCanvasCompressed) {
      console.error(
        `Test file is not in PlayCanvas Compressed format. Got: ${plyFormat}`
      );
      return false;
    }

    // Parse the PLY file to a splat buffer
    const splatBuffer =
      PlayCanvasCompressedPlyParser.parseToUncompressedSplatBuffer(
        originalPlyBuffer,
        2
      );
    console.log(`Parsed to splat buffer with ${splatBuffer.splatCount} splats`);

    // Encode the splat buffer back to a PLY buffer
    const encodedPlyBuffer =
      PlayCanvasCompressedPlyEncoder.encodeToCompressedPly(splatBuffer);
    console.log(`Encoded to PLY buffer: ${encodedPlyBuffer.byteLength} bytes`);

    // Compare the original and encoded PLY buffers
    const isMatch = compareArrayBuffers(fileBuffer, encodedPlyBuffer);

    if (isMatch) {
      console.log("✅ Test passed: Original and encoded PLY files match");
    } else {
      console.error(
        "❌ Test failed: Original and encoded PLY files do not match"
      );
    }

    // Save the encoded PLY file for manual inspection
    const outputPath = path.join(
      path.dirname(testPlyPath),
      "output_" + path.basename(testPlyPath)
    );
    // fs.writeFileSync(outputPath, encodedPlyBuffer);
    fs.writeFileSync(outputPath, arrayBufferToBuffer(encodedPlyBuffer));

    console.log(`Saved encoded PLY file to: ${outputPath}`);

    // Save the original PLY file for comparison
    const originalOutputPath = path.join(
      path.dirname(testPlyPath),
      "original_" + path.basename(testPlyPath)
    );
    fs.writeFileSync(originalOutputPath, fileBuffer);
    console.log(`Saved original PLY file to: ${originalOutputPath}`);

    return isMatch;
  } catch (error) {
    console.error("Error during test:", error);
    return false;
  }
}

// Run the test with the provided test.ply file
const testPlyPath = "./test.ply";
testPlyRoundTrip(testPlyPath);
