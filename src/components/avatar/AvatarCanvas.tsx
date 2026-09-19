import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  AvatarModelLoader,
  LoadedAvatar,
  resolveMorphWeight,
} from "../../services/avatarModelLoader";
import { LipSyncEngine, VisemeWeights } from "../../services/lipSyncEngine";
import {
  Upload,
  RefreshCw,
  Sparkles,
  Sliders,
  Volume2,
  Eye,
  Smile,
  Maximize2,
  Info,
  CheckCircle2,
} from "lucide-react";

interface AvatarCanvasProps {
  isSpeaking: boolean;
  audioLevel?: number;
  onSpeakGreeting?: () => void;
  className?: string;
}

export const AvatarCanvas: React.FC<AvatarCanvasProps> = ({
  isSpeaking,
  audioLevel = 0,
  onSpeakGreeting,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const avatarRef = useRef<LoadedAvatar | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Blendshape tracking
  const currentMorphInfluences = useRef<{ [key: string]: number }>({});
  const targetMorphInfluences = useRef<{ [key: string]: number }>({});

  // Idle micro-animation state refs (Phase 4)
  const blinkStateRef = useRef<{
    isBlinking: boolean;
    blinkStartTime: number;
    nextBlinkTime: number;
    duration: number;
  }>({
    isBlinking: false,
    blinkStartTime: 0,
    nextBlinkTime: Date.now() + 2500,
    duration: 140, // 140ms natural blink duration
  });

  const saccadeStateRef = useRef<{
    nextSaccadeTime: number;
    targetX: number;
    targetY: number;
    currentX: number;
    currentY: number;
  }>({
    nextSaccadeTime: Date.now() + 2000,
    targetX: 0,
    targetY: 0,
    currentX: 0,
    currentY: 0,
  });

  // UI state
  const [modelName, setModelName] = useState<string>("Procedural ARKit Head");
  const [isCustomModel, setIsCustomModel] = useState<boolean>(false);
  const [morphTargetNames, setMorphTargetNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showInspector, setShowInspector] = useState<boolean>(false);
  const [manualWeights, setManualWeights] = useState<Record<string, number>>({});
  const [dragOver, setDragOver] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("Ready");

  /**
   * Initialize Three.js Scene, Camera, Lighting, Controls
   */
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth || 600;
    const height = containerRef.current.clientHeight || 500;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0, 3.2);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xe0f2fe, 1.8);
    keyLight.position.set(2, 3, 3);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa5f3fc, 1.0);
    fillLight.position.set(-2, 1, 2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x818cf8, 2.0);
    rimLight.position.set(0, 3, -3);
    scene.add(rimLight);

    // 5. Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.2;
    controls.maxDistance = 6.0;
    controls.maxPolarAngle = Math.PI / 2 + 0.2;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // 6. Load Default Rigged Head
    loadDefaultHead(scene);

    // 7. Subscribe to LipSyncEngine
    const lipSync = LipSyncEngine.getInstance();
    const unsubLipSync = lipSync.subscribe((weights) => {
      Object.entries(weights).forEach(([key, val]) => {
        if (typeof val === "number") {
          targetMorphInfluences.current[key] = val;
        }
      });
    });

    // 8. Main Render Loop with THREE.Timer and Phase 4 Micro-Animations
    const timer = new THREE.Timer();

    const animate = (timestamp?: number) => {
      animFrameRef.current = requestAnimationFrame(animate);

      timer.update(timestamp);
      const elapsedTime = timer.getElapsed();
      const now = Date.now();

      // Controls update
      controls.update();

      const avatar = avatarRef.current;
      if (avatar) {
        // ==========================================
        // PHASE 4: PROCEDURAL LIFE-LIKE MICRO-ANIMATIONS
        // ==========================================

        // A. Subtle Head Tilt & Sway (sine-wave rotation)
        const tiltGroup = avatar.headBone || avatar.root;
        if (tiltGroup) {
          // Gentle breathing and natural yaw/pitch
          tiltGroup.rotation.y = Math.sin(elapsedTime * 0.6) * 0.04;
          tiltGroup.rotation.x = Math.sin(elapsedTime * 0.9) * 0.025;
          tiltGroup.rotation.z = Math.cos(elapsedTime * 0.4) * 0.015;

          // React to speech activity: slightly nod during talking
          if (isSpeaking) {
            tiltGroup.rotation.x += Math.sin(elapsedTime * 5.0) * 0.02;
          }
        }

        // B. Eye Blinking (Every 3-5 seconds, ramp up for 120ms then down)
        const blink = blinkStateRef.current;
        if (!blink.isBlinking && now >= blink.nextBlinkTime) {
          blink.isBlinking = true;
          blink.blinkStartTime = now;
        }

        let blinkWeight = 0;
        if (blink.isBlinking) {
          const progress = (now - blink.blinkStartTime) / blink.duration;
          if (progress < 0.5) {
            // Closing: ramp from 0 to 1
            blinkWeight = progress * 2;
          } else if (progress < 1.0) {
            // Opening: ramp from 1 to 0
            blinkWeight = (1.0 - progress) * 2;
          } else {
            // Blink finished, schedule next random blink (3 to 5 seconds)
            blink.isBlinking = false;
            blink.nextBlinkTime = now + 2800 + Math.random() * 2500;
          }
        }

        targetMorphInfluences.current["eyeBlinkLeft"] = blinkWeight;
        targetMorphInfluences.current["eyeBlinkRight"] = blinkWeight;

        // If procedural eyelid meshes exist (for default head)
        const leftEyelid = avatar.root.getObjectByName("Left_Eyelid");
        const rightEyelid = avatar.root.getObjectByName("Right_Eyelid");
        if (leftEyelid && rightEyelid) {
          const closedRot = 0;
          const openRot = -Math.PI * 0.5;
          const eyelidRot = THREE.MathUtils.lerp(openRot, closedRot, blinkWeight);
          leftEyelid.rotation.x = eyelidRot;
          rightEyelid.rotation.x = eyelidRot;
        }

        // C. Eye Saccades (Small random shifts of gaze every 2-4 seconds)
        const saccade = saccadeStateRef.current;
        if (now >= saccade.nextSaccadeTime) {
          saccade.targetX = (Math.random() - 0.5) * 0.08;
          saccade.targetY = (Math.random() - 0.5) * 0.05;
          saccade.nextSaccadeTime = now + 1800 + Math.random() * 2200;
        }
        saccade.currentX = THREE.MathUtils.lerp(saccade.currentX, saccade.targetX, 0.15);
        saccade.currentY = THREE.MathUtils.lerp(saccade.currentY, saccade.targetY, 0.15);

        const leftEyeGroup = avatar.root.getObjectByName("LeftEye_Group");
        const rightEyeGroup = avatar.root.getObjectByName("RightEye_Group");
        if (leftEyeGroup && rightEyeGroup) {
          leftEyeGroup.rotation.y = saccade.currentX;
          leftEyeGroup.rotation.x = -saccade.currentY;
          rightEyeGroup.rotation.y = saccade.currentX;
          rightEyeGroup.rotation.x = -saccade.currentY;
        }

        // ==========================================
        // DAMPING & BLENDSHAPE APPLICATION (PHASE 2 & 3)
        // ==========================================
        // Apply smooth interpolation (lerp) to each morph target influence
        avatar.allMorphMeshes.forEach((mesh) => {
          if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;

          Object.keys(mesh.morphTargetDictionary).forEach((morphName) => {
            const index = mesh.morphTargetDictionary![morphName];
            // Resolve target using alias map (supports ARKit, CC4, ReadyPlayerMe, Oculus visemes, Blender keys)
            const targetVal = resolveMorphWeight(morphName, targetMorphInfluences.current);
            const currentVal = currentMorphInfluences.current[morphName] ?? 0;

            // Damping lerp factor: 0.35 for rapid speech sync, 0.2 for subtle eye shifts
            const isSpeechMorph =
              morphName.toLowerCase().includes("jaw") ||
              morphName.toLowerCase().includes("viseme") ||
              morphName.toLowerCase().includes("mouth") ||
              morphName.toLowerCase().includes("open");
            const lerpSpeed = isSpeechMorph ? 0.35 : 0.2;
            const smoothedVal = THREE.MathUtils.lerp(currentVal, targetVal, lerpSpeed);

            currentMorphInfluences.current[morphName] = smoothedVal;
            mesh.morphTargetInfluences![index] = smoothedVal;
          });
        });
      }

      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!containerRef.current || !renderer || !camera) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      unsubLipSync();
      timer.dispose();
      renderer.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  /**
   * Helper to load the procedural default head
   */
  const loadDefaultHead = (scene: THREE.Scene) => {
    // Remove existing
    if (avatarRef.current) {
      scene.remove(avatarRef.current.root);
    }

    const defaultAvatar = AvatarModelLoader.createDefaultRiggedHead();
    scene.add(defaultAvatar.root);
    avatarRef.current = defaultAvatar;

    setModelName("Default Rig (Procedural ARKit)");
    setIsCustomModel(false);
    setMorphTargetNames(defaultAvatar.morphNames);
    setStatusMessage("Procedural head with ARKit 52 morphs loaded");
  };

  /**
   * Load custom user 3D model (.glb, .gltf, .vrm, .obj - e.g. Reallusion CC4, ReadyPlayerMe, Blender)
   */
  const loadCustomModelFile = async (file: File) => {
    if (!sceneRef.current) return;
    setIsLoading(true);
    setStatusMessage(`Parsing 3D mesh and morph targets from ${file.name}...`);

    try {
      const loadedAvatar = await AvatarModelLoader.loadFromFile(file);

      // Remove existing model from scene
      if (avatarRef.current) {
        sceneRef.current.remove(avatarRef.current.root);
      }

      sceneRef.current.add(loadedAvatar.root);
      avatarRef.current = loadedAvatar;

      // Adjust camera and orbit controls to frame the avatar
      if (cameraRef.current && controlsRef.current) {
        cameraRef.current.position.set(0, 0, 2.6);
        controlsRef.current.target.set(0, 0, 0);
        controlsRef.current.update();
      }

      setModelName(file.name);
      setIsCustomModel(true);
      setMorphTargetNames(loadedAvatar.morphNames);
      setStatusMessage(
        `Loaded ${file.name} (${loadedAvatar.morphNames.length} morph targets detected)`
      );
    } catch (err: any) {
      console.error("Error parsing 3D file:", err);
      setStatusMessage(
        `Failed to parse 3D file: ${err.message || "Invalid or unsupported file format"}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle Drag and Drop of 3D files (.glb, .gltf, .vrm, .obj)
   */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "glb" || ext === "gltf" || ext === "vrm" || ext === "obj") {
        loadCustomModelFile(file);
      } else {
        setStatusMessage("Please drop a 3D file (.glb, .gltf, .vrm, or .obj).");
      }
    }
  };

  /**
   * File input change
   */
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      loadCustomModelFile(file);
      e.target.value = "";
    }
  };

  /**
   * Reset Camera view
   */
  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(0, 0, 3.2);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  /**
   * Test Visemes
   */
  const handleTestVisemes = () => {
    setStatusMessage("Running phonetic viseme test (A, E, I, O, U, PP, SS, CH)...");
    LipSyncEngine.getInstance().runVisemeTest(() => {
      setStatusMessage("Viseme test complete.");
    });
  };

  /**
   * Manual slider adjustment for testing morphs
   */
  const handleSliderChange = (morphName: string, value: number) => {
    setManualWeights((prev) => ({ ...prev, [morphName]: value }));
    targetMorphInfluences.current[morphName] = value;
  };

  return (
    <div
      className={`relative w-full h-full flex flex-col bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 overflow-hidden select-none ${className}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Canvas Viewport */}
      <div ref={containerRef} className="relative flex-1 w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Drag Overlay Feedback */}
      {dragOver && (
        <div className="absolute inset-0 bg-sky-950/80 backdrop-blur-md border-2 border-dashed border-sky-400 flex flex-col items-center justify-center text-white z-40">
          <Upload className="w-12 h-12 text-sky-400 animate-bounce mb-3" />
          <p className="text-lg font-semibold">Drop Reallusion CC4 .glb Here</p>
          <p className="text-xs text-sky-200 mt-1">Automatic blendshape extraction & lip-sync mapping</p>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-white z-30">
          <RefreshCw className="w-8 h-8 text-sky-400 animate-spin mb-3" />
          <p className="text-sm font-medium">Parsing 3D Mesh & Morph Targets...</p>
        </div>
      )}

      {/* Top Header Badge */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none z-20">
        <div className="flex items-center gap-2.5 bg-slate-900/80 backdrop-blur-md px-3.5 py-2 rounded-xl border border-white/10 shadow-lg pointer-events-auto">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isSpeaking ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" : "bg-sky-400"
            }`}
          />
          <div>
            <div className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
              <span>{modelName}</span>
              {isCustomModel && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono">
                  CC4 GLB
                </span>
              )}
            </div>
            <div className="text-[10px] text-slate-400">
              {morphTargetNames.length > 0
                ? `${morphTargetNames.length} blendshapes active`
                : "Standard ARKit 52"}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <label
            title="Load 3D mesh avatar (.glb, .gltf, .vrm, .obj from CC4, ReadyPlayerMe, Blender)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 text-sky-300 border border-sky-500/20 text-xs font-medium cursor-pointer shadow-lg transition"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Load 3D Model</span>
            <input
              type="file"
              accept=".glb,.gltf,.vrm,.obj"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>

          <button
            onClick={() => setShowInspector(!showInspector)}
            className={`p-2 rounded-xl border transition shadow-lg ${
              showInspector
                ? "bg-sky-600 text-white border-sky-400"
                : "bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-white/10"
            }`}
            title="Morph Target Inspector"
          >
            <Sliders className="w-4 h-4" />
          </button>

          <button
            onClick={handleResetCamera}
            className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-white/10 transition shadow-lg"
            title="Reset Camera View"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bottom Floating Action Bar */}
      <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-3 pointer-events-none z-20">
        {/* Status Pill */}
        <div className="flex items-center gap-2 bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-[11px] text-slate-300 pointer-events-auto">
          <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>

        {/* Interactive Speech & Viseme Trigger Buttons */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            onClick={handleTestVisemes}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-white/10 text-xs font-medium transition shadow-md"
          >
            <Smile className="w-3.5 h-3.5 text-amber-400" />
            <span>Test Visemes</span>
          </button>

          {onSpeakGreeting && (
            <button
              onClick={onSpeakGreeting}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-sky-500/25 transition active:scale-95"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Say "Hi, how can I help you?"</span>
            </button>
          )}
        </div>
      </div>

      {/* Slide-out Morph Target Inspector Panel */}
      {showInspector && (
        <div className="absolute top-16 right-4 w-72 max-h-[75vh] overflow-y-auto bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-4 text-slate-200 z-30 space-y-3 animate-in fade-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Sliders className="w-4 h-4 text-sky-400" />
              <span>Morph Target Debugger</span>
            </div>
            <button
              onClick={() => {
                setManualWeights({});
                LipSyncEngine.getInstance().resetWeights();
              }}
              className="text-[10px] text-sky-400 hover:underline"
            >
              Reset
            </button>
          </div>

          <p className="text-[10px] text-slate-400">
            Real-time CC4 & ARKit facial blendshapes. Drag sliders to manually articulate facial muscles:
          </p>

          <div className="space-y-2.5">
            {[
              { id: "jawOpen", label: "jawOpen (Mouth Open)", color: "accent-sky-500" },
              { id: "mouthSmileLeft", label: "mouthSmileLeft", color: "accent-emerald-500" },
              { id: "mouthSmileRight", label: "mouthSmileRight", color: "accent-emerald-500" },
              { id: "mouthFunnel", label: "mouthFunnel (O-Shape)", color: "accent-purple-500" },
              { id: "mouthPucker", label: "mouthPucker (Kiss)", color: "accent-pink-500" },
              { id: "eyeBlinkLeft", label: "eyeBlinkLeft", color: "accent-amber-500" },
              { id: "eyeBlinkRight", label: "eyeBlinkRight", color: "accent-amber-500" },
              { id: "browInnerUp", label: "browInnerUp", color: "accent-indigo-500" },
              { id: "viseme_aa", label: "viseme_aa (Vowel A)", color: "accent-rose-500" },
              { id: "viseme_E", label: "viseme_E (Vowel E)", color: "accent-cyan-500" },
              { id: "viseme_O", label: "viseme_O (Vowel O)", color: "accent-violet-500" },
            ].map((m) => {
              const currentVal = manualWeights[m.id] ?? targetMorphInfluences.current[m.id] ?? 0;
              return (
                <div key={m.id} className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-slate-300">{m.label}</span>
                    <span className="text-sky-400 font-bold">{currentVal.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={currentVal}
                    onChange={(e) => handleSliderChange(m.id, parseFloat(e.target.value))}
                    className={`w-full h-1.5 bg-slate-800 rounded-lg cursor-pointer ${m.color}`}
                  />
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t border-white/10 text-[10px] text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-300">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>Phase 2: Three.js SkinnedMesh</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>Phase 3: Phonetic Lip-Sync Sync</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>Phase 4: Saccades & Smooth Lerp</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
