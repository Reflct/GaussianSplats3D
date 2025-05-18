import { SplatBuffer, SplatBufferSection } from "../SplatBuffer.js";
import {
  fetchWithProgress,
  delayedExecute,
  nativePromiseWithExtractedComponents,
} from "../../Util.js";
import { LoaderStatus } from "../LoaderStatus.js";
import { Constants } from "../../Constants.js";
import { AbortablePromise } from "../../AbortablePromise.js";

/**
 * Loader for KSplat files
 */
export class KSplatLoader {
  /**
   * Check if the version of the KSplat file is supported
   * @param buffer - Buffer containing the KSplat file
   * @returns True if the version is supported
   */
  static checkVersion(buffer: ArrayBuffer): boolean {
    const minVersionMajor = SplatBuffer.CurrentMajorVersion;
    const minVersionMinor = SplatBuffer.CurrentMinorVersion;
    const header = SplatBuffer.parseHeader(buffer);
    if (
      (header.versionMajor === minVersionMajor &&
        header.versionMinor >= minVersionMinor) ||
      header.versionMajor > minVersionMajor
    ) {
      return true;
    } else {
      throw new Error(
        `KSplat version not supported: v${header.versionMajor}.${header.versionMinor}. ` +
          `Minimum required: v${minVersionMajor}.${minVersionMinor}`
      );
    }
  }

  /**
   * Load a KSplat file from a URL
   * @param fileName - URL of the KSplat file
   * @param externalOnProgress - Progress callback
   * @param progressiveLoadToSplatBuffer - Whether to load progressively to a splat buffer
   * @param onSectionBuilt - Callback when a section has been built
   * @param headers - HTTP headers for the request
   * @returns Promise that resolves to the loaded splat buffer
   */
  static loadFromURL(
    fileName: string,
    externalOnProgress?: (
      percent: number,
      percentLabel: string,
      status: LoaderStatus
    ) => void,
    progressiveLoadToSplatBuffer?: boolean,
    onSectionBuilt?: (buffer: SplatBuffer, complete: boolean) => void,
    headers?: Record<string, string>
  ): AbortablePromise<SplatBuffer | undefined> {
    let directLoadBuffer: ArrayBuffer;
    let directLoadSplatBuffer: SplatBuffer;

    let headerBuffer: ArrayBuffer;
    let header: any;
    let headerLoaded = false;
    let headerLoading = false;

    let sectionHeadersBuffer: ArrayBuffer;
    let sectionHeaders: SplatBufferSection[] = [];
    let sectionHeadersLoaded = false;
    let sectionHeadersLoading = false;

    let numBytesLoaded = 0;
    let numBytesProgressivelyLoaded = 0;
    let totalBytesToDownload = 0;

    let downloadComplete = false;
    let loadComplete = false;
    let loadSectionQueued = false;

    let chunks: ArrayBuffer[] = [];

    const directLoadPromise =
      nativePromiseWithExtractedComponents<SplatBuffer>();

    const checkAndLoadHeader = (): void => {
      if (
        !headerLoaded &&
        !headerLoading &&
        numBytesLoaded >= SplatBuffer.HeaderSizeBytes
      ) {
        headerLoading = true;
        const headerAssemblyPromise = new Blob(chunks).arrayBuffer();
        headerAssemblyPromise.then((bufferData) => {
          headerBuffer = new ArrayBuffer(SplatBuffer.HeaderSizeBytes || 0);
          new Uint8Array(headerBuffer).set(
            new Uint8Array(bufferData, 0, SplatBuffer.HeaderSizeBytes || 0)
          );
          KSplatLoader.checkVersion(headerBuffer);
          headerLoading = false;
          headerLoaded = true;
          header = SplatBuffer.parseHeader(headerBuffer);
          window.setTimeout(() => {
            checkAndLoadSectionHeaders();
          }, 1);
        });
      }
    };

    let queuedCheckAndLoadSectionsCount = 0;
    const queueCheckAndLoadSections = (): void => {
      if (queuedCheckAndLoadSectionsCount === 0) {
        queuedCheckAndLoadSectionsCount++;
        window.setTimeout(() => {
          queuedCheckAndLoadSectionsCount--;
          checkAndLoadSections();
        }, 1);
      }
    };

    const checkAndLoadSectionHeaders = (): void => {
      const performLoad = (): void => {
        sectionHeadersLoading = true;
        const sectionHeadersAssemblyPromise = new Blob(chunks).arrayBuffer();

        sectionHeadersAssemblyPromise.then((bufferData) => {
          sectionHeadersLoading = false;
          sectionHeadersLoaded = true;
          sectionHeadersBuffer = new ArrayBuffer(
            header.maxSectionCount * SplatBuffer.SectionHeaderSizeBytes
          );
          new Uint8Array(sectionHeadersBuffer).set(
            new Uint8Array(
              bufferData,
              SplatBuffer.HeaderSizeBytes,
              header.maxSectionCount * SplatBuffer.SectionHeaderSizeBytes
            )
          );
          sectionHeaders = SplatBuffer.parseSectionHeaders(
            header,
            sectionHeadersBuffer,
            0,
            false
          );
          let totalSectionStorageStorageByes = 0;
          for (let i = 0; i < header.maxSectionCount; i++) {
            totalSectionStorageStorageByes +=
              sectionHeaders[i]?.storageSizeBytes || 0;
          }
          const totalStorageSizeBytes =
            SplatBuffer.HeaderSizeBytes +
            header.maxSectionCount * SplatBuffer.SectionHeaderSizeBytes +
            totalSectionStorageStorageByes;
          if (!directLoadBuffer) {
            directLoadBuffer = new ArrayBuffer(totalStorageSizeBytes);
            let offset = 0;
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              new Uint8Array(directLoadBuffer, offset, chunk.byteLength).set(
                new Uint8Array(chunk)
              );
              offset += chunk.byteLength;
            }
          }

          totalBytesToDownload =
            SplatBuffer.HeaderSizeBytes +
            SplatBuffer.SectionHeaderSizeBytes * header.maxSectionCount;
          for (
            let i = 0;
            i <= sectionHeaders.length && i < header.maxSectionCount;
            i++
          ) {
            totalBytesToDownload += sectionHeaders[i]?.storageSizeBytes || 0;
          }

          queueCheckAndLoadSections();
        });
      };

      if (
        !sectionHeadersLoading &&
        !sectionHeadersLoaded &&
        headerLoaded &&
        header?.maxSectionCount &&
        numBytesLoaded >=
          SplatBuffer.HeaderSizeBytes +
            SplatBuffer.SectionHeaderSizeBytes * header.maxSectionCount
      ) {
        performLoad();
      }
    };

