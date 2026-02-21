// main.js
import m from 'https://esm.sh/mithril@2.2.2';
import { auth, db } from './firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

// Utility functions
function extractSheetId(url) {
  const trimmed = url.trim();
  const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}

function getSheetUrl(id) {
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=Sheet1&tq=${encodeURI("Select *")}`;
}

// Import collection from Google Sheets
async function importCollection() {
  if (!state.user) return;
  const urls = [state.sheetUrl1, state.sheetUrl2].filter(u => u.trim());
  if (urls.length === 0) return alert('Please enter at least one Google Sheets URL');

  console.log('Importing with URLs:', urls);
  console.log('state.sheetUrl1:', state.sheetUrl1, 'state.sheetUrl2:', state.sheetUrl2);

  const ids = urls.map(extractSheetId);
  const promises = ids.map(async id => {
    const url = getSheetUrl(id);
    const response = await fetch(url);
    const text = await response.text();
    const json = JSON.parse(text.substring(47).slice(0, -2));
    return json.table.rows.map(row => ({
      id: row.c[0]?.v,
      normal: parseInt(row.c[1]?.v) || 0,
      foil: parseInt(row.c[2]?.v) || 0,
      trade: parseInt(row.c[3]?.v) || 0
    }));
  });

  try {
    const sheetsData = await Promise.all(promises);
    const allData = sheetsData.flat();

    console.log('All imported data:', allData);

    // Create a map by short id (e.g., OGN-001)
    const dataMap = {};
    allData.forEach(item => {
      if (item.id) {
        const shortId = item.id.toUpperCase().split('-').slice(0, 2).join('-');
        dataMap[shortId] = item;
      }
    });

    console.log('Data map keys:', Object.keys(dataMap));

    // Match with cards
    let matchedCount = 0;
    state.cards.forEach(card => {
      const shortId = card.id.toUpperCase().split('-').slice(0, 2).join('-');
      const match = dataMap[shortId];
      if (match) {
        matchedCount++;
        state.userCards[card.id] = {
          normal: match.normal,
          foil: match.foil,
          trade: match.trade
        };
      }
    });

    console.log('Matched cards:', matchedCount);

    // Recalculate trade values based on card types and quantities
    Object.keys(state.userCards).forEach(cardId => {
      const cardData = state.cards.find(card => card.id === cardId);
      if (cardData) {
        const userCard = state.userCards[cardId];
        const total = (userCard.normal || 0) + (userCard.foil || 0);
        
        // Check card types (case insensitive)
        const cardTypes = cardData.cardType?.type || [];
        const typeLabels = cardTypes.map(ct => ct.label?.toLowerCase()).filter(Boolean);
        
        let maxKeep = 3; // Default
        let canTrade = true;
        
        if (typeLabels.some(label => label.includes('rune'))) {
          canTrade = false;
        } else if (typeLabels.some(label => label.includes('battlefield'))) {
          maxKeep = 2;
        } else if (typeLabels.some(label => label.includes('legend'))) {
          maxKeep = 1;
        }
        
        // Calculate trade
        userCard.trade = canTrade ? Math.max(0, total - maxKeep) : 0;
      }
    });

    // Save to Firebase
    const batch = [];
    Object.entries(state.userCards).forEach(([cardId, data]) => {
      batch.push(setDoc(doc(db, 'users', state.user.uid, 'cards', cardId), data));
    });
    await Promise.all(batch);

    // Save URLs
    const urlsToSave = [state.sheetUrl1, state.sheetUrl2].filter(u => u);
    localStorage.setItem('sheetUrls', JSON.stringify(urlsToSave));
    await setDoc(doc(db, 'users', state.user.uid), { sheetUrls: urlsToSave }, { merge: true });
    console.log('Saved sheetUrls to localStorage and Firebase:', urlsToSave);

    // Update state
    state.sheetUrl1 = urlsToSave[0] || '';
    state.sheetUrl2 = urlsToSave[1] || '';
    console.log('After import, state.sheetUrl1:', state.sheetUrl1, 'state.sheetUrl2:', state.sheetUrl2);

    // Update localStorage cache
    localStorage.setItem(`userCards_${state.user.uid}`, JSON.stringify(state.userCards));

    alert('Collection imported successfully!');
    m.redraw();
  } catch (error) {
    console.error('Error importing collection:', error);
    alert('Error importing collection. Check console for details.');
  }
}

// Resolve the Trade Matcher URL — works for both local dev and GitHub Pages
const tradeMatcherUrl = 'give/';

// App state
let state = {
  user: null,
  cards: [],
  userCards: {},
  selectedCard: null,
  loading: true,
  authMode: 'signin', // 'signin' or 'signup'
  email: '',
  password: '',
  error: '',
  menuOpen: false,
  sheetUrl1: '',
  sheetUrl2: '',
  filters: {
    set: '',
    domain: '',
    rarity: '',
    cardType: '',
    tag: '',
    tradeOnly: false,
    masterOnly: false,
    tradeUser: null
  },
  filterOptions: {
    sets: [],
    domains: [],
    rarities: [],
    cardTypes: [],
    tags: []
  }
};

// Parse URL params
const urlParams = new URLSearchParams(window.location.search);
state.filters.set = urlParams.get('set') || '';
state.filters.domain = urlParams.get('domain') || '';
state.filters.rarity = urlParams.get('rarity') || '';
state.filters.cardType = urlParams.get('cardType') || '';
state.filters.tag = urlParams.get('tag') || '';
state.filters.tradeUser = urlParams.get('tradeUser');
state.filters.tradeOnly = urlParams.get('tradeOnly') === 'true';
state.filters.masterOnly = urlParams.get('masterOnly') === 'true';

// Update URL
function updateURL() {
  const params = new URLSearchParams();
  if (state.filters.set) params.set('set', state.filters.set);
  if (state.filters.domain) params.set('domain', state.filters.domain);
  if (state.filters.rarity) params.set('rarity', state.filters.rarity);
  if (state.filters.cardType) params.set('cardType', state.filters.cardType);
  if (state.filters.tag) params.set('tag', state.filters.tag);
  if (state.filters.tradeUser) params.set('tradeUser', state.filters.tradeUser);
  if (state.filters.tradeOnly) params.set('tradeOnly', 'true');
  if (state.filters.masterOnly) params.set('masterOnly', 'true');
  const newURL = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', newURL);
}

// Auth component
const Auth = {
  view: () => m('div.auth', [
    m('h2', state.authMode === 'signin' ? 'Sign In' : 'Sign Up'),
    m('input[type=email][placeholder=Email]', { value: state.email, oninput: e => state.email = e.target.value }),
    m('input[type=password][placeholder=Password]', { value: state.password, oninput: e => state.password = e.target.value }),
    m('button', { onclick: handleAuth }, state.authMode === 'signin' ? 'Sign In' : 'Sign Up'),
    m('button', { onclick: () => state.authMode = state.authMode === 'signin' ? 'signup' : 'signin' }, state.authMode === 'signin' ? 'Need to sign up?' : 'Already have account?'),
    state.error ? m('p.error', state.error) : null
  ])
};

// Card list component
const CardList = {
  view: () => {
    const filteredCards = state.cards.filter(card => {
      const typeArray = card.cardType?.type || [];
      const tagsArray = card.tags?.tags || [];
      const matchesFilters = (!state.filters.set || card.set?.value?.id === state.filters.set) &&
             (!state.filters.domain || card.domain?.values?.some(d => d.id === state.filters.domain)) &&
             (!state.filters.rarity || card.rarity?.value?.id === state.filters.rarity) &&
             (!state.filters.cardType || typeArray.some(ct => ct.id === state.filters.cardType)) &&
             (!state.filters.tag || tagsArray.includes(state.filters.tag));
      if (state.filters.tradeOnly) {
        return matchesFilters && state.user && (state.userCards[card.id]?.trade > 0);
      }
      if (state.filters.masterOnly) {
        if (!state.user) return false;
        const userCard = state.userCards[card.id] || { normal: 0, foil: 0 };
        const total = userCard.normal + userCard.foil;
        
        // Check card types (case insensitive)
        const cardTypes = card.cardType?.type || [];
        const typeLabels = cardTypes.map(ct => ct.label?.toLowerCase()).filter(Boolean);
        
        let maxAllowed = 3; // Default
        
        if (typeLabels.some(label => label.includes('rune'))) {
          maxAllowed = 1;
        } else if (typeLabels.some(label => label.includes('battlefield'))) {
          maxAllowed = 2;
        } else if (typeLabels.some(label => label.includes('legend'))) {
          maxAllowed = 1;
        }
        
        const masterValue = Math.max(0, maxAllowed - total);
        return matchesFilters && masterValue > 0;
      }
      return matchesFilters;
    });
    return m('div', { onclick: () => state.menuOpen = false }, [
      m('header.header', [
        m('img.logo', { src: 'images/logo.png', alt: 'Riftbro Logo' }),
        m('a.header-nav-link', { href: 'give/', title: 'Trade Matcher' }, '⇄ Trade Matcher'),
        m('button.hamburger', { onclick: e => { e.stopPropagation(); state.menuOpen = !state.menuOpen; } }, '☰'),
        state.menuOpen ? m('div.menu', { onclick: e => e.stopPropagation() }, [
          m('p.user-info', `Logged in as ${state.user.email}`),
          m('h4', 'Import Collection from Google Sheets'),
          m('input', { type: 'text', placeholder: 'Google Sheets URL 1', value: state.sheetUrl1, oninput: e => state.sheetUrl1 = e.target.value }),
          m('input', { type: 'text', placeholder: 'Google Sheets URL 2', value: state.sheetUrl2, oninput: e => state.sheetUrl2 = e.target.value }),
          m('button', { onclick: importCollection }, 'Import Collection'),
          Object.keys(state.userCards).length > 0 ? m('button', { onclick: clearCollection }, 'Clear Collection') : null,
          m('button.sign-out', { onclick: () => { auth.signOut(); state.menuOpen = false; } }, 'Sign Out')
        ]) : null
      ]),
      m('div.card-list', [
        m('div.filters', [
          m('select', { onchange: e => { e.stopPropagation(); state.filters.set = e.target.value; updateURL(); m.redraw(); } }, [
            m('option', { value: '' }, 'All Sets'),
            ...state.filterOptions.sets.map(s => m('option', { value: s.id }, `${s.label} (${s.count})`))
          ]),
          m('select', { onchange: e => { e.stopPropagation(); state.filters.domain = e.target.value; updateURL(); m.redraw(); } }, [
            m('option', { value: '' }, 'All Domains'),
            ...state.filterOptions.domains.map(d => m('option', { value: d.id }, `${d.label} (${d.count})`))
          ]),
          m('select', { onchange: e => { e.stopPropagation(); state.filters.rarity = e.target.value; updateURL(); m.redraw(); } }, [
            m('option', { value: '' }, 'All Rarities'),
            ...state.filterOptions.rarities.map(r => m('option', { value: r.id }, `${r.label} (${r.count})`))
          ]),
          m('select', { onchange: e => { e.stopPropagation(); state.filters.cardType = e.target.value; updateURL(); m.redraw(); } }, [
            m('option', { value: '' }, 'All Card Types'),
            ...state.filterOptions.cardTypes.map(ct => m('option', { value: ct.id }, `${ct.label} (${ct.count})`))
          ]),
          m('select', { onchange: e => { e.stopPropagation(); state.filters.tag = e.target.value; updateURL(); m.redraw(); } }, [
            m('option', { value: '' }, 'All Tags'),
            ...state.filterOptions.tags.map(t => m('option', { value: t.tag }, `${t.tag} (${t.count})`))
          ]),
          m('button.clear-filters', { onclick: e => { e.stopPropagation(); Object.keys(state.filters).forEach(k => { if (k !== 'tradeUser') state.filters[k] = (k === 'tradeOnly' || k === 'masterOnly') ? false : ''; }); updateURL(); m.redraw(); } }, 'Clear Filters'),
          m('label', { for: 'tradeOnly' }, [
            m('input[type=checkbox][id=tradeOnly]', { 
              checked: state.filters.tradeOnly, 
              onclick: e => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                state.filters.tradeOnly = !state.filters.tradeOnly; 
                updateURL(); 
                m.redraw(); 
              } 
            }),
            ' Show only tradeable cards'
          ]),
          m('label', { for: 'masterOnly' }, [
            m('input[type=checkbox][id=masterOnly]', { 
              checked: state.filters.masterOnly, 
              onclick: e => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                state.filters.masterOnly = !state.filters.masterOnly; 
                updateURL(); 
                m.redraw(); 
              } 
            }),
            ' Show only master cards'
          ]),
          m('p.filter-count', `Showing ${filteredCards.length} of ${state.cards.length} cards`)
        ]),
        state.loading ? m('p', 'Loading...') : m('div.grid', filteredCards.map(card => 
          m('div.card', { key: card.id }, [
            m('img', {
              'data-src': card.cardImage.url,
              onclick: () => state.selectedCard = card,
              oncreate: (vnode) => {
                const img = vnode.dom;
                const observer = new IntersectionObserver((entries) => {
                  entries.forEach(entry => {
                    if (entry.isIntersecting) {
                      img.src = img.dataset.src;
                      observer.unobserve(img);
                    }
                  });
                }, { rootMargin: '50px' }); // Load 50px before entering view
                observer.observe(img);
              }
            }),

            state.user ? m('div.collection', [
              m('div.normal', `Normal: ${state.userCards[card.id]?.normal || 0}`),
              m('div.foil', `Foil: ${state.userCards[card.id]?.foil || 0}`),
              m('div.trade', `Trade: ${state.userCards[card.id]?.trade || 0}`),
              (() => {
                const userCard = state.userCards[card.id] || { normal: 0, foil: 0 };
                const total = userCard.normal + userCard.foil;
                
                // Check card types (case insensitive)
                const cardTypes = card.cardType?.type || [];
                const typeLabels = cardTypes.map(ct => ct.label?.toLowerCase()).filter(Boolean);
                
                let maxAllowed = 3; // Default
                
                if (typeLabels.some(label => label.includes('rune'))) {
                  maxAllowed = 1;
                } else if (typeLabels.some(label => label.includes('battlefield'))) {
                  maxAllowed = 2;
                } else if (typeLabels.some(label => label.includes('legend'))) {
                  maxAllowed = 1;
                }
                
                const masterValue = Math.max(0, maxAllowed - total);
                return m('div.master', `Master: ${masterValue}`);
              })()
            ]) : null
          ])
        ))
      ])
    ]);
  }
};

// Modal component
const CardModal = {
  view: () => state.selectedCard ? m('div.modal', { onclick: () => state.selectedCard = null }, [
    m('div.modal-content', { onclick: e => e.stopPropagation(), "glare-mask-mode": "luminance" }, [
      m('hover-tilt.modal-image', m('img', { src: state.selectedCard.cardImage.url }))
    ])
  ]) : null
};

// Login component
const Login = {
  view: () => m('div.login-screen', [
    m('div.login-container', [
      m('img.logo', { src: 'images/logo.png', alt: 'Riftbro Logo' }),
      m('h2', 'Welcome to Riftbro'),
      m('p', 'Please sign in to access your card collection.'),
      m('form.login-form', { onsubmit: e => { e.preventDefault(); handleAuth(); } }, [
        m('input[type=email][placeholder=Email][required]', { value: state.email, oninput: e => state.email = e.target.value }),
        m('input[type=password][placeholder=Password][required]', { value: state.password, oninput: e => state.password = e.target.value }),
        m('button[type=submit]', state.authMode === 'signin' ? 'Sign In' : 'Sign Up'),
        m('button[type=button]', { onclick: () => state.authMode = state.authMode === 'signin' ? 'signup' : 'signin' }, state.authMode === 'signin' ? 'Need to sign up?' : 'Already have account?'),
        state.error ? m('p.error', state.error) : null
      ]),
      m('div.login-divider', m('span', 'or')),
      m('a.trade-matcher-link', { href: 'give/' }, [
        m('span.trade-matcher-icon', '⇄'),
        m('span', 'Trade Matcher'),
        m('small', 'Compare wishlists & trade lists — no login required'),
      ])
    ])
  ])
};

// Main app component
const App = {
  view: () => state.user ? [
    CardList.view(),
    CardModal.view()
  ] : Login.view()
};

// Auth handler
async function handleAuth() {
  try {
    if (state.authMode === 'signin') {
      await signInWithEmailAndPassword(auth, state.email, state.password);
    } else {
      await createUserWithEmailAndPassword(auth, state.email, state.password);
    }
    state.error = '';
  } catch (error) {
    state.error = error.message;
  }
  m.redraw();
}

// Load cards
async function loadCards() {
  const cached = localStorage.getItem('cachedCards');
  const cacheTimestamp = localStorage.getItem('cardsCacheTimestamp');
  const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  if (cached && cacheTimestamp && (Date.now() - parseInt(cacheTimestamp)) < CACHE_DURATION) {
    // Use cached data
    state.cards = JSON.parse(cached);
    populateFilterOptions();
    m.redraw();
    console.log('Loaded cards from localStorage cache');
  } else {
    // Fetch from Firebase
    try {
      const querySnapshot = await getDocs(collection(db, 'cards'));
      state.cards = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Cache the data
      localStorage.setItem('cachedCards', JSON.stringify(state.cards));
      localStorage.setItem('cardsCacheTimestamp', Date.now().toString());
      
      populateFilterOptions();
      m.redraw();
      console.log('Loaded cards from Firebase and cached to localStorage');
    } catch (error) {
      console.error('Error loading cards:', error);
      // If Firebase fails and we have cache, use it even if old
      if (cached) {
        state.cards = JSON.parse(cached);
        populateFilterOptions();
        m.redraw();
        console.log('Firebase failed, using old cached cards');
      }
    }
  }
}

// Populate filter options
function populateFilterOptions() {
  const sets = new Map();
  const domains = new Map();
  const rarities = new Map();
  const cardTypes = new Map();
  const tags = new Map();

  state.cards.forEach(card => {
    if (card.set?.value) {
      const key = JSON.stringify({ id: card.set.value.id, label: card.set.value.label });
      sets.set(key, (sets.get(key) || 0) + 1);
    }
    if (card.domain?.values) {
      card.domain.values.forEach(d => {
        const key = JSON.stringify({ id: d.id, label: d.label });
        domains.set(key, (domains.get(key) || 0) + 1);
      });
    }
    if (card.rarity?.value) {
      const key = JSON.stringify({ id: card.rarity.value.id, label: card.rarity.value.label });
      rarities.set(key, (rarities.get(key) || 0) + 1);
    }
    if (card.cardType?.type) {
      card.cardType.type.forEach(ct => {
        if (ct && ct.id && ct.label) {
          const key = JSON.stringify({ id: ct.id, label: ct.label });
          cardTypes.set(key, (cardTypes.get(key) || 0) + 1);
        }
      });
    }
    if (card.tags?.tags) {
      card.tags.tags.forEach(tag => {
        if (typeof tag === 'string') {
          tags.set(tag, (tags.get(tag) || 0) + 1);
        }
      });
    }
  });

  state.filterOptions.sets = Array.from(sets.entries()).map(([k, count]) => ({ ...JSON.parse(k), count })).sort((a, b) => a.label.localeCompare(b.label));
  state.filterOptions.domains = Array.from(domains.entries()).map(([k, count]) => ({ ...JSON.parse(k), count })).sort((a, b) => a.label.localeCompare(b.label));
  state.filterOptions.rarities = Array.from(rarities.entries()).map(([k, count]) => ({ ...JSON.parse(k), count })).sort((a, b) => a.label.localeCompare(b.label));
  state.filterOptions.cardTypes = Array.from(cardTypes.entries()).map(([k, count]) => ({ ...JSON.parse(k), count })).sort((a, b) => a.label.localeCompare(b.label));
  state.filterOptions.tags = Array.from(tags.entries()).map(([tag, count]) => ({ tag, count })).sort((a, b) => (a.tag || '').localeCompare(b.tag || ''));
}

// Load user cards
async function loadUserCards(uid) {
  // Load from localStorage first for immediate display
  const cached = localStorage.getItem(`userCards_${uid}`);
  if (cached) {
    state.userCards = JSON.parse(cached);
    m.redraw();
    console.log('Loaded user cards from localStorage cache');
  }

  // Then sync with Firebase
  try {
    const userCardsRef = collection(db, 'users', uid, 'cards');
    console.log('Fetching user cards from Firebase for uid:', uid);
    const querySnapshot = await getDocs(userCardsRef);
    console.log('Fetched user cards from Firebase, doc count:', querySnapshot.docs.length);
    state.userCards = {};
    querySnapshot.docs.forEach(doc => {
      state.userCards[doc.id] = doc.data();
    });

    // Recalculate trade values based on card types and quantities
    Object.keys(state.userCards).forEach(cardId => {
      const cardData = state.cards.find(card => card.id === cardId);
      if (cardData) {
        const userCard = state.userCards[cardId];
        const total = (userCard.normal || 0) + (userCard.foil || 0);
        
        // Check card types (case insensitive)
        const cardTypes = cardData.cardType?.type || [];
        const typeLabels = cardTypes.map(ct => ct.label?.toLowerCase()).filter(Boolean);
        
        let maxKeep = 3; // Default
        let canTrade = true;
        
        if (typeLabels.some(label => label.includes('rune'))) {
          canTrade = false;
        } else if (typeLabels.some(label => label.includes('battlefield'))) {
          maxKeep = 2;
        } else if (typeLabels.some(label => label.includes('legend'))) {
          maxKeep = 1;
        }
        
        // Calculate trade
        const newTrade = canTrade ? Math.max(0, total - maxKeep) : 0;
        
        // Update if different
        if (userCard.trade !== newTrade) {
          userCard.trade = newTrade;
          // Save back to Firebase
          setDoc(doc(db, 'users', uid, 'cards', cardId), userCard, { merge: true }).catch(err => 
            console.error('Error updating trade for card:', cardId, err)
          );
        }
      }
    });
    
    // Cache the latest data
    localStorage.setItem(`userCards_${uid}`, JSON.stringify(state.userCards));
    
    m.redraw();
    console.log('Synced user cards from Firebase and updated cache');
  } catch (error) {
    console.error('Error loading user cards:', error);
    // Keep the cached data if Firebase fails
  }
}

// Load user data
async function loadUserData(uid) {
  try {
    const userDoc = await getDoc(doc(db, 'users', uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      state.sheetUrl1 = data.sheetUrls?.[0] || '';
      state.sheetUrl2 = data.sheetUrls?.[1] || '';
      console.log('Loaded sheetUrls from Firebase:', data.sheetUrls);
    }
  } catch (error) {
    console.error('Error loading user data:', error);
  }
  // Also load from localStorage as backup
  const saved = localStorage.getItem('sheetUrls');
  if (saved) {
    const urls = JSON.parse(saved);
    if (!state.sheetUrl1) state.sheetUrl1 = urls[0] || '';
    if (!state.sheetUrl2) state.sheetUrl2 = urls[1] || '';
    console.log('Loaded sheetUrls from localStorage:', urls);
  }
}

// Clear collection
async function clearCollection() {
  if (!state.user) return;
  try {
    // Delete all user cards from Firebase
    const userCardsRef = collection(db, 'users', state.user.uid, 'cards');
    const querySnapshot = await getDocs(userCardsRef);
    const deletePromises = querySnapshot.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(deletePromises);
    
    // Clear local state
    state.userCards = {};
    state.sheetUrl1 = '';
    state.sheetUrl2 = '';
    localStorage.removeItem('sheetUrls');
    localStorage.removeItem(`userCards_${state.user.uid}`);
    m.redraw();
  } catch (error) {
    console.error('Error clearing collection:', error);
    alert('Error clearing collection. Check console for details.');
  }
}

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  console.log('Auth state changed:', !!user);
  state.user = user;
  if (user) {
    await loadUserCards(user.uid);
    await loadUserData(user.uid);
  } else {
    state.userCards = {};
    state.sheetUrl1 = '';
    state.sheetUrl2 = '';
  }
  m.redraw();
});

// Initialize
loadCards().then(() => {
  state.loading = false;
  m.redraw();
}).catch(() => {
  state.loading = false;
  m.redraw();
});

// Mount app
m.mount(document.getElementById('app'), App);