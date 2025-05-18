// @ts-ignore
import SorterWasm from "./sorter.wasm";
// @ts-ignore
import SorterWasmNoSIMD from "./sorter_no_simd.wasm";
// @ts-ignore
import SorterWasmNonShared from "./sorter_non_shared.wasm";
// @ts-ignore
import SorterWasmNoSIMDNonShared from "./sorter_no_simd_non_shared.wasm";
import { isIOS, getIOSSemever } from "../Util";
import { Constants } from "../Constants";

// Interface for the Constants passed to the worker
interface WorkerConstants {
  BytesPerFloat: number;
  BytesPerInt: number;
  MemoryPageSize: number;
  MaxScenes: number;
}

// Interface for initialization message
interface InitMessage {
  init: {
    sorterWasmBytes: ArrayBuffer;
    splatCount: number;
    useSharedMemory: boolean;
    integerBasedSort: boolean;
    dynamicMode: boolean;
    distanceMapRange: number;
    Constants: WorkerConstants;
  };
}

// Interface for centers message
interface CentersMessage {
  centers: ArrayBuffer;
  sceneIndexes: ArrayBuffer;
  range: {
    from: number;
    to: number;
    count: number;
  };
}

// Interface for sort message
interface SortMessage {
  sortDone: boolean;
  splatSortCount: number;
  splatRenderCount: number;
  sortTime: number;
  sortedIndexes?: Uint32Array;
  sort?: {
    splatRenderCount: number;
    splatSortCount: number;
    modelViewProj: number[];
    usePrecomputedDistances: boolean;
    indexesToSort?: Uint32Array;
    precomputedDistances?: Float32Array | Int32Array;
    transforms?: Float32Array;
  };
}

// Union type for all possible worker messages
type WorkerMessage = InitMessage | CentersMessage | SortMessage;

// Define the WebAssembly exports interface
interface SorterWasmExports extends WebAssembly.Exports {
  sortIndexes: (
    indexesToSortOffset: number,
    centersOffset: number,
    precomputedDistancesOffset: number,
    mappedDistancesOffset: number,
    frequenciesOffset: number,
    modelViewProjOffset: number,
    sortedIndexesOffset: number,
    sceneIndexesOffset: number,
    transformsOffset: number,
    distanceMapRange: number,
    splatSortCount: number,
    splatRenderCount: number,
    splatCount: number,
    usePrecomputedDistances: number,
    integerBasedSort: number,
    dynamicMode: number
  ) => void;
}

