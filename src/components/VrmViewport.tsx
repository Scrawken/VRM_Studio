import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Grid,
  Bone,
  Activity,
  Sun,
  Camera,
} from 'lucide-react';
import {
  ViewportAnimationMode,
  ViewportCameraPreset,
  ViewportLightingPreset,
  ViewportViewMode,
} from '../shared/types';

interface VrmViewportProps {
  vrmUrl: string | null;
  characterName: string;
  viewMode: ViewportViewMode;
  onChangeViewMode: (mode: ViewportViewMode) => void;
  animationMode: ViewportAnimationMode;
  onChangeAnimationMode: (mode: ViewportAnimationMode) => void;
  cameraPreset: ViewportCameraPreset;
  onChangeCameraPreset: (preset: ViewportCameraPreset) => void;
  lightingPreset: ViewportLightingPreset;
  onChangeLightingPreset: (preset: ViewportLightingPreset) => void;
  expressionWeights: Record<string, number>;
  boneHighlight?: string | null;
  onVrmMetadataLoaded?: (info: {
    boneNames: string[];
    expressionNames: string[];
    meshCount: number;
  }) => void;
}

const CAMERA_PRESETS: Record<
  ViewportCameraPreset,
  { pos: [number, number, number]; target: [number, number, number]; label: string }
> = {
  full: { pos: [0.54, 1.02, 4.25], target: [0, 0.72, 0], label: 'Full Body' },
  portrait: { pos: [0.12, 1.62, 0.90], target: [0, 1.54, 0], label: 'Portrait' },
  side: { pos: [3.35, 1.02, 0.15], target: [0, 0.76, 0], label: 'Side' },
  back: { pos: [0.22, 1.02, -4.15], target: [0, 0.72, 0], label: 'Back' },
};

