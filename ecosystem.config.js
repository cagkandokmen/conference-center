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
        PORT: 443,
        MEDIASOUP_LISTEN_IP: '0.0.0.0',
        MEDIASOUP_ANNOUNCED_IP: '193.122.62.211',
        SSL_CERT: '/etc/letsencrypt/live/cagkanvideo.duckdns.org/fullchain.pem',
        SSL_KEY: '/etc/letsencrypt/live/cagkanvideo.duckdns.org/privkey.pem',
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
        // Update IVR to connect to the HTTPS signal server using the public domain to prevent SSL local mismatch
        SIGNAL_SERVICE_URL: 'https://cagkanvideo.duckdns.org',
        // Update this path to where you placed the model on the Ubuntu server!
        VOSK_MODEL_PATH: './models/vosk-model-small-en-us-0.15',
      },
    },
  ],
};
