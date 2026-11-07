"""
블렌더 비의존 공용 로직 (python3 -m unittest로 테스트 — tests/blender/).
cleanup_model.py / merge_animations.py가 블렌더 안에서 import한다.

- 폴리곤/텍스처 예산 (CLAUDE.md "폴리곤/텍스처 예산")
- 애니메이션 이름 규칙과 믹사모 파일명 → 이름 추정 (CLAUDE.md "애니메이션 이름 규칙")
- GLB 애니메이션 목록/길이 읽기 (결과 검증용)
- 루트 모션: In Place 판정, 좌표 변환
"""

from __future__ import annotations

import json
import os
import re
import struct
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# 예산


@dataclass(frozen=True)
class Budget:
    lod0_tris: int
    max_texture: int


BUDGETS: dict[str, Budget] = {
    "player": Budget(40_000, 2048),
    "boss": Budget(60_000, 4096),  # 2K~4K
    "enemy": Budget(25_000, 2048),
    "prop": Budget(5_000, 1024),
}

# LOD1 = LOD0의 50%, LOD2 = 20% (CLAUDE.md "AI 생성 모델 정리")
LOD_RATIOS = (1.0, 0.5, 0.2)

# 종류별 그럴듯한 높이(m) — 벗어나면 단위/스케일이 틀렸을 가능성을 경고한다
SANE_HEIGHT: dict[str, tuple[float, float]] = {
    "player": (1.2, 2.5),
    "enemy": (0.3, 6.0),
    "boss": (1.0, 30.0),
    "prop": (0.02, 20.0),
}


def decimate_ratio(current_tris: int, target_tris: int) -> float:
    """현재 삼각형 수를 목표 이하로 줄이는 비율 (0, 1]. 이미 목표 이하면 1."""
    if current_tris <= 0 or current_tris <= target_tris:
        return 1.0
    return max(1e-4, target_tris / current_tris)


def lod_targets(lod0_tris: int) -> list[int]:
    """LOD0 실제 삼각형 수 기준 LOD별 목표"""
    return [max(1, round(lod0_tris * r)) for r in LOD_RATIOS]


def texture_target_size(width: int, height: int, max_size: int) -> tuple[int, int]:
    """긴 변이 max_size를 넘으면 비율 유지 축소 (2의 거듭제곱이면 그대로 2의 거듭제곱으로 유지)"""
    long_side = max(width, height)
    if long_side <= max_size:
        return width, height
    scale = max_size / long_side
    return max(1, round(width * scale)), max(1, round(height * scale))


# ---------------------------------------------------------------------------
# 애니메이션 이름 규칙

ANIMATION_NAMES: dict[str, list[str]] = {
    "기본": ["idle", "guard", "drink"],
    "이동": ["walk_f", "walk_b", "walk_l", "walk_r", "run_f", "sprint"],
    "회피": ["roll_f", "roll_b", "backstep"],
    "공격": ["attack_light_1", "attack_light_2", "attack_light_3", "attack_heavy", "attack_run"],
    "피격": ["hit_front", "hit_back", "stagger", "parry"],
    "사망": ["death"],
}
ALL_ANIMATION_NAMES: list[str] = [n for names in ANIMATION_NAMES.values() for n in names]


def _words(stem: str) -> str:
    s = stem.lower()
    s = re.sub(r"[_\-.()]+", " ", s)
    s = re.sub(r"([a-z])(\d)", r"\1 \2", s)
    s = re.sub(r"\s+", " ", s).strip()
    return f" {s} "


def _has(w: str, *keys: str) -> bool:
    return any(f" {k}" in w for k in keys)


def guess_animation_name(filename: str) -> str | None:
    """믹사모 파일명 하나 → 이름 규칙 (공격 약공 번호는 guess_mapping이 매긴다: 'attack_light'로 돌려준다)"""
    w = _words(os.path.splitext(os.path.basename(filename))[0])
    back = _has(w, "back", "backward", "backwards")
    left = _has(w, "left")
    right = _has(w, "right")
    if _has(w, "death", "dying", "die "):
        return "death"
    if _has(w, "drink", "potion"):
        return "drink"
    if _has(w, "parry"):
        return "parry"
    if _has(w, "block", "guard"):
        return "guard"
    if _has(w, "stagger", "stun", "knockdown", "knocked"):
        return "stagger"
    if _has(w, "hit", "impact", "react", "reaction", "damage"):
        return "hit_back" if back else "hit_front"
    if _has(w, "backstep", "step back", "dodge back", "hop back"):
        return "backstep"
    if _has(w, "roll", "dodge", "evade", "dive"):
        return "roll_b" if back else "roll_f"
    attack = _has(w, "attack", "slash", "swing", "punch", "stab", "combo", "strike", "melee")
    if attack and _has(w, "run", "running", "sprint"):
        return "attack_run"
    if attack and _has(w, "heavy", "power", "charged", "overhead", "jump attack"):
        return "attack_heavy"
    if attack:
        return "attack_light"
    if _has(w, "sprint"):
        return "sprint"
    if _has(w, "run", "running", "jog"):
        return None if back else "run_f"
    if _has(w, "walk", "walking", "strafe"):
        if back:
            return "walk_b"
        if left:
            return "walk_l"
        if right:
            return "walk_r"
        return "walk_f"
    if _has(w, "idle", "breathing", "standing"):
        return "idle"
    return None


