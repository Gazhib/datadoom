import tempfile
import unittest
from pathlib import Path

import yaml

from ai.config import DEFAULT_JUDGES_FILE, interpolate, load_judges
from ai.providers import build_provider


class JudgeConfigTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "judges.yaml"

    def load(self, document: dict, env: dict | None = None):
        self.path.write_text(yaml.safe_dump(document), encoding="utf-8")
        return load_judges(self.path, env or {})

    def test_placeholders_use_environment_then_default(self):
        env = {"SET": "value", "EMPTY": ""}
        self.assertEqual(interpolate("${SET:-fallback}", env), "value")
        self.assertEqual(interpolate("${EMPTY:-fallback}", env), "fallback")
        self.assertEqual(interpolate("${MISSING:-fallback}", env), "fallback")
        self.assertEqual(interpolate("${MISSING}", env), "")
        self.assertEqual(interpolate({"a": ["x-${SET}"], "b": 3}, env), {"a": ["x-value"], "b": 3})

    def test_default_file_defines_three_local_judges_from_different_families(self):
        config = load_judges(DEFAULT_JUDGES_FILE, {})
        self.assertEqual([judge.name for judge in config.judges], ["judge-1", "judge-2", "judge-3"])
        self.assertEqual({judge.provider for judge in config.judges}, {"ollama"})
        self.assertEqual([judge.model for judge in config.judges], ["qwen3:8b", "gemma3:4b", "llama3.2:3b"])
        self.assertEqual((config.quorum, config.panel.timeout_seconds), (2, 540))
        self.assertTrue(all(judge.url is None and judge.temperature is None for judge in config.judges))

    def test_environment_overrides_one_judge_without_editing_the_file(self):
        env = {
            "JUDGE_2_PROVIDER": "openai",
            "JUDGE_2_MODEL": "gpt-5.4-mini",
            "JUDGE_2_TEMPERATURE": "0.2",
            "JUDGES_QUORUM": "3",
        }
        config = load_judges(DEFAULT_JUDGES_FILE, env)
        judge = config.judges[1]
        self.assertEqual((judge.provider, judge.model, judge.temperature), ("openai", "gpt-5.4-mini", 0.2))
        self.assertEqual(config.quorum, 3)
        self.assertEqual(config.judges[0].provider, "ollama")

    def test_quorum_defaults_to_a_majority_of_the_judges(self):
        judges = [{"name": f"j{index}", "provider": "ollama"} for index in range(5)]
        self.assertEqual(self.load({"judges": judges[:1]}).quorum, 1)
        self.assertEqual(self.load({"judges": judges[:3]}).quorum, 2)
        self.assertEqual(self.load({"judges": judges}).quorum, 3)

    def test_api_keys_are_rejected_in_the_file_without_echoing_them(self):
        judge = {"name": "gpt", "provider": "openai", "api_key": "sk-secret-value"}
        with self.assertRaises(ValueError) as caught:
            self.load({"judges": [judge]})
        self.assertIn("api_key", str(caught.exception))
        self.assertNotIn("sk-secret-value", str(caught.exception))

    def test_invalid_panels_fail_with_a_clear_message(self):
        judge = {"name": "solo", "provider": "ollama"}
        cases = (
            ({"panel": {"quorum": 2}, "judges": [judge]}, "quorum"),
            ({"judges": [judge, judge]}, "unique"),
            ({"judges": []}, "judges"),
            ({"judges": [dict(judge, provider="mistral")]}, "provider"),
            ({"judges": [dict(judge, name="has space")]}, "name"),
            ({"judges": [dict(judge, temperature=3)]}, "temperature"),
            ({"judges": [dict(judge, provider="anthropic", temperature=0.2)]}, "temperature"),
        )
        for document, expected in cases:
            with self.subTest(document=document), self.assertRaises(ValueError) as caught:
                self.load(document)
            self.assertIn(expected, str(caught.exception))

    def test_missing_or_malformed_file_fails(self):
        with self.assertRaisesRegex(ValueError, "Cannot read"):
            load_judges(self.path, {})
        self.path.write_text("judges: [unclosed", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "not valid YAML"):
            load_judges(self.path, {})

    def test_file_path_comes_from_environment(self):
        self.path.write_text(yaml.safe_dump({"judges": [{"name": "solo", "provider": "ollama"}]}), encoding="utf-8")
        config = load_judges(env={"EVALUATOR_JUDGES_FILE": str(self.path)})
        self.assertEqual([judge.name for judge in config.judges], ["solo"])


