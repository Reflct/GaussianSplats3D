import * as THREE from "three";
import { SplatMaterial3D } from "./SplatMaterial3D";
import { SplatMaterial2D } from "./SplatMaterial2D";
import { SplatGeometry } from "./SplatGeometry";
import { SplatScene } from "./SplatScene";
import { SplatTree } from "../splattree/SplatTree";
import { WebGLExtensions } from "../three-shim/WebGLExtensions";
import { WebGLCapabilities } from "../three-shim/WebGLCapabilities";
import { uintEncodedFloat, rgbaArrayToInteger } from "../Util";
import { Constants } from "../Constants";
import { SceneRevealMode } from "../SceneRevealMode";
import { SplatRenderMode } from "../SplatRenderMode";
import { LogLevel } from "../LogLevel";
import { clamp, getSphericalHarmonicsComponentCountForDegree } from "../Util";
import { SplatBuffer } from "../loaders/SplatBuffer";

// Define interfaces for type safety
interface TextureContainer {
  data?: any; // Make data optional to allow delete operation
  texture?: THREE.DataTexture;
  size?: THREE.Vector2;
  compressionLevel?: number;
  elementsPerTexel?: number;
  elementsPerTexelStored?: number;
  elementsPerTexelAllocated?: number;
  textures?: THREE.DataTexture[];
  componentCount?: number;
  paddedComponentCount?: number;
  componentCountPerChannel?: number;
  textureCount?: number;
}

interface SplatBaseData {
  covariances?: any; // Make properties optional to allow delete operation
  scales?: any;
  rotations?: any;
  centers?: any;
  colors?: any;
  sphericalHarmonics?: any;
}

interface SplatDataTextures {
  baseData?: SplatBaseData;
  centerColors?: TextureContainer;
  covariances?: TextureContainer;
  covariancesHalfFloat?: TextureContainer;
  centers?: TextureContainer;
  splatColors?: TextureContainer;
  scaleRotations?: TextureContainer;
  sceneIndexes?: TextureContainer;
  sphericalHarmonics?: TextureContainer;
  sphericalHarmonicsR?: TextureContainer;
  sphericalHarmonicsG?: TextureContainer;
  sphericalHarmonicsB?: TextureContainer;
  [key: string]: TextureContainer | SplatBaseData | undefined;
}

interface DistancesTransformFeedback {
  id: WebGLTransformFeedback | null;
  vertexShader: WebGLShader | null;
  fragmentShader: WebGLShader | null;
  program: WebGLProgram | null;
  centersBuffer: WebGLBuffer | null;
  sceneIndexesBuffer: WebGLBuffer | null;
  outDistancesBuffer: WebGLBuffer | null;
  centersLoc: number;
  modelViewProjLoc: WebGLUniformLocation | null;
  sceneIndexesLoc: number;
  transformsLocs: (WebGLUniformLocation | null)[];
  vao?: WebGLVertexArrayObject | null; // Add this for TypeScript
}

interface SceneOptions {
  position?: number[];
  rotation?: number[];
  scale?: number[];
  splatAlphaRemovalThreshold?: number;
  opacity?: number;
  visible?: boolean;
}

// Constants
const dummyGeometry = new THREE.BufferGeometry();
const dummyMaterial = new THREE.MeshBasicMaterial();

const COVARIANCES_ELEMENTS_PER_SPLAT = 6;
const CENTER_COLORS_ELEMENTS_PER_SPLAT = 4;

const COVARIANCES_ELEMENTS_PER_TEXEL_STORED = 4;
const COVARIANCES_ELEMENTS_PER_TEXEL_ALLOCATED = 4;
const COVARIANCES_ELEMENTS_PER_TEXEL_COMPRESSED_STORED = 6;
const COVARIANCES_ELEMENTS_PER_TEXEL_COMPRESSED_ALLOCATED = 8;
const SCALES_ROTATIONS_ELEMENTS_PER_TEXEL = 4;
const CENTER_COLORS_ELEMENTS_PER_TEXEL = 4;
const SCENE_INDEXES_ELEMENTS_PER_TEXEL = 1;

const SCENE_FADEIN_RATE_FAST = 0.012;
const SCENE_FADEIN_RATE_GRADUAL = 0.003;

const VISIBLE_REGION_EXPANSION_DELTA = 1;

// Based on my own observations across multiple devices, OSes and browsers, using textures that have one dimension
// greater than 4096 while the other is greater than or equal to 4096 causes issues (Essentially any texture larger
// than 4096 x 4096 (16777216) texels). Specifically it seems all texture data beyond the 4096 x 4096 texel boundary
// is corrupted, while data below that boundary is usable. In these cases the texture has been valid in the eyes of
// both Three.js and WebGL, and the texel format (RG, RGBA, etc.) has not mattered. More investigation will be needed,
// but for now the work-around is to split the spherical harmonics into three textures (one for each color channel).
const MAX_TEXTURE_TEXELS = 16777216;

// Import SplatTreeNode type rather than defining our own
type SplatTreeNodeData = { indexes: number[] };
type SplatTreeNode = {
  boundingBox: THREE.Box3;
  data: SplatTreeNodeData | null;
  children?: SplatTreeNode[];
};

/**
 * SplatMesh: Container for one or more splat scenes, abstracting them into a single unified container for
 * splat data. Additionally contains data structures and code to make the splat data renderable as a Three.js mesh.
 */
export class SplatMesh extends THREE.Mesh {
  // Properties from the constructor
  renderer?: THREE.WebGLRenderer;
  splatRenderMode: SplatRenderMode;
  dynamicMode: boolean;
  enableOptionalEffects: boolean;
  halfPrecisionCovariancesOnGPU: boolean;
  devicePixelRatio: number;
  enableDistancesComputationOnGPU: boolean;
  integerBasedDistancesComputation: boolean;
  antialiased: boolean;
  maxScreenSpaceSplatSize: number;
  logLevel: LogLevel;
  sphericalHarmonicsDegree: number;
  minSphericalHarmonicsDegree: number;
  sceneFadeInRateMultiplier: number;
  kernel2DSize: number;

  // Scenes and data structures
  scenes: SplatScene[];
  splatTree: SplatTree | null;
  baseSplatTree: SplatTree | null;
  splatDataTextures: SplatDataTextures | null;
  distancesTransformFeedback: DistancesTransformFeedback;

  // Maps and indexes
  globalSplatIndexToLocalSplatIndexMap: number[];
  globalSplatIndexToSceneIndexMap: number[];

  // Build and render state
  lastBuildSplatCount: number;
  lastBuildScenes: SplatScene[];
  lastBuildMaxSplatCount: number;
  lastBuildSceneCount: number;
  firstRenderTime: number;
  finalBuild: boolean;
  webGLUtils: any; // Consider creating a specific interface

  // Additional properties needed by the build function
  sceneOptions: any;
  computeDistancesOnGPUSyncTimeout: any;
  onSplatTreeReadyCallback: ((splatTree: SplatTree | null) => void) | null =
    null;

  // Spatial properties
  boundingBox: THREE.Box3;
  calculatedSceneCenter: THREE.Vector3;
  maxSplatDistanceFromSceneCenter: number;
  visibleRegionBufferRadius: number;
  visibleRegionRadius: number;
  visibleRegionFadeStartRadius: number;
  visibleRegionChanging: boolean;

  // Rendering settings
  splatScale: number;
  pointCloudModeEnabled: boolean;

  // State flags
  disposed: boolean;
  lastRenderer: THREE.WebGLRenderer | null;
  visible: boolean;

  material: THREE.Material;

  constructor(
    splatRenderMode = SplatRenderMode.ThreeD,
    dynamicMode = false,
    enableOptionalEffects = false,
    halfPrecisionCovariancesOnGPU = false,
    devicePixelRatio = 1,
    enableDistancesComputationOnGPU = true,
    integerBasedDistancesComputation = false,
    antialiased = false,
    maxScreenSpaceSplatSize = 1024,
    logLevel = LogLevel.None,
    sphericalHarmonicsDegree = 0,
    sceneFadeInRateMultiplier = 1.0,
    kernel2DSize = 0.3
  ) {
    super(dummyGeometry, dummyMaterial);

    // Reference to a Three.js renderer
    this.renderer = undefined;

    // Determine how the splats are rendered
    this.splatRenderMode = splatRenderMode;

    // When 'dynamicMode' is true, scenes are assumed to be non-static. Dynamic scenes are handled differently
    // and certain optimizations cannot be made for them. Additionally, by default, all splat data retrieved from
    // this splat mesh will not have their scene transform applied to them if the splat mesh is dynamic. That
    // can be overriden via parameters to the individual functions that are used to retrieve splat data.
    this.dynamicMode = dynamicMode;

    // When true, allows for usage of extra properties and attributes during rendering for effects such as opacity adjustment.
    // Default is false for performance reasons. These properties are separate from transform properties (scale, rotation, position)
    // that are enabled by the 'dynamicScene' parameter.
    this.enableOptionalEffects = enableOptionalEffects;

    // Use 16-bit floating point values when storing splat covariance data in textures, instead of 32-bit
    this.halfPrecisionCovariancesOnGPU = halfPrecisionCovariancesOnGPU;

    // Ratio of the resolution in physical pixels to the resolution in CSS pixels for the current display device
    this.devicePixelRatio = devicePixelRatio;

    // Use a transform feedback to calculate splat distances from the camera
    this.enableDistancesComputationOnGPU = enableDistancesComputationOnGPU;

    // Use a faster integer-based approach for calculating splat distances from the camera
    this.integerBasedDistancesComputation = integerBasedDistancesComputation;

    // When true, will perform additional steps during rendering to address artifacts caused by the rendering of gaussians at a
    // substantially different resolution than that at which they were rendered during training. This will only work correctly
    // for models that were trained using a process that utilizes this compensation calculation. For more details:
    // https://github.com/nerfstudio-project/gsplat/pull/117
    // https://github.com/graphdeco-inria/gaussian-splatting/issues/294#issuecomment-1772688093
    this.antialiased = antialiased;

    // The size of the 2D kernel used for splat rendering
    // This will adjust the 2D kernel size after the projection
    this.kernel2DSize = kernel2DSize;

    // Specify the maximum clip space splat size, can help deal with large splats that get too unwieldy
    this.maxScreenSpaceSplatSize = maxScreenSpaceSplatSize;

    // The verbosity of console logging
    this.logLevel = logLevel;

    // Degree 0 means no spherical harmonics
    this.sphericalHarmonicsDegree = sphericalHarmonicsDegree;
    this.minSphericalHarmonicsDegree = 0;

    this.sceneFadeInRateMultiplier = sceneFadeInRateMultiplier;

    // The individual splat scenes stored in this splat mesh, each containing their own transform
    this.scenes = [];

    // Special octree tailored to SplatMesh instances
    this.splatTree = null;
    this.baseSplatTree = null;

    // Cache textures and the intermediate data used to populate them
    this.splatDataTextures = {};

    this.distancesTransformFeedback = {
      id: null,
      vertexShader: null,
      fragmentShader: null,
      program: null,
      centersBuffer: null,
      sceneIndexesBuffer: null,
      outDistancesBuffer: null,
      centersLoc: -1,
      modelViewProjLoc: -1,
      sceneIndexesLoc: -1,
      transformsLocs: [],
    };

    this.globalSplatIndexToLocalSplatIndexMap = [];
    this.globalSplatIndexToSceneIndexMap = [];

    this.lastBuildSplatCount = 0;
    this.lastBuildScenes = [];
    this.lastBuildMaxSplatCount = 0;
    this.lastBuildSceneCount = 0;
    this.firstRenderTime = -1;
    this.finalBuild = false;

    this.webGLUtils = null;

    this.boundingBox = new THREE.Box3();
    this.calculatedSceneCenter = new THREE.Vector3();
    this.maxSplatDistanceFromSceneCenter = 0;
    this.visibleRegionBufferRadius = 0;
    this.visibleRegionRadius = 0;
    this.visibleRegionFadeStartRadius = 0;
    this.visibleRegionChanging = false;

    this.splatScale = 1.0;
    this.pointCloudModeEnabled = false;

    this.disposed = false;
    this.lastRenderer = null;
    this.visible = false;

    this.material = new THREE.Material();
  }

  /**
   * Build a container for each scene managed by this splat mesh based on an instance of SplatBuffer, along with optional
   * transform data (position, scale, rotation) passed to the splat mesh during the build process.
   * @param parentObject The parent object to add the scenes to
   * @param splatBuffers SplatBuffer instances containing splats for each scene
   * @param sceneOptions Array of options objects: {
   *
   *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
   *
   *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
   *
   *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
   * }
   * @return {Array<SplatScene>}
   */
  static buildScenes(
    parentObject: THREE.Object3D,
    splatBuffers: SplatBuffer[],
    sceneOptions: SceneOptions[]
  ): SplatScene[] {
    const scenes: SplatScene[] = [];
    scenes.length = splatBuffers.length;
    for (let i = 0; i < splatBuffers.length; i++) {
      const splatBuffer = splatBuffers[i];
      const options = sceneOptions[i] || {};
      let positionArray = options["position"] || [0, 0, 0];
      let rotationArray = options["rotation"] || [0, 0, 0, 1];
      let scaleArray = options["scale"] || [1, 1, 1];
      const position = new THREE.Vector3().fromArray(positionArray);
      const rotation = new THREE.Quaternion().fromArray(rotationArray);
      const scale = new THREE.Vector3().fromArray(scaleArray);
      const scene = SplatMesh.createScene(
        splatBuffer,
        position,
        rotation,
        scale,
        options.splatAlphaRemovalThreshold || 1,
        options.opacity,
        options.visible
      );
      parentObject.add(scene);
      scenes[i] = scene;
    }
    return scenes;
  }

  /**
   * Create a new SplatScene instance
   * @param splatBuffer The buffer containing splat data
   * @param position The position of the scene
   * @param rotation The rotation of the scene as a quaternion
   * @param scale The scale of the scene
   * @param minimumAlpha The minimum alpha threshold
   * @param opacity The opacity of the scene
   * @param visible Whether the scene is visible
   * @returns A new SplatScene instance
   */
  static createScene(
    splatBuffer: SplatBuffer,
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    scale: THREE.Vector3,
    minimumAlpha: number,
    opacity: number = 1.0,
    visible: boolean = true
  ): SplatScene {
    return new SplatScene(
      splatBuffer,
      position,
      rotation,
      scale,
      minimumAlpha,
      opacity,
      visible
    );
  }

  /**
   * Build data structures that map global splat indexes (based on a unified index across all splat buffers) to
   * local data within a single scene.
   * @param splatBuffers Instances of SplatBuffer off which to build the maps
   * @return Object containing mapping arrays
   */
  static buildSplatIndexMaps(splatBuffers: SplatBuffer[]): {
    localSplatIndexMap: number[];
    sceneIndexMap: number[];
  } {
    const localSplatIndexMap: number[] = [];
    const sceneIndexMap: number[] = [];
    let totalSplatCount = 0;
    for (let s = 0; s < splatBuffers.length; s++) {
      const splatBuffer = splatBuffers[s];
      const maxSplatCount = splatBuffer.getMaxSplatCount();
      for (let i = 0; i < maxSplatCount; i++) {
        localSplatIndexMap[totalSplatCount] = i;
        sceneIndexMap[totalSplatCount] = s;
        totalSplatCount++;
      }
    }
    return {
      localSplatIndexMap,
      sceneIndexMap,
    };
  }

