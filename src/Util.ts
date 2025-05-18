import { AbortablePromise, AbortedPromiseError } from "./AbortablePromise";
import * as THREE from "three";

export const floatToHalf = (function () {
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);

  return function (val: number): number {
    floatView[0] = val;
    const x = int32View[0];

    let bits = (x >> 16) & 0x8000;
    let m = (x >> 12) & 0x07ff;
    const e = (x >> 23) & 0xff;

    if (e < 103) return bits;

    if (e > 142) {
      bits |= 0x7c00;
      bits |= (e == 255 ? 0 : 1) && x & 0x007fffff;
      return bits;
    }

    if (e < 113) {
      m |= 0x0800;
      bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
      return bits;
    }

    bits |= ((e - 112) << 10) | (m >> 1);
    bits += m & 1;
    return bits;
  };
})();

export const uintEncodedFloat = (function () {
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);

  return function (f: number): number {
    floatView[0] = f;
    return int32View[0];
  };
})();

export const rgbaToInteger = function (
  r: number,
  g: number,
  b: number,
  a: number
): number {
  return r + (g << 8) + (b << 16) + (a << 24);
};

export const rgbaArrayToInteger = function (
  arr: number[],
  offset: number
): number {
  return (
    arr[offset] +
    (arr[offset + 1] << 8) +
    (arr[offset + 2] << 16) +
    (arr[offset + 3] << 24)
  );
};

export const fetchWithProgress = function (
  path: string,
  onProgress?: (
    percent: number,
    percentLabel: string,
    chunk: Uint8Array<ArrayBuffer>,
    fileSize?: number
  ) => void,
  saveChunks: boolean = true,
  headers?: HeadersInit
): AbortablePromise<ArrayBuffer | void> {
  const abortController = new AbortController();
  const signal = abortController.signal;
  let aborted = false;
  const abortHandler = (reason?: any) => {
    abortController.abort(reason);
    aborted = true;
  };

  let onProgressCalledAtComplete = false;
  const localOnProgress = (
    percent: number,
    percentLabel: string,
    chunk: Uint8Array<ArrayBuffer>,
    fileSize?: number
  ) => {
    if (onProgress && !onProgressCalledAtComplete) {
      onProgress(percent, percentLabel, chunk, fileSize);
      if (percent === 100) {
        onProgressCalledAtComplete = true;
      }
    }
  };

  return new AbortablePromise<ArrayBuffer | void>((resolve, reject) => {
    const fetchOptions: RequestInit = { signal };
    if (headers) fetchOptions.headers = headers;
    fetch(path, fetchOptions)
      .then(async (data) => {
        if (!data.ok) {
          const errorText = await data.text();
          reject(
            new Error(
              `Fetch failed: ${data.status} ${data.statusText} ${errorText}`
            )
          );
          return;
        }

        const reader = data.body!.getReader();
        let bytesDownloaded = 0;
        let _fileSize = data.headers.get("Content-Length");
        let fileSize = _fileSize ? parseInt(_fileSize) : undefined;

        const chunks: Uint8Array[] = [];

        while (!aborted) {
          try {
            const { value: chunk, done } = await reader.read();
            if (done) {
              localOnProgress(100, "100%", new Uint8Array(), fileSize);
              if (saveChunks) {
                const buffer = new Blob(chunks as BlobPart[]).arrayBuffer();
                resolve(buffer);
              } else {
                resolve();
              }
              break;
            }
            bytesDownloaded += chunk.length;
            let percent: number = 0;
            let percentLabel: string = "0%";
            if (fileSize !== undefined) {
              percent = (bytesDownloaded / fileSize) * 100;
              percentLabel = `${percent.toFixed(2)}%`;
            }
            if (saveChunks) {
              chunks.push(chunk);
            }
            localOnProgress(percent, percentLabel, chunk, fileSize);
          } catch (error) {
            reject(error);
            return;
          }
        }
      })
      .catch((error) => {
        reject(new AbortedPromiseError(error));
      });
  }, abortHandler);
};

export const clamp = function (val: number, min: number, max: number): number {
  return Math.max(Math.min(val, max), min);
};

export const getCurrentTime = function (): number {
  return performance.now() / 1000;
};

export const disposeAllMeshes = (object3D: THREE.Mesh): void => {
  if (object3D.geometry) {
    object3D.geometry.dispose();
    object3D.geometry = null as any;
  }
  if (object3D.material) {
    if (Array.isArray(object3D.material)) {
      object3D.material.forEach((material) => material.dispose());
    } else {
      object3D.material.dispose();
    }
    object3D.material = null as any;
  }
  if (object3D.children) {
    for (let child of object3D.children) {
      if (child instanceof THREE.Mesh) {
        disposeAllMeshes(child);
      }
    }
  }
};

export const delayedExecute = <T>(
  func?: () => T,
  fast?: boolean
): Promise<T | undefined> => {
  return new Promise((resolve) => {
    window.setTimeout(
      () => {
        resolve(func ? func() : undefined);
      },
      fast ? 1 : 50
    );
  });
};

export const getSphericalHarmonicsComponentCountForDegree = (
  sphericalHarmonicsDegree: number = 0
): number => {
  let shCoeffPerSplat = 0;
  if (sphericalHarmonicsDegree === 1) {
    shCoeffPerSplat = 9;
  } else if (sphericalHarmonicsDegree === 2) {
    shCoeffPerSplat = 24;
  } else if (sphericalHarmonicsDegree === 3) {
    shCoeffPerSplat = 45;
  } else if (sphericalHarmonicsDegree > 3) {
    throw new Error(
      "getSphericalHarmonicsComponentCountForDegree() -> Invalid spherical harmonics degree"
    );
  }
  return shCoeffPerSplat;
};

export const nativePromiseWithExtractedComponents = <T>() => {
  let resolver: (value: T) => void = () => {};
  let rejecter: (reason?: any) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rejecter = reject;
  });
  return {
    promise: promise,
    resolve: resolver,
    reject: rejecter,
  };
};

export const abortablePromiseWithExtractedComponents = (
  abortHandler?: (reason?: any) => void
) => {
  let resolver: (value: any) => void = () => {};
  let rejecter: (reason?: any) => void = () => {};
  if (!abortHandler) {
    abortHandler = () => {};
  }
  const promise = new AbortablePromise((resolve, reject) => {
    resolver = resolve;
    rejecter = reject;
  }, abortHandler);
  return {
    promise: promise,
    resolve: resolver,
    reject: rejecter,
  };
};

export class Semver {
  constructor(
    public major: number,
    public minor: number,
    public patch: number
  ) {}
  toString(): string {
    return `${this.major}.${this.minor}.${this.patch}`;
  }
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function getIOSSemever(): Semver {
  const match = navigator.userAgent.match(/OS (\d+)_(\d+)_?(\d+)?/);
  if (match) {
    return new Semver(
      parseInt(match[1]),
      parseInt(match[2]),
      parseInt(match[3] || "0")
    );
  }
  return new Semver(0, 0, 0);
}
