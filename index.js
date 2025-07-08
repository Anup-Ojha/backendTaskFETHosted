// price-comparison-backend/index.js
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
require('dotenv').config(); // Load environment variables from .env file

const app = express();
app.use(cors()); // Enable CORS for cross-origin requests from Angular
app.use(express.json()); // Enable JSON body parsing

// --- Configuration for Websites and Selectors ---
// This structure allows for adding more websites and multiple possible selectors
// for robustness against minor website changes.
const websiteConfigs = {
    US: [
        {
            name: 'Apple US',
            baseUrl: 'https://www.apple.com',
            // IMPORTANT: Apple's search is NOT designed for scraping product lists with prices.
            // This search path will likely lead to high-level results or redirects.
            // Actual product prices are typically on specific product pages after configuration.
            // Scraping Apple.com for general product searches is extremely challenging and may not yield results.
            searchPath: '/us/search/{query}',
            productCardSelectors: ['div.as-search-result', 'div.rf-search-result'], // Highly speculative and likely to fail for general searches
            titleSelectors: ['h3.as-search-result-title', '.rf-search-result-title'], // Highly speculative
            linkSelectors: ['a.as-search-result-link', '.rf-search-result-link'], // Highly speculative
            priceSelectors: ['.as-product-price', '.rf-price'], // Apple prices are often dynamic or "From X"
            currency: 'USD',
            priceCleanRegex: /[^0-9.]/g, // Remove non-numeric except dot
            isRelativeLink: false,
            // Special handling for Apple.com if it needs custom logic beyond generic scrapeWebsite
            // For example, if you need to navigate to a specific product page after search.
        },
        {
            name: 'Amazon US',
            baseUrl: 'https://www.amazon.com',
            searchPath: '/s?k={query}',
            // More specific selector for organic search results
            productCardSelectors: ['div[data-component-type="s-search-result"][data-cel-widget]'],
            titleSelectors: ['h2 a span', '.a-size-medium'],
            // For Amazon, we'll try to extract data-asin for cleaner links
            linkSelectors: ['h2 a.a-link-normal', 'a.a-link-normal.s-underline-text.s-underline-link-text.s-link-style.a-text-normal'],
            priceSelectors: ['.a-price .a-offscreen', '.a-price-whole', '.a-color-price'],
            currency: 'USD',
            priceCleanRegex: /[^0-9.]/g,
            isRelativeLink: false,
            specialLinkHandling: 'amazon_asin', // Custom flag for Amazon link logic
        },
        {
            name: 'Best Buy US',
            baseUrl: 'https://www.bestbuy.com',
            searchPath: '/site/searchpage.jsp?st={query}',
            productCardSelectors: ['.sku-item', '.list-item'],
            titleSelectors: ['.sku-header > a', '.product-title'],
            linkSelectors: ['.sku-header > a', '.product-title a'],
            priceSelectors: ['.priceView-hero-price span[aria-hidden="true"]', '.price-box__price'],
            currency: 'USD',
            priceCleanRegex: /[^0-9.]/g,
            isRelativeLink: false,
        },
        {
            name: 'Walmart US',
            baseUrl: 'https://www.walmart.com',
            searchPath: '/search?q={query}',
            // Walmart selectors are highly dynamic and often require careful inspection
            productCardSelectors: ['div.mb0.ph0.pb0.ph1.bb.brdr-light-gray.flex.flex-wrap.w-100.flex-row.justify-content-start.items-center', '.sans-serif.dark-gray.relative.flex.flex-column.w-100.h-100'],
            titleSelectors: ['a.product-title-link.line-clamp-2', 'a[data-automation-id="product-title"]'],
            linkSelectors: ['a.product-title-link.line-clamp-2', 'a[data-automation-id="product-title"]'],
            priceSelectors: ['.price-group', '.f6.f5-l.lh-copy.dark-gray.fw4.mb1'],
            currency: 'USD',
            priceCleanRegex: /[^0-9.]/g,
            isRelativeLink: false,
        },
        {
            name: 'Target US',
            baseUrl: 'https://www.target.com',
            searchPath: '/s?searchTerm={query}',
            productCardSelectors: ['.styles__StyledProductCard-sc-1g1zjtx-0', 'div[data-test="product-card"]'],
            titleSelectors: ['h2[data-test="product-title"]', '.styles__StyledTitle-sc-1g1zjtx-3'],
            linkSelectors: ['a[data-test="product-title-link"]', 'a[data-test="product-card-link"]'],
            priceSelectors: ['.styles__PriceText-sc-1g1zjtx-6', 'div[data-test="product-price"] span'],
            currency: 'USD',
            priceCleanRegex: /[^0-9.]/g,
            isRelativeLink: true, // Target links can be relative
        },
    ],
    IN: [
        {
            name: 'Flipkart IN',
            baseUrl: 'https://www.flipkart.com',
            searchPath: '/search?q={query}',
            productCardSelectors: [
                'div[data-id][data-marketplace="FLIPKART"]', // More specific product container
                '._1AtVbE', // General container, might need deeper dive
            ],
            titleSelectors: ['._4rR01T', '.s1Q9rs', '._2rpwqI', 'div[data-id] > div > div:nth-child(2) > div:nth-child(1) > div:nth-child(1)'], // Common title selectors
            linkSelectors: ['a._1fQZEK', 'a._2Umfj-'], // Common link selectors
            priceSelectors: ['._30jeq3', '._2rQ-NK', '._1_WHN1'], // Common price selectors
            currency: 'INR',
            priceCleanRegex: /[^0-9]/g, // Remove non-numeric (Flipkart prices are often integers)
            isRelativeLink: true, // Flipkart links are often relative
        },
        {
            name: 'Amazon IN',
            baseUrl: 'https://www.amazon.in',
            searchPath: '/s?k={query}',
            // More specific selector for organic search results
            productCardSelectors: ['div[data-component-type="s-search-result"][data-cel-widget]'],
            titleSelectors: ['h2 a span', '.a-size-medium'],
            // For Amazon, we'll try to extract data-asin for cleaner links
            linkSelectors: ['h2 a.a-link-normal', 'a.a-link-normal.s-underline-text.s-underline-link-text.s-link-style.a-text-normal'],
            priceSelectors: ['.a-price .a-offscreen', '.a-price-whole', '.a-color-price'],
            currency: 'INR',
            priceCleanRegex: /[^0-9.]/g,
            isRelativeLink: false,
            specialLinkHandling: 'amazon_asin', // Custom flag for Amazon link logic
        },
        {
            name: 'Tata CLiQ IN',
            baseUrl: 'https://www.tatacliq.com',
            searchPath: '/search/?search={query}',
            productCardSelectors: ['.ProductModule__productContainer', '.ProductCard__productCardContainer'],
            titleSelectors: ['.ProductModule__productName', '.ProductCard__productName'],
            linkSelectors: ['.ProductModule__productLink', '.ProductCard__link'],
            priceSelectors: ['.ProductModule__finalPrice', '.ProductCard__price'],
            currency: 'INR',
            priceCleanRegex: /[^0-9.]/g,
            isRelativeLink: true,
        },
        {
            name: 'Croma IN',
            baseUrl: 'https://www.croma.com',
            searchPath: '/search/?text={query}',
            productCardSelectors: ['.product-item', '.product-grid-item'],
            titleSelectors: ['.product-title', '.product-name'],
            linkSelectors: ['.product-img-wrapper a', '.product-title a'],
            priceSelectors: ['.amount', '.new-price'],
            currency: 'INR',
            priceCleanRegex: /[^0-9.]/g,
            isRelativeLink: false,
        },
    ],
    CN: [
        {
            name: 'JD China',
            baseUrl: 'https://search.jd.com',
            searchPath: '/Search?keyword={query}',
            productCardSelectors: ['.gl-item'],
            titleSelectors: ['.p-name em'],
            linkSelectors: ['.p-name a'],
            priceSelectors: ['.p-price i'],
            currency: 'CNY',
            priceCleanRegex: /[^0-9.]/g,
            isRelativeLink: false
        }
    ],
    JP: [
        {
            name: 'Rakuten JP',
            baseUrl: 'https://search.rakuten.co.jp',
            searchPath: '/search/mall/{query}/',
            productCardSelectors: ['.searchresultitem'],
            titleSelectors: ['.title'],
            linkSelectors: ['.title a'],
            priceSelectors: ['.important'],
            currency: 'JPY',
            priceCleanRegex: /[^0-9]/g,
            isRelativeLink: false
        }
    ]
};

