let cardData = [];
let apiCardData = []; // Store full API data
let isLoading = false;
let loadingInterval = null;

// API base URL - change this to your server URL
const API_BASE = 'http://localhost:3000';

function initData() {
    console.log("Initializing data...");
    const stored = localStorage.getItem('cardData');
    if (stored) {
        cardData = JSON.parse(stored);
        console.log("Data loaded from localStorage:", cardData);
        
        // Check if data is in correct format (has apiData field)
        if (cardData.length > 0 && cardData[0].apiData) {
            // Data is properly formatted
            if (typeof m !== 'undefined') m.redraw();
            if (typeof populateSetFilter !== 'undefined') populateSetFilter();
        } else {
            // Old format data, reload
            console.log("Old data format detected, reloading...");
            localStorage.removeItem('cardData');
            loadAndMergeData();
        }
        return;
    }
    
    // No stored data, load fresh
    loadAndMergeData();
}

async function loadAndMergeData() {
    try {
        // First load API data
        await loadAPIData();
        
        // Try to load Google Sheets data if available
        let hasSheetsData = false;
        if (window.sheetIds && Object.keys(window.sheetIds).length > 0) {
            try {
                await loadGoogleSheetsData();
                hasSheetsData = true;
            } catch (error) {
                console.warn('Google Sheets data not available, using API data only:', error);
            }
        }
        
        // Always transform/merge the data
        if (hasSheetsData) {
            mergeCardData();
        } else {
            // No Google Sheets data, just transform API data
            cardData = apiCardData.map(card => ({
                id: card.id,
                normal: 0,
                foil: 0,
                Name: card.name,
                Set: card.episode?.name || 'Unknown',
                trade: 0,
                apiData: card
            }));
        }
        
        // Save merged data
        localStorage.setItem('cardData', JSON.stringify(cardData));
        console.log("Data loaded and stored:", cardData);
        
        // Trigger Mithril redraw if needed
        if (typeof m !== 'undefined') m.redraw();
        // Populate set filter
        if (typeof populateSetFilter !== 'undefined') populateSetFilter();
        
    } catch (error) {
        console.error('Error loading and merging data:', error);
        // Fallback to API data only
        if (apiCardData.length > 0) {
            cardData = apiCardData.map(card => ({
                id: card.id,
                normal: 0,
                foil: 0,
                Name: card.name,
                Set: card.episode?.name || 'Unknown',
                trade: 0,
                apiData: card
            }));
            localStorage.setItem('cardData', JSON.stringify(cardData));
            if (typeof m !== 'undefined') m.redraw();
            if (typeof populateSetFilter !== 'undefined') populateSetFilter();
        }
    }
}

async function loadAPIData() {
    console.log("Loading API data...");
    
    try {
        const response = await fetch(`${API_BASE}/api/cards`);
        const data = await response.json();
        
        if (response.ok) {
            apiCardData = data.data || [];
            console.log(`Loaded ${apiCardData.length} cards from API`);
        } else {
            throw new Error('Failed to load API data');
        }
    } catch (error) {
        console.error('Error loading API data:', error);
        apiCardData = [];
        throw error;
    }
}

async function loadGoogleSheetsData() {
    console.log("Loading Google Sheets data...");
    
    return new Promise((resolve, reject) => {
        const urls = Object.values(window.sheetIds || {}).map(getUrl);
        const fetchPromises = urls.map(url => fetch(url).then(response => response.text()));
        
        Promise.all(fetchPromises)
            .then(responses => {
                const data = responses.map(response => JSON.parse(response.substring(47, response.length - 2)));
                console.log("Data loaded from sheets:", data);
                transformData(data);
                resolve();
            })
            .catch(error => {
                console.error("Error loading Google Sheets data:", error);
                reject(error);
            });
    });
}

function mergeCardData() {
    console.log("Merging API and Google Sheets data...");
    
    // Create a map of Google Sheets data by name for matching
    const sheetsDataMap = new Map();
    cardData.forEach(card => {
        if (card.Name) {
            sheetsDataMap.set(card.Name.toLowerCase().trim(), card);
        }
    });
    
    // Merge API data with Google Sheets data
    const mergedData = apiCardData.map(apiCard => {
        const sheetsCard = sheetsDataMap.get(apiCard.name.toLowerCase().trim());
        
        return {
            id: apiCard.id,
            normal: sheetsCard ? sheetsCard.normal : 0,
            foil: sheetsCard ? sheetsCard.foil : 0,
            Name: apiCard.name,
            Set: apiCard.episode?.name || 'Unknown',
            trade: sheetsCard ? sheetsCard.trade : 0,
            // Keep all API data for rich display
            apiData: apiCard
        };
    });
    
    cardData = mergedData;
    console.log(`Merged ${cardData.length} cards with collection data`);
}

