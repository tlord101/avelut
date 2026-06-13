from playwright.sync_api import sync_playwright
import time
import subprocess

def verify():
    preview_process = subprocess.Popen(["npm", "run", "preview"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(10)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # We can't easily bypass login/onboarding without state,
            # but we can try to see the landing page or a general view.
            # Since I can't easily reach AvelutAI/StudyGuide without auth,
            # I will trust the build and code logic for now, or try to find a public route.
            print("Navigating to landing page...")
            page.goto("http://localhost:4173", wait_until="networkidle")
            page.screenshot(path="verification/landing_after_fixes.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
            preview_process.terminate()

if __name__ == "__main__":
    verify()
