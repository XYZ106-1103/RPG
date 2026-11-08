"""
블렌더 공용 헬퍼 (cleanup_model.py / merge_animations.py가 함께 쓴다). 블렌더 안에서만 import된다.
"""

from __future__ import annotations

import bpy


def action_fcurves(action: bpy.types.Action) -> list:
    """액션의 모든 F커브 (블렌더 4.4+의 슬롯/레이어 액션과 이전 API 모두 지원 — 5.0에서 action.fcurves가 없어졌다)"""
    layers = getattr(action, "layers", None)
    if layers:
        out = []
        for layer in layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    out.extend(bag.fcurves)
        if out:
            return out
    return list(getattr(action, "fcurves", []))


def scale_location_keys(action: bpy.types.Action, factor: float) -> None:
    """본 이동(location) 키에 배율을 곱한다 — 아마추어 스케일을 적용하면 이동 키는 따라 바뀌지 않기 때문"""
    if abs(factor - 1.0) < 1e-9:
        return
    for fc in action_fcurves(action):
        if fc.data_path.endswith(".location"):
            for kp in fc.keyframe_points:
                kp.co.y *= factor
                kp.handle_left.y *= factor
                kp.handle_right.y *= factor
            fc.update()


def armature_actions(arm: bpy.types.Object) -> list[bpy.types.Action]:
    """아마추어가 쓰는 액션 (활성 액션 + NLA 스트립). glTF 가져오기는 애니메이션을 NLA 트랙에 올린다."""
    out: list[bpy.types.Action] = []
    ad = arm.animation_data
    if ad is None:
        return out
    if ad.action is not None:
        out.append(ad.action)
    for track in ad.nla_tracks:
        for strip in track.strips:
            if strip.action is not None and strip.action not in out:
                out.append(strip.action)
    return out


def remove_bone_shapes() -> int:
    """glTF 가져오기가 본 표시용으로 만드는 도형(Icosphere 등)을 지운다 — 메시로 취급되면 안 된다"""
    shapes = set()
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE":
            for pb in o.pose.bones:
                if pb.custom_shape is not None:
                    shapes.add(pb.custom_shape)
                    pb.custom_shape = None
    for s in shapes:
        data = s.data
        bpy.data.objects.remove(s, do_unlink=True)
        if isinstance(data, bpy.types.Mesh) and data.users == 0:
            bpy.data.meshes.remove(data)
    return len(shapes)


def set_rest_pose(rest: bool) -> None:
    """측정(크기·삼각형)은 레스트 포즈로 — NLA 트랙이 여러 개면 포즈가 섞여 보이기 때문"""
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE":
            o.data.pose_position = "REST" if rest else "POSE"
    bpy.context.view_layer.update()
