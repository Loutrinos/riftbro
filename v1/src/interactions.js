// interactions.js - Handle user interactions for the Riftbound card app

function onCardClick(card) {
    console.log('Card clicked:', card);
    // Add your interaction logic here
    // For example, show details, add to collection, etc.
}

function shareCollection() {
    const params = new URLSearchParams();
    const sheetIds = Object.values(window.sheetIds || {});
    if (sheetIds.length > 0) {
        params.set('sheets', sheetIds.join(','));
    }
    if (currentFilter !== 'all') params.set('set', currentFilter);
    if (currentMissingFilter !== 'all') params.set('missing', currentMissingFilter);
    const url = window.location.origin + window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('share-btn-header');
        btn.textContent = '✓';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = '🔗';
            btn.classList.remove('copied');
        }, 1000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
        alert('Copy this URL: ' + url);
    });
}

function updateCurrentIds() {
    const ids = Object.values(window.sheetIds || {});
    const spans = ids.map(id => `<span class="sheet-id">${id}</span>`).join(', ');
    document.getElementById('current-ids').innerHTML = 'Current sheets: ' + spans;
}

// Initialize header controls
document.addEventListener('DOMContentLoaded', () => {
    loadFromURL(); // Load filters and sheets from URL
    updateCurrentIds(); // Initial update

    const hamburger = document.getElementById('hamburger');
    const sidePanel = document.getElementById('side-panel');

    hamburger.addEventListener('click', () => {
        sidePanel.classList.toggle('open');
        updateCurrentIds(); // Update when opening
    });

    sidePanel.addEventListener('click', (e) => {
        if (e.target === sidePanel) {
            sidePanel.classList.remove('open');
        }
    });

    document.querySelector('main').addEventListener('click', () => {
        sidePanel.classList.remove('open');
    });

    document.getElementById('set-filter').addEventListener('change', onFilterChange);

    document.getElementById('missing-filter').addEventListener('change', onMissingFilterChange);

    // Set initial filter values
    document.getElementById('missing-filter').value = currentMissingFilter;

    document.getElementById('load-btn').addEventListener('click', () => {
        const url1 = document.getElementById('sheet-url-1').value.trim();
        const url2 = document.getElementById('sheet-url-2').value.trim();
        const urls = [url1, url2].filter(s => s);
        const ids = urls.map(extractSheetId);
        if (ids.length > 0) {
            window.sheetIds = {};
            ids.forEach(id => {
                const longId = window.sheetIds[id] || id;
                window.sheetIds[id] = longId;
            });
            localStorage.removeItem('cardData');
            initData();
            updateCurrentIds(); // Update after loading
            sidePanel.classList.remove('open'); // Close panel after loading
        }
    });

    document.getElementById('clear-btn').addEventListener('click', () => {
        localStorage.removeItem('cardData');
        cardData = [];
        if (typeof m !== 'undefined') m.redraw();
        updateCurrentIds(); // Update after clearing
        sidePanel.classList.remove('open'); // Close panel after clearing
    });

    document.getElementById('load-api-btn').addEventListener('click', () => {
        if (typeof loadAndMergeData === 'function') {
            // Clear existing data and reload
            localStorage.removeItem('cardData');
            cardData = [];
            loadAndMergeData();
        } else {
            console.error('loadAndMergeData function not found');
        }
        sidePanel.classList.remove('open');
    });

    document.getElementById('refresh-api-btn').addEventListener('click', () => {
        if (typeof loadAndMergeData === 'function') {
            // Clear existing data and reload
            localStorage.removeItem('cardData');
            cardData = [];
            loadAndMergeData();
        } else {
            console.error('loadAndMergeData function not found');
        }
        sidePanel.classList.remove('open');
    });

    document.getElementById('share-btn-header').addEventListener('click', shareCollection);
});