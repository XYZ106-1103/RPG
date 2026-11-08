"""tools/blender/lib_assets.py 단위 테스트 (블렌더 불필요): python3 -m unittest discover -s tests/blender"""

import json
import os
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "blender"))
import lib_assets as la  # noqa: E402


class BudgetTest(unittest.TestCase):
    def test_budgets_match_claude_md(self):
        self.assertEqual(la.BUDGETS["player"], la.Budget(40_000, 2048))
        self.assertEqual(la.BUDGETS["boss"], la.Budget(60_000, 4096))
        self.assertEqual(la.BUDGETS["enemy"], la.Budget(25_000, 2048))
        self.assertEqual(la.BUDGETS["prop"], la.Budget(5_000, 1024))

    def test_decimate_ratio(self):
        self.assertEqual(la.decimate_ratio(4000, 5000), 1.0)
        self.assertAlmostEqual(la.decimate_ratio(100_000, 5000), 0.05)
        self.assertEqual(la.decimate_ratio(0, 5000), 1.0)

    def test_lod_targets(self):
        self.assertEqual(la.lod_targets(5000), [5000, 2500, 1000])

    def test_texture_target(self):
        self.assertEqual(la.texture_target_size(4096, 4096, 1024), (1024, 1024))
        self.assertEqual(la.texture_target_size(4096, 2048, 1024), (1024, 512))
        self.assertEqual(la.texture_target_size(512, 512, 1024), (512, 512))


class AnimationNameTest(unittest.TestCase):
    def test_all_names(self):
        self.assertEqual(len(la.ALL_ANIMATION_NAMES), 22)
        self.assertIn("attack_light_3", la.ALL_ANIMATION_NAMES)

    def test_guess_mixamo_names(self):
        cases = {
            "Sword And Shield Idle.fbx": "idle",
            "Breathing Idle.fbx": "idle",
            "Walking.fbx": "walk_f",
            "Walking Backwards.fbx": "walk_b",
            "Left Strafe Walking.fbx": "walk_l",
            "Right Strafe Walk.fbx": "walk_r",
            "Standing Run Forward.fbx": "run_f",
            "Fast Run.fbx": "run_f",
            "Sprint.fbx": "sprint",
            "Stand To Roll.fbx": "roll_f",
            "Sword And Shield Dodge Back.fbx": "backstep",
            "Roll Backward.fbx": "roll_b",
            "Sword And Shield Block.fbx": "guard",
            "Drinking.fbx": "drink",
            "Great Sword Heavy Attack.fbx": "attack_heavy",
            "Running Slash.fbx": "attack_run",
            "Sword And Shield Slash.fbx": "attack_light",
            "Hit Reaction.fbx": "hit_front",
            "Standing React Large From Back.fbx": "hit_back",
            "Stunned.fbx": "stagger",
            "Sword And Shield Impact.fbx": "hit_front",
            "Standing Death Backward 01.fbx": "death",
            "Dying.fbx": "death",
            "Parry.fbx": "parry",
            # 애니메이션이 든 GLB의 애니메이션 이름 (확장자 없음)
            "Smash": "attack_heavy",
            "Block": "guard",
            "Roll": "roll_f",
            "Drink": "drink",
            "Running Backward.fbx": None,
            "Salsa Dancing.fbx": None,
        }
        for f, want in cases.items():
            with self.subTest(f=f):
                self.assertEqual(la.guess_animation_name(f), want)

    def test_guess_mapping_numbers_light_attacks(self):
        g = la.guess_mapping(["Slash 3.fbx", "Slash 1.fbx", "Slash 2.fbx", "Slash 4.fbx", "Idle.fbx", "Idle 2.fbx", "Dance.fbx"])
        self.assertEqual(g.mapping["Slash 1.fbx"], "attack_light_1")
        self.assertEqual(g.mapping["Slash 3.fbx"], "attack_light_3")
        self.assertEqual(g.mapping["Idle 2.fbx"], "idle")  # 정렬 순서상 'Idle 2' 다음 'Idle'
        self.assertIn(("Idle.fbx", "idle"), g.conflicts)
        self.assertIn(("Slash 4.fbx", "attack_light_*"), g.conflicts)
        self.assertEqual(g.unresolved, ["Dance.fbx"])

    def test_rule_names_kept(self):
        for n in la.ALL_ANIMATION_NAMES:
            self.assertEqual(la.guess_animation_name(n), n)
        # hero_1.glb의 애니메이션 22개: 기존 9개는 추정, 새 13개는 규칙 이름 그대로
        names = ["Block", "Drink", "Idle", "Roll", "Run", "SlashL", "SlashR", "Smash", "Walk", "attack_light_3", "attack_run", "backstep", "death",
                 "hit_back", "hit_front", "parry", "roll_b", "sprint", "stagger", "walk_b", "walk_l", "walk_r"]
        g = la.guess_mapping(names)
        self.assertEqual(sorted(g.mapping.values()), sorted(la.ALL_ANIMATION_NAMES))
        self.assertEqual((g.unresolved, g.conflicts), ([], []))
        self.assertEqual(g.mapping["SlashR"], "attack_light_2")
        self.assertEqual(g.mapping["attack_light_3"], "attack_light_3")

    def test_light_numbers_skip_taken(self):
        g = la.guess_mapping(["Slash A.fbx", "Slash B.fbx", "Slash C.fbx", "attack_light_1.fbx"])
        self.assertEqual(g.mapping["attack_light_1.fbx"], "attack_light_1")
        self.assertEqual(g.mapping["Slash A.fbx"], "attack_light_2")
        self.assertEqual(g.mapping["Slash B.fbx"], "attack_light_3")
        self.assertEqual(g.conflicts, [("Slash C.fbx", "attack_light_*")])

    def test_rule_name_wins_conflict(self):
        g = la.guess_mapping(["Slash Run.fbx", "attack_run.fbx"])
        self.assertEqual(g.mapping, {"attack_run.fbx": "attack_run"})
        self.assertEqual(g.conflicts, [("Slash Run.fbx", "attack_run")])

    def test_missing_and_validate(self):
        self.assertEqual(len(la.missing_animations(["idle", "walk_f"])), 20)
        self.assertEqual(la.unknown_animations(["idle", "dance"]), ["dance"])
        errs = la.validate_mapping({"_guessed": True, "a.fbx": "idle", "b.fbx": "idle", "c.fbx": "dance"})
        self.assertEqual(len(errs), 2)