const BONE_PALETTE = [
  0x38bdf8, 0xa855f7, 0x34d399, 0xf59e0b, 0xf472b6, 0x60a5fa, 0xfb7185, 0x4ade80,
];

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createRadialContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const VrmViewport: React.FC<VrmViewportProps> = ({
  vrmUrl,
  characterName,
  viewMode,
  onChangeViewMode,
  animationMode,
  onChangeAnimationMode,
  cameraPreset,
  onChangeCameraPreset,
  lightingPreset,
  onChangeLightingPreset,
  expressionWeights,
  boneHighlight,
  onVrmMetadataLoaded,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedVrmVersion, setLoadedVrmVersion] = useState<'0.0' | '1.0' | null>(null);

  // Refs synced to Three.js loop without tearing down renderer
  const viewModeRef = useRef(viewMode);
  const animModeRef = useRef(animationMode);
  const exprWeightsRef = useRef(expressionWeights);
  const lightingRef = useRef(lightingPreset);
  const boneHighlightRef = useRef(boneHighlight);
  const onMetadataRef = useRef(onVrmMetadataLoaded);

  viewModeRef.current = viewMode;
  animModeRef.current = animationMode;
  exprWeightsRef.current = expressionWeights;
  lightingRef.current = lightingPreset;
  boneHighlightRef.current = boneHighlight;
  onMetadataRef.current = onVrmMetadataLoaded;

  const cameraTargetGoalRef = useRef<{
    pos: THREE.Vector3;
    target: THREE.Vector3;
    active: boolean;
  }>({
    pos: new THREE.Vector3(...CAMERA_PRESETS.full.pos),
    target: new THREE.Vector3(...CAMERA_PRESETS.full.target),
    active: false,
  });

  const sceneControlsRef = useRef<{
    applyVisualMode: () => void;
    applyLighting: () => void;
    applyExpressions: () => void;
    requestRender: () => void;
    loadVrmUrl: (url: string) => void;
  } | null>(null);

  // Mount Three.js scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const width = Math.max(320, container.clientWidth);
    const height = Math.max(320, container.clientHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e13);
    scene.fog = new THREE.FogExp2(0x0b0e13, 0.045);

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.05, 60);
    const initialPreset = CAMERA_PRESETS[cameraPreset];
    camera.position.set(...initialPreset.pos);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.52;
    pmrem.dispose();

    // 3-Point Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xcbd5e1, 0x1e293b, 0.55);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.65);
    keyLight.position.set(2.4, 3.6, 2.8);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 12;
    keyLight.shadow.camera.left = -2;
    keyLight.shadow.camera.right = 2;
    keyLight.shadow.camera.top = 2.5;
    keyLight.shadow.camera.bottom = -0.5;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 1.35);
    rimLight.position.set(-2.2, 2.4, -2.5);
    scene.add(rimLight);

    // Stage floor grid + contact shadow disc
    const grid = new THREE.GridHelper(8, 24, 0x263142, 0x171d27);
    grid.position.y = 0.001;
    scene.add(grid);

    const shadowTex = createRadialContactShadowTexture();
    const shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.65, 32),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.004;
    scene.add(shadowDisc);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...initialPreset.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.45;
    controls.maxDistance = 6.5;
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.update();

    controls.addEventListener('start', () => {
      cameraTargetGoalRef.current.active = false;
    });

    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

    let currentVrm: VRM | null = null;
    let skeletonHelper: THREE.SkeletonHelper | null = null;
    let activeLoadSeq = 0;
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const weightMaterials = new Map<THREE.Mesh, THREE.Material>();

    const buildWeightVisualizationMaterial = (mesh: THREE.Mesh): THREE.Material => {
      const cached = weightMaterials.get(mesh);
      if (cached) return cached;
      const geom = mesh.geometry.clone();
      const skinIdx = geom.getAttribute('skinIndex');
      const skinW = geom.getAttribute('skinWeight');
      const posAttr = geom.getAttribute('position');
      const colors = new Float32Array(posAttr.count * 3);
      const col = new THREE.Color();

      for (let i = 0; i < posAttr.count; i++) {
        if (skinIdx && skinW) {
          const j0 = Math.round(skinIdx.getX(i));
          const w0 = skinW.getX(i);
          col.setHex(BONE_PALETTE[j0 % BONE_PALETTE.length]);
          col.multiplyScalar(0.45 + 0.55 * w0);
        } else {
          col.setHex(0x64748b);
        }
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mesh.geometry.setAttribute('color', geom.getAttribute('color'));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        wireframe: false,
      });
      weightMaterials.set(mesh, mat);
      return mat;
    };

    const applyVisualMode = () => {
      if (!currentVrm) return;
      const mode = viewModeRef.current;

      if (skeletonHelper) {
        skeletonHelper.visible = mode === 'skeleton';
      }

      currentVrm.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (!originalMaterials.has(mesh)) {
          originalMaterials.set(mesh, mesh.material);
        }
        const orig = originalMaterials.get(mesh)!;

        if (mode === 'weights') {
          mesh.material = buildWeightVisualizationMaterial(mesh);
        } else {
          mesh.material = orig;
          const mats = Array.isArray(orig) ? orig : [orig];
          mats.forEach((m) => {
            if ('wireframe' in m) {
              (m as THREE.MeshStandardMaterial).wireframe = mode === 'wireframe';
            }
          });
        }
      });
    };

    const applyLighting = () => {
      const preset = lightingRef.current;
      if (preset === 'studio') {
        scene.background = new THREE.Color(0x0b0e13);
        keyLight.color.setHex(0xfff4e6);
        keyLight.intensity = 1.65;
        hemiLight.color.setHex(0xcbd5e1);
        hemiLight.intensity = 0.55;
        rimLight.color.setHex(0x60a5fa);
        rimLight.intensity = 1.15;
      } else if (preset === 'dramatic') {
        scene.background = new THREE.Color(0x07080d);
        keyLight.color.setHex(0xfde68a);
        keyLight.intensity = 2.05;
        hemiLight.color.setHex(0x312e81);
        hemiLight.intensity = 0.38;
        rimLight.color.setHex(0xa855f7);
        rimLight.intensity = 1.8;
      } else {
        scene.background = new THREE.Color(0x161e2b);
        keyLight.color.setHex(0xffffff);
        keyLight.intensity = 1.85;
        hemiLight.color.setHex(0xe0f2fe);
        hemiLight.intensity = 0.78;
        rimLight.color.setHex(0xbae6fd);
        rimLight.intensity = 0.75;
      }
    };

    const applyExpressions = () => {
      if (!currentVrm?.expressionManager) return;
      const weights = exprWeightsRef.current;
      const manager = currentVrm.expressionManager;
      for (const expr of manager.expressions) {
        const val =
          weights[expr.expressionName] ??
          weights[expr.expressionName.toLowerCase()] ??
          0;
        manager.setValue(expr.expressionName, val);
      }
    };

    const resetPose = (vrm: VRM) => {
      vrm.humanoid?.resetNormalizedPose();
    };

    const updateProceduralAnimation = (vrm: VRM, elapsed: number, dt: number) => {
      const mode = animModeRef.current;
      const humanoid = vrm.humanoid;
      if (!humanoid) return;

      resetPose(vrm);

      // @pixiv/three-vrm normalized bone local X/Z axes match the unrotated VRM coordinate frame
      // (-Z forward for VRM 0.0 before VRMUtils.rotateVRM0, +Z forward for VRM 1.0)
      const vrm0Flip = vrm.meta?.metaVersion === '0' ? -1 : 1;

      if (mode === 'idle') {
        const breath = Math.sin(elapsed * 2.1);
        const chest = humanoid.getNormalizedBoneNode('chest');
        const head = humanoid.getNormalizedBoneNode('head');
        const lArm = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rArm = humanoid.getNormalizedBoneNode('rightUpperArm');
        const lFore = humanoid.getNormalizedBoneNode('leftLowerArm');
        const rFore = humanoid.getNormalizedBoneNode('rightLowerArm');

        // Natural A-pose relaxation in idle
        if (lArm) lArm.rotation.z = (-1.18 + breath * 0.025) * vrm0Flip;
        if (rArm) rArm.rotation.z = (1.18 - breath * 0.025) * vrm0Flip;
        if (lFore) lFore.rotation.y = 0.14;
        if (rFore) rFore.rotation.y = -0.14;
        if (chest) chest.rotation.x = breath * 0.022 * vrm0Flip;
        if (head) {
          head.rotation.y = Math.sin(elapsed * 0.7) * 0.09;
          head.rotation.x = Math.sin(elapsed * 1.1) * 0.03 * vrm0Flip;
        }
        // Periodic subtle blink unless user is overriding blink
        if ((exprWeightsRef.current['blink'] ?? 0) === 0 && vrm.expressionManager) {
          const cycle = elapsed % 4.2;
          const blinkVal = cycle > 4.05 ? Math.sin(((cycle - 4.05) / 0.15) * Math.PI) : 0;
          vrm.expressionManager.setValue('blink', Math.max(0, Math.min(1, blinkVal)));
        }
      } else if (mode === 'walk') {
        const s = Math.sin(elapsed * 4.4);
        const c = Math.cos(elapsed * 4.4);
        const hips = humanoid.getNormalizedBoneNode('hips');
        const spine = humanoid.getNormalizedBoneNode('spine');
        const lUL = humanoid.getNormalizedBoneNode('leftUpperLeg');
        const lLL = humanoid.getNormalizedBoneNode('leftLowerLeg');
        const rUL = humanoid.getNormalizedBoneNode('rightUpperLeg');
        const rLL = humanoid.getNormalizedBoneNode('rightLowerLeg');
        const lUA = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rUA = humanoid.getNormalizedBoneNode('rightUpperArm');
        const lLA = humanoid.getNormalizedBoneNode('leftLowerArm');
        const rLA = humanoid.getNormalizedBoneNode('rightLowerArm');

        if (hips) hips.rotation.y = s * 0.08;
        if (spine) spine.rotation.y = -s * 0.06;
        if (lUL) lUL.rotation.x = s * 0.48 * vrm0Flip;
        if (rUL) rUL.rotation.x = -s * 0.48 * vrm0Flip;
        if (lLL) lLL.rotation.x = Math.max(0, -c * 0.55) * vrm0Flip;
        if (rLL) rLL.rotation.x = Math.max(0, c * 0.55) * vrm0Flip;
        if (lUA) {
          lUA.rotation.z = -1.25 * vrm0Flip;
          lUA.rotation.x = -s * 0.42 * vrm0Flip;
        }
        if (rUA) {
          rUA.rotation.z = 1.25 * vrm0Flip;
          rUA.rotation.x = s * 0.42 * vrm0Flip;
        }
        if (lLA) lLA.rotation.x = -0.35 * vrm0Flip;
        if (rLA) rLA.rotation.x = -0.35 * vrm0Flip;
      } else if (mode === 'wave') {
        const lArm = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rArm = humanoid.getNormalizedBoneNode('rightUpperArm');
        const rFore = humanoid.getNormalizedBoneNode('rightLowerArm');
        const head = humanoid.getNormalizedBoneNode('head');
        if (lArm) lArm.rotation.z = -1.2 * vrm0Flip;
        if (rArm) {
          rArm.rotation.z = -0.55 * vrm0Flip;
          rArm.rotation.x = -0.25 * vrm0Flip;
        }
        if (rFore) {
          rFore.rotation.z = (-0.85 + Math.sin(elapsed * 6.0) * 0.35) * vrm0Flip;
        }
        if (head) head.rotation.z = -0.08 * vrm0Flip;
      }

      // Highlight selected bone subtly if inspecting skeleton
      if (boneHighlightRef.current && skeletonHelper) {
        const targetNode = humanoid.getNormalizedBoneNode(boneHighlightRef.current as never);
        if (targetNode && mode === 'rest') {
          targetNode.rotation.y = Math.sin(elapsed * 3.0) * 0.25;
        }
      }

      vrm.update(dt);
    };

    // Rendering / pacing loop (Software-WebGL safe)
    let frameId = 0;
    let disposed = false;
    let renderBusy = false;
    let renderDirty = false;
    const startTimeMs = performance.now();
    let lastFrameMs = startTimeMs;

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function drawFrame() {
      if (disposed) return;
      const nowMs = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastFrameMs) / 1000));
      lastFrameMs = nowMs;
      const elapsed = (nowMs - startTimeMs) / 1000;

      if (cameraTargetGoalRef.current.active) {
        if (isSoftwareGl) {
          camera.position.copy(cameraTargetGoalRef.current.pos);
          controls.target.copy(cameraTargetGoalRef.current.target);
          cameraTargetGoalRef.current.active = false;
        } else {
          const k = 16;
          camera.position.x = THREE.MathUtils.damp(camera.position.x, cameraTargetGoalRef.current.pos.x, k, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, cameraTargetGoalRef.current.pos.y, k, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, cameraTargetGoalRef.current.pos.z, k, dt);
          controls.target.x = THREE.MathUtils.damp(controls.target.x, cameraTargetGoalRef.current.target.x, k, dt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, cameraTargetGoalRef.current.target.y, k, dt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, cameraTargetGoalRef.current.target.z, k, dt);
          if (
            camera.position.distanceTo(cameraTargetGoalRef.current.pos) < 0.008 &&
            controls.target.distanceTo(cameraTargetGoalRef.current.target) < 0.008
          ) {
            cameraTargetGoalRef.current.active = false;
          }
        }
      }

      if (currentVrm) {
        applyExpressions();
        updateProceduralAnimation(currentVrm, elapsed, dt);
      }

      controls.update();
      renderer.render(scene, camera);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        drawFrame();
        const done = () => {
          renderBusy = false;
          if (
            !disposed &&
            (renderDirty ||
              animModeRef.current !== 'rest' ||
              cameraTargetGoalRef.current.active)
          ) {
            requestRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    controls.addEventListener('change', requestRender);

    const loadVrmUrl = (url: string) => {
      const mySeq = ++activeLoadSeq;
      setLoadStatus('loading');
      setLoadError(null);

      gltfLoader.load(
        url,
        (gltf) => {
          if (disposed || mySeq !== activeLoadSeq) {
            const staleVrm = gltf.userData.vrm as VRM | undefined;
            if (staleVrm) VRMUtils.deepDispose(staleVrm.scene);
            return;
          }
          const vrm = gltf.userData.vrm as VRM | undefined;
          if (!vrm) {
            setLoadStatus('error');
            setLoadError('Loaded GLTF missing VRMC_vrm userData.');
            return;
          }

          if (currentVrm) {
            scene.remove(currentVrm.scene);
            VRMUtils.deepDispose(currentVrm.scene);
          }
          if (skeletonHelper) {
            scene.remove(skeletonHelper);
            skeletonHelper.dispose();
            skeletonHelper = null;
          }
          originalMaterials.clear();
          weightMaterials.clear();

          const detectedVer = vrm.meta?.metaVersion === '0' ? '0.0' : '1.0';
          if (vrm.meta?.metaVersion === '0') {
            VRMUtils.rotateVRM0(vrm);
          }
          setLoadedVrmVersion(detectedVer);

          currentVrm = vrm;
          vrm.scene.traverse((obj) => {
            obj.frustumCulled = false;
            if ((obj as THREE.Mesh).isMesh) {
              obj.castShadow = !isSoftwareGl;
              obj.receiveShadow = !isSoftwareGl;
            }
          });
          scene.add(vrm.scene);
          vrm.scene.updateMatrixWorld(true);
          vrm.springBoneManager?.setInitState();
          vrm.springBoneManager?.reset();

          skeletonHelper = new THREE.SkeletonHelper(vrm.scene);
          skeletonHelper.visible = viewModeRef.current === 'skeleton';
          scene.add(skeletonHelper);

          applyVisualMode();
          applyLighting();
          applyExpressions();

          const boneNames = Object.keys(vrm.humanoid?.humanBones ?? {});
          const expressionNames =
            vrm.expressionManager?.expressions.map((e) => e.expressionName) ?? [];
          let meshCount = 0;
          vrm.scene.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) meshCount++;
          });

          onMetadataRef.current?.({
            boneNames,
            expressionNames,
            meshCount,
          });

          drawFrame();
          setLoadStatus('ready');
          requestRender();
        },
        undefined,
        (err) => {
          if (disposed || mySeq !== activeLoadSeq) return;
          setLoadStatus('error');
          setLoadError(err instanceof Error ? err.message : 'Failed to load VRM asset');
        }
      );
    };

    sceneControlsRef.current = {
      applyVisualMode,
      applyLighting,
      applyExpressions,
      requestRender,
      loadVrmUrl,
    };

    const handleResize = () => {
      if (!container || disposed) return;
      const w = Math.max(320, container.clientWidth);
      const h = Math.max(320, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      drawFrame();
      requestRender();
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      envTex.dispose();
      shadowTex.dispose();
      if (currentVrm) {
        VRMUtils.deepDispose(currentVrm.scene);
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Load new VRM when URL changes
  useEffect(() => {
    if (vrmUrl && sceneControlsRef.current) {
      sceneControlsRef.current.loadVrmUrl(vrmUrl);
    }
  }, [vrmUrl]);

  // Update visual mode, lighting, expressions, and animation cleanly
  useEffect(() => {
    sceneControlsRef.current?.applyVisualMode();
    sceneControlsRef.current?.requestRender();
  }, [viewMode]);

  useEffect(() => {
    sceneControlsRef.current?.applyLighting();
    sceneControlsRef.current?.requestRender();
  }, [lightingPreset]);

  useEffect(() => {
    sceneControlsRef.current?.applyExpressions();
    sceneControlsRef.current?.requestRender();
  }, [expressionWeights]);

  useEffect(() => {
    sceneControlsRef.current?.requestRender();
  }, [animationMode, boneHighlight]);

  useEffect(() => {
    const preset = CAMERA_PRESETS[cameraPreset];
    cameraTargetGoalRef.current = {
      pos: new THREE.Vector3(...preset.pos),
      target: new THREE.Vector3(...preset.target),
      active: true,
    };
    sceneControlsRef.current?.requestRender();
  }, [cameraPreset]);

  return (
    <div
      className="relative w-full h-full min-h-[480px] bg-[#0b0e13] overflow-hidden select-none"
      data-testid="vrm-canvas-container"
      data-vrm-loaded={loadStatus === 'ready' ? 'true' : 'false'}
    >
      <div ref={mountRef} className="w-full h-full" />

      {/* Minimal top-left viewport label */}
      <div className="pointer-events-none absolute top-4 left-4 flex items-center gap-2 text-xs text-slate-300 bg-[#12161f]/90 border border-[#262d38] px-3 py-1.5 rounded-md">
        <span className="font-medium text-slate-100">{characterName}</span>
        <span aria-hidden="true" className="text-slate-600">·</span>
        <span className="text-slate-400">
          {loadStatus === 'loading'
            ? 'Loading VRM...'
            : loadStatus === 'error'
              ? 'Load Error'
              : `VRM ${loadedVrmVersion ?? '0.0'} Live`}
        </span>
      </div>

      {loadStatus === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0b0e13]/90 p-6">
          <div className="max-w-md border border-red-900/60 bg-[#161b22] rounded-lg p-5 text-sm text-red-200">
            <p className="font-semibold mb-1">Failed to load VRM binary</p>
            <p className="text-red-300/80 text-xs">{loadError}</p>
          </div>
        </div>
      )}

      {/* Collapsible Bottom Control Dock (Zero backdrop-filter over WebGL) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[95%]">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="mb-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#12161f] border border-[#262d38] text-[11px] font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              Show Controls
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              Hide Controls
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="bg-[#12161f]/95 border border-[#262d38] rounded-lg px-3 py-2 flex flex-wrap items-center gap-3 shadow-xl">
            {/* View Mode */}
            <div className="flex items-center gap-1 bg-[#0b0e13] p-1 rounded-md border border-[#1f2630]">
              {(
                [
                  { id: 'appearance', label: 'Model', icon: Eye },
                  { id: 'wireframe', label: 'Wire', icon: Grid },
                  { id: 'skeleton', label: 'Rig', icon: Bone },
                  { id: 'weights', label: 'Weights', icon: Activity },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeViewMode(id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    viewMode === id
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>

            {/* Animation Mode */}
            <div className="flex items-center gap-1 bg-[#0b0e13] p-1 rounded-md border border-[#1f2630]">
              {(
                [
                  { id: 'idle', label: 'Idle' },
                  { id: 'walk', label: 'Walk' },
                  { id: 'wave', label: 'Wave' },
                  { id: 'rest', label: 'T-Pose' },
                ] as const
              ).map((anim) => (
                <button
                  key={anim.id}
                  type="button"
                  onClick={() => onChangeAnimationMode(anim.id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    animationMode === anim.id
                      ? 'bg-[#262d38] text-sky-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {anim.label}
                </button>
              ))}
            </div>

            {/* Camera Presets */}
            <div className="flex items-center gap-1 bg-[#0b0e13] p-1 rounded-md border border-[#1f2630]">
              <Camera className="w-3.5 h-3.5 text-slate-500 ml-1.5 mr-0.5" aria-hidden="true" />
              {(['full', 'portrait', 'side', 'back'] as ViewportCameraPreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onChangeCameraPreset(p)}
                  className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    cameraPreset === p
                      ? 'bg-[#262d38] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {CAMERA_PRESETS[p].label}
                </button>
              ))}
            </div>

            {/* Lighting */}
            <div className="flex items-center gap-1 bg-[#0b0e13] p-1 rounded-md border border-[#1f2630]">
              <Sun className="w-3.5 h-3.5 text-slate-500 ml-1.5 mr-0.5" aria-hidden="true" />
              {(['studio', 'dramatic', 'daylight'] as ViewportLightingPreset[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => onChangeLightingPreset(l)}
                  className={`px-2 py-1 rounded text-xs font-medium capitalize whitespace-nowrap transition-colors cursor-pointer ${
                    lightingPreset === l
                      ? 'bg-[#262d38] text-amber-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
