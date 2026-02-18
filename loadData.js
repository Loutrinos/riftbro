// loadData.js
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';
import fetch from 'node-fetch'; // Need to install node-fetch

// Firebase config (same as firebase.js)
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
const db = getFirestore(app);

async function loadData() {
  try {
    const response = await fetch('https://riftboundindex.com/api/cards?pageSize=10000');
    const data = await response.json();
    console.log(`Fetched ${data.cards.length} cards from API`);
    const cards = data.cards; // The API returns an array directly

    for (const card of cards) {
      await setDoc(doc(db, 'cards', card.id.toString()), card);
      console.log(`Added card ${card.id}`);
    }
    console.log('Data loaded successfully');
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

loadData();