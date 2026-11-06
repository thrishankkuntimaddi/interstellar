import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createCockpit } from '../world/ships.js';

export const MODES = ['CINEMATIC', 'CHASE', 'COCKPIT', 'FREE ORBIT', 'ORBIT GARGANTUA'];

/**
 * Four ways to watch: the director's cut, a chase camera locked behind the active craft,
 * a cockpit view from inside it (with a real 3D cockpit frame), and a free orbit you control.
 */
export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.mode = 0;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.cockpit = createCockpit();
    this.cockpitScene = new THREE.Scene();
    this.cockpitScene.add(this.cockpit);
    this.cockpitLayer = { scene: this.cockpitScene, near: 0.05, far: 20, visible: false };
    this.look = { x: 0, y: 0, tx: 0, ty: 0 };
    this._chasePos = new THREE.Vector3(); this._first = true;
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    dom.addEventListener('mousemove', (e) => {
      this.look.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      this.look.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    });
    this._freeChapter = null;
    // explorer: fly freely around Gargantua itself (units of r_s)
    this.bhCam = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
    this.bhCam.position.set(30, 5, 26);
    this.bhControls = new OrbitControls(this.bhCam, dom);
    Object.assign(this.bhControls, { enabled: false, enableDamping: true, dampingFactor: 0.05, minDistance: 2.6, maxDistance: 320, autoRotate: true, autoRotateSpeed: 0.35, zoomSpeed: 0.6, enablePan: false });
    this.bhControls.addEventListener('start', () => { this.bhControls.autoRotate = false; });
    this.bhControls.addEventListener('end', () => { clearTimeout(this._ar); this._ar = setTimeout(() => (this.bhControls.autoRotate = true), 6000); });
    this.explorerLayer = null;
  }

  setMode(i) {
    this.mode = i; this._first = true;
    this.controls.enabled = i === 3;
    this.bhControls.enabled = i === 4;
    this._freeChapter = null;
  }

  /** Called every frame after the chapter has updated its world. */
  update(ch, lt, dt) {
    const cam = this.camera;
    const subject = ch.subject;
    this.cockpitLayer.visible = false;
    this.explorerLayer = null;
    if (this.mode === 4) {
      ch.shot(lt, cam);
      if (!ch.bhLayer) return 'CINEMATIC';
      this.bhCam.aspect = cam.aspect;
      this.bhControls.update();
      this.explorerLayer = { scene: ch.bhLayer.scene, camera: this.bhCam, near: 0.01, far: 2000 };
      return 'ORBIT GARGANTUA';
    }
    this.look.x += (this.look.tx - this.look.x) * 0.05;
    this.look.y += (this.look.ty - this.look.y) * 0.05;
    if (this.mode === 0 || !subject || ch.lockCinematic?.(lt)) {
      ch.shot(lt, cam);
      this._first = true;
      return 'CINEMATIC';
    }
    subject.updateMatrixWorld(true);
    subject.getWorldQuaternion(this._q);
    const sp = subject.getWorldPosition(this._v);
    if (this.mode === 1) {
      const off = (ch.chase?.offset || new THREE.Vector3(0, 4, -22)).clone().applyQuaternion(this._q).add(sp);
      if (this._first) { this._chasePos.copy(off); this._first = false; }
      this._chasePos.lerp(off, 1 - Math.exp(-dt * 6));
      cam.position.copy(this._chasePos);
      cam.up.set(0, 1, 0).applyQuaternion(this._q);
      const look = (ch.chase?.look || new THREE.Vector3(0, 0, 10)).clone().applyQuaternion(this._q).add(sp);
      cam.lookAt(look);
      cam.rotateY(-this.look.x * 0.25); cam.rotateX(-this.look.y * 0.15);
      return 'CHASE';
    }
    if (this.mode === 2) {
      const local = ch.cockpit || new THREE.Vector3(0, 1, 3);
      cam.position.copy(local).applyQuaternion(this._q).add(sp);
      cam.quaternion.copy(this._q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      cam.rotateY(-this.look.x * 0.9); cam.rotateX(-this.look.y * 0.5);
      if (ch.cockpitShake) { cam.position.addScaledVector(this._v2.set(Math.sin(lt * 31), Math.cos(lt * 23), 0), ch.cockpitShake(lt) * 0.05); }
      // place the interior around the camera
      this.cockpit.position.copy(cam.position); this.cockpit.quaternion.copy(cam.quaternion);
      this.cockpit.rotateY(this.look.x * 0.9 * 0.85); this.cockpit.rotateX(this.look.y * 0.5 * 0.85);
      const sl = this.cockpit.userData.sunL;
      if (ch.sunDir) { sl.position.copy(cam.position).addScaledVector(ch.sunDir, 10); sl.target.position.copy(cam.position); sl.target.updateMatrixWorld(); }
      this.cockpitLayer.visible = true;
      return 'COCKPIT';
    }
    // free orbit around the subject
    if (this._freeChapter !== ch) {
      this._freeChapter = ch;
      const d = ch.freeDist || 40;
      cam.position.copy(sp).add(new THREE.Vector3(d * 0.6, d * 0.3, d * 0.75));
      cam.up.set(0, 1, 0);
    }
    const delta = this._v2.copy(sp).sub(this.controls.target);
    this.controls.target.copy(sp);
    cam.position.add(delta);
    this.controls.update();
    return 'FREE ORBIT';
  }
}
