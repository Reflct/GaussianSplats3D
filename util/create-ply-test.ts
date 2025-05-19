import fs from "fs";
import { PlayCanvasCompressedPlyParser } from "../src/loaders/ply/PlayCanvasCompressedPlyParser";
import { PlayCanvasCompressedPlyEncoder } from "../src/loaders/ply/PlayCanvasCompressedPlyEncoder";

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < buffer.length; i++) {
    view[i] = buffer[i];
  }
  return arrayBuffer;
}

interface ChunkMismatch {
  position: { min: number; max: number };
  scale: { min: number; max: number };
  color: { min: number; max: number };
}

interface VertexMismatch {
  position: number;
  rotation: number;
  scale: number;
  color: number;
}

interface BufferMismatch {
  header: number;
  chunk: ChunkMismatch;
  vertex: VertexMismatch;
  sh: number;
}

function compareArrayBuffers(
  buffer1: ArrayBuffer,
  buffer2: ArrayBuffer
): BufferMismatch {
  if (buffer1.byteLength !== buffer2.byteLength) {
    console.log(
      `Buffer size mismatch: ${buffer1.byteLength} vs ${buffer2.byteLength}`
    );
    return {
      header: buffer1.byteLength,
      chunk: {
        position: { min: 0, max: 0 },
        scale: { min: 0, max: 0 },
        color: { min: 0, max: 0 },
      },
      vertex: {
        position: 0,
        rotation: 0,
        scale: 0,
        color: 0,
      },
      sh: 0,
    };
  }

  const view1 = new DataView(buffer1);
  const view2 = new DataView(buffer2);
  const headerSize = 1263; // PLY header size
  const chunkDataSize = 74808; // 1039 chunks * 72 bytes
  const vertexDataSize = 4254928; // 265933 vertices * 16 bytes
  const shDataSize = 6382392; // SH data size

  let mismatches: BufferMismatch = {
    header: 0,
    chunk: {
      position: { min: 0, max: 0 },
      scale: { min: 0, max: 0 },
      color: { min: 0, max: 0 },
    },
    vertex: {
      position: 0,
      rotation: 0,
      scale: 0,
      color: 0,
    },
    sh: 0,
  };

  // Compare header
  for (let i = 0; i < headerSize; i++) {
    if (view1.getUint8(i) !== view2.getUint8(i)) {
      mismatches.header++;
    }
  }

  // Compare chunk data
  for (let i = headerSize; i < headerSize + chunkDataSize; i += 72) {
    // Position min/max (6 floats)
    for (let j = 0; j < 6; j++) {
      if (
        view1.getFloat32(i + j * 4, true) !== view2.getFloat32(i + j * 4, true)
      ) {
        if (j < 3) {
          mismatches.chunk.position.min++;
        } else {
          mismatches.chunk.position.max++;
        }
      }
    }
    // Scale min/max (6 floats)
    for (let j = 6; j < 12; j++) {
      if (
        view1.getFloat32(i + j * 4, true) !== view2.getFloat32(i + j * 4, true)
      ) {
        if (j < 9) {
          mismatches.chunk.scale.min++;
        } else {
          mismatches.chunk.scale.max++;
        }
      }
    }
    // Color min/max (6 floats)
    for (let j = 12; j < 18; j++) {
      if (
        view1.getFloat32(i + j * 4, true) !== view2.getFloat32(i + j * 4, true)
      ) {
        if (j < 15) {
          mismatches.chunk.color.min++;
        } else {
          mismatches.chunk.color.max++;
        }
      }
    }
  }

  // Compare vertex data
  const vertexStart = headerSize + chunkDataSize;
  for (let i = vertexStart; i < vertexStart + vertexDataSize; i += 16) {
    // Position (1 uint)
    if (view1.getUint32(i, true) !== view2.getUint32(i, true)) {
      mismatches.vertex.position++;
    }
    // Rotation (1 uint)
    if (view1.getUint32(i + 4, true) !== view2.getUint32(i + 4, true)) {
      mismatches.vertex.rotation++;
    }
    // Scale (1 uint)
    if (view1.getUint32(i + 8, true) !== view2.getUint32(i + 8, true)) {
      mismatches.vertex.scale++;
    }
    // Color (1 uint)
    if (view1.getUint32(i + 12, true) !== view2.getUint32(i + 12, true)) {
      mismatches.vertex.color++;
    }
  }

  // Compare SH data
  const shStart = vertexStart + vertexDataSize;
  for (let i = shStart; i < shStart + shDataSize; i++) {
    if (view1.getUint8(i) !== view2.getUint8(i)) {
      mismatches.sh++;
    }
  }

  // Log detailed mismatch summary
  console.log("\nDetailed Mismatch Analysis:");
  console.log("==========================");
  console.log(`Header: ${mismatches.header} mismatches`);

  console.log("\nChunk Data:");
  console.log("  Position:");
  console.log(`    Min: ${mismatches.chunk.position.min} mismatches`);
  console.log(`    Max: ${mismatches.chunk.position.max} mismatches`);
  console.log("  Scale:");
  console.log(`    Min: ${mismatches.chunk.scale.min} mismatches`);
  console.log(`    Max: ${mismatches.chunk.scale.max} mismatches`);
  console.log("  Color:");
  console.log(`    Min: ${mismatches.chunk.color.min} mismatches`);
  console.log(`    Max: ${mismatches.chunk.color.max} mismatches`);

  console.log("\nVertex Data:");
  console.log(`  Position: ${mismatches.vertex.position} mismatches`);
  console.log(`  Rotation: ${mismatches.vertex.rotation} mismatches`);
  console.log(`  Scale: ${mismatches.vertex.scale} mismatches`);
  console.log(`  Color: ${mismatches.vertex.color} mismatches`);

  console.log("\nSpherical Harmonics:");
  console.log(`  Total: ${mismatches.sh} mismatches`);
  console.log(`  Components per splat: ${mismatches.sh / 265933}`);

  return mismatches;
}

