import * as THREE from "three";
import { Ray } from "./Ray";
import { Hit } from "./Hit";
import { SplatRenderMode } from "../SplatRenderMode";

/**
 * Interface for SplatTreeNode
 */
interface SplatTreeNode {
  boundingBox: THREE.Box3;
  data?: {
    indexes: number[];
  };
  children?: SplatTreeNode[];
}

/**
 * Interface for SplatTree
 */
interface SplatTree {
  subTrees: {
    rootNode?: SplatTreeNode;
  }[];
  splatMesh: {
    getSceneIndexForSplat: (globalIndex: number) => number;
    getScene: (sceneIndex: number) => { visible: boolean };
    getSplatColor: (globalIndex: number, outColor: THREE.Vector4) => void;
    getSplatCenter: (globalIndex: number, outCenter: THREE.Vector3) => void;
    getSplatScaleAndRotation: (
      globalIndex: number,
      outScale: THREE.Vector3,
      outRotation: THREE.Quaternion
    ) => void;
    splatRenderMode: SplatRenderMode;
    matrixWorld: THREE.Matrix4;
    dynamicMode: boolean;
    getSceneTransform: (sceneIndex: number, outMatrix: THREE.Matrix4) => void;
  };
}

/**
 * Interface for SplatMesh
 */
interface SplatMesh {
  getSplatTree: () => SplatTree | null;
  getSceneTransform: (sceneIndex: number, outMatrix: THREE.Matrix4) => void;
  dynamicMode: boolean;
  matrixWorld: THREE.Matrix4;
}

/**
 * Raycaster for gaussian splats
 */
export class Raycaster {
  ray: Ray;
  raycastAgainstTrueSplatEllipsoid: boolean;
  camera?: THREE.Camera;

  /**
   * Create a new raycaster
   * @param origin Ray origin
   * @param direction Ray direction
   * @param raycastAgainstTrueSplatEllipsoid Whether to raycast against true splat ellipsoid
   */
  constructor(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    raycastAgainstTrueSplatEllipsoid = false
  ) {
    this.ray = new Ray(origin, direction);
    this.raycastAgainstTrueSplatEllipsoid = raycastAgainstTrueSplatEllipsoid;
  }

  /**
   * Set raycaster from camera and screen position
   */
  setFromCameraAndScreenPosition = (function () {
    const ndcCoords = new THREE.Vector2();

    return function (
      this: Raycaster,
      camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
      screenPosition: THREE.Vector2,
      screenDimensions: THREE.Vector2
    ): void {
      ndcCoords.x = (screenPosition.x / screenDimensions.x) * 2.0 - 1.0;
      ndcCoords.y =
        ((screenDimensions.y - screenPosition.y) / screenDimensions.y) * 2.0 -
        1.0;

      if ("isPerspectiveCamera" in camera) {
        const perspCamera = camera as THREE.PerspectiveCamera;
        this.ray.origin.setFromMatrixPosition(perspCamera.matrixWorld);
        this.ray.direction
          .set(ndcCoords.x, ndcCoords.y, 0.5)
          .unproject(perspCamera)
          .sub(this.ray.origin)
          .normalize();
        this.camera = perspCamera;
      } else if ("isOrthographicCamera" in camera) {
        const orthoCamera = camera as THREE.OrthographicCamera;
        this.ray.origin
          .set(
            ndcCoords.x,
            ndcCoords.y,
            (orthoCamera.near + orthoCamera.far) /
              (orthoCamera.near - orthoCamera.far)
          )
          .unproject(orthoCamera);
        this.ray.direction
          .set(0, 0, -1)
          .transformDirection(orthoCamera.matrixWorld);
        this.camera = orthoCamera;
      } else {
        throw new Error(
          "Raycaster::setFromCameraAndScreenPosition() -> Unsupported camera type"
        );
      }
    };
  })();

  /**
   * Intersect with a splat mesh
   */
  intersectSplatMesh = (function () {
    const toLocal = new THREE.Matrix4();
    const fromLocal = new THREE.Matrix4();
    const sceneTransform = new THREE.Matrix4();
    const localRay = new Ray();
    const tempPoint = new THREE.Vector3();

    return function (
      this: Raycaster,
      splatMesh: SplatMesh,
      outHits: Hit[] = []
    ): Hit[] {
      const splatTree = splatMesh.getSplatTree();

      if (!splatTree) return outHits;

      for (let s = 0; s < splatTree.subTrees.length; s++) {
        const subTree = splatTree.subTrees[s];

        fromLocal.copy(splatMesh.matrixWorld);
        if (splatMesh.dynamicMode) {
          splatMesh.getSceneTransform(s, sceneTransform);
          fromLocal.multiply(sceneTransform);
        }
        toLocal.copy(fromLocal).invert();

        localRay.origin.copy(this.ray.origin).applyMatrix4(toLocal);
        localRay.direction.copy(this.ray.origin).add(this.ray.direction);
        localRay.direction
          .applyMatrix4(toLocal)
          .sub(localRay.origin)
          .normalize();

        const outHitsForSubTree: Hit[] = [];
        if (subTree.rootNode) {
          this.castRayAtSplatTreeNode(
            localRay,
            splatTree,
            subTree.rootNode,
            outHitsForSubTree
          );
        }

        outHitsForSubTree.forEach((hit) => {
          hit.origin.applyMatrix4(fromLocal);
          hit.normal.applyMatrix4(fromLocal).normalize();
          hit.distance = tempPoint
            .copy(hit.origin)
            .sub(this.ray.origin)
            .length();
        });

        outHits.push(...outHitsForSubTree);
      }

      outHits.sort((a, b) => {
        if (a.distance > b.distance) return 1;
        else return -1;
      });

      return outHits;
    };
  })();

