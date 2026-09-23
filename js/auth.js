(function() {
  "use strict";

  // Cek status autentikasi global untuk proteksi halaman
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().onAuthStateChanged(user => {
        const isLoginPage = window.location.pathname.includes('login.html');
        if (!user && !isLoginPage) {
          window.location.href = "login.html";
        } else if (user && isLoginPage) {
          window.location.href = "index.html";
        }
      });
    }
  });

})();
