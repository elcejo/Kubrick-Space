/** Lightweight application event bus. Keep this module free of app/bootstrap imports. */
export const EventBus = (() => {
  const listeners = new Map();

  return Object.freeze({
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
    },

    off(event, callback) {
      const set = listeners.get(event);
      if (!set) return;
      set.delete(callback);
      if (set.size === 0) listeners.delete(event);
    },

    emit(event, data) {
      listeners.get(event)?.forEach((callback) => callback(data));
    },

    emitAsync(event, data) {
      const set = listeners.get(event);
      if (!set) return Promise.resolve([]);
      return Promise.all([...set].map((callback) => Promise.resolve().then(() => callback(data))));
    },

    once(event, callback) {
      const wrapper = (data) => {
        this.off(event, wrapper);
        callback(data);
      };
      this.on(event, wrapper);
    },
  });
})();
