import * as THREE from "three";
import { SplatBuffer } from "../SplatBuffer.js";
import { SplatBufferGenerator } from "../SplatBufferGenerator.js";
import { SplatParser } from "./SplatParser.js";
import {
  fetchWithProgress,
  delayedExecute,
  nativePromiseWithExtractedComponents,
} from "../../Util.js";
import { UncompressedSplatArray } from "../UncompressedSplatArray.js";
import { LoaderStatus } from "../LoaderStatus.js";
import { DirectLoadError } from "../DirectLoadError.js";
import { Constants } from "../../Constants.js";
import { InternalLoadType } from "../InternalLoadType.js";
import { AbortablePromise } from "../../AbortablePromise.js";

/**
 * Finalizes the splat data processing
 * @param splatData - The uncompressed splat data
 * @param optimizeSplatData - Whether to optimize the splat data
 * @param minimumAlpha - Minimum alpha value for splats
 * @param compressionLevel - Compression level
 * @param sectionSize - Section size for optimization
 * @param sceneCenter - Center of the scene
 * @param blockSize - Block size for optimization
 * @param bucketSize - Bucket size for optimization
 * @returns Processed splat buffer
 */
function finalize(
  splatData: UncompressedSplatArray,
  optimizeSplatData: boolean,
  minimumAlpha: number,
  compressionLevel: number,
  sectionSize?: number,
  sceneCenter?: THREE.Vector3,
  blockSize?: number,
  bucketSize?: number
): SplatBuffer {
  if (optimizeSplatData) {
    const splatBufferGenerator = SplatBufferGenerator.getStandardGenerator(
      minimumAlpha,
      compressionLevel,
      sectionSize,
      sceneCenter,
      blockSize,
      bucketSize
    );
    return splatBufferGenerator.generateFromUncompressedSplatArray(splatData);
  } else {
    // TODO: Implement direct-to-SplatBuffer when not optimizing splat data
    return SplatBuffer.generateFromUncompressedSplatArrays(
      [splatData],
      minimumAlpha,
      0,
      new THREE.Vector3()
    );
  }
}

