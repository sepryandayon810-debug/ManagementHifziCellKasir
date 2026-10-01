(function () {
  "use strict";

  if (!window.AndroidBT) {
    console.warn("AndroidBT tidak tersedia. WebView bukan APK Android.");
    return;
  }

  let callbackId = 1;
  const callbacks = {};

  window.__btcb = function (id, ok, data) {
    const callback = callbacks[id];

    if (!callback) return;

    delete callbacks[id];

    if (ok) {
      if (typeof callback.success === "function") {
        callback.success(data);
      }
    } else {
      if (typeof callback.error === "function") {
        callback.error(data);
      }
    }
  };

  function nextId(success, error) {
    const id = callbackId++;

    callbacks[id] = {
      success: typeof success === "function" ? success : function () {},
      error: typeof error === "function" ? error : function () {}
    };

    return id;
  }

  function bytesToBase64(bytes) {
    let binary = "";

    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
  }

  window.bluetoothSerial = {
    list: function (success, error) {
      const id = nextId(success, error);
      window.AndroidBT.list(id);
    },

    isEnabled: function (success, error) {
      const id = nextId(success, error);
      window.AndroidBT.isEnabled(id);
    },

    connect: function (mac, success, error) {
      const id = nextId(success, error);
      window.AndroidBT.connect(String(mac), id);
    },

    write: function (data, success, error) {
      const id = nextId(success, error);

      let bytes;

      if (data instanceof Uint8Array) {
        bytes = data;
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else if (typeof data === "string") {
        bytes = new TextEncoder().encode(data);
      } else {
        bytes = new Uint8Array(data || []);
      }

      const base64 = bytesToBase64(bytes);

      window.AndroidBT.write(base64, id);
    },

    disconnect: function (success, error) {
      const id = nextId(success, error);
      window.AndroidBT.disconnect(id);
    }
  };

  console.log("Bluetooth Android WebView bridge aktif");
})();
