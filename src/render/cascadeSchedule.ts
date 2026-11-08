/**
 * 태양 그림자 캐스케이드 갱신 스케줄 (Babylon 비의존).
 * 근거리 캐스케이드는 매 프레임, 원거리(firstFar번부터)는 interval 프레임마다 — 원거리 두 장은 서로 다른 프레임에
 * 갱신해 비용을 나눈다 (interval 2면 3번은 짝수 프레임, 4번은 홀수 프레임).
 */
export function cascadeUpdates(frame: number, numCascades: number, interval: number, firstFar = 2, out: boolean[] = []): boolean[] {
  out.length = numCascades;
  const n = Math.max(1, Math.floor(interval));
  for (let i = 0; i < numCascades; i++) {
    if (i < firstFar || n === 1) {
      out[i] = true;
      continue;
    }
    const offset = Math.floor(((i - firstFar) * n) / Math.max(1, numCascades - firstFar));
    out[i] = (frame - offset) % n === 0;
  }
  return out;
}
