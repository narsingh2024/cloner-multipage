const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

const visited = new Set();
const failed = new Set();

const downloadFile = async (fileUrl, outputPath) => {
  try {
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, response.data);
    console.log(`✅ Saved ${fileUrl} → ${outputPath}`);
  } catch (error) {
    if (!failed.has(fileUrl)) {
      failed.add(fileUrl);
      console.warn(`⚠️ Failed to download ${fileUrl}: ${error.message}`);
    }
  }
};

const getFileNameFromUrl = (urlObj) => {
  let pathname = urlObj.pathname;

  // Normalize filename
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (pathname === '') pathname = '/index.html';

  // Strip hash/query
  pathname = pathname.replace(/[#?].*$/, '');

  return decodeURIComponent(pathname);
};

const crawlPage = async (baseUrl, currentUrl, outputDir, depth = 2) => {
  if (depth <= 0) return;

  try {
    const urlObj = new URL(currentUrl, baseUrl);
    const normalizedUrl = urlObj.href.split('#')[0];

    if (visited.has(normalizedUrl)) return;
    visited.add(normalizedUrl);

    const response = await axios.get(normalizedUrl);
    const html = response.data;
    const $ = cheerio.load(html);

    const outputPath = path.join(outputDir, getFileNameFromUrl(urlObj));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html);
    console.log(`✅ Saved ${normalizedUrl} → ${outputPath}`);

    // Collect asset URLs (css, js, images)
    const assetUrls = new Set();
    $('link[href], script[src], img[src]').each((_, el) => {
      const src = $(el).attr('href') || $(el).attr('src');
      if (src) assetUrls.add(new URL(src, baseUrl).href);
    });

    // Download assets
    for (const assetUrl of assetUrls) {
      const assetPath = path.join(outputDir, getFileNameFromUrl(new URL(assetUrl)));
      await downloadFile(assetUrl, assetPath);
    }

    // Recursively crawl internal links
    const pageLinks = new Set();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      const fullUrl = new URL(href, baseUrl);
      if (fullUrl.hostname === new URL(baseUrl).hostname) {
        pageLinks.add(fullUrl.href);
      }
    });

    for (const link of pageLinks) {
      await crawlPage(baseUrl, link, outputDir, depth - 1);
    }

  } catch (error) {
    if (!failed.has(currentUrl)) {
      failed.add(currentUrl);
      console.warn(`❌ Error crawling ${currentUrl}: ${error.message}`);
    }
  }
};

module.exports = { crawlPage };