// --- Helper Function to find element text/attribute with multiple selectors ---
async function findElementText(page, parentElement, selectors) {
    for (const selector of selectors) {
        const element = await parentElement.$(selector);
        if (element) {
            return await page.evaluate(el => el.innerText, element);
        }
    }
    return null;
}

async function findElementAttribute(page, parentElement, selectors, attribute) {
    for (const selector of selectors) {
        const element = await parentElement.$(selector);
        if (element) {
            return await page.evaluate((el, attr) => el.getAttribute(attr), element, attribute);
        }
    }
    return null;
}

// --- Generic Scraper Function ---
async function scrapeWebsite(config, query) {
    console.log(`[${config.name}] Starting scrape for: "${query}"`);
    const url = `${config.baseUrl}${config.searchPath.replace('{query}', encodeURIComponent(query))}`;
    let browser;
    let page;
    const items = [];
    let status = 'success'; // Default status

    try {
        browser = await puppeteer.launch({
            headless: 'new', // Use the new headless mode
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] // Recommended for Docker/Linux
        });
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Wait for network to be idle, up to 60s
        } catch (navigationError) {
            console.error(`[${config.name}] Navigation error to ${url}: ${navigationError.message}`);
            status = 'scrape_error'; // Indicate navigation failure
            // Check for common CAPTCHA/block indicators after navigation failure or if page content is suspicious
            const pageContent = await page.content();
            if (pageContent.includes('captcha') || pageContent.includes('robot check') || pageContent.includes('verify you are human')) {
                status = 'captcha_detected';
            }
            return { items: [], status: status };
        }

        // --- Basic CAPTCHA/Block Detection after page load ---
        // Look for common CAPTCHA elements or block messages
        const captchaIndicators = [
            'iframe[src*="recaptcha"]', // reCAPTCHA iframe
            'div.g-recaptcha', // reCAPTCHA div
            '#recaptcha-challenge', // reCAPTCHA challenge
            '#px-captcha', // PerimeterX CAPTCHA
            '#sec-captcha', // Another common CAPTCHA ID
            'div[aria-label="reCAPTCHA challenge"]',
            'text/plain; charset=UTF-8' // Sometimes a plain text block page
        ];
        
        let captchaFound = false;
        for (const selector of captchaIndicators) {
            const element = await page.$(selector);
            if (element) {
                captchaFound = true;
                break;
            }
        }

        if (captchaFound) {
            console.warn(`[${config.name}] Potential CAPTCHA/Bot detected on ${url}.`);
            return { items: [], status: 'captcha_detected' };
        }

        // Evaluate the page content
        let productHandles = [];
        for (const selector of config.productCardSelectors) {
            productHandles = await page.$$(selector);
            if (productHandles.length > 0) {
                console.log(`[${config.name}] Found ${productHandles.length} product cards using selector: ${selector}`);
                break;
            }
        }

        if (productHandles.length === 0) {
            console.warn(`[${config.name}] No product cards found for query "${query}" with any provided selector.`);
            // If no product cards found, it could be genuinely no results, or a soft block/empty page.
            // We'll report 'no_products_found' unless a CAPTCHA was explicitly detected earlier.
            return { items: [], status: 'no_products_found' };
        }

        const queryLower = query.toLowerCase();
        // Extract potential storage parameters from the query
        const storageParamMatch = query.match(/\b(\d{2,4}GB)\b/i);
        const queryStorage = storageParamMatch ? storageParamMatch[1].toLowerCase() : null;

        for (const handle of productHandles) {
            let title = await findElementText(page, handle, config.titleSelectors);
            let link = null;
            let priceText = await findElementText(page, handle, config.priceSelectors);
            let parameter1 = ''; // Initialize parameter1

            // Special handling for Amazon links to get clean ASIN-based URLs
            if (config.specialLinkHandling === 'amazon_asin') {
                const dataAsin = await page.evaluate(el => el.getAttribute('data-asin'), handle);
                if (dataAsin) {
                    link = `${config.baseUrl}/dp/${dataAsin}`;
                } else {
                    // Fallback to generic link extraction if data-asin not found
                    link = await findElementAttribute(page, handle, config.linkSelectors, 'href');
                }
            } else {
                link = await findElementAttribute(page, handle, config.linkSelectors, 'href');
            }

            if (title && priceText && link) {
                // Clean price string
                let price = parseFloat(priceText.replace(config.priceCleanRegex, ''));
                
                // Handle relative links for non-Amazon sites if applicable
                if (config.isRelativeLink && link && !link.startsWith('http')) {
                    link = config.baseUrl + link;
                }

                // --- Populate parameter1 if storage is found in query and title ---
                if (queryStorage && title.toLowerCase().includes(queryStorage)) {
                    parameter1 = queryStorage.toUpperCase(); // Use the found storage from query
                }

                // No strict filtering here, all found items are pushed
                if (!isNaN(price)) { // Ensure price is a valid number
                    items.push({
                        productName: title.trim(),
                        link: link.trim(),
                        price: price, // Keep as number for sorting
                        currency: config.currency,
                        website_name: config.name,
                        parameter1: parameter1, // Populated parameter1
                    });
                }
            }
        }
        console.log(`[${config.name}] Found ${items.length} relevant items.`);
        return { items: items, status: 'success' };

    } catch (error) {
        console.error(`[${config.name}] Critical error during scraping: ${error.message}`);
        return { items: [], status: 'scrape_error' }; // Return error status for unexpected issues
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// --- API Endpoint ---
app.post('/api/search', async (req, res) => {
    const { country, query } = req.body;
    let allResults = [];
    const siteErrors = []; // To collect errors/statuses from individual sites

    if (!country || !query) {
        return res.status(400).json({ error: 'Country and query are required.' });
    }

    console.log(`Received search request: Country=${country}, Query="${query}"`);

    const configs = websiteConfigs[country.toUpperCase()]; // Get configs for the requested country

    if (!configs || configs.length === 0) {
        return res.status(404).json({ error: `No scraping configurations found for country: ${country}.` });
    }

    // Run scraping for all configured websites concurrently
    const scrapePromises = configs.map(config => scrapeWebsite(config, query));

    try {
        const resultsAndStatuses = await Promise.all(scrapePromises);
        resultsAndStatuses.forEach(result => {
            if (result.status === 'success') {
                allResults = allResults.concat(result.items);
            } else {
                // Collect specific error messages for each site
                let errorMessage = `Failed to scrape ${result.status.replace(/_/g, ' ')} from ${result.website_name || 'unknown site'}.`;
                if (result.status === 'captcha_detected') {
                    errorMessage = `CAPTCHA/Bot detected on ${result.website_name || 'unknown site'}.`;
                } else if (result.status === 'no_products_found') {
                    errorMessage = `No products found on ${result.website_name || 'unknown site'} for "${query}".`;
                }
                siteErrors.push(errorMessage);
            }
        });

        // Sort all results by price in ascending order
        allResults.sort((a, b) => (a.price || 0) - (b.price || 0)); // Ensure sorting by numerical price

        console.log(`Total results found for "${query}" in ${country}: ${allResults.length}`);
        
        // If there are results, send them. Otherwise, send accumulated errors.
        if (allResults.length > 0) {
            res.json(allResults);
        } else {
            // If no results AND there were specific site errors, report them
            if (siteErrors.length > 0) {
                res.status(500).json({ error: `Scraping completed with issues: ${siteErrors.join('; ')}` });
            } else {
                // If no results and no specific site errors, means no products found anywhere
                res.status(404).json({ error: `No products found for "${query}" in ${country} across all configured sites.` });
            }
        }

    } catch (error) {
        console.error('Error processing search request:', error.message);
        res.status(500).json({ error: 'Failed to perform search due to an internal server error.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend Server running at http://localhost:${PORT}`);
});
