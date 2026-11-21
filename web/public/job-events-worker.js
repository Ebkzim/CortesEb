// All tabs on this origin share one server connection.
const clients = new Set();
let source = null;

self.onconnect = ({ ports: [port] }) => {
  port.onmessage = ({ data }) => {
    if (data === 'disconnect') {
      clients.delete(port);
      port.close();
      if (clients.size === 0) {
        source?.close();
        source = null;
      }
      return;
    }
    if (data !== 'connect') return;
    clients.add(port);
    if (source === null) {
      source = new EventSource('/api/events', { withCredentials: true });
      source.onopen = () => {
        for (const client of clients) client.postMessage({ type: 'open' });
      };
      source.onmessage = (event) => {
        for (const client of clients) client.postMessage({ type: 'event', data: event.data });
      };
    } else if (source.readyState === EventSource.OPEN) {
      port.postMessage({ type: 'open' });
    }
  };
  port.start();
};
