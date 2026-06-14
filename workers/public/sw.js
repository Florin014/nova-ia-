// NOVA AI - Service Worker
// Handles background tasks, offline support, and long-running agents

const CACHE_NAME = 'nova-ai-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/crypto-utils.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).catch(() => cached);
    })
  );
});

// Handle background tasks from the main thread
self.addEventListener('message', async (event) => {
  const { type, taskId, payload } = event.data;

  switch (type) {
    case 'BACKGROUND_TASK':
      await runBackgroundTask(taskId, payload);
      break;
    case 'SCHEDULED_TASK':
      await runScheduledTask(taskId, payload);
      break;
  }
});

async function runBackgroundTask(taskId, payload) {
  const { prompt, model, provider } = payload;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model,
        provider,
        reflect: true,
      }),
    });

    self.clients.matchAll().then((clients) => {
      for (const client of clients) {
        client.postMessage({
          type: 'TASK_COMPLETE',
          taskId,
          status: response.ok ? 'completed' : 'failed',
          timestamp: Date.now(),
        });
      }
    });
  } catch (err) {
    self.clients.matchAll().then((clients) => {
      for (const client of clients) {
        client.postMessage({
          type: 'TASK_ERROR',
          taskId,
          error: err.message,
        });
      }
    });
  }
}

function runScheduledTask(taskId, payload) {
  // For future use: periodic memory consolidation, knowledge graph updates, etc.
  console.log(`[NOVA SW] Scheduled task ${taskId}`);
}
