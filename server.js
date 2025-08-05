const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { crawlPage } = require('./crawler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve HTML/CSS/JS

// Serve your form HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle the POST request
app.post('/api/clone', async (req, res) => {
  const websiteUrl = req.body.url;

  if (!websiteUrl || !/^https?:\/\//.test(websiteUrl)) {
    return res.status(400).send('Invalid URL.');
  }

  const tempDir = path.join(__dirname, 'temp-site');
  const zipPath = path.join(__dirname, 'cloned-site.zip');

  // Clean previous temp/zip files
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  try {
    // Crawl the website
    await crawlPage(websiteUrl, websiteUrl, tempDir, 2); // Adjust depth as needed

    // Zip the folder
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(tempDir, false);
      archive.finalize();
    });

    // Send the ZIP file
    res.download(zipPath, 'cloned-site.zip', () => {
      // Optional cleanup after download
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
    });

  } catch (err) {
    console.error('❌ Clone failed:', err);
    res.status(500).send('Error cloning website. Check logs.');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
