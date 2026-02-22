// firebase.js — card catalog only (no Auth required)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyA4H55hTkvcSOTrTk6NnNNhIkgN7s95268",
  authDomain: "riftbro-53782.firebaseapp.com",
  projectId: "riftbro-53782",
  storageBucket: "riftbro-53782.firebasestorage.app",
  messagingSenderId: "452843010226",
  appId: "1:452843010226:web:aaa6653ea7271de41ab1ab",
  measurementId: "G-SS1J6PKX3M"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
