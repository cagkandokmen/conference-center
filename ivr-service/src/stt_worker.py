import sys
import json
import os
from vosk import Model, KaldiRecognizer

# Path to the model
model_path = os.path.join(os.path.dirname(__file__), '../model')

if not os.path.exists(model_path):
    print(json.dumps({"error": f"Model not found at {model_path}"}))
    sys.exit(1)

model = Model(model_path)
# Initialize for 48kHz mono PCM
rec = KaldiRecognizer(model, 48000)

print(json.dumps({"status": "ready"}))
sys.stdout.flush()

# Read PCM chunks from stdin
while True:
    data = sys.stdin.buffer.read(4000)
    if len(data) == 0:
        break
    if rec.AcceptWaveform(data):
        result = json.loads(rec.Result())
        if result.get("text"):
            print(json.dumps({"transcript": result["text"]}))
            sys.stdout.flush()
    else:
        # Partial results can be enabled if needed
        # partial = json.loads(rec.PartialResult())
        # print(json.dumps({"partial": partial["partial"]}))
        # sys.stdout.flush()
        pass
