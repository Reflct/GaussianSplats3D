import * as THREE from "three";

export class Hit {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  splatIndex: number;

  constructor() {
    this.origin = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.distance = 0;
    this.splatIndex = 0;
  }

  set(
    origin: THREE.Vector3,
    normal: THREE.Vector3,
    distance: number,
    splatIndex: number
  ): void {
    this.origin.copy(origin);
    this.normal.copy(normal);
    this.distance = distance;
    this.splatIndex = splatIndex;
  }

  clone(): Hit {
    const hitClone = new Hit();
    hitClone.origin.copy(this.origin);
    hitClone.normal.copy(this.normal);
    hitClone.distance = this.distance;
    hitClone.splatIndex = this.splatIndex;
    return hitClone;
  }
}
