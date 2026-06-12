from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # Bypass admin authentication
        page.goto("http://localhost:3000/")
        page.wait_for_load_state("networkidle")
        page.evaluate("window.localStorage.setItem('avelut_admin_authenticated', 'true')")

        # 1. Check App Settings for Google Drive credentials
        print("Navigating to Admin App Settings...")
        page.goto("http://localhost:3000/admin/app")
        page.wait_for_selector("text=Google Drive Integration", timeout=10000)
        page.screenshot(path="verification/admin_settings_drive_v2.png")
        print("Captured admin settings screenshot")

        # 2. Check Course Registration import
        print("Navigating to Admin Courses Add...")
        page.goto("http://localhost:3000/admin/courses/add")
        page.wait_for_selector("text=Drive", timeout=10000)
        page.screenshot(path="verification/admin_courses_add_drive_v2.png")
        print("Captured admin courses add screenshot")

        # 3. Check Avelut AI
        print("Navigating to Chat...")
        page.goto("http://localhost:3000/chat")
        page.wait_for_selector("text=AVELUT AI", timeout=10000)
        page.screenshot(path="verification/chat_view_v2.png")
        print("Captured chat view screenshot")

        browser.close()

if __name__ == "__main__":
    run()
