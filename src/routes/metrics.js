const express = require('express');
const router = express.Router();

const metricsStore = [];

router.post('/', (req, res) => {
  const { metrics, userAgent } = req.body;
  metricsStore.push({ metrics, userAgent, receivedAt: new Date() });
  if (metricsStore.length > 1000) metricsStore.shift();
  res.json({ ok: true });
});

router.get('/summary', (req, res) => {
  res.json(metricsStore.slice(-10));
});

module.exports = router;