  /**
   * Build an instance of SplatTree (a specialized octree) for the given splat mesh.
   * @param minAlphas Array of minimum splat alphas for each scene
   * @param onSplatTreeIndexesUpload Function to be called when the upload of splat centers to the splat tree
   *                                 builder worker starts and finishes.
   * @param onSplatTreeConstruction Function to be called when the conversion of the local splat tree from
   *                                the format produced by the splat tree builder worker starts and ends.
   * @return Promise that resolves when the splat tree is built
   */
  buildSplatTree = function (
    this: SplatMesh,
    minAlphas: number[] = [],
    onSplatTreeIndexesUpload?: (isFinished: boolean) => void,
    onSplatTreeConstruction?: (isFinished: boolean) => void
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      this.disposeSplatTree();
      // TODO: expose SplatTree constructor parameters (maximumDepth and maxCentersPerNode) so that they can
      // be configured on a per-scene basis
      this.baseSplatTree = new SplatTree(8, 1000);
      const buildStartTime = performance.now();
      const splatColor = new THREE.Vector4();
      this.baseSplatTree
        .processSplatMesh(
          this,
          (splatIndex: number) => {
            this.getSplatColor(splatIndex, splatColor);
            const sceneIndex = this.getSceneIndexForSplat(splatIndex);
            const minAlpha = minAlphas[sceneIndex] || 1;
            return splatColor.w >= minAlpha;
          },
          onSplatTreeIndexesUpload,
          onSplatTreeConstruction
        )
        .then(() => {
          const buildTime = performance.now() - buildStartTime;
          if (this.logLevel >= LogLevel.Info)
            console.log("SplatTree build: " + buildTime + " ms");
          if (this.disposed) {
            resolve();
          } else {
            this.splatTree = this.baseSplatTree;
            this.baseSplatTree = null;

            let leavesWithVertices = 0;
            let avgSplatCount = 0;
            let maxSplatCount = 0;
            let nodeCount = 0;

            this.splatTree!.visitLeaves((node) => {
              if (node.data && node.data.indexes) {
                const nodeSplatCount = node.data.indexes.length;
                if (nodeSplatCount > 0) {
                  avgSplatCount += nodeSplatCount;
                  maxSplatCount = Math.max(maxSplatCount, nodeSplatCount);
                  nodeCount++;
                  leavesWithVertices++;
                }
              }
            });
            if (this.logLevel >= LogLevel.Info) {
              console.log(`SplatTree leaves: ${this.splatTree!.countLeaves()}`);
              console.log(`SplatTree leaves with splats:${leavesWithVertices}`);
              avgSplatCount = avgSplatCount / nodeCount;
              console.log(`Avg splat count per node: ${avgSplatCount}`);
              console.log(`Total splat count: ${this.getSplatCount()}`);
            }
            resolve();
          }
        });
    });
  };

  /**
   * Construct this instance of SplatMesh.
   * @param splatBuffers The base splat data, instances of SplatBuffer
   * @param sceneOptions Dynamic options for each scene {
   *
   *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
   *                                     value (valid range: 0 - 255), defaults to 1
   *
   *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
   *
   *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
   *
   *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
   *
   * }
   * @param keepSceneTransforms For a scene that already exists and is being overwritten, this flag
   *                            says to keep the transform from the existing scene.
   * @param finalBuild Will the splat mesh be in its final state after this build?
   * @param onSplatTreeIndexesUpload Function to be called when the upload of splat centers to the splat tree
   *                                 builder worker starts and finishes.
   * @param onSplatTreeConstruction Function to be called when the conversion of the local splat tree from
   *                                the format produced by the splat tree builder worker starts and ends.
   * @return Object containing info about the splats that are updated
   */
  build(
    splatBuffers: SplatBuffer[],
    sceneOptions: SceneOptions[],
    keepSceneTransforms: boolean = true,
    finalBuild: boolean = false,
    onSplatTreeIndexesUpload?: (isFinished: boolean) => void,
    onSplatTreeConstruction?: (isFinished: boolean) => void,
    preserveVisibleRegion: boolean = true
  ): {
    from: number;
    to: number;
    count: number;
    centers: any;
    sceneIndexes: any;
  } {
    this.sceneOptions = sceneOptions;
    this.finalBuild = finalBuild;

    const maxSplatCount =
      SplatMesh.getTotalMaxSplatCountForSplatBuffers(splatBuffers);

    const newScenes = SplatMesh.buildScenes(this, splatBuffers, sceneOptions);
    if (keepSceneTransforms) {
      for (let i = 0; i < this.scenes.length && i < newScenes.length; i++) {
        const newScene = newScenes[i];
        const existingScene = this.getScene(i);
        newScene.copyTransformData(existingScene);
      }
    }
    this.scenes = newScenes;

    let minSphericalHarmonicsDegree = 3;
    for (let splatBuffer of splatBuffers) {
      const splatBufferSphericalHarmonicsDegree =
        splatBuffer.getMinSphericalHarmonicsDegree();
      if (splatBufferSphericalHarmonicsDegree < minSphericalHarmonicsDegree) {
        minSphericalHarmonicsDegree = splatBufferSphericalHarmonicsDegree;
      }
    }
    this.minSphericalHarmonicsDegree = Math.min(
      minSphericalHarmonicsDegree,
      this.sphericalHarmonicsDegree
    );

    let splatBuffersChanged = false;
    if (splatBuffers.length !== this.lastBuildScenes.length) {
      splatBuffersChanged = true;
    } else {
      for (let i = 0; i < splatBuffers.length; i++) {
        const splatBuffer = splatBuffers[i];
        if (splatBuffer !== this.lastBuildScenes[i].splatBuffer) {
          splatBuffersChanged = true;
          break;
        }
      }
    }

    let isUpdateBuild = true;
    if (
      this.scenes.length !== 1 ||
      this.lastBuildSceneCount !== this.scenes.length ||
      this.lastBuildMaxSplatCount !== maxSplatCount ||
      splatBuffersChanged
    ) {
      isUpdateBuild = false;
    }

    if (!isUpdateBuild) {
      this.boundingBox = new THREE.Box3();
      if (!preserveVisibleRegion) {
        this.maxSplatDistanceFromSceneCenter = 0;
        this.visibleRegionBufferRadius = 0;
        this.visibleRegionRadius = 0;
        this.visibleRegionFadeStartRadius = 0;
        this.firstRenderTime = -1;
      }
      this.lastBuildScenes = [];
      this.lastBuildSplatCount = 0;
      this.lastBuildMaxSplatCount = 0;
      this.disposeMeshData();
      this.geometry = SplatGeometry.build(maxSplatCount);
      if (this.splatRenderMode === SplatRenderMode.ThreeD) {
        this.material = SplatMaterial3D.build(
          this.dynamicMode,
          this.enableOptionalEffects,
          this.antialiased,
          this.maxScreenSpaceSplatSize,
          this.splatScale,
          this.pointCloudModeEnabled,
          this.minSphericalHarmonicsDegree,
          this.kernel2DSize
        );
      } else {
        this.material = SplatMaterial2D.build(
          this.dynamicMode,
          this.enableOptionalEffects,
          this.splatScale,
          this.pointCloudModeEnabled,
          this.minSphericalHarmonicsDegree
        );
      }

      const indexMaps = SplatMesh.buildSplatIndexMaps(splatBuffers);
      this.globalSplatIndexToLocalSplatIndexMap = indexMaps.localSplatIndexMap;
      this.globalSplatIndexToSceneIndexMap = indexMaps.sceneIndexMap;
    }

    const splatBufferSplatCount = this.getSplatCount(true);
    if (this.enableDistancesComputationOnGPU)
      this.setupDistancesComputationTransformFeedback();
    const dataUpdateResults =
      this.refreshGPUDataFromSplatBuffers(isUpdateBuild);

    for (let i = 0; i < this.scenes.length; i++) {
      this.lastBuildScenes[i] = this.scenes[i];
    }
    this.lastBuildSplatCount = splatBufferSplatCount;
    this.lastBuildMaxSplatCount = this.getMaxSplatCount();
    this.lastBuildSceneCount = this.scenes.length;

    if (finalBuild && this.scenes.length > 0) {
      this.buildSplatTree(
        sceneOptions.map(
          (options: SceneOptions) => options.splatAlphaRemovalThreshold || 1
        ),
        onSplatTreeIndexesUpload,
        onSplatTreeConstruction
      ).then(() => {
        if (this.onSplatTreeReadyCallback)
          this.onSplatTreeReadyCallback(this.splatTree);
        this.onSplatTreeReadyCallback = null;
      });
    }

    this.visible = this.scenes.length > 0;

    return dataUpdateResults;
  }

  /**
   * Free intermediate splat data to reduce memory usage
   */
  freeIntermediateSplatData(): void {
    const deleteTextureData = (texture?: THREE.DataTexture): void => {
      if (texture?.source) {
        // Use type assertion to allow null assignment
        (texture.source as any).data = null;
      }
      if (texture?.image) {
        // Use type assertion to allow null assignment
        (texture as any).image = null;
      }
      if (texture?.onUpdate) {
        texture.onUpdate = null;
      }
    };

    // Use null assignment instead of delete for properties that aren't optional
    if (this.splatDataTextures?.baseData) {
      this.splatDataTextures.baseData.covariances = null;
      this.splatDataTextures.baseData.centers = null;
      this.splatDataTextures.baseData.colors = null;
      this.splatDataTextures.baseData.sphericalHarmonics = null;
    }

    if (this.splatDataTextures?.centerColors) {
      this.splatDataTextures.centerColors.data = null;
    }

    if (this.splatDataTextures?.covariances) {
      this.splatDataTextures.covariances.data = null;
    }
    if (this.splatDataTextures?.sphericalHarmonics) {
      this.splatDataTextures.sphericalHarmonics.data = null;
    }
    if (this.splatDataTextures?.sceneIndexes) {
      this.splatDataTextures.sceneIndexes.data = null;
    }

    if (this.splatDataTextures?.centerColors?.texture) {
      this.splatDataTextures.centerColors.texture.needsUpdate = true;
      this.splatDataTextures.centerColors.texture.onUpdate = () => {
        deleteTextureData(this.splatDataTextures?.centerColors?.texture);
      };
    }

    if (this.splatDataTextures?.covariances?.texture) {
      this.splatDataTextures.covariances.texture.needsUpdate = true;
      this.splatDataTextures.covariances.texture.onUpdate = () => {
        deleteTextureData(this.splatDataTextures?.covariances?.texture);
      };
    }

    if (this.splatDataTextures?.sphericalHarmonics) {
      if (this.splatDataTextures.sphericalHarmonics.texture) {
        this.splatDataTextures.sphericalHarmonics.texture.needsUpdate = true;
        this.splatDataTextures.sphericalHarmonics.texture.onUpdate = () => {
          deleteTextureData(
            this.splatDataTextures?.sphericalHarmonics?.texture
          );
        };
      } else if (this.splatDataTextures.sphericalHarmonics.textures) {
        this.splatDataTextures.sphericalHarmonics.textures.forEach(
          (texture: THREE.DataTexture) => {
            texture.needsUpdate = true;
            texture.onUpdate = () => {
              deleteTextureData(texture);
            };
          }
        );
      }
    }
    if (this.splatDataTextures?.sceneIndexes?.texture) {
      this.splatDataTextures.sceneIndexes.texture.needsUpdate = true;
      this.splatDataTextures.sceneIndexes.texture.onUpdate = () => {
        deleteTextureData(this.splatDataTextures?.sceneIndexes?.texture);
      };
    }
  }

  /**
   * Dispose all resources held by the splat mesh
   */
  dispose(): void {
    this.disposeMeshData();
    this.disposeTextures();
    this.disposeSplatTree();
    if (this.enableDistancesComputationOnGPU) {
      if (this.computeDistancesOnGPUSyncTimeout) {
        clearTimeout(this.computeDistancesOnGPUSyncTimeout);
        this.computeDistancesOnGPUSyncTimeout = null;
      }
      this.disposeDistancesComputationGPUResources();
    }
    this.scenes = [];
    this.distancesTransformFeedback = {
      id: null,
      vertexShader: null,
      fragmentShader: null,
      program: null,
      centersBuffer: null,
      sceneIndexesBuffer: null,
      outDistancesBuffer: null,
      centersLoc: -1,
      modelViewProjLoc: -1,
      sceneIndexesLoc: -1,
      transformsLocs: [],
    };
    this.renderer = undefined;

    this.globalSplatIndexToLocalSplatIndexMap = [];
    this.globalSplatIndexToSceneIndexMap = [];

    this.lastBuildSplatCount = 0;
    this.lastBuildScenes = [];
    this.lastBuildMaxSplatCount = 0;
    this.lastBuildSceneCount = 0;
    this.firstRenderTime = -1;
    this.finalBuild = false;

    this.webGLUtils = null;

    this.boundingBox = new THREE.Box3();
    this.calculatedSceneCenter = new THREE.Vector3();
    this.maxSplatDistanceFromSceneCenter = 0;
    this.visibleRegionBufferRadius = 0;
    this.visibleRegionRadius = 0;
    this.visibleRegionFadeStartRadius = 0;
    this.visibleRegionChanging = false;

    this.splatScale = 1.0;
    this.pointCloudModeEnabled = false;

    this.disposed = true;
    this.lastRenderer = null;
    this.visible = false;
  }

  /**
   * Dispose of only the Three.js mesh resources (geometry, material, and texture)
   */
  disposeMeshData(): void {
    if (this.geometry && this.geometry !== dummyGeometry) {
      this.geometry.dispose();
      this.geometry = dummyGeometry;
    }
    if (this.material && this.material !== dummyMaterial) {
      (this.material as THREE.Material).dispose();
      this.material = dummyMaterial;
    }
  }

  /**
   * Dispose of textures used by the splat mesh
   */
  disposeTextures(): void {
    if (!this.splatDataTextures) return;

    for (const textureKey in this.splatDataTextures) {
      if (
        Object.prototype.hasOwnProperty.call(this.splatDataTextures, textureKey)
      ) {
        const textureContainer = this.splatDataTextures[
          textureKey
        ] as TextureContainer;
        if (textureContainer && textureContainer.texture) {
          textureContainer.texture.dispose();
          textureContainer.texture = null as unknown as THREE.DataTexture;
        }
      }
    }
    this.splatDataTextures = null;
  }

  /**
   * Dispose of the splat tree resources
   */
  disposeSplatTree(): void {
    if (this.splatTree) {
      this.splatTree.dispose();
      this.splatTree = null;
    }
    if (this.baseSplatTree) {
      this.baseSplatTree.dispose();
      this.baseSplatTree = null;
    }
  }

  /**
   * Get the splat tree for this mesh
   * @returns The current splat tree or null if not built
   */
  getSplatTree(): SplatTree | null {
    return this.splatTree;
  }

  /**
   * Register a callback to be called when the splat tree is ready
   * @param callback Function to call when the splat tree is ready
   */
  onSplatTreeReady(callback: (splatTree: SplatTree | null) => void): void {
    this.onSplatTreeReadyCallback = callback;
  }

  /**
   * Get copies of data that are necessary for splat distance computation: splat center positions and splat
   * scene indexes (necessary for applying dynamic scene transformations during distance computation)
   * @param start The index at which to start copying data
   * @param end The index at which to stop copying data
   * @return Object containing centers and sceneIndexes arrays
   */
  getDataForDistancesComputation(
    start: number,
    end: number
  ): {
    centers: Int32Array | Float32Array;
    sceneIndexes: Uint32Array;
  } {
    const centers = this.integerBasedDistancesComputation
      ? this.getIntegerCenters(start, end, true)
      : this.getFloatCenters(start, end, true);
    const sceneIndexes = this.getSceneIndexes(start, end);
    return {
      centers,
      sceneIndexes,
    };
  }

  /**
   * Refresh data textures and GPU buffers with splat data from the splat buffers belonging to this mesh.
   * @param sinceLastBuildOnly Specify whether or not to only update for splats that have been added since the last build.
   * @return Object with information about updated splats
   */
  refreshGPUDataFromSplatBuffers(sinceLastBuildOnly: boolean): {
    from: number;
    to: number;
    count: number;
    centers: Int32Array | Float32Array;
    sceneIndexes: Uint32Array;
  } {
    const splatCount = this.getSplatCount(true);
    this.refreshDataTexturesFromSplatBuffers(sinceLastBuildOnly);
    const updateStart = sinceLastBuildOnly ? this.lastBuildSplatCount : 0;
    const { centers, sceneIndexes } = this.getDataForDistancesComputation(
      updateStart,
      splatCount - 1
    );
    if (this.enableDistancesComputationOnGPU) {
      this.refreshGPUBuffersForDistancesComputation(
        centers,
        sceneIndexes,
        sinceLastBuildOnly
      );
    }
    return {
      from: updateStart,
      to: splatCount - 1,
      count: splatCount - updateStart,
      centers: centers,
      sceneIndexes: sceneIndexes,
    };
  }

  /**
   * Update the GPU buffers that are used for computing splat distances on the GPU.
   * @param centers Splat center positions
   * @param sceneIndexes Indexes of the scene to which each splat belongs
   * @param sinceLastBuildOnly Specify whether or not to only update for splats that have been added since the last build.
   */
  refreshGPUBuffersForDistancesComputation(
    centers: Int32Array | Float32Array,
    sceneIndexes: Uint32Array,
    sinceLastBuildOnly: boolean = false
  ): void {
    const offset = sinceLastBuildOnly ? this.lastBuildSplatCount : 0;
    this.updateGPUCentersBufferForDistancesComputation(
      sinceLastBuildOnly,
      centers,
      offset
    );
    this.updateGPUTransformIndexesBufferForDistancesComputation(
      sinceLastBuildOnly,
      sceneIndexes,
      offset
    );
  }

  /**
   * Refresh data textures with data from the splat buffers for this mesh.
   * @param sinceLastBuildOnly Specify whether or not to only update for splats that have been added since the last build.
   */
  refreshDataTexturesFromSplatBuffers(sinceLastBuildOnly: boolean): void {
    const splatCount = this.getSplatCount(true);
    const fromSplat = this.lastBuildSplatCount;
    const toSplat = splatCount - 1;

    if (!sinceLastBuildOnly) {
      this.setupDataTextures();
      this.updateBaseDataFromSplatBuffers();
    } else {
      this.updateBaseDataFromSplatBuffers(fromSplat, toSplat);
    }

    this.updateDataTexturesFromBaseData(fromSplat, toSplat);
    this.updateVisibleRegion(sinceLastBuildOnly);
  }

  /**
   * Setup data textures for the splat mesh
   */
  setupDataTextures(): void {
    const maxSplatCount = this.getMaxSplatCount();
    const splatCount = this.getSplatCount(true);

    this.disposeTextures();

    const computeDataTextureSize = (
      elementsPerTexel: number,
      elementsPerSplat: number
    ): THREE.Vector2 => {
      const texSize = new THREE.Vector2(4096, 1024);
      while (
        texSize.x * texSize.y * elementsPerTexel <
        maxSplatCount * elementsPerSplat
      )
        texSize.y *= 2;
      return texSize;
    };

    const getCovariancesElementsPertexelStored = (
      compressionLevel: number
    ): number => {
      return compressionLevel >= 1
        ? COVARIANCES_ELEMENTS_PER_TEXEL_COMPRESSED_STORED
        : COVARIANCES_ELEMENTS_PER_TEXEL_STORED;
    };

    const getCovariancesInitialTextureSpecs = (
      compressionLevel: number
    ): { elementsPerTexelStored: number; texSize: THREE.Vector2 } => {
      const elementsPerTexelStored =
        getCovariancesElementsPertexelStored(compressionLevel);
      const texSize = computeDataTextureSize(elementsPerTexelStored, 6);
      return { elementsPerTexelStored, texSize };
    };

    let covarianceCompressionLevel = this.getTargetCovarianceCompressionLevel();
    const scaleRotationCompressionLevel = 0;
    const shCompressionLevel =
      this.getTargetSphericalHarmonicsCompressionLevel();

    let covariances: Float32Array | undefined;
    let scales: Float32Array | undefined;
    let rotations: Float32Array | undefined;
    if (this.splatRenderMode === SplatRenderMode.ThreeD) {
      const initialCovTexSpecs = getCovariancesInitialTextureSpecs(
        covarianceCompressionLevel
      );
      if (
        initialCovTexSpecs.texSize.x * initialCovTexSpecs.texSize.y >
          MAX_TEXTURE_TEXELS &&
        covarianceCompressionLevel === 0
      ) {
        covarianceCompressionLevel = 1;
      }
      covariances = new Float32Array(
        maxSplatCount * COVARIANCES_ELEMENTS_PER_SPLAT
      );
    } else {
      scales = new Float32Array(maxSplatCount * 3);
      rotations = new Float32Array(maxSplatCount * 4);
    }

    const centers = new Float32Array(maxSplatCount * 3);
    const colors = new Uint8Array(maxSplatCount * 4);

    // Type-safety approach: create a union type for the array type constructor
    type ArrayTypeConstructor =
      | typeof Float32Array
      | typeof Uint16Array
      | typeof Uint8Array;
    let SphericalHarmonicsArrayType: ArrayTypeConstructor = Float32Array;
    if (shCompressionLevel === 1) SphericalHarmonicsArrayType = Uint16Array;
    else if (shCompressionLevel === 2) SphericalHarmonicsArrayType = Uint8Array;

    const shComponentCount = getSphericalHarmonicsComponentCountForDegree(
      this.minSphericalHarmonicsDegree
    );
    const shData = this.minSphericalHarmonicsDegree
      ? new SphericalHarmonicsArrayType(maxSplatCount * shComponentCount)
      : undefined;

    // set up centers/colors data texture
    const centersColsTexSize = computeDataTextureSize(
      CENTER_COLORS_ELEMENTS_PER_TEXEL,
      4
    );
    const paddedCentersCols = new Uint32Array(
      centersColsTexSize.x *
        centersColsTexSize.y *
        CENTER_COLORS_ELEMENTS_PER_TEXEL
    );
    SplatMesh.updateCenterColorsPaddedData(
      0,
      splatCount - 1,
      centers,
      colors,
      paddedCentersCols
    );

    const centersColsTex = new THREE.DataTexture(
      paddedCentersCols,
      centersColsTexSize.x,
      centersColsTexSize.y,
      THREE.RGBAIntegerFormat,
      THREE.UnsignedIntType
    );
    centersColsTex.internalFormat = "RGBA32UI";
    centersColsTex.needsUpdate = true;

    // Cast material to ShaderMaterial to access uniforms
    const material = this.material as THREE.ShaderMaterial;
    material.uniforms.centersColorsTexture.value = centersColsTex;
    material.uniforms.centersColorsTextureSize.value.copy(centersColsTexSize);
    material.uniformsNeedUpdate = true;

    this.splatDataTextures = {
      baseData: {
        covariances: covariances,
        scales: scales,
        rotations: rotations,
        centers: centers,
        colors: colors,
        sphericalHarmonics: shData,
      },
      centerColors: {
        data: paddedCentersCols,
        texture: centersColsTex,
        size: centersColsTexSize,
      },
    };

    if (this.splatRenderMode === SplatRenderMode.ThreeD) {
      // set up covariances data texture
      const covTexSpecs = getCovariancesInitialTextureSpecs(
        covarianceCompressionLevel
      );
      const covariancesElementsPerTexelStored =
        covTexSpecs.elementsPerTexelStored;
      const covTexSize = covTexSpecs.texSize;

      const CovariancesDataType =
        covarianceCompressionLevel >= 1 ? Uint32Array : Float32Array;
      const covariancesElementsPerTexelAllocated =
        covarianceCompressionLevel >= 1
          ? COVARIANCES_ELEMENTS_PER_TEXEL_COMPRESSED_ALLOCATED
          : COVARIANCES_ELEMENTS_PER_TEXEL_ALLOCATED;
      const covariancesTextureData = new CovariancesDataType(
        covTexSize.x * covTexSize.y * covariancesElementsPerTexelAllocated
      );

      if (covarianceCompressionLevel === 0 && covariances) {
        covariancesTextureData.set(covariances);
      } else if (covariances) {
        SplatMesh.updatePaddedCompressedCovariancesTextureData(
          covariances,
          covariancesTextureData as Uint32Array,
          0,
          0,
          covariances.length
        );
      }

      let covTex: THREE.DataTexture;
      if (covarianceCompressionLevel >= 1) {
        covTex = new THREE.DataTexture(
          covariancesTextureData,
          covTexSize.x,
          covTexSize.y,
          THREE.RGBAIntegerFormat,
          THREE.UnsignedIntType
        );
        covTex.internalFormat = "RGBA32UI";
        material.uniforms.covariancesTextureHalfFloat.value = covTex;
      } else {
        covTex = new THREE.DataTexture(
          covariancesTextureData,
          covTexSize.x,
          covTexSize.y,
          THREE.RGBAFormat,
          THREE.FloatType
        );
        material.uniforms.covariancesTexture.value = covTex;

        // For some reason a usampler2D needs to have a valid texture attached or WebGL complains
        const dummyTex = new THREE.DataTexture(
          new Uint32Array(32),
          2,
          2,
          THREE.RGBAIntegerFormat,
          THREE.UnsignedIntType
        );
        dummyTex.internalFormat = "RGBA32UI";
        material.uniforms.covariancesTextureHalfFloat.value = dummyTex;
        dummyTex.needsUpdate = true;
      }
      covTex.needsUpdate = true;

      material.uniforms.covariancesAreHalfFloat.value =
        covarianceCompressionLevel >= 1 ? 1 : 0;
      material.uniforms.covariancesTextureSize.value.copy(covTexSize);

      this.splatDataTextures["covariances"] = {
        data: covariancesTextureData,
        texture: covTex,
        size: covTexSize,
        compressionLevel: covarianceCompressionLevel,
        elementsPerTexel: covariancesElementsPerTexelStored,
      };
    } else {
      // set up scale & rotations data texture
      const elementsPerSplat = 6;
      const scaleRotationsTexSize = computeDataTextureSize(
        SCALES_ROTATIONS_ELEMENTS_PER_TEXEL,
        elementsPerSplat
      );
      let ScaleRotationsDataType =
        scaleRotationCompressionLevel >= 1 ? Uint16Array : Float32Array;
      let scaleRotationsTextureType =
        scaleRotationCompressionLevel >= 1
          ? THREE.HalfFloatType
          : THREE.FloatType;
      const paddedScaleRotations = new ScaleRotationsDataType(
        scaleRotationsTexSize.x *
          scaleRotationsTexSize.y *
          SCALES_ROTATIONS_ELEMENTS_PER_TEXEL
      );

      if (scales && rotations) {
        SplatMesh.updateScaleRotationsPaddedData(
          0,
          splatCount - 1,
          scales,
          rotations,
          paddedScaleRotations
        );
      }

      const scaleRotationsTex = new THREE.DataTexture(
        paddedScaleRotations,
        scaleRotationsTexSize.x,
        scaleRotationsTexSize.y,
        THREE.RGBAFormat,
        scaleRotationsTextureType
      );
      scaleRotationsTex.needsUpdate = true;
      material.uniforms.scaleRotationsTexture.value = scaleRotationsTex;
      material.uniforms.scaleRotationsTextureSize.value.copy(
        scaleRotationsTexSize
      );

      this.splatDataTextures["scaleRotations"] = {
        data: paddedScaleRotations,
        texture: scaleRotationsTex,
        size: scaleRotationsTexSize,
        compressionLevel: scaleRotationCompressionLevel,
      };
    }

    if (shData) {
      const shTextureType =
        shCompressionLevel === 2 ? THREE.UnsignedByteType : THREE.HalfFloatType;

      let paddedSHComponentCount = shComponentCount;
      if (paddedSHComponentCount % 2 !== 0) paddedSHComponentCount++;
      const shElementsPerTexel = 4;
      const texelFormat =
        shElementsPerTexel === 4 ? THREE.RGBAFormat : THREE.RGFormat;
      let shTexSize = computeDataTextureSize(
        shElementsPerTexel,
        paddedSHComponentCount
      );

      // Use one texture for all spherical harmonics data
      if (shTexSize.x * shTexSize.y <= MAX_TEXTURE_TEXELS) {
        const paddedSHArraySize =
          shTexSize.x * shTexSize.y * shElementsPerTexel;
        const paddedSHArray = new SphericalHarmonicsArrayType(
          paddedSHArraySize
        );
        for (let c = 0; c < splatCount; c++) {
          const srcBase = shComponentCount * c;
          const destBase = paddedSHComponentCount * c;
          for (let i = 0; i < shComponentCount; i++) {
            paddedSHArray[destBase + i] = shData[srcBase + i];
          }
        }

        const shTexture = new THREE.DataTexture(
          paddedSHArray,
          shTexSize.x,
          shTexSize.y,
          texelFormat,
          shTextureType
        );
        shTexture.needsUpdate = true;
        material.uniforms.sphericalHarmonicsTexture.value = shTexture;
        this.splatDataTextures["sphericalHarmonics"] = {
          componentCount: shComponentCount,
          paddedComponentCount: paddedSHComponentCount,
          data: paddedSHArray,
          textureCount: 1,
          texture: shTexture,
          size: shTexSize,
          compressionLevel: shCompressionLevel,
          elementsPerTexel: shElementsPerTexel,
        };
        // Use three textures for spherical harmonics data, one per color channel
      } else {
        const shComponentCountPerChannel = shComponentCount / 3;
        paddedSHComponentCount = shComponentCountPerChannel;
        if (paddedSHComponentCount % 2 !== 0) paddedSHComponentCount++;
        shTexSize = computeDataTextureSize(
          shElementsPerTexel,
          paddedSHComponentCount
        );

        const paddedSHArraySize =
          shTexSize.x * shTexSize.y * shElementsPerTexel;
        const textureUniforms = [
          material.uniforms.sphericalHarmonicsTextureR,
          material.uniforms.sphericalHarmonicsTextureG,
          material.uniforms.sphericalHarmonicsTextureB,
        ];
        const paddedSHArrays = [];
        const shTextures = [];
        for (let t = 0; t < 3; t++) {
          const paddedSHArray = new SphericalHarmonicsArrayType(
            paddedSHArraySize
          );
          paddedSHArrays.push(paddedSHArray);
          for (let c = 0; c < splatCount; c++) {
            const srcBase = shComponentCount * c;
            const destBase = paddedSHComponentCount * c;
            if (shComponentCountPerChannel >= 3) {
              for (let i = 0; i < 3; i++)
                paddedSHArray[destBase + i] = shData[srcBase + t * 3 + i];
              if (shComponentCountPerChannel >= 8) {
                for (let i = 0; i < 5; i++)
                  paddedSHArray[destBase + 3 + i] =
                    shData[srcBase + 9 + t * 5 + i];
              }
            }
          }

          const shTexture = new THREE.DataTexture(
            paddedSHArray,
            shTexSize.x,
            shTexSize.y,
            texelFormat,
            shTextureType
          );
          shTextures.push(shTexture);
          shTexture.needsUpdate = true;
          textureUniforms[t].value = shTexture;
        }

        material.uniforms.sphericalHarmonicsMultiTextureMode.value = 1;
        this.splatDataTextures["sphericalHarmonics"] = {
          componentCount: shComponentCount,
          componentCountPerChannel: shComponentCountPerChannel,
          paddedComponentCount: paddedSHComponentCount,
          data: paddedSHArrays,
          textureCount: 3,
          textures: shTextures,
          size: shTexSize,
          compressionLevel: shCompressionLevel,
          elementsPerTexel: shElementsPerTexel,
        };
      }

      material.uniforms.sphericalHarmonicsTextureSize.value.copy(shTexSize);
      material.uniforms.sphericalHarmonics8BitMode.value =
        shCompressionLevel === 2 ? 1 : 0;
      for (let s = 0; s < this.scenes.length; s++) {
        const splatBuffer = this.scenes[s].splatBuffer;
        material.uniforms.sphericalHarmonics8BitCompressionRangeMin.value[s] =
          splatBuffer.minSphericalHarmonicsCoeff;
        material.uniforms.sphericalHarmonics8BitCompressionRangeMax.value[s] =
          splatBuffer.maxSphericalHarmonicsCoeff;
      }
      material.uniformsNeedUpdate = true;
    }

    // Setting up scene indexes
    const sceneIndexesTexSize = computeDataTextureSize(
      SCENE_INDEXES_ELEMENTS_PER_TEXEL,
      4
    );
    const paddedTransformIndexes = new Uint32Array(
      sceneIndexesTexSize.x *
        sceneIndexesTexSize.y *
        SCENE_INDEXES_ELEMENTS_PER_TEXEL
    );
    for (let c = 0; c < splatCount; c++)
      paddedTransformIndexes[c] = this.globalSplatIndexToSceneIndexMap[c];
    const sceneIndexesTexture = new THREE.DataTexture(
      paddedTransformIndexes,
      sceneIndexesTexSize.x,
      sceneIndexesTexSize.y,
      THREE.RedIntegerFormat,
      THREE.UnsignedIntType
    );
    sceneIndexesTexture.internalFormat = "R32UI";
    sceneIndexesTexture.needsUpdate = true;
    material.uniforms.sceneIndexesTexture.value = sceneIndexesTexture;
    material.uniforms.sceneIndexesTextureSize.value.copy(sceneIndexesTexSize);
    material.uniformsNeedUpdate = true;
    this.splatDataTextures["sceneIndexes"] = {
      data: paddedTransformIndexes,
      texture: sceneIndexesTexture,
      size: sceneIndexesTexSize,
    };
    material.uniforms.sceneCount.value = this.scenes.length;
  }

  /**
   * Update base data from splat buffers
   * @param fromSplat Start splat index (optional)
   * @param toSplat End splat index (optional)
   */
  updateBaseDataFromSplatBuffers(
    fromSplat: number = 0,
    toSplat: number = 0
  ): void {
    if (!this.splatDataTextures || !this.splatDataTextures.baseData) return;

    // Get texture descriptors with proper type checks
    const covarancesTextureDesc = this.splatDataTextures["covariances"];
    const covarianceCompressionLevel = covarancesTextureDesc
      ? covarancesTextureDesc.compressionLevel
      : undefined;
    const scaleRotationsTextureDesc = this.splatDataTextures["scaleRotations"];
    const scaleRotationCompressionLevel = scaleRotationsTextureDesc
      ? scaleRotationsTextureDesc.compressionLevel
      : undefined;
    const shTextureDesc = this.splatDataTextures["sphericalHarmonics"];
    const shCompressionLevel = shTextureDesc
      ? shTextureDesc.compressionLevel
      : 0;

    // // Safe type checking helper for texture properties
    const isWebGLTextureReady = <T>(props: T): boolean => {
      return Boolean(
        props &&
          typeof props === "object" &&
          "__webglTexture" in props &&
          props.__webglTexture
      );
    };

    // Update center & color data texture
    const centerColorsTextureDescriptor =
      this.splatDataTextures["centerColors"];
    if (
      centerColorsTextureDescriptor?.data &&
      centerColorsTextureDescriptor?.texture &&
      this.splatDataTextures.baseData.centers &&
      this.splatDataTextures.baseData.colors
    ) {
      const paddedCenterColors = centerColorsTextureDescriptor.data;
      const centerColorsTexture = centerColorsTextureDescriptor.texture;
      SplatMesh.updateCenterColorsPaddedData(
        fromSplat,
        toSplat,
        this.splatDataTextures.baseData.centers as Float32Array,
        this.splatDataTextures.baseData.colors as Uint8Array,
        paddedCenterColors as Uint32Array
      );
      const centerColorsTextureProps = this.renderer
        ? this.renderer.properties.get(centerColorsTexture)
        : null;
      if (!isWebGLTextureReady(centerColorsTextureProps)) {
        centerColorsTexture.needsUpdate = true;
      } else if (centerColorsTextureDescriptor.size) {
        this.updateDataTexture(
          paddedCenterColors,
          centerColorsTexture,
          centerColorsTextureDescriptor.size,
          centerColorsTextureProps,
          CENTER_COLORS_ELEMENTS_PER_TEXEL,
          CENTER_COLORS_ELEMENTS_PER_SPLAT,
          4,
          fromSplat,
          toSplat
        );
      }
    }

    // Update covariance data texture
    if (
      covarancesTextureDesc?.data &&
      covarancesTextureDesc?.texture &&
      this.splatDataTextures.baseData.covariances
    ) {
      const covariancesTexture = covarancesTextureDesc.texture;
      const covarancesStartElement = fromSplat * COVARIANCES_ELEMENTS_PER_SPLAT;
      const covariancesEndElement = toSplat * COVARIANCES_ELEMENTS_PER_SPLAT;

      if (covarianceCompressionLevel === 0) {
        for (let i = covarancesStartElement; i <= covariancesEndElement; i++) {
          const covariance = this.splatDataTextures.baseData.covariances[i];
          covarancesTextureDesc.data[i] = covariance;
        }
      } else if (
        // Use type assertion for elementsPerTexelAllocated which exists in JS but not in our interface
        "elementsPerTexelAllocated" in covarancesTextureDesc
      ) {
        const elementsPerTexelAllocated = (covarancesTextureDesc as any)
          .elementsPerTexelAllocated;
        SplatMesh.updatePaddedCompressedCovariancesTextureData(
          this.splatDataTextures.baseData.covariances as Float32Array,
          covarancesTextureDesc.data as Uint32Array,
          fromSplat * elementsPerTexelAllocated,
          covarancesStartElement,
          covariancesEndElement
        );
      }

      const covariancesTextureProps = this.renderer
        ? this.renderer.properties.get(covariancesTexture)
        : null;
      if (!isWebGLTextureReady(covariancesTextureProps)) {
        covariancesTexture.needsUpdate = true;
      } else if (covarancesTextureDesc.size) {
        if (covarianceCompressionLevel === 0) {
          const elementsPerTexelStored =
            (covarancesTextureDesc as any).elementsPerTexelStored ||
            covarancesTextureDesc.elementsPerTexel;
          this.updateDataTexture(
            covarancesTextureDesc.data,
            covariancesTexture,
            covarancesTextureDesc.size,
            covariancesTextureProps,
            elementsPerTexelStored,
            COVARIANCES_ELEMENTS_PER_SPLAT,
            4,
            fromSplat,
            toSplat
          );
        } else {
          const elementsPerTexelAllocated = (covarancesTextureDesc as any)
            .elementsPerTexelAllocated;
          if (elementsPerTexelAllocated) {
            this.updateDataTexture(
              covarancesTextureDesc.data,
              covariancesTexture,
              covarancesTextureDesc.size,
              covariancesTextureProps,
              elementsPerTexelAllocated,
              elementsPerTexelAllocated,
              2,
              fromSplat,
              toSplat
            );
          }
        }
      }
    }

    // Update scale and rotation data texture
    if (
      scaleRotationsTextureDesc?.data &&
      scaleRotationsTextureDesc?.texture &&
      this.splatDataTextures.baseData.scales &&
      this.splatDataTextures.baseData.rotations
    ) {
      const paddedScaleRotations = scaleRotationsTextureDesc.data;
      const scaleRotationsTexture = scaleRotationsTextureDesc.texture;
      const elementsPerSplat = 6;
      const bytesPerElement = scaleRotationCompressionLevel === 0 ? 4 : 2;

      SplatMesh.updateScaleRotationsPaddedData(
        fromSplat,
        toSplat,
        this.splatDataTextures.baseData.scales as Float32Array,
        this.splatDataTextures.baseData.rotations as Float32Array,
        paddedScaleRotations as Float32Array | Uint16Array
      );
      const scaleRotationsTextureProps = this.renderer
        ? this.renderer.properties.get(scaleRotationsTexture)
        : null;
      if (!isWebGLTextureReady(scaleRotationsTextureProps)) {
        scaleRotationsTexture.needsUpdate = true;
      } else if (scaleRotationsTextureDesc.size) {
        this.updateDataTexture(
          paddedScaleRotations,
          scaleRotationsTexture,
          scaleRotationsTextureDesc.size,
          scaleRotationsTextureProps,
          SCALES_ROTATIONS_ELEMENTS_PER_TEXEL,
          elementsPerSplat,
          bytesPerElement,
          fromSplat,
          toSplat
        );
      }
    }

    // Update spherical harmonics data texture
    const shData = this.splatDataTextures.baseData.sphericalHarmonics;
    if (shData && shTextureDesc) {
      let shBytesPerElement = 4;
      if (shCompressionLevel === 1) shBytesPerElement = 2;
      else if (shCompressionLevel === 2) shBytesPerElement = 1;

      // Helper function to update textures
      const updateTexture = (
        shTexture: THREE.DataTexture,
        shTextureSize: THREE.Vector2,
        elementsPerTexel: number,
        paddedSHArray: any,
        paddedSHComponentCount: number
      ): void => {
        const shTextureProps = this.renderer
          ? this.renderer.properties.get(shTexture)
          : null;
        if (!isWebGLTextureReady(shTextureProps)) {
          shTexture.needsUpdate = true;
        } else {
          this.updateDataTexture(
            paddedSHArray,
            shTexture,
            shTextureSize,
            shTextureProps,
            elementsPerTexel,
            paddedSHComponentCount,
            shBytesPerElement,
            fromSplat,
            toSplat
          );
        }
      };

      // Safe access to required properties
      const shComponentCount = shTextureDesc.componentCount;
      const paddedSHComponentCount = shTextureDesc.paddedComponentCount;

      if (
        shComponentCount !== undefined &&
        paddedSHComponentCount !== undefined
      ) {
        // Update for the case of a single texture for all spherical harmonics data
        if (
          shTextureDesc.textureCount === 1 &&
          shTextureDesc.data &&
          shTextureDesc.texture &&
          shTextureDesc.size &&
          shTextureDesc.elementsPerTexel
        ) {
          const paddedSHArray = shTextureDesc.data;
          for (let c = fromSplat; c <= toSplat; c++) {
            const srcBase = shComponentCount * c;
            const destBase = paddedSHComponentCount * c;
            for (let i = 0; i < shComponentCount; i++) {
              paddedSHArray[destBase + i] = shData[srcBase + i];
            }
          }
          updateTexture(
            shTextureDesc.texture,
            shTextureDesc.size,
            shTextureDesc.elementsPerTexel,
            paddedSHArray,
            paddedSHComponentCount
          );
          // Update for the case of spherical harmonics data split among three textures
        } else if (
          shTextureDesc.textureCount !== 1 &&
          shTextureDesc.data &&
          Array.isArray(shTextureDesc.textures) &&
          shTextureDesc.size &&
          shTextureDesc.elementsPerTexel &&
          shTextureDesc.componentCountPerChannel
        ) {
          const shComponentCountPerChannel =
            shTextureDesc.componentCountPerChannel;
          for (let t = 0; t < 3 && t < shTextureDesc.textures.length; t++) {
            const paddedSHArray = shTextureDesc.data[t];
            for (let c = fromSplat; c <= toSplat; c++) {
              const srcBase = shComponentCount * c;
              const destBase = paddedSHComponentCount * c;
              if (shComponentCountPerChannel >= 3) {
                for (let i = 0; i < 3; i++)
                  paddedSHArray[destBase + i] = shData[srcBase + t * 3 + i];
                if (shComponentCountPerChannel >= 8) {
                  for (let i = 0; i < 5; i++)
                    paddedSHArray[destBase + 3 + i] =
                      shData[srcBase + 9 + t * 5 + i];
                }
              }
            }
            updateTexture(
              shTextureDesc.textures[t],
              shTextureDesc.size,
              shTextureDesc.elementsPerTexel,
              paddedSHArray,
              paddedSHComponentCount
            );
          }
        }
      }
    }

    // Update scene index & transform data
    const sceneIndexesTexDesc = this.splatDataTextures["sceneIndexes"];
    if (
      sceneIndexesTexDesc?.data &&
      sceneIndexesTexDesc?.texture &&
      sceneIndexesTexDesc?.size
    ) {
      const paddedSceneIndexes = sceneIndexesTexDesc.data;
      for (let c = this.lastBuildSplatCount; c <= toSplat; c++) {
        paddedSceneIndexes[c] = this.globalSplatIndexToSceneIndexMap[c];
      }
      const sceneIndexesTexture = sceneIndexesTexDesc.texture;
      const sceneIndexesTextureProps = this.renderer
        ? this.renderer.properties.get(sceneIndexesTexture)
        : null;
      if (!isWebGLTextureReady(sceneIndexesTextureProps)) {
        sceneIndexesTexture.needsUpdate = true;
      } else {
        this.updateDataTexture(
          paddedSceneIndexes,
          sceneIndexesTexture,
          sceneIndexesTexDesc.size,
          sceneIndexesTextureProps,
          1,
          1,
          1,
          this.lastBuildSplatCount,
          toSplat
        );
      }
    }
  }

  /**
   * Update data textures from base data
   * @param fromSplat Start splat index
   * @param toSplat End splat index
   */
  updateDataTexturesFromBaseData(fromSplat: number, toSplat: number): void {
    if (!this.splatDataTextures || !this.splatDataTextures.baseData) return;

    // Get texture descriptors with proper type checks
    const covarancesTextureDesc = this.splatDataTextures["covariances"];
    const covarianceCompressionLevel = covarancesTextureDesc
      ? covarancesTextureDesc.compressionLevel
      : undefined;
    const scaleRotationsTextureDesc = this.splatDataTextures["scaleRotations"];
    const scaleRotationCompressionLevel = scaleRotationsTextureDesc
      ? scaleRotationsTextureDesc.compressionLevel
      : undefined;
    const shTextureDesc = this.splatDataTextures["sphericalHarmonics"];
    const shCompressionLevel = shTextureDesc
      ? shTextureDesc.compressionLevel
      : 0;

    // Safe type checking helper for texture properties
    const isWebGLTextureReady = (props: any): boolean => {
      return (
        props &&
        typeof props === "object" &&
        "__webglTexture" in props &&
        props.__webglTexture
      );
    };

    // Update center & color data texture
    const centerColorsTextureDescriptor =
      this.splatDataTextures["centerColors"];
    if (
      centerColorsTextureDescriptor?.data &&
      centerColorsTextureDescriptor?.texture &&
      this.splatDataTextures.baseData.centers &&
      this.splatDataTextures.baseData.colors
    ) {
      const paddedCenterColors = centerColorsTextureDescriptor.data;
      const centerColorsTexture = centerColorsTextureDescriptor.texture;
      SplatMesh.updateCenterColorsPaddedData(
        fromSplat,
        toSplat,
        this.splatDataTextures.baseData.centers as Float32Array,
        this.splatDataTextures.baseData.colors as Uint8Array,
        paddedCenterColors as Uint32Array
      );
      const centerColorsTextureProps = this.renderer
        ? this.renderer.properties.get(centerColorsTexture)
        : null;
      if (!isWebGLTextureReady(centerColorsTextureProps)) {
        centerColorsTexture.needsUpdate = true;
      } else if (centerColorsTextureDescriptor.size) {
        this.updateDataTexture(
          paddedCenterColors,
          centerColorsTexture,
          centerColorsTextureDescriptor.size,
          centerColorsTextureProps,
          CENTER_COLORS_ELEMENTS_PER_TEXEL,
          CENTER_COLORS_ELEMENTS_PER_SPLAT,
          4,
          fromSplat,
          toSplat
        );
      }
    }

    // Update covariance data texture
    if (
      covarancesTextureDesc?.data &&
      covarancesTextureDesc?.texture &&
      this.splatDataTextures.baseData.covariances
    ) {
      const covariancesTexture = covarancesTextureDesc.texture;
      const covarancesStartElement = fromSplat * COVARIANCES_ELEMENTS_PER_SPLAT;
      const covariancesEndElement = toSplat * COVARIANCES_ELEMENTS_PER_SPLAT;

      if (covarianceCompressionLevel === 0) {
        for (let i = covarancesStartElement; i <= covariancesEndElement; i++) {
          const covariance = this.splatDataTextures.baseData.covariances[i];
          covarancesTextureDesc.data[i] = covariance;
        }
      } else if (
        // Use type assertion for elementsPerTexelAllocated which exists in JS but not in our interface
        "elementsPerTexelAllocated" in covarancesTextureDesc
      ) {
        const elementsPerTexelAllocated = (covarancesTextureDesc as any)
          .elementsPerTexelAllocated;
        SplatMesh.updatePaddedCompressedCovariancesTextureData(
          this.splatDataTextures.baseData.covariances as Float32Array,
          covarancesTextureDesc.data as Uint32Array,
          fromSplat * elementsPerTexelAllocated,
          covarancesStartElement,
          covariancesEndElement
        );
      }

      const covariancesTextureProps = this.renderer
        ? this.renderer.properties.get(covariancesTexture)
        : null;
      if (!isWebGLTextureReady(covariancesTextureProps)) {
        covariancesTexture.needsUpdate = true;
      } else if (covarancesTextureDesc.size) {
        if (covarianceCompressionLevel === 0) {
          const elementsPerTexelStored =
            (covarancesTextureDesc as any).elementsPerTexelStored ||
            covarancesTextureDesc.elementsPerTexel ||
            4;
          this.updateDataTexture(
            covarancesTextureDesc.data,
            covariancesTexture,
            covarancesTextureDesc.size,
            covariancesTextureProps,
            elementsPerTexelStored,
            COVARIANCES_ELEMENTS_PER_SPLAT,
            4,
            fromSplat,
            toSplat
          );
        } else {
          const elementsPerTexelAllocated =
            (covarancesTextureDesc as any).elementsPerTexelAllocated || 4;
          this.updateDataTexture(
            covarancesTextureDesc.data,
            covariancesTexture,
            covarancesTextureDesc.size,
            covariancesTextureProps,
            elementsPerTexelAllocated,
            elementsPerTexelAllocated,
            2,
            fromSplat,
            toSplat
          );
        }
      }
    }

    // Update scale and rotation data texture
    if (
      scaleRotationsTextureDesc?.data &&
      scaleRotationsTextureDesc?.texture &&
      this.splatDataTextures.baseData.scales &&
      this.splatDataTextures.baseData.rotations
    ) {
      const paddedScaleRotations = scaleRotationsTextureDesc.data;
      const scaleRotationsTexture = scaleRotationsTextureDesc.texture;
      const elementsPerSplat = 6;
      const bytesPerElement = scaleRotationCompressionLevel === 0 ? 4 : 2;

      SplatMesh.updateScaleRotationsPaddedData(
        fromSplat,
        toSplat,
        this.splatDataTextures.baseData.scales as Float32Array,
        this.splatDataTextures.baseData.rotations as Float32Array,
        paddedScaleRotations as Float32Array | Uint16Array
      );
      const scaleRotationsTextureProps = this.renderer
        ? this.renderer.properties.get(scaleRotationsTexture)
        : null;
      if (!isWebGLTextureReady(scaleRotationsTextureProps)) {
        scaleRotationsTexture.needsUpdate = true;
      } else if (scaleRotationsTextureDesc.size) {
        this.updateDataTexture(
          paddedScaleRotations,
          scaleRotationsTexture,
          scaleRotationsTextureDesc.size,
          scaleRotationsTextureProps,
          SCALES_ROTATIONS_ELEMENTS_PER_TEXEL,
          elementsPerSplat,
          bytesPerElement,
          fromSplat,
          toSplat
        );
      }
    }

    // Update spherical harmonics data texture
    const shData = this.splatDataTextures.baseData.sphericalHarmonics;
    if (shData && shTextureDesc) {
      let shBytesPerElement = 4;
      if (shCompressionLevel === 1) shBytesPerElement = 2;
      else if (shCompressionLevel === 2) shBytesPerElement = 1;

      // Helper function to update textures
      const updateTexture = (
        shTexture: THREE.DataTexture,
        shTextureSize: THREE.Vector2,
        elementsPerTexel: number,
        paddedSHArray: any,
        paddedSHComponentCount: number
      ): void => {
        const shTextureProps = this.renderer
          ? this.renderer.properties.get(shTexture)
          : null;
        if (!isWebGLTextureReady(shTextureProps)) {
          shTexture.needsUpdate = true;
        } else {
          this.updateDataTexture(
            paddedSHArray,
            shTexture,
            shTextureSize,
            shTextureProps,
            elementsPerTexel,
            paddedSHComponentCount,
            shBytesPerElement,
            fromSplat,
            toSplat
          );
        }
      };

      // Safe access to required properties
      const shComponentCount = shTextureDesc.componentCount || 0;
      const paddedSHComponentCount = shTextureDesc.paddedComponentCount || 0;

      // Update for the case of a single texture for all spherical harmonics data
      if (
        shTextureDesc.textureCount === 1 &&
        shTextureDesc.data &&
        shTextureDesc.texture &&
        shTextureDesc.size &&
        shTextureDesc.elementsPerTexel
      ) {
        const paddedSHArray = shTextureDesc.data;
        for (let c = fromSplat; c <= toSplat; c++) {
          const srcBase = shComponentCount * c;
          const destBase = paddedSHComponentCount * c;
          for (let i = 0; i < shComponentCount; i++) {
            paddedSHArray[destBase + i] = shData[srcBase + i];
          }
        }
        updateTexture(
          shTextureDesc.texture,
          shTextureDesc.size,
          shTextureDesc.elementsPerTexel,
          paddedSHArray,
          paddedSHComponentCount
        );
        // Update for the case of spherical harmonics data split among three textures
      } else if (
        shTextureDesc.textureCount !== 1 &&
        shTextureDesc.data &&
        Array.isArray(shTextureDesc.textures) &&
        shTextureDesc.size &&
        shTextureDesc.elementsPerTexel
      ) {
        const shComponentCountPerChannel =
          shTextureDesc.componentCountPerChannel || 0;
        for (let t = 0; t < 3 && t < shTextureDesc.textures.length; t++) {
          const paddedSHArray = shTextureDesc.data[t];
          for (let c = fromSplat; c <= toSplat; c++) {
            const srcBase = shComponentCount * c;
            const destBase = paddedSHComponentCount * c;
            if (shComponentCountPerChannel >= 3) {
              for (let i = 0; i < 3; i++)
                paddedSHArray[destBase + i] = shData[srcBase + t * 3 + i];
              if (shComponentCountPerChannel >= 8) {
                for (let i = 0; i < 5; i++)
                  paddedSHArray[destBase + 3 + i] =
                    shData[srcBase + 9 + t * 5 + i];
              }
            }
          }
          updateTexture(
            shTextureDesc.textures[t],
            shTextureDesc.size,
            shTextureDesc.elementsPerTexel,
            paddedSHArray,
            paddedSHComponentCount
          );
        }
      }
    }

    // Update scene index & transform data
    const sceneIndexesTexDesc = this.splatDataTextures["sceneIndexes"];
    if (
      sceneIndexesTexDesc?.data &&
      sceneIndexesTexDesc?.texture &&
      sceneIndexesTexDesc?.size
    ) {
      const paddedSceneIndexes = sceneIndexesTexDesc.data;
      for (let c = this.lastBuildSplatCount; c <= toSplat; c++) {
        paddedSceneIndexes[c] = this.globalSplatIndexToSceneIndexMap[c];
      }
      const sceneIndexesTexture = sceneIndexesTexDesc.texture;
      const sceneIndexesTextureProps = this.renderer
        ? this.renderer.properties.get(sceneIndexesTexture)
        : null;
      if (!isWebGLTextureReady(sceneIndexesTextureProps)) {
        sceneIndexesTexture.needsUpdate = true;
      } else {
        this.updateDataTexture(
          paddedSceneIndexes,
          sceneIndexesTexture,
          sceneIndexesTexDesc.size,
          sceneIndexesTextureProps,
          1,
          1,
          1,
          this.lastBuildSplatCount,
          toSplat
        );
      }
    }
  }

  /**
   * Get the target covariance compression level based on configuration
   * @returns Compression level (0 or 1)
   */
  getTargetCovarianceCompressionLevel(): number {
    return this.halfPrecisionCovariancesOnGPU ? 1 : 0;
  }

  /**
   * Get the target spherical harmonics compression level
   * @returns Compression level (1 or higher)
   */
  getTargetSphericalHarmonicsCompressionLevel(): number {
    return Math.max(1, this.getMaximumSplatBufferCompressionLevel());
  }

  /**
   * Get the maximum compression level from all splat buffers
   * @returns Maximum compression level
   */
  getMaximumSplatBufferCompressionLevel(): number {
    let maxCompressionLevel = 0;
    for (let i = 0; i < this.scenes.length; i++) {
      const scene = this.getScene(i);
      // Handle case where compressionLevel may not be defined in TypeScript type
      const compressionLevel = (scene.splatBuffer as any).compressionLevel || 0;
      maxCompressionLevel = Math.max(maxCompressionLevel, compressionLevel);
    }
    return maxCompressionLevel;
  }

  /**
   * Get the minimum compression level from all splat buffers
   * @returns Minimum compression level or 0 if no splat buffers exist
   */
  getMinimumSplatBufferCompressionLevel(): number {
    if (this.scenes.length === 0) return 0;

    let minCompressionLevel = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < this.scenes.length; i++) {
      const scene = this.getScene(i);
      // Access compressionLevel safely, default to 0 if undefined
      const compressionLevel = scene.splatBuffer.compressionLevel || 0;
      if (minCompressionLevel > compressionLevel) {
        minCompressionLevel = compressionLevel;
      }
    }

    // If no compression levels were found or all were undefined, return 0
    return minCompressionLevel;
  }

  /**
   * Compute the update region for a texture
   * @param startSplat The starting splat index
   * @param endSplat The ending splat index
   * @param textureWidth The texture width
   * @param elementsPerTexel Elements per texel
   * @param elementsPerSplat Elements per splat
   * @returns The update region information
   */
  static computeTextureUpdateRegion(
    startSplat: number,
    endSplat: number,
    textureWidth: number,
    elementsPerTexel: number,
    elementsPerSplat: number
  ): {
    dataStart: number;
    dataEnd: number;
    startRow: number;
    endRow: number;
  } {
    const texelsPerSplat = elementsPerSplat / elementsPerTexel;

    const startSplatTexels = startSplat * texelsPerSplat;
    const startRow = Math.floor(startSplatTexels / textureWidth);
    const startRowElement = startRow * textureWidth * elementsPerTexel;

    const endSplatTexels = endSplat * texelsPerSplat;
    const endRow = Math.floor(endSplatTexels / textureWidth);
    const endRowEndElement =
      endRow * textureWidth * elementsPerTexel +
      textureWidth * elementsPerTexel;

    return {
      dataStart: startRowElement,
      dataEnd: endRowEndElement,
      startRow: startRow,
      endRow: endRow,
    };
  }

  /**
   * Update a data texture with new data
   * @param paddedData The padded data array
   * @param texture The texture to update
   * @param textureSize The size of the texture
   * @param textureProps The texture properties
   * @param elementsPerTexel Elements per texel
   * @param elementsPerSplat Elements per splat
   * @param bytesPerElement Bytes per element
   * @param from The splat index to start from
   * @param to The splat index to end at
   */
  updateDataTexture(
    paddedData: any,
    texture: THREE.DataTexture,
    textureSize: THREE.Vector2,
    textureProps: any,
    elementsPerTexel: number,
    elementsPerSplat: number,
    bytesPerElement: number,
    from: number,
    to: number
  ): void {
    if (!this.renderer || !this.webGLUtils) return;

    // Check if textureProps has the __webglTexture property safely
    // First ensure textureProps is an object and not null/undefined
    if (!textureProps || typeof textureProps !== "object") return;

    // Then check if it has the __webglTexture property
    const webglTexture = (textureProps as any).__webglTexture;
    if (!webglTexture) return;

    const gl = this.renderer.getContext();
    const updateRegion = SplatMesh.computeTextureUpdateRegion(
      from,
      to,
      textureSize.x,
      elementsPerTexel,
      elementsPerSplat
    );
    const updateElementCount = updateRegion.dataEnd - updateRegion.dataStart;
    const updateDataView = new paddedData.constructor(
      paddedData.buffer,
      updateRegion.dataStart * bytesPerElement,
      updateElementCount
    );
    const updateHeight = updateRegion.endRow - updateRegion.startRow + 1;
    const glType = this.webGLUtils.convert(texture.type);
    const glFormat = this.webGLUtils.convert(
      texture.format,
      texture.colorSpace
    );
    const currentTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, webglTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      updateRegion.startRow,
      textureSize.x,
      updateHeight,
      glFormat,
      glType,
      updateDataView
    );
    gl.bindTexture(gl.TEXTURE_2D, currentTexture);
  }

  /**
   * Update padded compressed covariances texture data
   * @param sourceData Source covariance data
   * @param textureData Target texture data
   * @param textureDataStartIndex Starting index in texture data
   * @param fromElement Starting element index
   * @param toElement Ending element index
   */
  static updatePaddedCompressedCovariancesTextureData(
    sourceData: Float32Array,
    textureData: Uint32Array,
    textureDataStartIndex: number,
    fromElement: number,
    toElement: number
  ): void {
    let textureDataView = new DataView(textureData.buffer);
    let textureDataIndex = textureDataStartIndex;
    let sequentialCount = 0;
    for (let i = fromElement; i <= toElement; i += 2) {
      textureDataView.setUint16(textureDataIndex * 2, sourceData[i], true);
      textureDataView.setUint16(
        textureDataIndex * 2 + 2,
        sourceData[i + 1],
        true
      );
      textureDataIndex += 2;
      sequentialCount++;
      if (sequentialCount >= 3) {
        textureDataIndex += 2;
        sequentialCount = 0;
      }
    }
  }

  /**
   * Update the padded center colors data for the texture
   * @param from Starting splat index
   * @param to Ending splat index
   * @param centers Array of center data
   * @param colors Array of color data
   * @param paddedCenterColors Output array for padded data
   */
  static updateCenterColorsPaddedData(
    from: number,
    to: number,
    centers: Float32Array,
    colors: Uint8Array,
    paddedCenterColors: Uint32Array
  ): void {
    for (let c = from; c <= to; c++) {
      const colorsBase = c * 4;
      const centersBase = c * 3;
      const centerColorsBase = c * 4;
      // Convert colors to RGBA integer using bitwise operations
      const r = colors[colorsBase];
      const g = colors[colorsBase + 1];
      const b = colors[colorsBase + 2];
      const a = colors[colorsBase + 3];
      paddedCenterColors[centerColorsBase] =
        ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

      paddedCenterColors[centerColorsBase + 1] = SplatMesh.uintEncodedFloat(
        centers[centersBase]
      );
      paddedCenterColors[centerColorsBase + 2] = SplatMesh.uintEncodedFloat(
        centers[centersBase + 1]
      );
      paddedCenterColors[centerColorsBase + 3] = SplatMesh.uintEncodedFloat(
        centers[centersBase + 2]
      );
    }
  }

  /**
   * Update scale rotations padded data
   * @param from Starting splat index
   * @param to Ending splat index
   * @param scales Scales array
   * @param rotations Rotations array
   * @param paddedScaleRotations Output for padded data
   */
  static updateScaleRotationsPaddedData(
    from: number,
    to: number,
    scales: Float32Array,
    rotations: Float32Array,
    paddedScaleRotations: Float32Array | Uint16Array
  ): void {
    const combinedSize = 6;
    for (let c = from; c <= to; c++) {
      const scaleBase = c * 3;
      const rotationBase = c * 4;
      const scaleRotationsBase = c * combinedSize;

      paddedScaleRotations[scaleRotationsBase] = scales[scaleBase];
      paddedScaleRotations[scaleRotationsBase + 1] = scales[scaleBase + 1];
      paddedScaleRotations[scaleRotationsBase + 2] = scales[scaleBase + 2];

      paddedScaleRotations[scaleRotationsBase + 3] = rotations[rotationBase];
      paddedScaleRotations[scaleRotationsBase + 4] =
        rotations[rotationBase + 1];
      paddedScaleRotations[scaleRotationsBase + 5] =
        rotations[rotationBase + 2];
    }
  }

  updateVisibleRegion(sinceLastBuildOnly: boolean): void {
    const splatCount = this.getSplatCount(true);
    const tempCenter = new THREE.Vector3();
    if (!sinceLastBuildOnly) {
      const avgCenter = new THREE.Vector3();
      this.scenes.forEach((scene) => {
        avgCenter.add(scene.splatBuffer.sceneCenter);
      });
      avgCenter.multiplyScalar(1.0 / this.scenes.length);
      this.calculatedSceneCenter.copy(avgCenter);
      // Cast material to ShaderMaterial for proper type access
      const material = this.material as THREE.ShaderMaterial;
      material.uniforms.sceneCenter.value.copy(this.calculatedSceneCenter);
      material.uniformsNeedUpdate = true;
    }

    const startSplatFormMaxDistanceCalc = sinceLastBuildOnly
      ? this.lastBuildSplatCount
      : 0;
    for (let i = startSplatFormMaxDistanceCalc; i < splatCount; i++) {
      // Use proper transform parameter (undefined instead of null)
      this.getSplatCenter(i, tempCenter, undefined);
      const distFromCSceneCenter = tempCenter
        .sub(this.calculatedSceneCenter)
        .length();
      if (distFromCSceneCenter > this.maxSplatDistanceFromSceneCenter)
        this.maxSplatDistanceFromSceneCenter = distFromCSceneCenter;
    }

    if (
      this.maxSplatDistanceFromSceneCenter - this.visibleRegionBufferRadius >
      VISIBLE_REGION_EXPANSION_DELTA
    ) {
      this.visibleRegionBufferRadius = this.maxSplatDistanceFromSceneCenter;
      this.visibleRegionRadius = Math.max(
        this.visibleRegionBufferRadius - VISIBLE_REGION_EXPANSION_DELTA,
        0.0
      );
    }
    if (this.finalBuild)
      this.visibleRegionRadius = this.visibleRegionBufferRadius =
        this.maxSplatDistanceFromSceneCenter;
    this.updateVisibleRegionFadeDistance();
  }

  /**
   * Update the fade distance for the visible region
   */
  updateVisibleRegionFadeDistance(sceneRevealMode = SceneRevealMode.Default) {
    const fastFadeRate =
      SCENE_FADEIN_RATE_FAST * this.sceneFadeInRateMultiplier;
    const gradualFadeRate =
      SCENE_FADEIN_RATE_GRADUAL * this.sceneFadeInRateMultiplier;
    const defaultFadeInRate = this.finalBuild ? fastFadeRate : gradualFadeRate;
    const fadeInRate =
      sceneRevealMode === SceneRevealMode.Default
        ? defaultFadeInRate
        : gradualFadeRate;
    this.visibleRegionFadeStartRadius =
      (this.visibleRegionRadius - this.visibleRegionFadeStartRadius) *
        fadeInRate +
      this.visibleRegionFadeStartRadius;
    const fadeInPercentage =
      this.visibleRegionBufferRadius > 0
        ? this.visibleRegionFadeStartRadius / this.visibleRegionBufferRadius
        : 0;
    const fadeInComplete = fadeInPercentage > 0.99;
    const shaderFadeInComplete =
      fadeInComplete || sceneRevealMode === SceneRevealMode.Instant ? 1 : 0;

    const material = this.material as THREE.ShaderMaterial;

    material.uniforms.visibleRegionFadeStartRadius.value =
      this.visibleRegionFadeStartRadius;
    material.uniforms.visibleRegionRadius.value = this.visibleRegionRadius;
    material.uniforms.firstRenderTime.value = this.firstRenderTime;
    material.uniforms.currentTime.value = performance.now();
    material.uniforms.fadeInComplete.value = shaderFadeInComplete;
    material.uniformsNeedUpdate = true;
    this.visibleRegionChanging = !fadeInComplete;
  }

  /**
   * Set the indexes of splats that should be rendered; should be sorted in desired render order.
   * @param globalIndexes Sorted index list of splats to be rendered
   * @param renderSplatCount Total number of splats to be rendered. Necessary because we may not want to render
   *                         every splat.
   */
  updateRenderIndexes(
    globalIndexes: Uint32Array,
    renderSplatCount: number
  ): void {
    // Cast to InstancedBufferGeometry which is what SplatGeometry.build returns
    const geometry = this.geometry as THREE.InstancedBufferGeometry;

    // Get the splatIndex attribute and update it
    const splatIndexAttribute = geometry.getAttribute(
      "splatIndex"
    ) as THREE.InstancedBufferAttribute;
    if (
      splatIndexAttribute &&
      splatIndexAttribute.array instanceof Uint32Array
    ) {
      splatIndexAttribute.array.set(globalIndexes);
      splatIndexAttribute.needsUpdate = true;
    }

    if (renderSplatCount > 0 && this.firstRenderTime === -1)
      this.firstRenderTime = performance.now();

    // Set instance count on the instanced buffer geometry
    geometry.instanceCount = renderSplatCount;
    geometry.setDrawRange(0, renderSplatCount);
  }

  /**
   * Update the transforms for each scene in this splat mesh from their individual components (position,
   * quaternion, and scale)
   */
  updateTransforms(): void {
    for (let i = 0; i < this.scenes.length; i++) {
      const scene = this.getScene(i);
      scene.updateTransform(this.dynamicMode);
    }
  }

  /**
   * Update material uniforms with current rendering parameters
   */
  updateUniforms = (() => {
    const viewport = new THREE.Vector2();

    return (
      renderDimensions: THREE.Vector2,
      cameraFocalLengthX: number,
      cameraFocalLengthY: number,
      orthographicMode: boolean,
      orthographicZoom: number,
      inverseFocalAdjustment: number
    ): void => {
      const splatCount = this.getSplatCount();
      if (splatCount > 0) {
        viewport.set(
          renderDimensions.x * this.devicePixelRatio,
          renderDimensions.y * this.devicePixelRatio
        );

        // Cast material to ShaderMaterial to access uniforms
        const material = this.material as THREE.ShaderMaterial;

        material.uniforms.viewport.value.copy(viewport);
        material.uniforms.basisViewport.value.set(
          1.0 / viewport.x,
          1.0 / viewport.y
        );
        material.uniforms.focal.value.set(
          cameraFocalLengthX,
          cameraFocalLengthY
        );
        material.uniforms.orthographicMode.value = orthographicMode ? 1 : 0;
        material.uniforms.orthoZoom.value = orthographicZoom;
        material.uniforms.inverseFocalAdjustment.value = inverseFocalAdjustment;
        if (this.dynamicMode) {
          for (let i = 0; i < this.scenes.length; i++) {
            material.uniforms.transforms.value[i].copy(
              this.getScene(i).transform
            );
          }
        }
        if (this.enableOptionalEffects) {
          for (let i = 0; i < this.scenes.length; i++) {
            material.uniforms.sceneOpacity.value[i] = clamp(
              this.getScene(i).opacity,
              0.0,
              1.0
            );
            material.uniforms.sceneVisibility.value[i] = this.getScene(i)
              .visible
              ? 1
              : 0;
            material.uniformsNeedUpdate = true;
          }
        }
        material.uniformsNeedUpdate = true;
      }
    };
  })();

  /**
   * Set the scale factor for splats
   * @param splatScale Scale factor to apply to splats (default: 1)
   */
  setSplatScale(splatScale: number = 1): void {
    this.splatScale = splatScale;
    // Cast material to ShaderMaterial to access uniforms
    const material = this.material as THREE.ShaderMaterial;
    material.uniforms.splatScale.value = splatScale;
    material.uniformsNeedUpdate = true;
  }

  getSplatScale(): number {
    return this.splatScale;
  }

  /**
   * Enable or disable point cloud rendering mode
   * @param enabled Whether to enable point cloud mode
   */
  setPointCloudModeEnabled(enabled: boolean): void {
    this.pointCloudModeEnabled = enabled;
    // Cast material to ShaderMaterial to access uniforms
    const material = this.material as THREE.ShaderMaterial;
    material.uniforms.pointCloudModeEnabled.value = enabled ? 1 : 0;
    material.uniformsNeedUpdate = true;
  }

  /**
   * Get the current state of point cloud mode
   * @returns Whether point cloud mode is enabled
   */
  getPointCloudModeEnabled(): boolean {
    return this.pointCloudModeEnabled;
  }

  /**
   * Get the splat data textures used for rendering
   * @returns The currently used splat data textures
   */
  getSplatDataTextures(): SplatDataTextures | null {
    return this.splatDataTextures;
  }

  /**
   * Get the total number of splats
   * @param includeSinceLastBuild Whether to include splats added since the last build
   * @returns The total number of splats
   */
  getSplatCount(includeSinceLastBuild: boolean = false): number {
    if (!includeSinceLastBuild) return this.lastBuildSplatCount;
    else return SplatMesh.getTotalSplatCountForScenes(this.scenes);
  }

  /**
   * Calculate the total number of splats across all provided scenes
   * @param scenes Array of SplatScene objects
   * @returns Total number of splats across all scenes
   */
  static getTotalSplatCountForScenes(scenes: SplatScene[]): number {
    let totalSplatCount = 0;
    for (let scene of scenes) {
      if (scene && scene.splatBuffer)
        totalSplatCount += scene.splatBuffer.getSplatCount();
    }
    return totalSplatCount;
  }

  /**
   * Calculate the total number of splats across all provided splat buffers
   * @param splatBuffers Array of SplatBuffer objects
   * @returns Total number of splats across all buffers
   */
  static getTotalSplatCountForSplatBuffers(
    splatBuffers: SplatBuffer[]
  ): number {
    let totalSplatCount = 0;
    for (let splatBuffer of splatBuffers)
      totalSplatCount += splatBuffer.getSplatCount();
    return totalSplatCount;
  }

  getMaxSplatCount() {
    return SplatMesh.getTotalMaxSplatCountForScenes(this.scenes);
  }

  /**
   * Calculate the total maximum number of splats across all provided scenes
   * @param scenes Array of SplatScene objects
   * @returns Total maximum number of splats across all scenes
   */
  static getTotalMaxSplatCountForScenes(scenes: SplatScene[]): number {
    let totalSplatCount = 0;
    for (let scene of scenes) {
      if (scene && scene.splatBuffer)
        totalSplatCount += scene.splatBuffer.getMaxSplatCount();
    }
    return totalSplatCount;
  }

  /**
   * Get total maximum splat count for splat buffers
   * @param splatBuffers Array of splat buffers
   * @returns Total maximum splat count
   */
  static getTotalMaxSplatCountForSplatBuffers(
    splatBuffers: SplatBuffer[]
  ): number {
    let totalSplatCount = 0;
    for (let splatBuffer of splatBuffers) {
      totalSplatCount += splatBuffer.getMaxSplatCount();
    }
    return totalSplatCount;
  }

  /**
   * Dispose of GPU resources used for distances computation
   */
  disposeDistancesComputationGPUResources(): void {
    if (!this.renderer) return;

    const gl = this.renderer.getContext();
    // Cast to WebGL2RenderingContext to access WebGL2 specific methods
    const gl2 = gl as WebGL2RenderingContext;

    if ((this.distancesTransformFeedback as any).vao) {
      gl2.deleteVertexArray((this.distancesTransformFeedback as any).vao);
      (this.distancesTransformFeedback as any).vao = null;
    }

    if (this.distancesTransformFeedback.program) {
      gl.deleteProgram(this.distancesTransformFeedback.program);
      gl.deleteShader(this.distancesTransformFeedback.vertexShader);
      gl.deleteShader(this.distancesTransformFeedback.fragmentShader);
      this.distancesTransformFeedback.program = null;
      this.distancesTransformFeedback.vertexShader = null;
      this.distancesTransformFeedback.fragmentShader = null;
    }

    this.disposeDistancesComputationGPUBufferResources();

    if (this.distancesTransformFeedback.id) {
      gl2.deleteTransformFeedback(this.distancesTransformFeedback.id);
      this.distancesTransformFeedback.id = null;
    }
  }

  /**
   * Dispose of GPU buffer resources used for distances computation
   */
  disposeDistancesComputationGPUBufferResources(): void {
    if (!this.renderer) return;

    const gl = this.renderer.getContext();

    if (this.distancesTransformFeedback.centersBuffer) {
      gl.deleteBuffer(this.distancesTransformFeedback.centersBuffer);
      this.distancesTransformFeedback.centersBuffer = null;
    }

    if (this.distancesTransformFeedback.outDistancesBuffer) {
      gl.deleteBuffer(this.distancesTransformFeedback.outDistancesBuffer);
      this.distancesTransformFeedback.outDistancesBuffer = null;
    }
  }

  /**
   * Set the Three.js renderer used by this splat mesh
   * @param renderer Instance of THREE.WebGLRenderer
   */
  setRenderer(renderer: THREE.WebGLRenderer): void {
    if (renderer !== this.renderer) {
      this.renderer = renderer;
      if (this.renderer) {
        const gl = this.renderer.getContext();

        // Use type assertions to help TypeScript understand the types
        const extensions: any = WebGLExtensions(gl);
        const capabilities: any = WebGLCapabilities(gl, extensions, {});
        extensions.init(capabilities);

        // Type assertion for WebGLUtils
        this.webGLUtils = new (THREE as any).WebGLUtils(gl, extensions);

        if (this.enableDistancesComputationOnGPU && this.getSplatCount() > 0) {
          this.setupDistancesComputationTransformFeedback();
          const { centers, sceneIndexes } = this.getDataForDistancesComputation(
            0,
            this.getSplatCount() - 1
          );
          this.refreshGPUBuffersForDistancesComputation(centers, sceneIndexes);
        }
      }
    }
  }

  /**
   * Set up transform feedback for computing distances on GPU
   */
  setupDistancesComputationTransformFeedback = (() => {
    let currentMaxSplatCount: number | undefined;

    return (): void => {
      const maxSplatCount = this.getMaxSplatCount();

      if (!this.renderer) return;

      const rebuildGPUObjects = this.lastRenderer !== this.renderer;
      const rebuildBuffers = currentMaxSplatCount !== maxSplatCount;

      if (!rebuildGPUObjects && !rebuildBuffers) return;

      if (rebuildGPUObjects) {
        this.disposeDistancesComputationGPUResources();
      } else if (rebuildBuffers) {
        this.disposeDistancesComputationGPUBufferResources();
      }

      const gl = this.renderer.getContext();

      const createShader = (
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        type: number,
        source: string
      ): WebGLShader | null => {
        const shader = gl.createShader(type);
        if (!shader) {
          console.error("Fatal error: gl could not create a shader object.");
          return null;
        }

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (!compiled) {
          let typeName = "unknown";
          if (type === gl.VERTEX_SHADER) typeName = "vertex shader";
          else if (type === gl.FRAGMENT_SHADER) typeName = "fragement shader";
          const errors = gl.getShaderInfoLog(shader);
          console.error(
            "Failed to compile " + typeName + " with these errors:" + errors
          );
          gl.deleteShader(shader);
          return null;
        }

        return shader;
      };

      let vsSource: string;
      if (this.integerBasedDistancesComputation) {
        vsSource = `#version 300 es
                in ivec4 center;
                flat out int distance;`;
        if (this.dynamicMode) {
          vsSource += `
                        in uint sceneIndex;
                        uniform ivec4 transforms[${Constants.MaxScenes}];
                        void main(void) {
                            ivec4 transform = transforms[sceneIndex];
                            distance = center.x * transform.x + center.y * transform.y + center.z * transform.z + transform.w * center.w;
                        }
                    `;
        } else {
          vsSource += `
                        uniform ivec3 modelViewProj;
                        void main(void) {
                            distance = center.x * modelViewProj.x + center.y * modelViewProj.y + center.z * modelViewProj.z;
                        }
                    `;
        }
      } else {
        vsSource = `#version 300 es
                in vec4 center;
                flat out float distance;`;
        if (this.dynamicMode) {
          vsSource += `
                        in uint sceneIndex;
                        uniform mat4 transforms[${Constants.MaxScenes}];
                        void main(void) {
                            vec4 transformedCenter = transforms[sceneIndex] * vec4(center.xyz, 1.0);
                            distance = transformedCenter.z;
                        }
                    `;
        } else {
          vsSource += `
                        uniform vec3 modelViewProj;
                        void main(void) {
                            distance = center.x * modelViewProj.x + center.y * modelViewProj.y + center.z * modelViewProj.z;
                        }
                    `;
        }
      }

      const fsSource = `#version 300 es
                precision lowp float;
                out vec4 fragColor;
                void main(){}
            `;

      // Cast gl to WebGL2RenderingContext for access to specific methods
      const gl2 = gl as WebGL2RenderingContext;

      const currentVao = gl2.getParameter(gl2.VERTEX_ARRAY_BINDING);
      const currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const currentProgramDeleted = currentProgram
        ? gl.getProgramParameter(currentProgram, gl.DELETE_STATUS)
        : false;

      if (rebuildGPUObjects) {
        (this.distancesTransformFeedback as any).vao = gl2.createVertexArray();
      }

      gl2.bindVertexArray((this.distancesTransformFeedback as any).vao);

      if (rebuildGPUObjects) {
        const program = gl.createProgram();
        if (!program) {
          throw new Error(
            "Could not create GL program for distances computation."
          );
        }

        const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vertexShader || !fragmentShader) {
          throw new Error(
            "Could not compile shaders for distances computation on GPU."
          );
        }
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl2.transformFeedbackVaryings(
          program,
          ["distance"],
          gl2.SEPARATE_ATTRIBS
        );
        gl.linkProgram(program);

        const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (!linked) {
          const error = gl.getProgramInfoLog(program);
          console.error("Fatal error: Failed to link program: " + error);
          gl.deleteProgram(program);
          gl.deleteShader(fragmentShader);
          gl.deleteShader(vertexShader);
          throw new Error(
            "Could not link shaders for distances computation on GPU."
          );
        }

        this.distancesTransformFeedback.program = program;
        this.distancesTransformFeedback.vertexShader = vertexShader;
        this.distancesTransformFeedback.fragmentShader = fragmentShader;
      }

      if (!this.distancesTransformFeedback.program) {
        throw new Error("Program not initialized for distances computation");
      }

      gl.useProgram(this.distancesTransformFeedback.program);

      // Get attribute and uniform locations
      this.distancesTransformFeedback.centersLoc = gl.getAttribLocation(
        this.distancesTransformFeedback.program,
        "center"
      );

      if (this.dynamicMode) {
        this.distancesTransformFeedback.sceneIndexesLoc = gl.getAttribLocation(
          this.distancesTransformFeedback.program,
          "sceneIndex"
        );

        // Initialize the transforms locations array
        this.distancesTransformFeedback.transformsLocs = [];

        // Fill the array with uniform locations
        for (let i = 0; i < this.scenes.length; i++) {
          const location = gl.getUniformLocation(
            this.distancesTransformFeedback.program,
            `transforms[${i}]`
          );
          this.distancesTransformFeedback.transformsLocs[i] = location;
        }
      } else {
        // Get the model view projection location
        this.distancesTransformFeedback.modelViewProjLoc =
          gl.getUniformLocation(
            this.distancesTransformFeedback.program,
            "modelViewProj"
          );
      }

      if (rebuildGPUObjects || rebuildBuffers) {
        this.distancesTransformFeedback.centersBuffer = gl.createBuffer();
        gl.bindBuffer(
          gl.ARRAY_BUFFER,
          this.distancesTransformFeedback.centersBuffer
        );
        gl.enableVertexAttribArray(this.distancesTransformFeedback.centersLoc);
        if (this.integerBasedDistancesComputation) {
          gl2.vertexAttribIPointer(
            this.distancesTransformFeedback.centersLoc,
            4,
            gl.INT,
            0,
            0
          );
        } else {
          gl.vertexAttribPointer(
            this.distancesTransformFeedback.centersLoc,
            4,
            gl.FLOAT,
            false,
            0,
            0
          );
        }

        if (this.dynamicMode) {
          this.distancesTransformFeedback.sceneIndexesBuffer =
            gl.createBuffer();
          gl.bindBuffer(
            gl.ARRAY_BUFFER,
            this.distancesTransformFeedback.sceneIndexesBuffer
          );
          gl.enableVertexAttribArray(
            this.distancesTransformFeedback.sceneIndexesLoc
          );
          gl2.vertexAttribIPointer(
            this.distancesTransformFeedback.sceneIndexesLoc,
            1,
            gl.UNSIGNED_INT,
            0,
            0
          );
        }
      }

      if (rebuildGPUObjects || rebuildBuffers) {
        this.distancesTransformFeedback.outDistancesBuffer = gl.createBuffer();
      }
      gl.bindBuffer(
        gl.ARRAY_BUFFER,
        this.distancesTransformFeedback.outDistancesBuffer
      );
      // Use STATIC_DRAW as STATIC_READ doesn't exist in WebGL
      gl.bufferData(gl.ARRAY_BUFFER, maxSplatCount * 4, gl.STATIC_DRAW);

      if (rebuildGPUObjects) {
        this.distancesTransformFeedback.id = gl2.createTransformFeedback();
      }
      gl2.bindTransformFeedback(
        gl2.TRANSFORM_FEEDBACK,
        this.distancesTransformFeedback.id
      );
      gl2.bindBufferBase(
        gl2.TRANSFORM_FEEDBACK_BUFFER,
        0,
        this.distancesTransformFeedback.outDistancesBuffer
      );

      if (currentProgram && currentProgramDeleted !== true)
        gl.useProgram(currentProgram);
      if (currentVao) gl2.bindVertexArray(currentVao);

      this.lastRenderer = this.renderer;
      currentMaxSplatCount = maxSplatCount;
    };
  })();

  /**
   * Refresh GPU buffers used for computing splat distances with centers data from the scenes for this mesh.
   * @param isUpdate Specify whether or not to update the GPU buffer or to initialize & fill
   * @param centers The splat centers data
   * @param offsetSplats Offset in the GPU buffer at which to start updating data, specified in splats
   */
  updateGPUCentersBufferForDistancesComputation(
    isUpdate: boolean,
    centers: Int32Array | Float32Array,
    offsetSplats: number
  ): void {
    if (!this.renderer) return;

    // Cast to WebGL2RenderingContext to access WebGL2 specific methods
    const gl = this.renderer.getContext() as WebGL2RenderingContext;

    const currentVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.bindVertexArray((this.distancesTransformFeedback as any).vao);

    const ArrayType = this.integerBasedDistancesComputation
      ? Uint32Array
      : Float32Array;
    const attributeBytesPerCenter = 16;
    const subBufferOffset = offsetSplats * attributeBytesPerCenter;

    gl.bindBuffer(
      gl.ARRAY_BUFFER,
      this.distancesTransformFeedback.centersBuffer
    );

    if (isUpdate) {
      gl.bufferSubData(gl.ARRAY_BUFFER, subBufferOffset, centers);
    } else {
      const maxArray = new ArrayType(
        this.getMaxSplatCount() * attributeBytesPerCenter
      );
      maxArray.set(centers);
      gl.bufferData(gl.ARRAY_BUFFER, maxArray, gl.STATIC_DRAW);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    if (currentVao) gl.bindVertexArray(currentVao);
  }

  /**
   * Refresh GPU buffers used for pre-computing splat distances with centers data from the scenes for this mesh.
   * @param isUpdate Specify whether or not to update the GPU buffer or to initialize & fill
   * @param sceneIndexes The splat scene indexes
   * @param offsetSplats Offset in the GPU buffer at which to start updating data, specified in splats
   */
  updateGPUTransformIndexesBufferForDistancesComputation(
    isUpdate: boolean,
    sceneIndexes: Uint32Array,
    offsetSplats: number
  ): void {
    if (!this.renderer || !this.dynamicMode) return;

    // Cast to WebGL2RenderingContext to access WebGL2 specific methods
    const gl = this.renderer.getContext() as WebGL2RenderingContext;

    const currentVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.bindVertexArray((this.distancesTransformFeedback as any).vao);

    const subBufferOffset = offsetSplats * 4;

    gl.bindBuffer(
      gl.ARRAY_BUFFER,
      this.distancesTransformFeedback.sceneIndexesBuffer
    );

    if (isUpdate) {
      gl.bufferSubData(gl.ARRAY_BUFFER, subBufferOffset, sceneIndexes);
    } else {
      const maxArray = new Uint32Array(this.getMaxSplatCount() * 4);
      maxArray.set(sceneIndexes);
      gl.bufferData(gl.ARRAY_BUFFER, maxArray, gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    if (currentVao) gl.bindVertexArray(currentVao);
  }

  /**
   * Helper function to encode a float as a uint32
   * @param val Float value to encode
   * @returns Encoded uint32 value
   */
  static uintEncodedFloat(val: number): number {
    const floatView = new Float32Array(1);
    const uintView = new Uint32Array(floatView.buffer);
    floatView[0] = val;
    return uintView[0];
  }

  /**
   * Get a typed array containing a mapping from global splat indexes to their scene index.
   * @param start Starting splat index to store
   * @param end Ending splat index to store
   * @return Array of scene indexes
   */
  getSceneIndexes(start: number, end: number): Uint32Array {
    const fillCount = end - start + 1;
    const sceneIndexes = new Uint32Array(fillCount);
    for (let i = start; i <= end; i++) {
      sceneIndexes[i - start] = this.globalSplatIndexToSceneIndexMap[i];
    }
    return sceneIndexes;
  }

  /**
   * Fill an array with the transforms for each scene in this splat mesh.
   * @param array Float32Array to be filled with scene transforms. If not enough space, contents may be truncated.
   */
  fillTransformsArray = (() => {
    // Array to temporarily store transform values
    const tempArray: number[] = [];

    return (array: Float32Array): void => {
      if (tempArray.length !== array.length) tempArray.length = array.length;
      for (let i = 0; i < this.scenes.length; i++) {
        const sceneTransform = this.getScene(i).transform;
        const sceneTransformElements = sceneTransform.elements;
        for (let j = 0; j < 16; j++) {
          tempArray[i * 16 + j] = sceneTransformElements[j];
        }
      }
      array.set(tempArray);
    };
  })();

  /**
   * Computes distances on the GPU using transform feedback
   * @param modelViewProjMatrix - The model view projection matrix
   * @param outComputedDistances - Float32Array to store the computed distances
   * @returns A promise that resolves when the computation is complete
   */
  computeDistancesOnGPU = (() => {
    const tempMatrix = new THREE.Matrix4();

    return (
      modelViewProjMatrix: THREE.Matrix4,
      outComputedDistances: Float32Array
    ): Promise<void> | undefined => {
      if (!this.renderer) return;

      // Get WebGL2 context
      const gl = this.renderer.getContext() as WebGL2RenderingContext;

      const currentVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      const currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const currentProgramDeleted = currentProgram
        ? gl.getProgramParameter(currentProgram, gl.DELETE_STATUS)
        : false;

      if (this.distancesTransformFeedback.vao) {
        gl.bindVertexArray(this.distancesTransformFeedback.vao);
      }
      gl.useProgram(this.distancesTransformFeedback.program);

      gl.enable(gl.RASTERIZER_DISCARD);

      if (this.dynamicMode) {
        for (let i = 0; i < this.scenes.length; i++) {
          tempMatrix.copy(this.getScene(i).transform);
          tempMatrix.premultiply(modelViewProjMatrix);

          if (this.integerBasedDistancesComputation) {
            const iTempMatrix = SplatMesh.getIntegerMatrixArray(tempMatrix);
            const iTransform = [
              iTempMatrix[2],
              iTempMatrix[6],
              iTempMatrix[10],
              iTempMatrix[14],
            ];
            gl.uniform4i(
              this.distancesTransformFeedback.transformsLocs[
                i
              ] as WebGLUniformLocation,
              iTransform[0],
              iTransform[1],
              iTransform[2],
              iTransform[3]
            );
          } else {
            gl.uniformMatrix4fv(
              this.distancesTransformFeedback.transformsLocs[
                i
              ] as WebGLUniformLocation,
              false,
              tempMatrix.elements
            );
          }
        }
      } else {
        if (this.integerBasedDistancesComputation) {
          const iViewProjMatrix =
            SplatMesh.getIntegerMatrixArray(modelViewProjMatrix);
          const iViewProj = [
            iViewProjMatrix[2],
            iViewProjMatrix[6],
            iViewProjMatrix[10],
          ];
          gl.uniform3i(
            this.distancesTransformFeedback
              .modelViewProjLoc as WebGLUniformLocation,
            iViewProj[0],
            iViewProj[1],
            iViewProj[2]
          );
        } else {
          const viewProj = [
            modelViewProjMatrix.elements[2],
            modelViewProjMatrix.elements[6],
            modelViewProjMatrix.elements[10],
          ];
          gl.uniform3f(
            this.distancesTransformFeedback
              .modelViewProjLoc as WebGLUniformLocation,
            viewProj[0],
            viewProj[1],
            viewProj[2]
          );
        }
      }

      gl.bindBuffer(
        gl.ARRAY_BUFFER,
        this.distancesTransformFeedback.centersBuffer
      );
      gl.enableVertexAttribArray(this.distancesTransformFeedback.centersLoc);
      if (this.integerBasedDistancesComputation) {
        gl.vertexAttribIPointer(
          this.distancesTransformFeedback.centersLoc,
          4,
          gl.INT,
          0,
          0
        );
      } else {
        gl.vertexAttribPointer(
          this.distancesTransformFeedback.centersLoc,
          4,
          gl.FLOAT,
          false,
          0,
          0
        );
      }

      if (this.dynamicMode) {
        gl.bindBuffer(
          gl.ARRAY_BUFFER,
          this.distancesTransformFeedback.sceneIndexesBuffer
        );
        gl.enableVertexAttribArray(
          this.distancesTransformFeedback.sceneIndexesLoc
        );
        gl.vertexAttribIPointer(
          this.distancesTransformFeedback.sceneIndexesLoc,
          1,
          gl.UNSIGNED_INT,
          0,
          0
        );
      }

      gl.bindTransformFeedback(
        gl.TRANSFORM_FEEDBACK,
        this.distancesTransformFeedback.id
      );
      gl.bindBufferBase(
        gl.TRANSFORM_FEEDBACK_BUFFER,
        0,
        this.distancesTransformFeedback.outDistancesBuffer
      );

      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, this.getSplatCount());
      gl.endTransformFeedback();

      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

      gl.disable(gl.RASTERIZER_DISCARD);

      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();

      const promise = new Promise<void>((resolve) => {
        const checkSync = (): number | void => {
          if (this.disposed) {
            resolve();
          } else {
            const timeout = 0;
            const bitflags = 0;
            const status = gl.clientWaitSync(
              sync as WebGLSync,
              bitflags,
              timeout
            );
            switch (status) {
              case gl.TIMEOUT_EXPIRED:
                this.computeDistancesOnGPUSyncTimeout = setTimeout(checkSync);
                return this.computeDistancesOnGPUSyncTimeout;
              case gl.WAIT_FAILED:
                throw new Error(
                  "WebGL wait failed during GPU distance computation"
                );
              default:
                this.computeDistancesOnGPUSyncTimeout = null;
                gl.deleteSync(sync as WebGLSync);
                const currentVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
                if (this.distancesTransformFeedback.vao) {
                  gl.bindVertexArray(this.distancesTransformFeedback.vao);
                }
                gl.bindBuffer(
                  gl.ARRAY_BUFFER,
                  this.distancesTransformFeedback.outDistancesBuffer
                );
                gl.getBufferSubData(gl.ARRAY_BUFFER, 0, outComputedDistances);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);

                if (currentVao) gl.bindVertexArray(currentVao);

                resolve();
            }
          }
        };
        this.computeDistancesOnGPUSyncTimeout = setTimeout(checkSync);
      });

      if (currentProgram && currentProgramDeleted !== true)
        gl.useProgram(currentProgram);
      if (currentVao) gl.bindVertexArray(currentVao);

      return promise;
    };
  })();

  /**
   * Given a global splat index, return corresponding local data (splat buffer, index of splat in that splat
   * buffer, and the corresponding transform)
   * @param globalIndex Global splat index
   * @param paramsObj Object in which to store local data
   * @param returnSceneTransform By default, the transform of the scene to which the splat at 'globalIndex' belongs will be
   *                             returned via the 'sceneTransform' property of 'paramsObj' only if the splat mesh is static.
   *                             If 'returnSceneTransform' is true, the 'sceneTransform' property will always contain the scene
   *                             transform, and if 'returnSceneTransform' is false, the 'sceneTransform' property will always
   *                             be null.
   */
  getLocalSplatParameters(
    globalIndex: number,
    paramsObj: {
      splatBuffer?: SplatBuffer;
      localIndex?: number;
      sceneTransform?: THREE.Matrix4 | null;
    },
    returnSceneTransform?: boolean
  ): void {
    if (returnSceneTransform === undefined || returnSceneTransform === null) {
      returnSceneTransform = this.dynamicMode ? false : true;
    }
    paramsObj.splatBuffer = this.getSplatBufferForSplat(globalIndex);
    paramsObj.localIndex = this.getSplatLocalIndex(globalIndex);
    paramsObj.sceneTransform = returnSceneTransform
      ? this.getSceneTransformForSplat(globalIndex)
      : null;
  }

  /**
   * Fill arrays with splat data and apply transforms if appropriate. Each array is optional.
   * @param covariances Target storage for splat covariances
   * @param scales Target storage for splat scales
   * @param rotations Target storage for splat rotations
   * @param centers Target storage for splat centers
   * @param colors Target storage for splat colors
   * @param sphericalHarmonics Target storage for spherical harmonics
   * @param applySceneTransform By default, scene transforms are applied to relevant splat data only if the splat mesh is
   *                          static. If 'applySceneTransform' is true, scene transforms will always be applied and if
   *                          it is false, they will never be applied. If undefined, the default behavior will apply.
   * @param covarianceCompressionLevel The compression level for covariances in the destination array
   * @param scaleRotationCompressionLevel The compression level for scale and rotation in the destination array
   * @param sphericalHarmonicsCompressionLevel The compression level for spherical harmonics in the destination array
   * @param srcStart The start location from which to pull source data
   * @param srcEnd The end location from which to pull source data
   * @param destStart The start location from which to write data
   * @param sceneIndex Optional scene index to restrict data filling to a specific scene
   */
  fillSplatDataArrays(
    covariances: Float32Array | null,
    scales: Float32Array | null,
    rotations: Float32Array | null,
    centers: Float32Array | null,
    colors: Uint8Array | null,
    sphericalHarmonics: Float32Array | null,
    applySceneTransform?: boolean,
    covarianceCompressionLevel: number = 0,
    scaleRotationCompressionLevel: number = 0,
    sphericalHarmonicsCompressionLevel: number = 1,
    srcStart?: number,
    srcEnd?: number,
    destStart: number = 0,
    sceneIndex?: number
  ): void {
    // Create a scale override with optional components
    // Using 'any' type to allow undefined values that will be handled by SplatBuffer
    const scaleOverride = new THREE.Vector3(1, 1, 1) as any;
    // Set x and y to undefined to use original values
    scaleOverride.x = undefined;
    scaleOverride.y = undefined;
    // For 2D mode, force z scale to 1, otherwise use original value
    if (this.splatRenderMode !== SplatRenderMode.ThreeD) {
      scaleOverride.z = 1;
    } else {
      scaleOverride.z = undefined;
    }
    const tempTransform = new THREE.Matrix4();

    let startSceneIndex = 0;
    let endSceneIndex = this.scenes.length - 1;
    if (
      sceneIndex !== undefined &&
      sceneIndex !== null &&
      sceneIndex >= 0 &&
      sceneIndex <= this.scenes.length
    ) {
      startSceneIndex = sceneIndex;
      endSceneIndex = sceneIndex;
    }
    for (let i = startSceneIndex; i <= endSceneIndex; i++) {
      if (applySceneTransform === undefined || applySceneTransform === null) {
        applySceneTransform = !this.dynamicMode;
      }

      const scene = this.getScene(i);
      const splatBuffer = scene.splatBuffer;
      let sceneTransform;
      if (applySceneTransform) {
        this.getSceneTransform(i, tempTransform);
        sceneTransform = tempTransform;
      }
      if (covariances) {
        splatBuffer.fillSplatCovarianceArray(
          covariances,
          sceneTransform,
          srcStart,
          srcEnd,
          destStart,
          covarianceCompressionLevel
        );
      }
      if (scales || rotations) {
        if (!scales || !rotations) {
          throw new Error(
            'SplatMesh::fillSplatDataArrays() -> "scales" and "rotations" must both be valid.'
          );
        }
        splatBuffer.fillSplatScaleRotationArray(
          scales,
          rotations,
          sceneTransform,
          srcStart,
          srcEnd,
          destStart,
          scaleRotationCompressionLevel,
          scaleOverride
        );
      }
      if (centers)
        splatBuffer.fillSplatCenterArray(
          centers,
          sceneTransform,
          srcStart,
          srcEnd,
          destStart
        );
      if (colors)
        splatBuffer.fillSplatColorArray(
          colors,
          scene.minimumAlpha,
          srcStart,
          srcEnd,
          destStart
        );
      if (sphericalHarmonics) {
        splatBuffer.fillSphericalHarmonicsArray(
          sphericalHarmonics,
          this.minSphericalHarmonicsDegree,
          sceneTransform,
          srcStart,
          srcEnd,
          destStart,
          sphericalHarmonicsCompressionLevel
        );
      }
      destStart += splatBuffer.getSplatCount();
    }
  }

  /**
   * Convert splat centers, which are floating point values, to an array of integers and multiply
   * each by 1000. Centers will get transformed as appropriate before conversion to integer.
   * @param start The index at which to start retrieving data
   * @param end The index at which to stop retrieving data
   * @param padFour Enforce alignment of 4 by inserting a 1 after every 3 values
   * @return Array of integer center coordinates
   */
  getIntegerCenters(
    start: number,
    end: number,
    padFour: boolean = false
  ): Int32Array {
    const splatCount = end - start + 1;
    const floatCenters = new Float32Array(splatCount * 3);
    this.fillSplatDataArrays(
      null,
      null,
      null,
      floatCenters,
      null,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      start
    );
    const componentCount = padFour ? 4 : 3;
    const intCenters = new Int32Array(splatCount * componentCount);
    for (let i = 0; i < splatCount; i++) {
      for (let t = 0; t < 3; t++) {
        intCenters[i * componentCount + t] = Math.round(
          floatCenters[i * 3 + t] * 1000.0
        );
      }
      if (padFour) intCenters[i * componentCount + 3] = 1000;
    }
    return intCenters;
  }

  /**
   * Returns an array of splat centers, transformed as appropriate, optionally padded.
   * @param start The index at which to start retrieving data
   * @param end The index at which to stop retrieving data
   * @param padFour Enforce alignment of 4 by inserting a 1 after every 3 values
   * @return Array of float center coordinates
   */
  getFloatCenters(
    start: number,
    end: number,
    padFour: boolean = false
  ): Float32Array {
    const splatCount = end - start + 1;
    const floatCenters = new Float32Array(splatCount * 3);
    this.fillSplatDataArrays(
      null,
      null,
      null,
      floatCenters,
      null,
      null,
      undefined,
      undefined,
      undefined,
      undefined,
      start
    );
    if (!padFour) return floatCenters;
    const paddedFloatCenters = new Float32Array(splatCount * 4);
    for (let i = 0; i < splatCount; i++) {
      for (let t = 0; t < 3; t++) {
        paddedFloatCenters[i * 4 + t] = floatCenters[i * 3 + t];
      }
      paddedFloatCenters[i * 4 + 3] = 1.0;
    }
    return paddedFloatCenters;
  }

  /**
   * Get the center position of a splat
   * @param globalSplatIndex The global index of the splat
   * @param outCenter The vector to store the center in
   * @param transform Optional transform to apply
   */
  getSplatCenter = (() => {
    // Define the paramsObj with proper type
    const paramsObj: {
      splatBuffer?: SplatBuffer;
      localIndex?: number;
      sceneTransform?: THREE.Matrix4 | null;
    } = {};

    return (
      globalSplatIndex: number,
      outCenter: THREE.Vector3,
      transform?: THREE.Matrix4
    ): void => {
      this.getLocalSplatParameters(
        globalSplatIndex,
        paramsObj,
        transform !== undefined
      );

      // Using non-null assertions since we know these will be set by getLocalSplatParameters
      // Use a ternary to ensure paramsObj.sceneTransform is either Matrix4 or undefined, not null
      const sceneTransform = paramsObj.sceneTransform
        ? paramsObj.sceneTransform
        : undefined;
      paramsObj.splatBuffer!.getSplatCenter(
        paramsObj.localIndex!,
        outCenter,
        sceneTransform
      );
    };
  })();

  /**
   * Get the scale and rotation for a splat, transformed as appropriate.
   * @param globalIndex Global index of splat
   * @param outScale THREE.Vector3 instance in which to store splat scale
   * @param outRotation THREE.Quaternion instance in which to store splat rotation
   * @param applySceneTransform By default, if the splat mesh is static, the transform of the scene to which the splat at
   *                            'globalIndex' belongs will be applied to the splat scale and rotation. If
   *                            'applySceneTransform' is true, the scene transform will always be applied and if
   *                            'applySceneTransform' is false, the scene transform will never be applied. If undefined,
   *                            the default behavior will apply.
   */
  getSplatScaleAndRotation = (() => {
    // Define the paramsObj with proper type
    const paramsObj: {
      splatBuffer?: SplatBuffer;
      localIndex?: number;
      sceneTransform?: THREE.Matrix4 | null;
    } = {};
    const scaleOverride = new THREE.Vector3();

    return (
      globalIndex: number,
      outScale: THREE.Vector3,
      outRotation: THREE.Quaternion,
      applySceneTransform?: boolean
    ): void => {
      this.getLocalSplatParameters(globalIndex, paramsObj, applySceneTransform);

      // Reset scale override values
      scaleOverride.x = undefined as unknown as number;
      scaleOverride.y = undefined as unknown as number;
      scaleOverride.z = undefined as unknown as number;

      // For 2D mode, force z scale to 0
      if (this.splatRenderMode === SplatRenderMode.TwoD) scaleOverride.z = 0;

      // Using non-null assertions since we know these will be set by getLocalSplatParameters
      // Use a ternary to ensure paramsObj.sceneTransform is either Matrix4 or undefined, not null
      const sceneTransform = paramsObj.sceneTransform
        ? paramsObj.sceneTransform
        : undefined;
      paramsObj.splatBuffer!.getSplatScaleAndRotation(
        paramsObj.localIndex!,
        outScale,
        outRotation,
        sceneTransform,
        scaleOverride
      );
    };
  })();

  /**
   * Get the color of a splat
   * @param globalSplatIndex The global index of the splat
   * @param outColor The vector to store the color in
   */
  getSplatColor = (() => {
    // Define the paramsObj with proper type
    const paramsObj: {
      splatBuffer?: SplatBuffer;
      localIndex?: number;
      sceneTransform?: THREE.Matrix4 | null;
    } = {};

    return (globalSplatIndex: number, outColor: THREE.Vector4): void => {
      this.getLocalSplatParameters(globalSplatIndex, paramsObj, false);
      paramsObj.splatBuffer!.getSplatColor(paramsObj.localIndex!, outColor);
    };
  })();

  /**
   * Store the transform of the scene at 'sceneIndex' in 'outTransform'.
   * @param sceneIndex Index of the desired scene
   * @param outTransform Instance of THREE.Matrix4 in which to store the scene's transform
   */
  getSceneTransform(sceneIndex: number, outTransform: THREE.Matrix4): void {
    const scene = this.getScene(sceneIndex);
    scene.updateTransform(this.dynamicMode);
    outTransform.copy(scene.transform);
  }

  /**
   * Get a scene by index
   * @param sceneIndex The index of the scene
   * @returns The scene
   */
  getScene(sceneIndex: number): SplatScene {
    if (sceneIndex < 0 || sceneIndex >= this.scenes.length) {
      throw new Error("SplatMesh::getScene() -> Invalid scene index.");
    }

    return this.scenes[sceneIndex];
  }

  getSceneCount() {
    return this.scenes.length;
  }

  /**
   * Get the SplatBuffer for a given splat index
   * @param globalIndex Global index of the splat
   * @returns The SplatBuffer containing the splat
   */
  getSplatBufferForSplat(globalIndex: number): SplatBuffer {
    return this.getScene(this.globalSplatIndexToSceneIndexMap[globalIndex])
      .splatBuffer;
  }

  /**
   * Get the scene index for a splat
   * @param globalSplatIndex The global index of the splat
   * @returns The scene index
   */
  getSceneIndexForSplat(globalSplatIndex: number): number {
    return this.globalSplatIndexToSceneIndexMap[globalSplatIndex];
  }

  /**
   * Get the transform matrix for the scene containing a specific splat
   * @param globalIndex Global index of the splat
   * @returns The transform matrix of the scene containing the splat
   */
  getSceneTransformForSplat(globalIndex: number): THREE.Matrix4 {
    return this.getScene(this.globalSplatIndexToSceneIndexMap[globalIndex])
      .transform;
  }

  /**
   * Get the local index of a splat within its SplatBuffer
   * @param globalIndex Global index of the splat
   * @returns The local index within the SplatBuffer
   */
  getSplatLocalIndex(globalIndex: number): number {
    return this.globalSplatIndexToLocalSplatIndexMap[globalIndex];
  }

  /**
   * Converts a THREE.Matrix4 to an array of integers by scaling each element by 1000 and rounding
   * @param matrix - The THREE.Matrix4 to convert
   * @return An array of integers representing the matrix values scaled by 1000
   */
  static getIntegerMatrixArray(matrix: THREE.Matrix4): number[] {
    const matrixElements = matrix.elements;
    const intMatrixArray: number[] = [];
    for (let i = 0; i < 16; i++) {
      intMatrixArray[i] = Math.round(matrixElements[i] * 1000.0);
    }
    return intMatrixArray;
  }

  /**
   * Compute a bounding box for the splats
   * @param applySceneTransforms Whether to apply scene transforms when computing the bounding box
   * @param sceneIndex Optional index of a specific scene to compute bounds for, or undefined for all scenes
   * @returns A THREE.Box3 containing the bounding box
   */
  computeBoundingBox(
    applySceneTransforms: boolean = false,
    sceneIndex?: number
  ): THREE.Box3 {
    let splatCount = this.getSplatCount();
    if (sceneIndex !== undefined && sceneIndex !== null) {
      if (sceneIndex < 0 || sceneIndex >= this.scenes.length) {
        throw new Error(
          "SplatMesh::computeBoundingBox() -> Invalid scene index."
        );
      }
      splatCount = this.scenes[sceneIndex].splatBuffer.getSplatCount();
    }

    const floatCenters = new Float32Array(splatCount * 3);
    this.fillSplatDataArrays(
      null,
      null,
      null,
      floatCenters,
      null,
      null,
      applySceneTransforms,
      undefined,
      undefined,
      undefined,
      undefined,
      sceneIndex
    );

    const min = new THREE.Vector3();
    const max = new THREE.Vector3();
    for (let i = 0; i < splatCount; i++) {
      const offset = i * 3;
      const x = floatCenters[offset];
      const y = floatCenters[offset + 1];
      const z = floatCenters[offset + 2];
      if (i === 0 || x < min.x) min.x = x;
      if (i === 0 || y < min.y) min.y = y;
      if (i === 0 || z < min.z) min.z = z;
      if (i === 0 || x > max.x) max.x = x;
      if (i === 0 || y > max.y) max.y = y;
      if (i === 0 || z > max.z) max.z = z;
    }

    return new THREE.Box3(min, max);
  }
}
