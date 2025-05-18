import * as THREE from "three";
import { SplatBuffer } from "../loaders/SplatBuffer";

/**
 * SplatScene: Descriptor for a single splat scene managed by an instance of SplatMesh.
 */
export class SplatScene extends THREE.Object3D {
  splatBuffer: SplatBuffer;
  transform: THREE.Matrix4;
  minimumAlpha: number;
  opacity: number;

  constructor(
    splatBuffer: SplatBuffer,
    position: THREE.Vector3 = new THREE.Vector3(),
    quaternion: THREE.Quaternion = new THREE.Quaternion(),
    scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1),
    minimumAlpha: number = 1,
    opacity: number = 1.0,
    visible: boolean = true
  ) {
    super();
    this.splatBuffer = splatBuffer;
    this.position.copy(position);
    this.quaternion.copy(quaternion);
    this.scale.copy(scale);
    this.transform = new THREE.Matrix4();
    this.minimumAlpha = minimumAlpha;
    this.opacity = opacity;
    this.visible = visible;
  }

  copyTransformData(otherScene: SplatScene): void {
    this.position.copy(otherScene.position);
    this.quaternion.copy(otherScene.quaternion);
    this.scale.copy(otherScene.scale);
    this.transform.copy(otherScene.transform);
  }

  updateTransform(dynamicMode: boolean): void {
    if (dynamicMode) {
      if (this.matrixWorldAutoUpdate) this.updateWorldMatrix(true, false);
      this.transform.copy(this.matrixWorld);
    } else {
      if (this.matrixAutoUpdate) this.updateMatrix();
      this.transform.copy(this.matrix);
    }
  }
}
