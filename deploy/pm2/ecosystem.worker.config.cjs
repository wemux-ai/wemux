const channel = process.env.VIBEMUX_PM2_CHANNEL === 'preview' ? 'preview' : 'production'
const packageName = channel === 'preview' ? 'vibemux-worker-preview' : 'vibemux-worker'
const packageTag = channel === 'preview' ? 'preview' : 'latest'
const cloudUrl = process.env.VIBEMUX_CLOUD_URL
  || (channel === 'preview' ? 'https://vibemux.xyz/' : 'https://vibemux.com/')

module.exports = {
  apps: [
    {
      name: `vibemux-worker-${channel}`,
      script: 'npx',
      args: `-y ${packageName}@${packageTag} daemon`,
      interpreter: 'none',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        VIBEMUX_CLOUD_URL: cloudUrl,
        VIBEMUX_WORKER_RESTART_STRATEGY: 'pm2',
      },
    },
  ],
}
