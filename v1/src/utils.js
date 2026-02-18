// window.sheetIds = {
//     "OGN": "1XbzXAHZuwnWQkMAzI4cwOZZMvk33_dOrIRLmY8CFLNM",
//     "SFD": "1KJBWgQ3GoLpoTOP5x6_RaTxhVECsEw8GnJ7FsnJ4DzE"
// }

const sets = {
    "Origins": "OGN",
    "Spiritforged": "SFD"
}

function extractSheetId(url) {
    const trimmed = url.trim();
    const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : trimmed;
}

function getUrl(id) {
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=Sheet1&tq=${encodeURI("Select *")}`;
}

function set(setValue) {
    return sets[setValue] || setValue;
}