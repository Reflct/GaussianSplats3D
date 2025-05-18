import * as THREE from "three";
import { SplatPartitioner } from "./SplatPartitioner";
import { SplatBuffer } from "./SplatBuffer";
import { UncompressedSplatArray } from "./UncompressedSplatArray";

export class SplatBufferGenerator {
  splatPartitioner: SplatPartitioner;
  alphaRemovalThreshold: number;
  compressionLevel: number;
  sectionSize: number;
  sceneCenter?: THREE.Vector3;
  blockSize: number;
  bucketSize: number;

  constructor(
    splatPartitioner: SplatPartitioner,
    alphaRemovalThreshold: number,
    compressionLevel: number,
    sectionSize: number,
    sceneCenter?: THREE.Vector3,
    blockSize?: number,
    bucketSize?: number
  ) {
    this.splatPartitioner = splatPartitioner;
    this.alphaRemovalThreshold = alphaRemovalThreshold;
    this.compressionLevel = compressionLevel;
    this.sectionSize = sectionSize;
    this.sceneCenter = sceneCenter
      ? new THREE.Vector3().copy(sceneCenter)
      : undefined;
    this.blockSize = blockSize || SplatBuffer.BucketBlockSize;
    this.bucketSize = bucketSize || SplatBuffer.BucketSize;
  }

  generateFromUncompressedSplatArray(
    splatArray: UncompressedSplatArray
  ): SplatBuffer {
    const partitionResults =
      this.splatPartitioner.partitionUncompressedSplatArray(splatArray);
    return SplatBuffer.generateFromUncompressedSplatArrays(
      partitionResults.splatArrays,
      this.alphaRemovalThreshold,
      this.compressionLevel,
      this.sceneCenter || new THREE.Vector3(),
      this.blockSize,
      this.bucketSize,
      partitionResults.parameters
    );
  }

  static getStandardGenerator(
    alphaRemovalThreshold: number = 1,
    compressionLevel: number = 1,
    sectionSize: number = 0,
    sceneCenter: THREE.Vector3 = new THREE.Vector3(),
    blockSize: number = SplatBuffer.BucketBlockSize,
    bucketSize: number = SplatBuffer.BucketSize
  ): SplatBufferGenerator {
    const splatPartitioner = SplatPartitioner.getStandardPartitioner(
      sectionSize,
      sceneCenter,
      blockSize,
      bucketSize
    );
    return new SplatBufferGenerator(
      splatPartitioner,
      alphaRemovalThreshold,
      compressionLevel,
      sectionSize,
      sceneCenter,
      blockSize,
      bucketSize
    );
  }
}
