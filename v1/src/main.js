
// Define a simple component
let selectedCard = null;
let currentFilter = 'all';
let currentMissingFilter = 'all';

function updateURL() {
    const params = new URLSearchParams();
    if (currentFilter !== 'all') params.set('set', currentFilter);
    if (currentMissingFilter !== 'all') params.set('missing', currentMissingFilter);
    const newURL = params.toString() ? '?' + params.toString() : window.location.pathname;
    window.history.replaceState(null, '', newURL);
}

function loadFromURL() {
    const params = new URLSearchParams(window.location.search);
    currentFilter = params.get('set') || 'all';
    currentMissingFilter = params.get('missing') || 'all';
    const sheets = params.get('sheets');
    if (sheets) {
        const ids = sheets.split(',').map(s => s.trim()).filter(s => s);
        window.sheetIds = {};
        ids.forEach(id => {
            const longId = window.sheetIds[id] || id;
            window.sheetIds[id] = longId;
        });
        localStorage.removeItem('cardData');
    }
}

function populateSetFilter() {
    const sets = [...new Set(cardData.map(card => card.Set))].sort();
    const select = document.getElementById('set-filter');
    // Clear existing options except "All Sets"
    while (select.options.length > 1) {
        select.remove(1);
    }
    sets.forEach(set => {
        const option = document.createElement('option');
        option.value = set;
        option.textContent = set;
        select.appendChild(option);
    });
    select.value = currentFilter;
}

function onFilterChange() {
    currentFilter = document.getElementById('set-filter').value;
    updateURL();
    m.redraw();
}

function onMissingFilterChange() {
    currentMissingFilter = document.getElementById('missing-filter').value;
    updateURL();
    m.redraw();
}

function isCardMissingForMasterSet(card) {
    const totalCopies = card.normal + card.foil;
    
    // Special rules for certain sets
    if (card.Set && card.Set.toLowerCase().includes('legend')) {
        return totalCopies < 1; // Legends need 1 copy
    }
    
    if (card.Set && card.Set.toLowerCase().includes('battlefield')) {
        return totalCopies < 2; // Battlefields need 2 copies
    }
    
    // Default: most cards need 3 copies
    return totalCopies < 3;
}

function loadFromMain() {
    const inputs = document.querySelectorAll('.panel-content input');
    const urls = Array.from(inputs).map(input => input.value.trim()).filter(s => s);
    const ids = urls.map(extractSheetId);
    if (ids.length > 0) {
        window.sheetIds = {};
        ids.forEach(id => {
            const longId = window.sheetIds[id] || id;
            window.sheetIds[id] = longId;
        });
        localStorage.removeItem('cardData');
        initData();
        updateCurrentIds();
    }
}

function clearFromMain() {
    localStorage.removeItem('cardData');
    cardData = [];
    m.redraw();
    updateCurrentIds();
}

function shareFromMain() {
    shareCollection();
}

const Hello = {
    view: function() {
        const filteredCards = cardData.filter(card => 
            (currentFilter === 'all' || card.Set === currentFilter) &&
            (currentMissingFilter === 'all' || (currentMissingFilter === 'missing' && isCardMissingForMasterSet(card)))
        );
        return m("div", {class: "container"}, [
            filteredCards.length > 0 ? m("div", {class: "cards-grid"}, 
                filteredCards.map(card => 
                    m("div", {key: card.id, class: "card", onclick: () => onCardClick(card)}, [
                        m("img", {class: "card-img", src: card.apiData?.image || `https://static.dotgg.gg/riftbound/cards/${card.id}.webp`, alt: card.Name, onerror: (e) => e.target.src = 'images/no-image.png', onclick: () => { selectedCard = card; m.redraw(); }, oncontextmenu: (e) => e.preventDefault()}),
                        // Price badge
                        card.apiData?.prices?.cardmarket?.lowest_near_mint ? 
                            m("div", {class: "price-badge"}, `€${parseFloat(card.apiData.prices.cardmarket.lowest_near_mint).toFixed(2)}`) : null,
                        m("div", {class: "quantities"}, [
                            m("div", {class: "quantity normal"}, card.normal),
                            m("div", {class: "quantity foil"}, card.foil),
                            m("div", {class: "quantity trade"}, "♻️ " + card.trade)
                        ])
                    ])
                )
            ) : m("div", {class: "panel-content"}, [
                m("h3", "load your .csv urls (has to be public to be able to load)"),
                m("p", 'Current sheets: ' + Object.values(window.sheetIds || {}).join(', ')),
                m("input", {type: "text", placeholder: "Enter Google Sheets URL 1"}),
                m("input", {type: "text", placeholder: "Enter Google Sheets URL 2"}),
                m("button", {onclick: loadFromMain}, "Load")
            ]),
            selectedCard ? [
                m("div", {class: "modal", onclick: () => selectedCard = null}, 
                    m("hover-tilt", {class: "modal-content", onclick: (e) => e.stopPropagation()}, [
                        m("img", {src: selectedCard.apiData?.image || `https://static.dotgg.gg/riftbound/cards/${selectedCard.id}.webp`, alt: selectedCard.Name, onerror: (e) => e.target.src = 'images/no-image.png', oncontextmenu: (e) => e.preventDefault()}),
                        // Price badge in modal
                        selectedCard.apiData?.prices?.cardmarket?.lowest_near_mint ? 
                            m("div", {class: "price-badge modal-price-badge"}, `€${parseFloat(selectedCard.apiData.prices.cardmarket.lowest_near_mint).toFixed(2)}`) : null,
                    ])
                ),
                // Cardmarket link - full width button above bottom quantities
                m("a", {
                    class: "cardmarket-button",
                    href: `https://www.cardmarket.com/en/Riftbound/Products/Singles/${encodeURIComponent(selectedCard.Set)}/${selectedCard.Name.replace(/\s+/g, '-').replace(/'/g, '')}`,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    onclick: (e) => e.stopPropagation()
                }, "View on Cardmarket"),
                // Bottom quantities - fixed at bottom of screen
                m("div", {class: "bottom-quantities", onclick: (e) => e.stopPropagation()}, [
                    m("div", {class: "quantity-container"}, [
                        m("small", "Normal"),
                        m("div", {class: "quantity normal"}, selectedCard.normal)
                    ]),
                    m("div", {class: "quantity-container"}, [
                        m("small", "Foil"),
                        m("div", {class: "quantity foil"}, selectedCard.foil)
                    ]),
                    m("div", {class: "quantity-container"}, [
                        m("small", "Trade"),
                        m("div", {class: "quantity trade"}, "♻️ " + selectedCard.trade)
                    ])
                ])
            ] : null
        ]);
    }
};

initData();

// Mount the component to the main element
m.mount(document.querySelector('main'), Hello);