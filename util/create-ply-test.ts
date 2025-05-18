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

  // Parse to splat buffer with SH degree 3
  const splatBuffer =
    PlayCanvasCompressedPlyParser.parseToUncompressedSplatBuffer(
      originalArrayBuffer,
      3
    );
  console.log("Parsed to splat buffer");

  // Encode back to PLY
  const encodedBuffer =
    PlayCanvasCompressedPlyEncoder.encodeToCompressedPly(splatBuffer);
  console.log("Encoded back to PLY");

  // Compare buffers
  const comparison = compareArrayBuffers(originalArrayBuffer, encodedBuffer);

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
