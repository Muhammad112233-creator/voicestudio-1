import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

BRIDGE_PATH = Path(__file__).with_name("engine_bridge.py")
spec = importlib.util.spec_from_file_location("voicestudio_engine_bridge", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(bridge)


class BridgeUtilityTests(unittest.TestCase):
    def test_probe_is_explicitly_offline(self):
        result = bridge.probe()
        self.assertTrue(result["ok"])
        self.assertTrue(result["offline"])
        self.assertIn("faster_whisper", result["packages"])

    def test_srt_timestamp_rounds_milliseconds(self):
        self.assertEqual(bridge.srt_timestamp(61.2346), "00:01:01,235")

    def test_filename_is_a_basename(self):
        result = bridge.clean_name("../../my:voice?.wav")
        self.assertNotIn("/", result)
        self.assertNotIn("?", result)
        self.assertTrue(result.endswith(".wav"))

    def test_text_chunking_preserves_words_and_limits_long_chunks(self):
        text = ("A sample paragraph with readable words. " * 40) + "\n\nA second chapter."
        chunks = bridge.text_chunks(text, limit=120)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 120 for chunk in chunks))
        self.assertIn("A second chapter.", " ".join(chunks))

    def test_plain_text_document_extraction_is_local(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "chapter.txt"
            source.write_text("A local chapter.\nNo upload.", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                result = bridge.extract_document({"input_path": str(source)})
            self.assertEqual(result["text"], "A local chapter.\nNo upload.")


if __name__ == "__main__":
    unittest.main()
