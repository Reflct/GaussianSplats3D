import * as THREE from "three";
import { UncompressedSplatArray } from "./UncompressedSplatArray";
import { SplatBuffer } from "./SplatBuffer";

interface GroupingParameter {
  blocksSize: number;
  bucketSize: number;
  [key: string]: unknown;
}

interface PartitionGeneratorResult {
  sectionCount: number;
  sectionFilters: Array<(splatIndex: number) => boolean>;
  groupingParameters: GroupingParameter[];
}

type SectionFilter = (splatIndex: number) => boolean;
type PartitionGenerator = (
  splatArray: UncompressedSplatArray
) => PartitionGeneratorResult;

interface PartitionResult {
  splatArrays: UncompressedSplatArray[];
  parameters: GroupingParameter[];
}

export class SplatPartitioner {
  sectionCount: number;
  sectionFilters: SectionFilter[];
  groupingParameters: GroupingParameter[];
  partitionGenerator?: PartitionGenerator;

  constructor(
    sectionCount?: number,
    sectionFilters?: SectionFilter[],
    groupingParameters?: GroupingParameter[],
    partitionGenerator?: PartitionGenerator
  ) {
    this.sectionCount = sectionCount || 0;
    this.sectionFilters = sectionFilters || [];
    this.groupingParameters = groupingParameters || [];
    this.partitionGenerator = partitionGenerator;
  }

  partitionUncompressedSplatArray(
    splatArray: UncompressedSplatArray
  ): PartitionResult {
    let groupingParameters: GroupingParameter[];
    let sectionCount: number;
    let sectionFilters: SectionFilter[];

    if (this.partitionGenerator) {
      const results = this.partitionGenerator(splatArray);
      groupingParameters = results.groupingParameters;
      sectionCount = results.sectionCount;
      sectionFilters = results.sectionFilters;
    } else {
      groupingParameters = this.groupingParameters;
      sectionCount = this.sectionCount;
      sectionFilters = this.sectionFilters;
    }

    const newArrays: UncompressedSplatArray[] = [];
    for (let s = 0; s < sectionCount; s++) {
      const sectionSplats = new UncompressedSplatArray(
        splatArray.sphericalHarmonicsDegree
      );
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

  static getStandardPartitioner(
    partitionSize: number = 0,
    sceneCenter: THREE.Vector3 = new THREE.Vector3(),
    blockSize: number = SplatBuffer.BucketBlockSize,
    bucketSize: number = SplatBuffer.BucketSize
  ): SplatPartitioner {
    const partitionGenerator: PartitionGenerator = (
      splatArray: UncompressedSplatArray
    ) => {
      const OFFSET_X = UncompressedSplatArray.OFFSET.X;
      const OFFSET_Y = UncompressedSplatArray.OFFSET.Y;
      const OFFSET_Z = UncompressedSplatArray.OFFSET.Z;

      let effectivePartitionSize =
        partitionSize <= 0 ? splatArray.splatCount : partitionSize;

      const center = new THREE.Vector3();
      const clampDistance = 0.5;
      const clampPoint = (point: THREE.Vector3): void => {
        point.x = Math.floor(point.x / clampDistance) * clampDistance;
        point.y = Math.floor(point.y / clampDistance) * clampDistance;
        point.z = Math.floor(point.z / clampDistance) * clampDistance;
      };

      // Add centerDist property to splats for sorting
      type SplatWithDistance = number[] & { centerDist?: number };
      splatArray.splats.forEach((splat: SplatWithDistance) => {
        center
          .set(splat[OFFSET_X], splat[OFFSET_Y], splat[OFFSET_Z])
          .sub(sceneCenter);
        clampPoint(center);
        splat.centerDist = center.lengthSq();
      });

      splatArray.splats.sort((a: SplatWithDistance, b: SplatWithDistance) => {
        let centerADist = a.centerDist || 0;
        let centerBDist = b.centerDist || 0;
        if (centerADist > centerBDist) return 1;
        else return -1;
      });

      const sectionFilters: SectionFilter[] = [];
      const groupingParameters: GroupingParameter[] = [];

      effectivePartitionSize = Math.min(
        splatArray.splatCount,
        effectivePartitionSize
      );
      const partitionCount = Math.ceil(
        splatArray.splatCount / effectivePartitionSize
      );

      let currentStartSplat = 0;
      for (let i = 0; i < partitionCount; i++) {
        let startSplat = currentStartSplat;
        sectionFilters.push((splatIndex: number) => {
          return (
            splatIndex >= startSplat &&
            splatIndex < startSplat + effectivePartitionSize
          );
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

    return new SplatPartitioner(
      undefined,
      undefined,
      undefined,
      partitionGenerator
    );
  }
}