class GlbTest(unittest.TestCase):
    def test_read_animations(self):
        gltf = {
            "asset": {"version": "2.0"},
            "accessors": [{"max": [1.5]}, {"max": [0.8]}, {"max": [2.25]}],
            "animations": [{"name": "idle", "samplers": [{"input": 0}, {"input": 1}]}, {"name": "dance", "samplers": [{"input": 2}]}],
            "nodes": [{"name": "a_LOD0", "mesh": 0}, {"name": "root"}],
        }
        data = json.dumps(gltf).encode()
        data += b" " * ((4 - len(data) % 4) % 4)
        with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as fh:
            fh.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(data)))
            fh.write(struct.pack("<I4s", len(data), b"JSON"))
            fh.write(data)
            path = fh.name
        try:
            g = la.read_glb_json(path)
            self.assertEqual(la.glb_animations(g), [("idle", 1.5), ("dance", 2.25)])
            self.assertEqual(la.glb_mesh_nodes(g), ["a_LOD0"])
            report = la.format_animation_report(la.glb_animations(g))
            self.assertIn("✗ 규칙 밖", report)
            self.assertIn("누락 (21개", report)
        finally:
            os.unlink(path)


class RootMotionTest(unittest.TestCase):
    def test_coords(self):
        # 블렌더 -Y(정면) 1m 전진 = glTF +Z 1m
        self.assertEqual(la.blender_to_gltf(0, -1, 0.9), (0, 0.9, 1))

    def test_in_place(self):
        self.assertTrue(la.is_in_place([(0, 0), (0.01, 0.02), (0.0, -0.01)]))
        self.assertFalse(la.is_in_place([(0, 0), (0.0, 0.5), (0.0, 1.0)]))

    def test_track(self):
        t = la.root_motion_track([(1.0, 2.0), (1.0, 2.5), (1.0, 3.0)], 30)
        self.assertEqual(t["frames"], [[0, 0], [0, 0.5], [0, 1.0]])
        self.assertEqual(t["total"], [0, 1.0])
        self.assertAlmostEqual(t["duration"], 2 / 30, places=4)


if __name__ == "__main__":
    unittest.main()
