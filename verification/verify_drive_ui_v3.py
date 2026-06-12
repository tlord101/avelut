from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 1200})
        page = context.new_page()

        print("Opening base URL...")
        page.goto("http://localhost:3000/")
        page.wait_for_load_state("networkidle")

        print("Setting admin auth in localStorage...")
        page.evaluate("window.localStorage.setItem('avelut_admin_authenticated', 'true')")

        # 1. Check App Settings
        print("Navigating to Admin App Settings...")
        page.goto("http://localhost:3000/admin/app")
        time.sleep(5) # Give it plenty of time

        # Take a full page screenshot to see what's actually there
        page.screenshot(path="verification/admin_app_full.png", full_page=True)

        # Try to find the Google Drive Integration text
        try:
            drive_header = page.locator("text=Google Drive Integration")
            if drive_header.is_visible():
                print("Found Google Drive Integration header!")
            else:
                print("Google Drive Integration header NOT visible in current view.")
        except Exception as e:
            print(f"Error searching for header: {e}")

        # 2. Check Course Registration import
        print("Navigating to Admin Courses Add...")
        page.goto("http://localhost:3000/admin/courses/add")
        time.sleep(3)
        page.screenshot(path="verification/admin_courses_add_full.png", full_page=True)

        browser.close()

if __name__ == "__main__":
    run()
