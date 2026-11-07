"""
AI 생성/외부 모델 정리 (CLAUDE.md "AI 생성 모델 정리") — 블렌더 헤드리스로 실행.

  node tools/blender/run.mjs cleanup -- --input <모델.glb|.gltf|.fbx|.obj> --type player|boss|enemy|prop --out <출력.glb>
      [--height 1.8] [--forward -y|+y|-x|+x] [--merge-distance 0.0001] [--report-json 리포트.json]

1. 트랜스폼 적용, 중복 정점 병합(Merge by Distance), 노멀 재계산
2. 원점을 발밑 중앙으로, 단위 m (--height로 실제 키에 맞춰 스케일), 정면 통일 (--forward: 원본이 보는 방향 → glTF +Z)
3. 예산까지 데시메이트 (player 40k / boss 60k / enemy 25k / prop 5k), LOD1(50%), LOD2(20%) 생성
   → 한 GLB 안에 <이름>_LOD0 / _LOD1 / _LOD2 노드 (게임 로더가 이름으로 LOD를 연결한다)
4. 텍스처를 예산 해상도로 리사이즈 (player/enemy 2K, boss 4K, prop 1K)
결과 GLB는 압축하지 않는다 — 이후 tools/optimize.mjs가 KTX2 + meshopt를 적용한다.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_assets as la  # noqa: E402

FORWARD_ANGLE = {"-y": 0.0, "+y": math.pi, "+x": -math.pi / 2, "-x": math.pi / 2}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="cleanup_model.py", description="모델 정리: 데시메이트, LOD, 텍스처 리사이즈")
    p.add_argument("--input", required=True)
    p.add_argument("--type", required=True, choices=sorted(la.BUDGETS))
    p.add_argument("--out", required=True)
    p.add_argument("--height", type=float, help="실제 키(m)에 맞춰 균일 스케일")
    p.add_argument("--forward", choices=sorted(FORWARD_ANGLE), default="-y", help="원본 모델이 보는 방향 (블렌더 축). 기본 -y = 이미 glTF 정면")
    p.add_argument("--merge-distance", type=float, default=0.0001)
    p.add_argument("--report-json")
    return p.parse_args(argv)


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------


def import_model(path: str) -> None:
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise SystemExit(f"지원하지 않는 형식: {ext} (glb/gltf/fbx/obj)")


def mesh_objects() -> list[bpy.types.Object]:
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def tri_count(objs: list[bpy.types.Object]) -> int:
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    for o in objs:
        me = o.evaluated_get(dg).to_mesh()
        total += sum(len(p.vertices) - 2 for p in me.polygons)
        o.evaluated_get(dg).to_mesh_clear()
    return total


def world_bounds(objs: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
        ev.to_mesh_clear()
    return lo, hi


def roots() -> list[bpy.types.Object]:
    return [o for o in bpy.context.scene.objects if o.parent is None]


def select_only(objs: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def apply_transforms(location: bool) -> None:
    objs = [o for o in bpy.context.scene.objects if o.type in ("MESH", "ARMATURE", "EMPTY")]
    select_only(objs)
    bpy.ops.object.transform_apply(location=location, rotation=True, scale=True)


def clean_geometry(dist: float) -> int:
    removed = 0
    for o in mesh_objects():
        bm = bmesh.new()
        bm.from_mesh(o.data)
        before = len(bm.verts)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        removed += before - len(bm.verts)
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
    return removed


def transform_roots(matrix: Matrix) -> None:
    for o in roots():
        o.matrix_world = matrix @ o.matrix_world


def decimate(objs: list[bpy.types.Object], ratio: float) -> None:
    if ratio >= 0.999:
        return
    for o in objs:
        if o.data.shape_keys:
            raise SystemExit(f"'{o.name}'에 셰이프 키가 있어 데시메이트할 수 없습니다 (셰이프 키를 정리한 뒤 다시 실행하세요).")
        mod = o.modifiers.new("Decimate_cleanup", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        # 아마추어 모디파이어보다 앞에서 적용해야 스킨이 유지된다
        while o.modifiers.find(mod.name) > 0:
            with bpy.context.temp_override(object=o):
                bpy.ops.object.modifier_move_up(modifier=mod.name)
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier=mod.name)


def decimate_to(objs: list[bpy.types.Object], target: int) -> int:
    """목표 삼각형 수 이하가 될 때까지 (Collapse는 비율이 정확하지 않아 최대 4번 보정)"""
    current = tri_count(objs)
    for _ in range(4):
        if current <= target:
            break
        decimate(objs, la.decimate_ratio(current, target) * 0.99)
        current = tri_count(objs)
    return current


def make_lods(base_objs: list[bpy.types.Object], lod0_tris: int) -> dict[int, list[bpy.types.Object]]:
    lods: dict[int, list[bpy.types.Object]] = {0: base_objs}
    names = {o: o.name for o in base_objs}
    for o in base_objs:
        o.name = f"{names[o]}_LOD0"
        o.data.name = f"{names[o]}_LOD0"
    for level, target in enumerate(la.lod_targets(lod0_tris)[1:], start=1):
        copies = []
        for o in base_objs:
            c = o.copy()
            c.data = o.data.copy()
            c.name = f"{names[o]}_LOD{level}"
            c.data.name = c.name
            for col in o.users_collection:
                col.objects.link(c)
            copies.append(c)
        decimate_to(copies, target)
        lods[level] = copies
    return lods


def resize_textures(max_size: int) -> list[dict]:
    out = []
    for img in bpy.data.images:
        if img.type != "IMAGE" or not img.has_data and not img.filepath and not img.packed_file:
            continue
        w, h = img.size[:]
        if w == 0 or h == 0:
            continue
        tw, th = la.texture_target_size(w, h, max_size)
        if (tw, th) != (w, h):
            img.scale(tw, th)
            img.pack()  # 바뀐 픽셀을 PNG로 다시 묶는다 (내보낼 때 원본 파일 대신 이 데이터를 쓰게)
        out.append({"name": img.name, "before": [w, h], "after": [tw, th]})
    return out


def export_glb(path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_animations=True,
        export_image_format="AUTO",
    )


# ---------------------------------------------------------------------------


def main() -> None:
    args = parse_args()
    budget = la.BUDGETS[args.type]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_model(args.input)
    meshes = mesh_objects()
    if not meshes:
        raise SystemExit("메시가 없습니다.")
    tris_in = tri_count(meshes)
    log(f"입력: {args.input}  메시 {len(meshes)}개, 삼각형 {tris_in:,}")

    # 1. 트랜스폼 적용 + 정점 병합/노멀
    apply_transforms(location=False)
    removed = clean_geometry(args.merge_distance)
    log(f"정리: 중복 정점 {removed:,}개 병합, 노멀 재계산")

    # 2. 정면 → 스케일 → 원점(발밑 중앙)
    angle = FORWARD_ANGLE[args.forward]
    if angle:
        transform_roots(Matrix.Rotation(angle, 4, "Z"))
    lo, hi = world_bounds(meshes)
    height = hi.z - lo.z
    if args.height:
        s = args.height / height if height > 0 else 1.0
        transform_roots(Matrix.Scale(s, 4))
        log(f"스케일: 키 {height:.3f}m → {args.height:.3f}m (x{s:.4f})")
    lo, hi = world_bounds(meshes)
    center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    transform_roots(Matrix.Translation(-center))
    apply_transforms(location=True)
    lo, hi = world_bounds(meshes)
    height = hi.z - lo.z
    sane = la.SANE_HEIGHT[args.type]
    if not (sane[0] <= height <= sane[1]):
        log(f"⚠ 키 {height:.3f}m는 {args.type}로는 이상합니다 (보통 {sane[0]}~{sane[1]}m). 단위를 확인하거나 --height를 지정하세요.")

    # 3. 데시메이트 + LOD
    lod0 = decimate_to(meshes, budget.lod0_tris)
    lods = make_lods(meshes, lod0)
    counts = {lv: tri_count(objs) for lv, objs in lods.items()}

    # 4. 텍스처
    textures = resize_textures(budget.max_texture)

    export_glb(args.out)
    gltf = la.read_glb_json(args.out)

    ok = counts[0] <= budget.lod0_tris
    log("")
    log(f"결과: {args.out}  ({os.path.getsize(args.out) / 1048576:.2f} MB)")
    log(f"  종류 {args.type}: LOD0 예산 {budget.lod0_tris:,} 삼각형, 텍스처 {budget.max_texture}px")
    for lv, n in counts.items():
        pct = n / counts[0] * 100 if counts[0] else 0
        log(f"  LOD{lv}: {n:>8,} 삼각형  ({pct:5.1f}% of LOD0){'  ✓ 예산 이내' if lv == 0 and ok else ''}")
    log(f"  입력 대비: {tris_in:,} → {counts[0]:,} ({counts[0] / tris_in * 100:.1f}%)")
    log(f"  키 {height:.3f}m, 발밑 중앙 원점 (바닥 z={lo.z:.4f})")
    for t in textures:
        log(f"  텍스처 {t['name']}: {t['before'][0]}x{t['before'][1]} → {t['after'][0]}x{t['after'][1]}")
    log(f"  GLB 메시 노드: {', '.join(la.glb_mesh_nodes(gltf))}")
    if not ok:
        log(f"✗ LOD0이 예산을 넘었습니다 ({counts[0]:,} > {budget.lod0_tris:,})")

    if args.report_json:
        with open(args.report_json, "w", encoding="utf-8") as fh:
            json.dump(
                {"type": args.type, "input_tris": tris_in, "lods": counts, "height": height, "bottom": lo.z, "center_xy": [(lo.x + hi.x) / 2, (lo.y + hi.y) / 2], "textures": textures, "nodes": la.glb_mesh_nodes(gltf)},
                fh,
                ensure_ascii=False,
                indent=2,
            )
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
