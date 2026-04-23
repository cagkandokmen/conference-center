#!/bin/bash

# setup_vosk.sh — Downloads and installs the lightweight STT model.

echo "🤖 Starting IVR Lightweight Setup..."

# 1. Ensure we are in the ivr-service directory
cd "$(dirname "$0")"

# 2. Install dependencies
echo "📦 Installing npm dependencies..."
npm install

echo "🐍 Installing Python dependencies..."
pip3 install vosk --break-system-packages || pip3 install vosk

# 3. Download the small English model (approx 50MB)
echo "📥 Downloading Vosk model..."
MODEL_URL="https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
MODEL_ZIP="vosk-model.zip"

if [ -d "model" ]; then
    echo "✅ Model directory already exists. Skipping download."
else
    curl -L $MODEL_URL -o $MODEL_ZIP
    
    echo "unzipping model..."
    unzip $MODEL_ZIP
    
    echo "Setting up directory..."
    mv vosk-model-small-en-us-0.15 model
    rm $MODEL_ZIP
    echo "✅ Vosk model installed successfully."
fi

echo "🚀 Setup complete! You can now run 'npm start' to launch the bot."
