import * as THREE from "three";

const _axis = new THREE.Vector3();

export class ArrowHelper extends THREE.Object3D {
  type: string;
  line: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  cone: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;

  constructor(
    dir: THREE.Vector3 = new THREE.Vector3(0, 0, 1),
    origin: THREE.Vector3 = new THREE.Vector3(0, 0, 0),
    length: number = 1,
    radius: number = 0.1,
    color: number | string = 0xffff00,
    headLength: number = length * 0.2,
    headRadius: number = headLength * 0.2
  ) {
    super();

    this.type = "ArrowHelper";

    const lineGeometry = new THREE.CylinderGeometry(radius, radius, length, 32);
    lineGeometry.translate(0, length / 2.0, 0);
    const coneGeometry = new THREE.CylinderGeometry(
      0,
      headRadius,
      headLength,
      32
    );
    coneGeometry.translate(0, length, 0);

    this.position.copy(origin);

    this.line = new THREE.Mesh(
      lineGeometry,
      new THREE.MeshBasicMaterial({ color: color, toneMapped: false })
    );
    this.line.matrixAutoUpdate = false;
    this.add(this.line);

    this.cone = new THREE.Mesh(
      coneGeometry,
      new THREE.MeshBasicMaterial({ color: color, toneMapped: false })
    );
    this.cone.matrixAutoUpdate = false;
    this.add(this.cone);

    this.setDirection(dir);
  }

  setDirection(dir: THREE.Vector3): void {
    if (dir.y > 0.99999) {
      this.quaternion.set(0, 0, 0, 1);
    } else if (dir.y < -0.99999) {
      this.quaternion.set(1, 0, 0, 0);
    } else {
      _axis.set(dir.z, 0, -dir.x).normalize();
      const radians = Math.acos(dir.y);
      this.quaternion.setFromAxisAngle(_axis, radians);
    }
  }

  setColor(color: number | string): void {
    this.line.material.color.set(color);
    this.cone.material.color.set(color);
  }

  copy(source: ArrowHelper): this {
    super.copy(source, false);
    this.line.copy(source.line);
    this.cone.copy(source.cone);
    return this;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.cone.geometry.dispose();
    this.cone.material.dispose();
  }
}