function sortWorker(self: Worker): void {
  let wasmInstance: WebAssembly.Instance;
  let wasmMemory: ArrayBuffer;
  let useSharedMemory: boolean;
  let integerBasedSort: boolean;
  let dynamicMode: boolean;
  let splatCount: number;
  let indexesToSortOffset: number;
  let sortedIndexesOffset: number;
  let sceneIndexesOffset: number;
  let transformsOffset: number;
  let precomputedDistancesOffset: number;
  let mappedDistancesOffset: number;
  let frequenciesOffset: number;
  let centersOffset: number;
  let modelViewProjOffset: number;
  let countsZero: Uint32Array;
  let sortedIndexesOut: Uint32Array;
  let distanceMapRange: number;
  let uploadedSplatCount: number;
  let Constants: WorkerConstants;

  function sort(
    splatSortCount: number,
    splatRenderCount: number,
    modelViewProj: number[],
    usePrecomputedDistances: boolean,
    copyIndexesToSort?: Uint32Array,
    copyPrecomputedDistances?: Float32Array | Int32Array,
    copyTransforms?: Float32Array
  ): void {
    const sortStartTime = performance.now();

    if (!useSharedMemory) {
      const indexesToSort = new Uint32Array(
        wasmMemory,
        indexesToSortOffset,
        copyIndexesToSort
          ? copyIndexesToSort.byteLength / Constants.BytesPerInt
          : 0
      );
      if (copyIndexesToSort) {
        indexesToSort.set(copyIndexesToSort);
      }
      const transforms = new Float32Array(
        wasmMemory,
        transformsOffset,
        copyTransforms ? copyTransforms.byteLength / Constants.BytesPerFloat : 0
      );
      if (copyTransforms) {
        transforms.set(copyTransforms);
      }
      if (usePrecomputedDistances && copyPrecomputedDistances) {
        if (integerBasedSort) {
          const precomputedDistances = new Int32Array(
            wasmMemory,
            precomputedDistancesOffset,
            copyPrecomputedDistances.byteLength / Constants.BytesPerInt
          );
          precomputedDistances.set(copyPrecomputedDistances);
        } else {
          const precomputedDistances = new Float32Array(
            wasmMemory,
            precomputedDistancesOffset,
            copyPrecomputedDistances.byteLength / Constants.BytesPerFloat
          );
          precomputedDistances.set(copyPrecomputedDistances);
        }
      }
    }

    if (!countsZero) countsZero = new Uint32Array(distanceMapRange);
    new Float32Array(wasmMemory, modelViewProjOffset, 16).set(modelViewProj);
    new Uint32Array(wasmMemory, frequenciesOffset, distanceMapRange).set(
      countsZero
    );

    // Cast to the proper exports interface to access sortIndexes
    const exports = wasmInstance.exports as SorterWasmExports;
    exports.sortIndexes(
      indexesToSortOffset,
      centersOffset,
      precomputedDistancesOffset,
      mappedDistancesOffset,
      frequenciesOffset,
      modelViewProjOffset,
      sortedIndexesOffset,
      sceneIndexesOffset,
      transformsOffset,
      distanceMapRange,
      splatSortCount,
      splatRenderCount,
      splatCount,
      usePrecomputedDistances ? 1 : 0,
      integerBasedSort ? 1 : 0,
      dynamicMode ? 1 : 0
    );

    const sortMessage: SortMessage = {
      sortDone: true,
      splatSortCount: splatSortCount,
      splatRenderCount: splatRenderCount,
      sortTime: 0,
    };
    if (!useSharedMemory) {
      const sortedIndexes = new Uint32Array(
        wasmMemory,
        sortedIndexesOffset,
        splatRenderCount
      );
      if (!sortedIndexesOut || sortedIndexesOut.length < splatRenderCount) {
        sortedIndexesOut = new Uint32Array(splatRenderCount);
      }
      sortedIndexesOut.set(sortedIndexes);
      sortMessage.sortedIndexes = sortedIndexesOut;
    }
    const sortEndTime = performance.now();

    sortMessage.sortTime = sortEndTime - sortStartTime;

    self.postMessage(sortMessage);
  }

  self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const data = e.data;

    if ("centers" in data) {
      // Centers message
      const centers = data.centers;
      const sceneIndexes = data.sceneIndexes;
      if (integerBasedSort) {
        new Int32Array(
          wasmMemory,
          centersOffset + data.range.from * Constants.BytesPerInt * 4,
          data.range.count * 4
        ).set(new Int32Array(centers));
      } else {
        new Float32Array(
          wasmMemory,
          centersOffset + data.range.from * Constants.BytesPerFloat * 4,
          data.range.count * 4
        ).set(new Float32Array(centers));
      }
      if (dynamicMode) {
        new Uint32Array(
          wasmMemory,
          sceneIndexesOffset + data.range.from * 4,
          data.range.count
        ).set(new Uint32Array(sceneIndexes));
      }
      uploadedSplatCount = data.range.from + data.range.count;
    } else if ("sort" in data) {
      // Sort message
      const renderCount = Math.min(
        data.sort?.splatRenderCount || 0,
        uploadedSplatCount
      );
      const sortCount = Math.min(
        data.sort?.splatSortCount || 0,
        uploadedSplatCount
      );
      const usePrecomputedDistances = data.sort?.usePrecomputedDistances;

      let copyIndexesToSort: Uint32Array | undefined;
      let copyPrecomputedDistances: Float32Array | Int32Array | undefined;
      let copyTransforms: Float32Array | undefined;
      if (!useSharedMemory) {
        copyIndexesToSort = data.sort?.indexesToSort;
        copyTransforms = data.sort?.transforms;
        if (usePrecomputedDistances)
          copyPrecomputedDistances = data.sort?.precomputedDistances;
      }
      sort(
        sortCount,
        renderCount,
        data.sort?.modelViewProj || [],
        usePrecomputedDistances || false,
        copyIndexesToSort,
        copyPrecomputedDistances,
        copyTransforms
      );
    } else if ("init" in data) {
      // Init message
      Constants = data.init.Constants;

      splatCount = data.init.splatCount;
      useSharedMemory = data.init.useSharedMemory;
      integerBasedSort = data.init.integerBasedSort;
      dynamicMode = data.init.dynamicMode;
      distanceMapRange = data.init.distanceMapRange;
      uploadedSplatCount = 0;

      const CENTERS_BYTES_PER_ENTRY = integerBasedSort
        ? Constants.BytesPerInt * 4
        : Constants.BytesPerFloat * 4;

      const sorterWasmBytes = new Uint8Array(data.init.sorterWasmBytes);

      const matrixSize = 16 * Constants.BytesPerFloat;
      const memoryRequiredForIndexesToSort = splatCount * Constants.BytesPerInt;
      const memoryRequiredForCenters = splatCount * CENTERS_BYTES_PER_ENTRY;
      const memoryRequiredForModelViewProjectionMatrix = matrixSize;
      const memoryRequiredForPrecomputedDistances = integerBasedSort
        ? splatCount * Constants.BytesPerInt
        : splatCount * Constants.BytesPerFloat;
      const memoryRequiredForMappedDistances =
        splatCount * Constants.BytesPerInt;
      const memoryRequiredForSortedIndexes = splatCount * Constants.BytesPerInt;
      const memoryRequiredForIntermediateSortBuffers = integerBasedSort
        ? distanceMapRange * Constants.BytesPerInt * 2
        : distanceMapRange * Constants.BytesPerFloat * 2;
      const memoryRequiredforTransformIndexes = dynamicMode
        ? splatCount * Constants.BytesPerInt
        : 0;
      const memoryRequiredforTransforms = dynamicMode
        ? Constants.MaxScenes * matrixSize
        : 0;
      const extraMemory = Constants.MemoryPageSize * 32;

      const totalRequiredMemory =
        memoryRequiredForIndexesToSort +
        memoryRequiredForCenters +
        memoryRequiredForModelViewProjectionMatrix +
        memoryRequiredForPrecomputedDistances +
        memoryRequiredForMappedDistances +
        memoryRequiredForIntermediateSortBuffers +
        memoryRequiredForSortedIndexes +
        memoryRequiredforTransformIndexes +
        memoryRequiredforTransforms +
        extraMemory;
      const totalPagesRequired =
        Math.floor(totalRequiredMemory / Constants.MemoryPageSize) + 1;
      const sorterWasmImport = {
        module: {},
        env: {
          memory: new WebAssembly.Memory({
            initial: totalPagesRequired,
            maximum: totalPagesRequired,
            shared: true,
          }),
        },
      };
      WebAssembly.compile(sorterWasmBytes)
        .then((wasmModule) => {
          return WebAssembly.instantiate(wasmModule, sorterWasmImport);
        })
        .then((instance) => {
          wasmInstance = instance;
          indexesToSortOffset = 0;
          centersOffset = indexesToSortOffset + memoryRequiredForIndexesToSort;
          modelViewProjOffset = centersOffset + memoryRequiredForCenters;
          precomputedDistancesOffset =
            modelViewProjOffset + memoryRequiredForModelViewProjectionMatrix;
          mappedDistancesOffset =
            precomputedDistancesOffset + memoryRequiredForPrecomputedDistances;
          frequenciesOffset =
            mappedDistancesOffset + memoryRequiredForMappedDistances;
          sortedIndexesOffset =
            frequenciesOffset + memoryRequiredForIntermediateSortBuffers;
          sceneIndexesOffset =
            sortedIndexesOffset + memoryRequiredForSortedIndexes;
          transformsOffset =
            sceneIndexesOffset + memoryRequiredforTransformIndexes;
          wasmMemory = sorterWasmImport.env.memory.buffer;
          if (useSharedMemory) {
            self.postMessage({
              sortSetupPhase1Complete: true,
              indexesToSortBuffer: wasmMemory,
              indexesToSortOffset: indexesToSortOffset,
              sortedIndexesBuffer: wasmMemory,
              sortedIndexesOffset: sortedIndexesOffset,
              precomputedDistancesBuffer: wasmMemory,
              precomputedDistancesOffset: precomputedDistancesOffset,
              transformsBuffer: wasmMemory,
              transformsOffset: transformsOffset,
            });
          } else {
            self.postMessage({
              sortSetupPhase1Complete: true,
            });
          }
        });
    }
  };
}