    const checkAndLoadSections = (): void => {
      if (loadSectionQueued) return;
      loadSectionQueued = true;
      const checkAndLoadFunc = (): void => {
        loadSectionQueued = false;
        if (sectionHeadersLoaded) {
          if (loadComplete) return;

          downloadComplete = numBytesLoaded >= totalBytesToDownload;

          const progressiveLoadSectionSize =
            Constants.ProgressiveLoadSectionSize || 0;
          let bytesLoadedSinceLastSection =
            numBytesLoaded - numBytesProgressivelyLoaded;
          if (
            bytesLoadedSinceLastSection > progressiveLoadSectionSize ||
            downloadComplete
          ) {
            numBytesProgressivelyLoaded += progressiveLoadSectionSize;
            loadComplete = numBytesProgressivelyLoaded >= totalBytesToDownload;

            if (!directLoadSplatBuffer && directLoadBuffer) {
              directLoadSplatBuffer = new SplatBuffer(directLoadBuffer, false);
            }

            if (directLoadSplatBuffer && header?.maxSectionCount) {
              const baseDataOffset =
                SplatBuffer.HeaderSizeBytes +
                SplatBuffer.SectionHeaderSizeBytes * header.maxSectionCount;
              let sectionBase = 0;
              let reachedSections = 0;
              let loadedSplatCount = 0;
              for (let i = 0; i < header.maxSectionCount; i++) {
                const sectionHeader = sectionHeaders[i];
                if (sectionHeader) {
                  const partiallyFilledBucketCount =
                    sectionHeader.partiallyFilledBucketCount || 0;
                  const bucketStorageSizeBytes =
                    sectionHeader.bucketStorageSizeBytes || 0;
                  const bucketCount = sectionHeader.bucketCount || 0;

                  const bucketsDataOffset =
                    sectionBase +
                    partiallyFilledBucketCount * 4 +
                    bucketStorageSizeBytes * bucketCount;
                  const bytesRequiredToReachSectionSplatData =
                    baseDataOffset + bucketsDataOffset;
                  if (
                    numBytesProgressivelyLoaded >=
                    bytesRequiredToReachSectionSplatData
                  ) {
                    reachedSections++;
                    const bytesPastSSectionSplatDataStart =
                      numBytesProgressivelyLoaded -
                      bytesRequiredToReachSectionSplatData;
                    const baseDescriptor =
                      SplatBuffer.CompressionLevels[header.compressionLevel];
                    if (
                      baseDescriptor &&
                      sectionHeader.sphericalHarmonicsDegree !== undefined
                    ) {
                      const shDesc =
                        baseDescriptor.SphericalHarmonicsDegrees[
                          sectionHeader.sphericalHarmonicsDegree
                        ];
                      if (shDesc) {
                        const bytesPerSplat = shDesc.BytesPerSplat;
                        let loadedSplatsForSection = Math.floor(
                          bytesPastSSectionSplatDataStart / bytesPerSplat
                        );
                        loadedSplatsForSection = Math.min(
                          loadedSplatsForSection,
                          sectionHeader.maxSplatCount || 0
                        );
                        loadedSplatCount += loadedSplatsForSection;
                        directLoadSplatBuffer.updateLoadedCounts(
                          reachedSections,
                          loadedSplatCount
                        );
                        directLoadSplatBuffer.updateSectionLoadedCounts(
                          i,
                          loadedSplatsForSection
                        );
                      }
                    }
                  } else {
                    break;
                  }
                  sectionBase += sectionHeader.storageSizeBytes || 0;
                }
              }

              if (onSectionBuilt)
                onSectionBuilt(directLoadSplatBuffer, loadComplete);

              const percentComplete =
                (numBytesProgressivelyLoaded / totalBytesToDownload) * 100;
              const percentLabel = percentComplete.toFixed(2) + "%";

              if (externalOnProgress)
                externalOnProgress(
                  percentComplete,
                  percentLabel,
                  LoaderStatus.Downloading
                );

              if (loadComplete) {
                directLoadPromise.resolve(directLoadSplatBuffer);
              } else {
                checkAndLoadSections();
              }
            }
          }
        }
      };
      window.setTimeout(
        checkAndLoadFunc,
        Constants.ProgressiveLoadSectionDelayDuration
      );
    };

