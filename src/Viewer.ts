import * as THREE from "three";
import { OrbitControls } from "./OrbitControls.js";
import { PlyLoader } from "./loaders/ply/PlyLoader.js";
import { SplatLoader } from "./loaders/splat/SplatLoader.js";
import { KSplatLoader } from "./loaders/ksplat/KSplatLoader.js";
import { SpzLoader } from "./loaders/spz/SpzLoader.js";
import { sceneFormatFromPath } from "./loaders/Utils.js";
import { LoadingSpinner } from "./ui/LoadingSpinner.js";
import { LoadingProgressBar } from "./ui/LoadingProgressBar.js";
import { InfoPanel } from "./ui/InfoPanel.js";
import { SceneHelper } from "./SceneHelper.js";
import { Raycaster } from "./raycaster/Raycaster.js";
import { SplatMesh } from "./splatmesh/SplatMesh.js";
import { createSortWorker } from "./worker/SortWorker.js";
import { Constants } from "./Constants.js";
import { getCurrentTime, isIOS, getIOSSemever, clamp } from "./Util.js";
import { AbortablePromise, AbortedPromiseError } from "./AbortablePromise.js";
import { SceneFormat } from "./loaders/SceneFormat.js";
import { WebXRMode } from "./webxr/WebXRMode.js";
import { VRButton } from "./webxr/VRButton.js";
import { ARButton } from "./webxr/ARButton.js";
import {
  delayedExecute,
  abortablePromiseWithExtractedComponents,
} from "./Util.js";
import { LoaderStatus } from "./loaders/LoaderStatus.js";
import { DirectLoadError } from "./loaders/DirectLoadError.js";
import { RenderMode } from "./RenderMode.js";
import { LogLevel } from "./LogLevel.js";
import { SceneRevealMode } from "./SceneRevealMode.js";
import { SplatRenderMode } from "./SplatRenderMode.js";
import { SplatBuffer } from "./loaders/SplatBuffer.js";

const THREE_CAMERA_FOV = 50;
const MINIMUM_DISTANCE_TO_NEW_FOCAL_POINT = 0.75;
const MIN_SPLAT_COUNT_TO_SHOW_SPLAT_TREE_LOADING_SPINNER = 1500000;
const FOCUS_MARKER_FADE_IN_SPEED = 10.0;
const FOCUS_MARKER_FADE_OUT_SPEED = 2.5;
const CONSECUTIVE_RENDERED_FRAMES_FOR_FPS_CALCULATION = 60;

interface ViewerOptions {
  cameraUp?: number[];
  initialCameraPosition?: number[];
  initialCameraLookAt?: number[];
  dropInMode?: boolean;
  selfDrivenMode?: boolean;
  useBuiltInControls?: boolean;
  rootElement?: HTMLElement;
  ignoreDevicePixelRatio?: boolean;
  halfPrecisionCovariancesOnGPU?: boolean;
  threeScene?: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  camera?: THREE.Camera;
  gpuAcceleratedSort?: boolean;
  integerBasedSort?: boolean;
  sharedMemoryForWorkers?: boolean;
  dynamicScene?: boolean;
  antialiased?: boolean;
  kernel2DSize?: number;
  webXRMode?: WebXRMode;
  webXRSessionInit?: any;
  renderMode?: RenderMode;
  sceneRevealMode?: SceneRevealMode;
  focalAdjustment?: number;
  maxScreenSpaceSplatSize?: number;
  logLevel?: LogLevel;
  sphericalHarmonicsDegree?: number;
  enableOptionalEffects?: boolean;
  enableSIMDInSort?: boolean;
  inMemoryCompressionLevel?: number;
  optimizeSplatData?: boolean;
  freeIntermediateSplatData?: boolean;
  splatRenderMode?: SplatRenderMode;
  sceneFadeInRateMultiplier?: number;
  splatSortDistanceMapPrecision?: number;
}

interface AddSplatSceneOptions {
  splatAlphaRemovalThreshold?: number;
  showLoadingUI?: boolean;
  position?: number[];
  rotation?: number[];
  orientation?: number[]; // Alternative to rotation
  scale?: number[];
  onProgress?: (
    percentComplete: number,
    percentCompleteLabel: string,
    loaderStatus: LoaderStatus
  ) => void;
  headers?: Record<string, string>;
  progressiveLoad?: boolean;
  format?: number;
}

/**
 * Viewer: Manages the rendering of splat scenes. Manages an instance of SplatMesh as well as a web worker
 * that performs the sort for its splats.
 */
export class Viewer {
  private cameraUp: THREE.Vector3;
  private initialCameraPosition: THREE.Vector3;
  private initialCameraLookAt: THREE.Vector3;
  private dropInMode: boolean;
  private selfDrivenMode: boolean;
  private selfDrivenUpdateFunc: () => void;
  private useBuiltInControls: boolean;
  private rootElement: HTMLElement | null;
  private ignoreDevicePixelRatio: boolean;
  private devicePixelRatio: number;
  private halfPrecisionCovariancesOnGPU: boolean;
  private threeScene: THREE.Scene | null;
  private renderer: THREE.WebGLRenderer | null;
  private camera: THREE.Camera | null;
  private gpuAcceleratedSort: boolean;
  private integerBasedSort: boolean;
  private sharedMemoryForWorkers: boolean;
  private dynamicScene: boolean;
  private antialiased: boolean;
  private kernel2DSize: number;
  private webXRMode: WebXRMode;
  private webXRActive: boolean;
  private webXRSessionInit: any;
  private renderMode: RenderMode;
  private sceneRevealMode: SceneRevealMode;
  private focalAdjustment: number;
  private maxScreenSpaceSplatSize: number;
  private logLevel: LogLevel;
  private sphericalHarmonicsDegree: number;
  private enableOptionalEffects: boolean;
  private enableSIMDInSort: boolean;
  private inMemoryCompressionLevel: number;
  private optimizeSplatData: boolean;
  private freeIntermediateSplatData: boolean;
  private splatRenderMode: SplatRenderMode;
  private sceneFadeInRateMultiplier: number;
  private splatSortDistanceMapPrecision: number;
  private onSplatMeshChangedCallback: (() => void) | null;
  private splatMesh: any; // Will need a more specific type when implementing createSplatMesh
  private controls: any | null;
  private perspectiveControls: any | null;
  private orthographicControls: any | null;
  private orthographicCamera: THREE.OrthographicCamera | null;
  private perspectiveCamera: THREE.PerspectiveCamera | null;
  private showMeshCursor: boolean;
  private showControlPlane: boolean;
  private showInfo: boolean;
  private sceneHelper: any | null;
  private sortWorker: any | null;
  private sortRunning: boolean;
  private splatRenderCount: number;
  private splatSortCount: number;
  private lastSplatSortCount: number;
  private sortWorkerIndexesToSort: Uint32Array | null;
  private sortWorkerSortedIndexes: Uint32Array | null;
  private sortWorkerPrecomputedDistances: Float32Array | Int32Array | null;
  private sortWorkerTransforms: Float32Array | null;
  private preSortMessages: any[];
  private runAfterNextSort: any[];
  private selfDrivenModeRunning: boolean;
  private splatRenderReady: boolean;
  private raycaster: Raycaster;
  private infoPanel: any | null;
  private startInOrthographicMode: boolean;
  private currentFPS: number | null;
  private lastSortTime: number;
  private consecutiveRenderFrames: number;
  private previousCameraTarget: THREE.Vector3;
  private nextCameraTarget: THREE.Vector3;
  private mousePosition: THREE.Vector2;
  private mouseDownPosition: THREE.Vector2;
  private mouseDownTime: number | null;
  private resizeObserver: ResizeObserver | null;
  private mouseMoveListener: ((event: MouseEvent) => void) | null;
  private mouseDownListener: ((event: MouseEvent) => void) | null;
  private mouseUpListener: ((event: MouseEvent) => void) | null;
  private keyDownListener: ((event: KeyboardEvent) => void) | null;
  private sortPromise: Promise<any> | null;
  private sortPromiseResolver: ((value?: any) => void) | null;
  private splatSceneDownloadPromises: Record<string, any>;
  private splatSceneDownloadAndBuildPromise: AbortablePromise<any> | null;
  private splatSceneRemovalPromise: Promise<any> | null;
  private loadingSpinner: LoadingSpinner;
  private loadingProgressBar: LoadingProgressBar;
  private usingExternalCamera: boolean;
  private usingExternalRenderer: boolean;
  private initialized: boolean;
  private disposing: boolean;
  private disposed: boolean;
  private disposePromise: Promise<any> | null;
  private renderNextFrame?: boolean;
  private transitioningCameraTarget?: boolean;
  private transitioningCameraTargetStartTime?: number;
  private requestFrameId?: number;

