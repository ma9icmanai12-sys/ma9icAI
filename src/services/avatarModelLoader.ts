import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface MorphTargetInfo {
  name: string;
  index: number;
  meshName: string;
}

export interface LoadedAvatar {
  root: THREE.Group | THREE.Object3D;
  headMesh: THREE.SkinnedMesh | THREE.Mesh | null;
  allMorphMeshes: Array<THREE.SkinnedMesh | THREE.Mesh>;
  morphDictionary: Record<string, number>;
  morphNames: string[];
  headBone?: THREE.Bone | THREE.Object3D;
  isCustomModel: boolean;
}

export class AvatarModelLoader {
  private static gltfLoader = new GLTFLoader();

  /**
   * Loads a .glb model from a URL or Object URL
   */
  public static async loadGLB(url: string): Promise<LoadedAvatar> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const root = gltf.scene;

          // Find head mesh (CC_Base_Head or any mesh with morph targets)
          let headMesh: THREE.SkinnedMesh | THREE.Mesh | null = null;
          const allMorphMeshes: Array<THREE.SkinnedMesh | THREE.Mesh> = [];
          const combinedDictionary: Record<string, number> = {};
          let headBone: THREE.Bone | THREE.Object3D | undefined;

          root.traverse((child) => {
            if ((child as THREE.Bone).isBone) {
              const nameLower = child.name.toLowerCase();
              if (nameLower.includes("head") || nameLower.includes("neck")) {
                if (!headBone) headBone = child;
              }
            }

            if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
              const mesh = child as THREE.SkinnedMesh | THREE.Mesh;
              if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
                allMorphMeshes.push(mesh);

                const nameLower = mesh.name.toLowerCase();
                // Check if this is CC_Base_Head or main head mesh
                if (
                  nameLower.includes("cc_base_head") ||
                  nameLower === "head" ||
                  nameLower.includes("head") ||
                  nameLower.includes("face")
                ) {
                  headMesh = mesh;
                }

                // Merge morph target names
                Object.keys(mesh.morphTargetDictionary).forEach((mName) => {
                  combinedDictionary[mName] = mesh.morphTargetDictionary![mName];
                });
              }
            }
          });

          // Fallback to first mesh with morph targets if CC_Base_Head not explicitly matched
          if (!headMesh && allMorphMeshes.length > 0) {
            headMesh = allMorphMeshes[0];
          }

          // Center & scale model to fit scene
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          // Normalize size to ~2 units tall
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0) {
            const scale = 2.0 / maxDim;
            root.scale.setScalar(scale);
            root.position.x = -center.x * scale;
            root.position.y = -center.y * scale;
            root.position.z = -center.z * scale;
          }

          resolve({
            root,
            headMesh,
            allMorphMeshes,
            morphDictionary: combinedDictionary,
            morphNames: Object.keys(combinedDictionary),
            headBone,
            isCustomModel: true,
          });
        },
        undefined,
        (error) => {
          reject(error);
        }
      );
    });
  }

  /**
   * Generates a procedural 3D stylized head with native ARKit & CC4 morph targets
   * so the app works immediately out of the box before a user uploads a .glb!
   */
  public static createDefaultRiggedHead(): LoadedAvatar {
    const group = new THREE.Group();
    group.name = "Default_Avatar_Rig";

    // 1. Head Sphere with Morph Targets
    const headRadius = 0.85;
    const widthSegments = 48;
    const heightSegments = 48;
    const headGeom = new THREE.SphereGeometry(headRadius, widthSegments, heightSegments);

    // Create morph targets on the geometry:
    // jawOpen, mouthSmileLeft, mouthSmileRight, mouthFunnel, mouthPucker, eyeBlinkLeft, eyeBlinkRight, browInnerUp
    const positionAttr = headGeom.attributes.position;
    const vertexCount = positionAttr.count;

    const jawOpenPositions = new Float32Array(vertexCount * 3);
    const smileLeftPositions = new Float32Array(vertexCount * 3);
    const smileRightPositions = new Float32Array(vertexCount * 3);
    const funnelPositions = new Float32Array(vertexCount * 3);
    const puckerPositions = new Float32Array(vertexCount * 3);
    const blinkLeftPositions = new Float32Array(vertexCount * 3);
    const blinkRightPositions = new Float32Array(vertexCount * 3);
    const browUpPositions = new Float32Array(vertexCount * 3);

    for (let i = 0; i < vertexCount; i++) {
      const x = positionAttr.getX(i);
      const y = positionAttr.getY(i);
      const z = positionAttr.getZ(i);

      // Default copy
      jawOpenPositions[i * 3] = x;
      jawOpenPositions[i * 3 + 1] = y;
      jawOpenPositions[i * 3 + 2] = z;

      smileLeftPositions[i * 3] = x;
      smileLeftPositions[i * 3 + 1] = y;
      smileLeftPositions[i * 3 + 2] = z;

      smileRightPositions[i * 3] = x;
      smileRightPositions[i * 3 + 1] = y;
      smileRightPositions[i * 3 + 2] = z;

      funnelPositions[i * 3] = x;
      funnelPositions[i * 3 + 1] = y;
      funnelPositions[i * 3 + 2] = z;

      puckerPositions[i * 3] = x;
      puckerPositions[i * 3 + 1] = y;
      puckerPositions[i * 3 + 2] = z;

      blinkLeftPositions[i * 3] = x;
      blinkLeftPositions[i * 3 + 1] = y;
      blinkLeftPositions[i * 3 + 2] = z;

      blinkRightPositions[i * 3] = x;
      blinkRightPositions[i * 3 + 1] = y;
      blinkRightPositions[i * 3 + 2] = z;

      browUpPositions[i * 3] = x;
      browUpPositions[i * 3 + 1] = y;
      browUpPositions[i * 3 + 2] = z;

      // Jaw Open: Pull lower face vertices down & slightly back
      if (y < -0.2 && z > 0.1) {
        const falloff = Math.max(0, -y / 0.85);
        jawOpenPositions[i * 3 + 1] = y - 0.28 * falloff;
        jawOpenPositions[i * 3 + 2] = z - 0.08 * falloff;
      }

      // Smile: Pull corners of mouth (y: -0.3, z > 0.6) outwards and upwards
      if (y > -0.5 && y < -0.15 && z > 0.5) {
        if (x < -0.1) {
          // Left smile
          smileLeftPositions[i * 3] = x - 0.08;
          smileLeftPositions[i * 3 + 1] = y + 0.09;
        }
        if (x > 0.1) {
          // Right smile
          smileRightPositions[i * 3] = x + 0.08;
          smileRightPositions[i * 3 + 1] = y + 0.09;
        }
      }

      // Funnel (O shape): Push mouth region forward, pinch width
      if (y > -0.5 && y < -0.15 && z > 0.6) {
        funnelPositions[i * 3] = x * 0.75;
        funnelPositions[i * 3 + 2] = z + 0.12;
      }

      // Pucker (Kiss): Pinch mouth tightly forward
      if (y > -0.5 && y < -0.15 && z > 0.6) {
        puckerPositions[i * 3] = x * 0.5;
        puckerPositions[i * 3 + 2] = z + 0.18;
      }

      // Eyebrow Up: Raise forehead / upper brow vertices
      if (y > 0.35 && y < 0.65 && z > 0.45) {
        browUpPositions[i * 3 + 1] = y + 0.12;
      }
    }

    headGeom.morphAttributes.position = [
      new THREE.BufferAttribute(jawOpenPositions, 3),
      new THREE.BufferAttribute(smileLeftPositions, 3),
      new THREE.BufferAttribute(smileRightPositions, 3),
      new THREE.BufferAttribute(funnelPositions, 3),
      new THREE.BufferAttribute(puckerPositions, 3),
      new THREE.BufferAttribute(browUpPositions, 3),
      new THREE.BufferAttribute(jawOpenPositions, 3), // mapped to viseme_aa
      new THREE.BufferAttribute(smileLeftPositions, 3), // mapped to viseme_E
      new THREE.BufferAttribute(smileRightPositions, 3), // mapped to viseme_I
      new THREE.BufferAttribute(funnelPositions, 3), // mapped to viseme_O
      new THREE.BufferAttribute(puckerPositions, 3), // mapped to viseme_U
    ];

    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.35,
      metalness: 0.2,
      emissive: 0x0369a1,
      emissiveIntensity: 0.15,
    });

    const headMesh = new THREE.Mesh(headGeom, headMaterial);
    headMesh.name = "CC_Base_Head";

    headMesh.morphTargetDictionary = {
      jawOpen: 0,
      mouthSmileLeft: 1,
      mouthSmileRight: 2,
      mouthFunnel: 3,
      mouthPucker: 4,
      browInnerUp: 5,
      viseme_aa: 6,
      viseme_E: 7,
      viseme_I: 8,
      viseme_O: 9,
      viseme_U: 10,
    };
    headMesh.morphTargetInfluences = new Array(11).fill(0);

    group.add(headMesh);

    // 2. Add Stylized Eyes with Eyelid meshes for blinking
    const eyeGeom = new THREE.SphereGeometry(0.14, 24, 24);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.1,
    });

    const pupilGeom = new THREE.SphereGeometry(0.07, 16, 16);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });

    // Left Eye
    const leftEyeGroup = new THREE.Group();
    leftEyeGroup.name = "LeftEye_Group";
    leftEyeGroup.position.set(-0.3, 0.15, 0.72);
    const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
    const leftPupil = new THREE.Mesh(pupilGeom, pupilMat);
    leftPupil.position.set(0, 0, 0.08);
    leftEyeGroup.add(leftEye);
    leftEyeGroup.add(leftPupil);
    group.add(leftEyeGroup);

    // Right Eye
    const rightEyeGroup = new THREE.Group();
    rightEyeGroup.name = "RightEye_Group";
    rightEyeGroup.position.set(0.3, 0.15, 0.72);
    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    const rightPupil = new THREE.Mesh(pupilGeom, pupilMat);
    rightPupil.position.set(0, 0, 0.08);
    rightEyeGroup.add(rightEye);
    rightEyeGroup.add(rightPupil);
    group.add(rightEyeGroup);

    // 3. Eyelids for Blinking
    const eyelidGeom = new THREE.SphereGeometry(0.155, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const eyelidMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.4,
    });

    const leftEyelid = new THREE.Mesh(eyelidGeom, eyelidMat);
    leftEyelid.name = "Left_Eyelid";
    leftEyelid.position.set(-0.3, 0.16, 0.72);
    leftEyelid.rotation.x = -Math.PI * 0.5; // open
    group.add(leftEyelid);

    const rightEyelid = new THREE.Mesh(eyelidGeom, eyelidMat);
    rightEyelid.name = "Right_Eyelid";
    rightEyelid.position.set(0.3, 0.16, 0.72);
    rightEyelid.rotation.x = -Math.PI * 0.5; // open
    group.add(rightEyelid);

    // 4. Stylized Futuristic Head Halo / Accents
    const haloGeom = new THREE.TorusGeometry(0.96, 0.02, 16, 64);
    const haloMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.6,
    });
    const halo = new THREE.Mesh(haloGeom, haloMat);
    halo.rotation.x = Math.PI * 0.35;
    halo.position.set(0, 0.1, 0);
    group.add(halo);

    return {
      root: group,
      headMesh,
      allMorphMeshes: [headMesh],
      morphDictionary: headMesh.morphTargetDictionary,
      morphNames: Object.keys(headMesh.morphTargetDictionary),
      headBone: group,
      isCustomModel: false,
    };
  }
}
