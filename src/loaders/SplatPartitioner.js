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
exports.SplatPartitioner = void 0;
const THREE = __importStar(require("three"));
const UncompressedSplatArray_1 = require("./UncompressedSplatArray");
const SplatBuffer_1 = require("./SplatBuffer");
class SplatPartitioner {
    constructor(sectionCount, sectionFilters, groupingParameters, partitionGenerator) {
        this.sectionCount = sectionCount || 0;
        this.sectionFilters = sectionFilters || [];
        this.groupingParameters = groupingParameters || [];
        this.partitionGenerator = partitionGenerator;
    }
    partitionUncompressedSplatArray(splatArray) {
        let groupingParameters;
        let sectionCount;
        let sectionFilters;
        if (this.partitionGenerator) {
            const results = this.partitionGenerator(splatArray);
            groupingParameters = results.groupingParameters;
            sectionCount = results.sectionCount;
            sectionFilters = results.sectionFilters;
        }
        else {
            groupingParameters = this.groupingParameters;
            sectionCount = this.sectionCount;
            sectionFilters = this.sectionFilters;
        }
        const newArrays = [];
        for (let s = 0; s < sectionCount; s++) {
            const sectionSplats = new UncompressedSplatArray_1.UncompressedSplatArray(splatArray.sphericalHarmonicsDegree);
            const sectionFilter = sectionFilters[s];
            for (let i = 0; i < splatArray.splatCount; i++) {
                if (sectionFilter(i)) {
                    sectionSplats.addSplat(splatArray.splats[i]);
                }
            }
            newArrays.push(sectionSplats);
        }
        return {
            splatArrays: newArrays,
            parameters: groupingParameters,
        };
    }
    static getStandardPartitioner(partitionSize = 0, sceneCenter = new THREE.Vector3(), blockSize = SplatBuffer_1.SplatBuffer.BucketBlockSize, bucketSize = SplatBuffer_1.SplatBuffer.BucketSize) {
        const partitionGenerator = (splatArray) => {
            const OFFSET_X = UncompressedSplatArray_1.UncompressedSplatArray.OFFSET.X;
            const OFFSET_Y = UncompressedSplatArray_1.UncompressedSplatArray.OFFSET.Y;
            const OFFSET_Z = UncompressedSplatArray_1.UncompressedSplatArray.OFFSET.Z;
            let effectivePartitionSize = partitionSize <= 0 ? splatArray.splatCount : partitionSize;
            const center = new THREE.Vector3();
            const clampDistance = 0.5;
            const clampPoint = (point) => {
                point.x = Math.floor(point.x / clampDistance) * clampDistance;
                point.y = Math.floor(point.y / clampDistance) * clampDistance;
                point.z = Math.floor(point.z / clampDistance) * clampDistance;
            };
            splatArray.splats.forEach((splat) => {
                center
                    .set(splat[OFFSET_X], splat[OFFSET_Y], splat[OFFSET_Z])
                    .sub(sceneCenter);
                clampPoint(center);
                splat.centerDist = center.lengthSq();
            });
            splatArray.splats.sort((a, b) => {
                let centerADist = a.centerDist || 0;
                let centerBDist = b.centerDist || 0;
                if (centerADist > centerBDist)
                    return 1;
                else
                    return -1;
            });
            const sectionFilters = [];
            const groupingParameters = [];
            effectivePartitionSize = Math.min(splatArray.splatCount, effectivePartitionSize);
            const partitionCount = Math.ceil(splatArray.splatCount / effectivePartitionSize);
            let currentStartSplat = 0;
            for (let i = 0; i < partitionCount; i++) {
                let startSplat = currentStartSplat;
                sectionFilters.push((splatIndex) => {
                    return (splatIndex >= startSplat &&
                        splatIndex < startSplat + effectivePartitionSize);
                });
                groupingParameters.push({
                    blocksSize: blockSize,
                    bucketSize: bucketSize,
                });
                currentStartSplat += effectivePartitionSize;
            }
            return {
                sectionCount: sectionFilters.length,
                sectionFilters,
                groupingParameters,
            };
        };
        return new SplatPartitioner(undefined, undefined, undefined, partitionGenerator);
    }
}
exports.SplatPartitioner = SplatPartitioner;