  constructor(options: ViewerOptions = {}) {
    // The natural 'up' vector for viewing the scene (only has an effect when used with orbit controls and
    // when the viewer uses its own camera).
    if (!options.cameraUp) options.cameraUp = [0, 1, 0];
    this.cameraUp = new THREE.Vector3().fromArray(options.cameraUp);

    // The camera's initial position (only used when the viewer uses its own camera).
    if (!options.initialCameraPosition)
      options.initialCameraPosition = [0, 10, 15];
    this.initialCameraPosition = new THREE.Vector3().fromArray(
      options.initialCameraPosition
    );

    // The initial focal point of the camera and center of the camera's orbit (only used when the viewer uses its own camera).
    if (!options.initialCameraLookAt) options.initialCameraLookAt = [0, 0, 0];
    this.initialCameraLookAt = new THREE.Vector3().fromArray(
      options.initialCameraLookAt
    );

    // 'dropInMode' is a flag that is used internally to support the usage of the viewer as a Three.js scene object
    this.dropInMode = options.dropInMode || false;

    // If 'selfDrivenMode' is true, the viewer manages its own update/animation loop via requestAnimationFrame()
    if (options.selfDrivenMode === undefined || options.selfDrivenMode === null)
      options.selfDrivenMode = true;
    this.selfDrivenMode = options.selfDrivenMode && !this.dropInMode;
    this.selfDrivenUpdateFunc = this.selfDrivenUpdate.bind(this);

    // If 'useBuiltInControls' is true, the viewer will create its own instance of OrbitControls and attach to the camera
    if (options.useBuiltInControls === undefined)
      options.useBuiltInControls = true;
    this.useBuiltInControls = options.useBuiltInControls;

    // parent element of the Three.js renderer canvas
    this.rootElement = options.rootElement || null;

    // Tells the viewer to pretend the device pixel ratio is 1, which can boost performance on devices where it is larger,
    // at a small cost to visual quality
    this.ignoreDevicePixelRatio = options.ignoreDevicePixelRatio || false;
    this.devicePixelRatio = this.ignoreDevicePixelRatio
      ? 1
      : window.devicePixelRatio || 1;

    // Tells the viewer to use 16-bit floating point values when storing splat covariance data in textures, instead of 32-bit
    this.halfPrecisionCovariancesOnGPU =
      options.halfPrecisionCovariancesOnGPU || false;

    // If 'threeScene' is valid, it will be rendered by the viewer along with the splat mesh
    this.threeScene = options.threeScene || null;
    // Allows for usage of an external Three.js renderer
    this.renderer = options.renderer || null;
    // Allows for usage of an external Three.js camera
    this.camera = options.camera || null;

    // If 'gpuAcceleratedSort' is true, a partially GPU-accelerated approach to sorting splats will be used.
    // Currently this means pre-computing splat distances from the camera on the GPU
    this.gpuAcceleratedSort = options.gpuAcceleratedSort || false;

    // if 'integerBasedSort' is true, the integer version of splat centers as well as other values used to calculate
    // splat distances are used instead of the float version. This speeds up computation, but introduces the possibility of
    // overflow in larger scenes.
    if (
      options.integerBasedSort === undefined ||
      options.integerBasedSort === null
    ) {
      options.integerBasedSort = true;
    }
    this.integerBasedSort = options.integerBasedSort;

    // If 'sharedMemoryForWorkers' is true, a SharedArrayBuffer will be used to communicate with web workers. This method
    // is faster than copying memory to or from web workers, but comes with security implications as outlined here:
    // https://web.dev/articles/cross-origin-isolation-guide
    // If enabled, it requires specific CORS headers to be present in the response from the server that is sent when
    // loading the application. More information is available in the README.
    if (
      options.sharedMemoryForWorkers === undefined ||
      options.sharedMemoryForWorkers === null
    )
      options.sharedMemoryForWorkers = true;
    this.sharedMemoryForWorkers = options.sharedMemoryForWorkers;

    // if 'dynamicScene' is true, it tells the viewer to assume scene elements are not stationary or that the number of splats in the
    // scene may change. This prevents optimizations that depend on a static scene from being made. Additionally, if 'dynamicScene' is
    // true it tells the splat mesh to not apply scene tranforms to splat data that is returned by functions like
    // SplatMesh.getSplatCenter() by default.
    this.dynamicScene = !!options.dynamicScene;

    // When true, will perform additional steps during rendering to address artifacts caused by the rendering of gaussians at a
    // substantially different resolution than that at which they were rendered during training. This will only work correctly
    // for models that were trained using a process that utilizes this compensation calculation. For more details:
    // https://github.com/nerfstudio-project/gsplat/pull/117
    // https://github.com/graphdeco-inria/gaussian-splatting/issues/294#issuecomment-1772688093
    this.antialiased = options.antialiased || false;

    // This constant is added to the projected 2D screen-space splat scales
    this.kernel2DSize =
      options.kernel2DSize === undefined ? 0.3 : options.kernel2DSize;

    this.webXRMode = options.webXRMode || WebXRMode.None;
    if (this.webXRMode !== WebXRMode.None) {
      this.gpuAcceleratedSort = false;
    }
    this.webXRActive = false;

    this.webXRSessionInit = options.webXRSessionInit || {};

    // if 'renderMode' is RenderMode.Always, then the viewer will rrender the scene on every update. If it is RenderMode.OnChange,
    // it will only render when something in the scene has changed.
    this.renderMode = options.renderMode || RenderMode.Always;

    // SceneRevealMode.Default results in a nice, slow fade-in effect for progressively loaded scenes,
    // and a fast fade-in for non progressively loaded scenes.
    // SceneRevealMode.Gradual will force a slow fade-in for all scenes.
    // SceneRevealMode.Instant will force all loaded scene data to be immediately visible.
    this.sceneRevealMode = options.sceneRevealMode || SceneRevealMode.Default;

    // Hacky, experimental, non-scientific parameter for tweaking focal length related calculations. For scenes with very
    // small gaussians, small details, and small dimensions -- increasing this value can help improve visual quality.
    this.focalAdjustment = options.focalAdjustment || 1.0;

    // Specify the maximum screen-space splat size, can help deal with large splats that get too unwieldy
    this.maxScreenSpaceSplatSize = options.maxScreenSpaceSplatSize || 1024;

    // The verbosity of console logging
    this.logLevel = options.logLevel || LogLevel.None;

    // Degree of spherical harmonics to utilize in rendering splats (assuming the data is present in the splat scene).
    // Valid values are 0 - 2. Default value is 0.
    this.sphericalHarmonicsDegree = options.sphericalHarmonicsDegree || 0;

    // When true, allows for usage of extra properties and attributes during rendering for effects such as opacity adjustment.
    // Default is false for performance reasons. These properties are separate from transform properties (scale, rotation, position)
    // that are enabled by the 'dynamicScene' parameter.
    this.enableOptionalEffects = options.enableOptionalEffects || false;

    // Enable the usage of SIMD WebAssembly instructions for the splat sort
    if (
      options.enableSIMDInSort === undefined ||
      options.enableSIMDInSort === null
    )
      options.enableSIMDInSort = true;
    this.enableSIMDInSort = options.enableSIMDInSort;

    // Level to compress non KSPLAT files when loading them for direct rendering
    if (
      options.inMemoryCompressionLevel === undefined ||
      options.inMemoryCompressionLevel === null
    ) {
      options.inMemoryCompressionLevel = 0;
    }
    this.inMemoryCompressionLevel = options.inMemoryCompressionLevel;

    // Reorder splat data in memory after loading is complete to optimize cache utilization. Default is true.
    // Does not apply if splat scene is progressively loaded.
    if (
      options.optimizeSplatData === undefined ||
      options.optimizeSplatData === null
    ) {
      options.optimizeSplatData = true;
    }
    this.optimizeSplatData = options.optimizeSplatData;

    // When true, the intermediate splat data that is the result of decompressing splat bufffer(s) and is used to
    // populate the data textures will be freed. This will reduces memory usage, but if that data needs to be modified
    // it will need to be re-populated from the splat buffer(s). Default is false.
    if (
      options.freeIntermediateSplatData === undefined ||
      options.freeIntermediateSplatData === null
    ) {
      options.freeIntermediateSplatData = false;
    }
    this.freeIntermediateSplatData = options.freeIntermediateSplatData;

    // It appears that for certain iOS versions, special actions need to be taken with the
    // usage of SIMD instructions and shared memory
    if (isIOS()) {
      const semver = getIOSSemever();
      if (semver.major < 17) {
        this.enableSIMDInSort = false;
      }
      if (semver.major < 16) {
        this.sharedMemoryForWorkers = false;
      }
    }

    // Tell the viewer how to render the splats
    if (
      options.splatRenderMode === undefined ||
      options.splatRenderMode === null
    ) {
      options.splatRenderMode = SplatRenderMode.ThreeD;
    }
    this.splatRenderMode = options.splatRenderMode;

    // Customize the speed at which the scene is revealed
    this.sceneFadeInRateMultiplier = options.sceneFadeInRateMultiplier || 1.0;

    // Set the range for the depth map for the counting sort used to sort the splats
    this.splatSortDistanceMapPrecision =
      options.splatSortDistanceMapPrecision ||
      Constants.DefaultSplatSortDistanceMapPrecision;
    const maxPrecision = this.integerBasedSort ? 20 : 24;
    this.splatSortDistanceMapPrecision = clamp(
      this.splatSortDistanceMapPrecision,
      10,
      maxPrecision
    );

    this.onSplatMeshChangedCallback = null;
    this.createSplatMesh();

    this.controls = null;
    this.perspectiveControls = null;
    this.orthographicControls = null;

    this.orthographicCamera = null;
    this.perspectiveCamera = null;

    this.showMeshCursor = false;
    this.showControlPlane = false;
    this.showInfo = false;

    this.sceneHelper = null;

    this.sortWorker = null;
    this.sortRunning = false;
    this.splatRenderCount = 0;
    this.splatSortCount = 0;
    this.lastSplatSortCount = 0;
    this.sortWorkerIndexesToSort = null;
    this.sortWorkerSortedIndexes = null;
    this.sortWorkerPrecomputedDistances = null;
    this.sortWorkerTransforms = null;
    this.preSortMessages = [];
    this.runAfterNextSort = [];

    this.selfDrivenModeRunning = false;
    this.splatRenderReady = false;

    this.raycaster = new Raycaster(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -1),
      false
    );

    this.infoPanel = null;

    this.startInOrthographicMode = false;

    this.currentFPS = 0;
    this.lastSortTime = 0;
    this.consecutiveRenderFrames = 0;

    this.previousCameraTarget = new THREE.Vector3();
    this.nextCameraTarget = new THREE.Vector3();

    this.mousePosition = new THREE.Vector2();
    this.mouseDownPosition = new THREE.Vector2();
    this.mouseDownTime = null;

    this.resizeObserver = null;
    this.mouseMoveListener = null;
    this.mouseDownListener = null;
    this.mouseUpListener = null;
    this.keyDownListener = null;

    this.sortPromise = null;
    this.sortPromiseResolver = null;
    this.splatSceneDownloadPromises = {};
    this.splatSceneDownloadAndBuildPromise = null;
    this.splatSceneRemovalPromise = null;

    this.loadingSpinner = new LoadingSpinner(
      "",
      this.rootElement || document.body
    );
    this.loadingSpinner.hide();
    this.loadingProgressBar = new LoadingProgressBar(
      this.rootElement || document.body
    );
    this.loadingProgressBar.hide();
    this.infoPanel = new InfoPanel(this.rootElement || document.body);
    this.infoPanel.hide();

    this.usingExternalCamera = this.dropInMode || this.camera ? true : false;
    this.usingExternalRenderer =
      this.dropInMode || this.renderer ? true : false;

