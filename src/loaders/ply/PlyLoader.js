"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlyLoader = void 0;
const THREE = __importStar(require("three"));
const PlyParser_1 = require("./PlyParser");
const PlyParserUtils_1 = require("./PlyParserUtils");
const INRIAV1PlyParser_1 = require("./INRIAV1PlyParser");
const PlayCanvasCompressedPlyParser_1 = require("./PlayCanvasCompressedPlyParser");
const PlyFormat_1 = require("./PlyFormat");
const Util_1 = require("../../Util");
const SplatBuffer_1 = require("../SplatBuffer");
const SplatBufferGenerator_1 = require("../SplatBufferGenerator");
const LoaderStatus_1 = require("../LoaderStatus");
const DirectLoadError_1 = require("../DirectLoadError");
const Constants_1 = require("../../Constants");
const UncompressedSplatArray_1 = require("../UncompressedSplatArray");
const InternalLoadType_1 = require("../InternalLoadType");
/**
 * Stores chunks of data in a buffer
 * @param chunks - Array of data chunks
 * @param buffer - Optional existing buffer to store data in
 * @returns Buffer containing the chunk data
 */
function storeChunksInBuffer(chunks, buffer) {
    let inBytes = 0;
    for (let chunk of chunks)
        inBytes += chunk.sizeBytes;
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
function finalize(splatData, optimizeSplatData, minimumAlpha, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize) {
    if (optimizeSplatData) {
        const splatBufferGenerator = SplatBufferGenerator_1.SplatBufferGenerator.getStandardGenerator(minimumAlpha, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize);
        return splatBufferGenerator.generateFromUncompressedSplatArray(splatData);
    }
    else {
        return SplatBuffer_1.SplatBuffer.generateFromUncompressedSplatArrays([splatData], minimumAlpha, 0, new THREE.Vector3());
    }
}
/**
 * Type guard to check if the header is an INRIAV1Header
 */
function isINRIAV1Header(header) {
    return header !== null && "vertexCount" in header;
}
/**
 * Type guard to check if the header is a PlayCanvasHeader
 */
function isPlayCanvasHeader(header) {
    return header !== null && "vertexElement" in header;
}
/**
 * PlyLoader class for loading and processing PLY files
 */
class PlyLoader {
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
    static loadFromURL(fileName, onProgress, progressiveLoadToSplatBuffer, onProgressiveLoadSectionProgress, minimumAlpha, compressionLevel, optimizeSplatData = true, outSphericalHarmonicsDegree = 0, headers, sectionSize, sceneCenter, blockSize, bucketSize) {
        let internalLoadType;
        if (!progressiveLoadToSplatBuffer && !optimizeSplatData) {
            internalLoadType = InternalLoadType_1.InternalLoadType.DownloadBeforeProcessing;
        }
        else {
            if (optimizeSplatData)
                internalLoadType = InternalLoadType_1.InternalLoadType.ProgressiveToSplatArray;
            else
                internalLoadType = InternalLoadType_1.InternalLoadType.ProgressiveToSplatBuffer;
        }
        const directLoadSectionSizeBytes = Constants_1.Constants.ProgressiveLoadSectionSize;
        const splatBufferDataOffsetBytes = SplatBuffer_1.SplatBuffer.HeaderSizeBytes + SplatBuffer_1.SplatBuffer.SectionHeaderSizeBytes;
        const sectionCount = 1;
        let plyFormat;
        let directLoadBufferIn;
        let directLoadBufferOut;
        let directLoadSplatBuffer;
        let compressedPlyHeaderChunksBuffer;
        let maxSplatCount = 0;
        let processedBaseSplatCount = 0;
        let processedSphericalHarmonicsSplatCount = 0;
        let headerLoaded = false;
        let readyToLoadSplatData = false;
        let baseSplatDataLoaded = false;
        const loadPromise = (0, Util_1.nativePromiseWithExtractedComponents)();
        let numBytesStreamed = 0;
        let numBytesParsed = 0;
        let numBytesDownloaded = 0;
        let endOfBaseSplatDataBytes = 0;
        let headerText = "";
        let header = null;
        let chunks = [];
        let standardLoadUncompressedSplatArray;
        const textDecoder = new TextDecoder();
        const localOnProgress = (percent, percentLabel, chunkData) => {
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
            if (internalLoadType === InternalLoadType_1.InternalLoadType.DownloadBeforeProcessing) {
                if (loadComplete) {
                    loadPromise.resolve(chunks);
                }
            }
            else {
                if (!headerLoaded) {
                    headerText += textDecoder.decode(chunkData);
                    if (PlyParserUtils_1.PlyParserUtils.checkTextForEndHeader(headerText)) {
                        plyFormat =
                            PlyParserUtils_1.PlyParserUtils.determineHeaderFormatFromHeaderText(headerText);
                        if (plyFormat === PlyFormat_1.PlyFormat.INRIAV1) {
                            const inriaHeader = INRIAV1PlyParser_1.INRIAV1PlyParser.decodeHeaderText(headerText);
                            header = inriaHeader;
                            outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, inriaHeader.sphericalHarmonicsDegree);
                            maxSplatCount = inriaHeader.splatCount;
                            readyToLoadSplatData = true;
                            endOfBaseSplatDataBytes =
                                inriaHeader.headerSizeBytes +
                                    inriaHeader.bytesPerSplat * maxSplatCount;
                        }
                        else if (plyFormat === PlyFormat_1.PlyFormat.PlayCanvasCompressed) {
                            const playCanvasHeader = PlayCanvasCompressedPlyParser_1.PlayCanvasCompressedPlyParser.decodeHeaderText(headerText);
                            header = playCanvasHeader;
                            outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, playCanvasHeader.sphericalHarmonicsDegree);
                            if (internalLoadType ===
                                InternalLoadType_1.InternalLoadType.ProgressiveToSplatBuffer &&
                                outSphericalHarmonicsDegree > 0) {
                                throw new DirectLoadError_1.DirectLoadError("PlyLoader.loadFromURL() -> Selected PLY format has spherical " +
                                    "harmonics data that cannot be progressively loaded.");
                            }
                            maxSplatCount = playCanvasHeader.vertexElement?.count ?? 0;
                            endOfBaseSplatDataBytes =
                                playCanvasHeader.headerSizeBytes +
                                    playCanvasHeader.bytesPerSplat * maxSplatCount +
                                    (playCanvasHeader.chunkElement?.storageSizeBytes ?? 0);
                        }
                        else {
                            if (internalLoadType === InternalLoadType_1.InternalLoadType.ProgressiveToSplatBuffer) {
                                throw new DirectLoadError_1.DirectLoadError("PlyLoader.loadFromURL() -> Selected PLY format cannot be progressively loaded.");
                            }
                            else {
                                internalLoadType = InternalLoadType_1.InternalLoadType.DownloadBeforeProcessing;
                                return;
                            }
                        }
                        if (internalLoadType === InternalLoadType_1.InternalLoadType.ProgressiveToSplatBuffer) {
                            const shDescriptor = SplatBuffer_1.SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[outSphericalHarmonicsDegree];
                            const splatBufferSizeBytes = splatBufferDataOffsetBytes +
                                shDescriptor.BytesPerSplat * maxSplatCount;
                            directLoadBufferOut = new ArrayBuffer(splatBufferSizeBytes);
                            SplatBuffer_1.SplatBuffer.writeHeaderToBuffer({
                                versionMajor: SplatBuffer_1.SplatBuffer.CurrentMajorVersion,
                                versionMinor: SplatBuffer_1.SplatBuffer.CurrentMinorVersion,
                                maxSectionCount: sectionCount,
                                sectionCount: sectionCount,
                                maxSplatCount: maxSplatCount,
                                splatCount: 0,
                                compressionLevel: 0,
                                sceneCenter: new THREE.Vector3(),
                            }, directLoadBufferOut);
                        }
                        else {
                            standardLoadUncompressedSplatArray = new UncompressedSplatArray_1.UncompressedSplatArray(outSphericalHarmonicsDegree);
                        }
                        if (header) {
                            numBytesStreamed = header.headerSizeBytes;
                            numBytesParsed = header.headerSizeBytes;
                        }
                        headerLoaded = true;
                    }
                }
                else if (plyFormat === PlyFormat_1.PlyFormat.PlayCanvasCompressed &&
                    !readyToLoadSplatData &&
                    header !== null &&
                    isPlayCanvasHeader(header)) {
                    const sizeRequiredForHeaderAndChunks = header.headerSizeBytes +
                        (header.chunkElement?.storageSizeBytes ?? 0);
                    compressedPlyHeaderChunksBuffer = storeChunksInBuffer(chunks, compressedPlyHeaderChunksBuffer);
                    if (compressedPlyHeaderChunksBuffer.byteLength >=
                        sizeRequiredForHeaderAndChunks) {
                        PlayCanvasCompressedPlyParser_1.PlayCanvasCompressedPlyParser.readElementData(header.chunkElement, compressedPlyHeaderChunksBuffer, header.headerSizeBytes);
                        numBytesStreamed = sizeRequiredForHeaderAndChunks;
                        numBytesParsed = sizeRequiredForHeaderAndChunks;
                        readyToLoadSplatData = true;
                    }
                }
                if (headerLoaded &&
                    readyToLoadSplatData &&
                    chunks.length > 0 &&
                    header !== null) {
                    directLoadBufferIn = storeChunksInBuffer(chunks, directLoadBufferIn);
                    const bytesLoadedSinceLastStreamedSection = numBytesDownloaded - numBytesStreamed;
                    if (bytesLoadedSinceLastStreamedSection > directLoadSectionSizeBytes ||
                        (numBytesDownloaded >= endOfBaseSplatDataBytes &&
                            !baseSplatDataLoaded) ||
                        loadComplete) {
                        const bytesPerSplat = baseSplatDataLoaded
                            ? isPlayCanvasHeader(header)
                                ? header.sphericalHarmonicsPerSplat
                                : 0
                            : header.bytesPerSplat;
                        const endOfBytesToProcess = baseSplatDataLoaded
                            ? numBytesDownloaded
                            : Math.min(endOfBaseSplatDataBytes, numBytesDownloaded);
                        const numBytesToProcess = endOfBytesToProcess - numBytesParsed;
                        const addedSplatCount = Math.floor(numBytesToProcess / bytesPerSplat);
                        const numBytesToParse = addedSplatCount * bytesPerSplat;
                        const numBytesLeftOver = numBytesDownloaded - numBytesParsed - numBytesToParse;
                        const parsedDataViewOffset = numBytesParsed - chunks[0].startBytes;
                        const dataToParse = new DataView(directLoadBufferIn, parsedDataViewOffset, numBytesToParse);
                        if (!baseSplatDataLoaded) {
                            if (internalLoadType === InternalLoadType_1.InternalLoadType.ProgressiveToSplatBuffer) {
                                const shDesc = SplatBuffer_1.SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[outSphericalHarmonicsDegree];
                                const outOffset = processedBaseSplatCount * shDesc.BytesPerSplat +
                                    splatBufferDataOffsetBytes;
                                if (plyFormat === PlyFormat_1.PlyFormat.PlayCanvasCompressed &&
                                    isPlayCanvasHeader(header)) {
                                    PlayCanvasCompressedPlyParser_1.PlayCanvasCompressedPlyParser.parseToUncompressedSplatBufferSection(header.chunkElement, header.vertexElement, 0, addedSplatCount - 1, processedBaseSplatCount, dataToParse, directLoadBufferOut, outOffset);
                                }
                                else if (isINRIAV1Header(header)) {
                                    INRIAV1PlyParser_1.INRIAV1PlyParser.parseToUncompressedSplatBufferSection(header, 0, addedSplatCount - 1, dataToParse, 0, directLoadBufferOut, outOffset, outSphericalHarmonicsDegree);
                                }
                            }
                            else {
                                if (plyFormat === PlyFormat_1.PlyFormat.PlayCanvasCompressed &&
                                    isPlayCanvasHeader(header)) {
                                    PlayCanvasCompressedPlyParser_1.PlayCanvasCompressedPlyParser.parseToUncompressedSplatArraySection(header.chunkElement, header.vertexElement, 0, addedSplatCount - 1, processedBaseSplatCount, dataToParse, standardLoadUncompressedSplatArray);
                                }
                                else if (isINRIAV1Header(header)) {
                                    INRIAV1PlyParser_1.INRIAV1PlyParser.parseToUncompressedSplatArraySection(header, 0, addedSplatCount - 1, dataToParse, 0, standardLoadUncompressedSplatArray, outSphericalHarmonicsDegree);
                                }
                            }
                            processedBaseSplatCount += addedSplatCount;
                            if (internalLoadType === InternalLoadType_1.InternalLoadType.ProgressiveToSplatBuffer) {
                                if (!directLoadSplatBuffer) {
                                    const sectionHeader = {
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
                                    SplatBuffer_1.SplatBuffer.writeSectionHeaderToBuffer(sectionHeader, 0, directLoadBufferOut, SplatBuffer_1.SplatBuffer.HeaderSizeBytes);
                                    directLoadSplatBuffer = new SplatBuffer_1.SplatBuffer(directLoadBufferOut, false);
                                }
                                directLoadSplatBuffer.updateLoadedCounts(1, processedBaseSplatCount);
                            }
                            if (numBytesDownloaded >= endOfBaseSplatDataBytes) {
                                baseSplatDataLoaded = true;
                            }
                        }
                        else {
                            if (plyFormat === PlyFormat_1.PlyFormat.PlayCanvasCompressed &&
                                isPlayCanvasHeader(header)) {
                                if (internalLoadType ===
                                    InternalLoadType_1.InternalLoadType.ProgressiveToSplatArray &&
                                    header.shElement) {
                                    PlayCanvasCompressedPlyParser_1.PlayCanvasCompressedPlyParser.parseSphericalHarmonicsToUncompressedSplatArraySection(header.chunkElement, header.shElement, processedSphericalHarmonicsSplatCount, processedSphericalHarmonicsSplatCount + addedSplatCount - 1, dataToParse, 0, outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree, standardLoadUncompressedSplatArray);
                                    processedSphericalHarmonicsSplatCount += addedSplatCount;
                                }
                            }
                        }
                        if (numBytesLeftOver === 0) {
                            chunks = [];
                        }
                        else {
                            let keepChunks = [];
                            let keepSize = 0;
                            for (let i = chunks.length - 1; i >= 0; i--) {
                                const chunk = chunks[i];
                                keepSize += chunk.sizeBytes;
                                keepChunks.unshift(chunk);
                                if (keepSize >= numBytesLeftOver)
                                    break;
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
                    if (internalLoadType === InternalLoadType_1.InternalLoadType.ProgressiveToSplatBuffer) {
                        loadPromise.resolve(directLoadSplatBuffer);
                    }
                    else {
                        loadPromise.resolve(standardLoadUncompressedSplatArray);
                    }
                }
            }
            if (onProgress)
                onProgress(percent, percentLabel, LoaderStatus_1.LoaderStatus.Downloading);
        };
        if (onProgress)
            onProgress(0, "0%", LoaderStatus_1.LoaderStatus.Downloading);
        return (0, Util_1.fetchWithProgress)(fileName, localOnProgress, false, headers).then(async (response) => {
            if (onProgress)
                onProgress(0, "0%", LoaderStatus_1.LoaderStatus.Processing);
            return loadPromise.promise.then((splatData) => {
                if (onProgress)
                    onProgress(100, "100%", LoaderStatus_1.LoaderStatus.Done);
                if (internalLoadType === InternalLoadType_1.InternalLoadType.DownloadBeforeProcessing) {
                    const chunkDatas = splatData.map((chunk) => chunk.data);
                    return new Blob(chunkDatas).arrayBuffer().then((plyFileData) => {
                        return PlyLoader.loadFromFileData(plyFileData, minimumAlpha, compressionLevel, optimizeSplatData, outSphericalHarmonicsDegree, sectionSize, sceneCenter, blockSize, bucketSize);
                    });
                }
                else if (internalLoadType === InternalLoadType_1.InternalLoadType.ProgressiveToSplatBuffer) {
                    return splatData;
                }
                else {
                    return (0, Util_1.delayedExecute)(() => {
                        return finalize(splatData, optimizeSplatData, minimumAlpha, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize);
                    });
                }
            });
        });
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
    static loadFromFileData(plyFileData, minimumAlpha, compressionLevel, optimizeSplatData, outSphericalHarmonicsDegree = 0, sectionSize, sceneCenter, blockSize, bucketSize) {
        if (optimizeSplatData) {
            return (0, Util_1.delayedExecute)(() => {
                return PlyParser_1.PlyParser.parseToUncompressedSplatArray(plyFileData, outSphericalHarmonicsDegree);
            }).then((splatArray) => {
                if (!splatArray) {
                    return undefined;
                }
                return finalize(splatArray, optimizeSplatData, minimumAlpha, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize);
            });
        }
        else {
            return (0, Util_1.delayedExecute)(() => {
                return PlyParser_1.PlyParser.parseToUncompressedSplatBuffer(plyFileData, outSphericalHarmonicsDegree);
            });
        }
    }
}
exports.PlyLoader = PlyLoader;
