/**
 * ws-client.js
 *
 * Tiny shared WebSocket wrapper used by both the display page and the host
 * page. Auto-reconnects with backoff if the connection drops (phone screen
 * lock, wifi blip, Render restarting the free-tier instance, etc.) so
 * neither page ever just goes silently stale during a live broadcast.
 */
function createGameSocket(onMessage, onConnectionChange) {
  let ws = null;
  let attempt = 0;
  let closedByUs = false;

  function connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      attempt = 0;
      if (onConnectionChange) onConnectionChange(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (err) {
        console.error("ws-client: failed to parse message", err);
      }
    };

    ws.onclose = () => {
      if (onConnectionChange) onConnectionChange(false);
      if (closedByUs) return;
      attempt += 1;
      const delay = Math.min(1000 * attempt, 8000);
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
  }

  connect();

  return {
    send(obj) {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(obj));
          return true;
        }
      } catch (err) {
        console.error("ws-client: send failed", err);
      }
      return false;
    },
    close() {
      closedByUs = true;
      if (ws) ws.close();
    },
  };
}
