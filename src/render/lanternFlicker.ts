/**
 * 등불 미세 깜빡임 (Babylon 비의존): 서로 맞지 않는 주기의 사인 몇 개 + 드문 짧은 흔들림.
 * 결과는 [1 - amount, 1 + amount] 범위의 배율. t는 초.
 */
export function lanternFlicker(t: number, amount: number): number {
  if (!(amount > 0)) return 1;
  // 느린 일렁임 + 빠른 떨림 (합의 최대 진폭 1로 정규화)
  const slow = Math.sin(t * 1.7) * 0.45 + Math.sin(t * 2.9 + 1.3) * 0.25;
  const fast = Math.sin(t * 11.3 + 0.7) * 0.15 + Math.sin(t * 17.9 + 2.1) * 0.1;
  // 가끔(약 4초에 한 번) 짧게 흔들리는 순간
  const gust = Math.max(0, Math.sin(t * 1.55 + 0.4)) ** 24 * Math.sin(t * 31.0);
  const v = slow + fast + gust * 0.05;
  return 1 + Math.max(-1, Math.min(1, v)) * amount;
}