export class SplatLoader {
  /**
   * Load a splat file from a URL
   * @param fileName - URL of the splat file
   * @param onProgress - Progress callback
   * @param progressiveLoadToSplatBuffer - Whether to load progressively to a splat buffer
   * @param onProgressiveLoadSectionProgress - Progress callback for progressive loading sections
   * @param minimumAlpha - Minimum alpha value for splats
   * @param compressionLevel - Compression level
   * @param optimizeSplatData - Whether to optimize the splat data
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
    progressiveLoadToSplatBuffer?: boolean,
    onProgressiveLoadSectionProgress?: (
      buffer: SplatBuffer,
      complete: boolean
    ) => void,
    minimumAlpha?: number,
    compressionLevel?: number,
    optimizeSplatData: boolean = true,
    headers?: Record<string, string>,
    sectionSize?: number,
    sceneCenter?: THREE.Vector3,
    blockSize?: number,
    bucketSize?: number
  ): AbortablePromise<SplatBuffer | undefined> {
    let internalLoadType: number = progressiveLoadToSplatBuffer
      ? InternalLoadType.ProgressiveToSplatBuffer
      : InternalLoadType.ProgressiveToSplatArray;
    if (optimizeSplatData)
      internalLoadType = InternalLoadType.ProgressiveToSplatArray;

    const splatDataOffsetBytes =
      SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes;
    const directLoadSectionSizeBytes = Constants.ProgressiveLoadSectionSize;
    const sectionCount = 1;

    let directLoadBufferIn: ArrayBuffer;
    let directLoadBufferOut: ArrayBuffer;
    let directLoadSplatBuffer: SplatBuffer;
    let maxSplatCount = 0;
    let splatCount = 0;

    let standardLoadUncompressedSplatArray: UncompressedSplatArray;

    const loadPromise = nativePromiseWithExtractedComponents<
      SplatBuffer | UncompressedSplatArray | Uint8Array[]
    >();

    let numBytesStreamed = 0;
    let numBytesLoaded = 0;
    let chunks: ArrayBuffer[] = [];

    const localOnProgress = (
      percent: number,
      percentStr: string,
      chunk?: Uint8Array<ArrayBuffer>,
      fileSize?: number
    ): void => {
      const loadComplete = percent >= 100;

      if (chunk) {
        chunks.push(chunk.buffer);
      }

      if (internalLoadType === InternalLoadType.DownloadBeforeProcessing) {
        if (loadComplete) {
          loadPromise.resolve(chunks as unknown as Uint8Array[]);
        }
        return;
      }

      if (!fileSize) {
        if (progressiveLoadToSplatBuffer) {
          throw new DirectLoadError(
            "Cannot directly load .splat because no file size info is available."
          );
        } else {
          internalLoadType = InternalLoadType.DownloadBeforeProcessing;
          return;
        }
      }

      if (!directLoadBufferIn) {
        maxSplatCount = fileSize / SplatParser.RowSizeBytes;
        directLoadBufferIn = new ArrayBuffer(fileSize);
        const bytesPerSplat =
          SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[0]
            .BytesPerSplat;
        const splatBufferSizeBytes =
          splatDataOffsetBytes + bytesPerSplat * maxSplatCount;

        if (internalLoadType === InternalLoadType.ProgressiveToSplatBuffer) {
          directLoadBufferOut = new ArrayBuffer(splatBufferSizeBytes);
          SplatBuffer.writeHeaderToBuffer(
            {
              versionMajor: SplatBuffer.CurrentMajorVersion,
              versionMinor: SplatBuffer.CurrentMinorVersion,
              maxSectionCount: sectionCount,
              sectionCount: sectionCount,
              maxSplatCount: maxSplatCount,
              splatCount: splatCount,
              compressionLevel: 0,
              sceneCenter: new THREE.Vector3(),
            },
            directLoadBufferOut
          );
        } else {
          standardLoadUncompressedSplatArray = new UncompressedSplatArray(0);
        }
      }

      if (chunk) {
        new Uint8Array(
          directLoadBufferIn,
          numBytesLoaded,
          chunk.byteLength
        ).set(new Uint8Array(chunk));
        numBytesLoaded += chunk.byteLength;

        const bytesLoadedSinceLastSection = numBytesLoaded - numBytesStreamed;
        if (
          bytesLoadedSinceLastSection > directLoadSectionSizeBytes ||
          loadComplete
        ) {
          const bytesToUpdate = loadComplete
            ? bytesLoadedSinceLastSection
            : directLoadSectionSizeBytes;
          const addedSplatCount = bytesToUpdate / SplatParser.RowSizeBytes;
          const newSplatCount = splatCount + addedSplatCount;

          if (internalLoadType === InternalLoadType.ProgressiveToSplatBuffer) {
            SplatParser.parseToUncompressedSplatBufferSection(
              splatCount,
              newSplatCount - 1,
              directLoadBufferIn,
              0,
              directLoadBufferOut,
              splatDataOffsetBytes
            );
          } else {
            SplatParser.parseToUncompressedSplatArraySection(
              splatCount,
              newSplatCount - 1,
              directLoadBufferIn,
              0,
              standardLoadUncompressedSplatArray
            );
          }

          splatCount = newSplatCount;

          if (internalLoadType === InternalLoadType.ProgressiveToSplatBuffer) {
            if (!directLoadSplatBuffer) {
              SplatBuffer.writeSectionHeaderToBuffer(
                {
                  maxSplatCount: maxSplatCount,
                  splatCount: splatCount,
                  bucketSize: 0,
                  bucketCount: 0,
                  halfBucketBlockSize: 0,
                  compressionScaleRange: 0,
                  storageSizeBytes: 0,
                  fullBucketCount: 0,
                  partiallyFilledBucketCount: 0,
                  compressionLevel: 0,
                  bucketsAllocated: 0,
                  validBucketCount: 0,
                  bytesPerSplat: 0,
                  sphericalHarmonicsDegree: 0,
                  sphericalHarmonicsCount: 0,
                  partiallyFilledBucketLengths: [],
                  dataOffset: 0,
                  dataSize: 0,
                  storedBucketBlockSize: 0,
                  bufferOffset: 0,
                },
                0,
                directLoadBufferOut,
                SplatBuffer.HeaderSizeBytes
              );
              directLoadSplatBuffer = new SplatBuffer(
                directLoadBufferOut,
                false
              );
            }
            directLoadSplatBuffer.updateLoadedCounts(1, splatCount);
            if (onProgressiveLoadSectionProgress) {
              onProgressiveLoadSectionProgress(
                directLoadSplatBuffer,
                loadComplete
              );
            }
          }

          numBytesStreamed += directLoadSectionSizeBytes;
        }
      }

      if (loadComplete) {
        if (internalLoadType === InternalLoadType.ProgressiveToSplatBuffer) {
          loadPromise.resolve(directLoadSplatBuffer);
        } else {
          loadPromise.resolve(standardLoadUncompressedSplatArray);
        }
      }

      if (onProgress) onProgress(percent, percentStr, LoaderStatus.Downloading);
    };

    if (onProgress) onProgress(0, "0%", LoaderStatus.Downloading);
    return fetchWithProgress(fileName, localOnProgress, false, headers).then(
      () => {
        if (onProgress) onProgress(0, "0%", LoaderStatus.Processing);
        return loadPromise.promise.then((splatData) => {
          if (onProgress) onProgress(100, "100%", LoaderStatus.Done);
          if (internalLoadType === InternalLoadType.DownloadBeforeProcessing) {
            return new Blob(chunks).arrayBuffer().then((splatData) => {
              return SplatLoader.loadFromFileData(
                splatData,
                minimumAlpha!,
                compressionLevel!,
                optimizeSplatData,
                sectionSize,
                sceneCenter,
                blockSize,
                bucketSize
              );
            });
          } else if (
            internalLoadType === InternalLoadType.ProgressiveToSplatBuffer
          ) {
            return splatData as SplatBuffer;
          } else {
            return delayedExecute(() => {
              return finalize(
                splatData as UncompressedSplatArray,
                optimizeSplatData,
                minimumAlpha!,
                compressionLevel!,
                sectionSize,
                sceneCenter,
                blockSize,
                bucketSize
              );
            });
          }
        });
      }
    );
  }

  /**
   * Load a splat file from file data
   * @param splatFileData - The splat file data as an ArrayBuffer
   * @param minimumAlpha - Minimum alpha value for splats
   * @param compressionLevel - Compression level
   * @param optimizeSplatData - Whether to optimize the splat data
   * @param sectionSize - Section size for optimization
   * @param sceneCenter - Center of the scene
   * @param blockSize - Block size for optimization
   * @param bucketSize - Bucket size for optimization
   * @returns Promise that resolves to the loaded splat buffer
   */
  static loadFromFileData(
    splatFileData: ArrayBuffer,
    minimumAlpha: number,
    compressionLevel: number,
    optimizeSplatData: boolean,
    sectionSize?: number,
    sceneCenter?: THREE.Vector3,
    blockSize?: number,
    bucketSize?: number
  ): Promise<SplatBuffer | undefined> {
    return delayedExecute(() => {
      const splatArray =
        SplatParser.parseStandardSplatToUncompressedSplatArray(splatFileData);
      if (!splatArray) return undefined;
      return finalize(
        splatArray,
        optimizeSplatData,
        minimumAlpha,
        compressionLevel,
        sectionSize,
        sceneCenter,
        blockSize,
        bucketSize
      );
    });
  }
}
