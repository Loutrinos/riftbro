const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_PATH = path.join(__dirname, 'cache.json');
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Global state for fetching status
let isFetching = false;
let fetchProgress = { current: 0, total: 0 };

// Middleware
app.use(cors());
app.use(express.json());

// Function to load cached data
function loadCache() {
  try {
    const cacheData = fs.readFileSync(CACHE_PATH, 'utf8');
    const cache = JSON.parse(cacheData);
    if (Date.now() - cache.timestamp < CACHE_MAX_AGE) {
      return cache.data;
    }
  } catch (error) {
    // Cache doesn't exist or is invalid
  }
  return null;
}

// Function to save cache
function saveCache(data) {
  const cache = {
    timestamp: Date.now(),
    data: data
  };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// Function to fetch all card data
async function fetchAllCardData() {
  const useMock = process.env.USE_MOCK === 'true';
  
  if (useMock) {
    // Load from mock file
    try {
      const mockDataPath = path.join(__dirname, 'mockCardList.json');
      const rawData = fs.readFileSync(mockDataPath, 'utf8');
      return JSON.parse(rawData);
    } catch (error) {
      console.error('Error loading mock data:', error);
      return { data: [] };
    }
  } else {
    // Fetch from real API with concurrent requests
    isFetching = true;
    fetchProgress = { current: 0, total: 0 };
    
    try {
      const allData = [];
      const limit = 20; // Adjust based on API
      
      // First, get the first page to determine total pages
      console.log('Fetching page 1 to determine total pages...');
      const firstResponse = await axios.get(`${process.env.RAPIDAPI_BASE_URL}/cards`, {
        params: { page: 1, limit },
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': process.env.RAPIDAPI_HOST
        }
      });
      
      const firstPageData = firstResponse.data;
      allData.push(...firstPageData.data);
      
      let totalPages = 1;
      if (firstPageData.meta && firstPageData.meta.total_pages) {
        totalPages = firstPageData.meta.total_pages;
      } else {
        // If no total_pages, keep fetching until we get less than limit
        while (true) {
          const nextPage = allData.length / limit + 1;
          if (nextPage > 100) break; // Safety limit
          
          console.log(`Fetching page ${nextPage}...`);
          try {
            const response = await axios.get(`${process.env.RAPIDAPI_BASE_URL}/cards`, {
              params: { page: nextPage, limit },
              headers: {
                'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
                'X-RapidAPI-Host': process.env.RAPIDAPI_HOST
              }
            });
            
            const pageData = response.data;
            allData.push(...pageData.data);
            
            if (pageData.data.length < limit) {
              break; // No more data
            }
          } catch (error) {
            console.error(`Error fetching page ${nextPage}:`, error.message);
            break;
          }
        }
      }
      
      // If we have total_pages, fetch remaining pages concurrently
      if (totalPages > 1) {
        fetchProgress.total = totalPages;
        fetchProgress.current = 1;
        
        const concurrencyLimit = 3; // Fetch 3 pages at a time
        const remainingPages = [];
        for (let page = 2; page <= totalPages; page++) {
          remainingPages.push(page);
        }
        
        console.log(`Fetching ${remainingPages.length} remaining pages with concurrency limit of ${concurrencyLimit}...`);
        
        for (let i = 0; i < remainingPages.length; i += concurrencyLimit) {
          const batch = remainingPages.slice(i, i + concurrencyLimit);
          const promises = batch.map(async (page) => {
            console.log(`Fetching page ${page}/${totalPages}...`);
            const response = await axios.get(`${process.env.RAPIDAPI_BASE_URL}/cards`, {
              params: { page, limit },
              headers: {
                'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
                'X-RapidAPI-Host': process.env.RAPIDAPI_HOST
              }
            });
            fetchProgress.current++;
            return response.data.data;
          });
          
          const batchResults = await Promise.all(promises);
          batchResults.forEach(pageData => allData.push(...pageData));
        }
      }
      
      console.log(`Fetched ${allData.length} cards from ${totalPages} pages`);
      return { data: allData };
    } finally {
      isFetching = false;
      fetchProgress = { current: 0, total: 0 };
    }
  }
}

// Mock API endpoint that simulates RapidAPI call
app.get('/api/cards', async (req, res) => {
  try {
    // Check cache first
    let data = loadCache();
    
    if (!data) {
      if (isFetching) {
        // Already fetching, return status
        return res.status(202).json({ 
          message: 'Data is being fetched', 
          progress: fetchProgress,
          status: 'fetching'
        });
      }
      
      console.log('Cache miss, fetching data...');
      data = await fetchAllCardData();
      saveCache(data);
      console.log('Data cached successfully');
    } else {
      console.log('Serving from cache');
    }
    
    // Simulate API delay
    setTimeout(() => {
      res.json(data);
    }, 100);
  } catch (error) {
    console.error('Error in /api/cards:', error);
    res.status(500).json({ error: 'Failed to fetch card data' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Status endpoint to check fetching progress
app.get('/api/status', (req, res) => {
  const cacheExists = loadCache() !== null;
  res.json({
    isFetching,
    progress: fetchProgress,
    cacheExists,
    cacheAge: cacheExists ? Date.now() - JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')).timestamp : null
  });
});

// Manual refresh endpoint
app.post('/api/refresh', async (req, res) => {
  if (isFetching) {
    return res.status(409).json({ error: 'Already fetching data' });
  }
  
  try {
    console.log('Manual refresh requested...');
    
    // Delete existing cache to force fresh load
    if (fs.existsSync(CACHE_PATH)) {
      fs.unlinkSync(CACHE_PATH);
      console.log('Cache cleared for refresh');
    }
    
    const data = await fetchAllCardData();
    saveCache(data);
    console.log('Manual refresh completed');
    res.json({ message: 'Data refreshed successfully', cardsCount: data.data.length });
  } catch (error) {
    console.error('Error during manual refresh:', error);
    res.status(500).json({ error: 'Failed to refresh data' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Mock API available at http://localhost:${PORT}/api/cards`);
});