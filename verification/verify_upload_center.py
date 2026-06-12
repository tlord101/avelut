from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # Bypass authentication for Upload Center
        # Upload Center uses a different profile check, but let's try to just go there
        print("Navigating to Upload Center...")
        page.goto("http://localhost:3000/upload-center")
        time.sleep(2)

        # Take screenshot of login/landing if not logged in
        page.screenshot(path="verification/upload_center_landing.png")

        # If we can bypass auth by setting some localStorage or mock state, we would.
        # But even seeing the landing page confirms it's there.

        browser.close()

if __name__ == "__main__":
    run()
