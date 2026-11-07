"""
블렌더 스크립트 셀프테스트: 기본 도형 + 가짜 믹사모 애니메이션으로 cleanup_model.py / merge_animations.py가 끝까지 도는지 확인.

  node tools/blender/run.mjs selftest [-- --workdir <폴더> --keep]

1. 모델: 서브디비전 원숭이(약 6만 삼각형, 스케일 100배, 4K 텍스처) → cleanup --type prop --height 1
   검사: LOD0 ≤ 5000, LOD1 ≈ 50%, LOD2 ≈ 20%, 텍스처 1024, 원점 발밑 중앙, GLB 노드 이름
2. 애니메이션: 믹사모 이름 스켈레톤(mixamorig:*) + 스킨 메시를 cm 단위 FBX로 (믹사모와 같은 UnitScaleFactor)
   가짜 애니메이션 5개 (Idle / Walking(앞으로 1.5m, In Place 아님) / Sword And Shield Slash / Hit Reaction / Dying)
   → merge (mapping.json 없음: 추정 후 확인 요청으로 멈추는지) → merge --accept-guess --root-motion
   검사: 이름 매핑, 길이, m 단위 변환, Walking만 루트 모션(+Z 1.5m) 추출, Hips 수평 이동 제거, 누락 목록
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lib_assets as la  # noqa: E402

RESULTS: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> None:
    RESULTS.append((bool(ok), label))
    print(f"{'✓' if ok else '✗'} {label}", flush=True)


def run_script(script: str, args: list[str]) -> subprocess.CompletedProcess:
    cmd = [bpy.app.binary_path, "-b", "--factory-startup", "--python-exit-code", "1", "-P", os.path.join(HERE, script), "--", *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    keep = [ln for ln in r.stdout.splitlines() if not ln.startswith(("Blender ", "Read ", "Info:")) and "| INFO:" not in ln and not ln.startswith("INFO ")]
    print("    " + "\n    ".join(keep[-40:]), flush=True)
    if r.returncode not in (0, 3):
        print(r.stderr[-3000:], flush=True)
    return r


# ---------------------------------------------------------------------------
# GLB 바이너리 읽기 (검사용)


def read_glb(path: str) -> tuple[dict, bytes]:
    with open(path, "rb") as fh:
        data = fh.read()
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_len])
    off = 20 + json_len
    bin_chunk = b""
    if off < len(data):
        bin_len = struct.unpack_from("<I", data, off)[0]
        bin_chunk = data[off + 8 : off + 8 + bin_len]
    return gltf, bin_chunk


def accessor_floats(gltf: dict, bin_chunk: bytes, index: int) -> list[tuple[float, ...]]:
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    assert acc["componentType"] == 5126, "float 접근자만 지원"
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", 4 * comps)
    return [struct.unpack_from(f"<{comps}f", bin_chunk, start + i * stride) for i in range(acc["count"])]


def image_size(gltf: dict, bin_chunk: bytes, index: int) -> tuple[int, int]:
    img = gltf["images"][index]
    view = gltf["bufferViews"][img["bufferView"]]
    blob = bin_chunk[view.get("byteOffset", 0) : view.get("byteOffset", 0) + view["byteLength"]]
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", blob[16:24])
    # JPEG: SOF 마커 찾기
    i = 2
    while i < len(blob):
        marker, length = blob[i + 1], struct.unpack(">H", blob[i + 2 : i + 4])[0]
        if marker in (0xC0, 0xC2):
            h, w = struct.unpack(">HH", blob[i + 5 : i + 9])
            return w, h
        i += 2 + length
    return 0, 0


# ---------------------------------------------------------------------------
# 1. 모델 정리


def make_test_model(path: str) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_monkey_add(location=(3, 2, 5), rotation=(0, 0, 0.5))
    o = bpy.context.object
    o.scale = (100, 100, 100)
    m = o.modifiers.new("subsurf", "SUBSURF")
    m.levels = 3
    bpy.ops.object.modifier_apply(modifier=m.name)
    img = bpy.data.images.new("albedo_4k", 4096, 4096)
    img.generated_type = "UV_GRID"
    img.pack()
    mat = bpy.data.materials.new("monkey")
    mat.use_nodes = True
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    mat.node_tree.links.new(tex.outputs[0], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    o.data.materials.append(mat)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")


def test_cleanup(work: str) -> None:
    print("\n== cleanup_model.py", flush=True)
    src = os.path.join(work, "monkey_raw.glb")
    out = os.path.join(work, "monkey_clean.glb")
    report = os.path.join(work, "monkey_report.json")
    make_test_model(src)
    r = run_script("cleanup_model.py", ["--input", src, "--type", "prop", "--out", out, "--height", "1.0", "--report-json", report])
    check(r.returncode == 0, "cleanup 종료 코드 0")
    if r.returncode != 0:
        return
    rep = json.load(open(report, encoding="utf-8"))
    lods = {int(k): v for k, v in rep["lods"].items()}
    check(rep["input_tris"] > 50_000, f"입력이 예산보다 큼 ({rep['input_tris']:,})")
    check(lods[0] <= 5000, f"LOD0 ≤ 5000 ({lods[0]:,})")
    check(0.42 <= lods[1] / lods[0] <= 0.58, f"LOD1 ≈ 50% ({lods[1] / lods[0]:.1%})")
    check(0.14 <= lods[2] / lods[0] <= 0.26, f"LOD2 ≈ 20% ({lods[2] / lods[0]:.1%})")
    check(abs(rep["height"] - 1.0) < 0.01, f"--height 1.0 적용 ({rep['height']:.3f}m)")
    check(abs(rep["bottom"]) < 1e-3 and all(abs(c) < 1e-3 for c in rep["center_xy"]), "원점이 발밑 중앙")
    gltf, bin_chunk = read_glb(out)
    sizes = [image_size(gltf, bin_chunk, i) for i in range(len(gltf.get("images", [])))]
    check(bool(sizes) and all(max(s) <= 1024 and max(s) > 0 for s in sizes), f"GLB 텍스처 ≤ 1024px {sizes}")
    names = la.glb_mesh_nodes(gltf)
    check(sorted(names) == ["Suzanne_LOD0", "Suzanne_LOD1", "Suzanne_LOD2"], f"LOD 노드 이름 {names}")


# ---------------------------------------------------------------------------
# 2. 애니메이션 병합

BONES = [  # (이름, 부모, head, tail) — cm 단위, 믹사모 이름
    ("Hips", None, (0, 0, 100), (0, 0, 110)),
    ("Spine", "Hips", (0, 0, 110), (0, 0, 140)),
    ("Head", "Spine", (0, 0, 150), (0, 0, 175)),
    ("LeftUpLeg", "Hips", (10, 0, 95), (10, 0, 50)),
    ("RightUpLeg", "Hips", (-10, 0, 95), (-10, 0, 50)),
]
PREFIX = "mixamorig:"
ANIMS = {  # 파일명: (프레임 수, 키 함수)
    "Idle.fbx": 61,
    "Walking.fbx": 31,
    "Sword And Shield Slash.fbx": 41,
    "Hit Reaction.fbx": 21,
    "Dying.fbx": 51,
}


def build_rig() -> tuple[bpy.types.Object, bpy.types.Object]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.scale_length = 0.01  # cm 단위로 내보내기 (믹사모 FBX와 같은 UnitScaleFactor)
    scene.render.fps = 30
    arm_data = bpy.data.armatures.new("Armature")
    arm = bpy.data.objects.new("Armature", arm_data)
    scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for name, parent, head, tail in BONES:
        b = arm_data.edit_bones.new(PREFIX + name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        eb[name] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.mesh.primitive_cylinder_add(radius=20, depth=170, location=(0, 0, 85), vertices=16)
    body = bpy.context.object
    body.name = "Body"
    vg = body.vertex_groups.new(name=PREFIX + "Hips")
    vg.add([v.index for v in body.data.vertices], 1.0, "REPLACE")
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    return arm, body


def key_anim(arm: bpy.types.Object, fname: str, frames: int) -> bpy.types.Action:
    action = bpy.data.actions.new("mixamo.com")
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    hips = arm.pose.bones[PREFIX + "Hips"]
    spine = arm.pose.bones[PREFIX + "Spine"]
    to_local = hips.bone.matrix_local.to_3x3().inverted()
    for f in range(frames):
        t = f / (frames - 1)
        world = Vector((0, 0, 0))
        if fname == "Idle.fbx":
            world = Vector((0, 0, 1.5 * math.sin(t * 2 * math.pi)))
        elif fname == "Walking.fbx":
            world = Vector((0, -150 * t, 2 * math.sin(t * 4 * math.pi)))  # 정면(-Y)으로 1.5m
        elif fname == "Dying.fbx":
            world = Vector((0, 0, -80 * t))
        hips.location = to_local @ world
        hips.keyframe_insert("location", frame=f)
        angle = {"Sword And Shield Slash.fbx": 1.2, "Hit Reaction.fbx": -0.5}.get(fname, 0.1) * math.sin(t * math.pi)
        spine.rotation_mode = "XYZ"
        spine.rotation_euler = (0, 0, angle)
        spine.keyframe_insert("rotation_euler", frame=f)
    return action


def make_mixamo_files(work: str) -> tuple[str, str]:
    char_path = os.path.join(work, "Hero_rigged.fbx")
    anim_dir = os.path.join(work, "anims")
    os.makedirs(anim_dir, exist_ok=True)
    arm, body = build_rig()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.fbx(filepath=char_path, use_selection=True, bake_anim=False, add_leaf_bones=False)
    for fname, frames in ANIMS.items():
        key_anim(arm, fname, frames)
        bpy.context.scene.frame_start, bpy.context.scene.frame_end = 0, frames - 1
        bpy.ops.object.select_all(action="DESELECT")
        arm.select_set(True)
        bpy.ops.export_scene.fbx(
            filepath=os.path.join(anim_dir, fname),
            use_selection=True,
            object_types={"ARMATURE"},
            bake_anim=True,
            bake_anim_use_all_actions=False,
            bake_anim_use_nla_strips=False,
            bake_anim_force_startend_keying=True,
            add_leaf_bones=False,
        )
    return char_path, anim_dir


def test_merge(work: str) -> None:
    print("\n== merge_animations.py", flush=True)
    char_path, anim_dir = make_mixamo_files(work)
    out = os.path.join(work, "Hero.glb")
    base = ["--character", char_path, "--anims", anim_dir, "--out", out]

    r = run_script("merge_animations.py", base)
    mapping_path = os.path.join(anim_dir, "mapping.json")
    check(r.returncode == 3 and os.path.exists(mapping_path), "mapping.json이 없으면 추정 작성 후 확인 요청으로 멈춤 (종료 코드 3)")
    guessed = json.load(open(mapping_path, encoding="utf-8"))
    want = {"Idle.fbx": "idle", "Walking.fbx": "walk_f", "Sword And Shield Slash.fbx": "attack_light_1", "Hit Reaction.fbx": "hit_front", "Dying.fbx": "death"}
    check(guessed.get("_guessed") is True and all(guessed.get(k) == v for k, v in want.items()), "파일명 → 이름 규칙 추정")

    r = run_script("merge_animations.py", [*base, "--accept-guess", "--root-motion"])
    check(r.returncode == 0, "merge --accept-guess --root-motion 종료 코드 0")
    if r.returncode != 0:
        return
    gltf, bin_chunk = read_glb(out)
    anims = dict(la.glb_animations(gltf))
    check(sorted(anims) == sorted(want.values()), f"GLB 애니메이션 이름 {sorted(anims)}")
    for fname, frames in ANIMS.items():
        name = want[fname]
        exp = (frames - 1) / 30
        check(abs(anims.get(name, -1) - exp) < 0.05, f"{name} 길이 {anims.get(name, -1):.2f}초 ≈ {exp:.2f}초")
    check(len(la.missing_animations(list(anims))) == 17, "누락 목록 17개 (22개 규칙 중 5개만 있음)")
    check("누락 (17개" in r.stdout, "리포트에 누락 목록 출력")

    # 단위: 관절 노드 이동값이 m 단위인지 (cm면 100 근처)
    nodes = gltf["nodes"]
    joints = gltf["skins"][0]["joints"] if gltf.get("skins") else []
    hips_node = next((i for i in joints if nodes[i]["name"].endswith("Hips")), None)
    hips_world_y = None
    if hips_node is not None:
        # Hips까지 부모 체인의 translation/scale 누적 (회전 없음 가정 — 테스트 리그)
        parents = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
        y, s, cur = 0.0, 1.0, hips_node
        chain = []
        while cur is not None:
            chain.append(cur)
            cur = parents.get(cur)
        for i in reversed(chain):
            n = nodes[i]
            y = y + s * n.get("translation", [0, 0, 0])[1]
            s = s * n.get("scale", [1, 1, 1])[1]
        hips_world_y = y
    check(hips_world_y is not None and abs(hips_world_y - 1.0) < 0.02, f"cm → m 변환 (Hips 높이 {hips_world_y if hips_world_y is None else round(hips_world_y, 3)}m ≈ 1.0m)")

    rm_path = os.path.splitext(out)[0] + ".rootmotion.json"
    rm = json.load(open(rm_path, encoding="utf-8"))
    walk = rm.get("walk_f")
    check(walk is not None and abs(walk["total"][1] - 1.5) < 0.05 and abs(walk["total"][0]) < 0.02, f"walk_f 루트 모션 +Z 1.5m ({walk and walk['total']})")
    check(walk is not None and len(walk["frames"]) == 31 and walk["fps"] == 30, "루트 모션 프레임 31개, 30fps")
    check(sorted(rm.get("_inPlace", [])) == sorted(["idle", "attack_light_1", "hit_front", "death"]), f"In Place 판정 {rm.get('_inPlace')}")

    # Walking의 Hips 이동 채널에서 수평 이동이 빠졌는지 (glTF x/z), 수직 흔들림은 남았는지
    walk_anim = next(a for a in gltf["animations"] if a["name"] == "walk_f")
    ch = next(c for c in walk_anim["channels"] if c["target"].get("node") == hips_node and c["target"]["path"] == "translation")
    vals = accessor_floats(gltf, bin_chunk, walk_anim["samplers"][ch["sampler"]]["output"])
    xs, ys, zs = zip(*vals)
    check(max(xs) - min(xs) < 0.01 and max(zs) - min(zs) < 0.01, f"walk_f Hips 수평 이동 제거 (x 범위 {max(xs) - min(xs):.4f}, z 범위 {max(zs) - min(zs):.4f})")
    check(0.02 < max(ys) - min(ys) < 0.06, f"walk_f Hips 수직 흔들림 유지 ({max(ys) - min(ys):.3f}m)")
    death = next(a for a in gltf["animations"] if a["name"] == "death")
    chd = next(c for c in death["channels"] if c["target"].get("node") == hips_node and c["target"]["path"] == "translation")
    dys = [v[1] for v in accessor_floats(gltf, bin_chunk, death["samplers"][chd["sampler"]]["output"])]
    check(abs((max(dys) - min(dys)) - 0.8) < 0.02, f"death(In Place)의 Hips 이동은 그대로 ({max(dys) - min(dys):.3f}m)")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="selftest.py")
    p.add_argument("--workdir")
    p.add_argument("--keep", action="store_true", help="결과 폴더를 지우지 않음")
    args = p.parse_args(argv)
    work = args.workdir or tempfile.mkdtemp(prefix="blender-selftest-")
    os.makedirs(work, exist_ok=True)
    print(f"블렌더 {bpy.app.version_string}, 작업 폴더 {work}", flush=True)
    try:
        test_cleanup(work)
        test_merge(work)
    finally:
        failed = [label for ok, label in RESULTS if not ok]
        print(f"\n셀프테스트: {len(RESULTS) - len(failed)}/{len(RESULTS)} 통과", flush=True)
        if not args.keep and not args.workdir:
            shutil.rmtree(work, ignore_errors=True)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