    this.initialized = false;
    this.disposing = false;
    this.disposed = false;
    this.disposePromise = null;
    if (!this.dropInMode) this.init();
  }

  createSplatMesh() {
    this.splatMesh = new SplatMesh(
      this.splatRenderMode,
      this.dynamicScene,
      this.enableOptionalEffects,
      this.halfPrecisionCovariancesOnGPU,
      this.devicePixelRatio,
      this.gpuAcceleratedSort,
      this.integerBasedSort,
      this.antialiased,
      this.maxScreenSpaceSplatSize,
      this.logLevel,
      this.sphericalHarmonicsDegree,
      this.sceneFadeInRateMultiplier,
      this.kernel2DSize
    );
    this.splatMesh.frustumCulled = false;
    if (this.onSplatMeshChangedCallback) this.onSplatMeshChangedCallback();
  }

  init() {
    if (this.initialized) return;

    if (!this.rootElement) {
      if (!this.usingExternalRenderer) {
        this.rootElement = document.createElement("div");
        this.rootElement.style.width = "100%";
        this.rootElement.style.height = "100%";
        this.rootElement.style.position = "absolute";
        document.body.appendChild(this.rootElement);
      } else {
        this.rootElement = this.renderer?.domElement || document.body;
      }
    }

    this.setupCamera();
    this.setupRenderer();
    this.setupWebXR(this.webXRSessionInit);
    this.setupControls();
    this.setupEventHandlers();

    this.threeScene = this.threeScene || new THREE.Scene();
    this.sceneHelper = new SceneHelper(this.threeScene);
    this.sceneHelper.setupMeshCursor();
    this.sceneHelper.setupFocusMarker();
    this.sceneHelper.setupControlPlane();

    this.loadingProgressBar.setContainer(this.rootElement);
    this.loadingSpinner.setContainer(this.rootElement);
    this.infoPanel.setContainer(this.rootElement);

    this.initialized = true;
  }

  setupCamera(): void {
    if (!this.usingExternalCamera) {
      const renderDimensions = new THREE.Vector2();
      this.getRenderDimensions(renderDimensions);

      this.perspectiveCamera = new THREE.PerspectiveCamera(
        THREE_CAMERA_FOV,
        renderDimensions.x / renderDimensions.y,
        0.1,
        1000
      );
      this.orthographicCamera = new THREE.OrthographicCamera(
        renderDimensions.x / -2,
        renderDimensions.x / 2,
        renderDimensions.y / 2,
        renderDimensions.y / -2,
        0.1,
        1000
      );
      this.camera = this.startInOrthographicMode
        ? this.orthographicCamera
        : this.perspectiveCamera;
      this.camera.position.copy(this.initialCameraPosition);
      this.camera.up.copy(this.cameraUp).normalize();
      this.camera.lookAt(this.initialCameraLookAt);
    }
  }

  setupRenderer(): void {
    if (!this.usingExternalRenderer) {
      const renderDimensions = new THREE.Vector2();
      this.getRenderDimensions(renderDimensions);

      this.renderer = new THREE.WebGLRenderer({
        antialias: false,
        precision: "highp",
      });
      this.renderer.setPixelRatio(this.devicePixelRatio);
      this.renderer.autoClear = true;
      this.renderer.setClearColor(new THREE.Color(0x000000), 0.0);
      this.renderer.setSize(renderDimensions.x, renderDimensions.y);

      this.resizeObserver = new ResizeObserver(() => {
        this.getRenderDimensions(renderDimensions);
        this.renderer?.setSize(renderDimensions.x, renderDimensions.y);
        this.forceRenderNextFrame();
      });
      if (this.rootElement) {
        this.resizeObserver.observe(this.rootElement);
        this.rootElement.appendChild(this.renderer.domElement);
      }
    }
  }

  setupWebXR(webXRSessionInit: any): void {
    if (this.webXRMode && this.renderer) {
      const rendererWithXR = this.renderer as THREE.WebGLRenderer & { xr: any };

      if (this.webXRMode === WebXRMode.VR && this.rootElement) {
        this.rootElement.appendChild(
          VRButton.createButton(rendererWithXR as any, webXRSessionInit)
        );
      } else if (this.webXRMode === WebXRMode.AR && this.rootElement) {
        this.rootElement.appendChild(
          ARButton.createButton(rendererWithXR as any, webXRSessionInit)
        );
      }

      rendererWithXR.xr.addEventListener("sessionstart", () => {
        this.webXRActive = true;
      });

      rendererWithXR.xr.addEventListener("sessionend", () => {
        this.webXRActive = false;
      });

      rendererWithXR.xr.enabled = true;

      if (this.camera) {
        this.camera.position.copy(this.initialCameraPosition);
        this.camera.up.copy(this.cameraUp).normalize();
        this.camera.lookAt(this.initialCameraLookAt);
      }
    }
  }

  setupControls(): void {
    if (
      this.useBuiltInControls &&
      this.webXRMode === WebXRMode.None &&
      this.renderer
    ) {
      if (!this.usingExternalCamera) {
        if (this.perspectiveCamera) {
          this.perspectiveControls = new OrbitControls(
            this.perspectiveCamera,
            this.renderer.domElement
          );
        }
        if (this.orthographicCamera) {
          this.orthographicControls = new OrbitControls(
            this.orthographicCamera,
            this.renderer.domElement
          );
        }
      } else if (this.camera) {
        // Check for specific camera types
        if (this.camera instanceof THREE.OrthographicCamera) {
          this.orthographicControls = new OrbitControls(
            this.camera,
            this.renderer.domElement
          );
        } else if (this.camera instanceof THREE.PerspectiveCamera) {
          this.perspectiveControls = new OrbitControls(
            this.camera,
            this.renderer.domElement
          );
        }
      }
      for (let controls of [
        this.orthographicControls,
        this.perspectiveControls,
      ]) {
        if (controls) {
          controls.listenToKeyEvents(window);
          controls.rotateSpeed = 0.5;
          controls.maxPolarAngle = Math.PI * 0.75;
          controls.minPolarAngle = 0.1;
          controls.enableDamping = true;
          controls.dampingFactor = 0.05;
          controls.target.copy(this.initialCameraLookAt);
          controls.update();
        }
      }

      // Determine controls based on camera type
      if (this.camera instanceof THREE.OrthographicCamera) {
        this.controls = this.orthographicControls;
      } else {
        this.controls = this.perspectiveControls;
      }

      if (this.controls) {
        this.controls.update();
      }
    }
  }

  setupEventHandlers(): void {
    if (
      this.useBuiltInControls &&
      this.webXRMode === WebXRMode.None &&
      this.renderer
    ) {
      this.mouseMoveListener = this.onMouseMove.bind(this);
      this.renderer.domElement.addEventListener(
        "pointermove",
        this.mouseMoveListener,
        false
      );
      this.mouseDownListener = this.onMouseDown.bind(this);
      this.renderer.domElement.addEventListener(
        "pointerdown",
        this.mouseDownListener,
        false
      );
      this.mouseUpListener = this.onMouseUp.bind(this);
      this.renderer.domElement.addEventListener(
        "pointerup",
        this.mouseUpListener,
        false
      );
      this.keyDownListener = this.onKeyDown.bind(this);
      window.addEventListener("keydown", this.keyDownListener, false);
    }
  }

  removeEventHandlers() {
    if (this.useBuiltInControls && this.renderer) {
      if (this.mouseMoveListener) {
        this.renderer.domElement.removeEventListener(
          "pointermove",
          this.mouseMoveListener
        );
        this.mouseMoveListener = null;
      }

      if (this.mouseDownListener) {
        this.renderer.domElement.removeEventListener(
          "pointerdown",
          this.mouseDownListener
        );
        this.mouseDownListener = null;
      }

      if (this.mouseUpListener) {
        this.renderer.domElement.removeEventListener(
          "pointerup",
          this.mouseUpListener
        );
        this.mouseUpListener = null;
      }

      if (this.keyDownListener) {
        window.removeEventListener("keydown", this.keyDownListener);
        this.keyDownListener = null;
      }
    }
  }

  setRenderMode(renderMode: RenderMode): void {
    this.renderMode = renderMode;
  }

  setActiveSphericalHarmonicsDegrees(
    activeSphericalHarmonicsDegrees: number
  ): void {
    if (
      this.splatMesh &&
      this.splatMesh.material &&
      this.splatMesh.material.uniforms
    ) {
      this.splatMesh.material.uniforms.sphericalHarmonicsDegree.value =
        activeSphericalHarmonicsDegrees;
      this.splatMesh.material.uniformsNeedUpdate = true;
    }
  }

  onSplatMeshChanged(callback: (() => void) | null): void {
    this.onSplatMeshChangedCallback = callback;
  }

  onKeyDown = (() => {
    const forward = new THREE.Vector3();
    const tempMatrixLeft = new THREE.Matrix4();
    const tempMatrixRight = new THREE.Matrix4();

    return (e: KeyboardEvent): void => {
      if (!this.camera) return;

      forward.set(0, 0, -1);
      forward.transformDirection(this.camera.matrixWorld);
      tempMatrixLeft.makeRotationAxis(forward, Math.PI / 128);
      tempMatrixRight.makeRotationAxis(forward, -Math.PI / 128);
      switch (e.code) {
        case "KeyG":
          this.focalAdjustment += 0.02;
          this.forceRenderNextFrame();
          break;
        case "KeyF":
          this.focalAdjustment -= 0.02;
          this.forceRenderNextFrame();
          break;
        case "ArrowLeft":
          if (this.camera) {
            this.camera.up.transformDirection(tempMatrixLeft);
          }
          break;
        case "ArrowRight":
          if (this.camera) {
            this.camera.up.transformDirection(tempMatrixRight);
          }
          break;
        case "KeyC":
          this.showMeshCursor = !this.showMeshCursor;
          break;
        case "KeyU":
          this.showControlPlane = !this.showControlPlane;
          break;
        case "KeyI":
          this.showInfo = !this.showInfo;
          if (this.showInfo && this.infoPanel) {
            this.infoPanel.show();
          } else if (this.infoPanel) {
            this.infoPanel.hide();
          }
          break;
        case "KeyO":
          if (!this.usingExternalCamera && this.camera) {
            this.setOrthographicMode(
              !(this.camera instanceof THREE.OrthographicCamera)
            );
          }
          break;
        case "KeyP":
          if (!this.usingExternalCamera && this.splatMesh) {
            this.splatMesh.setPointCloudModeEnabled(
              !this.splatMesh.getPointCloudModeEnabled()
            );
          }
          break;
        case "Equal":
          if (!this.usingExternalCamera && this.splatMesh) {
            this.splatMesh.setSplatScale(this.splatMesh.getSplatScale() + 0.05);
          }
          break;
        case "Minus":
          if (!this.usingExternalCamera && this.splatMesh) {
            this.splatMesh.setSplatScale(
              Math.max(this.splatMesh.getSplatScale() - 0.05, 0.0)
            );
          }
          break;
      }
    };
  })();

  onMouseMove(mouse: MouseEvent): void {
    this.mousePosition.set(mouse.offsetX, mouse.offsetY);
  }

  onMouseDown(): void {
    this.mouseDownPosition.copy(this.mousePosition);
    this.mouseDownTime = getCurrentTime();
  }

  onMouseUp = (() => {
    const clickOffset = new THREE.Vector2();

    return (mouse: MouseEvent): void => {
      clickOffset.copy(this.mousePosition).sub(this.mouseDownPosition);
      const mouseUpTime = getCurrentTime();
      const wasClick =
        this.mouseDownTime !== null &&
        mouseUpTime - this.mouseDownTime < 0.5 &&
        clickOffset.length() < 2;
      if (wasClick) {
        this.onMouseClick(mouse);
      }
    };
  })();

  onMouseClick(mouse: MouseEvent): void {
    this.mousePosition.set(mouse.offsetX, mouse.offsetY);
    this.checkForFocalPointChange();
  }

  checkForFocalPointChange = (() => {
    const renderDimensions = new THREE.Vector2();
    const toNewFocalPoint = new THREE.Vector3();
    // Use any[] for outHits since we don't have exact type information for the Hit type
    const outHits: any[] = [];

    return (): void => {
      if (!this.transitioningCameraTarget && this.camera && this.splatMesh) {
        this.getRenderDimensions(renderDimensions);
        outHits.length = 0;

        // Only call with a perspective or orthographic camera
        if (
          this.camera instanceof THREE.PerspectiveCamera ||
          this.camera instanceof THREE.OrthographicCamera
        ) {
          this.raycaster.setFromCameraAndScreenPosition(
            this.camera,
            this.mousePosition,
            renderDimensions
          );
          this.raycaster.intersectSplatMesh(this.splatMesh, outHits);
          if (outHits.length > 0 && this.controls) {
            const hit = outHits[0];
            const intersectionPoint = hit.origin;
            toNewFocalPoint.copy(intersectionPoint).sub(this.camera.position);
            if (
              toNewFocalPoint.length() > MINIMUM_DISTANCE_TO_NEW_FOCAL_POINT
            ) {
              this.previousCameraTarget.copy(this.controls.target);
              this.nextCameraTarget.copy(intersectionPoint);
              this.transitioningCameraTarget = true;
              this.transitioningCameraTargetStartTime = getCurrentTime();
            }
          }
        }
      }
    };
  })();

  getRenderDimensions(outDimensions: THREE.Vector2): void {
    if (this.rootElement) {
      outDimensions.x = this.rootElement.offsetWidth;
      outDimensions.y = this.rootElement.offsetHeight;
    } else {
      this.renderer?.getSize(outDimensions);
    }
  }

  setOrthographicMode(orthographicMode: boolean): void {
    if (!this.camera) return;
    if (this.camera instanceof THREE.OrthographicCamera === orthographicMode)
      return;

    const fromCamera = this.camera;
    const toCamera = orthographicMode
      ? this.orthographicCamera
      : this.perspectiveCamera;

    if (!toCamera) return;

    toCamera.position.copy(fromCamera.position);
    toCamera.up.copy(fromCamera.up);
    toCamera.rotation.copy(fromCamera.rotation);
    toCamera.quaternion.copy(fromCamera.quaternion);
    toCamera.matrix.copy(fromCamera.matrix);
    this.camera = toCamera;

    if (this.controls) {
      const resetControls = (controls: any) => {
        if (controls) {
          controls.saveState();
          controls.reset();
        }
      };

      const fromControls = this.controls;
      const toControls = orthographicMode
        ? this.orthographicControls
        : this.perspectiveControls;

      if (toControls) {
        resetControls(toControls);
        resetControls(fromControls);

        toControls.target.copy(fromControls.target);
        if (
          orthographicMode &&
          this.orthographicCamera &&
          this.perspectiveCamera
        ) {
          Viewer.setCameraZoomFromPosition(
            this.orthographicCamera,
            this.perspectiveCamera,
            fromControls
          );
        } else if (this.perspectiveCamera && this.orthographicCamera) {
          Viewer.setCameraPositionFromZoom(
            this.perspectiveCamera,
            this.orthographicCamera,
            toControls
          );
        }
        this.controls = toControls;
        this.camera.lookAt(this.controls.target);
      }
    }
  }

  static setCameraPositionFromZoom(
    positionCamera: THREE.PerspectiveCamera,
    zoomedCamera: THREE.OrthographicCamera,
    controls: any
  ): void {
    const tempVector = new THREE.Vector3();
    const toLookAtDistance = 1 / (zoomedCamera.zoom * 0.001);
    tempVector
      .copy(controls.target)
      .sub(positionCamera.position)
      .normalize()
      .multiplyScalar(toLookAtDistance)
      .negate();
    positionCamera.position.copy(controls.target).add(tempVector);
  }

  static setCameraZoomFromPosition(
    zoomCamera: THREE.OrthographicCamera,
    positionZamera: THREE.PerspectiveCamera,
    controls: any
  ): void {
    const tempVector = new THREE.Vector3();
    const toLookAtDistance = tempVector
      .copy(controls.target)
      .sub(positionZamera.position)
      .length();
    zoomCamera.zoom = 1 / (toLookAtDistance * 0.001);
  }

  updateSplatMesh = (() => {
    const renderDimensions = new THREE.Vector2();

    return (): void => {
      if (!this.splatMesh || !this.camera) return;

      const splatCount = this.splatMesh.getSplatCount();
      if (splatCount > 0) {
        this.splatMesh.updateVisibleRegionFadeDistance(this.sceneRevealMode);
        this.splatMesh.updateTransforms();
        this.getRenderDimensions(renderDimensions);

        const focalLengthX =
          this.camera.projectionMatrix.elements[0] *
          0.5 *
          this.devicePixelRatio *
          renderDimensions.x;
        const focalLengthY =
          this.camera.projectionMatrix.elements[5] *
          0.5 *
          this.devicePixelRatio *
          renderDimensions.y;

        const isOrthographic = this.camera instanceof THREE.OrthographicCamera;
        const focalMultiplier = isOrthographic
          ? 1.0 / this.devicePixelRatio
          : 1.0;
        const focalAdjustment = this.focalAdjustment * focalMultiplier;
        const inverseFocalAdjustment = 1.0 / focalAdjustment;

        this.adjustForWebXRStereo(renderDimensions);

        // Get zoom value using direct type assertion
        let cameraZoom = 1.0;
        if (isOrthographic) {
          cameraZoom = (this.camera as THREE.OrthographicCamera).zoom;
        } else if (this.camera instanceof THREE.PerspectiveCamera) {
          cameraZoom = this.camera.zoom || 1.0;
        }

        this.splatMesh.updateUniforms(
          renderDimensions,
          focalLengthX * focalAdjustment,
          focalLengthY * focalAdjustment,
          isOrthographic,
          cameraZoom,
          inverseFocalAdjustment
        );
      }
    };
  })();

  adjustForWebXRStereo(renderDimensions: THREE.Vector2): void {
    // TODO: Figure out a less hacky way to determine if stereo rendering is active
    if (this.camera && this.webXRActive && this.renderer) {
      // Use type assertion to access the XR property
      const rendererWithXR = this.renderer as THREE.WebGLRenderer & {
        xr: { getCamera: () => THREE.Camera };
      };

      if (rendererWithXR.xr) {
        const xrCamera = rendererWithXR.xr.getCamera();
        if (xrCamera && xrCamera.projectionMatrix) {
          const xrCameraProj00 = xrCamera.projectionMatrix.elements[0];
          const cameraProj00 = this.camera.projectionMatrix.elements[0];
          renderDimensions.x *= cameraProj00 / xrCameraProj00;
        }
      }
    }
  }

  isLoadingOrUnloading(): boolean {
    return (
      Object.keys(this.splatSceneDownloadPromises).length > 0 ||
      this.splatSceneDownloadAndBuildPromise !== null ||
      this.splatSceneRemovalPromise !== null
    );
  }

  isDisposingOrDisposed(): boolean {
    return this.disposing || this.disposed;
  }

  addSplatSceneDownloadPromise(promise: AbortablePromise): void {
    this.splatSceneDownloadPromises[promise.id] = promise;
  }

  removeSplatSceneDownloadPromise(promise: AbortablePromise): void {
    delete this.splatSceneDownloadPromises[promise.id];
  }

  setSplatSceneDownloadAndBuildPromise(promise: AbortablePromise): void {
    this.splatSceneDownloadAndBuildPromise = promise;
  }

  clearSplatSceneDownloadAndBuildPromise(): void {
    this.splatSceneDownloadAndBuildPromise = null;
  }

  /**
   * Add a splat scene to the viewer and display any loading UI if appropriate.
   * @param {string} path Path to splat scene to be loaded
   * @param {AddSplatSceneOptions} options Configuration options for loading the splat scene
   * @return {AbortablePromise<any>} A promise that resolves when the scene is loaded
   */
  addSplatScene(
    path: string,
    options: AddSplatSceneOptions = {}
  ): AbortablePromise<any> {
    if (this.isLoadingOrUnloading()) {
      throw new Error(
        "Cannot add splat scene while another load or unload is already in progress."
      );
    }

    if (this.isDisposingOrDisposed()) {
      throw new Error("Cannot add splat scene after dispose() is called.");
    }

    if (
      options.progressiveLoad &&
      this.splatMesh &&
      this.splatMesh.scenes &&
      this.splatMesh.scenes.length > 0
    ) {
      console.log(
        'addSplatScene(): "progressiveLoad" option ignore because there are multiple splat scenes'
      );
      options.progressiveLoad = false;
    }

    const format =
      options.format !== undefined && options.format !== null
        ? options.format
        : sceneFormatFromPath(path);
    const progressiveLoad =
      Viewer.isProgressivelyLoadable(format) && !!options.progressiveLoad;
    const showLoadingUI =
      options.showLoadingUI !== undefined && options.showLoadingUI !== null
        ? options.showLoadingUI
        : true;

    let loadingUITaskId: number | null = null;
    if (showLoadingUI) {
      this.loadingSpinner.removeAllTasks();
      loadingUITaskId = this.loadingSpinner.addTask("Downloading...");
    }
    const hideLoadingUI = (): void => {
      this.loadingProgressBar.hide();
      this.loadingSpinner.removeAllTasks();
    };

    const onProgressUIUpdate = (
      percentComplete: number,
      percentCompleteLabel: string,
      loaderStatus: LoaderStatus
    ): void => {
      if (showLoadingUI && loadingUITaskId !== null) {
        if (loaderStatus === LoaderStatus.Downloading) {
          if (percentComplete == 100) {
            this.loadingSpinner.setMessageForTask(
              loadingUITaskId,
              "Download complete!"
            );
          } else {
            if (progressiveLoad) {
              this.loadingSpinner.setMessageForTask(
                loadingUITaskId,
                "Downloading splats..."
              );
            } else {
              const suffix = percentCompleteLabel
                ? `: ${percentCompleteLabel}`
                : `...`;
              this.loadingSpinner.setMessageForTask(
                loadingUITaskId,
                `Downloading${suffix}`
              );
            }
          }
        } else if (loaderStatus === LoaderStatus.Processing) {
          this.loadingSpinner.setMessageForTask(
            loadingUITaskId,
            "Processing splats..."
          );
        }
      }
    };

    let downloadDone = false;
    let downloadedPercentage = 0;
    const splatBuffersAddedUIUpdate = (
      firstBuild: boolean,
      finalBuild: boolean
    ): void => {
      if (showLoadingUI && loadingUITaskId !== null) {
        if (
          (firstBuild && progressiveLoad) ||
          (finalBuild && !progressiveLoad)
        ) {
          this.loadingSpinner.removeTask(loadingUITaskId);
          if (!finalBuild && !downloadDone) this.loadingProgressBar.show();
        }
        if (progressiveLoad) {
          if (finalBuild) {
            downloadDone = true;
            this.loadingProgressBar.hide();
          } else {
            this.loadingProgressBar.setProgress(downloadedPercentage);
          }
        }
      }
    };

    const onProgress = (
      percentComplete: number,
      percentCompleteLabel: string,
      loaderStatus: LoaderStatus
    ): void => {
      downloadedPercentage = percentComplete;
      onProgressUIUpdate(percentComplete, percentCompleteLabel, loaderStatus);
      if (options.onProgress)
        options.onProgress(percentComplete, percentCompleteLabel, loaderStatus);
    };

    const buildSection = (
      splatBuffer: any,
      firstBuild: boolean,
      finalBuild: boolean
    ) => {
      if (!progressiveLoad && options.onProgress)
        options.onProgress(0, "0%", LoaderStatus.Processing);
      const addSplatBufferOptions = {
        rotation: options.rotation || options.orientation,
        position: options.position,
        scale: options.scale,
        splatAlphaRemovalThreshold: options.splatAlphaRemovalThreshold,
      };
      return this.addSplatBuffers(
        [splatBuffer],
        [addSplatBufferOptions],
        finalBuild,
        firstBuild && showLoadingUI,
        showLoadingUI,
        progressiveLoad,
        progressiveLoad
      ).then(() => {
        if (!progressiveLoad && options.onProgress)
          options.onProgress(100, "100%", LoaderStatus.Processing);
        splatBuffersAddedUIUpdate(firstBuild, finalBuild);
      });
    };

    const loadFunc = progressiveLoad
      ? this.downloadAndBuildSingleSplatSceneProgressiveLoad.bind(this)
      : this.downloadAndBuildSingleSplatSceneStandardLoad.bind(this);
    return loadFunc(
      path,
      format as number,
      options.splatAlphaRemovalThreshold,
      buildSection.bind(this),
      onProgress,
      hideLoadingUI.bind(this),
      options.headers
    );
  }

  /**
   * Download a single splat scene, convert to splat buffer and then rebuild the viewer's splat mesh
   * by calling 'buildFunc' -- all before displaying the scene. Also sets/clears relevant instance synchronization objects,
   * and calls appropriate functions on success or failure.
   * @param {string} path Path to splat scene to be loaded
   * @param {number} format Format of the splat scene file
   * @param {number} splatAlphaRemovalThreshold Ignore any splats with an alpha less than the specified value (valid range: 0 - 255)
   * @param {Function} buildFunc Function to build the viewer's splat mesh with the downloaded splat buffer
   * @param {Function} onProgress Function to be called as file data are received, or other processing occurs
   * @param {Function} onException Function to be called when exception occurs
   * @param {Record<string, string>} headers Optional HTTP headers to pass to use for downloading splat scene
   * @return {AbortablePromise<any>}
   */
  downloadAndBuildSingleSplatSceneStandardLoad(
    path: string,
    format: number,
    splatAlphaRemovalThreshold: number | undefined,
    buildFunc: (
      splatBuffer: any,
      firstBuild: boolean,
      finalBuild: boolean
    ) => Promise<void>,
    onProgress: (
      percentComplete: number,
      percentCompleteLabel: string,
      loaderStatus: LoaderStatus
    ) => void,
    onException: () => void,
    headers?: Record<string, string>
  ): AbortablePromise<any> {
    const downloadPromise = this.downloadSplatSceneToSplatBuffer(
      path,
      splatAlphaRemovalThreshold,
      onProgress,
      false,
      undefined,
      format,
      headers
    );
    const downloadAndBuildPromise = abortablePromiseWithExtractedComponents(
      downloadPromise.abortHandler
    );

    downloadPromise
      .then((splatBuffer: any) => {
        this.removeSplatSceneDownloadPromise(downloadPromise);
        return buildFunc(splatBuffer, true, true).then(() => {
          downloadAndBuildPromise.resolve(true);
          this.clearSplatSceneDownloadAndBuildPromise();
        });
      })
      .catch((e: Error) => {
        if (onException) onException();
        this.clearSplatSceneDownloadAndBuildPromise();
        this.removeSplatSceneDownloadPromise(downloadPromise);
        downloadAndBuildPromise.reject(
          this.updateError(
            e,
            `Viewer::addSplatScene -> Could not load file ${path}`
          )
        );
      });

    this.addSplatSceneDownloadPromise(downloadPromise);
    this.setSplatSceneDownloadAndBuildPromise(downloadAndBuildPromise.promise);

    return downloadAndBuildPromise.promise;
  }

  /**
   * Download a single splat scene and convert to splat buffer in a progressive manner, allowing rendering as the file downloads.
   * As each section is downloaded, the viewer's splat mesh is rebuilt by calling 'buildFunc'
   * Also sets/clears relevant instance synchronization objects, and calls appropriate functions on success or failure.
   * @param {string} path Path to splat scene to be loaded
   * @param {number} format Format of the splat scene file
   * @param {number} splatAlphaRemovalThreshold Ignore any splats with an alpha less than the specified value (valid range: 0 - 255)
   * @param {Function} buildFunc Function to rebuild the viewer's splat mesh after a new splat buffer section is downloaded
   * @param {Function} onDownloadProgress Function to be called as file data are received
   * @param {Function} onDownloadException Function to be called when exception occurs at any point during the full download
   * @param {Record<string, string>} headers Optional HTTP headers to pass to use for downloading splat scene
   * @return {AbortablePromise<any>}
   */
  downloadAndBuildSingleSplatSceneProgressiveLoad(
    path: string,
    format: number,
    splatAlphaRemovalThreshold: number | undefined,
    buildFunc: (
      splatBuffer: any,
      firstBuild: boolean,
      finalBuild: boolean
    ) => Promise<void>,
    onDownloadProgress: (
      percentComplete: number,
      percentCompleteLabel: string,
      loaderStatus: LoaderStatus
    ) => void,
    onDownloadException: (error: Error) => void,
    headers?: Record<string, string>
  ): AbortablePromise<any> {
    interface QueuedBuild {
      splatBuffer: any;
      firstBuild: boolean;
      finalBuild: boolean;
    }

    let progressiveLoadedSectionBuildCount = 0;
    let progressiveLoadedSectionBuilding = false;
    const queuedProgressiveLoadSectionBuilds: QueuedBuild[] = [];

    const checkAndBuildProgressiveLoadSections = (): void => {
      if (
        queuedProgressiveLoadSectionBuilds.length > 0 &&
        !progressiveLoadedSectionBuilding &&
        !this.isDisposingOrDisposed()
      ) {
        progressiveLoadedSectionBuilding = true;
        const queuedBuild = queuedProgressiveLoadSectionBuilds.shift()!;
        buildFunc(
          queuedBuild.splatBuffer,
          queuedBuild.firstBuild,
          queuedBuild.finalBuild
        ).then(() => {
          progressiveLoadedSectionBuilding = false;
          if (queuedBuild.firstBuild) {
            progressiveLoadFirstSectionBuildPromise.resolve(true);
          } else if (queuedBuild.finalBuild) {
            splatSceneDownloadAndBuildPromise.resolve(true);
            this.clearSplatSceneDownloadAndBuildPromise();
          }
          if (queuedProgressiveLoadSectionBuilds.length > 0) {
            delayedExecute(() => checkAndBuildProgressiveLoadSections());
          }
        });
      }
    };

    const onProgressiveLoadSectionProgress = (
      splatBuffer: any,
      finalBuild: boolean
    ): void => {
      if (!this.isDisposingOrDisposed()) {
        if (
          finalBuild ||
          queuedProgressiveLoadSectionBuilds.length === 0 ||
          splatBuffer.getSplatCount() >
            queuedProgressiveLoadSectionBuilds[0].splatBuffer.getSplatCount()
        ) {
          queuedProgressiveLoadSectionBuilds.push({
            splatBuffer,
            firstBuild: progressiveLoadedSectionBuildCount === 0,
            finalBuild,
          });
          progressiveLoadedSectionBuildCount++;
          checkAndBuildProgressiveLoadSections();
        }
      }
    };

    // Modified to pass a wrapper function that converts the callback to the correct signature
    const splatSceneDownloadPromise = this.downloadSplatSceneToSplatBuffer(
      path,
      splatAlphaRemovalThreshold,
      onDownloadProgress,
      true,
      (buffer: any, isFinal: boolean) =>
        onProgressiveLoadSectionProgress(buffer, isFinal),
      format,
      headers
    );

    const progressiveLoadFirstSectionBuildPromise =
      abortablePromiseWithExtractedComponents(
        splatSceneDownloadPromise.abortHandler
      );
    const splatSceneDownloadAndBuildPromise =
      abortablePromiseWithExtractedComponents();

    this.addSplatSceneDownloadPromise(splatSceneDownloadPromise);
    this.setSplatSceneDownloadAndBuildPromise(
      splatSceneDownloadAndBuildPromise.promise
    );

    splatSceneDownloadPromise
      .then(() => {
        this.removeSplatSceneDownloadPromise(splatSceneDownloadPromise);
      })
      .catch((e: Error) => {
        this.clearSplatSceneDownloadAndBuildPromise();
        this.removeSplatSceneDownloadPromise(splatSceneDownloadPromise);
        const error = this.updateError(
          e,
          `Viewer::addSplatScene -> Could not load file ${path}`
        );
        progressiveLoadFirstSectionBuildPromise.reject(error);
        if (onDownloadException) onDownloadException(error);
      });

    return progressiveLoadFirstSectionBuildPromise.promise;
  }

  /**
   * Add multiple splat scenes to the viewer and display any loading UI if appropriate.
   * @param {Array<object>} sceneOptions Array of per-scene options: {
   *
   *         path: Path to splat scene to be loaded
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
   *         headers:                    Optional HTTP headers to be sent along with splat requests
   *
   *         format (SceneFormat)        Optional, the format of the scene data (.ply, .ksplat, .splat). If not present, the
   *                                     file extension in 'path' will be used to determine the format (if it is present)
   * }
   * @param {boolean} showLoadingUI Display a loading spinner while the scene is loading, defaults to true
   * @param {function} onProgress Function to be called as file data are received
   * @return {AbortablePromise<any>}
   */
  addSplatScenes(
    sceneOptions: {
      path: string;
      splatAlphaRemovalThreshold?: number;
      position?: number[];
      rotation?: number[];
      scale?: number[];
      headers?: Record<string, string>;
      format?: number;
    }[],
    showLoadingUI = true,
    onProgress?: (
      percentComplete: number,
      percentCompleteLabel: string,
      loaderStatus: LoaderStatus
    ) => void
  ): AbortablePromise<any> {
    if (this.isLoadingOrUnloading()) {
      throw new Error(
        "Cannot add splat scene while another load or unload is already in progress."
      );
    }

    if (this.isDisposingOrDisposed()) {
      throw new Error("Cannot add splat scene after dispose() is called.");
    }

    const fileCount = sceneOptions.length;
    const percentComplete: number[] = [];

    let loadingUITaskId: number | null = null;
    if (showLoadingUI) {
      this.loadingSpinner.removeAllTasks();
      loadingUITaskId = this.loadingSpinner.addTask("Downloading...");
    }

    const onLoadProgress = (
      fileIndex: number,
      percent: number,
      percentLabel: string,
      loaderStatus: LoaderStatus
    ): void => {
      percentComplete[fileIndex] = percent;
      let totalPercent = 0;
      for (let i = 0; i < fileCount; i++)
        totalPercent += percentComplete[i] || 0;
      totalPercent = totalPercent / fileCount;
      percentLabel = `${totalPercent.toFixed(2)}%`;
      if (showLoadingUI && loadingUITaskId !== null) {
        if (loaderStatus === LoaderStatus.Downloading) {
          this.loadingSpinner.setMessageForTask(
            loadingUITaskId,
            totalPercent == 100
              ? `Download complete!`
              : `Downloading: ${percentLabel}`
          );
        }
      }
      if (onProgress) onProgress(totalPercent, percentLabel, loaderStatus);
    };

    const baseDownloadPromises: AbortablePromise<any>[] = [];
    const nativeDownloadPromises: Promise<any>[] = [];
    for (let i = 0; i < sceneOptions.length; i++) {
      const options = sceneOptions[i];
      const format =
        options.format !== undefined && options.format !== null
          ? options.format
          : sceneFormatFromPath(options.path);
      const baseDownloadPromise = this.downloadSplatSceneToSplatBuffer(
        options.path,
        options.splatAlphaRemovalThreshold,
        onLoadProgress.bind(this, i),
        false,
        undefined,
        format as number,
        options.headers
      );
      baseDownloadPromises.push(baseDownloadPromise);
      nativeDownloadPromises.push(baseDownloadPromise.promise);
    }

    const downloadAndBuildPromise = new AbortablePromise(
      (resolve: (value?: any) => void, reject: (reason?: any) => void) => {
        Promise.all(nativeDownloadPromises)
          .then((splatBuffers) => {
            if (showLoadingUI && loadingUITaskId !== null)
              this.loadingSpinner.removeTask(loadingUITaskId);
            if (onProgress) onProgress(0, "0%", LoaderStatus.Processing);
            this.addSplatBuffers(
              splatBuffers,
              sceneOptions,
              true,
              showLoadingUI,
              showLoadingUI,
              false,
              false
            ).then(() => {
              if (onProgress) onProgress(100, "100%", LoaderStatus.Processing);
              this.clearSplatSceneDownloadAndBuildPromise();
              resolve(true);
            });
          })
          .catch((e: Error) => {
            if (showLoadingUI && loadingUITaskId !== null)
              this.loadingSpinner.removeTask(loadingUITaskId);
            this.clearSplatSceneDownloadAndBuildPromise();
            reject(
              this.updateError(
                e,
                `Viewer::addSplatScenes -> Could not load one or more splat scenes.`
              )
            );
          })
          .finally(() => {
            this.removeSplatSceneDownloadPromise(downloadAndBuildPromise);
          });
      },
      (reason: any) => {
        for (let baseDownloadPromise of baseDownloadPromises) {
          baseDownloadPromise.abort(reason);
        }
      }
    );
    this.addSplatSceneDownloadPromise(downloadAndBuildPromise);
    this.setSplatSceneDownloadAndBuildPromise(downloadAndBuildPromise);
    return downloadAndBuildPromise;
  }

  /**
   * Download a splat scene and convert to SplatBuffer instance.
   * @param {string} path Path to splat scene to be loaded
   * @param {number} splatAlphaRemovalThreshold Ignore any splats with an alpha less than the specified
   *                                            value (valid range: 0 - 255), defaults to 1
   *
   * @param {function} onProgress Function to be called as file data are received
   * @param {boolean} progressiveBuild Construct file sections into splat buffers as they are downloaded
   * @param {function} onSectionBuilt Function to be called when new section is added to the file
   * @param {number} format File format of the scene
   * @param {object} headers Optional HTTP headers to pass to use for downloading splat scene
   * @return {AbortablePromise<any>}
   */
  downloadSplatSceneToSplatBuffer(
    path: string,
    splatAlphaRemovalThreshold: number = 1,
    onProgress?: (
      percentComplete: number,
      percentCompleteLabel: string,
      loaderStatus: LoaderStatus
    ) => void,
    progressiveBuild: boolean = false,
    onSectionBuilt?: (buffer: any, isFinal: boolean) => void,
    format?: number,
    headers?: Record<string, string>
  ): AbortablePromise<SplatBuffer | ArrayBuffer | undefined> {
    try {
      if (
        format === SceneFormat.Splat ||
        format === SceneFormat.KSplat ||
        format === SceneFormat.Ply
      ) {
        const optimizeSplatData = progressiveBuild
          ? false
          : this.optimizeSplatData;
        if (format === SceneFormat.Splat) {
          return SplatLoader.loadFromURL(
            path,
            onProgress,
            progressiveBuild,
            onSectionBuilt,
            splatAlphaRemovalThreshold,
            this.inMemoryCompressionLevel,
            optimizeSplatData,
            headers
          );
        } else if (format === SceneFormat.KSplat) {
          return KSplatLoader.loadFromURL(
            path,
            onProgress,
            progressiveBuild,
            onSectionBuilt,
            headers
          );
        } else if (format === SceneFormat.Ply) {
          return PlyLoader.loadFromURL(
            path,
            onProgress,
            progressiveBuild,
            onSectionBuilt,
            splatAlphaRemovalThreshold,
            this.inMemoryCompressionLevel,
            optimizeSplatData,
            this.sphericalHarmonicsDegree,
            headers
          );
        }
      } else if (format === SceneFormat.Spz) {
        return SpzLoader.loadFromURL(
          path,
          onProgress,
          splatAlphaRemovalThreshold,
          this.inMemoryCompressionLevel,
          this.optimizeSplatData,
          this.sphericalHarmonicsDegree,
          headers
        );
      }
    } catch (e) {
      throw this.updateError(e, null);
    }

    throw new Error(
      `Viewer::downloadSplatSceneToSplatBuffer -> File format not supported: ${path}`
    );
  }

  static isProgressivelyLoadable(format: number | null) {
    return (
      format === SceneFormat.Splat ||
      format === SceneFormat.KSplat ||
      format === SceneFormat.Ply
    );
  }

  /**
   * Add splat buffers to the scene
   * @param splatBuffers Array of splat buffer objects to add
   * @param splatBufferOptions Options for each splat buffer
   * @param finalBuild Whether this is the final build
   * @param showLoadingUI Whether to show loading UI
   * @param showLoadingUIForSplatTreeBuild Whether to show loading UI for splat tree build
   * @param replaceExisting Whether to replace existing splat buffers
   * @param enableRenderBeforeFirstSort Whether to enable rendering before first sort
   * @param preserveVisibleRegion Whether to preserve the visible region
   * @returns Promise that resolves when splat buffers have been added
   */
  addSplatBuffers = (
    splatBuffers: any[],
    splatBufferOptions: any[] = [],
    finalBuild: boolean = true,
    showLoadingUI: boolean = true,
    showLoadingUIForSplatTreeBuild: boolean = true,
    replaceExisting: boolean = false,
    enableRenderBeforeFirstSort: boolean = false,
    preserveVisibleRegion: boolean = true
  ): Promise<void> => {
    if (this.isDisposingOrDisposed()) return Promise.resolve();

    let splatProcessingTaskId: number | null = null;
    const removeSplatProcessingTask = (): void => {
      if (splatProcessingTaskId !== null) {
        this.loadingSpinner.removeTask(splatProcessingTaskId);
        splatProcessingTaskId = null;
      }
    };

    this.splatRenderReady = false;
    return new Promise<void>((resolve) => {
      if (showLoadingUI) {
        splatProcessingTaskId = this.loadingSpinner.addTask(
          "Processing splats..."
        );
      }
      delayedExecute(() => {
        if (this.isDisposingOrDisposed()) {
          resolve();
        } else {
          const buildResults = this.addSplatBuffersToMesh(
            splatBuffers,
            splatBufferOptions,
            finalBuild,
            showLoadingUIForSplatTreeBuild,
            replaceExisting,
            preserveVisibleRegion
          );

          const maxSplatCount = this.splatMesh.getMaxSplatCount();
          if (
            this.sortWorker &&
            this.sortWorker.maxSplatCount !== maxSplatCount
          )
            this.disposeSortWorker();
          // If we aren't calculating the splat distances from the center on the GPU, the sorting worker needs
          // splat centers and transform indexes so that it can calculate those distance values.
          if (!this.gpuAcceleratedSort) {
            this.preSortMessages.push({
              centers: buildResults.centers.buffer,
              sceneIndexes: buildResults.sceneIndexes.buffer,
              range: {
                from: buildResults.from,
                to: buildResults.to,
                count: buildResults.count,
              },
            });
          }
          const sortWorkerSetupPromise =
            !this.sortWorker && maxSplatCount > 0
              ? this.setupSortWorker(this.splatMesh)
              : Promise.resolve();
          sortWorkerSetupPromise.then(() => {
            if (this.isDisposingOrDisposed()) return;
            this.runSplatSort(true, true).then((sortRunning) => {
              if (!this.sortWorker || !sortRunning) {
                this.splatRenderReady = true;
                removeSplatProcessingTask();
                resolve();
              } else {
                if (enableRenderBeforeFirstSort) {
                  this.splatRenderReady = true;
                } else {
                  this.runAfterNextSort.push(() => {
                    this.splatRenderReady = true;
                  });
                }
                this.runAfterNextSort.push(() => {
                  removeSplatProcessingTask();
                  resolve();
                });
              }
            });
          });
        }
      }, true);
    });
  };

  /**
   * Add splat buffers to the splat mesh
   * @param splatBuffers Array of splat buffer objects to add
   * @param splatBufferOptions Array of options for each splat buffer
   * @param finalBuild Whether this is the final build
   * @param showLoadingUIForSplatTreeBuild Whether to show loading UI for splat tree build
   * @param replaceExisting Whether to replace existing splat buffers
   * @param preserveVisibleRegion Whether to preserve the visible region
   * @returns Build results containing centers, sceneIndexes, and range information
   */
  addSplatBuffersToMesh = (
    splatBuffers: any[],
    splatBufferOptions: any[],
    finalBuild: boolean = true,
    showLoadingUIForSplatTreeBuild: boolean = false,
    replaceExisting: boolean = false,
    preserveVisibleRegion: boolean = true
  ): {
    centers: any;
    sceneIndexes: any;
    from: number;
    to: number;
    count: number;
  } => {
    if (this.isDisposingOrDisposed())
      return { centers: null, sceneIndexes: null, from: 0, to: 0, count: 0 };

    let splatOptimizingTaskId: number | null = null;
    let allSplatBuffers: any[] = [];
    let allSplatBufferOptions: any[] = [];

    if (!replaceExisting) {
      allSplatBuffers =
        this.splatMesh.scenes.map((scene: any) => scene.splatBuffer) || [];
      allSplatBufferOptions = this.splatMesh.sceneOptions
        ? this.splatMesh.sceneOptions.map((sceneOptions: any) => sceneOptions)
        : [];
    }

    allSplatBuffers.push(...splatBuffers);
    allSplatBufferOptions.push(...splatBufferOptions);

    if (this.renderer) this.splatMesh.setRenderer(this.renderer);

    const onSplatTreeIndexesUpload = (finished: boolean): void => {
      if (this.isDisposingOrDisposed()) return;
      const splatCount = this.splatMesh.getSplatCount();
      if (
        showLoadingUIForSplatTreeBuild &&
        splatCount >= MIN_SPLAT_COUNT_TO_SHOW_SPLAT_TREE_LOADING_SPINNER
      ) {
        if (!finished && !splatOptimizingTaskId) {
          this.loadingSpinner.setMinimized(true, true);
          splatOptimizingTaskId = this.loadingSpinner.addTask(
            "Optimizing data structures..."
          );
        }
      }
    };

    const onSplatTreeReady = (finished: boolean): void => {
      if (this.isDisposingOrDisposed()) return;
      if (finished && splatOptimizingTaskId) {
        this.loadingSpinner.removeTask(splatOptimizingTaskId);
        splatOptimizingTaskId = null;
      }
    };

    const buildResults = this.splatMesh.build(
      allSplatBuffers,
      allSplatBufferOptions,
      true,
      finalBuild,
      onSplatTreeIndexesUpload,
      onSplatTreeReady,
      preserveVisibleRegion
    );

    if (finalBuild && this.freeIntermediateSplatData)
      this.splatMesh.freeIntermediateSplatData();

    return buildResults;
  };

  /**
   * Set up the splat sorting web worker.
   * @param splatMesh SplatMesh instance that contains the splats to be sorted
   * @return Promise that resolves when the sort worker is set up
   */
  setupSortWorker = (splatMesh: any): Promise<void> => {
    if (this.isDisposingOrDisposed()) return Promise.resolve();
    return new Promise((resolve) => {
      const DistancesArrayType = this.integerBasedSort
        ? Int32Array
        : Float32Array;
      const splatCount = splatMesh.getSplatCount();
      const maxSplatCount = splatMesh.getMaxSplatCount();
      this.sortWorker = createSortWorker(
        maxSplatCount,
        this.sharedMemoryForWorkers,
        this.enableSIMDInSort,
        this.integerBasedSort,
        this.splatMesh.dynamicMode,
        this.splatSortDistanceMapPrecision
      );
      this.sortWorker.onmessage = (e: MessageEvent) => {
        if (e.data.sortDone) {
          this.sortRunning = false;
          if (this.sharedMemoryForWorkers) {
            this.splatMesh.updateRenderIndexes(
              this.sortWorkerSortedIndexes,
              e.data.splatRenderCount
            );
          } else {
            const sortedIndexes = new Uint32Array(
              e.data.sortedIndexes.buffer,
              0,
              e.data.splatRenderCount
            );
            this.splatMesh.updateRenderIndexes(
              sortedIndexes,
              e.data.splatRenderCount
            );
          }

          this.lastSplatSortCount = this.splatSortCount;

          this.lastSortTime = e.data.sortTime;
          if (this.sortPromiseResolver) {
            this.sortPromiseResolver();
            this.sortPromiseResolver = null;
          }
          this.forceRenderNextFrame();
          if (this.runAfterNextSort.length > 0) {
            this.runAfterNextSort.forEach((func) => {
              func();
            });
            this.runAfterNextSort.length = 0;
          }
        } else if (e.data.sortCanceled) {
          this.sortRunning = false;
        } else if (e.data.sortSetupPhase1Complete) {
          if (this.logLevel >= LogLevel.Info)
            console.log("Sorting web worker WASM setup complete.");
          if (this.sharedMemoryForWorkers) {
            this.sortWorkerSortedIndexes = new Uint32Array(
              e.data.sortedIndexesBuffer,
              e.data.sortedIndexesOffset,
              maxSplatCount
            );
            this.sortWorkerIndexesToSort = new Uint32Array(
              e.data.indexesToSortBuffer,
              e.data.indexesToSortOffset,
              maxSplatCount
            );
            this.sortWorkerPrecomputedDistances = new DistancesArrayType(
              e.data.precomputedDistancesBuffer,
              e.data.precomputedDistancesOffset,
              maxSplatCount
            );
            this.sortWorkerTransforms = new Float32Array(
              e.data.transformsBuffer,
              e.data.transformsOffset,
              Constants.MaxScenes * 16
            );
          } else {
            this.sortWorkerIndexesToSort = new Uint32Array(maxSplatCount);
            this.sortWorkerPrecomputedDistances = new DistancesArrayType(
              maxSplatCount
            );
            this.sortWorkerTransforms = new Float32Array(
              Constants.MaxScenes * 16
            );
          }
          for (let i = 0; i < splatCount; i++)
            this.sortWorkerIndexesToSort[i] = i;
          this.sortWorker.maxSplatCount = maxSplatCount;

          if (this.logLevel >= LogLevel.Info) {
            console.log("Sorting web worker ready.");
            const splatDataTextures = this.splatMesh.getSplatDataTextures();
            const covariancesTextureSize = splatDataTextures.covariances.size;
            const centersColorsTextureSize =
              splatDataTextures.centerColors.size;
            console.log(
              "Covariances texture size: " +
                covariancesTextureSize.x +
                " x " +
                covariancesTextureSize.y
            );
            console.log(
              "Centers/colors texture size: " +
                centersColorsTextureSize.x +
                " x " +
                centersColorsTextureSize.y
            );
          }

          resolve();
        }
      };
    });
  };

  updateError(error: any, defaultMessage: string | null): Error {
    if (error instanceof AbortedPromiseError) return error;
    if (error instanceof DirectLoadError) {
      return new Error(
        "File type or server does not support progressive loading."
      );
    }
    return defaultMessage ? new Error(defaultMessage) : error;
  }

  disposeSortWorker() {
    if (this.sortWorker) this.sortWorker.terminate();
    this.sortWorker = null;
    this.sortPromise = null;
    if (this.sortPromiseResolver) {
      this.sortPromiseResolver();
      this.sortPromiseResolver = null;
    }
    this.preSortMessages = [];
    this.sortRunning = false;
  }

  /**
   * Remove a splat scene at the specified index
   * @param {number} indexToRemove Index of the splat scene to remove
   * @param {boolean} showLoadingUI Display loading UI during removal
   * @returns {Promise<void>} A promise that resolves when the scene is removed
   */
  removeSplatScene(
    indexToRemove: number,
    showLoadingUI: boolean = true
  ): Promise<void> {
    return this.removeSplatScenes([indexToRemove], showLoadingUI);
  }

  /**
   * Remove multiple splat scenes at the specified indices
   * @param {number[]} indexesToRemove Array of indices of splat scenes to remove
   * @param {boolean} showLoadingUI Display loading UI during removal
   * @returns {Promise<void>} A promise that resolves when the scenes are removed
   */
  removeSplatScenes(
    indexesToRemove: number[],
    showLoadingUI: boolean = true
  ): Promise<void> {
    if (this.isLoadingOrUnloading()) {
      throw new Error(
        "Cannot remove splat scene while another load or unload is already in progress."
      );
    }

    if (this.isDisposingOrDisposed()) {
      throw new Error("Cannot remove splat scene after dispose() is called.");
    }

    let sortPromise: Promise<any>;

    this.splatSceneRemovalPromise = new Promise<void>((resolve, reject) => {
      let removalTaskId: number | null = null;

      if (showLoadingUI) {
        this.loadingSpinner.removeAllTasks();
        this.loadingSpinner.show();
        removalTaskId = this.loadingSpinner.addTask("Removing splat scene...");
      }

      const checkAndHideLoadingUI = (): void => {
        if (showLoadingUI && removalTaskId !== null) {
          this.loadingSpinner.hide();
          this.loadingSpinner.removeTask(removalTaskId);
        }
      };

      const onDone = (error?: Error): void => {
        checkAndHideLoadingUI();
        this.splatSceneRemovalPromise = null;
        if (!error) resolve();
        else reject(error);
      };

      const checkForEarlyExit = (): boolean => {
        if (this.isDisposingOrDisposed()) {
          onDone();
          return true;
        }
        return false;
      };

      sortPromise = this.sortPromise || Promise.resolve();
      sortPromise.then(() => {
        if (checkForEarlyExit()) return;

        interface SceneTransformComponents {
          position: THREE.Vector3;
          quaternion: THREE.Quaternion;
          scale: THREE.Vector3;
        }

        const savedSplatBuffers: any[] = [];
        const savedSceneOptions: any[] = [];
        const savedSceneTransformComponents: SceneTransformComponents[] = [];

        for (let i = 0; i < this.splatMesh.scenes.length; i++) {
          let shouldRemove = false;
          for (let indexToRemove of indexesToRemove) {
            if (indexToRemove === i) {
              shouldRemove = true;
              break;
            }
          }
          if (!shouldRemove) {
            const scene = this.splatMesh.scenes[i];
            savedSplatBuffers.push(scene.splatBuffer);
            savedSceneOptions.push(this.splatMesh.sceneOptions[i]);
            savedSceneTransformComponents.push({
              position: scene.position.clone(),
              quaternion: scene.quaternion.clone(),
              scale: scene.scale.clone(),
            });
          }
        }
        this.disposeSortWorker();
        this.splatMesh.dispose();
        this.sceneRevealMode = SceneRevealMode.Instant;
        this.createSplatMesh();
        this.addSplatBuffers(
          savedSplatBuffers,
          savedSceneOptions,
          true,
          false,
          true,
          false,
          false
        )
          .then(() => {
            if (checkForEarlyExit()) return;
            checkAndHideLoadingUI();
            this.splatMesh.scenes.forEach((scene: any, index: number) => {
              scene.position.copy(
                savedSceneTransformComponents[index].position
              );
              scene.quaternion.copy(
                savedSceneTransformComponents[index].quaternion
              );
              scene.scale.copy(savedSceneTransformComponents[index].scale);
            });
            this.splatMesh.updateTransforms();
            this.splatRenderReady = false;

            this.runSplatSort(true).then(() => {
              if (checkForEarlyExit()) {
                this.splatRenderReady = true;
                return;
              }
              sortPromise = this.sortPromise || Promise.resolve();
              sortPromise.then(() => {
                this.splatRenderReady = true;
                onDone();
              });
            });
          })
          .catch((e: Error) => {
            onDone(e);
          });
      });
    });

    return this.splatSceneRemovalPromise;
  }

  /**
   * Start self-driven mode
   */
  start(): void {
    if (this.selfDrivenMode) {
      if (!this.renderer) {
        throw new Error("Cannot start viewer without a renderer.");
      }

      if (this.webXRMode) {
        this.renderer.setAnimationLoop(this.selfDrivenUpdateFunc);
      } else {
        this.requestFrameId = requestAnimationFrame(this.selfDrivenUpdateFunc);
      }
      this.selfDrivenModeRunning = true;
    } else {
      throw new Error("Cannot start viewer unless it is in self driven mode.");
    }
  }

  /**
   * Stop self-driven mode
   */
  stop(): void {
    if (this.selfDrivenMode && this.selfDrivenModeRunning) {
      if (this.webXRMode && this.renderer) {
        this.renderer.setAnimationLoop(null);
      } else if (this.requestFrameId !== undefined) {
        cancelAnimationFrame(this.requestFrameId);
      }
      this.selfDrivenModeRunning = false;
    }
  }

  /**
   * Dispose of all resources held directly and indirectly by this viewer.
   * @returns A promise that resolves when the disposal is complete
   */
  async dispose(): Promise<void> {
    if (this.isDisposingOrDisposed()) return this.disposePromise;

    const waitPromises: Promise<any>[] = [];
    const promisesToAbort: AbortablePromise<any>[] = [];
    for (let promiseKey in this.splatSceneDownloadPromises) {
      if (this.splatSceneDownloadPromises.hasOwnProperty(promiseKey)) {
        const downloadPromiseToAbort =
          this.splatSceneDownloadPromises[promiseKey];
        promisesToAbort.push(downloadPromiseToAbort);
        waitPromises.push(downloadPromiseToAbort.promise);
      }
    }
    if (this.sortPromise) {
      waitPromises.push(this.sortPromise);
    }

    this.disposing = true;
    this.disposePromise = Promise.all(waitPromises).finally(() => {
      this.stop();
      if (this.orthographicControls) {
        this.orthographicControls.dispose();
        this.orthographicControls = null;
      }
      if (this.perspectiveControls) {
        this.perspectiveControls.dispose();
        this.perspectiveControls = null;
      }
      this.controls = null;
      if (this.splatMesh) {
        this.splatMesh.dispose();
        this.splatMesh = null;
      }
      if (this.sceneHelper) {
        this.sceneHelper.dispose();
        this.sceneHelper = null;
      }
      if (this.resizeObserver && this.rootElement) {
        this.resizeObserver.unobserve(this.rootElement);
        this.resizeObserver = null;
      }
      this.disposeSortWorker();
      this.removeEventHandlers();

      this.loadingSpinner.removeAllTasks();
      this.loadingSpinner.setContainer(null);
      this.loadingProgressBar.hide();
      this.loadingProgressBar.setContainer(null);
      this.infoPanel.setContainer(null);

      this.camera = null;
      this.threeScene = null;
      this.splatRenderReady = false;
      this.initialized = false;
      if (this.renderer) {
        if (!this.usingExternalRenderer && this.rootElement) {
          this.rootElement.removeChild(this.renderer.domElement);
          this.renderer.dispose();
        }
        this.renderer = null;
      }

      if (!this.usingExternalRenderer && this.rootElement) {
        if (this.rootElement.parentNode) {
          this.rootElement.parentNode.removeChild(this.rootElement);
        }
      }

      this.sortWorkerSortedIndexes = null;
      this.sortWorkerIndexesToSort = null;
      this.sortWorkerPrecomputedDistances = null;
      this.sortWorkerTransforms = null;
      this.disposed = true;
      this.disposing = false;
      this.disposePromise = null;
    });
    promisesToAbort.forEach((toAbort) => {
      toAbort.abort("Scene disposed");
    });
    return this.disposePromise;
  }

  /**
   * Self-driven update method that manages the animation loop
   */
  selfDrivenUpdate(): void {
    if (this.selfDrivenMode && !this.webXRMode) {
      this.requestFrameId = requestAnimationFrame(this.selfDrivenUpdateFunc);
    }
    this.update(this.renderer, this.camera);
    if (this.shouldRender()) {
      this.render();
      this.consecutiveRenderFrames++;
    } else {
      this.consecutiveRenderFrames = 0;
    }
    this.renderNextFrame = false;
  }

  forceRenderNextFrame(): void {
    this.renderNextFrame = true;
  }

  shouldRender = (() => {
    let renderCount = 0;
    const lastCameraPosition = new THREE.Vector3();
    const lastCameraOrientation = new THREE.Quaternion();
    const changeEpsilon = 0.0001;

    return (): boolean => {
      if (
        !this.initialized ||
        !this.splatRenderReady ||
        this.isDisposingOrDisposed()
      )
        return false;

      let shouldRender = false;
      let cameraChanged = false;
      if (this.camera) {
        const cp = this.camera.position;
        const co = this.camera.quaternion;
        cameraChanged =
          Math.abs(cp.x - lastCameraPosition.x) > changeEpsilon ||
          Math.abs(cp.y - lastCameraPosition.y) > changeEpsilon ||
          Math.abs(cp.z - lastCameraPosition.z) > changeEpsilon ||
          Math.abs(co.x - lastCameraOrientation.x) > changeEpsilon ||
          Math.abs(co.y - lastCameraOrientation.y) > changeEpsilon ||
          Math.abs(co.z - lastCameraOrientation.z) > changeEpsilon ||
          Math.abs(co.w - lastCameraOrientation.w) > changeEpsilon;
      }

      shouldRender =
        this.renderMode !== RenderMode.Never &&
        (renderCount === 0 ||
          (this.splatMesh && this.splatMesh.visibleRegionChanging) ||
          cameraChanged ||
          this.renderMode === RenderMode.Always ||
          this.dynamicScene === true ||
          this.renderNextFrame);

      if (this.camera) {
        lastCameraPosition.copy(this.camera.position);
        lastCameraOrientation.copy(this.camera.quaternion);
      }

      renderCount++;
      return shouldRender;
    };
  })();

  render = (() => {
    return (): void => {
      if (
        !this.initialized ||
        !this.splatRenderReady ||
        this.isDisposingOrDisposed() ||
        !this.renderer ||
        !this.camera
      )
        return;

      const hasRenderables = (threeScene: THREE.Scene): boolean => {
        for (let child of threeScene.children) {
          if (child.visible) return true;
        }
        return false;
      };

      const savedAutoClear = this.renderer.autoClear;

      if (this.threeScene && hasRenderables(this.threeScene)) {
        this.renderer.render(this.threeScene, this.camera);
        this.renderer.autoClear = false;
      }

      this.renderer.render(this.splatMesh, this.camera);
      this.renderer.autoClear = false;

      if (
        this.sceneHelper &&
        this.sceneHelper.getFocusMarkerOpacity &&
        this.sceneHelper.getFocusMarkerOpacity() > 0.0
      ) {
        this.renderer.render(this.sceneHelper.focusMarker, this.camera);
      }

      if (
        this.showControlPlane &&
        this.sceneHelper &&
        this.sceneHelper.controlPlane
      ) {
        this.renderer.render(this.sceneHelper.controlPlane, this.camera);
      }

      this.renderer.autoClear = savedAutoClear;
    };
  })();

  /**
   * Update the viewer state
   * @param renderer The renderer to use (optional, uses this.renderer if not provided)
   * @param camera The camera to use (optional, uses this.camera if not provided)
   */
  update(
    renderer?: THREE.WebGLRenderer | null,
    camera?: THREE.Camera | null
  ): void {
    if (this.dropInMode && renderer && camera) {
      this.updateForDropInMode(renderer, camera);
    }

    if (
      !this.initialized ||
      !this.splatRenderReady ||
      this.isDisposingOrDisposed()
    )
      return;

    if (this.controls) {
      this.controls.update();
      const currentCamera = camera || this.camera;
      if (
        currentCamera &&
        "isOrthographicCamera" in currentCamera &&
        currentCamera.isOrthographicCamera &&
        !this.usingExternalCamera
      ) {
        // The camera is an OrthographicCamera, so we can safely cast it
        if (
          currentCamera instanceof THREE.OrthographicCamera &&
          this.perspectiveCamera
        ) {
          Viewer.setCameraPositionFromZoom(
            this.perspectiveCamera,
            currentCamera,
            this.controls
          );
        }
      }
    }
    this.runSplatSort();
    this.updateForRendererSizeChanges();
    this.updateSplatMesh();
    this.updateMeshCursor();
    this.updateFPS();
    this.timingSensitiveUpdates();
    this.updateInfoPanel();
    this.updateControlPlane();
  }

  /**
   * Update the viewer for drop-in mode
   * @param renderer The renderer to use
   * @param camera The camera to use
   */
  updateForDropInMode(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera
  ): void {
    this.renderer = renderer;
    if (this.splatMesh) this.splatMesh.setRenderer(this.renderer);
    this.camera = camera;
    if (this.controls) this.controls.object = camera;
    this.init();
  }

  updateFPS = (() => {
    let lastCalcTime = getCurrentTime();
    let frameCount = 0;

    return (): void => {
      if (
        this.consecutiveRenderFrames >
        CONSECUTIVE_RENDERED_FRAMES_FOR_FPS_CALCULATION
      ) {
        const currentTime = getCurrentTime();
        const calcDelta = currentTime - lastCalcTime;
        if (calcDelta >= 1.0) {
          this.currentFPS = frameCount;
          frameCount = 0;
          lastCalcTime = currentTime;
        } else {
          frameCount++;
        }
      } else {
        this.currentFPS = null;
      }
    };
  })();

  updateForRendererSizeChanges = (() => {
    const lastRendererSize = new THREE.Vector2();
    const currentRendererSize = new THREE.Vector2();
    let lastCameraOrthographic: boolean | undefined;

    return (): void => {
      if (!this.usingExternalCamera && this.renderer && this.camera) {
        this.renderer.getSize(currentRendererSize);
        if (
          lastCameraOrthographic === undefined ||
          lastCameraOrthographic !==
            this.camera instanceof THREE.OrthographicCamera ||
          currentRendererSize.x !== lastRendererSize.x ||
          currentRendererSize.y !== lastRendererSize.y
        ) {
          if (this.camera instanceof THREE.OrthographicCamera) {
            this.camera.left = -currentRendererSize.x / 2.0;
            this.camera.right = currentRendererSize.x / 2.0;
            this.camera.top = currentRendererSize.y / 2.0;
            this.camera.bottom = -currentRendererSize.y / 2.0;
            this.camera.updateProjectionMatrix();
          } else if (this.camera instanceof THREE.PerspectiveCamera) {
            this.camera.aspect = currentRendererSize.x / currentRendererSize.y;
            this.camera.updateProjectionMatrix();
          }
          lastRendererSize.copy(currentRendererSize);
          lastCameraOrthographic =
            this.camera instanceof THREE.OrthographicCamera;
        }
      }
    };
  })();

  timingSensitiveUpdates = (() => {
    let lastUpdateTime: number | null = null;

    return (): void => {
      const currentTime = getCurrentTime();
      if (!lastUpdateTime) lastUpdateTime = currentTime;
      const timeDelta = currentTime - lastUpdateTime;

      this.updateCameraTransition(currentTime);
      this.updateFocusMarker(timeDelta);

      lastUpdateTime = currentTime;
    };
  })();

  updateCameraTransition = (() => {
    const tempCameraTarget = new THREE.Vector3();
    const toPreviousTarget = new THREE.Vector3();
    const toNextTarget = new THREE.Vector3();

    return (currentTime: number): void => {
      if (this.transitioningCameraTarget && this.camera && this.controls) {
        toPreviousTarget
          .copy(this.previousCameraTarget)
          .sub(this.camera.position)
          .normalize();
        toNextTarget
          .copy(this.nextCameraTarget)
          .sub(this.camera.position)
          .normalize();
        const rotationAngle = Math.acos(toPreviousTarget.dot(toNextTarget));
        const rotationSpeed = (rotationAngle / (Math.PI / 3)) * 0.65 + 0.3;
        const t =
          (rotationSpeed / rotationAngle) *
          (currentTime - (this.transitioningCameraTargetStartTime || 0));
        tempCameraTarget
          .copy(this.previousCameraTarget)
          .lerp(this.nextCameraTarget, t);
        this.camera.lookAt(tempCameraTarget);
        this.controls.target.copy(tempCameraTarget);
        if (t >= 1.0) {
          this.transitioningCameraTarget = false;
        }
      }
    };
  })();

  updateFocusMarker = (() => {
    const renderDimensions = new THREE.Vector2();
    let wasTransitioning = false;

    return (timeDelta: number): void => {
      if (!this.sceneHelper || !this.camera) return;

      this.getRenderDimensions(renderDimensions);
      if (this.transitioningCameraTarget) {
        this.sceneHelper.setFocusMarkerVisibility(true);
        const currentFocusMarkerOpacity = Math.max(
          this.sceneHelper.getFocusMarkerOpacity(),
          0.0
        );
        const newFocusMarkerOpacity = Math.min(
          currentFocusMarkerOpacity + FOCUS_MARKER_FADE_IN_SPEED * timeDelta,
          1.0
        );
        this.sceneHelper.setFocusMarkerOpacity(newFocusMarkerOpacity);
        this.sceneHelper.updateFocusMarker(
          this.nextCameraTarget,
          this.camera,
          renderDimensions
        );
        wasTransitioning = true;
        this.forceRenderNextFrame();
      } else {
        let currentFocusMarkerOpacity: number;
        if (wasTransitioning) currentFocusMarkerOpacity = 1.0;
        else
          currentFocusMarkerOpacity = Math.min(
            this.sceneHelper.getFocusMarkerOpacity(),
            1.0
          );
        if (currentFocusMarkerOpacity > 0) {
          this.sceneHelper.updateFocusMarker(
            this.nextCameraTarget,
            this.camera,
            renderDimensions
          );
          const newFocusMarkerOpacity = Math.max(
            currentFocusMarkerOpacity - FOCUS_MARKER_FADE_OUT_SPEED * timeDelta,
            0.0
          );
          this.sceneHelper.setFocusMarkerOpacity(newFocusMarkerOpacity);
          if (newFocusMarkerOpacity === 0.0)
            this.sceneHelper.setFocusMarkerVisibility(false);
        }
        if (currentFocusMarkerOpacity > 0.0) this.forceRenderNextFrame();
        wasTransitioning = false;
      }
    };
  })();

  updateMeshCursor = (() => {
    const outHits: any[] = [];
    const renderDimensions = new THREE.Vector2();

    return (): void => {
      if (!this.showMeshCursor || !this.sceneHelper || !this.camera) return;

      this.forceRenderNextFrame();
      this.getRenderDimensions(renderDimensions);
      outHits.length = 0;

      // Only call this method with a perspective or orthographic camera
      if (
        this.camera instanceof THREE.PerspectiveCamera ||
        this.camera instanceof THREE.OrthographicCamera
      ) {
        this.raycaster.setFromCameraAndScreenPosition(
          this.camera,
          this.mousePosition,
          renderDimensions
        );
        this.raycaster.intersectSplatMesh(this.splatMesh, outHits);
        if (outHits.length > 0) {
          this.sceneHelper.setMeshCursorVisibility(true);
          this.sceneHelper.positionAndOrientMeshCursor(
            outHits[0].origin,
            this.camera
          );
        } else {
          this.sceneHelper.setMeshCursorVisibility(false);
        }
      }
    };
  })();

  updateInfoPanel = (() => {
    const renderDimensions = new THREE.Vector2();

    return (): void => {
      if (!this.showInfo || !this.infoPanel || !this.camera || !this.splatMesh)
        return;

      const splatCount = this.splatMesh.getSplatCount();
      this.getRenderDimensions(renderDimensions);
      const cameraLookAtPosition = this.controls ? this.controls.target : null;
      const meshCursorPosition =
        this.showMeshCursor && this.sceneHelper && this.sceneHelper.meshCursor
          ? this.sceneHelper.meshCursor.position
          : null;
      const splatRenderCountPct =
        splatCount > 0 ? (this.splatRenderCount / splatCount) * 100 : 0;

      const isOrthographicCamera =
        this.camera instanceof THREE.OrthographicCamera;

      this.infoPanel.update(
        renderDimensions,
        this.camera.position,
        cameraLookAtPosition,
        this.camera.up,
        isOrthographicCamera,
        meshCursorPosition,
        this.currentFPS || "N/A",
        splatCount,
        this.splatRenderCount,
        splatRenderCountPct,
        this.lastSortTime,
        this.focalAdjustment,
        this.splatMesh.getSplatScale(),
        this.splatMesh.getPointCloudModeEnabled()
      );
    };
  })();

  updateControlPlane(): void {
    if (!this.sceneHelper) return;

    if (this.showControlPlane && this.controls && this.camera) {
      this.sceneHelper.setControlPlaneVisibility(true);
      this.sceneHelper.positionAndOrientControlPlane(
        this.controls.target,
        this.camera.up
      );
    } else {
      this.sceneHelper.setControlPlaneVisibility(false);
    }
  }

  runSplatSort = (() => {
    const mvpMatrix = new THREE.Matrix4();
    const cameraPositionArray: number[] = [];
    const lastSortViewDir = new THREE.Vector3(0, 0, -1);
    const sortViewDir = new THREE.Vector3(0, 0, -1);
    const lastSortViewPos = new THREE.Vector3();
    const sortViewOffset = new THREE.Vector3();
    const queuedSorts: number[] = [];

    interface PartialSort {
      angleThreshold: number;
      sortFractions: number[];
    }

    const partialSorts: PartialSort[] = [
      {
        angleThreshold: 0.55,
        sortFractions: [0.125, 0.33333, 0.75],
      },
      {
        angleThreshold: 0.65,
        sortFractions: [0.33333, 0.66667],
      },
      {
        angleThreshold: 0.8,
        sortFractions: [0.5],
      },
    ];

    return (force = false, forceSortAll = false): Promise<boolean> => {
      if (!this.initialized) return Promise.resolve(false);
      if (this.sortRunning) return Promise.resolve(true);
      if (!this.splatMesh || !this.camera) return Promise.resolve(false);
      if (this.splatMesh.getSplatCount() <= 0) {
        this.splatRenderCount = 0;
        return Promise.resolve(false);
      }

      let angleDiff = 0;
      let positionDiff = 0;
      let needsRefreshForRotation = false;
      let needsRefreshForPosition = false;

      sortViewDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      angleDiff = sortViewDir.dot(lastSortViewDir);
      positionDiff = sortViewOffset
        .copy(this.camera.position)
        .sub(lastSortViewPos)
        .length();

      if (!force) {
        if (!this.splatMesh.dynamicMode && queuedSorts.length === 0) {
          if (angleDiff <= 0.99) needsRefreshForRotation = true;
          if (positionDiff >= 1.0) needsRefreshForPosition = true;
          if (!needsRefreshForRotation && !needsRefreshForPosition)
            return Promise.resolve(false);
        }
      }

      this.sortRunning = true;

      const result = this.gatherSceneNodesForSort();
      let splatRenderCount = 0;
      let shouldSortAll = false;

      if (result) {
        splatRenderCount = result.splatRenderCount || 0;
        shouldSortAll = !!result.shouldSortAll;
      }

      shouldSortAll = shouldSortAll || forceSortAll;
      this.splatRenderCount = splatRenderCount;

      mvpMatrix.copy(this.camera.matrixWorld).invert();
      const mvpCamera = this.perspectiveCamera || this.camera;
      mvpMatrix.premultiply(mvpCamera.projectionMatrix);
      if (!this.splatMesh.dynamicMode)
        mvpMatrix.multiply(this.splatMesh.matrixWorld);

      let gpuAcceleratedSortPromise: Promise<boolean> = Promise.resolve(true);
      if (
        this.gpuAcceleratedSort &&
        this.sortWorkerPrecomputedDistances &&
        (queuedSorts.length <= 1 || queuedSorts.length % 2 === 0)
      ) {
        gpuAcceleratedSortPromise = this.splatMesh.computeDistancesOnGPU(
          mvpMatrix,
          this.sortWorkerPrecomputedDistances
        );
      }

      gpuAcceleratedSortPromise.then(() => {
        if (!this.camera || !this.splatMesh || !this.sortWorker) return true;

        if (queuedSorts.length === 0) {
          if (this.splatMesh.dynamicMode || shouldSortAll) {
            queuedSorts.push(this.splatRenderCount);
          } else {
            for (const partialSort of partialSorts) {
              if (angleDiff < partialSort.angleThreshold) {
                for (const sortFraction of partialSort.sortFractions) {
                  queuedSorts.push(
                    Math.floor(this.splatRenderCount * sortFraction)
                  );
                }
                break;
              }
            }
            queuedSorts.push(this.splatRenderCount);
          }
        }
        const sortCount = Math.min(
          queuedSorts.shift() || 0,
          this.splatRenderCount
        );
        this.splatSortCount = sortCount;

        cameraPositionArray[0] = this.camera.position.x;
        cameraPositionArray[1] = this.camera.position.y;
        cameraPositionArray[2] = this.camera.position.z;

        // TypeScript doesn't know about these custom properties, so we use a more generic type
        const sortMessage: any = {
          modelViewProj: Array.from(mvpMatrix.elements),
          cameraPosition: cameraPositionArray,
          splatRenderCount: this.splatRenderCount,
          splatSortCount: sortCount,
          usePrecomputedDistances: this.gpuAcceleratedSort,
        };

        if (this.splatMesh.dynamicMode && this.sortWorkerTransforms) {
          this.splatMesh.fillTransformsArray(this.sortWorkerTransforms);
        }

        if (!this.sharedMemoryForWorkers) {
          if (this.sortWorkerIndexesToSort) {
            sortMessage.indexesToSort = this.sortWorkerIndexesToSort;
          }
          if (this.sortWorkerTransforms) {
            sortMessage.transforms = this.sortWorkerTransforms;
          }
          if (this.gpuAcceleratedSort && this.sortWorkerPrecomputedDistances) {
            sortMessage.precomputedDistances =
              this.sortWorkerPrecomputedDistances;
          }
        }

        this.sortPromise = new Promise((resolve) => {
          this.sortPromiseResolver = resolve;
        });

        if (this.preSortMessages.length > 0) {
          this.preSortMessages.forEach((message: any) => {
            if (this.sortWorker) {
              this.sortWorker.postMessage(message);
            }
          });
          this.preSortMessages = [];
        }

        this.sortWorker.postMessage({
          sort: sortMessage,
        });

        if (queuedSorts.length === 0) {
          lastSortViewPos.copy(this.camera.position);
          lastSortViewDir.copy(sortViewDir);
        }

        return true;
      });

      return gpuAcceleratedSortPromise;
    };
  })();

  /**
   * Determine which splats to render by checking which are inside or close to the view frustum
   */
  gatherSceneNodesForSort = (() => {
    const nodeRenderList: any[] = [];
    let allSplatsSortBuffer: Uint32Array | null = null;
    const tempVectorYZ = new THREE.Vector3();
    const tempVectorXZ = new THREE.Vector3();
    const tempVector = new THREE.Vector3();
    const modelView = new THREE.Matrix4();
    const baseModelView = new THREE.Matrix4();
    const sceneTransform = new THREE.Matrix4();
    const renderDimensions = new THREE.Vector2();
    const forward = new THREE.Vector3(0, 0, -1);

    const tempMax = new THREE.Vector3();
    const nodeSize = (node: any): number => {
      return tempMax.copy(node.max).sub(node.min).length();
    };

    return (
      gatherAllNodes = false
    ): { splatRenderCount: number; shouldSortAll: boolean } | null => {
      if (!this.camera || !this.splatMesh || !this.sortWorkerIndexesToSort) {
        return null;
      }

      this.getRenderDimensions(renderDimensions);

      // Only continue if we have a perspective camera
      if (!(this.camera instanceof THREE.PerspectiveCamera)) {
        return {
          splatRenderCount: 0,
          shouldSortAll: false,
        };
      }

      const cameraFocalLength =
        renderDimensions.y /
        2.0 /
        Math.tan((this.camera.fov / 2.0) * THREE.MathUtils.DEG2RAD);
      const fovXOver2 = Math.atan(renderDimensions.x / 2.0 / cameraFocalLength);
      const fovYOver2 = Math.atan(renderDimensions.y / 2.0 / cameraFocalLength);
      const cosFovXOver2 = Math.cos(fovXOver2);
      const cosFovYOver2 = Math.cos(fovYOver2);

      const splatTree = this.splatMesh.getSplatTree();

      if (splatTree) {
        baseModelView.copy(this.camera.matrixWorld).invert();
        if (!this.splatMesh.dynamicMode)
          baseModelView.multiply(this.splatMesh.matrixWorld);

        let nodeRenderCount = 0;
        let splatRenderCount = 0;

        for (let s = 0; s < splatTree.subTrees.length; s++) {
          const subTree = splatTree.subTrees[s];
          modelView.copy(baseModelView);
          if (this.splatMesh.dynamicMode) {
            this.splatMesh.getSceneTransform(s, sceneTransform);
            modelView.multiply(sceneTransform);
          }
          const nodeCount = subTree.nodesWithIndexes.length;
          for (let i = 0; i < nodeCount; i++) {
            const node = subTree.nodesWithIndexes[i];
            if (
              !node.data ||
              !node.data.indexes ||
              node.data.indexes.length === 0
            )
              continue;
            tempVector.copy(node.center).applyMatrix4(modelView);

            const distanceToNode = tempVector.length();
            tempVector.normalize();

            tempVectorYZ.copy(tempVector).setX(0).normalize();
            tempVectorXZ.copy(tempVector).setY(0).normalize();

            const cameraAngleXZDot = forward.dot(tempVectorXZ);
            const cameraAngleYZDot = forward.dot(tempVectorYZ);

            const ns = nodeSize(node);
            const outOfFovY = cameraAngleYZDot < cosFovYOver2 - 0.6;
            const outOfFovX = cameraAngleXZDot < cosFovXOver2 - 0.6;
            if (
              !gatherAllNodes &&
              (outOfFovX || outOfFovY) &&
              distanceToNode > ns
            ) {
              continue;
            }
            splatRenderCount += node.data.indexes.length;
            nodeRenderList[nodeRenderCount] = node;
            node.data.distanceToNode = distanceToNode;
            nodeRenderCount++;
          }
        }

        nodeRenderList.length = nodeRenderCount;
        nodeRenderList.sort((a, b) => {
          if (a.data.distanceToNode < b.data.distanceToNode) return -1;
          else return 1;
        });

        let currentByteOffset = splatRenderCount * Constants.BytesPerInt;
        for (let i = 0; i < nodeRenderCount; i++) {
          const node = nodeRenderList[i];
          const windowSizeInts = node.data.indexes.length;
          const windowSizeBytes = windowSizeInts * Constants.BytesPerInt;
          const destView = new Uint32Array(
            this.sortWorkerIndexesToSort.buffer,
            currentByteOffset - windowSizeBytes,
            windowSizeInts
          );
          destView.set(node.data.indexes);
          currentByteOffset -= windowSizeBytes;
        }

        return {
          splatRenderCount: splatRenderCount,
          shouldSortAll: false,
        };
      } else {
        const totalSplatCount = this.splatMesh.getSplatCount();
        if (
          !allSplatsSortBuffer ||
          allSplatsSortBuffer.length !== totalSplatCount
        ) {
          allSplatsSortBuffer = new Uint32Array(totalSplatCount);
          for (let i = 0; i < totalSplatCount; i++) {
            allSplatsSortBuffer[i] = i;
          }
        }
        if (this.sortWorkerIndexesToSort && allSplatsSortBuffer) {
          this.sortWorkerIndexesToSort.set(allSplatsSortBuffer);
        }
        return {
          splatRenderCount: totalSplatCount,
          shouldSortAll: true,
        };
      }
    };
  })();

  getSplatMesh() {
    return this.splatMesh;
  }

  /**
   * Get a reference to a splat scene.
   * @param {number} sceneIndex The index of the scene to which the reference will be returned
   * @return {SplatScene}
   */
  getSplatScene(sceneIndex: number) {
    return this.splatMesh.getScene(sceneIndex);
  }

  getSceneCount() {
    return this.splatMesh.getSceneCount();
  }

  isMobile() {
    return navigator.userAgent.includes("Mobi");
  }
}
