import * as THREE from "three";
import { PlyParser } from "./PlyParser";
import { PlyParserUtils } from "./PlyParserUtils";
import { INRIAV1PlyParser } from "./INRIAV1PlyParser";
import { PlayCanvasCompressedPlyParser } from "./PlayCanvasCompressedPlyParser";
import { PlyFormat } from "./PlyFormat";
import {
  fetchWithProgress,
  delayedExecute,
  nativePromiseWithExtractedComponents,
} from "../../Util";
import { SplatBuffer, SplatBufferSection } from "../SplatBuffer";
import { SplatBufferGenerator } from "../SplatBufferGenerator";
import { LoaderStatus } from "../LoaderStatus";
import { DirectLoadError } from "../DirectLoadError";
import { Constants } from "../../Constants";
import { UncompressedSplatArray } from "../UncompressedSplatArray";
import { InternalLoadType } from "../InternalLoadType";
import { AbortablePromise } from "../../AbortablePromise";

/**
 * Interface for INRIA V1 PLY header
 */
interface INRIAV1Header {
  headerLines: string[];
  headerStartLine: number;
  headerEndLine: number;
  fieldTypes: number[];
  fieldIds: number[];
  fieldOffsets: number[];
  bytesPerVertex: number;
  vertexCount: number;
  dataSizeBytes: number;
  endOfHeader: boolean;
  sectionName: string | null;
  sphericalHarmonicsDegree: number;
  sphericalHarmonicsCoefficientsPerChannel: number;
  sphericalHarmonicsDegree1Fields: number[];
  sphericalHarmonicsDegree2Fields: number[];
  splatCount: number;
  bytesPerSplat: number;
  fieldsToReadIndexes: number[];
  headerText?: string;
  headerSizeBytes: number;
}

/**
 * Define a union type for all possible TypedArrays or undefined or null
 */
export type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | undefined
  | null;

/**
 * Refined TypedArray type that excludes undefined and null for use in function parameters
 */
export type NonNullableTypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

/**

/**
 * Interface for PLY property
 */
export interface PlyProperty {
  type: string;
  name: string;
  storage: TypedArray;
  byteSize: number;
  storageSizeByes: number;
}

/**
 * Interface for PLY element
 */
export interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
  storageSizeBytes: number;
}

/**
 * Interface for PlayCanvas compressed PLY header
 */
export interface PlayCanvasHeader {
  headerSizeBytes: number;
  bytesPerSplat: number;
  chunkElement?: PlyElement;
  vertexElement?: PlyElement;
  shElement?: PlyElement;
  sphericalHarmonicsDegree: number;
  sphericalHarmonicsPerSplat: number;
}

/**
 * Type for PLY header in different formats
 */
type PlyHeader = INRIAV1Header | PlayCanvasHeader;

/**
 * Interface for a data chunk
 */
interface DataChunk {
  data: Uint8Array<ArrayBuffer>;
  sizeBytes: number;
  startBytes: number;
  endBytes: number;
}

/**
 * Interface for buffer header
 */
interface BufferHeader {
  versionMajor: number;
  versionMinor: number;
  maxSectionCount: number;
  sectionCount: number;
  maxSplatCount: number;
  splatCount: number;
  compressionLevel: number;
  sceneCenter: THREE.Vector3;
}

/**
 * Interface for section header
 */
interface SectionHeader {
  maxSplatCount: number;
  splatCount: number;
  bucketSize: number;
  bucketCount: number;
  halfBucketBlockSize: number;
  compressionScaleRange: number;
  storageSizeBytes: number;
  fullBucketCount: number;
  partiallyFilledBucketCount: number;
  sphericalHarmonicsDegree: number;
  compressionLevel?: number;
  bucketsAllocated?: number;
  validBucketCount?: number;
  bytesPerSplat?: number;
}

/**
 * Stores chunks of data in a buffer
 * @param chunks - Array of data chunks
 * @param buffer - Optional existing buffer to store data in
 * @returns Buffer containing the chunk data
 */
function storeChunksInBuffer(
  chunks: DataChunk[],
  buffer?: ArrayBuffer
): ArrayBuffer {
  let inBytes = 0;
  for (let chunk of chunks) inBytes += chunk.sizeBytes;

  if (!buffer || buffer.byteLength < inBytes) {
    buffer = new ArrayBuffer(inBytes);
  }

  let offset = 0;
  for (let chunk of chunks) {
    new Uint8Array(buffer, offset, chunk.sizeBytes).set(chunk.data);
    offset += chunk.sizeBytes;
  }

  return buffer;
}

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
    return SplatBuffer.generateFromUncompressedSplatArrays(
      [splatData],
      minimumAlpha,
      0,
      new THREE.Vector3()
    );
  }
}

