/**
 * 타입 안전 이벤트 버스 (Babylon 비의존).
 *
 * 이벤트 이름 → 페이로드 타입 맵을 제네릭으로 받는다:
 *   const bus = new EventBus<GameEventMap>();
 *   bus.on("hit", (e) => e.damage);   // e는 HitEvent로 추론
 *   bus.emit("hit", { ... });          // 페이로드 타입 검사
 *
 * 두 가지 전달 방식:
 *  - emit(): 즉시 동기 호출
 *  - enqueue() + flush(): 고정 스텝 중 쌓아 두었다가 렌더 프레임에서 한 번에 전달
 *    (한 프레임에 sim 스텝이 여러 번 돌아도 이벤트가 순서대로 한 번씩 전달된다)
 */

/**
 * 이벤트 이름 → 페이로드 타입 맵 제약. 인덱스 시그니처가 없는 interface도 받을 수 있게 매핑 타입으로 둔다.
 * 페이로드는 직렬화 가능한 평범한 객체를 권장한다.
 */
export type EventMap<M> = { [K in keyof M]: unknown };

export type EventHandler<P> = (payload: P) => void;
export type Unsubscribe = () => void;

export interface EventBusOptions {
  /** 핸들러가 예외를 던지면 호출된다. 기본: console.error. 나머지 핸들러는 계속 실행된다. */
  onError?: (error: unknown, type: string) => void;
}

interface Listener<P> {
  handler: EventHandler<P>;
  once: boolean;
  /** off()로 제거되었는지 — 전달 중 제거된 리스너를 건너뛰기 위함 */
  removed: boolean;
}

export class EventBus<M extends EventMap<M>> {
  private readonly listeners = new Map<keyof M, Listener<never>[]>();
  /** 큐: 래퍼 객체 할당을 피하려고 이름/페이로드를 평행 배열로 보관한다 */
  private readonly queuedTypes: (keyof M)[] = [];
  private readonly queuedPayloads: unknown[] = [];
  private readonly onError: (error: unknown, type: string) => void;
  private flushing = false;

  constructor(options: EventBusOptions = {}) {
    this.onError = options.onError ?? ((error, type) => console.error(`[eventBus] '${type}' 핸들러 오류`, error));
  }

  on<K extends keyof M>(type: K, handler: EventHandler<M[K]>): Unsubscribe {
    return this.add(type, handler, false);
  }

  once<K extends keyof M>(type: K, handler: EventHandler<M[K]>): Unsubscribe {
    return this.add(type, handler, true);
  }

  off<K extends keyof M>(type: K, handler: EventHandler<M[K]>): void {
    const list = this.getList(type);
    if (!list) return;
    const i = list.findIndex((l) => l.handler === handler && !l.removed);
    if (i < 0) return;
    const removed = list[i];
    if (removed) removed.removed = true;
    // 전달 중 배열이 바뀌지 않도록 새 배열로 교체한다 (copy-on-write)
    this.listeners.set(
      type,
      list.filter((_, j) => j !== i),
    );
  }

  /** 즉시 동기 전달 */
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const list = this.getList(type);
    if (!list || list.length === 0) return;
    // copy-on-write이므로 현재 배열을 그대로 순회해도 안전하다
    for (const l of list) {
      if (l.removed) continue;
      if (l.once) this.off(type, l.handler);
      try {
        l.handler(payload);
      } catch (err) {
        this.onError(err, String(type));
      }
    }
  }

  /** 큐에 넣고 flush()에서 전달한다 */
  enqueue<K extends keyof M>(type: K, payload: M[K]): void {
    this.queuedTypes.push(type);
    this.queuedPayloads.push(payload);
  }

  /**
   * 큐에 쌓인 이벤트를 넣은 순서대로 전달한다.
   * flush 도중 enqueue된 이벤트는 같은 flush에서 이어서 전달된다. 재진입 호출은 무시한다.
   */
  flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (let i = 0; i < this.queuedTypes.length; i++) {
        const type = this.queuedTypes[i];
        if (type === undefined) continue;
        this.emit(type, this.queuedPayloads[i] as M[typeof type]);
      }
    } finally {
      this.queuedTypes.length = 0;
      this.queuedPayloads.length = 0;
      this.flushing = false;
    }
  }

  get queuedCount(): number {
    return this.queuedTypes.length;
  }

  listenerCount<K extends keyof M>(type: K): number {
    return this.getList(type)?.length ?? 0;
  }

  /** 모든 리스너와 큐를 비운다 (씬 전환 등) */
  clear(): void {
    for (const list of this.listeners.values()) for (const l of list) l.removed = true;
    this.listeners.clear();
    this.queuedTypes.length = 0;
    this.queuedPayloads.length = 0;
  }

  private add<K extends keyof M>(type: K, handler: EventHandler<M[K]>, once: boolean): Unsubscribe {
    const listener: Listener<M[K]> = { handler, once, removed: false };
    const list = this.getList(type) ?? [];
    this.listeners.set(type, [...list, listener] as Listener<never>[]);
    return () => {
      if (listener.removed) return;
      const cur = this.getList(type);
      if (!cur) return;
      listener.removed = true;
      this.listeners.set(
        type,
        cur.filter((l) => l !== listener),
      );
    };
  }

  private getList<K extends keyof M>(type: K): Listener<M[K]>[] | undefined {
    return this.listeners.get(type) as Listener<M[K]>[] | undefined;
  }
}
