from playwright.sync_api import sync_playwright, expect
import time
import os
import subprocess

def verify():
    # Start the preview server in the background
    preview_process = subprocess.Popen(["npm", "run", "preview"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(10) # Give it more time to start

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"BROWSER ERROR: {exc}"))

        try:
            # Navigate to the app
            print("Navigating to landing page...")
            page.goto("http://localhost:4173", wait_until="networkidle")

            # The "Failed to load module script" might be because of base path issues in dist.
            # But normally vite preview works fine.
            # Let's try to just take a screenshot and see if anything is there.
            page.screenshot(path="verification/landing_3.png")

        except Exception as e:
            print(f"Error during playwright: {e}")
        finally:
            browser.close()
            preview_process.terminate()

if __name__ == "__main__":
    verify()
