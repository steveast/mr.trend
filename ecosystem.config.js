module.exports = {
  apps: [
    {
      name: "mr-trend",
      script: "./dist/index.js",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};