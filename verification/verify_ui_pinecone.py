from playwright.sync_api import sync_playwright, expect
import time
import subprocess
import os

def verify():
    # Start the preview server
    preview_process = subprocess.Popen(["npm", "run", "preview"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(15)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"BROWSER ERROR: {exc}"))

        try:
            print("Navigating to Admin Panel...")
            page.goto("http://localhost:4173/admin/courses/manager", wait_until="networkidle")
            page.screenshot(path="verification/admin_panel_courses.png")

            print("Navigating to Upload Center...")
            page.goto("http://localhost:4173/upload-center/upload", wait_until="networkidle")
            page.screenshot(path="verification/upload_center_ui.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
            preview_process.terminate()

if __name__ == "__main__":
    verify()
