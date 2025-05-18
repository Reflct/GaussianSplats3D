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
exports.Semver = exports.abortablePromiseWithExtractedComponents = exports.nativePromiseWithExtractedComponents = exports.getSphericalHarmonicsComponentCountForDegree = exports.delayedExecute = exports.disposeAllMeshes = exports.getCurrentTime = exports.clamp = exports.fetchWithProgress = exports.rgbaArrayToInteger = exports.rgbaToInteger = exports.uintEncodedFloat = exports.floatToHalf = void 0;
exports.isIOS = isIOS;
exports.getIOSSemever = getIOSSemever;
const AbortablePromise_1 = require("./AbortablePromise");
const THREE = __importStar(require("three"));
exports.floatToHalf = (function () {
    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);
    return function (val) {
        floatView[0] = val;
        const x = int32View[0];
        let bits = (x >> 16) & 0x8000;
        let m = (x >> 12) & 0x07ff;
        const e = (x >> 23) & 0xff;
        if (e < 103)
            return bits;
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
exports.uintEncodedFloat = (function () {
    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);
    return function (f) {
        floatView[0] = f;
        return int32View[0];
    };
})();
const rgbaToInteger = function (r, g, b, a) {
    return r + (g << 8) + (b << 16) + (a << 24);
};
exports.rgbaToInteger = rgbaToInteger;
const rgbaArrayToInteger = function (arr, offset) {
    return (arr[offset] +
        (arr[offset + 1] << 8) +
        (arr[offset + 2] << 16) +
        (arr[offset + 3] << 24));
};
exports.rgbaArrayToInteger = rgbaArrayToInteger;
const fetchWithProgress = function (path, onProgress, saveChunks = true, headers) {
    const abortController = new AbortController();
    const signal = abortController.signal;
    let aborted = false;
    const abortHandler = (reason) => {
        abortController.abort(reason);
        aborted = true;
    };
    let onProgressCalledAtComplete = false;
    const localOnProgress = (percent, percentLabel, chunk, fileSize) => {
        if (onProgress && !onProgressCalledAtComplete) {
            onProgress(percent, percentLabel, chunk, fileSize);
            if (percent === 100) {
                onProgressCalledAtComplete = true;
            }
        }
    };
    return new AbortablePromise_1.AbortablePromise((resolve, reject) => {
        const fetchOptions = { signal };
        if (headers)
            fetchOptions.headers = headers;
        fetch(path, fetchOptions)
            .then(async (data) => {
            if (!data.ok) {
                const errorText = await data.text();
                reject(new Error(`Fetch failed: ${data.status} ${data.statusText} ${errorText}`));
                return;
            }
            const reader = data.body.getReader();
            let bytesDownloaded = 0;
            let _fileSize = data.headers.get("Content-Length");
            let fileSize = _fileSize ? parseInt(_fileSize) : undefined;
            const chunks = [];
            while (!aborted) {
                try {
                    const { value: chunk, done } = await reader.read();
                    if (done) {
                        localOnProgress(100, "100%", new Uint8Array(), fileSize);
                        if (saveChunks) {
                            const buffer = new Blob(chunks).arrayBuffer();
                            resolve(buffer);
                        }
                        else {
                            resolve();
                        }
                        break;
                    }
                    bytesDownloaded += chunk.length;
                    let percent = 0;
                    let percentLabel = "0%";
                    if (fileSize !== undefined) {
                        percent = (bytesDownloaded / fileSize) * 100;
                        percentLabel = `${percent.toFixed(2)}%`;
                    }
                    if (saveChunks) {
                        chunks.push(chunk);
                    }
                    localOnProgress(percent, percentLabel, chunk, fileSize);
                }
                catch (error) {
                    reject(error);
                    return;
                }
            }
        })
            .catch((error) => {
            reject(new AbortablePromise_1.AbortedPromiseError(error));
        });
    }, abortHandler);
};
exports.fetchWithProgress = fetchWithProgress;
const clamp = function (val, min, max) {
    return Math.max(Math.min(val, max), min);
};
exports.clamp = clamp;
const getCurrentTime = function () {
    return performance.now() / 1000;
};
exports.getCurrentTime = getCurrentTime;
const disposeAllMeshes = (object3D) => {
    if (object3D.geometry) {
        object3D.geometry.dispose();
        object3D.geometry = null;
    }
    if (object3D.material) {
        if (Array.isArray(object3D.material)) {
            object3D.material.forEach((material) => material.dispose());
        }
        else {
            object3D.material.dispose();
        }
        object3D.material = null;
    }
    if (object3D.children) {
        for (let child of object3D.children) {
            if (child instanceof THREE.Mesh) {
                (0, exports.disposeAllMeshes)(child);
            }
        }
    }
};
exports.disposeAllMeshes = disposeAllMeshes;
const delayedExecute = (func, fast) => {
    return new Promise((resolve) => {
        window.setTimeout(() => {
            resolve(func ? func() : undefined);
        }, fast ? 1 : 50);
    });
};
exports.delayedExecute = delayedExecute;
const getSphericalHarmonicsComponentCountForDegree = (sphericalHarmonicsDegree = 0) => {
    let shCoeffPerSplat = 0;
    if (sphericalHarmonicsDegree === 1) {
        shCoeffPerSplat = 9;
    }
    else if (sphericalHarmonicsDegree === 2) {
        shCoeffPerSplat = 24;
    }
    else if (sphericalHarmonicsDegree === 3) {
        shCoeffPerSplat = 45;
    }
    else if (sphericalHarmonicsDegree > 3) {
        throw new Error("getSphericalHarmonicsComponentCountForDegree() -> Invalid spherical harmonics degree");
    }
    return shCoeffPerSplat;
};
exports.getSphericalHarmonicsComponentCountForDegree = getSphericalHarmonicsComponentCountForDegree;
const nativePromiseWithExtractedComponents = () => {
    let resolver = () => { };
    let rejecter = () => { };
    const promise = new Promise((resolve, reject) => {
        resolver = resolve;
        rejecter = reject;
    });
    return {
        promise: promise,
        resolve: resolver,
        reject: rejecter,
    };
};
exports.nativePromiseWithExtractedComponents = nativePromiseWithExtractedComponents;
const abortablePromiseWithExtractedComponents = (abortHandler) => {
    let resolver = () => { };
    let rejecter = () => { };
    if (!abortHandler) {
        abortHandler = () => { };
    }
    const promise = new AbortablePromise_1.AbortablePromise((resolve, reject) => {
        resolver = resolve;
        rejecter = reject;
    }, abortHandler);
    return {
        promise: promise,
        resolve: resolver,
        reject: rejecter,
    };
};
exports.abortablePromiseWithExtractedComponents = abortablePromiseWithExtractedComponents;
class Semver {
    constructor(major, minor, patch) {
        this.major = major;
        this.minor = minor;
        this.patch = patch;
    }
    toString() {
        return `${this.major}.${this.minor}.${this.patch}`;
    }
}
exports.Semver = Semver;
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
}
function getIOSSemever() {
    const match = navigator.userAgent.match(/OS (\d+)_(\d+)_?(\d+)?/);
    if (match) {
        return new Semver(parseInt(match[1]), parseInt(match[2]), parseInt(match[3] || "0"));
    }
    return new Semver(0, 0, 0);
}
