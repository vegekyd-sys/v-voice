"""Local PCM -> embedding worker. Audio and vectors are never written to disk."""
import base64
import json
import sys
import time

import numpy as np
import sherpa_onnx

config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
    model=sys.argv[1], num_threads=2, provider="cpu"
)
extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    request = {}
    try:
        if len(line) > 400000:
            raise ValueError("PCM window too large")
        request = json.loads(line)
        samples = np.frombuffer(base64.b64decode(request["audio"]), dtype="<i2")
        if len(samples) < 6400 or len(samples) > 128000:
            raise ValueError("Invalid PCM window")
        started = time.monotonic()
        stream = extractor.create_stream()
        stream.accept_waveform(sample_rate=16000, waveform=samples.astype(np.float32) / 32768)
        stream.input_finished()
        embedding = np.asarray(extractor.compute(stream), dtype=np.float32)
        embedding /= max(float(np.linalg.norm(embedding)), 1e-9)
        print(json.dumps({"id": request["id"], "embedding": embedding.tolist(),
                          "inferenceMs": round((time.monotonic()-started)*1000)}), flush=True)
    except Exception:
        print(json.dumps({"id": request.get("id"), "error": "声线计算失败"}), flush=True)