def _number_in(name: str) -> int:
    m = re.search(r"(\d+)(?!.*\d)", os.path.splitext(name)[0])
    return int(m.group(1)) if m else 0


@dataclass
class MappingGuess:
    mapping: dict[str, str]
    unresolved: list[str]
    conflicts: list[tuple[str, str]]  # (파일, 이미 다른 파일이 차지한 이름)


def guess_mapping(filenames: list[str]) -> MappingGuess:
    """파일명 목록 → {파일명: 이름}. 약공은 파일명의 번호/알파벳 순으로 1~3번을 매긴다."""
    mapping: dict[str, str] = {}
    unresolved: list[str] = []
    conflicts: list[tuple[str, str]] = []
    lights: list[str] = []
    for f in sorted(filenames):
        name = guess_animation_name(f)
        if name is None:
            unresolved.append(f)
        elif name == "attack_light":
            lights.append(f)
        elif name in mapping.values():
            conflicts.append((f, name))
        else:
            mapping[f] = name
    lights.sort(key=lambda f: (_number_in(f), f))
    for i, f in enumerate(lights):
        if i < 3:
            mapping[f] = f"attack_light_{i + 1}"
        else:
            conflicts.append((f, "attack_light_*"))
    return MappingGuess(mapping, unresolved, conflicts)


def missing_animations(names: list[str]) -> list[str]:
    have = set(names)
    return [n for n in ALL_ANIMATION_NAMES if n not in have]


def unknown_animations(names: list[str]) -> list[str]:
    return [n for n in names if n not in ALL_ANIMATION_NAMES]


def validate_mapping(mapping: dict[str, str]) -> list[str]:
    """mapping.json 오류 목록 (규칙에 없는 이름, 같은 이름 중복)"""
    errors = []
    seen: dict[str, str] = {}
    for f, n in mapping.items():
        if f.startswith("_"):
            continue
        if n not in ALL_ANIMATION_NAMES:
            errors.append(f"'{f}' → '{n}': 이름 규칙에 없는 이름")
        if n in seen:
            errors.append(f"'{n}'이 '{seen[n]}'와 '{f}'에 중복")
        seen[n] = f
    return errors


# ---------------------------------------------------------------------------
# GLB 읽기 (결과 검증)


def read_glb_json(path: str) -> dict:
    with open(path, "rb") as fh:
        header = fh.read(12)
        magic, version, _length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2:
            raise ValueError(f"GLB 2.0 파일이 아닙니다: {path}")
        chunk_len, chunk_type = struct.unpack("<I4s", fh.read(8))
        if chunk_type != b"JSON":
            raise ValueError("첫 청크가 JSON이 아닙니다")
        return json.loads(fh.read(chunk_len).decode("utf-8"))


def glb_animations(gltf: dict) -> list[tuple[str, float]]:
    """[(이름, 길이 초)] — 샘플러 입력(시간) 접근자의 max 중 최댓값"""
    accessors = gltf.get("accessors", [])
    out = []
    for i, anim in enumerate(gltf.get("animations", [])):
        end = 0.0
        for s in anim.get("samplers", []):
            acc = accessors[s["input"]]
            if acc.get("max"):
                end = max(end, float(acc["max"][0]))
        out.append((anim.get("name") or f"animation_{i}", end))
    return out


def glb_mesh_nodes(gltf: dict) -> list[str]:
    return [n.get("name", "") for n in gltf.get("nodes", []) if "mesh" in n]


def format_animation_report(anims: list[tuple[str, float]]) -> str:
    lines = [f"{'이름':<18} {'길이(초)':>8}  규칙", "-" * 36]
    for name, dur in sorted(anims, key=lambda a: (ALL_ANIMATION_NAMES.index(a[0]) if a[0] in ALL_ANIMATION_NAMES else 999, a[0])):
        lines.append(f"{name:<18} {dur:>8.2f}  {'✓' if name in ALL_ANIMATION_NAMES else '✗ 규칙 밖'}")
    missing = missing_animations([a[0] for a in anims])
    lines.append("")
    if missing:
        lines.append(f"누락 ({len(missing)}개, 코드에서는 idle로 대체): " + ", ".join(missing))
    else:
        lines.append("누락 없음")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 루트 모션

IN_PLACE_THRESHOLD_M = 0.05


def blender_to_gltf(x: float, y: float, z: float) -> tuple[float, float, float]:
    """블렌더(Z-up, -Y 정면) → glTF/Babylon(Y-up). glTF는 +Z가 캐릭터 정면."""
    return x, z, -y


def horizontal_extent(points: list[tuple[float, float]]) -> float:
    """시작점에서 가장 멀어진 수평 거리"""
    if not points:
        return 0.0
    x0, z0 = points[0]
    return max(((x - x0) ** 2 + (z - z0) ** 2) ** 0.5 for x, z in points)


def is_in_place(points: list[tuple[float, float]], threshold: float = IN_PLACE_THRESHOLD_M) -> bool:
    return horizontal_extent(points) < threshold


def root_motion_track(points: list[tuple[float, float]], fps: float) -> dict:
    """프레임별 수평 위치(시작점 기준, m, glTF x/z) → JSON용 dict"""
    x0, z0 = points[0]
    frames = [[round(x - x0, 5), round(z - z0, 5)] for x, z in points]
    return {"fps": fps, "frames": frames, "total": frames[-1], "duration": round((len(points) - 1) / fps, 5)}
