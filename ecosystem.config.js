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
        MEDIASOUP_LISTEN_IP: '10.0.0.233',
        MEDIASOUP_ANNOUNCED_IP: '193.122.62.211',
        SSL_CERT: '/etc/letsencrypt/live/cagkanvideo.duckdns.org/fullchain.pem',
        SSL_KEY: '/etc/letsencrypt/live/cagkanvideo.duckdns.org/privkey.pem',
        // Signal server sends commands to the Bot on its Private IP
        IVR_SERVICE_URL: 'http://10.0.0.146:3002',
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
        // Bot sends signals back to the Signal Server via its Public Domain
        INTERNAL_SIGNAL_URL: 'https://cagkanvideo.duckdns.org',
        VOSK_MODEL_PATH: './model',
        // NEW: Tell the bot its own IP so Instance A knows where to send audio
        BOT_PRIVATE_IP: '10.0.0.146',
      },
    },
  ],
};