class ProviderResolutionTests(unittest.TestCase):
    def judge(self, **fields):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "judges.yaml"
        path.write_text(yaml.safe_dump({"judges": [{"name": "j", **fields}]}), encoding="utf-8")
        return load_judges(path, {}).judges[0]

    def test_judge_settings_take_precedence_over_provider_environment(self):
        judge = self.judge(provider="ollama", model="gemma3:4b", url="http://gpu-box:11434/")
        env = {"OLLAMA_URL": "http://host.docker.internal:11434", "OLLAMA_MODEL": "qwen3:1.7b"}
        provider = build_provider(judge, env)
        self.assertEqual(provider.model, "gemma3:4b")
        self.assertEqual(str(provider.endpoint), "http://gpu-box:11434/api/chat")

    def test_provider_environment_fills_unset_judge_fields(self):
        judge = self.judge(provider="ollama")
        env = {"OLLAMA_URL": "http://host.docker.internal:11434", "OLLAMA_MODEL": "qwen3:8b"}
        provider = build_provider(judge, env)
        self.assertEqual(provider.model, "qwen3:8b")
        self.assertEqual(str(provider.endpoint), "http://host.docker.internal:11434/api/chat")

    def test_custom_key_variable_and_https_only_for_hosted_providers(self):
        judge = self.judge(provider="openai", api_key_env="TEAM_OPENAI_KEY", url="https://proxy.example/v1")
        provider = build_provider(judge, {"TEAM_OPENAI_KEY": "team-key", "OPENAI_API_KEY": "other"})
        self.assertEqual(provider.headers(), {"Authorization": "Bearer team-key"})
        self.assertEqual(str(provider.endpoint), "https://proxy.example/v1/chat/completions")
        insecure = self.judge(provider="openai", url="http://proxy.example/v1")
        with self.assertRaisesRegex(ValueError, "url"):
            build_provider(insecure, {"OPENAI_API_KEY": "key"})
        with self.assertRaisesRegex(ValueError, "TEAM_OPENAI_KEY"):
            build_provider(judge, {"OPENAI_API_KEY": "other"})

    def test_claude_defaults_to_the_messages_api_and_needs_a_key(self):
        provider = build_provider(self.judge(provider="anthropic"), {"ANTHROPIC_API_KEY": "key"})
        self.assertEqual(provider.model, "claude-opus-5-5")
        self.assertEqual(str(provider.endpoint), "https://api.anthropic.com/v1/messages")
        self.assertFalse(provider.local)
        overridden = build_provider(
            self.judge(provider="anthropic"), {"ANTHROPIC_API_KEY": "key", "ANTHROPIC_MODEL": "claude-sonnet-5-5"}
        )
        self.assertEqual(overridden.model, "claude-sonnet-5-5")
        with self.assertRaisesRegex(ValueError, "ANTHROPIC_API_KEY"):
            build_provider(self.judge(provider="anthropic"), {})

    def test_gemini_rejects_a_custom_url(self):
        judge = self.judge(provider="gemini", url="https://example.com")
        with self.assertRaisesRegex(ValueError, "url"):
            build_provider(judge, {"GEMINI_API_KEY": "key"})

    def test_temperature_reaches_every_provider_payload(self):
        messages = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
        env = {
            "OPENAI_API_KEY": "k",
            "DASHSCOPE_API_KEY": "k",
            "GEMINI_API_KEY": "k",
            "QWEN_BASE_URL": "https://q.example/v1",
        }
        readers = {
            "llama.cpp": lambda payload: payload["temperature"],
            "ollama": lambda payload: payload["options"]["temperature"],
            "openai": lambda payload: payload["temperature"],
            "qwen": lambda payload: payload["temperature"],
            "gemini": lambda payload: payload["generationConfig"]["temperature"],
        }
        for name, read in readers.items():
            with self.subTest(provider=name):
                provider = build_provider(self.judge(provider=name, temperature=0.3), env)
                self.assertEqual(read(provider.payload(messages, {}, 256)), 0.3)

    def test_unset_temperature_keeps_local_greedy_and_hosted_defaults(self):
        messages = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
        local = build_provider(self.judge(provider="ollama"), {}).payload(messages, {}, 256)
        hosted = build_provider(self.judge(provider="openai"), {"OPENAI_API_KEY": "k"}).payload(messages, {}, 256)
        self.assertEqual(local["options"]["temperature"], 0)
        self.assertNotIn("temperature", hosted)
