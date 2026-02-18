// firebase.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-check.js';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA4H55hTkvcSOTrTk6NnNNhIkgN7s95268",
  authDomain: "riftbro-53782.firebaseapp.com",
  projectId: "riftbro-53782",
  storageBucket: "riftbro-53782.firebasestorage.app",
  messagingSenderId: "452843010226",
  appId: "1:452843010226:web:aaa6653ea7271de41ab1ab",
  measurementId: "G-SS1J6PKX3M"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize App Check
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6LdrMG8sAAAAAPCOm_2y0IwLLqjf5UOsRITlB-fQ"),
  isTokenAutoRefreshEnabled: true
});

export const auth = getAuth(app);
export const db = getFirestore(app);
