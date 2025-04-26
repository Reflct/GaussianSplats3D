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
    return false;
  }

  // Align to 4-byte boundary for data comparison
  const alignedOffset = Math.ceil(headerEndIndex / 4) * 4;

  // Compare data
  for (let i = alignedOffset; i < view1.length; i++) {
    if (view1[i] !== view2[i]) {
      console.error(`Data mismatch at byte ${i}: ${view1[i]} vs ${view2[i]}`);
      return false;
    }
  }

  return true;
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

    return isMatch;
  } catch (error) {
    console.error("Error during test:", error);
    return false;
  }
}

// Run the test with the provided test.ply file
const testPlyPath = "./test.ply";
testPlyRoundTrip(testPlyPath);
