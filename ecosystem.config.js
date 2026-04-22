module.exports = {
  apps: [
    {
      name: 'signal-service',
      script: './signal-service/src/index.js',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      name: 'ivr-service',
      script: './ivr-service/src/index.js',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3002,
        SIGNAL_SERVICE_URL: 'http://localhost:3001',
        // Update this path to where you placed the model on the Ubuntu server!
        VOSK_MODEL_PATH: './models/vosk-model-small-en-us-0.15',
      },
    },
  ],
};
