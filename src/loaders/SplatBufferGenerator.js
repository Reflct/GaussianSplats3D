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
exports.SplatBufferGenerator = void 0;
const THREE = __importStar(require("three"));
const SplatPartitioner_1 = require("./SplatPartitioner");
const SplatBuffer_1 = require("./SplatBuffer");
class SplatBufferGenerator {
    constructor(splatPartitioner, alphaRemovalThreshold, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize) {
        this.splatPartitioner = splatPartitioner;
        this.alphaRemovalThreshold = alphaRemovalThreshold;
        this.compressionLevel = compressionLevel;
        this.sectionSize = sectionSize;
        this.sceneCenter = sceneCenter
            ? new THREE.Vector3().copy(sceneCenter)
            : undefined;
        this.blockSize = blockSize || SplatBuffer_1.SplatBuffer.BucketBlockSize;
        this.bucketSize = bucketSize || SplatBuffer_1.SplatBuffer.BucketSize;
    }
    generateFromUncompressedSplatArray(splatArray) {
        const partitionResults = this.splatPartitioner.partitionUncompressedSplatArray(splatArray);
        return SplatBuffer_1.SplatBuffer.generateFromUncompressedSplatArrays(partitionResults.splatArrays, this.alphaRemovalThreshold, this.compressionLevel, this.sceneCenter || new THREE.Vector3(), this.blockSize, this.bucketSize, partitionResults.parameters);
    }
    static getStandardGenerator(alphaRemovalThreshold = 1, compressionLevel = 1, sectionSize = 0, sceneCenter = new THREE.Vector3(), blockSize = SplatBuffer_1.SplatBuffer.BucketBlockSize, bucketSize = SplatBuffer_1.SplatBuffer.BucketSize) {
        const splatPartitioner = SplatPartitioner_1.SplatPartitioner.getStandardPartitioner(sectionSize, sceneCenter, blockSize, bucketSize);
        return new SplatBufferGenerator(splatPartitioner, alphaRemovalThreshold, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize);
    }
}
exports.SplatBufferGenerator = SplatBufferGenerator;
