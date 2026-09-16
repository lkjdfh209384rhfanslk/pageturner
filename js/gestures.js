// 얼굴 값(blendshape + 고개 각도)으로 페이지 넘김 제스처를 판정한다.

export const GESTURES = [
  { id: 'mouthRight', label: '입 오른쪽으로 당기기', thr: 0.35, max: 1, read: v => v.mouthRight },
  { id: 'mouthLeft',  label: '입 왼쪽으로 당기기',   thr: 0.35, max: 1, read: v => v.mouthLeft },
  { id: 'headRight',  label: '고개 오른쪽으로 돌리기', thr: 22, max: 45, unit: '°', read: v => v.yaw },
  { id: 'headLeft',   label: '고개 왼쪽으로 돌리기',  thr: 22, max: 45, unit: '°', read: v => -v.yaw },
  { id: 'winkRight',  label: '오른쪽 눈 윙크', thr: 0.45, max: 1, read: v => v.eyeBlinkRight - v.eyeBlinkLeft },
  { id: 'winkLeft',   label: '왼쪽 눈 윙크',   thr: 0.45, max: 1, read: v => v.eyeBlinkLeft - v.eyeBlinkRight },
  { id: 'jawOpen',    label: '입 크게 벌리기', thr: 0.55, max: 1, read: v => v.jawOpen },
  { id: 'browUp',     label: '눈썹 올리기',    thr: 0.6,  max: 1, read: v => v.browInnerUp },
];

export const GESTURE_BY_ID = Object.fromEntries(GESTURES.map(g => [g.id, g]));

// 기준값의 이 비율 아래로 내려가야 다시 발동 가능 (히스테리시스)
const RELEASE_RATIO = 0.6;

export class GestureEngine {
  constructor(onFire) {
    this.onFire = onFire;
    this.cooldownUntil = 0;
    this.slots = { next: this.#blank(), prev: this.#blank() };
  }

  #blank() { return { aboveSince: null, armed: true }; }

  reset() {
    for (const s of Object.values(this.slots)) s.aboveSince = null;
  }

  // values: face.js의 결과 (얼굴 없으면 null). 반환: 0~1 진행도 (게이지 표시용)
  update(values, now, settings) {
    if (!values) { this.reset(); return 0; }
    let progress = 0;
    const inCooldown = now < this.cooldownUntil;

    for (const action of ['next', 'prev']) {
      const g = GESTURE_BY_ID[settings[action + 'Gesture']];
      const slot = this.slots[action];
      if (!g) continue;
      const thr = settings.thresholds[g.id] ?? g.thr;
      const v = g.read(values);

      if (v < thr * RELEASE_RATIO) slot.armed = true;
      if (v < thr || !slot.armed || inCooldown) { slot.aboveSince = null; continue; }

      slot.aboveSince ??= now;
      const p = (now - slot.aboveSince) / settings.holdMs;
      if (p >= 1) {
        slot.aboveSince = null;
        slot.armed = false;
        this.cooldownUntil = now + settings.cooldownMs;
        this.reset();
        this.onFire(action);
        return 0;
      }
      progress = Math.max(progress, p);
    }
    return progress;
  }
}