function testPlyRoundTrip(testPlyPath: string): void {
  console.log("Testing PLY round trip...");
  const originalBuffer = fs.readFileSync(testPlyPath);
  const originalArrayBuffer = bufferToArrayBuffer(originalBuffer);

  // Parse header to get actual sizes
  const header =
    PlayCanvasCompressedPlyParser.decodeHeader(originalArrayBuffer);
  const headerSize = header.headerSizeBytes;

  // Calculate section sizes from header elements
  const chunkDataSize = header.chunkElement
    ? header.chunkElement.storageSizeBytes
    : 0;
  const vertexDataSize = header.vertexElement
    ? header.vertexElement.storageSizeBytes
    : 0;
  const shDataSize = header.shElement ? header.shElement.storageSizeBytes : 0;

  console.log("\nPLY Header Analysis:");
  console.log(`Header size: ${headerSize} bytes`);
  if (header.chunkElement) {
    console.log(
      `Chunk element: ${header.chunkElement.count} chunks, ${chunkDataSize} bytes`
    );
  }
  if (header.vertexElement) {
    console.log(
      `Vertex element: ${header.vertexElement.count} vertices, ${vertexDataSize} bytes`
    );
  }
  if (header.shElement) {
    console.log(
      `SH element: ${header.shElement.count} components, ${shDataSize} bytes`
    );
  }

  // Extract comments from the original header
  const originalHeaderText = new TextDecoder().decode(
    originalArrayBuffer.slice(0, headerSize)
  );
  originalHeaderText.split("\n").forEach((line, i) => {
    console.log(`${i + 1}: ${line}`);
  });

  const commentLines = originalHeaderText
    .split("\n")
    .filter((line) => line.startsWith("comment "))
    .map((line) => line.replace(/^comment /, ""));

  // Parse to splat buffer with SH degree 3
  const splatBuffer =
    PlayCanvasCompressedPlyParser.parseToUncompressedSplatBuffer(
      originalArrayBuffer,
      3
    );
  console.log("Parsed to splat buffer");

  // Encode back to PLY, passing comments
  const encodedBuffer = PlayCanvasCompressedPlyEncoder.encodeToCompressedPly(
    splatBuffer,
    commentLines
  );
  console.log("Encoded back to PLY");

  // Debug: Print raw header bytes
  const headerBytes = new Uint8Array(encodedBuffer.slice(0, 100));
  console.log(
    "Raw header bytes:",
    Array.from(headerBytes)
      .map((b) => String.fromCharCode(b))
      .join("")
  );

  // Save encoded PLY to file
  const outputBuffer = new Uint8Array(encodedBuffer);
  fs.writeFileSync("output.ply", outputBuffer);
  console.log("Saved encoded PLY to output.ply");

  // Print encoded header line by line
  console.log("\nENCODED PLY HEADER (line by line):");
  console.log("==================================");
  const encodedHeader =
    PlayCanvasCompressedPlyParser.decodeHeader(encodedBuffer);
  const encodedHeaderText = new TextDecoder().decode(
    encodedBuffer.slice(0, encodedHeader.headerSizeBytes)
  );
  encodedHeaderText.split("\n").forEach((line, i) => {
    console.log(`${i + 1}: ${line}`);
  });

  // Print original header line by line
  console.log("\nORIGINAL PLY HEADER (line by line):");
  console.log("==================================");
  const originalHeaderLines = originalHeaderText.split("\n");
  const encodedHeaderLines = encodedHeaderText.split("\n");
  let headerMismatchCount = 0;
  const maxHeaderLines = Math.max(
    originalHeaderLines.length,
    encodedHeaderLines.length
  );
  for (let i = 0; i < maxHeaderLines; i++) {
    const orig = originalHeaderLines[i] || "";
    const enc = encodedHeaderLines[i] || "";
    if (orig !== enc) {
      headerMismatchCount++;
      console.log(
        `Line ${i + 1}:\n  Original: '${orig}'\n  Encoded:  '${enc}'`
      );
    }
  }
  if (headerMismatchCount === 0) {
    console.log("Headers match exactly (line by line).");
  } else {
    console.log(`Total header line mismatches: ${headerMismatchCount}`);
  }

  // Byte-by-byte comparison
  console.log("\nBYTE-BY-BYTE COMPARISON:");
  console.log("========================");
  const minLength = Math.min(
    originalArrayBuffer.byteLength,
    encodedBuffer.byteLength
  );
  let byteMismatchCount = 0;
  for (let i = 0; i < minLength; i++) {
    if (
      new Uint8Array(originalArrayBuffer)[i] !==
      new Uint8Array(encodedBuffer)[i]
    ) {
      if (byteMismatchCount < 10) {
        console.log(
          `Byte ${i}: Original=${
            new Uint8Array(originalArrayBuffer)[i]
          }, Encoded=${new Uint8Array(encodedBuffer)[i]}`
        );
      }
      byteMismatchCount++;
    }
  }
  if (originalArrayBuffer.byteLength !== encodedBuffer.byteLength) {
    console.log(
      `File size mismatch: Original=${originalArrayBuffer.byteLength}, Encoded=${encodedBuffer.byteLength}`
    );
  }
  if (
    byteMismatchCount === 0 &&
    originalArrayBuffer.byteLength === encodedBuffer.byteLength
  ) {
    console.log("Files match exactly (byte by byte).");
  } else {
    console.log(`Total byte mismatches: ${byteMismatchCount}`);
  }

  // Compare buffers
  const comparison = compareArrayBuffers(originalArrayBuffer, encodedBuffer);

  // Print section sizes
  console.log("\nSection Sizes:");
  console.log("Original file:");
  console.log(`  Header: ${headerSize} bytes`);
  console.log(`  Chunk data: ${chunkDataSize} bytes`);
  console.log(`  Vertex data: ${vertexDataSize} bytes`);
  console.log(`  SH data: ${shDataSize} bytes`);
  console.log(
    `  Total data: ${chunkDataSize + vertexDataSize + shDataSize} bytes`
  );

  // Calculate encoded file section sizes
  const encodedDataSize =
    encodedBuffer.byteLength - encodedHeader.headerSizeBytes;
  const encodedChunkDataSize = encodedHeader.chunkElement
    ? encodedHeader.chunkElement.storageSizeBytes
    : 0;
  const encodedVertexDataSize = encodedHeader.vertexElement
    ? encodedHeader.vertexElement.storageSizeBytes
    : 0;
  const encodedShDataSize = encodedHeader.shElement
    ? encodedHeader.shElement.storageSizeBytes
    : 0;
  console.log("\nEncoded file:");
  console.log(`  Header: ${encodedHeader.headerSizeBytes} bytes`);
  console.log(`  Chunk data: ${encodedChunkDataSize} bytes`);
  console.log(`  Vertex data: ${encodedVertexDataSize} bytes`);
  console.log(`  SH data: ${encodedShDataSize} bytes`);
  console.log(`  Total data: ${encodedDataSize} bytes`);
  console.log(
    `  Difference: ${
      chunkDataSize + vertexDataSize + shDataSize - encodedDataSize
    } bytes`
  );

  // Write detailed summary to log.txt
  const logStream = fs.createWriteStream("log.txt");
  logStream.write("PLY Round Trip Test Summary\n");
  logStream.write("==========================\n\n");

  logStream.write("Buffer Size Comparison:\n");
  logStream.write(`Original size: ${originalArrayBuffer.byteLength} bytes\n`);
  logStream.write(`Encoded size: ${encodedBuffer.byteLength} bytes\n\n`);

  logStream.write("Detailed Mismatch Analysis:\n");
  logStream.write("==========================\n");
  logStream.write(`Header: ${comparison.header} mismatches\n\n`);

  logStream.write("Chunk Data:\n");
  logStream.write("  Position:\n");
  logStream.write(`    Min: ${comparison.chunk.position.min} mismatches\n`);
  logStream.write(`    Max: ${comparison.chunk.position.max} mismatches\n`);
  logStream.write("  Scale:\n");
  logStream.write(`    Min: ${comparison.chunk.scale.min} mismatches\n`);
  logStream.write(`    Max: ${comparison.chunk.scale.max} mismatches\n`);
  logStream.write("  Color:\n");
  logStream.write(`    Min: ${comparison.chunk.color.min} mismatches\n`);
  logStream.write(`    Max: ${comparison.chunk.color.max} mismatches\n\n`);

  logStream.write("Vertex Data:\n");
  logStream.write(`  Position: ${comparison.vertex.position} mismatches\n`);
  logStream.write(`  Rotation: ${comparison.vertex.rotation} mismatches\n`);
  logStream.write(`  Scale: ${comparison.vertex.scale} mismatches\n`);
  logStream.write(`  Color: ${comparison.vertex.color} mismatches\n\n`);

  logStream.write("Spherical Harmonics:\n");
  logStream.write(`  Total: ${comparison.sh} mismatches\n`);
  logStream.write(`  Components per splat: ${comparison.sh / 265933}\n\n`);

  logStream.end();
}

// Run the test
const testPlyPath = process.argv[2];
if (!testPlyPath) {
  console.error("Please provide a PLY file path as an argument");
  process.exit(1);
}

testPlyRoundTrip(testPlyPath);