/**
 * Creates a web worker for sorting splats
 * @param splatCount The total number of splats to sort
 * @param useSharedMemory Whether to use shared memory between the main thread and worker
 * @param enableSIMDInSort Whether to use SIMD instructions for sorting
 * @param integerBasedSort Whether to use integer-based sorting (faster but may overflow for large scenes)
 * @param dynamicMode Whether the scene is dynamic (splats can move)
 * @param splatSortDistanceMapPrecision The precision of the distance map for sorting splats
 * @returns The created worker
 */
export function createSortWorker(
  splatCount: number,
  useSharedMemory: boolean,
  enableSIMDInSort: boolean,
  integerBasedSort: boolean,
  dynamicMode: boolean,
  splatSortDistanceMapPrecision: number = Constants.DefaultSplatSortDistanceMapPrecision
): Worker {
  const worker = new Worker(
    URL.createObjectURL(
      new Blob(["(", sortWorker.toString(), ")(self)"], {
        type: "application/javascript",
      })
    )
  );

  let sourceWasm = SorterWasm;

  // iOS makes choosing the right WebAssembly configuration tricky :(
  const iOSSemVer = isIOS() ? getIOSSemever() : null;
  if (!enableSIMDInSort && !useSharedMemory) {
    sourceWasm = SorterWasmNoSIMD;
    // Testing on various devices has shown that even when shared memory is disabled, the WASM module with shared
    // memory can still be used most of the time -- the exception seems to be iOS devices below 16.4
    if (iOSSemVer && iOSSemVer.major <= 16 && iOSSemVer.minor < 4) {
      sourceWasm = SorterWasmNoSIMDNonShared;
    }
  } else if (!enableSIMDInSort) {
    sourceWasm = SorterWasmNoSIMD;
  } else if (!useSharedMemory) {
    // Same issue with shared memory as above on iOS devices
    if (iOSSemVer && iOSSemVer.major <= 16 && iOSSemVer.minor < 4) {
      sourceWasm = SorterWasmNonShared;
    }
  }

  const sorterWasmBinaryString = atob(sourceWasm);
  const sorterWasmBytes = new Uint8Array(sorterWasmBinaryString.length);
  for (let i = 0; i < sorterWasmBinaryString.length; i++) {
    sorterWasmBytes[i] = sorterWasmBinaryString.charCodeAt(i);
  }

  worker.postMessage({
    init: {
      sorterWasmBytes: sorterWasmBytes.buffer,
      splatCount: splatCount,
      useSharedMemory: useSharedMemory,
      integerBasedSort: integerBasedSort,
      dynamicMode: dynamicMode,
      distanceMapRange: 1 << splatSortDistanceMapPrecision,
      // Super hacky
      Constants: {
        BytesPerFloat: Constants.BytesPerFloat,
        BytesPerInt: Constants.BytesPerInt,
        MemoryPageSize: Constants.MemoryPageSize,
        MaxScenes: Constants.MaxScenes,
      },
    },
  });
  return worker;
}