  /**
   * Cast ray at a splat tree node
   */
  castRayAtSplatTreeNode = (function () {
    const tempColor = new THREE.Vector4();
    const tempCenter = new THREE.Vector3();
    const tempScale = new THREE.Vector3();
    const tempRotation = new THREE.Quaternion();
    const tempHit = new Hit();
    const scaleEpsilon = 0.0000001;

    const origin = new THREE.Vector3(0, 0, 0);
    const uniformScaleMatrix = new THREE.Matrix4();
    const scaleMatrix = new THREE.Matrix4();
    const rotationMatrix = new THREE.Matrix4();
    const toSphereSpace = new THREE.Matrix4();
    const fromSphereSpace = new THREE.Matrix4();
    const tempRay = new Ray();

    return function (
      this: Raycaster,
      ray: Ray,
      splatTree: SplatTree,
      node: SplatTreeNode,
      outHits: Hit[] = []
    ): Hit[] {
      if (!ray.intersectBox(node.boundingBox)) {
        return outHits;
      }
      if (node.data && node.data.indexes && node.data.indexes.length > 0) {
        for (let i = 0; i < node.data.indexes.length; i++) {
          const splatGlobalIndex = node.data.indexes[i];
          const splatSceneIndex =
            splatTree.splatMesh.getSceneIndexForSplat(splatGlobalIndex);
          const splatScene = splatTree.splatMesh.getScene(splatSceneIndex);
          if (!splatScene.visible) continue;

          splatTree.splatMesh.getSplatColor(splatGlobalIndex, tempColor);
          splatTree.splatMesh.getSplatCenter(splatGlobalIndex, tempCenter);
          splatTree.splatMesh.getSplatScaleAndRotation(
            splatGlobalIndex,
            tempScale,
            tempRotation
          );

          if (
            tempScale.x <= scaleEpsilon ||
            tempScale.y <= scaleEpsilon ||
            (splatTree.splatMesh.splatRenderMode === SplatRenderMode.ThreeD &&
              tempScale.z <= scaleEpsilon)
          ) {
            continue;
          }

          if (!this.raycastAgainstTrueSplatEllipsoid) {
            let radius = tempScale.x + tempScale.y;
            let componentCount = 2;
            if (
              splatTree.splatMesh.splatRenderMode === SplatRenderMode.ThreeD
            ) {
              radius += tempScale.z;
              componentCount = 3;
            }
            radius = radius / componentCount;
            if (ray.intersectSphere(tempCenter, radius, tempHit)) {
              const hitClone = tempHit.clone();
              hitClone.splatIndex = splatGlobalIndex;
              outHits.push(hitClone);
            }
          } else {
            scaleMatrix.makeScale(tempScale.x, tempScale.y, tempScale.z);
            rotationMatrix.makeRotationFromQuaternion(tempRotation);
            const uniformScale = Math.log10(tempColor.w) * 2.0;
            uniformScaleMatrix.makeScale(
              uniformScale,
              uniformScale,
              uniformScale
            );
            fromSphereSpace
              .copy(uniformScaleMatrix)
              .multiply(rotationMatrix)
              .multiply(scaleMatrix);
            toSphereSpace.copy(fromSphereSpace).invert();
            tempRay.origin
              .copy(ray.origin)
              .sub(tempCenter)
              .applyMatrix4(toSphereSpace);
            tempRay.direction
              .copy(ray.origin)
              .add(ray.direction)
              .sub(tempCenter);
            tempRay.direction
              .applyMatrix4(toSphereSpace)
              .sub(tempRay.origin)
              .normalize();
            if (tempRay.intersectSphere(origin, 1.0, tempHit)) {
              const hitClone = tempHit.clone();
              hitClone.splatIndex = splatGlobalIndex;
              hitClone.origin.applyMatrix4(fromSphereSpace).add(tempCenter);
              outHits.push(hitClone);
            }
          }
        }
      }
      if (node.children && node.children.length > 0) {
        for (let child of node.children) {
          this.castRayAtSplatTreeNode(ray, splatTree, child, outHits);
        }
      }
      return outHits;
    };
  })();
}
