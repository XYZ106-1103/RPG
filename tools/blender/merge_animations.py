"""
믹사모 애니메이션 병합 (CLAUDE.md "믹사모 애니메이션 병합") — 블렌더 헤드리스로 실행.

  믹사모: node tools/blender/run.mjs merge -- --character raw/models/<이름>/<이름>_rigged.fbx --anims raw/animations/<이름> \
      --out raw/models/<이름>/<이름>.glb [--mapping <mapping.json>] [--root-motion] [--accept-guess] [--optimize public/assets/characters/<이름>.glb]
  애니메이션이 든 GLB: node tools/blender/run.mjs merge -- --character <리그+애니메이션.glb> --mapping raw/animations/<이름>/mapping.json \
      --out <출력.glb> [...]   (--anims 없이 — GLB 안의 애니메이션 이름이 mapping의 키)

1. 리깅본을 불러오고 FBX의 cm 단위를 m로 (아마추어 스케일 적용 + 본 이동 키도 같은 비율로)
2. mapping.json(원본 파일명 → 이름 규칙)대로 각 애니메이션 FBX의 액션을 캐릭터 아마추어로 옮긴다
   - mapping.json이 없으면 파일명으로 추정해 작성하고 멈춘다 (사용자 확인 후 "_guessed" 줄을 지우고 다시 실행)
   - 값이 null인 파일은 건너뛴다. --accept-guess면 추정한 그대로 진행
   - 본 이름 접두사 차이(mixamorig: / mixamorig1: ...)는 자동으로 맞춘다
3. --root-motion: In Place가 아닌 애니메이션(Hips 수평 이동 5cm 이상)만 Hips의 수평(XZ) 이동을 빼서 제자리로 만들고,
   이동 곡선을 <출력>.rootmotion.json에 저장한다 (glTF 좌표 x/z, m, 프레임별 — sim/이 캐릭터 컨트롤러로 넘긴다)
4. 애니메이션마다 NLA 트랙 하나 → GLB 하나로 내보내기 (30fps)
5. 결과 GLB의 애니메이션 이름/길이(초) 표와 이름 규칙 대비 누락 목록 출력
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_util  # noqa: E402
import lib_assets as la  # noqa: E402
from bl_util import action_fcurves, scale_location_keys  # noqa: E402

FPS = 30
EXIT_NEEDS_CONFIRM = 3


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="merge_animations.py", description="믹사모 애니메이션을 리깅본에 병합해 GLB 하나로")
    p.add_argument("--character", required=True, help="믹사모 리깅본 FBX (<이름>_rigged.fbx)")
    p.add_argument("--anims", help="애니메이션 FBX 폴더 (Without Skin). 생략하면 --character GLB 안의 애니메이션을 쓴다")
    p.add_argument("--out", required=True, help="출력 GLB")
    p.add_argument("--mapping", help="기본: <anims>/mapping.json (GLB 내장 애니메이션이면 필수)")
    p.add_argument("--root-motion", action="store_true", help="In Place가 아닌 애니메이션의 Hips XZ 이동을 루트 모션으로 분리")
    p.add_argument("--accept-guess", action="store_true", help="추정한 mapping을 확인 없이 사용")
    p.add_argument("--optimize", metavar="FINAL_GLB", help="내보낸 뒤 tools/optimize.mjs로 최적화해 이 경로에 저장")
    return p.parse_args(argv)


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# 액션 F커브 (블렌더 4.4+의 슬롯 액션과 이전 API 모두 지원)


def assign_action(obj: bpy.types.Object, action: bpy.types.Action | None) -> None:
    if obj.animation_data is None:
        obj.animation_data_create()
    obj.animation_data.action = action
    if action is not None and hasattr(obj.animation_data, "action_slot") and getattr(action, "slots", None):
        if obj.animation_data.action_slot is None and len(action.slots):
            obj.animation_data.action_slot = action.slots[0]


def bone_prefix(arm: bpy.types.Object) -> str:
    for b in arm.data.bones:
        if b.name.endswith("Hips"):
            return b.name[: -len("Hips")]
    raise SystemExit(f"'{arm.name}'에 Hips 본이 없습니다 (믹사모 스켈레톤이 아닙니다).")


def rename_bone_paths(action: bpy.types.Action, src: str, dst: str) -> None:
    if src == dst:
        return
    pat = re.compile(r'pose\.bones\["' + re.escape(src))
    for fc in action_fcurves(action):
        fc.data_path = pat.sub('pose.bones["' + dst, fc.data_path)
        if fc.group and fc.group.name.startswith(src):
            fc.group.name = dst + fc.group.name[len(src) :]


# ---------------------------------------------------------------------------


def import_fbx(path: str) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True)
    return [o for o in bpy.data.objects if o not in before]


def armature_of(objs: list[bpy.types.Object], path: str) -> bpy.types.Object:
    arms = [o for o in objs if o.type == "ARMATURE"]
    if not arms:
        raise SystemExit(f"아마추어가 없습니다: {path}")
    return arms[0]


def apply_armature_scale(arm: bpy.types.Object) -> float:
    """아마추어(+자식) 스케일 적용. 돌려주는 값을 이 아마추어용 액션의 이동 키에 곱해야 한다 (FBX cm → m)"""
    factor = arm.scale.x
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for c in arm.children_recursive:
        c.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return factor


def delete_objects(objs: list[bpy.types.Object]) -> None:
    for o in objs:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)
            elif isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)


def load_mapping(args: argparse.Namespace, files: list[str]) -> dict[str, str | None]:
    """files: 믹사모면 FBX 파일명, GLB 내장이면 애니메이션 이름"""
    path = args.mapping or os.path.join(args.anims, "mapping.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            mapping = json.load(fh)
        guessed = mapping.get("_guessed", False)
        clean = {k: v for k, v in mapping.items() if not k.startswith("_")}
        errors = la.validate_mapping({k: v for k, v in clean.items() if v is not None})
        if errors:
            raise SystemExit("mapping.json 오류:\n  " + "\n  ".join(errors))
        missing_files = [f for f in files if f not in clean]
        if missing_files:
            log(f"⚠ mapping.json에 없는 파일 (건너뜀): {', '.join(missing_files)}")
        if guessed and not args.accept_guess:
            raise_confirm(path)
        return clean
    g = la.guess_mapping(files)
    data: dict = {"_guessed": True, "_설명": "파일명으로 추정한 매핑입니다. 확인/수정한 뒤 이 줄과 _guessed 줄을 지우고 다시 실행하세요. 건너뛸 파일은 null."}
    if g.unresolved:
        data["_unresolved"] = g.unresolved
    if g.conflicts:
        data["_conflicts"] = [f"{f} → {n} (이미 사용됨)" for f, n in g.conflicts]
    for f in files:
        data[f] = g.mapping.get(f)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    log(f"mapping.json이 없어 파일명으로 추정해 작성했습니다: {path}")
    for f in files:
        log(f"  {f:<45} → {g.mapping.get(f) or '(미정)'}")
    if g.unresolved:
        log(f"  추정 못 함: {', '.join(g.unresolved)}")
    if not args.accept_guess:
        raise_confirm(path)
    return {f: g.mapping.get(f) for f in files}


def raise_confirm(path: str) -> None:
    log(f"\n확인이 필요합니다: {path}\n  내용을 확인/수정하고 \"_guessed\" 줄을 지운 뒤 다시 실행하세요 (그대로 쓰려면 --accept-guess).")
    sys.exit(EXIT_NEEDS_CONFIRM)


# ---------------------------------------------------------------------------
# 루트 모션


def extract_root_motion(arm: bpy.types.Object, action: bpy.types.Action, hips_name: str) -> tuple[bool, dict | None]:
    """Hips 수평 이동을 빼고 곡선을 돌려준다. (In Place 여부, 루트 모션 dict 또는 None)"""
    path = f'pose.bones["{hips_name}"].location'
    curves = {fc.array_index: fc for fc in action_fcurves(action) if fc.data_path == path}
    if len(curves) < 3:
        return True, None
    start, end = (int(round(v)) for v in action.frame_range)
    bone = arm.data.bones[hips_name]
    rot = (arm.matrix_world.to_3x3() @ bone.matrix_local.to_3x3()).normalized()
    rot_inv = rot.inverted()
    locs = {f: Vector(curves[i].evaluate(f) for i in range(3)) for f in range(start, end + 1)}
    base = locs[start]
    world_delta = {f: rot @ (locs[f] - base) for f in locs}  # 블렌더 월드 축 (Z-up)
    points = []
    for f in range(start, end + 1):
        d = world_delta[f]
        gx, _gy, gz = la.blender_to_gltf(d.x, d.y, d.z)
        points.append((gx, gz))
    if la.is_in_place(points):
        return True, None
    # 수평 성분(블렌더 X/Y)만 빼서 Hips 이동 키를 다시 쓴다 (매 프레임 키)
    for i, fc in curves.items():
        fc.keyframe_points.clear()
        fc.keyframe_points.add(end - start + 1)
    for k, f in enumerate(range(start, end + 1)):
        d = world_delta[f]
        horizontal = Vector((d.x, d.y, 0.0))
        new_loc = locs[f] - rot_inv @ horizontal
        for i, fc in curves.items():
            kp = fc.keyframe_points[k]
            kp.co = (f, new_loc[i])
            kp.interpolation = "LINEAR"
    for fc in curves.values():
        fc.update()
    return False, la.root_motion_track(points, FPS)


# ---------------------------------------------------------------------------


def main() -> None:
    args = parse_args()
    embedded = args.anims is None
    if embedded and (not args.character.lower().endswith((".glb", ".gltf")) or not args.mapping):
        raise SystemExit("--anims 없이 쓰려면 --character가 애니메이션이 든 GLB/glTF이고 --mapping을 지정해야 합니다.")
    files: list[str] = []
    mapping: dict[str, str | None] = {}
    if not embedded:
        files = sorted(f for f in os.listdir(args.anims) if f.lower().endswith(".fbx"))
        if not files:
            raise SystemExit(f"애니메이션 FBX가 없습니다: {args.anims}")
        mapping = load_mapping(args, files)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS  # 가져오기 전에 맞춰야 glTF 애니메이션(초)이 30fps 프레임으로 들어온다
    scene.render.fps_base = 1.0

    merged: list[tuple[str, bpy.types.Action]] = []
    root_motion: dict[str, dict] = {}
    in_place: list[str] = []

    def finish_action(label: str, name: str, action: bpy.types.Action) -> None:
        moved = ""
        if args.root_motion:
            stays, track = extract_root_motion(arm, action, hips)
            if track:
                root_motion[name] = track
                moved = f"  루트 모션 추출 (총 x {track['total'][0]:+.2f}m, z {track['total'][1]:+.2f}m)"
            elif stays:
                in_place.append(name)
        s, e = action.frame_range
        log(f"  {label:<45} → {name:<16} {(e - s) / FPS:5.2f}초{moved}")
        merged.append((name, action))

    if embedded:
        # 1. 리그 + 애니메이션이 든 GLB (이미 m 단위)
        bpy.ops.import_scene.gltf(filepath=args.character)
        bl_util.remove_bone_shapes()
        arms = [o for o in scene.objects if o.type == "ARMATURE"]
        if not arms:
            raise SystemExit(f"아마추어가 없습니다: {args.character}")
        arm = arms[0]
        prefix = bone_prefix(arm)
        hips = prefix + "Hips"
        actions = {a.name: a for a in bl_util.armature_actions(arm)}
        if not actions:
            raise SystemExit(f"GLB에 애니메이션이 없습니다: {args.character}")
        log(f"캐릭터: {args.character}  아마추어 '{arm.name}', 본 {len(arm.data.bones)}개, 내장 애니메이션 {len(actions)}개")
        mapping = load_mapping(args, sorted(actions))
        while arm.animation_data.nla_tracks:
            arm.animation_data.nla_tracks.remove(arm.animation_data.nla_tracks[0])
        assign_action(arm, None)
        # 이름이 겹치면 블렌더가 .001을 붙이므로 임시 이름을 거쳐 바꾼다
        for key, action in actions.items():
            action.name = f"__src__{key}"
        for key in sorted(actions):
            action = actions[key]
            name = mapping.get(key)
            if not name:
                log(f"  건너뜀: {key}")
                bpy.data.actions.remove(action)
                continue
            action.name = name
            action.use_fake_user = True
            finish_action(key, name, action)
    else:
        # 1. 믹사모 리깅본
        char_objs = import_fbx(args.character)
        arm = armature_of(char_objs, args.character)
        char_factor = apply_armature_scale(arm)
        prefix = bone_prefix(arm)
        hips = prefix + "Hips"
        for a in list(bpy.data.actions):  # 리깅본에 딸려 온 T포즈 등은 쓰지 않는다
            bpy.data.actions.remove(a)
        assign_action(arm, None)
        log(f"리깅본: {args.character}  아마추어 '{arm.name}', 본 {len(arm.data.bones)}개, 단위 x{char_factor:g} 적용, 접두사 '{prefix}'")

        # 2. 애니메이션 FBX
        for f in files:
            name = mapping.get(f)
            if not name:
                log(f"  건너뜀: {f}")
                continue
            objs = import_fbx(os.path.join(args.anims, f))
            src_arm = armature_of(objs, f)
            action = src_arm.animation_data.action if src_arm.animation_data else None
            if action is None:
                delete_objects(objs)
                raise SystemExit(f"애니메이션이 없습니다: {f}")
            factor = src_arm.scale.x
            action.use_fake_user = True  # 원본 아마추어를 지워도 액션은 남긴다
            delete_objects(objs)
            keep = {m[1] for m in merged} | {action}
            for a in list(bpy.data.actions):  # 같은 파일에서 딸려 온 다른 액션 정리
                if a not in keep and a.users == 0:
                    bpy.data.actions.remove(a)
            action.name = name
            scale_location_keys(action, factor)
            rename_bone_paths(action, bone_prefix_from_action(action), prefix)
            finish_action(f, name, action)

    if not merged:
        raise SystemExit("병합할 애니메이션이 없습니다.")

    # 3. NLA 트랙 (애니메이션 하나 = 트랙 하나)
    assign_action(arm, None)
    for name, action in merged:
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, int(action.frame_range[0]), action)
        if hasattr(strip, "action_slot") and getattr(action, "slots", None) and len(action.slots):
            strip.action_slot = action.slots[0]
        track.mute = False

    # 4. 내보내기
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_anim_slide_to_zero=True,
        export_force_sampling=True,
        export_frame_step=1,
        export_apply=True,
    )
    rm_path = os.path.splitext(args.out)[0] + ".rootmotion.json"
    if args.root_motion:
        with open(rm_path, "w", encoding="utf-8") as fh:
            json.dump({"_설명": "Hips 수평 이동(glTF x/z, m, 시작점 기준, 프레임별). In Place 애니메이션은 _inPlace", "_inPlace": in_place, **root_motion}, fh, ensure_ascii=False, indent=1)

    # 5. 검증 리포트 (내보낸 GLB를 다시 읽는다)
    gltf = la.read_glb_json(args.out)
    anims = la.glb_animations(gltf)
    log("")
    log(f"결과: {args.out}  ({os.path.getsize(args.out) / 1048576:.2f} MB)")
    log(la.format_animation_report(anims))
    if args.root_motion:
        log(f"루트 모션: {rm_path}  (추출 {len(root_motion)}개: {', '.join(root_motion) or '없음'} / In Place {len(in_place)}개)")

    if args.optimize:
        tool = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "optimize.mjs")
        log(f"\n최적화: node tools/optimize.mjs {args.out} {args.optimize}")
        r = subprocess.run(["node", tool, args.out, args.optimize], check=False)
        if r.returncode != 0:
            raise SystemExit("optimize.mjs 실패")


def bone_prefix_from_action(action: bpy.types.Action) -> str:
    for fc in action_fcurves(action):
        m = re.match(r'pose\.bones\["(.*)Hips"\]', fc.data_path)
        if m:
            return m.group(1)
    return ""


if __name__ == "__main__":
    main()
