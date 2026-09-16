// 전면 카메라 + MediaPipe Face Landmarker. 얼굴 값을 주기적으로 콜백에 넘긴다.
import { FilesetResolver, FaceLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const INTERVAL_MS = 66; // 약 15fps면 충분하고 배터리/발열이 줄어든다

let landmarker = null;
let stream = null;
let running = false;
let lastTs = 0;

export async function startFace(video, onValues) {
  if (running) return;
  running = true;

  if (!landmarker) {
    const fileset = await FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm', import.meta.url).href);
    const options = {
      baseOptions: { modelAssetPath: new URL('../vendor/mediapipe/face_landmarker.task', import.meta.url).href, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    };
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, options);
    } catch {
      options.baseOptions.delegate = 'CPU';
      landmarker = await FaceLandmarker.createFromOptions(fileset, options);
    }
  }

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
  });
  video.srcObject = stream;
  await video.play();

  const tick = () => {
    if (!running) return;
    const now = performance.now();
    if (now - lastTs >= INTERVAL_MS && video.readyState >= 2) {
      lastTs = now;
      onValues(extract(landmarker.detectForVideo(video, now)), now);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function stopFace(video) {
  running = false;
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  if (video) video.srcObject = null;
}

export function isFaceRunning() { return running; }

function extract(result) {
  const cats = result.faceBlendshapes?.[0]?.categories;
  const m = result.facialTransformationMatrixes?.[0]?.data;
  if (!cats || !m) return null;

  const v = {};
  for (const c of cats) v[c.categoryName] = c.score;
  // column-major 4x4 행렬에서 Y축 회전(좌우 고개 돌림) 각도
  v.yaw = Math.atan2(m[8], m[10]) * 180 / Math.PI;
  return v;
}
