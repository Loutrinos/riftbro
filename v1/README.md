# Riftbro - Riftbound Card Collection Manager

![Riftbro Logo](images/logo.png)

A web-based card collection manager for the Riftbound trading card game. View your card collection with images, quantities, and trade information, with powerful filtering capabilities.

## 🌐 Live Demo

[🚀 View Riftbro on GitHub Pages](https://loutrinos.github.io/riftbro/)

## Features

- **Card Display**: View cards with images, normal/foil quantities, and trade values
- **Price Badges**: Euro prices displayed on card images
- **Interactive Modal**: Long-press (200ms) on cards to see enlarged details
- **Dynamic Filters**: Filter by set and trade availability
- **Google Sheets Integration**: Load data directly from published Google Sheets
- **URL Sharing**: Share filtered views with URL parameters
- **Responsive Design**: Works on desktop and mobile
- **API Backend**: Node.js server for fetching card data from RapidAPI (with mock data for development)

## Backend API Server

This project includes a Node.js Express server that simulates fetching card data from RapidAPI using mock data to avoid consuming API quota during development.

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   - Copy `.env` file and add your RapidAPI key and host
   - Set `USE_MOCK=true` for development with mock data
   - Set `USE_MOCK=false` to use real API (with caching)

3. Start the server:
   ```bash
   npm start
   ```
   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

4. The server runs on `http://localhost:3000`
   - Health check: `GET /health`
   - Cards API: `GET /api/cards` (returns all card data, cached for 24 hours)
   - Status check: `GET /api/status` (shows fetching progress and cache status)
   - Manual refresh: `POST /api/refresh` (force refresh cache)

### Data Model

The app now uses a hybrid data model:

- **API Data**: Provides rich card information (images, rarity, artist, detailed metadata)
- **Google Sheets Data**: Provides collection quantities (normal, foil, trade values)
- **Merged Data**: Combines both for complete card information with personal collection data

### Card Display Features

- **High-Quality Images**: Uses official card images from the API
- **Price Badges**: Euro prices displayed as badges on card images
- **Collection Quantities**: Shows normal, foil, and tradeable counts from Google Sheets
- **Detailed Modal**: Click cards to see enlarged image with full details
- **Rich Metadata**: Rarity, set, artist information in modal view

### Performance Optimization

For APIs with many pages (like 19 pages), the initial load time is optimized by:
- **Concurrent Requests**: Fetches 3 pages at a time instead of sequentially
- **Progress Monitoring**: Check `/api/status` to see fetching progress
- **Background Refresh**: Use `POST /api/refresh` to trigger refresh without blocking requests
- **Smart Caching**: Serves from cache immediately while refresh happens in background

### Caching Strategy

To minimize API quota usage (100 requests/day), the server implements intelligent caching:

- **Daily Refresh**: Fetches all data once per day (24-hour cache)
- **Pagination Handling**: Automatically fetches all pages from paginated API
- **Concurrent Fetching**: Fetches multiple pages simultaneously (3 concurrent requests) to reduce load time
- **Progress Tracking**: Monitor fetching progress via `/api/status` endpoint
- **Mock Mode**: Uses local `mockCardList.json` when `USE_MOCK=true`
- **Cache File**: Stores data in `cache.json` with timestamp

This means you consume API quota only once per day, regardless of how many times the frontend requests data.

### Performance Optimization

For APIs with many pages (like 19 pages), the initial load time is optimized by:
- **Concurrent Requests**: Fetches 3 pages at a time instead of sequentially
- **Progress Monitoring**: Check `/api/status` to see fetching progress
- **Background Refresh**: Use `POST /api/refresh` to trigger refresh without blocking requests
- **Smart Caching**: Serves from cache immediately while refresh happens in background

### Switching to Real API

To use actual RapidAPI data:

1. Update `server.js` to make real HTTP requests to RapidAPI
2. Use your API key from `.env`
3. Remove the mock data loading and return real API responses

## Usage

### Basic Usage

1. Open the app in your browser
2. Click the hamburger menu (☰) to open the data panel
3. Enter Google Sheet IDs (comma-separated) in the input field
4. Click "Load" to fetch and display your cards
5. Use the filters in the footer to narrow down your view

### Loading Data

The app loads card data from published Google Sheets. Each sheet should contain columns:
- ID: Card identifier
- Normal: Quantity of normal cards
- Foil: Quantity of foil cards
- Name: Card name
- Set: Set code (e.g., OGN, SFD)

### Filters

- **Set Filter**: Choose specific sets or view all
- **Trade Filter**: Show all cards or only those with tradeable excess (normal > 3)

### Modal View

- Long-press (hold for 200ms) on any card image to open the detail modal
- Release to close the modal
- Modal shows larger image and labeled quantities

## URL Parameters

You can share specific views using URL parameters:

### Sheet Loading
- `?sheets=ID1,ID2,ID3` - Load specific Google Sheet IDs
- Example: `?sheets=1XbzXAHZuwnWQkMAzI4cwOZZMvk33_dOrIRLmY8CFLNM`

### Filters
- `?set=SET_CODE` - Filter by set (e.g., `?set=OGN`)
- `?trade=has-trade` - Show only cards with trade value
- Combined: `?set=SFD&trade=has-trade`

### Full Examples
- `?sheets=1XbzXAHZuwnWQkMAzI4cwOZZMvk33_dOrIRLmY8CFLNM&set=OGN&trade=has-trade`
- `?set=SFD`

## Development

### Local Development

1. Clone the repository
2. Open `index.html` in a browser (requires a local server for CORS)
3. For development with CORS, run a local server:
   ```bash
   python -m http.server 8000
   ```
   Then visit `http://localhost:8000`

### File Structure

```
riftbro/
├── src/                    # Client-side source code
│   ├── main.js            # Mithril components and UI logic
│   ├── loadData.js        # Data loading and transformation
│   ├── interactions.js    # User interaction handlers
│   ├── utils.js           # Utility functions and sheet mappings
│   └── service-worker.js  # Service worker for offline support
├── server/                # Server-side code
│   └── server.js          # Express server and API endpoints
├── images/                # Static assets
├── index.html             # Main HTML structure
├── styles.css             # Styling and responsive design
├── package.json           # Node.js dependencies and scripts
└── README.md              # This file
```

### Technologies

- **Mithril.js** - Lightweight reactive UI framework
- **Google Sheets API** - Data source via published sheets
- **RapidAPI** - Card data API with caching
- **CSS3** - Responsive design with custom properties
- **LocalStorage** - Data caching
- **Service Worker** - Offline support and API caching

### Development Notes

- **Mock Data Changes**: When `USE_MOCK=true`, "Refresh Data" will pick up changes to `mockCardList.json`
- **Cache Behavior**: Server cache lasts 24 hours; manual refresh clears all caches
- **Data Merging**: API data is automatically merged with Google Sheets collection data
- **Progress Tracking**: Real-time loading progress for large datasets

## Deployment

The app is deployed on GitHub Pages. To deploy updates:

1. Push changes to the `main` branch
2. GitHub Pages will automatically update

## Contributing

Feel free to submit issues or pull requests for improvements!

## License

ISC License