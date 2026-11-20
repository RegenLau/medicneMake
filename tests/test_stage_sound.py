from unittest import mock, TestCase

import server
import stage_video


class StageSoundTests(TestCase):
    def test_off_mix_is_identical_to_previous_stage_for_all_combinations(self):
        for shots in ([{"start": 2}], [{"start": 2, "sfxId": "builtin:sfx/check"}]):
            for music in (None, "quiet-bed.mp3"):
                for voiced in (False, True):
                    with self.subTest(shots=shots, music=music, voiced=voiced):
                        args = shots, music, "off", 8, voiced
                        base = server.music_mix(8, voiced) if music else ""
                        if "sfxId" in shots[0]:
                            path, item = server.ASSETS.resolve("builtin:sfx/check", ("sfx",))
                            source = base.removesuffix("[mix]") + "[base]" if base else "[0:a]anull[base]"
                            options = (f"{source};[{2 + bool(music)}:a]volume=-12dB,adelay=2160:all=1[sfx0];"
                                       "[base][sfx0]amix=inputs=2:duration=first:normalize=0,"
                                       "alimiter=limit=0.89:level=false:latency=1[mix]")
                            expected = (["-i", path], ["-filter_complex", options, "-map", "[mix]"], [(path, item)])
                        else:
                            expected = ([], ["-filter_complex", base, "-map", "[mix]"] if base else ["-map", "0:a:0"], [])
                        events = [{"type": "check", "t": 2.35, "shot": 0}]
                        self.assertEqual(expected, server.stage_sound_mix({}, *args, events))
                        self.assertEqual(expected, server.stage_sound_mix(
                            {"audio": {"sfx": {"pack": "off", "gainDb": -6}}}, *args, events
                        ))

    def test_event_uses_authored_gain_and_delay_before_limiter(self):
        audio = {"sfx": {"pack": "builtin:sfx-pack/soft", "gainDb": -14}}
        events = [{"type": "check", "t": 2.35}, {"type": "item-focus", "t": 4.0},
                  {"type": "check", "t": 12}, {"type": "unknown", "t": 2}]
        inputs, args, assets = server.stage_sound_mix({"audio": audio}, [], "music.mp3", "preset", 6, True, events)
        self.assertEqual(4, len(inputs))
        self.assertEqual(["builtin:sfx/check", "builtin:sfx/soft-pop"], [item["id"] for _, item in assets])
        filters = args[1]
        self.assertIn("[3:a]volume=-14dB,adelay=2350:all=1", filters)
        self.assertIn("[4:a]volume=-14dB,adelay=4000:all=1", filters)
        self.assertIn("[base][sfx0][sfx1]amix=inputs=3:duration=first:normalize=0,alimiter=limit=0.79", filters)

    def test_sound_settings_validate_unknown_packs_and_gain(self):
        for pack, gain in (("custom", -14), ("off", float("nan")), ("off", -100), ("off", "loud")):
            with self.subTest(pack=pack, gain=gain), self.assertRaises(ValueError):
                stage_video.sound_settings({"audio": {"sfx": {"pack": pack, "gainDb": gain}}}, server.ASSETS)

    def test_new_stage_provides_no_automatic_sound_for_legacy_requests(self):
        with mock.patch.object(server, "library_sound_mix", return_value=([], ["-map", "0:a:0"], [])) as mix:
            server.stage_sound_mix({}, [{"start": 0}], None, "off", 4, False, [{"type": "outro", "t": 2}])
            self.assertEqual([], mix.call_args.args[-1])