async function loadCardsData() {
    try {
        const response = await fetch(`${API_BASE}/api/cards`);
        const data = await response.json();
        
        if (response.status === 202) {
            // Still fetching
            updateProgress(data.progress.current / data.progress.total * 100, 
                          `Fetching data... ${data.progress.current}/${data.progress.total}`);
            // Continue monitoring
            return;
        }
        
        // Data loaded
        cardData = data.data || [];
        
        // Transform API data to match expected format
        cardData = transformAPIData(cardData);
        
        localStorage.setItem('cardData', JSON.stringify(cardData));
        console.log("Data loaded from API:", cardData);
        
        updateProgress(100, `Loaded ${cardData.length} cards`);
        
        // Trigger Mithril redraw if needed
        if (typeof m !== 'undefined') m.redraw();
        // Populate set filter
        if (typeof populateSetFilter !== 'undefined') populateSetFilter();
        
        setTimeout(() => {
            showLoading(false);
            isLoading = false;
        }, 1000);
        
    } catch (error) {
        console.error('Error loading cards:', error);
        updateProgress(0, 'Error loading cards');
        showLoading(false);
        isLoading = false;
    }
}

async function refreshAPIData() {
    if (isLoading) return;
    
    isLoading = true;
    showLoading(true);
    updateProgress(0, 'Refreshing data...');
    
    try {
        // First refresh the server cache
        const response = await fetch(`${API_BASE}/api/refresh`, { method: 'POST' });
        const result = await response.json();
        
        if (response.ok) {
            updateProgress(50, 'Data refreshed, loading...');
            
            // Clear localStorage to force fresh load
            localStorage.removeItem('cardData');
            
            // Reload and merge data
            await loadAndMergeData();
            
            // Complete the refresh
            updateProgress(100, `Refreshed ${cardData.length} cards`);
            setTimeout(() => {
                showLoading(false);
                isLoading = false;
            }, 1000);
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error refreshing data:', error);
        updateProgress(0, 'Error refreshing data');
        showLoading(false);
        isLoading = false;
    }
}

function monitorProgress() {
    if (loadingInterval) clearInterval(loadingInterval);
    
    loadingInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE}/api/status`);
            const status = await response.json();
            
            if (status.isFetching) {
                const progress = status.progress.total > 0 ? 
                    (status.progress.current / status.progress.total) * 100 : 0;
                updateProgress(progress, `Fetching data... ${status.progress.current}/${status.progress.total}`);
            } else {
                clearInterval(loadingInterval);
                loadingInterval = null;
                if (!status.cacheExists) {
                    // No cache, try loading
                    await loadCardsData();
                }
            }
        } catch (error) {
            console.error('Error monitoring progress:', error);
        }
    }, 1000);
}

function showLoading(show) {
    const loadingEl = document.getElementById('loading-status');
    if (loadingEl) {
        loadingEl.style.display = show ? 'block' : 'none';
    }
}

function updateProgress(percent, text) {
    const fillEl = document.getElementById('progress-fill');
    const textEl = document.getElementById('progress-text');
    const statusEl = document.getElementById('api-status');
    
    if (fillEl) fillEl.style.width = `${percent}%`;
    if (textEl) textEl.textContent = text;
    if (statusEl) statusEl.textContent = `Status: ${text}`;
}

function transformAPIData(apiData) {
    return apiData.map(card => ({
        id: card.id,
        normal: 0, // Default values since API doesn't have collection data
        foil: 0,
        Name: card.name,
        Set: card.episode?.name || 'Unknown',
        trade: 0,
        // Keep original API data for additional features
        apiData: card
    }));
}

function transformData(dataArray) {
    const allItems = [];
    dataArray.forEach(sheetData => {
        const rows = sheetData.table.rows;
        
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.c && row.c.length >= 5) {
                const item = {
                    id: row.c[0] ? row.c[0].v : '',
                    normal: row.c[1] ? row.c[1].v : '',
                    foil: row.c[2] ? row.c[2].v : '',
                    Name: row.c[3] ? row.c[3].v : '',
                    Set: row.c[4] ? row.c[4].v : ''
                };
                item.trade = item.normal > 3 ? item.normal - 3 : 0;
                allItems.push(item);
            }
        }
    });
    // Store Google Sheets data temporarily (will be merged later)
    cardData = allItems;
    console.log("Google Sheets data transformed:", cardData);
}