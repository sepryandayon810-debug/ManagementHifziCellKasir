// Konfigurasi Firebase WebPOS Hifzi Cell
const firebaseConfig = {
  apiKey: "AIzaSyCKU4LAF4sEaIMvsvNDTf_kU-7JmprsdMM",
  authDomain: "managementhifzicell.firebaseapp.com",
  projectId: "managementhifzicell",
  storageBucket: "managementhifzicell.firebasestorage.app",
  messagingSenderId: "275855765943",
  appId: "1:275855765943:web:93ed6975a3417fb3c73832"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const database = firebase.database();
const auth = firebase.auth();
const storage = firebase.storage();
