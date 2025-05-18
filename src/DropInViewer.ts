import * as THREE from "three";
import { Viewer } from "./Viewer.js";
import { AbortablePromise } from "./AbortablePromise.js";

/**
 * Options for DropInViewer that match the requirements of Viewer
 */
interface DropInViewerOptions {
  selfDrivenMode?: boolean;
  useBuiltInControls?: boolean;
  rootElement?: HTMLElement;
  dropInMode?: boolean;
  camera?: THREE.Camera;
  renderer?: THREE.WebGLRenderer;
  // Include other options that might be needed
  [key: string]: any;
}

/**
 * DropInViewer: Wrapper for a Viewer instance that enables it to be added to a Three.js scene like
 * any other Three.js scene object (Mesh, Object3D, etc.)
 */
export class DropInViewer extends THREE.Group {
  private viewer: Viewer;
  private splatMesh: THREE.Object3D | null;
  private callbackMesh: THREE.Mesh;

  constructor(options: DropInViewerOptions = {}) {
    super();

    // Set required options for drop-in mode
    options.selfDrivenMode = false;
    options.useBuiltInControls = false;
    options.rootElement = undefined;
    options.dropInMode = true;
    options.camera = undefined;
    options.renderer = undefined;

    this.viewer = new Viewer(options);
    this.splatMesh = null;
    this.updateSplatMesh();

    this.callbackMesh = DropInViewer.createCallbackMesh();
    this.add(this.callbackMesh);
    this.callbackMesh.onBeforeRender = DropInViewer.onBeforeRender.bind(
      this,
      this.viewer
    );

    this.viewer.onSplatMeshChanged(() => {
      this.updateSplatMesh();
    });
  }

  updateSplatMesh(): void {
    if (this.splatMesh !== this.viewer.getSplatMesh()) {
      if (this.splatMesh) {
        this.remove(this.splatMesh);
      }
      this.splatMesh = this.viewer.getSplatMesh();
      if (this.splatMesh) {
        this.add(this.splatMesh);
      }
    }
  }

  /**
   * Add a single splat scene to the viewer.
   * @param path Path to splat scene to be loaded
   * @param options {
   *         splatAlphaRemovalThreshold: Ignore any splats with an alpha less than the specified
   *                                     value (valid range: 0 - 255), defaults to 1
   *
   *         showLoadingUI:         Display a loading spinner while the scene is loading, defaults to true
   *
   *         position (Array<number>):   Position of the scene, acts as an offset from its default position, defaults to [0, 0, 0]
   *
   *         rotation (Array<number>):   Rotation of the scene represented as a quaternion, defaults to [0, 0, 0, 1]
   *
   *         scale (Array<number>):      Scene's scale, defaults to [1, 1, 1]
   *
   *         onProgress:                 Function to be called as file data are received
   * }
   * @returns A promise that resolves when the scene is loaded
   */
  addSplatScene(path: string, options: any = {}): AbortablePromise<any> {
    if (options.showLoadingUI !== false) options.showLoadingUI = true;
    return this.viewer.addSplatScene(path, options);
  }

  /**
   * Add multiple splat scenes to the viewer.
   * @param sceneOptions Array of per-scene options: {
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
   * }
   * @param showLoadingUI Display a loading spinner while the scene is loading, defaults to true
   * @returns A promise that resolves when the scenes are loaded
   */
  addSplatScenes(
    sceneOptions: any[],
    showLoadingUI?: boolean
  ): AbortablePromise<any> {
    if (showLoadingUI !== false) showLoadingUI = true;
    return this.viewer.addSplatScenes(sceneOptions, showLoadingUI);
  }

  /**
   * Get a reference to a splat scene.
   * @param sceneIndex The index of the scene to which the reference will be returned
   * @returns The splat scene
   */
  getSplatScene(sceneIndex: number): any {
    return this.viewer.getSplatScene(sceneIndex);
  }

  /**
   * Remove a splat scene at the specified index
   * @param index Index of the splat scene to remove
   * @param showLoadingUI Display loading UI during removal
   * @returns A promise that resolves when the scene is removed
   */
  removeSplatScene(
    index: number,
    showLoadingUI: boolean = true
  ): Promise<void> {
    return this.viewer.removeSplatScene(index, showLoadingUI);
  }

  /**
   * Remove multiple splat scenes at the specified indices
   * @param indexes Array of indices of splat scenes to remove
   * @param showLoadingUI Display loading UI during removal
   * @returns A promise that resolves when the scenes are removed
   */
  removeSplatScenes(
    indexes: number[],
    showLoadingUI: boolean = true
  ): Promise<void> {
    return this.viewer.removeSplatScenes(indexes, showLoadingUI);
  }

  /**
   * Get the number of splat scenes
   * @returns The number of splat scenes
   */
  getSceneCount(): number {
    return this.viewer.getSceneCount();
  }

  /**
   * Set the active spherical harmonics degrees
   * @param activeSphericalHarmonicsDegrees The spherical harmonics degrees to use
   */
  setActiveSphericalHarmonicsDegrees(
    activeSphericalHarmonicsDegrees: number
  ): void {
    this.viewer.setActiveSphericalHarmonicsDegrees(
      activeSphericalHarmonicsDegrees
    );
  }

  /**
   * Dispose of all resources held directly and indirectly by this viewer.
   * @returns A promise that resolves when the disposal is complete
   */
  async dispose(): Promise<void> {
    return await this.viewer.dispose();
  }

  /**
   * Called before rendering to update the viewer
   * @param viewer The viewer to update
   * @param renderer The renderer being used
   * @param threeScene The Three.js scene being rendered
   * @param camera The camera being used
   */
  static onBeforeRender(
    viewer: Viewer,
    renderer: THREE.WebGLRenderer,
    threeScene: THREE.Scene,
    camera: THREE.Camera
  ): void {
    viewer.update(renderer, camera);
  }

  /**
   * Create a callback mesh that will trigger the onBeforeRender callback
   * @returns The callback mesh
   */
  static createCallbackMesh(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(1, 8, 8);
    const material = new THREE.MeshBasicMaterial();
    material.colorWrite = false;
    material.depthWrite = false;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }
}