    const localOnProgress = (
      percent: number,
      percentStr: string,
      chunk?: Uint8Array<ArrayBuffer>
    ): void => {
      if (chunk) {
        chunks.push(chunk.buffer);
        if (directLoadBuffer) {
          new Uint8Array(
            directLoadBuffer,
            numBytesLoaded,
            chunk.byteLength
          ).set(new Uint8Array(chunk));
        }
        numBytesLoaded += chunk.byteLength;
      }
      if (progressiveLoadToSplatBuffer) {
        checkAndLoadHeader();
        checkAndLoadSectionHeaders();
        checkAndLoadSections();
      } else {
        if (externalOnProgress)
          externalOnProgress(percent, percentStr, LoaderStatus.Downloading);
      }
    };

    // Create a wrapper for the progress callback to match the required signature
    const progressWrapper = (
      percent: number,
      percentStr: string,
      chunk?: Uint8Array<ArrayBuffer>,
      fileSize?: number
    ): void => {
      localOnProgress(percent, percentStr, chunk);
    };

    if (externalOnProgress)
      externalOnProgress(0, "0%", LoaderStatus.Downloading);
    return fetchWithProgress(
      fileName,
      progressWrapper,
      !progressiveLoadToSplatBuffer,
      headers
    ).then((fullBuffer) => {
      if (externalOnProgress)
        externalOnProgress(0, "0%", LoaderStatus.Processing);
      if (!fullBuffer && !progressiveLoadToSplatBuffer) return undefined;
      const loadPromise = progressiveLoadToSplatBuffer
        ? directLoadPromise.promise
        : KSplatLoader.loadFromFileData(fullBuffer as ArrayBuffer);
      return loadPromise.then((splatBuffer) => {
        if (externalOnProgress)
          externalOnProgress(100, "100%", LoaderStatus.Done);
        return splatBuffer;
      });
    });
  }

  /**
   * Load a KSplat file from file data
   * @param fileData - The KSplat file data as an ArrayBuffer
   * @returns Promise that resolves to the loaded splat buffer
   */
  static loadFromFileData(
    fileData: ArrayBuffer
  ): Promise<SplatBuffer | undefined> {
    return delayedExecute(() => {
      try {
        KSplatLoader.checkVersion(fileData);
        return new SplatBuffer(fileData);
      } catch (e) {
        console.error("Error loading KSplat file:", e);
        return undefined;
      }
    });
  }

  /**
   * Download the splat buffer as a file
   */
  static downloadFile = (function () {
    let downLoadLink: HTMLAnchorElement | undefined;

    return function (splatBuffer: SplatBuffer, fileName: string): void {
      const blob = new Blob([splatBuffer.bufferData], {
        type: "application/octet-stream",
      });

      if (!downLoadLink) {
        downLoadLink = document.createElement("a");
        document.body.appendChild(downLoadLink);
      }
      downLoadLink.download = fileName;
      downLoadLink.href = URL.createObjectURL(blob);
      downLoadLink.click();
    };
  })();
}
