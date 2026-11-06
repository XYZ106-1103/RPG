/**
 * 스프링 암 길이 상태 (Babylon 비의존): 벽에 막히면 즉시 당기고, 풀리면 천천히 원래 길이로 늘린다.
 * 실제 셰이프캐스트는 springArmProbe.ts (physics 의존)가 한다.
 */
import { damp } from "./damping";

export class SpringArmLength {
  private current: number;

  constructor(
    initial: number,
    /** 복귀 속도 λ (1/초) — 작을수록 천천히 늘어난다 */
    public returnLambda = 2.5,
  ) {
    this.current = initial;
  }

  get length(): number {
    return this.current;
  }

  /**
   * @param desired 원하는 길이
   * @param blocked 벽까지 허용 길이 (막히지 않았으면 null)
   */
  update(desired: number, blocked: number | null, dt: number): number {
    const limit = blocked === null ? desired : Math.min(desired, Math.max(0, blocked));
    // 짧아질 때는 파묻히지 않도록 즉시, 길어질 때는 천천히 (지수 감쇠는 목표를 넘지 않는다)
    this.current = limit < this.current ? limit : damp(this.current, limit, this.returnLambda, dt);
    return this.current;
  }

  reset(length: number): void {
    this.current = length;
  }
}
