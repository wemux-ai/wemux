const channel = process.env.WEMUX_PM2_CHANNEL === 'preview' ? 'preview' : 'production'
const packageName = channel === 'preview' ? 'wemux-worker-preview' : 'wemux-worker'
const packageTag = channel === 'preview' ? 'preview' : 'latest'
const cloudUrl = process.env.WEMUX_CLOUD_URL
  || (channel === 'preview' ? 'https://wemux.xyz/' : 'https://wemux.com/')

module.exports = {
  apps: [
    {
      name: `wemux-worker-${channel}`,
      script: 'npx',
      args: `-y ${packageName}@${packageTag} daemon`,
      interpreter: 'none',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        WEMUX_CLOUD_URL: cloudUrl,
        WEMUX_WORKER_RESTART_STRATEGY: 'pm2',
      },
    },
  ],
}