/**
 * Type guard to check if the header is an INRIAV1Header
 */
function isINRIAV1Header(header: PlyHeader | null): header is INRIAV1Header {
  return header !== null && "vertexCount" in header;
}

/**
 * Type guard to check if the header is a PlayCanvasHeader
 */
function isPlayCanvasHeader(
  header: PlyHeader | null
): header is PlayCanvasHeader {
  return header !== null && "vertexElement" in header;
}

/**
 * PlyLoader class for loading and processing PLY files
 */
export class PlyLoader {
  /**
   * Load a PLY file from a URL
   * @param fileName - URL of the PLY file
   * @param onProgress - Progress callback
   * @param progressiveLoadToSplatBuffer - Whether to load progressively to a splat buffer
   * @param onProgressiveLoadSectionProgress - Progress callback for progressive loading sections
   * @param minimumAlpha - Minimum alpha value for splats
   * @param compressionLevel - Compression level
   * @param optimizeSplatData - Whether to optimize the splat data
   * @param outSphericalHarmonicsDegree - Output spherical harmonics degree
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
      percentLabel: string,
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
    outSphericalHarmonicsDegree: number = 0,
    headers?: Record<string, string>,
    sectionSize?: number,
    sceneCenter?: THREE.Vector3,
    blockSize?: number,
    bucketSize?: number
  ): AbortablePromise<SplatBuffer | ArrayBuffer | undefined> {
    let internalLoadType: number;
    if (!progressiveLoadToSplatBuffer && !optimizeSplatData) {
      internalLoadType = InternalLoadType.DownloadBeforeProcessing;
    } else {
      if (optimizeSplatData)
        internalLoadType = InternalLoadType.ProgressiveToSplatArray;
      else internalLoadType = InternalLoadType.ProgressiveToSplatBuffer;
    }

    const directLoadSectionSizeBytes = Constants.ProgressiveLoadSectionSize;
    const splatBufferDataOffsetBytes =
      SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes;
    const sectionCount = 1;

    let plyFormat: number;
    let directLoadBufferIn: ArrayBuffer;
    let directLoadBufferOut: ArrayBuffer;
    let directLoadSplatBuffer: SplatBuffer;
    let compressedPlyHeaderChunksBuffer: ArrayBuffer;
    let maxSplatCount = 0;
    let processedBaseSplatCount = 0;
    let processedSphericalHarmonicsSplatCount = 0;

    let headerLoaded = false;
    let readyToLoadSplatData = false;
    let baseSplatDataLoaded = false;

    const loadPromise = nativePromiseWithExtractedComponents<
      SplatBuffer | UncompressedSplatArray | DataChunk[]
    >();

    let numBytesStreamed = 0;
    let numBytesParsed = 0;
    let numBytesDownloaded = 0;
    let endOfBaseSplatDataBytes = 0;
    let headerText = "";
    let header: PlyHeader | null = null;
    let chunks: DataChunk[] = [];

    let standardLoadUncompressedSplatArray: UncompressedSplatArray;

    const textDecoder = new TextDecoder();

    const localOnProgress = (
      percent: number,
      percentLabel: string,
      chunkData?: Uint8Array<ArrayBuffer>
    ): void => {
      const loadComplete = percent >= 100;

      if (chunkData) {
        chunks.push({
          data: chunkData,
          sizeBytes: chunkData.byteLength,
          startBytes: numBytesDownloaded,
          endBytes: numBytesDownloaded + chunkData.byteLength,
        });
        numBytesDownloaded += chunkData.byteLength;
      }

      if (internalLoadType === InternalLoadType.DownloadBeforeProcessing) {
        if (loadComplete) {
          loadPromise.resolve(chunks);
        }
      } else {
        if (!headerLoaded) {
          headerText += textDecoder.decode(chunkData);
          if (PlyParserUtils.checkTextForEndHeader(headerText)) {
            plyFormat =
              PlyParserUtils.determineHeaderFormatFromHeaderText(headerText);
            if (plyFormat === PlyFormat.INRIAV1) {
              const inriaHeader = INRIAV1PlyParser.decodeHeaderText(
                headerText
              ) as INRIAV1Header;
              header = inriaHeader;
              outSphericalHarmonicsDegree = Math.min(
                outSphericalHarmonicsDegree,
                inriaHeader.sphericalHarmonicsDegree
              );
              maxSplatCount = inriaHeader.splatCount;
              readyToLoadSplatData = true;
              endOfBaseSplatDataBytes =
                inriaHeader.headerSizeBytes +
                inriaHeader.bytesPerSplat * maxSplatCount;
            } else if (plyFormat === PlyFormat.PlayCanvasCompressed) {
              const playCanvasHeader =
                PlayCanvasCompressedPlyParser.decodeHeaderText(
                  headerText
                ) as PlayCanvasHeader;
              header = playCanvasHeader;
              outSphericalHarmonicsDegree = Math.min(
                outSphericalHarmonicsDegree,
                playCanvasHeader.sphericalHarmonicsDegree
              );
              if (
                internalLoadType ===
                  InternalLoadType.ProgressiveToSplatBuffer &&
                outSphericalHarmonicsDegree > 0
              ) {
                throw new DirectLoadError(
                  "PlyLoader.loadFromURL() -> Selected PLY format has spherical " +
                    "harmonics data that cannot be progressively loaded."
                );
              }
              maxSplatCount = playCanvasHeader.vertexElement?.count ?? 0;
              endOfBaseSplatDataBytes =
                playCanvasHeader.headerSizeBytes +
                playCanvasHeader.bytesPerSplat * maxSplatCount +
                (playCanvasHeader.chunkElement?.storageSizeBytes ?? 0);
            } else {
              if (
                internalLoadType === InternalLoadType.ProgressiveToSplatBuffer
              ) {
                throw new DirectLoadError(
                  "PlyLoader.loadFromURL() -> Selected PLY format cannot be progressively loaded."
                );
              } else {
                internalLoadType = InternalLoadType.DownloadBeforeProcessing;
                return;
              }
            }

            if (
              internalLoadType === InternalLoadType.ProgressiveToSplatBuffer
            ) {
              const shDescriptor =
                SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[
                  outSphericalHarmonicsDegree
                ];
              const splatBufferSizeBytes =
                splatBufferDataOffsetBytes +
                shDescriptor.BytesPerSplat * maxSplatCount;
              directLoadBufferOut = new ArrayBuffer(splatBufferSizeBytes);
              SplatBuffer.writeHeaderToBuffer(
                {
                  versionMajor: SplatBuffer.CurrentMajorVersion,
                  versionMinor: SplatBuffer.CurrentMinorVersion,
                  maxSectionCount: sectionCount,
                  sectionCount: sectionCount,
                  maxSplatCount: maxSplatCount,
                  splatCount: 0,
                  compressionLevel: 0,
                  sceneCenter: new THREE.Vector3(),
                },
                directLoadBufferOut
              );
            } else {
              standardLoadUncompressedSplatArray = new UncompressedSplatArray(
                outSphericalHarmonicsDegree
              );
            }

            if (header) {
              numBytesStreamed = header.headerSizeBytes;
              numBytesParsed = header.headerSizeBytes;
            }
            headerLoaded = true;
          }
        } else if (
          plyFormat === PlyFormat.PlayCanvasCompressed &&
          !readyToLoadSplatData &&
          header !== null &&
          isPlayCanvasHeader(header)
        ) {
          const sizeRequiredForHeaderAndChunks =
            header.headerSizeBytes +
            (header.chunkElement?.storageSizeBytes ?? 0);
          compressedPlyHeaderChunksBuffer = storeChunksInBuffer(
            chunks,
            compressedPlyHeaderChunksBuffer
          );
          if (
            compressedPlyHeaderChunksBuffer.byteLength >=
            sizeRequiredForHeaderAndChunks
          ) {
            PlayCanvasCompressedPlyParser.readElementData(
              header.chunkElement,
              compressedPlyHeaderChunksBuffer,
              header.headerSizeBytes
            );
            numBytesStreamed = sizeRequiredForHeaderAndChunks;
            numBytesParsed = sizeRequiredForHeaderAndChunks;
            readyToLoadSplatData = true;
          }
        }

        if (
          headerLoaded &&
          readyToLoadSplatData &&
          chunks.length > 0 &&
          header !== null
        ) {
          directLoadBufferIn = storeChunksInBuffer(chunks, directLoadBufferIn);

          const bytesLoadedSinceLastStreamedSection =
            numBytesDownloaded - numBytesStreamed;
          if (
            bytesLoadedSinceLastStreamedSection > directLoadSectionSizeBytes ||
            (numBytesDownloaded >= endOfBaseSplatDataBytes &&
              !baseSplatDataLoaded) ||
            loadComplete
          ) {
            const bytesPerSplat = baseSplatDataLoaded
              ? isPlayCanvasHeader(header)
                ? header.sphericalHarmonicsPerSplat
                : 0
              : header.bytesPerSplat;
            const endOfBytesToProcess = baseSplatDataLoaded
              ? numBytesDownloaded
              : Math.min(endOfBaseSplatDataBytes, numBytesDownloaded);
            const numBytesToProcess = endOfBytesToProcess - numBytesParsed;
            const addedSplatCount = Math.floor(
              numBytesToProcess / bytesPerSplat
            );
            const numBytesToParse = addedSplatCount * bytesPerSplat;
            const numBytesLeftOver =
              numBytesDownloaded - numBytesParsed - numBytesToParse;
            const parsedDataViewOffset = numBytesParsed - chunks[0].startBytes;
            const dataToParse = new DataView(
              directLoadBufferIn,
              parsedDataViewOffset,
              numBytesToParse
            );

            if (!baseSplatDataLoaded) {
              if (
                internalLoadType === InternalLoadType.ProgressiveToSplatBuffer
              ) {
                const shDesc =
                  SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[
                    outSphericalHarmonicsDegree
                  ];
                const outOffset =
                  processedBaseSplatCount * shDesc.BytesPerSplat +
                  splatBufferDataOffsetBytes;
                if (
                  plyFormat === PlyFormat.PlayCanvasCompressed &&
                  isPlayCanvasHeader(header)
                ) {
                  PlayCanvasCompressedPlyParser.parseToUncompressedSplatBufferSection(
                    header.chunkElement,
                    header.vertexElement,
                    0,
                    addedSplatCount - 1,
                    processedBaseSplatCount,
                    dataToParse,
                    directLoadBufferOut,
                    outOffset
                  );
                } else if (isINRIAV1Header(header)) {
                  INRIAV1PlyParser.parseToUncompressedSplatBufferSection(
                    header,
                    0,
                    addedSplatCount - 1,
                    dataToParse,
                    0,
                    directLoadBufferOut,
                    outOffset,
                    outSphericalHarmonicsDegree
                  );
                }
              } else {
                if (
                  plyFormat === PlyFormat.PlayCanvasCompressed &&
                  isPlayCanvasHeader(header)
                ) {
                  PlayCanvasCompressedPlyParser.parseToUncompressedSplatArraySection(
                    header.chunkElement,
                    header.vertexElement,
                    0,
                    addedSplatCount - 1,
                    processedBaseSplatCount,
                    dataToParse,
                    standardLoadUncompressedSplatArray
                  );
                } else if (isINRIAV1Header(header)) {
                  INRIAV1PlyParser.parseToUncompressedSplatArraySection(
                    header,
                    0,
                    addedSplatCount - 1,
                    dataToParse,
                    0,
                    standardLoadUncompressedSplatArray,
                    outSphericalHarmonicsDegree
                  );
                }
              }

              processedBaseSplatCount += addedSplatCount;

              if (
                internalLoadType === InternalLoadType.ProgressiveToSplatBuffer
              ) {
                if (!directLoadSplatBuffer) {
                  const sectionHeader: SplatBufferSection = {
                    maxSplatCount: maxSplatCount,
                    splatCount: processedBaseSplatCount,
                    bucketSize: 0,
                    bucketCount: 0,
                    halfBucketBlockSize: 0,
                    compressionScaleRange: 0,
                    storageSizeBytes: 0,
                    fullBucketCount: 0,
                    partiallyFilledBucketCount: 0,
                    sphericalHarmonicsDegree: outSphericalHarmonicsDegree,
                    compressionLevel: 0,
                    bucketsAllocated: 0,
                    validBucketCount: 0,
                    bytesPerSplat: 0,
                    sphericalHarmonicsCount: 0,
                    partiallyFilledBucketLengths: [],
                    dataOffset: 0,
                    dataSize: 0,
                    storedBucketBlockSize: 0,
                    bufferOffset: 0,
                  };

                  SplatBuffer.writeSectionHeaderToBuffer(
                    sectionHeader,
                    0,
                    directLoadBufferOut,
                    SplatBuffer.HeaderSizeBytes
                  );
                  directLoadSplatBuffer = new SplatBuffer(
                    directLoadBufferOut,
                    false
                  );
                }
                directLoadSplatBuffer.updateLoadedCounts(
                  1,
                  processedBaseSplatCount
                );
              }
              if (numBytesDownloaded >= endOfBaseSplatDataBytes) {
                baseSplatDataLoaded = true;
              }
            } else {
              if (
                plyFormat === PlyFormat.PlayCanvasCompressed &&
                isPlayCanvasHeader(header)
              ) {
                if (
                  internalLoadType ===
                    InternalLoadType.ProgressiveToSplatArray &&
                  header.shElement
                ) {
                  PlayCanvasCompressedPlyParser.parseSphericalHarmonicsToUncompressedSplatArraySection(
                    header.chunkElement,
                    header.shElement,
                    processedSphericalHarmonicsSplatCount,
                    processedSphericalHarmonicsSplatCount + addedSplatCount - 1,
                    dataToParse,
                    0,
                    outSphericalHarmonicsDegree,
                    header.sphericalHarmonicsDegree,
                    standardLoadUncompressedSplatArray
                  );
                  processedSphericalHarmonicsSplatCount += addedSplatCount;
                }
              }
            }

            if (numBytesLeftOver === 0) {
              chunks = [];
            } else {
              let keepChunks: DataChunk[] = [];
              let keepSize = 0;
              for (let i = chunks.length - 1; i >= 0; i--) {
                const chunk = chunks[i];
                keepSize += chunk.sizeBytes;
                keepChunks.unshift(chunk);
                if (keepSize >= numBytesLeftOver) break;
              }
              chunks = keepChunks;
            }

            numBytesStreamed += directLoadSectionSizeBytes;
            numBytesParsed += numBytesToParse;
          }
        }

        if (onProgressiveLoadSectionProgress && directLoadSplatBuffer) {
          onProgressiveLoadSectionProgress(directLoadSplatBuffer, loadComplete);
        }

        if (loadComplete) {
          if (internalLoadType === InternalLoadType.ProgressiveToSplatBuffer) {
            loadPromise.resolve(directLoadSplatBuffer);
          } else {
            loadPromise.resolve(standardLoadUncompressedSplatArray);
          }
        }
      }

      if (onProgress)
        onProgress(percent, percentLabel, LoaderStatus.Downloading);
    };
    if (onProgress) onProgress(0, "0%", LoaderStatus.Downloading);
    return fetchWithProgress(fileName, localOnProgress, false, headers).then(
      async (response) => {
        if (onProgress) onProgress(0, "0%", LoaderStatus.Processing);
        return loadPromise.promise.then((splatData) => {
          if (onProgress) onProgress(100, "100%", LoaderStatus.Done);
          if (internalLoadType === InternalLoadType.DownloadBeforeProcessing) {
            const chunkDatas = (splatData as DataChunk[]).map<
              Uint8Array<ArrayBuffer>
            >((chunk) => chunk.data);
            return new Blob(chunkDatas).arrayBuffer().then((plyFileData) => {
              return PlyLoader.loadFromFileData(
                plyFileData,
                minimumAlpha,
                compressionLevel,
                optimizeSplatData,
                outSphericalHarmonicsDegree,
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
   * Load a PLY file from file data
   * @param plyFileData - The PLY file data as an ArrayBuffer
   * @param minimumAlpha - Minimum alpha value for splats
   * @param compressionLevel - Compression level
   * @param optimizeSplatData - Whether to optimize the splat data
   * @param outSphericalHarmonicsDegree - Output spherical harmonics degree
   * @param sectionSize - Section size for optimization
   * @param sceneCenter - Center of the scene
   * @param blockSize - Block size for optimization
   * @param bucketSize - Bucket size for optimization
   * @returns Promise that resolves to the loaded splat buffer
   */
  static loadFromFileData(
    plyFileData: ArrayBuffer,
    minimumAlpha?: number,
    compressionLevel?: number,
    optimizeSplatData?: boolean,
    outSphericalHarmonicsDegree: number = 0,
    sectionSize?: number,
    sceneCenter?: THREE.Vector3,
    blockSize?: number,
    bucketSize?: number
  ): Promise<SplatBuffer | undefined> {
    if (optimizeSplatData) {
      return delayedExecute(() => {
        return PlyParser.parseToUncompressedSplatArray(
          plyFileData,
          outSphericalHarmonicsDegree
        );
      }).then((splatArray) => {
        if (!splatArray) {
          return undefined;
        }

        return finalize(
          splatArray,
          optimizeSplatData,
          minimumAlpha!,
          compressionLevel!,
          sectionSize,
          sceneCenter,
          blockSize,
          bucketSize
        );
      });
    } else {
      return delayedExecute(() => {
        return PlyParser.parseToUncompressedSplatBuffer(
          plyFileData,
          outSphericalHarmonicsDegree
        );
      });
    }
  }
}
