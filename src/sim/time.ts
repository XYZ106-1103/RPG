/**
 * sim 시간 단위. 시뮬레이션은 60Hz 고정 스텝(CLAUDE.md 원칙 2)이며,
 * 상태에 저장하는 타이머는 결정성과 직렬화를 위해 정수 틱으로 둔다.
 * 데이터 테이블은 사람이 읽기 쉬운 초 단위로 쓰고 여기서 틱으로 바꾼다.
 */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * SIM_HZ));
}

export function ticksToSeconds(ticks: number): number {
  return ticks / SIM_HZ;
}
