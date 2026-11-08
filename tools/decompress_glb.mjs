#!/usr/bin/env node
// @ts-check
/**
 * 압축된 GLB(meshopt, 메시 양자화)를 블렌더가 읽을 수 있는 일반 GLB로 푼다.
 * 블렌더의 glTF 가져오기는 EXT_meshopt_compression을 지원하지 않는다 — 이미 최적화된 GLB를 다시 손볼 때 먼저 실행한다.
 *
 * 사용: node tools/decompress_glb.mjs <입력.glb> <출력.glb>
 * 텍스처(WebP/KTX2 등)는 그대로 둔다. (블렌더는 WebP를 읽는다. KTX2는 읽지 못하므로 원본 텍스처가 필요하다)
 */
import { stat } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import { formatBytes } from "./lib/net.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("사용: node tools/decompress_glb.mjs <입력.glb> <출력.glb>");
  process.exit(2);
}
try {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(input);
  const root = doc.getRoot();
  const removed = [];
  for (const ext of root.listExtensionsUsed()) {
    if (ext.extensionName === "EXT_meshopt_compression" || ext.extensionName === "KHR_mesh_quantization") {
      removed.push(ext.extensionName);
      ext.dispose();
    }
  }
  await doc.transform(dequantize());
  if (root.listExtensionsUsed().some((e) => e.extensionName === "KHR_texture_basisu")) {
    console.warn("⚠ KTX2 텍스처가 들어 있습니다. 블렌더는 KTX2를 읽지 못하니 원본(PNG/JPEG/WebP) 텍스처를 쓰세요.");
  }
  await io.write(output, doc);
  console.log(`✓ ${input} → ${output}  (${formatBytes((await stat(input)).size)} → ${formatBytes((await stat(output)).size)})`);
  console.log(`  해제: ${removed.join(", ") || "없음 (원래 압축 안 됨)"}  남은 확장: ${root.listExtensionsUsed().map((e) => e.extensionName).join(", ") || "없음"}`);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
