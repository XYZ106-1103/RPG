import { createEngine } from "./core/engine";
import { createTestScene } from "./render/testScene";

async function main(): Promise<void> {
  const canvas = document.getElementById("renderCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#renderCanvas 캔버스를 찾을 수 없습니다.");

  const { engine } = await createEngine(canvas);
  const scene = createTestScene(engine, canvas);

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
}

main().catch((err: unknown) => {
  console.error(err);
  const el = document.getElementById("fatal");
  if (el) {
    el.textContent = err instanceof Error ? err.message : String(err);
    el.hidden = false;
  }
});
