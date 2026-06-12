const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Set viewport to a standard desktop size
  await page.setViewportSize({ width: 1280, height: 800 });

  // Use a local server to serve the build
  const { createServer } = require('http');
  const { readFileSync } = require('fs');
  const server = createServer((req, res) => {
    let filePath = path.join(__dirname, 'dist', req.url === '/' ? 'index.html' : req.url);
    try {
      const content = readFileSync(filePath);
      const ext = path.extname(filePath);
      const contentType = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
      }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (e) {
      res.writeHead(404);
      res.end();
    }
  }).listen(3000);

  try {
    await page.goto('http://localhost:3000');

    // We need to bypass login to see the components.
    // Since this is a verification of UI layout, we can try to inject a mock user profile if the app allows it via localStorage/cookies or by manipulating React state (harder).
    // Alternatively, we can check the AdminPanel and UploadCenter components by navigating to their routes if they don't have strict guards in the build for verification.

    // For now, let's just try to see if the main elements are there.
    // We'll take a screenshot of the landing first.
    await page.screenshot({ path: 'verification/landing.png' });

    // Attempt to navigate to admin course addition to see if Drive button is there
    await page.goto('http://localhost:3000/admin/courses/add');
    await page.waitForTimeout(2000); // Wait for potential redirects/loads
    await page.screenshot({ path: 'verification/admin_courses_add.png', fullPage: true });

    // Admin App Settings for credentials
    await page.goto('http://localhost:3000/admin/app');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'verification/admin_app.png', fullPage: true });

  } catch (err) {
    console.error('Error during verification:', err);
  } finally {
    await browser.close();
    server.close();
  }
})();
